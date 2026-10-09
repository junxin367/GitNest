import {
  GitError,
  type FileHistoryClient,
  type FileHistoryDiffResult,
  type FileHistoryEntry,
  type FileHistoryQuery,
  type FileHistoryResult,
  type GitReadOptions
} from "@gitnest/git-core";
import { findGitExecutable } from "../environment/find-git-executable";
import { runProcess, type ProcessRequest, type ProcessResult } from "../process/git-process-runner";

const HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const OUTPUT_LIMIT = 8 * 1024 * 1024;

export interface GitCliFileHistoryClientOptions {
  executable?: string;
  runner?: (request: ProcessRequest) => Promise<ProcessResult>;
}

/** File history reads only committed objects; dirty working files never become synthetic commits. */
export class GitCliFileHistoryClient implements FileHistoryClient {
  readonly #options: GitCliFileHistoryClientOptions;
  #executable: string | undefined;
  constructor(options: GitCliFileHistoryClientOptions = {}) {
    this.#options = options;
    this.#executable = options.executable;
  }
  async #request(repositoryPath: string, args: string[], options: GitReadOptions, allowFailure = false): Promise<ProcessRequest> {
    const executable = this.#executable ?? await findGitExecutable(options.signal);
    this.#executable = executable;
    return {
      executable,
      args: ["--no-pager", "--literal-pathspecs", "-c", "core.quotepath=false", "-c", "color.ui=false", ...args],
      cwd: repositoryPath,
      signal: options.signal,
      priority: options.priority ?? "interactive",
      timeoutMs: options.timeoutMs ?? 30_000,
      outputLimitBytes: OUTPUT_LIMIT,
      allowFailure,
      environment: { GIT_NO_LAZY_FETCH: "1" }
    };
  }
  async #run(repositoryPath: string, args: string[], options: GitReadOptions, allowFailure = false) {
    const result = await (this.#options.runner ?? runProcess)(await this.#request(repositoryPath, args, options, allowFailure));
    if (result.outputTruncated) throw new GitError("OUTPUT_LIMIT_EXCEEDED", "文件历史输出超过限制。");
    return result;
  }
  async #revision(repositoryPath: string, revision: string | undefined, options: GitReadOptions) {
    if (revision !== undefined && !HASH.test(revision)) invalid("历史版本必须是完整提交 ID。");
    const result = await this.#run(repositoryPath, ["rev-parse", "--verify", "--end-of-options", `${revision ?? "HEAD"}^{commit}`], options, true);
    if (result.exitCode !== 0) {
      if (revision) invalid("历史提交已不存在，请重新加载文件历史。");
      // An unborn HEAD is an empty history; other repository failures must remain errors.
      const head = await this.#run(repositoryPath, ["symbolic-ref", "--quiet", "HEAD"], options, true);
      if (head.exitCode === 0) {
        const refs = await this.#run(repositoryPath, ["show-ref", "--verify", "--quiet", head.stdout.trim()], options, true);
        if (refs.exitCode === 1) return null;
      }
      throw new GitError("COMMAND_FAILED", "无法解析仓库 HEAD，请刷新仓库后重试。");
    }
    const hash = result.stdout.trim();
    if (!HASH.test(hash)) throw new GitError("INVALID_GIT_OUTPUT", "Git 返回了无效的提交 ID。");
    return hash;
  }
  async history(repositoryPath: string, query: FileHistoryQuery, options: GitReadOptions = {}): Promise<FileHistoryResult> {
    validatePath(query.path);
    if (query.originalPath !== undefined) validatePath(query.originalPath);
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (offset > 0 && !query.revision)) invalid("文件历史分页参数无效，请从第一页重新加载。");
    const path = query.originalPath ?? query.path;
    const revision = await this.#revision(repositoryPath, query.revision, options);
    const base = { revision, path, entries: [], nextOffset: null };
    if (!revision) return { ...base, status: "empty", message: "仓库尚无提交。" };
    try {
      const result = await this.#run(repositoryPath, [
        "log", "--follow", "--diff-merges=first-parent", "--find-renames", "--no-ext-diff", "--no-textconv", "--no-show-signature",
        "--format=%H%x00%an%x00%aI%x00%s", "--name-status", "-z",
        // --follow processes renames while walking; --skip can skip unrelated
        // commits before follow's path filtering. Read a bounded prefix instead.
        `--max-count=${offset + limit + 1}`, revision, "--", path
      ], options);
      const entries = parseHistory(result.stdout);
      return {
        revision, path, entries: entries.slice(offset, offset + limit),
        nextOffset: entries.length > offset + limit ? offset + limit : null,
        status: entries.length > offset ? "ok" : "empty",
        ...(entries.length <= offset ? { message: "此路径在所选版本之前没有更多已提交历史。" } : {})
      };
    } catch (error) {
      if (isOutputLimit(error)) return { ...base, status: "too-large", message: "历史输出超过 8 MiB 限制，本页未加载；请缩小每页数量。" };
      throw error;
    }
  }
  async diff(repositoryPath: string, query: { path: string; previousPath?: string; commitHash: string }, options: GitReadOptions = {}): Promise<FileHistoryDiffResult> {
    validatePath(query.path);
    if (query.previousPath !== undefined) validatePath(query.previousPath);
    requireHash(query.commitHash);
    const commitHash = (await this.#revision(repositoryPath, query.commitHash, options))!;
    const base = { commitHash, path: query.path, patch: "" };
    try {
      const result = await this.#run(repositoryPath, [
        "show", "--format=", "--root", "--diff-merges=first-parent", "--find-renames", "--no-ext-diff", "--no-textconv", "--no-show-signature",
        commitHash, "--", ...new Set([query.path, ...(query.previousPath ? [query.previousPath] : [])])
      ], options);
      return { ...base, patch: result.stdout, status: result.stdout ? "ok" : "empty" };
    } catch (error) {
      if (isOutputLimit(error)) return { ...base, status: "too-large", message: "提交差异超过 8 MiB 限制，未展示不完整结果。" };
      throw error;
    }
  }
}

