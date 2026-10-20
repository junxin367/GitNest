import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { JAVA_ANALYSIS_AGENT_SOURCE } from "./java-analysis-agent-source";
import { pathInside } from "./isolated-analysis-project";
import type { AnalysisSourceFile, CodeAnalysisSettings } from "./model";

const adapters = new Map<string, Promise<string>>();

async function runJava(command: string, args: string[], signal?: AbortSignal): Promise<void> {
  await new Promise<void>((done, reject) => {
    const child = spawn(command, args, {
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, JAVA_TOOL_OPTIONS: "", JDK_JAVA_OPTIONS: "", _JAVA_OPTIONS: "" },
      ...(signal ? { signal } : {})
    });
    let diagnostics = "";
    const consume = (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString("utf8")).slice(-6000); };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Java 分析适配器准备超时。"));
    }, 60_000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => {
      clearTimeout(timer);
      if (code === 0) done();
      else reject(new Error(`Java Language Server 不支持当前只读工程适配：${diagnostics}`));
    });
  });
}

async function assertNoLinks(path: string): Promise<void> {
  for (let current = resolve(path);;) {
    if ((await lstat(current)).isSymbolicLink()) throw new Error(`Java 适配器路径包含链接：${current}`);
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export async function prepareJavaAnalysisLaunch(
  launch: { command: string; args: string[] },
  toolingDirectory: string,
  configuration: string,
  signal?: AbortSignal
): Promise<{ command: string; args: string[] }> {
  signal?.throwIfAborted();
  const jarIndex = launch.args.indexOf("-jar");
  const launcher = launch.args[jarIndex + 1];
  if (jarIndex < 0 || !launcher || !/org\.eclipse\.equinox\.launcher[^\\/]*\.jar$/i.test(launcher)) {
    throw new Error("Java 只读分析需要直接启动 JDT LS 的 java 可执行文件和 Equinox launcher，不能使用隐藏实际 JVM 参数的启动脚本。");
  }
  const plugins = dirname(resolve(launcher));
  const entries = await readdir(plugins);
  const compiler = entries.find(name => /^org\.eclipse\.jdt\.core\.compiler\.batch_.*\.jar$/.test(name));
  const asm = entries.find(name => /^org\.objectweb\.asm_\d.*\.jar$/.test(name));
  if (!compiler || !asm) throw new Error("JDT LS 缺少编译器或 ASM，无法准备只读工程适配器。");
  const relevant = entries.filter(name =>
    /^(?:org\.eclipse\.(?:jdt\.ls\.core|jdt\.ls\.filesystem|m2e\.core|m2e\.jdt|m2e\.maven\.runtime|jdt\.apt\.core|buildship\.core)_|org\.objectweb\.asm_|org\.eclipse\.jdt\.core\.compiler\.batch_).*\.jar$/.test(name)
  ).sort();
  const hash = createHash("sha256").update(JAVA_ANALYSIS_AGENT_SOURCE).update(launch.command);
  for (const entry of relevant) hash.update(entry).update(await readFile(join(plugins, entry)));
  const directory = join(toolingDirectory, hash.digest("hex"));
  const agent = join(directory, "analysis-agent.jar");
  await mkdir(toolingDirectory, { recursive: true });
  await assertNoLinks(toolingDirectory);
  let task = adapters.get(agent);
  if (!task) {
    task = (async () => {
      if (await access(agent).then(() => true, () => false)) {
        await assertNoLinks(agent);
        await assertNoLinks(join(directory, "asm.jar"));
        return agent;
      }
      const build = await mkdtemp(join(toolingDirectory, "compile-"));
      try {
        const source = join(build, "AnalysisAgent.java");
        const classes = join(build, "classes");
        await mkdir(classes);
        await writeFile(source, JAVA_ANALYSIS_AGENT_SOURCE, "utf8");
        await writeFile(join(build, "asm.jar"), await readFile(join(plugins, asm)));
        await runJava(launch.command, [
          "-jar", join(plugins, compiler), "-17", "-encoding", "UTF-8", "-proc:none",
          "-cp", join(build, "asm.jar"), "-d", classes, source
        ], signal);
        await runJava(launch.command, [
          "-cp", [classes, join(build, "asm.jar")].join(delimiter), "gitnest.analysis.AnalysisAgent",
          classes, join(build, "analysis-agent.jar"), plugins
        ], signal);
        await rm(classes, { recursive: true, force: true });
        await rm(source);
        await rename(build, directory).catch(async error => {
          if (!(await access(agent).then(() => true, () => false))) throw error;
        });
        return agent;
      } finally { await rm(build, { recursive: true, force: true }); }
    })();
    adapters.set(agent, task);
  }
  try {
    const adapter = await task;
    signal?.throwIfAborted();
    const args = [...launch.args];
    const delegation = args.findIndex(arg => arg.startsWith("-Dorg.osgi.framework.bootdelegation="));
    if (delegation >= 0) args[delegation] += ",gitnest.analysis.*";
    args.splice(jarIndex, 0,
      `-javaagent:${adapter}=${configuration}`,
      ...(delegation < 0 ? ["-Dorg.osgi.framework.bootdelegation=gitnest.analysis.*"] : []),
      "-Djava.import.generatesMetadataFilesAtProjectRoot=false"
    );
    return { command: launch.command, args };
  } catch (error) {
    adapters.delete(agent);
    throw error;
  }
}

export async function readJavaAnalysisErrors(directory: string): Promise<string[]> {
  const errors = new Set<string>();
  const visit = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && /^(?:\.log|\.bak_\d+\.log)$/.test(entry.name) && dirname(child).endsWith(".metadata")) {
        const stream = createReadStream(child, { encoding: "utf8" });
        const lines = createInterface({ input: stream, crlfDelay: Infinity });
        try {
          let error = false;
          for await (const line of lines) {
            if (line.startsWith("!ENTRY") || line.startsWith("!SUBENTRY")) {
              error = /^!(?:ENTRY \S+|SUBENTRY \d+ \S+) 4 /.test(line);
            } else if (error && line.startsWith("!MESSAGE ") && errors.size < 20) {
              errors.add(line.slice(9, 509));
            }
          }
        } finally { lines.close(); stream.destroy(); }
      }
    }
  };
  await visit(directory);
  return [...errors];
}

