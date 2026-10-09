import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  GitError,
  type GitReadOptions,
  type GitWorkflowAction,
  type GitWorkflowClient,
  type GitWorkflowInspectOptions,
  type GitWorkflowOperation,
  type GitWorkflowState,
  type GitWriteOptions
} from "@gitnest/git-core";
import { findGitExecutable } from "../environment/find-git-executable";
import { runProcess, type ProcessRequest, type ProcessResult } from "../process/git-process-runner";

export interface GitCliWorkflowClientOptions {
  executable?: string;
  runner?: (request: ProcessRequest) => Promise<ProcessResult>;
}

/** All writes use argument arrays, literal pathspecs and the common cancellable runner. */
export class GitCliWorkflowClient implements GitWorkflowClient {
  readonly #options: GitCliWorkflowClientOptions;
  #executablePath: string | undefined;
  constructor(options: GitCliWorkflowClientOptions = {}) {
    this.#options = options;
    this.#executablePath = options.executable;
  }

  async #run(path: string, args: string[], options: GitReadOptions = {}, write = false, allowFailure = false) {
    const executable = this.#executablePath ?? await findGitExecutable(options.signal);
    this.#executablePath = executable;
    return (this.#options.runner ?? runProcess)({
      executable,
      args: ["-c", "core.quotepath=false", ...args],
      cwd: path,
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? (write ? 120_000 : 30_000),
      priority: options.priority,
      writeIntent: write,
      allowFailure,
      environment: { GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true", GIT_MERGE_AUTOEDIT: "no" }
    });
  }

  async inspect(path: string, options: GitWorkflowInspectOptions = {}): Promise<GitWorkflowState> {
    const includeFingerprint = options.includeFingerprint !== false;
    const headResult = await this.#run(path, ["rev-parse", "--verify", "HEAD"], options, false, true);
    const head = headResult.exitCode === 0 ? headResult.stdout.trim() : null;
    const gitDir = (await this.#run(path, ["rev-parse", "--absolute-git-dir"], options)).stdout.trim();
    const [branchResult, status, index, diff, staged, untracked, metadata, headInfo, remotes] = await Promise.all([
      this.#run(path, ["symbolic-ref", "--quiet", "--short", "HEAD"], options, false, true),
      this.#run(path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], options),
      this.#run(path, ["ls-files", includeFingerprint ? "--stage" : "--unmerged", "-z"], options),
      includeFingerprint ? this.#run(path, ["diff", "--no-ext-diff", "--no-textconv", "--binary", "--no-renames"], options) : undefined,
      includeFingerprint ? this.#run(path, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--binary", "--no-renames"], options) : undefined,
      this.#run(path, ["ls-files", "--others", "--exclude-standard", "-z"], options),
      readOperationMetadata(gitDir),
      head ? this.#run(path, ["show", "-s", "--format=%P%n%B", head], options) : undefined,
      head ? this.#run(path, ["branch", "-r", "--contains", head, "--format=%(refname:short)"], options) : undefined
    ]);
    const changedPaths = parseStatusPaths(status.stdout);
    if ("rebase-apply/applying" in metadata) {
      throw new GitError("INVALID_REQUEST", "检测到进行中的 git am。请在终端完成 git am --continue 或 git am --abort 后再使用这些操作。");
    }
    const conflictedPaths = [...new Set(index.stdout.split("\0").filter((entry) =>
      /^[0-7]+ [a-f0-9]+ [123]\t/.test(entry)
    ).map((entry) => entry.slice(entry.indexOf("\t") + 1)))];
    const untrackedPaths = untracked.stdout.split("\0").filter(Boolean);
    const hash = createHash("sha256");
    for (const text of [head ?? "", branchResult.stdout, status.stdout, index.stdout, diff?.stdout ?? "", staged?.stdout ?? "", JSON.stringify(metadata), remotes?.stdout ?? ""]) {
      hash.update(String(Buffer.byteLength(text))).update(":").update(text);
    }
    // Status alone misses edits to an already-dirty file. Hash untracked bytes too.
    for (const entry of includeFingerprint ? untrackedPaths : []) {
      if (options.signal?.aborted) throw new GitError("COMMAND_CANCELLED", "Git workflow inspection was cancelled.");
      hash.update(entry).update("\0");
      const filename = join(path, entry);
      const info = await lstat(filename);
      if (info.isSymbolicLink()) {
        hash.update(await readlink(filename));
      } else if (info.isFile()) {
        try {
          for await (const chunk of createReadStream(filename, { signal: options.signal })) hash.update(chunk as Buffer);
        } catch (error) {
          if (options.signal?.aborted) throw new GitError("COMMAND_CANCELLED", "Git workflow inspection was cancelled.");
          throw error;
        }
      } else {
        // Untracked nested repositories/directories cannot be represented safely as files.
        hash.update(String(info.mtimeMs));
      }
      hash.update("\0");
    }
    const [parents = "", ...message] = (headInfo?.stdout ?? "").split("\n");
    const operation = detectOperation(metadata);
    const replayHash = currentReplayHash(operation, metadata);
    let currentReplay: GitWorkflowState["currentReplay"] = null;
    if (replayHash) {
      const [replayInfo, replayFiles] = await Promise.all([
        this.#run(path, ["show", "-s", "--format=%s", replayHash], options),
        this.#run(path, ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "-z", replayHash], options)
      ]);
      const affected = new Set(replayFiles.stdout.split("\0").filter(Boolean));
      const untrackedSet = new Set(untrackedPaths);
      const trackedPaths = changedPaths.filter(entry => !untrackedSet.has(entry));
      const outsideReplay = trackedPaths.some(entry => !affected.has(entry));
      const blockedReason = untrackedPaths.length
        ? "请先移走或保存未跟踪文件，再跳过或保留空提交。"
        : outsideReplay ? "存在当前提交范围之外的修改，请先保存这些修改，再跳过当前提交。" : undefined;
      const isEmpty = conflictedPaths.length === 0 && trackedPaths.length === 0;
      currentReplay = {
        commitHash: replayHash, subject: replayInfo.stdout.trim(),
        isEmpty, canSkip: !blockedReason,
        canKeepEmpty: isEmpty && !blockedReason && !("rebase-apply/" in metadata),
        ...(blockedReason ? { blockedReason } : {})
      };
    }
    return {
      head,
      branch: branchResult.exitCode === 0 ? branchResult.stdout.trim() : null,
      headMessage: message.join("\n").trimEnd(),
      parentCount: parents.trim() ? parents.trim().split(/\s+/).length : 0,
      operation,
      currentReplay,
      conflictedPaths,
      changedPaths,
      hasStagedChanges: hasStagedStatus(status.stdout),
      hasUntrackedFiles: untrackedPaths.length > 0,
      untrackedPaths,
      partialStashBlockedPaths: partialStashBlockedPaths(status.stdout),
      remoteBranchesContainingHead: remotes?.stdout.trim().split("\n").filter(Boolean) ?? [],
      fingerprint: includeFingerprint ? hash.digest("hex") : ""
    };
  }

  async validateCommit(path: string, hash: string, options: GitReadOptions = {}): Promise<void> {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(hash)) throw new GitError("INVALID_REQUEST", "请选择完整的提交 ID。");
    const result = await this.#run(path, ["show", "-s", "--format=%H%n%P", `${hash}^{commit}`], options);
    const [resolved = "", parents = ""] = result.stdout.trim().split("\n");
    if (resolved.toLowerCase() !== hash.toLowerCase() || parents.trim().split(/\s+/).filter(Boolean).length > 1) {
      throw new GitError("INVALID_REQUEST", "此操作需要普通提交；合并提交需要明确指定主线，暂不支持。");
    }
  }

  async execute(path: string, action: GitWorkflowAction, options: GitWriteOptions = {}): Promise<void> {
    let args: string[];
    switch (action.type) {
      case "create-stash":
        if (action.paths?.length) {
          // Git's path-limited stash validates against the current index, not
          // HEAD. A staged deletion/rename source is absent from that index.
          // With -u Git can create a stash and only then fail during cleanup.
          // Reject before the write; do not repair with a second reset/restore.
          const status = await this.#run(path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], options);
          const blocked = new Set(partialStashBlockedPaths(status.stdout));
          if (action.paths.some((entry) => blocked.has(entry))) {
            throw new GitError("INVALID_REQUEST", "所选文件包含已从暂存区移除的路径（删除或重命名来源），Git 无法安全局部储藏。请在储藏面板右键选择“创建储藏”，保存全部修改。");
          }
        }
        args = ["stash", "push", ...(action.includeUntracked ? ["--include-untracked"] : []),
          ...(action.message ? ["--message", action.message] : []), "--", ...(action.paths ?? []).map(literalPath)];
        break;
      case "amend": args = ["commit", "--amend", "--message", action.message]; break;
      case "undo-commit": args = ["reset", `--${action.mode}`, "HEAD^"]; break;
      case "cherry-pick": args = ["cherry-pick", "--no-edit", action.commitHash]; break;
      case "revert": args = ["revert", "--no-edit", action.commitHash]; break;
      case "mark-resolved": args = ["add", "-A", "--", ...action.paths.map(literalPath)]; break;
      case "continue":
      case "skip":
      case "keep-empty":
      case "abort": {
        const state = await this.inspect(path, { ...options, includeFingerprint: false });
        if (!state.operation) throw new GitError("INVALID_REQUEST", "没有进行中的 Git 操作。");
        if (action.type === "continue" && state.currentReplay?.isEmpty) {
          throw new GitError("INVALID_REQUEST", "当前提交已没有文件变更。请选择“跳过当前提交”或“保留空提交”，不要重复继续。");
        }
        if (action.type === "skip" && !state.currentReplay?.canSkip) {
          throw new GitError("INVALID_REQUEST", state.currentReplay?.blockedReason ?? "当前状态没有可安全跳过的提交；Merge 不支持跳过。");
        }
        if (action.type === "keep-empty") {
          if (!state.currentReplay?.canKeepEmpty || state.conflictedPaths.length || state.hasStagedChanges || state.changedPaths.length) {
            throw new GitError("INVALID_REQUEST", state.currentReplay?.blockedReason ?? "只有当前重放提交已无文件变更时，才能保留空提交。");
          }
          // Reuse the original message/author/date for replay, without persisting
          // conflict comments. Revert has its own generated message/current author.
          await this.#run(path, ["commit", "--allow-empty", "--no-edit",
            ...(state.operation === "revert" ? ["--cleanup=strip"]
              : ["--reuse-message", state.currentReplay.commitHash])], options, true);
          const after = await this.inspect(path, { ...options, includeFingerprint: false });
          // A single cherry-pick/revert ends at commit. Sequences and rebase continue.
          if (after.operation === state.operation) await this.#run(path, [state.operation, "--continue"], options, true);
          return;
        }
        args = [state.operation, `--${action.type}`];
        break;
      }
    }
    const result = await this.#run(path, args, options, true);
    if (action.type === "create-stash" && result.stdout.includes("No local changes to save")) {
      throw new GitError("INVALID_REQUEST", "没有可储藏的修改；子模块内部修改需要在子模块中单独保存。");
    }
  }
}

