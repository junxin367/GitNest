import { GitError, type GitIgnoreClient, type GitIgnoreInput, type GitIgnorePlan } from "@gitnest/git-core";
import { listWorkspaceTargets, repositoryTargetKey, type RepositoryTarget } from "@gitnest/workspace-core";
import type { RepositoryCommandRuntime, RepositoryCommandServiceOptions } from "./repository-command-service";

export interface RepositoryIgnoreRequest extends GitIgnoreInput { target: RepositoryTarget }
export interface RepositoryIgnorePreflight extends Omit<GitIgnorePlan, "fingerprint"> {
  target: RepositoryTarget;
  preflightId: string;
  expiresAt: string;
  confirmationRequired: boolean;
}
interface StoredPreflight { result: RepositoryIgnorePreflight; plan: GitIgnorePlan; workspaceId: string; worktreePath: string }

export class RepositoryIgnoreService {
  readonly #preflights = new Map<string, StoredPreflight>();
  readonly #clock: () => string;
  readonly #idFactory: () => string;
  readonly #ttl: number;
  #sequence = 0;
  constructor(
    readonly runtime: RepositoryCommandRuntime,
    readonly client: GitIgnoreClient,
    options: RepositoryCommandServiceOptions = {}
  ) {
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? (() => `ignore_${Date.now()}_${++this.#sequence}`);
    this.#ttl = options.preflightTtlMs ?? 60_000;
  }
  async #resolve(target: RepositoryTarget) {
    if (!target || typeof target.repositoryId !== "string" || !target.repositoryId || typeof target.worktreeId !== "string" || !target.worktreeId) {
      throw new GitError("INVALID_REQUEST", "请选择有效的仓库目标。");
    }
    const workspace = await this.runtime.getCurrent();
    const worktree = workspace.worktrees.find(entry => entry.id === target.worktreeId && entry.repositoryId === target.repositoryId);
    if (!worktree || worktree.isBare || !listWorkspaceTargets(workspace).some(entry => repositoryTargetKey(entry) === repositoryTargetKey(target))) {
      throw new GitError("INVALID_REQUEST", "请选择工作区中已登记的非裸 Worktree。");
    }
    return { workspaceId: workspace.id, worktreePath: worktree.path };
  }
  async preflight(input: RepositoryIgnoreRequest): Promise<RepositoryIgnorePreflight> {
    if (!input || typeof input !== "object") throw new GitError("INVALID_REQUEST", "忽略操作参数无效。");
    const context = await this.#resolve(input.target);
    const plan = await this.client.inspect(context.worktreePath, { path: input.path, scope: input.scope });
    const { fingerprint: _fingerprint, ...preview } = plan;
    const now = Date.parse(this.#clock());
    const result: RepositoryIgnorePreflight = {
      ...preview, target: { repositoryId: input.target.repositoryId, worktreeId: input.target.worktreeId },
      preflightId: this.#idFactory(), expiresAt: new Date(now + this.#ttl).toISOString(), confirmationRequired: true
    };
    for (const [key, value] of this.#preflights) if (Date.parse(value.result.expiresAt) <= now) this.#preflights.delete(key);
    while (this.#preflights.size >= 64) this.#preflights.delete(this.#preflights.keys().next().value!);
    this.#preflights.set(result.preflightId, structuredClone({ result, plan, ...context }));
    return result;
  }
  async execute(preflightId: string, confirmed: boolean): Promise<{ operationId: string }> {
    const stored = this.#preflights.get(preflightId);
    if (!stored || Date.parse(stored.result.expiresAt) <= Date.parse(this.#clock())) {
      this.#preflights.delete(preflightId);
      throw new GitError("PREFLIGHT_EXPIRED", "忽略规则预检已过期，请重新检查。");
    }
    if (confirmed !== true) throw new GitError("CONFIRMATION_REQUIRED", "请确认忽略规则及影响范围。");
    this.#preflights.delete(preflightId);
    const context = await this.#resolve(stored.result.target);
    if (context.workspaceId !== stored.workspaceId || context.worktreePath !== stored.worktreePath) throw changed();
    const latest = await this.client.inspect(context.worktreePath, stored.plan);
    if (latest.fingerprint !== stored.plan.fingerprint) throw changed();
    const accepted = await this.runtime.queueRepositoryOperation(stored.result.target, "ignore-file", async (path, signal) => {
      if (Date.parse(stored.result.expiresAt) <= Date.parse(this.#clock())) throw new GitError("PREFLIGHT_EXPIRED", "忽略规则等待期间预检已过期，请重新检查。");
      if (path !== stored.worktreePath) throw changed();
      await this.client.execute(path, stored.plan, { signal });
    }, { expectedWorkspaceId: stored.workspaceId });
    return { operationId: accepted.operationId };
  }
}
function changed() { return new GitError("PREFLIGHT_CHANGED", "仓库或忽略规则已变化，请重新检查。"); }
