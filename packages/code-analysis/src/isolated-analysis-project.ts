import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access, lstat, mkdir, mkdtemp, readFile, readdir,
  realpath, rename, rm, writeFile
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WINDOWS_ANALYSIS_HOST_SOURCE } from "./windows-analysis-host-source";

interface PathPair { original: string; copy: string }
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
  environment: Record<string, string>;
  toCopy(path: string): string;
  mapMessage(message: unknown, direction: "toCopy" | "toOriginal"): unknown;
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

export class AnalysisPathMap {
  constructor(
    readonly pairs: readonly PathPair[],
    readonly sourceRoots?: readonly string[],
    readonly workspaceRoot?: string
  ) {}

  path(path: string, direction: "toCopy" | "toOriginal"): string {
    if (direction === "toCopy" && this.sourceRoots &&
        resolve(path) !== this.workspaceRoot &&
        !this.sourceRoots.some((root) => pathInside(root, path))) return path;
    for (const pair of this.pairs) {
      const from = direction === "toCopy" ? pair.original : pair.copy;
      const to = direction === "toCopy" ? pair.copy : pair.original;
      if (pathInside(from, path)) return join(to, relative(from, path));
    }
    return path;
  }

  message(value: unknown, direction: "toCopy" | "toOriginal", key = ""): unknown {
    // Text, Markdown and opaque server data are never rewritten. In particular
    // a CallHierarchyItem's data must survive the client round trip byte-for-byte.
    if (["text", "newText", "documentation", "contents", "detail", "data"].includes(key)) return value;
    if (typeof value === "string") {
      if (/^(?:uri|rootUri|targetUri|oldUri|newUri|scopeUri|documentUri)$/i.test(key) && value.startsWith("file:")) {
        try {
          const path = fileURLToPath(value);
          const mapped = this.path(path, direction);
          return mapped === path ? value : pathToFileURL(mapped).toString();
        } catch { return value; }
      }
      if (/^(?:rootPath|filePath|path)$/i.test(key) && isAbsolute(value)) return this.path(value, direction);
      return value;
    }
    if (Array.isArray(value)) return value.map((entry) => this.message(entry, direction, key));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, this.message(entry, direction, name)]));
    }
    return value;
  }
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

function pathPairs(paths: readonly string[], directory: string): PathPair[] {
  const volumes = new Map<string, string[]>();
  for (const path of paths) {
    const volume = parse(path).root.toLowerCase();
    const group = volumes.get(volume) ?? [];
    group.push(path);
    volumes.set(volume, group);
  }
  return [...volumes.values()].map((group, index) => {
    let common = group[0]!;
    for (const path of group) while (!pathInside(common, path)) common = dirname(common);
    return { original: common, copy: join(directory, `root-${index}`) };
  });
}

/**
 * Capture actual working-tree files, never a Git checkout or hard links.
 * Each import gets a fresh copy. In-flight builds cannot race a subsequent sync,
 * and stale generated files cannot silently survive a deleted/renamed source.
 */