function invalid(message: string): never { throw new GitError("INVALID_REQUEST", message); }
function requireHash(value: string) { if (typeof value !== "string" || !HASH.test(value)) invalid("请选择完整的提交 ID。"); }
function validatePath(path: string) {
  if (typeof path !== "string" || !path || path.length > 4096 || /[\x00-\x1f\\]/.test(path) || path.startsWith("/") || /^[a-z]:/i.test(path) || path.split("/").some((part) => !part || part === "." || part === ".." || /^\.git$/i.test(part))) invalid("请选择仓库内的文件路径，不能查询 Git 元数据。");
}
function isOutputLimit(error: unknown) { return error instanceof GitError && error.code === "OUTPUT_LIMIT_EXCEEDED"; }

function parseHistory(output: string): FileHistoryEntry[] {
  const tokens = output.split("\0");
  const entries: FileHistoryEntry[] = [];
  let index = 0;
  while (index < tokens.length) {
    while (index < tokens.length && !tokens[index]?.trim()) index++;
    if (index === tokens.length) break;
    const hash = tokens[index++]!;
    const authorName = tokens[index++];
    const authoredAt = tokens[index++];
    const subject = tokens[index++];
    if (!HASH.test(hash) || authorName === undefined || authoredAt === undefined || subject === undefined) throw new GitError("INVALID_GIT_OUTPUT", "无法解析文件历史。");
    while (index < tokens.length) {
      const status = tokens[index]!.replace(/^\n+/, "");
      if (!status) { index++; continue; }
      if (HASH.test(status)) break;
      index++;
      if (!/^[ACDMRTUXB][0-9]*$/.test(status)) throw new GitError("INVALID_GIT_OUTPUT", "无法解析文件变更状态。");
      const first = tokens[index++];
      const renamed = status.startsWith("R") || status.startsWith("C");
      const path = renamed ? tokens[index++] : first;
      if (!first || !path) throw new GitError("INVALID_GIT_OUTPUT", "无法解析历史文件路径。");
      entries.push({ hash, authorName, authoredAt, subject, path, status, ...(renamed ? { previousPath: first } : {}) });
    }
  }
  return entries;
}