function parseStatusPaths(raw: string): string[] {
  const entries = raw.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? "";
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) {
      const source = entries[++i];
      if (source) paths.push(source);
    }
  }
  return [...new Set(paths)];
}

function partialStashBlockedPaths(raw: string): string[] {
  const entries = raw.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index] ?? "";
    if (entry.length < 4) continue;
    if (entry[0] === "D") paths.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) {
      const source = entries[++index];
      if (entry[0] === "R" && source) paths.push(source);
    }
  }
  return [...new Set(paths)];
}

function hasStagedStatus(raw: string): boolean {
  const entries = raw.split("\0");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? "";
    if (entry.length < 4) continue;
    if (entry[0] !== " " && entry[0] !== "?" && entry[0] !== "!") return true;
    if (/[RC]/.test(entry.slice(0, 2))) i++;
  }
  return false;
}

// Do not set global --literal-pathspecs: Git forwards it to stash's internal
// cleanup, which can leave untracked files behind despite a successful push.
function literalPath(path: string): string { return `:(literal)${path}`; }

async function readOperationMetadata(gitDir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of ["MERGE_HEAD", "MERGE_MSG", "MERGE_AUTOSTASH", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD", "ORIG_HEAD", "rebase-merge", "rebase-apply", "sequencer"]) {
    const path = join(gitDir, name);
    try {
      const info = await lstat(path);
      if (info.isDirectory()) {
        result[`${name}/`] = "";
        for (const child of (await readdir(path)).sort()) {
          if ((await lstat(join(path, child))).isFile()) result[`${name}/${child}`] = await readFile(join(path, child), "utf8");
        }
      } else result[name] = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return result;
}

function currentReplayHash(operation: GitWorkflowOperation | null, metadata: Record<string, string>): string | null {
  let value: string | undefined;
  if (operation === "cherry-pick") value = metadata.CHERRY_PICK_HEAD;
  if (operation === "revert") value = metadata.REVERT_HEAD;
  if (operation === "rebase") {
    if ("rebase-apply/" in metadata) value = metadata["rebase-apply/original-commit"];
    else {
      // MERGE_MSG is removed by a manual commit. Do not offer a duplicate empty
      // commit or discard an interactive edit/exec/squash stop as an empty pick.
      const last = metadata["rebase-merge/done"]?.trim().split("\n").at(-1) ?? "";
      if ("MERGE_MSG" in metadata && !("rebase-merge/amend" in metadata) && /^(pick|p|reword|r) /.test(last)) {
        value = metadata["rebase-merge/stopped-sha"];
      }
    }
  }
  const hash = value?.trim();
  return hash && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(hash) ? hash : null;
}

function detectOperation(metadata: Record<string, string>): GitWorkflowOperation | null {
  if ("rebase-merge/" in metadata || "rebase-apply/" in metadata) return "rebase";
  if ("MERGE_HEAD" in metadata) return "merge";
  if ("CHERRY_PICK_HEAD" in metadata) return "cherry-pick";
  if ("REVERT_HEAD" in metadata) return "revert";
  const todo = metadata["sequencer/todo"]?.trimStart();
  return todo?.startsWith("pick ") ? "cherry-pick" : todo?.startsWith("revert ") ? "revert" : null;
}
