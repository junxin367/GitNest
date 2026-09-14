import { Button } from "../../shared/ui/Button";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";

import type {
  CommitSummaryDto,
  RepositoryStatusSnapshotDto,
  RepositoryTargetDto,
  WorkspaceDetailsDto,
  WorkspaceErrorDto
} from "@gitnest/contracts";

import {
  filterSnapshotsToTargets,
  findTargetSnapshot,
  getSnapshotChangeCount,
  isWorkspaceDataBlocked,
  listActiveWorkspaceTargets,
  repositoryTargetSelected,
  resolveWorkspaceTarget
} from "../../entities/workspace/model";
import { formatCommitTimestamp } from "../../shared/lib/formatCommitTimestamp";
import type { IconName } from "../../shared/ui/Icon";
import { Icon } from "../../shared/ui/Icon";
import { Input } from "../../shared/ui/Input";
import { Toast, ToastViewport } from "../../shared/ui/Toast";

type LocalWorkspaceOperation =
  | "loading"
  | "selecting"
  | "scanning"
  | "saving"
  | null;

let workspaceOverviewHistorySequence = 0;

interface WorkspaceOverviewPageProps {
  workspace: WorkspaceDetailsDto | null;
  snapshots: RepositoryStatusSnapshotDto[];
  error: WorkspaceErrorDto | null;
  notice: string | null;
  operation: LocalWorkspaceOperation;
  busy: boolean;
  onAddDirectory(): void;
  onAddManualPath(path: string): Promise<boolean>;
  onSelectTarget(target: RepositoryTargetDto): void;
  onClearFeedback(): void;
}

