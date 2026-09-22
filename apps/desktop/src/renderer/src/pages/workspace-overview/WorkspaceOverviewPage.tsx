import { Button } from "../../shared/ui/Button";
import { useEffect, useMemo, useState } from "react";

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
  listWorkspaceTargets,
  repositoryTargetSelected,
  resolveWorkspaceTarget
} from "../../entities/workspace/model";
import { formatCommitTimestamp } from "../../shared/lib/formatCommitTimestamp";
import type { IconName } from "../../shared/ui/Icon";
import { Icon } from "../../shared/ui/Icon";
import {
  Skeleton,
  SkeletonBoundary
} from "../../shared/ui/Skeleton";
import { Toast, ToastViewport } from "../../shared/ui/Toast";

type LocalWorkspaceOperation =
  | "loading"
  | "selecting"
  | "scanning"
  | "switching"
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
  onCreateWorkspace(): Promise<boolean>;
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
  onCreateWorkspace,
  onSelectTarget,
  onClearFeedback
}: WorkspaceOverviewPageProps) {
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
    () => listWorkspaceTargets(workspace),
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
  const freshCount = scopedSnapshots.filter(
    (snapshot) => !snapshot.stale && !snapshot.error
  ).length;
  const repositories = workspace?.repositories ?? [];
  const worktrees = workspace?.worktrees ?? [];
  const groups = workspace?.groups ?? [];
  const scanIssues = workspace?.scanIssues ?? [];
  const prunableWorktreeCount = worktrees.filter(
    (worktree) => worktree.isPrunable
  ).length;
  const detachedWorktreeCount = worktrees.filter(
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
      value: String(repositories.length),
      foot:
        targets.length > 0
          ? `${freshCount}/${targets.length} 个状态已刷新`
          : "等待 Workspace 扫描",
      icon: "repository",
      tone: "blue"
    },
    {
      label: "Worktrees",
      value: String(worktrees.length),
      foot: `${prunableWorktreeCount} 个可清理 · ${detachedWorktreeCount} 个游离 HEAD`,
      icon: "worktree",
      tone: "purple"
    },
    {
      label: "分组",
      value: String(groups.length),
      foot: `${targets.length} 个仓库目标`,
      icon: "folder",
      tone: "accent"
    },
    {
      label: "扫描问题",
      value: String(scanIssues.length),
      foot:
        scanIssues.length > 0
          ? "部分路径未能完成扫描"
          : workspace?.lastScannedAt
            ? "最近扫描已完成"
            : "尚未执行扫描",
      icon: scanIssues.length > 0 ? "warning" : "check",
      tone: scanIssues.length > 0 ? "yellow" : "blue"
    }
  ];
  const blockingError = isWorkspaceDataBlocked(
    workspace,
    error,
    operation
  );

  if (blockingError && error) {
    return (
      <div className="page-scroll">
        <section className="page-heading">
          <div>
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
    <SkeletonBoundary
      fallback={<WorkspaceOverviewSkeleton />}
      hasContent={Boolean(workspace)}
      label="正在读取 Workspace 概览"
      loading={operation === "loading"}
      surfaceClassName="page-scroll gn-page-skeleton workspace-overview-skeleton"
    >
      <div className="page-scroll">
      <section className="page-heading">
        <div>
          <h1>Workspace 概览</h1>
          <p>
            集中查看仓库变更、同步状态和后台操作；只有在你明确执行操作时，GitNest 才会修改仓库。
          </p>
          <small title={workspace?.path}>
            根目录：{workspace?.path ?? "尚未设置"}
          </small>
        </div>
      </section>

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
                    ? `${workspace.repositories.length} 个仓库`
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
                        : workspace?.path
                          ? "当前 Workspace 暂无扫描结果"
                          : "尚未创建 Workspace"}
                    </strong>
                    <p>
                      {workspace?.path
                        ? "请确认根目录可访问，并重新扫描 Workspace。"
                        : "创建 Workspace 并选择根目录后，GitNest 会扫描其中的仓库和 Worktree。"}
                    </p>
                    {!workspace?.path && (
                      <Button size="small" variant="primary"
                        disabled={busy}
                        onClick={() => void onCreateWorkspace()}
                        type="button"
                      >
                        <Icon name="plus" />
                        创建 Workspace
                      </Button>
                    )}
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
    </SkeletonBoundary>
  );
}

function WorkspaceOverviewSkeleton() {
  return (
    <>
      <div className="gn-skeleton-heading">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
      <div className="gn-skeleton-metric-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="gn-skeleton-card" key={index}>
            <Skeleton height={12} variant="text" width="42%" />
            <Skeleton height={28} width="28%" />
            <Skeleton height={10} variant="text" width="76%" />
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        {Array.from({ length: 2 }, (_, panelIndex) => (
          <div className="gn-skeleton-panel" key={panelIndex}>
            <div className="gn-skeleton-panel-header">
              <Skeleton height={14} width="34%" />
              <Skeleton
                height={10}
                variant="text"
                width="18%"
              />
            </div>
            <div className="gn-skeleton-list">
              {Array.from({ length: 4 }, (_, rowIndex) => (
                <div className="gn-skeleton-row" key={rowIndex}>
                  <div className="gn-skeleton-row-copy">
                    <Skeleton height={11} />
                    <Skeleton height={9} variant="text" />
                  </div>
                  <Skeleton height={18} width="100%" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
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