export async function collectJavaGeneratedSources(
  dataDirectory: string,
  documents: readonly { file: AnalysisSourceFile }[],
  settings: CodeAnalysisSettings
): Promise<{ sources: Array<{ file: AnalysisSourceFile; content: string }>; paths: Map<string, string> }> {
  const runtime = dirname(dataDirectory);
  const sources: Array<{ file: AnalysisSourceFile; content: string }> = [];
  const paths = new Map<string, string>();
  let bytes = 0;
  const origins = join(runtime, "generated-origins");
  for (const entry of await readdir(origins, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    const module = (await readFile(join(origins, entry.name), "utf8")).trim();
    const owner = documents.map(document => document.file)
      .filter(file => pathInside(file.rootPath, module))
      .sort((left, right) => right.rootPath.length - left.rootPath.length)[0];
    if (!owner) throw new Error("生成代码不属于当前分析工程。");
    const output = join(runtime, "java-output", entry.name);
    for (const kind of ["generated-main", "generated-test"]) {
      const root = join(output, kind);
      if (!(await access(root).then(() => true, () => false))) continue;
      await assertNoLinks(root);
      const visit = async (directory: string): Promise<void> => {
        for (const child of await readdir(directory, { withFileTypes: true })) {
          const path = join(directory, child.name);
          if (child.isSymbolicLink()) throw new Error("生成源码目录不能包含链接。");
          if (child.isDirectory()) await visit(path);
          else if (child.isFile() && child.name.endsWith(".java")) {
            const size = (await lstat(path)).size;
            if (size > settings.maxFileSizeBytes ||
                sources.length >= settings.maxFiles ||
                bytes + size > settings.maxTotalSourceBytes) {
              throw new Error("生成源码超过当前文件或体积上限，未将不完整生成结果标记为成功。");
            }
            const content = await readFile(path, "utf8");
            if (content.includes("\0")) throw new Error("生成源码不是有效文本。");
            bytes += Buffer.byteLength(content);
            const relativePath = join(".gitnest-generated", relative(owner.rootPath, module), kind, relative(root, path)).replaceAll("\\", "/");
            const absolutePath = join(owner.rootPath, relativePath);
            const canonicalPath = process.platform === "win32" ? absolutePath.toLowerCase() : absolutePath;
            paths.set(process.platform === "win32" ? path.toLowerCase() : path, canonicalPath);
            sources.push({ content, file: {
              ...owner, absolutePath, canonicalPath, relativePath, size: Buffer.byteLength(content),
              modifiedAtMs: 0, fingerprint: createHash("sha256").update(content).digest("hex"),
              changed: false, generatedContent: content
            } });
          }
        }
      };
      await visit(root);
    }
  }
  return { sources, paths };
}