export function WorkspaceOverviewPage({
  workspace,
  snapshots,
  error,
  notice,
  operation,
  busy,
  onAddDirectory,
  onAddManualPath,
  onSelectTarget,
  onClearFeedback
}: WorkspaceOverviewPageProps) {
  const [manualPathOpen, setManualPathOpen] = useState(false);
  const [manualPath, setManualPath] = useState("");
  const [recentCommits, setRecentCommits] = useState<
    Map<string, CommitSummaryDto>
  >(() => new Map());
  const [
    repositoryStatusCollapsed,
    setRepositoryStatusCollapsed
  ] = useState(false);
  const [
    recentCommitsCollapsed,
    setRecentCommitsCollapsed
  ] = useState(false);
  const targets = useMemo(
    () => listActiveWorkspaceTargets(workspace),
    [workspace]
  );
  const scopedSnapshots = useMemo(
    () => filterSnapshotsToTargets(snapshots, targets),
    [snapshots, targets]
  );
  const statusRows = useMemo(
    () =>
      workspace
        ? targets
            .map((target) => ({
              target,
              ...resolveWorkspaceTarget(workspace, target),
              snapshot: findTargetSnapshot(
                scopedSnapshots,
                target
              )
            }))
            .sort(compareStatusRows)
        : [],
    [scopedSnapshots, targets, workspace]
  );
  const historyRevision = useMemo(
    () =>
      scopedSnapshots
        .map(
          (snapshot) =>
            `${targetKey(snapshot)}:${snapshot.head}`
        )
        .sort()
        .join("|"),
    [scopedSnapshots]
  );
  useEffect(() => {
    let active = true;
    const queryIds = targets.map((target, index) => ({
      queryId: `workspace-overview-history-${
        ++workspaceOverviewHistorySequence
      }-${index}`,
      target
    }));

    setRecentCommits(new Map());
    const repositoryBridge = window.gitnest?.repository;
    if (!repositoryBridge || queryIds.length === 0) {
      return () => {
        active = false;
      };
    }

    const loadRecentCommits = async () => {
      const loaded = new Map<string, CommitSummaryDto>();

      for (let index = 0; index < queryIds.length; index += 4) {
        const batch = queryIds.slice(index, index + 4);
        const results = await Promise.all(
          batch.map(async ({ queryId, target }) => {
            try {
              const result = await repositoryBridge.getHistory({
                queryId,
                target,
                limit: 1,
                offset: 0
              });
              return result.ok
                ? {
                    key: targetKey(target),
                    commit: result.value.page.commits[0]
                  }
                : null;
            } catch {
              return null;
            }
          })
        );

        if (!active) {
          return;
        }

        for (const result of results) {
          if (result?.commit) {
            loaded.set(result.key, result.commit);
          }
        }
        setRecentCommits(new Map(loaded));
      }
    };

    void loadRecentCommits();
    return () => {
      active = false;
      for (const { queryId } of queryIds) {
        void repositoryBridge.cancelQuery({ queryId });
      }
    };
  }, [historyRevision, targets]);
  const recentRows = useMemo(
    () =>
      [...statusRows]
        .sort((left, right) =>
          compareRecentStatusRows(left, right, recentCommits)
        )
        .slice(0, 6),
    [recentCommits, statusRows]
  );
  const branchDistribution = useMemo(() => {
    const counts = new Map<string, number>();

    for (const row of statusRows) {
      const branch =
        row.snapshot?.branch ??
        row.worktree?.branch ??
        "detached";
      counts.set(branch, (counts.get(branch) ?? 0) + 1);
    }

    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort(
        (left, right) =>
          right.count - left.count ||
          left.name.localeCompare(
            right.name,
            undefined,
            { sensitivity: "base" }
          )
      );
  }, [statusRows]);
  const dirtyRepositoryCount = scopedSnapshots.filter(
    (snapshot) => getSnapshotChangeCount(snapshot) > 0
  ).length;
  const totalChangeCount = scopedSnapshots.reduce(
    (total, snapshot) => total + getSnapshotChangeCount(snapshot),
    0
  );
  const untrackedCount = scopedSnapshots.reduce(
    (total, snapshot) => total + snapshot.untracked,
    0
  );
  const behindRepositoryCount = scopedSnapshots.filter(
    (snapshot) => snapshot.behind > 0
  ).length;
  const behindCommitCount = scopedSnapshots.reduce(
    (total, snapshot) => total + snapshot.behind,
    0
  );
  const freshCount = scopedSnapshots.filter(
    (snapshot) => !snapshot.stale && !snapshot.error
  ).length;
  const activeRepositoryCount = new Set(
    targets.map((target) => target.repositoryId)
  ).size;
  const activeWorktrees = targets.flatMap((target) => {
    const worktree = workspace?.worktrees.find(
      (candidate) =>
        candidate.id === target.worktreeId &&
        candidate.repositoryId === target.repositoryId
    );
    return worktree ? [worktree] : [];
  });
  const prunableWorktreeCount = activeWorktrees.filter(
    (worktree) => worktree.isPrunable
  ).length;
  const detachedWorktreeCount = activeWorktrees.filter(
    (worktree) => worktree.isDetached
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
      value: String(activeRepositoryCount),
      foot:
        targets.length > 0
          ? `${freshCount}/${targets.length} 个状态已刷新`
          : "添加目录后自动发现",
      icon: "repository",
      tone: "blue"
    },
    {
      label: "未提交变更",
      value: String(totalChangeCount),
      foot:
        dirtyRepositoryCount > 0
          ? `${dirtyRepositoryCount} 个仓库 · ${untrackedCount} 个未跟踪文件`
          : "当前缓存中没有待处理变更",
      icon: "fileCode",
      tone: "yellow"
    },
    {
      label: "本地引用显示落后",
      value: String(behindRepositoryCount),
      foot:
        behindRepositoryCount > 0
          ? `累计 ${behindCommitCount} 个提交 · 未 Fetch`
          : "状态刷新不执行 Fetch",
      icon: "arrowDown",
      tone: "accent"
    },
    {
      label: "Worktrees",
      value: String(activeWorktrees.length),
      foot: `${prunableWorktreeCount} 个可清理 · ${detachedWorktreeCount} 个 detached`,
      icon: "worktree",
      tone: "purple"
    }
  ];
  const blockingError = isWorkspaceDataBlocked(
    workspace,
    error,
    operation
  );

  const submitManualPath = async (event: FormEvent) => {
    event.preventDefault();
    const path = manualPath.trim();

    if (path) {
      const added = await onAddManualPath(path);
      if (added) {
        setManualPath("");
        setManualPathOpen(false);
      }
    }
  };

  if (blockingError && error) {
    return (
      <div className="page-scroll">
        <section className="page-heading">
          <div>
            <span className="eyebrow">
              多仓库工作区
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
          <span className="eyebrow">多仓库工作区</span>
          <h1>Workspace 概览</h1>
          <p>
            集中查看仓库变更、同步状态和后台操作；只有在你明确执行操作时，GitNest 才会修改仓库。
          </p>
        </div>
      </section>

      {manualPathOpen && (
        <form
          className="manual-path-form"
          id="manual-path-form"
          onSubmit={submitManualPath}
        >
          <label htmlFor="manual-workspace-path">
            本地目录绝对路径
          </label>
          <div>
            <Input
              autoFocus
              fieldClassName="manual-path-input"
              fullWidth
              id="manual-workspace-path"
              onChange={(event) =>
                setManualPath(event.target.value)
              }
              placeholder="例如 D:\code\sc\sc_code"
              size="small"
              spellCheck={false}
              value={manualPath}
            />
            <Button size="small"
              disabled={busy}
              onClick={() => setManualPathOpen(false)}
              type="button"
            >
              取消
            </Button>
            <Button size="small" variant="primary"
              disabled={busy || !manualPath.trim()}
              type="submit"
            >
              {operation === "scanning" ? "扫描中…" : "扫描并添加"}
            </Button>
          </div>
          <small>
            也可以把一个或多个目录直接拖入窗口。
          </small>
        </form>
      )}

      <ToastViewport>
        {(error || notice) && (
          <Toast
            closeLabel="关闭 Workspace 提示"
            icon={error ? "warning" : "check"}
            key="workspace-toast"
            message={error?.message ?? notice ?? ""}
            onClose={onClearFeedback}
            title={error ? "Workspace 操作未完成" : "操作完成"}
            tone={error ? "error" : "success"}
          />
        )}
      </ToastViewport>

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
            <button
              aria-controls="workspace-overview-repository-status"
              aria-expanded={!repositoryStatusCollapsed}
              className="panel-header panel-header-toggle"
              onClick={() =>
                setRepositoryStatusCollapsed(
                  (collapsed) => !collapsed
                )
              }
              type="button"
            >
              <span className="panel-title">
                <Icon name="repository" />
                仓库状态
              </span>
              <span className="panel-caption">
                {statusRows.length > 0
                  ? `${freshCount}/${statusRows.length} 已刷新`
                  : workspace
                    ? `${workspace.entries.length} 个顶层条目`
                    : "正在恢复…"}
              </span>
              <Icon
                className="panel-collapse-indicator"
                name="chevron"
                size={14}
              />
            </button>
            <div
              aria-hidden={repositoryStatusCollapsed}
              className="panel-collapsible-body"
              hidden={repositoryStatusCollapsed}
              id="workspace-overview-repository-status"
            >
              {statusRows.length > 0 && workspace ? (
                <div
                  aria-label="仓库状态"
                  className="repository-status-table"
                  role="list"
                >
                  <div
                    aria-hidden="true"
                    className="repository-status-row repository-status-head"
                  >
                    <span>仓库</span>
                    <span>分支</span>
                    <span>工作区</span>
                    <span>远程同步</span>
                  </div>
                  {statusRows.map(
                    ({ target, repository, worktree, snapshot }) => {
                      const name =
                        worktree?.name ??
                        repository?.name ??
                        "未知仓库";
                      const branch =
                        snapshot?.branch ??
                        worktree?.branch ??
                        "detached";
                      const state = workspaceStatusLabel(snapshot);
                      const sync = syncLabel(snapshot);
                      const selected = repositoryTargetSelected(
                        workspace.selectedTarget,
                        target
                      );

                      return (
                        <div
                          className="repository-status-item"
                          key={`${target.repositoryId}:${target.worktreeId}`}
                          role="listitem"
                        >
                          <Button variant="unstyled"
                            aria-current={
                              selected ? "true" : undefined
                            }
                            aria-label={`${name}，分支 ${branch}，工作区 ${state}，同步 ${sync}`}
                            className={`repository-status-row${
                              selected ? " selected" : ""
                            }`}
                            onClick={() => onSelectTarget(target)}
                            type="button"
                          >
                            <span className="table-name">
                              <span
                                className={`repository-state ${snapshotTone(snapshot)}`}
                              >
                                <Icon name="repository" size={13} />
                              </span>
                              <span
                                className="table-name-copy"
                                title={name}
                              >
                                {name}
                                <small
                                  title={worktree?.path ?? "路径不可用"}
                                >
                                  {worktree?.path ?? "路径不可用"}
                                </small>
                              </span>
                            </span>
                            <span
                              className="repository-status-branch"
                              title={branch}
                            >
                              {branch}
                            </span>
                            <span>
                              <span
                                className={`status-pill ${snapshotPillTone(snapshot)}`}
                              >
                                {state}
                              </span>
                            </span>
                            <span
                              className="repository-status-sync"
                              title={sync}
                            >
                              {sync}
                            </span>
                          </Button>
                        </div>
                      );
                    }
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
                    <Button size="small" variant="primary"
                      disabled={busy}
                      onClick={onAddDirectory}
                      type="button"
                    >
                      <Icon name="plus" />
                      添加第一个目录
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </article>
        </div>

        <div>
          <WorkspaceRecentCommitsPanel
            collapsed={recentCommitsCollapsed}
            recentCommits={recentCommits}
            rows={recentRows}
            onToggle={() =>
              setRecentCommitsCollapsed(
                (collapsed) => !collapsed
              )
            }
            onSelectTarget={onSelectTarget}
          />
          <WorkspaceBranchDistributionPanel
            distribution={branchDistribution}
            totalRows={statusRows.length}
          />
        </div>
      </section>
    </div>
  );
}

function WorkspaceRecentCommitsPanel({
  collapsed,
  recentCommits,
  rows,
  onSelectTarget,
  onToggle
}: {
  collapsed: boolean;
  recentCommits: Map<string, CommitSummaryDto>;
  rows: StatusRow[];
  onSelectTarget(target: RepositoryTargetDto): void;
  onToggle(): void;
}) {
  return (
    <article className="panel">
      <button
        aria-controls="workspace-overview-recent-commits"
        aria-expanded={!collapsed}
        className="panel-header panel-header-toggle"
        onClick={onToggle}
        type="button"
      >
        <span className="panel-title">
          <Icon name="history" />
          各仓库最近提交
        </span>
        <span className="panel-caption">
          每仓库采集 1 条
        </span>
        <Icon
          className="panel-collapse-indicator"
          name="chevron"
          size={14}
        />
      </button>
      <div
        aria-hidden={collapsed}
        className="panel-collapsible-body"
        hidden={collapsed}
        id="workspace-overview-recent-commits"
      >
        {rows.length > 0 ? (
          <div className="workspace-activity-list">
            {rows.map(
              ({ target, repository, worktree, snapshot }, index) => {
                const name =
                  worktree?.name ??
                  repository?.name ??
                  "未知仓库";
                const commit = recentCommits.get(targetKey(target));
                const detail = commit
                  ? `${commit.shortHash} · ${commit.subject}`
                  : snapshot
                    ? `${shortHead(snapshot.head)} · ${workspaceActivityStatus(
                        snapshot
                      )}`
                    : "等待状态刷新";
                const time = commit
                  ? formatCommitTimestamp(commit.authoredAt)
                  : snapshot
                    ? formatCommitTimestamp(snapshot.refreshedAt)
                    : "—";

                return (
                  <Button variant="unstyled"
                    aria-label={`${name} 的 HEAD 最近提交，${detail}，${time}`}
                    className={`workspace-activity-row${
                      index === rows.length - 1 ? " last" : ""
                    }`}
                    disabled={!snapshot}
                    key={`${target.repositoryId}:${target.worktreeId}`}
                    onClick={() => onSelectTarget(target)}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className={`workspace-activity-marker ${snapshotTone(
                        snapshot
                      )}`}
                    >
                      <Icon name="commit" size={12} />
                    </span>
                    <span className="workspace-activity-copy">
                      <span className="workspace-activity-title">
                        <strong>{name}</strong> 的 HEAD 最近提交
                      </span>
                      <span className="workspace-activity-sub">
                        {commit ? (
                          <>
                            <code>{commit.shortHash}</code>
                            {" · "}
                            {commit.subject}
                          </>
                        ) : snapshot ? (
                          <>
                            <code>{shortHead(snapshot.head)}</code>
                            {" · "}
                            {workspaceActivityStatus(snapshot)}
                          </>
                        ) : (
                          "等待状态刷新"
                        )}
                      </span>
                    </span>
                    <time
                      className="workspace-activity-meta"
                      dateTime={
                        commit?.authoredAt ??
                        snapshot?.refreshedAt
                      }
                    >
                      {time}
                    </time>
                  </Button>
                );
              }
            )}
          </div>
        ) : (
          <div className="empty-state workspace-empty-state">
            <span className="empty-state-icon">
              <Icon name="history" size={20} />
            </span>
            <div>
              <strong>暂无最近提交</strong>
              <p>完成 Workspace 扫描后，这里会显示各仓库的 HEAD 提交。</p>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function WorkspaceBranchDistributionPanel({
  distribution,
  totalRows
}: {
  distribution: BranchDistributionRow[];
  totalRows: number;
}) {
  return (
    <article className="panel">
      <header className="panel-header">
        <div className="panel-title">
          <Icon name="branch" />
          分支分布
        </div>
        <span className="panel-caption">
          {totalRows} 个当前分支
        </span>
      </header>
      {distribution.length > 0 ? (
        <div className="workspace-branch-distribution">
          {distribution.map((item) => (
            <div
              className="workspace-branch-distribution-item"
              key={item.name}
            >
              <div
                className="workspace-branch-distribution-label"
                title={item.name}
              >
                {item.name}
              </div>
              <strong>{item.count}</strong>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state workspace-empty-state">
          <span className="empty-state-icon">
            <Icon name="branch" size={20} />
          </span>
          <div>
            <strong>暂无分支数据</strong>
            <p>完成 Workspace 扫描后，这里会显示当前分支分布。</p>
          </div>
        </div>
      )}
    </article>
  );
}

type StatusRow = {
  target: RepositoryTargetDto;
  repository: ReturnType<typeof resolveWorkspaceTarget>["repository"];
  worktree: ReturnType<typeof resolveWorkspaceTarget>["worktree"];
  snapshot: RepositoryStatusSnapshotDto | undefined;
};

type BranchDistributionRow = {
  name: string;
  count: number;
};

function compareRecentStatusRows(
  left: StatusRow,
  right: StatusRow,
  recentCommits: Map<string, CommitSummaryDto>
): number {
  return (
    commitTimestamp(
      recentCommits.get(targetKey(right.target)),
      right.snapshot
    ) -
      commitTimestamp(
        recentCommits.get(targetKey(left.target)),
        left.snapshot
      ) ||
    (left.worktree?.name ?? left.repository?.name ?? "").localeCompare(
      right.worktree?.name ?? right.repository?.name ?? "",
      undefined,
      { sensitivity: "base" }
    )
  );
}

function snapshotTimestamp(
  snapshot: RepositoryStatusSnapshotDto | undefined
): number {
  if (!snapshot) {
    return Number.NEGATIVE_INFINITY;
  }
  const timestamp = new Date(snapshot.refreshedAt).getTime();
  return Number.isNaN(timestamp)
    ? Number.NEGATIVE_INFINITY
    : timestamp;
}

function commitTimestamp(
  commit: CommitSummaryDto | undefined,
  snapshot: RepositoryStatusSnapshotDto | undefined
): number {
  const authoredAt = commit
    ? new Date(commit.authoredAt).getTime()
    : Number.NaN;
  if (!Number.isNaN(authoredAt)) {
    return authoredAt;
  }
  return snapshotTimestamp(snapshot);
}

function targetKey(target: RepositoryTargetDto): string {
  return `${target.repositoryId}:${target.worktreeId}`;
}

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
  if (snapshot?.error || snapshot?.conflicted) {
    return "danger";
  }
  if (!snapshot || snapshot.stale) {
    return "idle";
  }
  if (getSnapshotChangeCount(snapshot) > 0) {
    return "warning";
  }
  return "clean";
}

function snapshotPillTone(
  snapshot: RepositoryStatusSnapshotDto | undefined
): "neutral" | "blue" | "green" | "yellow" | "red" {
  if (snapshot?.error || snapshot?.conflicted) {
    return "red";
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

function workspaceActivityStatus(
  snapshot: RepositoryStatusSnapshotDto
): string {
  if (snapshot.error) {
    return "读取失败";
  }
  if (snapshot.refreshPending) {
    return "正在刷新";
  }
  return `${snapshot.branch ?? "detached"} · ${syncLabel(snapshot)}`;
}

function shortHead(head: string): string {
  return head ? head.slice(0, 7) : "—";
}
