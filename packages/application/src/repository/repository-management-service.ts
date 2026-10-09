import { randomUUID } from "node:crypto";
import { GitError } from "@gitnest/git-core";
import type {
  RepositoryCreationInput,
  RepositoryManagementAction,
  RepositoryManagementPort,
  RepositoryManagementState
} from "@gitnest/git-core";
import type { RepositoryTarget, Workspace } from "@gitnest/workspace-core";

export interface ManagementCommand { target: RepositoryTarget; action: RepositoryManagementAction }
export interface ManagementPreflight {
  preflightId: string; expiresAt: string; command: ManagementCommand; summary: string;
}
export interface RepositoryCreationState {
  operationId: string; kind: "clone" | "init"; destination: string;
  state: "running" | "succeeded" | "failed" | "cancelled"; message: string;
}
export interface ManagementRuntime {
  getCurrent(): Promise<Workspace>;
  queueRepositoryOperation(
    target: RepositoryTarget, kind: RepositoryManagementAction["type"],
    action: (path: string, signal: AbortSignal) => Promise<void>,
    options?: { expectedWorkspaceId?: string }
  ): Promise<{ operationId: string }>;
}
const labels: Record<RepositoryManagementAction["type"], string> = {
  "remote-add": "添加远程", "remote-set-url": "修改远程地址", "remote-remove": "删除远程配置",
  "tag-create": "创建本地标签", "tag-delete": "删除本地标签", "tag-push": "推送标签到远程"
};
export class RepositoryManagementService {
  readonly #preflights = new Map<string, ManagementPreflight & { fingerprint: string; workspaceId: string }>();
  readonly #creations = new Map<string, { state: RepositoryCreationState; controller: AbortController; completion: Promise<void> }>();
  #disposed = false;
  constructor(private readonly runtime: ManagementRuntime, private readonly git: RepositoryManagementPort) {}
  async #target(target: RepositoryTarget) {
    const workspace = await this.runtime.getCurrent();
    const worktree = workspace.worktrees.find((item) => item.id === target.worktreeId && item.repositoryId === target.repositoryId);
    if (!worktree || worktree.isBare) throw new GitError("INVALID_REQUEST", "所选仓库不可用，请刷新后重试。");
    return { workspace, path: worktree.path };
  }
  async inspect(target: RepositoryTarget): Promise<RepositoryManagementState> {
    return this.git.inspect((await this.#target(target)).path);
  }
  async #fingerprint(path: string, action: RepositoryManagementAction): Promise<string> {
    const state = await this.git.inspect(path);
    await this.git.validateAction(path, action);
    return JSON.stringify({
      state,
      revision: action.type === "tag-create" ? await this.git.resolveCommit(path, action.revision) : undefined
    });
  }
  async preflight(command: ManagementCommand): Promise<ManagementPreflight> {
    // Retain an independent copy: IPC callers cannot alter a confirmed command.
    const stable = structuredClone(command);
    const { workspace, path } = await this.#target(stable.target);
    const fingerprint = await this.#fingerprint(path, stable.action);
    const preflight: ManagementPreflight = {
      preflightId: randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
      command: stable,
      summary: `${labels[stable.action.type]}：${stable.action.name}${stable.action.type === "tag-push" ? ` → ${stable.action.remote}（会联系远程）` : ""}${stable.action.type === "remote-remove" ? "（仅删除本地配置，可能同时移除对应远程跟踪引用）" : ""}`
    };
    for (const [key, entry] of this.#preflights) if (Date.parse(entry.expiresAt) < Date.now()) this.#preflights.delete(key);
    if (this.#preflights.size >= 64) this.#preflights.delete(this.#preflights.keys().next().value!);
    this.#preflights.set(preflight.preflightId, { ...preflight, fingerprint, workspaceId: workspace.id });
    return structuredClone(preflight);
  }
  async execute(preflightId: string, confirmed: boolean): Promise<{ operationId: string }> {
    if (!confirmed) throw new GitError("CONFIRMATION_REQUIRED", "请确认操作范围。");
    const entry = this.#preflights.get(preflightId);
    this.#preflights.delete(preflightId);
    if (!entry || Date.parse(entry.expiresAt) < Date.now()) throw new GitError("PREFLIGHT_EXPIRED", "预检已过期，请重新检查。");
    return this.runtime.queueRepositoryOperation(entry.command.target, entry.command.action.type, async (path, signal) => {
      if (Date.parse(entry.expiresAt) < Date.now()) throw new GitError("PREFLIGHT_EXPIRED", "排队期间预检已过期，请重新检查。");
      if (await this.#fingerprint(path, entry.command.action) !== entry.fingerprint) {
        throw new GitError("PREFLIGHT_CHANGED", "仓库、远程地址或标签已变化，请重新确认；未执行写操作。");
      }
      await this.git.execute(path, entry.command.action, signal);
    }, { expectedWorkspaceId: entry.workspaceId });
  }
  async commitUrl(target: RepositoryTarget, hash: string, remote?: string): Promise<{ url: string }> {
    if (!/^[0-9a-f]{40,64}$/i.test(hash)) throw new GitError("INVALID_REQUEST", "请选择完整的提交哈希。");
    const path = (await this.#target(target)).path;
    await this.git.resolveCommit(path, hash);
    const { remotes } = await this.git.inspect(path);
    const selected = remote ? remotes.find((item) => item.name === remote) : remotes.find((item) => item.name === "origin") ?? (remotes.length === 1 ? remotes[0] : undefined);
    if (!selected) throw new GitError("INVALID_REQUEST", "请选择一个有效远程。");
    return { url: remoteCommitUrl(selected.fetchUrl, hash) };
  }
  create(input: RepositoryCreationInput): RepositoryCreationState {
    if (this.#disposed) throw new GitError("INVALID_REQUEST", "应用正在关闭，无法启动创建任务。");
    if (!input || (input.kind !== "clone" && input.kind !== "init") || typeof input.destination !== "string" || !input.destination.trim()) throw new GitError("INVALID_REQUEST", "请选择新的目标目录。");
    for (const [key, entry] of this.#creations) if (entry.state.state !== "running") this.#creations.delete(key);
    if ([...this.#creations.values()].some((entry) => entry.state.state === "running")) throw new GitError("INVALID_REQUEST", "请先等待或取消当前仓库创建。");
    const state: RepositoryCreationState = {
      operationId: randomUUID(), kind: input.kind, destination: input.destination,
      state: "running", message: input.kind === "clone" ? "正在准备克隆，认证使用系统 Git 凭据助手或 SSH 配置…" : "正在初始化仓库…"
    };
    const controller = new AbortController();
    const entry = { state, controller, completion: Promise.resolve() };
    this.#creations.set(state.operationId, entry);
    entry.completion = this.git.create(structuredClone(input), controller.signal, (message) => { state.message = message; }).then(() => {
      state.state = "succeeded"; state.message = "仓库已创建，可以加入 Workspace。";
    }, (error: unknown) => {
      state.state = controller.signal.aborted ? "cancelled" : "failed";
      state.message = `${controller.signal.aborted ? "操作已取消" : error instanceof Error ? error.message : "创建失败"}。如目标目录已产生文件，将保留供检查；重试请使用新的空目录。`;
    });
    return { ...state };
  }
  async dispose(): Promise<void> {
    this.#disposed = true;
    const entries = [...this.#creations.values()];
    for (const entry of entries) if (entry.state.state === "running") entry.controller.abort();
    await Promise.allSettled(entries.map((entry) => entry.completion));
    this.#preflights.clear();
  }
  creationStatus(operationId: string): RepositoryCreationState {
    const entry = this.#creations.get(operationId);
    if (!entry) throw new GitError("INVALID_REQUEST", "创建任务不存在。");
    return { ...entry.state };
  }
  cancelCreation(operationId: string): void {
    const entry = this.#creations.get(operationId);
    if (!entry) throw new GitError("INVALID_REQUEST", "创建任务不存在。");
    if (entry.state.state === "running") entry.controller.abort();
  }
}

export function remoteCommitUrl(remote: string, hash: string): string {
  let parsed: URL;
  try {
    const scp = /^(?:[^@/\s]+@)?([^:/\s]+):([^\\]+)$/.exec(remote);
    parsed = new URL(remote.includes("://") ? remote : scp ? `https://${scp[1]}/${scp[2]}` : remote);
  } catch { throw new GitError("INVALID_REQUEST", "此远程地址不支持在浏览器查看提交。"); }
  if (!["https:", "http:", "ssh:"].includes(parsed.protocol)) throw new GitError("INVALID_REQUEST", "此远程协议不支持浏览器链接。");
  const host = parsed.hostname.toLowerCase();
  if (!["github.com", "gitlab.com", "gitee.com"].includes(host)) throw new GitError("INVALID_REQUEST", "暂不支持此 Git 托管站点的提交链接。");
  const path = parsed.pathname.replace(/\/+$/, "").replace(/\.git$/, "");
  if (!/^\/[^/]+\/.+/.test(path) || /[\u0000-\u0020]/.test(path)) throw new GitError("INVALID_REQUEST", "远程仓库路径无效。");
  return `https://${host}${path}${host === "gitlab.com" ? "/-/commit/" : "/commit/"}${hash}`;
}
