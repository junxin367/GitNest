import {
  useMemo,
  useState,
  type FormEvent
} from "react";

import type {
  RepositoryStatusSnapshotDto,
  RepositoryTargetDto,
  WorkspaceDetailsDto,
  WorkspaceErrorDto,
  WorkspaceMonitorStateDto,
  WorkspaceOperationDto
} from "@gitnest/contracts";

import {
  findTargetSnapshot,
  getSnapshotChangeCount,
  isWorkspaceDataBlocked,
  listWorkspaceTargets,
  repositoryTargetSelected,
  resolveWorkspaceTarget
} from "../../entities/workspace/model";
import type { IconName } from "../../shared/ui/Icon";
import { Icon } from "../../shared/ui/Icon";

type LocalWorkspaceOperation =
  | "loading"
  | "selecting"
  | "scanning"
  | "saving"
  | null;

interface WorkspaceOverviewPageProps {
  workspace: WorkspaceDetailsDto | null;
  snapshots: RepositoryStatusSnapshotDto[];
  operations: WorkspaceOperationDto[];
  monitor: WorkspaceMonitorStateDto | null;
  error: WorkspaceErrorDto | null;
  notice: string | null;
  operation: LocalWorkspaceOperation;
  busy: boolean;
  onAddDirectory(): void;
  onAddManualPath(path: string): Promise<void>;
  onSelectTarget(target: RepositoryTargetDto): void;
  onCancelOperation(operationId: string): void;
  onClearFeedback(): void;
}

