import { GitError, type FileHistoryClient, type FileHistoryQuery, type GitReadOptions } from "@gitnest/git-core";
import { listWorkspaceTargets, repositoryTargetKey, type RepositoryTarget } from "@gitnest/workspace-core";
import type { RepositoryCommandRuntime } from "./repository-command-service";

export interface FileHistoryQueryRequest extends FileHistoryQuery { queryId: string; target: RepositoryTarget }
export interface FileHistoryDiffQueryRequest { queryId: string; target: RepositoryTarget; path: string; previousPath?: string; commitHash: string }

export class FileHistoryService {
  readonly #runtime: Pick<RepositoryCommandRuntime, "getCurrent">;
  readonly #client: FileHistoryClient;
  readonly #queries = new Map<string, AbortController>();
  constructor(runtime: Pick<RepositoryCommandRuntime, "getCurrent">, client: FileHistoryClient) {
    this.#runtime = runtime;
    this.#client = client;
  }
  history(request: FileHistoryQueryRequest) { return this.#read(request, (path, options) => this.#client.history(path, request, options)); }
  diff(request: FileHistoryDiffQueryRequest) { return this.#read(request, (path, options) => this.#client.diff(path, request, options)); }
  cancel(queryId: string): boolean {
    const controller = this.#queries.get(queryId);
    controller?.abort();
    return !!controller;
  }
  async #resolve(target: RepositoryTarget) {
    if (!target || typeof target.repositoryId !== "string" || !target.repositoryId || typeof target.worktreeId !== "string" || !target.worktreeId) throw new GitError("INVALID_REQUEST", "请选择有效的仓库目标。");
    const workspace = await this.#runtime.getCurrent();
    const worktree = workspace.worktrees.find((entry) => entry.id === target.worktreeId && entry.repositoryId === target.repositoryId);
    if (!worktree || worktree.isBare || !listWorkspaceTargets(workspace).some((entry) => repositoryTargetKey(entry) === repositoryTargetKey(target))) throw new GitError("INVALID_REQUEST", "请选择工作区中已登记的非裸 Worktree。");
    return { workspaceId: workspace.id, path: worktree.path };
  }
  async #read<Result>(request: { queryId: string; target: RepositoryTarget }, read: (path: string, options: GitReadOptions) => Promise<Result>): Promise<Result> {
    if (!request || typeof request.queryId !== "string" || !/^[a-zA-Z0-9._:-]{1,160}$/.test(request.queryId)) throw new GitError("INVALID_REQUEST", "文件历史请求标识无效。");
    if (this.#queries.has(request.queryId)) throw new GitError("INVALID_REQUEST", "文件历史请求标识正在使用。");
    if (this.#queries.size >= 32) throw new GitError("INVALID_REQUEST", "文件历史查询过多，请等待当前请求结束。");
    const controller = new AbortController();
    this.#queries.set(request.queryId, controller);
    try {
      const target = { ...request.target };
      const context = await this.#resolve(target);
      if (controller.signal.aborted) throw cancelled();
      const result = await read(context.path, { signal: controller.signal, priority: "interactive" });
      if (controller.signal.aborted) throw cancelled();
      const latest = await this.#resolve(target);
      if (latest.workspaceId !== context.workspaceId || latest.path !== context.path) throw cancelled();
      return result;
    } finally {
      this.#queries.delete(request.queryId);
    }
  }
}
function cancelled() { return new GitError("COMMAND_CANCELLED", "文件历史查询已取消或目标已变化。"); }
