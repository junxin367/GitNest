import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access, lstat, mkdir, mkdtemp, readFile,
  realpath, rename, rm, writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { LSP_ANALYSIS_POLICY_VERSION } from "./lsp-analysis-policy";
import { WINDOWS_ANALYSIS_HOST_SOURCE } from "./windows-analysis-host-source";
import { GRADLE_ANALYSIS_INIT } from "./gradle-analysis-init";

interface Launch { command: string; args: string[] }

export interface AnalysisProjectInput {
  workspaceRootPath: string;
  workspaceFolders: string[];
  dataDirectory: string;
  documents: readonly { file: { absolutePath: string }; content: string }[];
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export interface IsolatedAnalysisProject {
  dataDirectory: string;
  workingDirectory: string;
  javaConfiguration: string;
  toolingDirectory: string;
  environment: Record<string, string>;
  launch(command: string, args: string[], cwd: string): Launch;
  dispose(): Promise<void>;
}

export type PrepareAnalysisProject = (
  input: AnalysisProjectInput
) => Promise<IsolatedAnalysisProject | undefined>;

export function pathInside(parent: string, child: string): boolean {
  const difference = relative(resolve(parent), resolve(child));
  return difference === "" || (
    difference !== ".." && !difference.startsWith(`..${sep}`) && !isAbsolute(difference)
  );
}

const compilerTasks = new Map<string, Promise<string>>();

async function analysisHost(dataDirectory: string, signal?: AbortSignal): Promise<string> {
  const directory = join(dataDirectory, "analysis-host");
  const version = createHash("sha256").update(WINDOWS_ANALYSIS_HOST_SOURCE).digest("hex").slice(0, 24);
  const executable = join(directory, `${version}.exe`);
  const cached = compilerTasks.get(executable);
  if (cached) return cached;
  const task = (async () => {
    await mkdir(directory, { recursive: true });
    await assertNoLinks(directory);
    if (await access(executable).then(() => true, () => false)) return executable;
    const buildDirectory = await mkdtemp(join(directory, "compile-"));
    try {
      const source = join(buildDirectory, "AnalysisHost.cs");
      const output = join(buildDirectory, "AnalysisHost.exe");
      await writeFile(source, WINDOWS_ANALYSIS_HOST_SOURCE);
      const windows = process.env.SystemRoot ?? "C:\\Windows";
      const compiler = join(windows, "Microsoft.NET", process.arch === "x64" ? "Framework64" : "Framework", "v4.0.30319", "csc.exe");
      await new Promise<void>((done, reject) => {
        const child = spawn(compiler, ["/nologo", "/target:exe", `/out:${output}`, source], {
          windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
          ...(signal ? { signal } : {})
        });
        let diagnostics = "";
        child.stdout.on("data", (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-4000); });
        child.stderr.on("data", (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-4000); });
        const timer = setTimeout(() => { child.kill(); reject(new Error("隔离启动器编译超时。")); }, 30_000);
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.once("exit", (code) => {
          clearTimeout(timer);
          if (code === 0) done();
          else reject(new Error(`无法创建隔离启动器：${diagnostics}`));
        });
      });
      // Another process may have compiled the identical source concurrently.
      await rename(output, executable).catch(async (error: unknown) => {
        if (!(await access(executable).then(() => true, () => false))) throw error;
      });
      return executable;
    } finally { await rm(buildDirectory, { recursive: true, force: true }); }
  })();
  compilerTasks.set(executable, task);
  try { return await task; }
  catch (error) { compilerTasks.delete(executable); throw error; }
}

