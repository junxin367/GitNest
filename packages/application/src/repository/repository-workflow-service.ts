import { GitError, type GitWorkflowAction, type GitWorkflowClient, type GitWorkflowState } from "@gitnest/git-core";
import { listWorkspaceTargets, repositoryTargetKey, type RepositoryTarget } from "@gitnest/workspace-core";
import type { RepositoryCommandRuntime, RepositoryCommandServiceOptions } from "./repository-command-service";

export type RepositoryWorkflowCommand = GitWorkflowAction & { target: RepositoryTarget };
export interface RepositoryWorkflowState extends GitWorkflowState { target: RepositoryTarget }
export interface RepositoryWorkflowPreflight {
  preflightId: string;
  expiresAt: string;
  command: RepositoryWorkflowCommand;
  state: RepositoryWorkflowState;
  summary: string;
  warnings: string[];
  confirmationRequired: boolean;
}
interface StoredPreflight {
  result: RepositoryWorkflowPreflight;
  workspaceId: string;
  path: string;
}

export class RepositoryWorkflowService {
  readonly #runtime: RepositoryCommandRuntime;
  readonly #client: GitWorkflowClient;
  readonly #clock: () => string;
  readonly #idFactory: () => string;
  readonly #ttl: number;
  readonly #preflights = new Map<string, StoredPreflight>();
  #sequence = 0;
  constructor(runtime: RepositoryCommandRuntime, client: GitWorkflowClient, options: RepositoryCommandServiceOptions = {}) {
    this.#runtime = runtime;
    this.#client = client;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? (() => `workflow_${Date.now()}_${++this.#sequence}`);
    this.#ttl = options.preflightTtlMs ?? 60_000;
  }

