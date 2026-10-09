import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { GitError, type GitIgnoreClient, type GitIgnoreInput, type GitIgnorePlan, type GitReadOptions, type GitWriteOptions } from "@gitnest/git-core";
import { findGitExecutable } from "../environment/find-git-executable";
import { runProcess, type ProcessRequest, type ProcessResult } from "../process/git-process-runner";

export interface GitCliIgnoreClientOptions {
  executable?: string;
  runner?: (request: ProcessRequest) => Promise<ProcessResult>;
}
export class GitCliIgnoreClient implements GitIgnoreClient {
  #executable: string | undefined;
  constructor(readonly options: GitCliIgnoreClientOptions = {}) { this.#executable = options.executable; }
  async #run(path: string, args: string[], options: GitReadOptions, allowFailure = false) {
    this.#executable ??= await findGitExecutable(options.signal);
    return (this.options.runner ?? runProcess)({
      executable: this.#executable, cwd: path, args: ["-c", "core.quotepath=false", ...args],
      signal: options.signal, priority: options.priority, timeoutMs: options.timeoutMs ?? 30_000, allowFailure
    });
  }
  async inspect(worktreePath: string, input: GitIgnoreInput, options: GitReadOptions = {}): Promise<GitIgnorePlan> {
    return (await this.#inspect(worktreePath, input, options)).plan;
  }
  async #inspect(worktreePath: string, input: GitIgnoreInput, options: GitReadOptions) {
    validate(input);
    input = { path: input.path, scope: input.scope };
    cancelled(options);
    const root = await realpath(worktreePath);
    const top = (await this.#run(root, ["rev-parse", "--show-toplevel"], options)).stdout.trim();
    if (await realpath(top) !== root) invalid("只能在已登记的 Worktree 根目录添加忽略规则。");
    const target = await safeFile(root, input.path);
    const tracked = await this.#run(root, ["ls-files", "--cached", "-z", "--", `:(literal)${input.path}`], options);
    if (tracked.stdout.split("\0").includes(input.path)) invalid("只能忽略未跟踪文件；此操作不会取消文件跟踪。");
    const ignored = await this.#run(root, ["check-ignore", "--quiet", "--", input.path], options, true);
    if (ignored.exitCode === 0) invalid("此文件已被忽略，无需重复添加规则。");
    if (ignored.exitCode !== 1) throw new GitError("INVALID_REQUEST", "无法确认文件当前的忽略状态。");
    const untracked = await this.#run(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", `:(literal)${input.path}`], options);
    if (!untracked.stdout.split("\0").includes(input.path)) invalid("请选择当前 Worktree 中的未跟踪普通文件。");
    const ignoreFilePath = join(root, ".gitignore");
    const existing = await readIgnore(ignoreFilePath);
    const nested: Array<[string, string]> = [];
    let parent = dirname(input.path).replaceAll("\\", "/");
    while (parent !== ".") {
      const nestedPath = `${parent}/.gitignore`;
      const value = await readIgnore(join(root, nestedPath));
      nested.push([nestedPath, hash(value.bytes)]);
      parent = dirname(parent).replaceAll("\\", "/");
    }
    const rule = buildRule(input);
    const warnings = [
      "只向当前 Worktree 根目录的 .gitignore 追加规则；文件不会删除，也不会自动暂存 .gitignore。",
      "已跟踪文件不受忽略规则影响。子目录中的 .gitignore 可覆盖根目录规则；此预览不统计最终匹配数量。"
    ];
    if (nested.some(([, contentHash]) => contentHash !== hash(Buffer.alloc(0)))) warnings.push("所选文件的父目录中存在独立 .gitignore，请注意其中的取消忽略规则。");
    if (input.scope === "extension") warnings.push("同扩展名规则作用于各层目录中的文件和同名后缀目录，目录中的内容也可能被忽略。");
    const fingerprint = hash(JSON.stringify({
      root, input, rule, exists: existing.exists, content: hash(existing.bytes),
      ignoreIdentity: existing.identity, targetIdentity: target, nested
    }));
    const plan: GitIgnorePlan = {
      ...input, ignoreFilePath, rule, fingerprint, warnings,
      summary: input.scope === "file" ? `忽略此文件：${input.path}`
        : input.scope === "directory" ? `忽略此目录及其未跟踪内容：${dirname(input.path).replaceAll("\\", "/")}/`
          : `忽略当前 Worktree 各层目录中的 ${extname(input.path)} 后缀`
    };
    return { plan, existing };
  }
  async execute(worktreePath: string, plan: GitIgnorePlan, options: GitWriteOptions = {}): Promise<void> {
    const { plan: current, existing: before } = await this.#inspect(worktreePath, plan, options);
    if (current.fingerprint !== plan.fingerprint || current.rule !== plan.rule || current.ignoreFilePath !== plan.ignoreFilePath) throw changed();
    cancelled(options);
    // Existing files are opened without O_CREAT; O_APPEND never overwrites concurrent edits.
    // Missing files use exclusive creation, so a newly created user file is left untouched.
    const handle = await open(current.ignoreFilePath, before.exists
      ? constants.O_RDWR | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0)
      : "wx+").catch(error => { if (["EEXIST", "ENOENT", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")) throw changed(); throw error; });
    try {
      const stat = await handle.stat();
      const actual = await handle.readFile();
      const linked = await lstat(current.ignoreFilePath);
      if (!stat.isFile() || stat.nlink !== 1 || linked.isSymbolicLink() || identity(stat) !== identity(linked)
        || (before.exists && (identity(stat) !== before.identity || !actual.equals(before.bytes)))) throw changed();
      cancelled(options);
      const text = decode(actual);
      const eol = text.includes("\r\n") ? "\r\n" : "\n";
      const separator = actual.length && !text.endsWith("\n") && text !== "\uFEFF" ? eol : "";
      await handle.writeFile(Buffer.from(`${separator}${current.rule}${eol}`, "utf8"));
    } finally { await handle.close(); }
  }
}
function validate(input: GitIgnoreInput): void {
  if (!input || typeof input.path !== "string" || !input.path || input.path.length > 4096 || /[\0\r\n\\:]/.test(input.path)
    || isAbsolute(input.path) || input.path.split("/").some(part => !part || part === "." || part === ".." || /^\.git[ .]*$/i.test(part))) invalid("请选择仓库内安全的相对文件路径。");
  if (!["file", "directory", "extension"].includes(input.scope)) invalid("不支持此忽略范围。");
  if (input.path === ".gitignore") invalid("不能通过此入口忽略根目录的 .gitignore 文件。");
  if (input.scope === "directory" && dirname(input.path) === ".") invalid("根目录文件没有可单独忽略的父目录。");
  if (input.scope === "extension" && (!extname(input.path) || extname(input.path) === ".")) invalid("此文件没有可忽略的扩展名。");
}
function literal(value: string) { return value.replace(/[\\*?[\] !#]/g, character => `\\${character}`); }
function buildRule(input: GitIgnoreInput) {
  if (input.scope === "extension") return `*${literal(extname(basename(input.path)))}`;
  if (input.scope === "directory") return `/${literal(dirname(input.path).replaceAll("\\", "/"))}/`;
  return `/${literal(input.path)}`;
}
async function safeFile(root: string, path: string) {
  let current = root;
  const parts = path.split("/");
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]!);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) invalid("只能忽略真实目录下的未跟踪普通文件，不能使用符号链接。");
  }
  const resolved = await realpath(current);
  const inside = relative(root, resolved);
  if (isAbsolute(inside) || inside === ".." || inside.startsWith(`..\\`) || inside.startsWith("../") || resolve(root, inside) !== resolved) invalid("文件路径越出了当前 Worktree。");
  return identity(await lstat(current));
}
async function readIgnore(path: string) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) invalid(".gitignore 必须是普通文件，不能是符号链接或硬链接。");
    if (stat.size > 4 * 1024 * 1024) invalid(".gitignore 大于 4 MiB，请手动编辑。");
    const bytes = await readFile(path);
    decode(bytes);
    return { exists: true, bytes, identity: identity(stat) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, bytes: Buffer.alloc(0), identity: null };
    throw error;
  }
}
function decode(bytes: Buffer) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const text = bytes.toString("utf8");
    if (text.includes("\0")) invalid(".gitignore 必须使用 UTF-8 文本编码。");
    return text;
  } catch { return invalid(".gitignore 必须使用 UTF-8 文本编码。"); }
}
function identity(stat: { dev: number; ino: number }) { return `${stat.dev}:${stat.ino}`; }
function hash(value: string | Buffer) { return createHash("sha256").update(value).digest("hex"); }
function changed() { return new GitError("PREFLIGHT_CHANGED", "文件或 .gitignore 在预检后已变化，请重新检查。"); }
function invalid(message: string): never { throw new GitError("INVALID_REQUEST", message); }
function cancelled(options: GitReadOptions) { if (options.signal?.aborted) throw new GitError("COMMAND_CANCELLED", "忽略规则操作已取消。"); }