export async function prepareIsolatedAnalysisProject(input: AnalysisProjectInput): Promise<IsolatedAnalysisProject> {
  if (process.platform !== "win32") throw new Error("当前平台尚未提供工程写入隔离，已保留内置分析。");
  input.signal?.throwIfAborted();
  const roots = uniqueRoots(input.workspaceFolders.length ? input.workspaceFolders : [input.workspaceRootPath]);
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
  input.onProgress?.("正在创建工程隔离副本");
  const host = await analysisHost(dataDirectory, input.signal);
  const workspaceKey = createHash("sha256").update(JSON.stringify(roots.map((root) => root.toLowerCase()).sort())).digest("hex").slice(0, 16);
  const writable = join(dataDirectory, "isolated-projects-v2", workspaceKey, "writable");
  const snapshotsDirectory = join(writable, "runs");
  await mkdir(writable, { recursive: true });
  await assertNoLinks(writable);
  // Set an account-private ACL before copying source or Maven credentials.
  // The native launcher refuses reparse points before changing this directory.
  await new Promise<void>((done, reject) => {
    const child = spawn(host, ["--prepare", writable], {
      windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
      ...(input.signal ? { signal: input.signal } : {})
    });
    let diagnostics = "";
    child.stderr.on("data", (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-4000); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? done() : reject(new Error(`无法准备隔离目录：${diagnostics}`)));
  });
  await mkdir(snapshotsDirectory, { recursive: true });
  const snapshot = await mkdtemp(join(snapshotsDirectory, "project-"));
  const project = join(snapshot, "project");
  const home = join(snapshot, "home");
  const cache = join(writable, "caches");
  const temp = join(snapshot, "tmp");
  const data = join(snapshot, "data");
  const sourceRoots = [...roots];
  const map = new AnalysisPathMap(pathPairs(
    [...roots, resolve(input.workspaceRootPath)], project
  ), sourceRoots, resolve(input.workspaceRootPath));
  const protectedInputs = new Set(roots);
  // Limits reject the snapshot explicitly; missing inputs must not look complete.
  let count = 0;
  let bytes = 0;
  const copyEntry = async (source: string, target: string): Promise<void> => {
    input.signal?.throwIfAborted();
    const info = await lstat(source);
    if (info.isSymbolicLink()) throw new Error(`工程副本暂不支持符号链接或目录联接：${source}`);
    if (info.isDirectory()) {
      await mkdir(target, { recursive: true });
      for (const entry of await readdir(source)) {
        // Git administrative data is not an input to language resolution.
        if (entry.toLowerCase() === ".git") continue;
        await copyEntry(join(source, entry), join(target, entry));
      }
    } else if (info.isFile()) {
      count += 1; bytes += info.size;
      if (count > 250_000 || bytes > 4 * 1024 ** 3) throw new Error("工程副本超过 250000 个文件或 4 GiB，外部语义分析未启动。");
      await mkdir(dirname(target), { recursive: true });
      // Create an independent inode with inherited sandbox permissions. Windows
      // CopyFile can preserve security attributes from the original file.
      await pipeline(createReadStream(source), createWriteStream(target, { flags: "wx" }), {
        ...(input.signal ? { signal: input.signal } : {})
      });
      const after = await lstat(source);
      if (info.size !== after.size || info.mtimeMs !== after.mtimeMs || info.ino !== after.ino) {
        throw new Error(`创建副本时文件发生变化，请重试：${source}`);
      }
      if (count % 500 === 0) input.onProgress?.(`正在复制工程文件（${count} 个）`);
    } else throw new Error(`工程副本不支持此文件类型：${source}`);
  };
  const dispose = async () => {
    // snapshot comes only from mkdtemp, and rm unlinks directory junctions rather
    // than following them. Never accept a cleanup path from the language server.
    if (dirname(snapshot) !== snapshotsDirectory) throw new Error("Invalid analysis cleanup path");
    await rm(snapshot, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 });
  };
  try {
    for (const directory of [project, home, temp, data, cache]) {
      await mkdir(directory, { recursive: true });
      await assertNoLinks(directory);
    }
    for (const root of roots) await copyEntry(root, map.path(root, "toCopy"));
    // Preserve ancestor build context when only a module is selected.
    const buildInputs = /^(?:pom\.xml|(?:settings|build)\.gradle(?:\.kts)?|gradle\.properties|gradlew(?:\.bat)?|mvnw(?:\.cmd)?|\.mvn|gradle|Directory\.Build\.(?:props|targets)|Directory\.Packages\.props|NuGet\.Config|global\.json|package\.json|tsconfig.*\.json|go\.work(?:\.sum)?)$/i;
    const workspace = resolve(input.workspaceRootPath);
    const visited = new Set<string>();
    for (const root of roots) {
      for (let ancestor = dirname(root); pathInside(workspace, ancestor) && !roots.some((item) => pathInside(item, ancestor)); ancestor = dirname(ancestor)) {
        if (visited.has(ancestor)) break;
        visited.add(ancestor);
        for (const name of await readdir(ancestor)) {
          if (buildInputs.test(name)) {
            const source = join(ancestor, name);
            sourceRoots.push(source);
            protectedInputs.add(source);
            await copyEntry(source, map.path(source, "toCopy"));
          }
        }
        if (ancestor === dirname(ancestor)) break;
      }
    }
    await mkdir(map.path(workspace, "toCopy"), { recursive: true });
    for (const document of input.documents) {
      input.signal?.throwIfAborted();
      if (!roots.some((root) => pathInside(root, document.file.absolutePath))) throw new Error("分析源码不在已隔离的工程根目录中。");
      const target = map.path(document.file.absolutePath, "toCopy");
      await mkdir(dirname(target), { recursive: true });
      // Use the same verified source snapshot as the built-in parser.
      await writeFile(target, document.content, "utf8");
    }
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
    input.signal?.throwIfAborted();
    const environment: Record<string, string> = {
      HOME: home, USERPROFILE: home,
      APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"),
      TEMP: temp, TMP: temp, TMPDIR: temp,
      GRADLE_USER_HOME: join(cache, "gradle"), MAVEN_USER_HOME: join(home, ".m2"),
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
        `-Dmaven.repo.local="${join(cache, "maven")}"`
      ].filter(Boolean).join(" "),
      ...(process.env.RUSTUP_HOME || userHome
        ? { RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(userHome!, ".rustup") } : {})
    };
    for (const directory of [environment.APPDATA!, environment.LOCALAPPDATA!]) await mkdir(directory, { recursive: true });
    return {
      dataDirectory: data, environment,
      toCopy: (path) => map.path(path, "toCopy"),
      mapMessage: (message, direction) => map.message(message, direction),
      launch: (command, args, cwd) => ({
        command: host,
        args: [writable, map.path(cwd, "toCopy"), String(process.pid), String(protectedInputs.size), ...protectedInputs,
          map.path(command, "toCopy"),
          ...args.map((arg) => isAbsolute(arg) ? map.path(arg, "toCopy") : arg)]
      }),
      dispose
    };
  } catch (error) { await dispose(); throw error; }
}