  async #resolve(target: RepositoryTarget) {
    const workspace = await this.#runtime.getCurrent();
    const worktree = workspace.worktrees.find((entry) => entry.id === target.worktreeId && entry.repositoryId === target.repositoryId);
    if (!worktree || worktree.isBare || !listWorkspaceTargets(workspace).some((entry) => repositoryTargetKey(entry) === repositoryTargetKey(target))) {
      throw new GitError("INVALID_REQUEST", "请选择工作区中已登记的非裸 Worktree。");
    }
    return { workspaceId: workspace.id, path: worktree.path };
  }

  async inspect(target: RepositoryTarget): Promise<RepositoryWorkflowState> {
    validateTarget(target);
    const { path } = await this.#resolve(target);
    return { ...await this.#client.inspect(path, { includeFingerprint: false }), target: { ...target } };
  }

  async preflight(input: RepositoryWorkflowCommand): Promise<RepositoryWorkflowPreflight> {
    const command = normalizeCommand(input);
    const context = await this.#resolve(command.target);
    const state = { ...await this.#client.inspect(context.path), target: command.target };
    assertAllowed(command, state);
    if (command.type === "cherry-pick" || command.type === "revert") await this.#client.validateCommit(context.path, command.commitHash);
    const warnings: string[] = [];
    if (command.type === "amend" || command.type === "undo-commit") {
      warnings.push("此操作会改写当前分支历史；工作区文件会保留。");
      warnings.push(state.remoteBranchesContainingHead.length
        ? `当前提交已存在于本地记录的远程分支：${state.remoteBranchesContainingHead.join("、")}。请与协作者协调，后续推送可能被拒绝。`
        : "远程发布状态依据本地远程引用判断，未联网确认。");
    }
    if (command.type === "abort") warnings.push("中止操作会恢复操作前的状态，并可能丢弃本次冲突解决期间的修改。");
    if (command.type === "amend") warnings.push("修正提交会包含当前全部暂存内容，未暂存修改不会追加。");
    if (command.type === "undo-commit" && state.parentCount > 1) warnings.push("当前提交是合并提交，将回到它的第一父提交；合并带来的文件修改仍会保留。");
    if (command.type === "continue") warnings.push("继续操作可能遇到下一处冲突；请在操作完成后检查状态。");
    if (command.type === "skip") warnings.push("跳过会丢弃当前提交的冲突解决修改，并继续处理后续提交；后续仍可能遇到冲突。");
    if (command.type === "keep-empty") warnings.push("将保留一个不修改文件的提交记录，并继续处理后续提交；后续仍可能遇到冲突。");
    if (command.type === "mark-resolved") warnings.push("此操作仅暂存您确认已解决的文件，不会自动合并内容。请先检查冲突标记及文件内容。");
    const now = Date.parse(this.#clock());
    const result: RepositoryWorkflowPreflight = {
      preflightId: this.#idFactory(),
      expiresAt: new Date(now + this.#ttl).toISOString(),
      command,
      state,
      summary: `${describeCommand(command)}${(command.type === "skip" || command.type === "keep-empty") && state.currentReplay
        ? `：${state.currentReplay.commitHash.slice(0, 12)} ${state.currentReplay.subject}` : ""}`,
      warnings,
      confirmationRequired: true
    };
    for (const [key, stored] of this.#preflights) if (Date.parse(stored.result.expiresAt) <= now) this.#preflights.delete(key);
    while (this.#preflights.size >= 64) this.#preflights.delete(this.#preflights.keys().next().value!);
    this.#preflights.set(result.preflightId, { result: structuredClone(result), ...context });
    return result;
  }

  async execute(input: RepositoryWorkflowCommand, preflightId: string, confirmed: boolean): Promise<{ operationId: string }> {
    const command = normalizeCommand(input);
    const stored = this.#preflights.get(preflightId);
    if (!stored || Date.parse(stored.result.expiresAt) <= Date.parse(this.#clock())) {
      this.#preflights.delete(preflightId);
      throw new GitError("PREFLIGHT_EXPIRED", "操作预检已过期，请重新检查。");
    }
    if (JSON.stringify(command) !== JSON.stringify(stored.result.command)) throw new GitError("PREFLIGHT_CHANGED", "操作参数已变化，请重新检查。");
    if (!confirmed) throw new GitError("CONFIRMATION_REQUIRED", "请确认操作影响后再执行。");
    this.#preflights.delete(preflightId);
    const current = await this.#resolve(command.target);
    if (current.workspaceId !== stored.workspaceId || current.path !== stored.path) throw changed();
    const beforeQueue = await this.#client.inspect(current.path);
    if (beforeQueue.fingerprint !== stored.result.state.fingerprint) throw changed();
    const accepted = await this.#runtime.queueRepositoryOperation(command.target, "workflow", async (path, signal) => {
      if (Date.parse(stored.result.expiresAt) <= Date.parse(this.#clock())) throw new GitError("PREFLIGHT_EXPIRED", "操作等待期间预检已过期，请重新检查。");
      if (path !== stored.path) throw changed();
      const latest = await this.#client.inspect(path, { signal });
      if (latest.fingerprint !== stored.result.state.fingerprint) throw changed();
      assertAllowed(command, latest);
      await this.#client.execute(path, command, { signal });
    }, { expectedWorkspaceId: stored.workspaceId });
    return { operationId: accepted.operationId };
  }
}

function changed() { return new GitError("PREFLIGHT_CHANGED", "HEAD、文件内容或操作状态已变化，请重新检查。"); }
function invalid(message: string): never { throw new GitError("INVALID_REQUEST", message); }
function validateTarget(target: RepositoryTarget) {
  if (!target || typeof target.repositoryId !== "string" || !target.repositoryId || typeof target.worktreeId !== "string" || !target.worktreeId) invalid("请选择有效的仓库目标。");
}
function validatePaths(paths: unknown): string[] {
  if (!Array.isArray(paths) || !paths.length || paths.length > 200) invalid("请选择 1 至 200 个文件。");
  for (const path of paths) {
    if (typeof path !== "string" || !path || path.length > 4096 || /[\0\r\n\\]/.test(path) || path.startsWith("/") || /^[a-z]:/i.test(path) || path.split("/").some((part) => part === ".." || part === "." || !part)) invalid("文件路径必须是仓库中的相对文件路径。");
  }
  return [...new Set(paths as string[])].sort();
}
function normalizeCommand(input: RepositoryWorkflowCommand): RepositoryWorkflowCommand {
  if (!input || typeof input !== "object") invalid("操作参数无效。");
  validateTarget(input.target);
  const target = { repositoryId: input.target.repositoryId, worktreeId: input.target.worktreeId };
  switch (input.type) {
    case "create-stash": {
      if (input.message !== undefined && (typeof input.message !== "string" || input.message.length > 10_000 || input.message.includes("\0"))) invalid("Stash 备注无效。");
      if (input.includeUntracked !== undefined && typeof input.includeUntracked !== "boolean") invalid("包含未跟踪文件的选项无效。");
      return { type: input.type, target, ...(input.message?.trim() ? { message: input.message.trim() } : {}), includeUntracked: input.includeUntracked ?? false, ...(input.paths !== undefined ? { paths: validatePaths(input.paths) } : {}) };
    }
    case "amend":
      if (typeof input.message !== "string" || !input.message.trim() || input.message.length > 100_000 || input.message.includes("\0")) invalid("请填写有效的提交说明。");
      return { type: input.type, target, message: input.message.trim() };
    case "undo-commit":
      if (input.mode !== "soft" && input.mode !== "mixed") invalid("撤销提交只能选择保留暂存或取消暂存。");
      return { type: input.type, target, mode: input.mode };
    case "cherry-pick":
    case "revert":
      if (typeof input.commitHash !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(input.commitHash)) invalid("请选择完整的提交 ID。");
      return { type: input.type, target, commitHash: input.commitHash.toLowerCase() };
    case "mark-resolved": return { type: input.type, target, paths: validatePaths(input.paths) };
    case "continue":
    case "skip":
    case "keep-empty":
    case "abort": return { type: input.type, target };
    default: return invalid("不支持此操作。");
  }
}
function assertAllowed(command: RepositoryWorkflowCommand, state: GitWorkflowState) {
  if (command.type === "mark-resolved") {
    if (!command.paths.every((path) => state.conflictedPaths.includes(path))) invalid("只能标记当前冲突列表中的文件。");
    return;
  }
  if (command.type === "continue" || command.type === "abort" || command.type === "skip" || command.type === "keep-empty") {
    if (!state.operation) invalid("没有可继续或中止的操作。");
    if (command.type === "continue" && state.conflictedPaths.length) invalid("请先解决并标记所有冲突文件。");
    if (command.type === "continue" && state.currentReplay?.isEmpty) invalid("当前提交已没有文件变更。请选择“跳过当前提交”或“保留空提交”，不要重复继续。");
    if (command.type === "skip" && (state.operation === "merge" || !state.currentReplay?.canSkip)) {
      invalid(state.currentReplay?.blockedReason ?? "当前状态没有可安全跳过的提交；Merge 不支持跳过。");
    }
    if (command.type === "keep-empty" && (state.operation === "merge" || !state.currentReplay?.isEmpty ||
      !state.currentReplay.canKeepEmpty || state.conflictedPaths.length || state.hasStagedChanges || state.changedPaths.length)) {
      invalid(state.currentReplay?.blockedReason ?? "只有当前重放提交已无文件变更时，才能保留空提交。");
    }
    return;
  }
  if (state.operation || state.conflictedPaths.length) invalid("请先完成或中止当前冲突操作。");
  if (!state.head) invalid("此操作需要仓库已有提交。");
  if (command.type === "undo-commit" && state.parentCount === 0) invalid("初始提交没有父提交，无法通过此入口撤销。");
  if (command.type === "create-stash") {
    if (!state.changedPaths.length) invalid("没有可储藏的修改。");
    if (command.paths && !command.paths.every((path) => state.changedPaths.includes(path))) invalid("所选文件已不在当前修改列表中。");
    if (command.paths?.some((path) => state.partialStashBlockedPaths?.includes(path))) {
      invalid("所选文件包含已从暂存区移除的路径（删除或重命名来源），Git 无法安全局部储藏。请在储藏面板右键选择“创建储藏”，保存全部修改。");
    }
    if (!command.includeUntracked && (command.paths ?? state.changedPaths).every((path) => state.untrackedPaths.includes(path))) invalid("只有未跟踪文件可储藏，请勾选包含未跟踪文件。");
  }
  if ((command.type === "cherry-pick" || command.type === "revert") && state.changedPaths.length) invalid("请先提交或储藏工作区修改，再应用提交。");
}
function describeCommand(command: RepositoryWorkflowCommand): string {
  switch (command.type) {
    case "create-stash": return `储藏${command.paths ? `${command.paths.length} 个所选文件的` : "全部"}修改${command.includeUntracked ? "（包含未跟踪文件）" : "（不包含未跟踪文件）"}`;
    case "amend": return "修正最近一次提交，追加当前暂存内容并更新提交说明";
    case "undo-commit": return command.mode === "soft" ? "撤销最近提交，保留全部修改及暂存状态" : "撤销最近提交，保留全部文件修改并取消暂存";
    case "cherry-pick": return `应用提交 ${command.commitHash.slice(0, 12)}`;
    case "revert": return `创建新提交以撤销 ${command.commitHash.slice(0, 12)}`;
    case "mark-resolved": return `标记 ${command.paths.length} 个冲突文件为已解决并暂存`;
    case "continue": return "继续当前 Git 操作";
    case "skip": return "跳过当前提交";
    case "keep-empty": return "保留空提交并继续";
    case "abort": return "中止当前 Git 操作";
  }
}