export function WorkspaceOverviewPage({
  workspace,
  snapshots,
  operations,
  monitor,
  error,
  notice,
  operation,
  busy,
  onAddDirectory,
  onAddManualPath,
  onSelectTarget,
  onCancelOperation,
  onClearFeedback
}: WorkspaceOverviewPageProps) {
  const [manualPathOpen, setManualPathOpen] = useState(false);
  const [manualPath, setManualPath] = useState("");
  const targets = useMemo(
    () => (workspace ? listWorkspaceTargets(workspace) : []),
    [workspace]
  );
  const statusRows = useMemo(
    () =>
      workspace
        ? targets
            .map((target) => ({
              target,
              ...resolveWorkspaceTarget(workspace, target),
              snapshot: findTargetSnapshot(snapshots, target)
            }))
            .sort(compareStatusRows)
        : [],
    [snapshots, targets, workspace]
  );
  const changedCount = snapshots.filter(
    (snapshot) => getSnapshotChangeCount(snapshot) > 0
  ).length;
  const syncCount = snapshots.filter(
    (snapshot) => snapshot.ahead > 0 || snapshot.behind > 0
  ).length;
  const freshCount = snapshots.filter(
    (snapshot) => !snapshot.stale && !snapshot.error
  ).length;
  const metrics: Array<{
    label: string;
    value: string;
    foot: string;
    icon: IconName;
    tone: string;
  }> = [
    {
      label: "仓库",
      value: String(workspace?.repositories.length ?? 0),
      foot:
        targets.length > 0
          ? `${freshCount}/${targets.length} 个状态已刷新`
          : "添加目录后自动发现",
      icon: "repository",
      tone: "blue"
    },
    {
      label: "未提交变更",
      value: String(changedCount),
      foot:
        changedCount > 0
          ? "包含 staged、unstaged、untracked 或冲突"
          : "当前缓存中没有待处理变更",
      icon: "files",
      tone: "yellow"
    },
    {
      label: "需要同步",
      value: String(syncCount),
      foot:
        syncCount > 0
          ? "存在 ahead 或 behind 的仓库"
          : "状态刷新不执行 Fetch",
      icon: "download",
      tone: "accent"
    },
    {
      label: "Worktrees",
      value: String(workspace?.worktrees.length ?? 0),
      foot: "按 commonDir 关联本地实例",
      icon: "worktree",
      tone: "purple"
    }
  ];
  const scanIssues =
    workspace?.entries.flatMap((entry) =>
      entry.scanIssues.map((issue) => ({
        entryName: entry.displayName,
        issue
      }))
    ) ?? [];
  const snapshotIssues =
    workspace?.entries.length && workspace
      ? snapshots
          .filter(
            (
              snapshot
            ): snapshot is RepositoryStatusSnapshotDto & {
              error: NonNullable<
                RepositoryStatusSnapshotDto["error"]
              >;
            } => Boolean(snapshot.error)
          )
          .map((snapshot) => {
            const resolved = resolveWorkspaceTarget(
              workspace,
              snapshot
            );
            return {
              entryName:
                resolved.worktree?.name ??
                resolved.repository?.name ??
                "未知仓库",
              issue: {
                path: resolved.worktree?.path ?? "",
                code: snapshot.error.code,
                message: snapshot.error.message
              }
            };
          })
      : [];
  const localProblems = [...scanIssues, ...snapshotIssues];
  const blockingError = isWorkspaceDataBlocked(
    workspace,
    error,
    operation
  );
  const activeOperations = operations.filter(
    (item) =>
      item.state === "queued" ||
      item.state === "running" ||
      item.state === "cancelling"
  );

  const submitManualPath = (event: FormEvent) => {
    event.preventDefault();
    const path = manualPath.trim();

    if (path) {
      void onAddManualPath(path);
    }
  };

  if (blockingError && error) {
    return (
      <div className="page-scroll">
        <section className="page-heading">
          <div>
            <span className="eyebrow">
              Workspace-first Git desktop
            </span>
            <h1>Workspace 概览</h1>
            <p>
              本地 Workspace 配置存在问题，当前数据有效性无法确认。
            </p>
          </div>
        </section>
        <section
          className="panel workspace-blocking-error"
          role="alert"
        >
          <span className="empty-state-icon">
            <Icon name="warning" size={20} />
          </span>
          <div>
            <strong>Workspace 数据无法恢复</strong>
            <p>{error.message}</p>
            <small>
              为避免把损坏配置误显示为空 Workspace，当前不会展示指标或空数据占位。
            </small>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page-scroll">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Workspace-first Git desktop</span>
          <h1>Workspace 概览</h1>
          <p>
            最近 Snapshot 会立即显示，后台刷新使用最多四路 Git
            读取；文件监听只触发防抖刷新，Git CLI 始终是最终事实来源。
          </p>
        </div>
        <div className="page-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              setManualPathOpen((current) => !current)
            }
            type="button"
          >
            <Icon name="folder" />
            手动路径
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={onAddDirectory}
            type="button"
          >
            <Icon name="plus" />
            添加目录
          </button>
        </div>
      </section>

      {manualPathOpen && (
        <form
          className="manual-path-form"
          onSubmit={submitManualPath}
        >
          <label htmlFor="manual-workspace-path">
            本地目录绝对路径
          </label>
          <div>
            <input
              autoFocus
              id="manual-workspace-path"
              onChange={(event) =>
                setManualPath(event.target.value)
              }
              placeholder="例如 D:\code\sc\sc_code"
              spellCheck={false}
              value={manualPath}
            />
            <button
              className="button"
              disabled={busy}
              onClick={() => setManualPathOpen(false)}
              type="button"
            >
              取消
            </button>
            <button
              className="button primary"
              disabled={busy || !manualPath.trim()}
              type="submit"
            >
              {operation === "scanning" ? "扫描中…" : "扫描并添加"}
            </button>
          </div>
          <small>
            也可以把一个或多个目录直接拖入窗口。
          </small>
        </form>
      )}

      {(error || notice) && (
        <div
          className={`workspace-feedback ${
            error ? "error" : "success"
          }`}
          role={error ? "alert" : "status"}
        >
          <Icon name={error ? "warning" : "check"} />
          <div>
            <strong>{error ? "Workspace 操作未完成" : "操作完成"}</strong>
            <span>{error?.message ?? notice}</span>
          </div>
          <button
            aria-label="关闭提示"
            className="icon-button"
            onClick={onClearFeedback}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
      )}

      <section className="metric-grid" aria-label="Workspace 指标">
        {metrics.map((metric) => (
          <article
            className={`metric-card tone-${metric.tone}`}
            key={metric.label}
          >
            <div className="metric-label">
              <span>{metric.label}</span>
              <span className="metric-icon">
                <Icon name={metric.icon} />
              </span>
            </div>
            <strong className="metric-value">{metric.value}</strong>
            <span className="metric-foot">{metric.foot}</span>
          </article>
        ))}
      </section>

      <section className="dashboard-grid">
        <div>
          <article className="panel">
            <header className="panel-header">
              <div className="panel-title">
                <Icon name="repository" />
                仓库状态
              </div>
              <span className="panel-caption">
                {statusRows.length > 0
                  ? `${freshCount}/${statusRows.length} 已刷新`
                  : workspace
                    ? `${workspace.entries.length} 个顶层条目`
                    : "正在恢复…"}
              </span>
            </header>
            {statusRows.length > 0 && workspace ? (
              <div className="repository-status-table" role="table">
                <div
                  className="repository-status-row repository-status-head"
                  role="row"
                >
                  <span role="columnheader">仓库</span>
                  <span role="columnheader">分支</span>
                  <span role="columnheader">工作区</span>
                  <span role="columnheader">同步</span>
                </div>
                {statusRows.map(
                  ({ target, repository, worktree, snapshot }) => (
                    <button
                      aria-current={
                        repositoryTargetSelected(
                          workspace.selectedTarget,
                          target
                        )
                          ? "true"
                          : undefined
                      }
                      className={`repository-status-row${
                        repositoryTargetSelected(
                          workspace.selectedTarget,
                          target
                        )
                          ? " selected"
                          : ""
                      }`}
                      key={`${target.repositoryId}:${target.worktreeId}`}
                      onClick={() => onSelectTarget(target)}
                      role="row"
                      type="button"
                    >
                      <span className="table-name" role="cell">
                        <span
                          className={`repository-state ${snapshotTone(snapshot)}`}
                        >
                          <Icon name="repository" size={13} />
                        </span>
                        <span title={worktree?.path}>
                          {worktree?.name ??
                            repository?.name ??
                            "未知仓库"}
                          <small>{worktree?.path ?? "路径不可用"}</small>
                        </span>
                      </span>
                      <span role="cell">
                        {snapshot?.branch ??
                          worktree?.branch ??
                          "detached"}
                      </span>
                      <span role="cell">
                        <span
                          className={`status-pill ${snapshotPillTone(snapshot)}`}
                        >
                          {workspaceStatusLabel(snapshot)}
                        </span>
                      </span>
                      <span role="cell">
                        {syncLabel(snapshot)}
                      </span>
                    </button>
                  )
                )}
              </div>
            ) : (
              <div className="empty-state workspace-empty-state">
                <span className="empty-state-icon">
                  <Icon name="folder" size={20} />
                </span>
                <div>
                  <strong>
                    {operation === "loading"
                      ? "正在恢复 Workspace"
                      : "尚未添加本地目录"}
                  </strong>
                  <p>
                    使用目录选择器、手动输入绝对路径，或把目录拖入窗口。
                  </p>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={onAddDirectory}
                    type="button"
                  >
                    <Icon name="plus" />
                    添加第一个目录
                  </button>
                </div>
              </div>
            )}
          </article>

          <article className="panel">
            <header className="panel-header">
              <div className="panel-title">
                <Icon name="operations" />
                操作中心
              </div>
              <span className="panel-caption">
                {activeOperations.length} 个运行中 · 最近{" "}
                {operations.length} 个
              </span>
            </header>
            {operations.length > 0 ? (
              <div className="operation-list">
                {operations.slice(0, 5).map((item) => (
                  <div className="operation-row" key={item.id}>
                    <span
                      className={`operation-icon state-${item.state}`}
                    >
                      <Icon
                        name={
                          item.state === "failed"
                            ? "warning"
                            : item.state === "succeeded"
                              ? "check"
                              : "refresh"
                        }
                        size={14}
                      />
                    </span>
                    <div>
                      <strong>
                        {operationKindLabel(item.kind)}
                      </strong>
                      <span>{item.message}</span>
                      <div className="operation-progress">
                        <span
                          style={{
                            transform: `scaleX(${Math.max(
                              0,
                              Math.min(item.progress, 1)
                            )})`
                          }}
                        />
                      </div>
                    </div>
                    <div className="operation-controls">
                      <span className="operation-state">
                        {operationStateLabel(item.state)}
                      </span>
                      {isCancellableRepositoryOperation(item) && (
                        <button
                          aria-label={`取消${operationKindLabel(item.kind)}`}
                          className="operation-cancel-button"
                          disabled={item.state === "cancelling"}
                          onClick={() =>
                            onCancelOperation(item.id)
                          }
                          type="button"
                        >
                          <Icon name="close" size={12} />
                          {item.state === "cancelling"
                            ? "取消中"
                            : "取消"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-state-icon">
                  <Icon name="check" size={20} />
                </span>
                <div>
                  <strong>当前没有后台操作</strong>
                  <p>
                    启动刷新、手动刷新和文件变化会统一显示于此。
                  </p>
                </div>
              </div>
            )}
          </article>
        </div>

        <div>
          <article className="panel">
            <header className="panel-header">
              <div className="panel-title">
                <Icon
                  name={
                    monitor?.mode === "polling"
                      ? "warning"
                      : "activity"
                  }
                />
                刷新监控
              </div>
              <span
                className={`status-pill ${
                  monitor?.mode === "polling"
                    ? "yellow"
                    : monitor?.mode === "watching"
                      ? "green"
                      : "neutral"
                }`}
              >
                {monitorModeLabel(monitor)}
              </span>
            </header>
            <div className="monitor-card">
              <strong>
                {monitor?.mode === "watching"
                  ? `${monitor.watchedTargets} 个仓库已监听`
                  : monitor?.mode === "polling"
                    ? "已启用低频轮询"
                    : "监听尚未启动"}
              </strong>
              <p>{monitor?.message ?? "正在初始化刷新状态。"}</p>
              {monitor?.lastEventAt && (
                <small>
                  最近文件事件：{formatUpdatedAt(monitor.lastEventAt)}
                </small>
              )}
            </div>
          </article>

          <article className="panel">
            <header className="panel-header">
              <div className="panel-title">
                <Icon
                  name={scanIssues.length > 0 ? "warning" : "check"}
                />
                局部问题
              </div>
              <span className="panel-caption">
                {localProblems.length} 个
              </span>
            </header>
            {localProblems.length > 0 ? (
              <div className="scan-issue-list">
                {localProblems
                  .slice(0, 5)
                  .map(({ entryName, issue }) => (
                  <div
                    className="scan-issue"
                    key={`${entryName}:${issue.path}:${issue.code}`}
                  >
                    <Icon name="warning" size={14} />
                    <div>
                      <strong>{entryName}</strong>
                      <span title={issue.path}>{issue.message}</span>
                    </div>
                  </div>
                  ))}
              </div>
            ) : (
              <div className="stage-card">
                <span className="status-pill blue">M1 · 04</span>
                <strong>Refresh & Operations</strong>
                <p>
                  缓存优先启动、有界并发、请求合并和监听降级已经接入。
                </p>
              </div>
            )}
          </article>
        </div>
      </section>
    </div>
  );
}

type StatusRow = {
  target: RepositoryTargetDto;
  repository: ReturnType<typeof resolveWorkspaceTarget>["repository"];
  worktree: ReturnType<typeof resolveWorkspaceTarget>["worktree"];
  snapshot: RepositoryStatusSnapshotDto | undefined;
};

function compareStatusRows(
  left: StatusRow,
  right: StatusRow
): number {
  return (
    statusPriority(right.snapshot) -
      statusPriority(left.snapshot) ||
    (left.worktree?.name ?? left.repository?.name ?? "").localeCompare(
      right.worktree?.name ?? right.repository?.name ?? "",
      undefined,
      { sensitivity: "base" }
    )
  );
}

function statusPriority(
  snapshot: RepositoryStatusSnapshotDto | undefined
): number {
  if (snapshot?.error) {
    return 5;
  }
  if (snapshot?.conflicted) {
    return 4;
  }
  if (getSnapshotChangeCount(snapshot) > 0) {
    return 3;
  }
  if (snapshot && (snapshot.ahead > 0 || snapshot.behind > 0)) {
    return 2;
  }
  if (!snapshot || snapshot.stale || snapshot.refreshPending) {
    return 1;
  }
  return 0;
}

function snapshotTone(
  snapshot: RepositoryStatusSnapshotDto | undefined
): "clean" | "idle" | "pending" | "warning" | "danger" {
  if (snapshot?.refreshPending) {
    return "pending";
  }
  if (!snapshot || snapshot.stale || snapshot.error) {
    return "idle";
  }
  if (snapshot.conflicted > 0) {
    return "danger";
  }
  if (getSnapshotChangeCount(snapshot) > 0) {
    return "warning";
  }
  return "clean";
}

function snapshotPillTone(
  snapshot: RepositoryStatusSnapshotDto | undefined
): "neutral" | "blue" | "green" | "yellow" {
  if (snapshot?.error || snapshot?.conflicted) {
    return "yellow";
  }
  if (snapshot?.refreshPending || snapshot?.stale || !snapshot) {
    return "blue";
  }
  return getSnapshotChangeCount(snapshot) > 0 ? "yellow" : "green";
}

function workspaceStatusLabel(
  snapshot: RepositoryStatusSnapshotDto | undefined
): string {
  if (snapshot?.error) {
    return "读取失败";
  }
  if (snapshot?.refreshPending) {
    return "刷新中";
  }
  if (!snapshot || snapshot.stale) {
    return "缓存";
  }
  if (snapshot.conflicted > 0) {
    return `${snapshot.conflicted} 冲突`;
  }

  const changes = getSnapshotChangeCount(snapshot);
  return changes > 0 ? `${changes} 变更` : "干净";
}

function syncLabel(
  snapshot: RepositoryStatusSnapshotDto | undefined
): string {
  if (!snapshot?.upstream) {
    return "无上游";
  }
  if (snapshot.ahead === 0 && snapshot.behind === 0) {
    return "已同步";
  }
  return `↑${snapshot.ahead} ↓${snapshot.behind}`;
}

function operationStateLabel(
  state: WorkspaceOperationDto["state"]
): string {
  return {
    queued: "排队中",
    running: "运行中",
    cancelling: "取消中",
    succeeded: "已完成",
    failed: "部分失败",
    cancelled: "已取消",
    interrupted: "已中断"
  }[state];
}

function operationKindLabel(
  kind: WorkspaceOperationDto["kind"]
): string {
  return {
    scan: "Workspace 扫描",
    status: "仓库状态刷新",
    stage: "暂存文件",
    unstage: "取消暂存",
    commit: "创建提交",
    fetch: "获取远程更新",
    pull: "快进拉取",
    push: "推送分支",
    "switch-branch": "切换分支",
    "create-branch": "创建分支",
    "rename-branch": "重命名分支",
    "delete-branch": "删除分支",
    "worktree-create": "创建 Worktree",
    "worktree-lock": "锁定 Worktree",
    "worktree-unlock": "解锁 Worktree",
    "worktree-move": "移动 Worktree",
    "worktree-repair": "修复 Worktree 登记",
    "worktree-prune": "Prune Worktree 登记",
    "worktree-remove": "移除 Worktree"
  }[kind];
}

function isCancellableRepositoryOperation(
  operation: WorkspaceOperationDto
): boolean {
  return (
    (
      operation.state === "queued" ||
      operation.state === "running" ||
      operation.state === "cancelling"
    ) &&
    [
      "fetch",
      "pull",
      "push",
      "switch-branch",
      "create-branch",
      "rename-branch",
      "delete-branch",
      "worktree-create",
      "worktree-lock",
      "worktree-unlock",
      "worktree-move",
      "worktree-repair",
      "worktree-prune",
      "worktree-remove"
    ].includes(operation.kind)
  );
}

function monitorModeLabel(
  monitor: WorkspaceMonitorStateDto | null
): string {
  if (monitor?.mode === "watching") {
    return "监听中";
  }
  if (monitor?.mode === "polling") {
    return "轮询";
  }
  return "未启动";
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "时间未知"
    : date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
}