async function assertNoLinks(path: string): Promise<void> {
  for (let current = resolve(path);;) {
    if ((await lstat(current)).isSymbolicLink()) throw new Error(`隔离路径包含链接：${current}`);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function uniqueRoots(paths: readonly string[]): string[] {
  const roots: string[] = [];
  for (const path of paths.map((item) => resolve(item)).sort((a, b) => a.length - b.length)) {
    if (!roots.some((root) => pathInside(root, path))) roots.push(path);
  }
  return roots;
}

export async function prepareIsolatedAnalysisProject(input: AnalysisProjectInput): Promise<IsolatedAnalysisProject> {
  if (process.platform !== "win32") throw new Error("当前平台尚未提供工程写入隔离，已保留内置分析。");
  input.signal?.throwIfAborted();
  const roots = uniqueRoots([...input.workspaceFolders, input.workspaceRootPath]);
  const dataDirectory = resolve(input.dataDirectory);
  for (const root of roots) {
    if (pathInside(root, dataDirectory) || pathInside(dataDirectory, root)) {
      throw new Error("隔离运行目录必须位于原项目目录之外。");
    }
    await assertNoLinks(root);
    if (resolve(await realpath(root)).toLowerCase() !== root.toLowerCase()) {
      throw new Error(`无法确认原项目的实际路径：${root}`);
    }
  }
  input.onProgress?.("正在准备只读工程分析环境");
  const host = await analysisHost(dataDirectory, input.signal);
  const workspaceKey = createHash("sha256").update(JSON.stringify(roots.map((root) => root.toLowerCase()).sort())).digest("hex").slice(0, 16);
  const writable = join(dataDirectory, `isolated-analysis-v${LSP_ANALYSIS_POLICY_VERSION}`, workspaceKey, "writable");
  const snapshotsDirectory = join(writable, "runs");
  await mkdir(writable, { recursive: true });
  await assertNoLinks(writable);
  // Set an account-private ACL before writing configuration or Maven credentials.
  // The native launcher refuses reparse points before changing this directory.
  await new Promise<void>((done, reject) => {
    const child = spawn(host, ["--prepare", writable], {
      windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
      ...(input.signal ? { signal: input.signal } : {})
    });
    let diagnostics = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { diagnostics = (diagnostics + chunk).slice(-4000); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? done() : reject(new Error(`无法准备隔离目录：${diagnostics}`)));
  });
  await mkdir(snapshotsDirectory, { recursive: true });
  const snapshot = await mkdtemp(join(snapshotsDirectory, "analysis-"));
  const work = join(snapshot, "work");
  const home = join(snapshot, "home");
  const cache = join(writable, "caches");
  const temp = join(snapshot, "tmp");
  const data = join(snapshot, "data");
  const dispose = async () => {
    // snapshot comes only from mkdtemp, and rm unlinks directory junctions rather
    // than following them. Never accept a cleanup path from the language server.
    if (dirname(snapshot) !== snapshotsDirectory) throw new Error("Invalid analysis cleanup path");
    await rm(snapshot, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 });
  };
  try {
    for (const directory of [work, home, temp, data, cache]) {
      await mkdir(directory, { recursive: true });
      await assertNoLinks(directory);
    }
    for (const document of input.documents) {
      input.signal?.throwIfAborted();
      if (!roots.some((root) => pathInside(root, document.file.absolutePath))) throw new Error("分析源码不在受保护的工程根目录中。");
    }
    const javaConfiguration = join(snapshot, "java-analysis.tsv");
    await writeFile(javaConfiguration, [snapshot, ...roots].join("\n"), "utf8");
    await writeFile(join(data, "gradle-init.gradle"), GRADLE_ANALYSIS_INIT, "utf8");
    // User Maven repository settings are read-only inputs; all downloaded
    // artifacts and lock files go to the account-private runtime cache.
    const userHome = process.env.USERPROFILE;
    if (userHome) {
      for (const name of ["settings.xml", "settings-security.xml"]) {
        const source = join(userHome, ".m2", name);
        if (await access(source).then(() => true, () => false)) {
          await mkdir(join(home, ".m2"), { recursive: true });
          await writeFile(join(home, ".m2", name), await readFile(source));
        }
      }
    }
    const workspaceSettings = join(resolve(input.workspaceRootPath), "settings.xml");
    if (input.documents.some(document => /\.java$/i.test(document.file.absolutePath)) &&
        await access(workspaceSettings).then(() => true, () => false)) {
      const settings = await readFile(workspaceSettings);
      if (/<settings(?:\s|>)/.test(settings.toString("utf8"))) {
        await mkdir(join(home, ".m2"), { recursive: true });
        await writeFile(join(home, ".m2", "settings.xml"), settings);
      }
    }
    input.signal?.throwIfAborted();
    const existingMavenRepository = userHome
      ? join(process.env.MAVEN_USER_HOME ?? join(userHome, ".m2"), "repository")
      : undefined;
    const reuseMavenRepository = existingMavenRepository &&
      await access(existingMavenRepository).then(() => true, () => false);
    const environment: Record<string, string> = {
      HOME: home, USERPROFILE: home,
      APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"),
      TEMP: temp, TMP: temp, TMPDIR: temp,
      GRADLE_USER_HOME: join(cache, "gradle"), MAVEN_USER_HOME: join(home, ".m2"),
      GITNEST_ANALYSIS_CONFIGURATION: javaConfiguration,
      CARGO_HOME: join(cache, "cargo"), CARGO_TARGET_DIR: join(data, "cargo-target"),
      GOCACHE: join(cache, "go-build"), GOMODCACHE: join(cache, "go-mod"),
      GOPATH: join(home, "go"), npm_config_cache: join(cache, "npm"),
      NUGET_PACKAGES: join(cache, "nuget"), DOTNET_CLI_HOME: home,
      DOTNET_CLI_USE_MSBUILD_SERVER: "false", DOTNET_CLI_DO_NOT_USE_MSBUILD_SERVER: "1",
      MSBUILDDISABLENODEREUSE: "1", UseSharedCompilation: "false",
      PYTHONPYCACHEPREFIX: join(data, "pycache"),
      JAVA_TOOL_OPTIONS: [
        process.env.JAVA_TOOL_OPTIONS,
        "-Djava.import.generatesMetadataFilesAtProjectRoot=false",
        `-Duser.home="${home}"`, `-Djava.io.tmpdir="${temp}"`,
        `-Dmaven.repo.local.head="${join(cache, "maven")}"`,
        ...(reuseMavenRepository ? [
          `-Dmaven.repo.local.tail="${existingMavenRepository}"`,
          "-Dmaven.repo.local.tail.ignoreAvailability=true"
        ] : [])
      ].filter(Boolean).join(" "),
      ...(process.env.RUSTUP_HOME || userHome
        ? { RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(userHome!, ".rustup") } : {})
    };
    for (const directory of [environment.APPDATA!, environment.LOCALAPPDATA!]) await mkdir(directory, { recursive: true });
    return {
      dataDirectory: data, workingDirectory: work, javaConfiguration,
      toolingDirectory: join(dataDirectory, "java-analysis-adapter"), environment,
      launch: (command, args) => ({
        command: host,
        args: [writable, work, String(process.pid), String(roots.length), ...roots, command, ...args]
      }),
      dispose
    };
  } catch (error) { await dispose(); throw error; }
}
