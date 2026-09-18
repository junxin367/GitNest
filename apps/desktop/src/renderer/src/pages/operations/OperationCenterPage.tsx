import { Button } from "../../shared/ui/Button";
import {
  useEffect,
  useMemo,
  useState
} from "react";

import type {
  RepositoryStatusSnapshotDto,
  RepositoryTargetDto,
  WorkspaceDetailsDto,
  WorkspaceOperationDto
} from "@gitnest/contracts";

import type { RepositoryCommandController } from "../../features/repository-command/useRepositoryCommands";
import {
  listWorkspaceTargets,
  resolveWorkspaceTarget
} from "../../entities/workspace/model";
import { Icon } from "../../shared/ui/Icon";
import {
  Skeleton,
  SkeletonBoundary
} from "../../shared/ui/Skeleton";
import { Toast, ToastViewport } from "../../shared/ui/Toast";

type OperationFilter =
  | "all"
  | "active"
  | "failed"
  | "completed";

interface OperationCenterPageProps {
  loading: boolean;
  workspace: WorkspaceDetailsDto | null;
  snapshots: RepositoryStatusSnapshotDto[];
  operations: WorkspaceOperationDto[];
  commands: RepositoryCommandController;
  onOpenTarget(target: RepositoryTargetDto): void;
}

export function OperationCenterPage({
  loading,
  workspace,
  snapshots,
  operations,
  commands,
  onOpenTarget
}: OperationCenterPageProps) {
  const [filter, setFilter] =
    useState<OperationFilter>("all");
  const [now, setNow] = useState(Date.now());

  const targets = useMemo(
    () => (workspace ? listWorkspaceTargets(workspace) : []),
    [workspace]
  );
  const snapshotByTarget = useMemo(
    () =>
      new Map(
        snapshots.map((snapshot) => [
          operationTargetKey(snapshot),
          snapshot
        ])
      ),
    [snapshots]
  );
  const pullTargets = useMemo(
    () =>
      targets.filter((target) => {
        const snapshot = snapshotByTarget.get(
          operationTargetKey(target)
        );
        return Boolean(
          snapshot?.upstream &&
            snapshot.behind > 0 &&
            snapshot.staged === 0 &&
            snapshot.unstaged === 0 &&
            snapshot.untracked === 0 &&
            snapshot.conflicted === 0
        );
      }),
    [snapshotByTarget, targets]
  );
  const pushTargets = useMemo(
    () =>
      targets.filter((target) => {
        const snapshot = snapshotByTarget.get(
          operationTargetKey(target)
        );
        return Boolean(snapshot?.branch && snapshot.ahead > 0);
      }),
    [snapshotByTarget, targets]
  );
  const visibleOperations = useMemo(
    () =>
      operations.filter((operation) =>
        operationMatchesFilter(operation, filter)
      ),
    [filter, operations]
  );
  const operationCounts = useMemo(
    () =>
      operations.reduce(
        (counts, operation) => {
          if (isActive(operation.state)) {
            counts.active += 1;
          } else if (
            operation.state === "failed" ||
            operation.state === "interrupted"
          ) {
            counts.failed += 1;
          } else if (operation.state === "succeeded") {
            counts.completed += 1;
          }
          return counts;
        },
        { active: 0, completed: 0, failed: 0 }
      ),
    [operations]
  );
  const hasActiveOperations = operationCounts.active > 0;

  useEffect(() => {
    if (!hasActiveOperations) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [hasActiveOperations]);

  if (!workspace) {
    return (
      <SkeletonBoundary
        fallback={<OperationCenterSkeleton />}
        hasContent={false}
        label="正在读取操作中心"
        loading={loading}
        surfaceClassName="page-scroll operation-center-page gn-page-skeleton"
      >
        <div className="page-scroll operation-center-page">
          <section className="page-heading">
            <div>
              <h1>操作中心</h1>
              <p>当前没有可展示的 Workspace 操作记录。</p>
            </div>
          </section>
          <div className="empty-state">
            <span className="empty-state-icon">
              <Icon name="operations" size={20} />
            </span>
            <div>
              <strong>暂无操作记录</strong>
              <p>添加 Workspace 后，后台任务会显示在这里。</p>
            </div>
          </div>
        </div>
      </SkeletonBoundary>
    );
  }
  return (
    <div className="page-scroll operation-center-page">
      <section className="page-heading">
        <div>
          <h1>操作中心</h1>
          <p>
            Workspace 与单仓操作统一展示目标、阶段、进度、耗时和终态；取消不会伪造对已完成 Git 写入的回滚。
          </p>
        </div>
      </section>

      <ToastViewport>
        {(commands.error || commands.notice) && (
          <Toast
            closeLabel="关闭操作提示"
            icon={commands.error ? "warning" : "check"}
            key="operation-feedback"
            message={
              commands.error?.message ??
              commands.notice ??
              ""
            }
            onClose={commands.clearFeedback}
            title={
              commands.error
                ? "仓库操作未完成"
                : "仓库操作状态"
            }
            tone={commands.error ? "error" : "success"}
          />
        )}
      </ToastViewport>

      <section className="operation-metric-grid">
        <OperationMetric
          description="正在排队或执行的任务"
          icon="refresh"
          label="活动"
          tone="blue"
          value={operationCounts.active}
        />
        <OperationMetric
          description="最近完成的仓库操作"
          icon="check"
          label="成功"
          tone="green"
          value={operationCounts.completed}
        />
        <OperationMetric
          description="需要人工处理"
          icon="warning"
          label="失败"
          tone="yellow"
          value={operationCounts.failed}
        />
        <OperationMetric
          description="当前 Workspace 操作记录"
          icon="operations"
          label="记录"
          tone="accent"
          value={operations.length}
        />
      </section>

      <article className="panel bulk-sync-panel">
        <header className="panel-header">
          <div className="panel-title">
            <Icon name="operations" />
            Workspace 批量同步
          </div>
          <span className="panel-caption">
            每个仓库独立入队并保留独立结果
          </span>
        </header>
        <div className="bulk-sync-actions">
          <Button size="small"
            disabled={commands.busy || targets.length === 0}
            onClick={() =>
              void commands.request({
                type: "fetch",
                targets
              })
            }
            type="button"
          >
            <Icon name="download" />
            Fetch 全部 ({targets.length})
          </Button>
          <Button size="small"
            disabled={
              commands.busy || pullTargets.length === 0
            }
            onClick={() =>
              void commands.request({
                type: "pull",
                targets: pullTargets,
                strategy: "ff-only"
              })
            }
            type="button"
          >
            <Icon name="download" />
            Pull 可快进项 ({pullTargets.length})
          </Button>
          <Button size="small"
            disabled={
              commands.busy || pushTargets.length === 0
            }
            onClick={() =>
              void commands.request({
                type: "push",
                targets: pushTargets
              })
            }
            type="button"
          >
            <Icon name="upload" />
            Push 领先项 ({pushTargets.length})
          </Button>
        </div>
      </article>

      <article className="panel operation-history-panel">
        <header className="panel-header operation-history-header">
          <div className="panel-title">
            <Icon name="activity" />
            操作记录
          </div>
          <div className="operation-filter-tabs">
            {(
              [
                ["all", "全部"],
                ["active", "活动"],
                ["failed", "失败"],
                ["completed", "已完成"]
              ] as const
            ).map(([id, label]) => (
              <Button variant="unstyled"
                aria-pressed={filter === id}
                className={filter === id ? "active" : ""}
                key={id}
                onClick={() => setFilter(id)}
                type="button"
              >
                {label}
              </Button>
            ))}
          </div>
        </header>

        {visibleOperations.length > 0 ? (
          <div className="operation-history-list">
            {visibleOperations.map((operation) => (
              <OperationCard
                commands={commands}
                key={operation.id}
                now={now}
                onOpenTarget={onOpenTarget}
                operation={operation}
                workspace={workspace}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-state-icon">
              <Icon name="check" size={20} />
            </span>
            <div>
              <strong>当前筛选下没有操作</strong>
              <p>启动刷新、同步或仓库写操作后会显示在这里。</p>
              {filter !== "all" && (
                <Button size="small"
                  onClick={() => setFilter("all")}
                  type="button"
                >
                  查看全部操作
                </Button>
              )}
            </div>
          </div>
        )}
      </article>
    </div>
  );
}

function OperationCenterSkeleton() {
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
            <Skeleton height={10} variant="text" width="44%" />
            <Skeleton height={28} width="24%" />
            <Skeleton height={9} variant="text" width="72%" />
          </div>
        ))}
      </div>
      {Array.from({ length: 2 }, (_, panelIndex) => (
        <div className="gn-skeleton-panel" key={panelIndex}>
          <div className="gn-skeleton-panel-header">
            <Skeleton height={14} width="28%" />
            <Skeleton height={10} variant="text" width="22%" />
          </div>
          <div className="gn-skeleton-list">
            {Array.from(
              { length: panelIndex === 0 ? 2 : 5 },
              (_, rowIndex) => (
                <div className="gn-skeleton-row" key={rowIndex}>
                  <div className="gn-skeleton-row-copy">
                    <Skeleton height={11} />
                    <Skeleton height={9} variant="text" />
                  </div>
                  <Skeleton height={18} width="100%" />
                </div>
              )
            )}
          </div>
        </div>
      ))}
    </>
  );
}

function OperationMetric({
  label,
  value,
  icon,
  tone,
  description
}: {
  description: string;
  label: string;
  value: number;
  icon: "refresh" | "check" | "warning" | "operations";
  tone: "blue" | "green" | "yellow" | "accent";
}) {
  return (
    <article className={`operation-metric tone-${tone}`}>
      <div className="operation-metric-label">
        <span>{label}</span>
        <span className="operation-metric-icon">
          <Icon name={icon} />
        </span>
      </div>
      <strong>{value}</strong>
      <p>{description}</p>
    </article>
  );
}

function OperationCard({
  operation,
  workspace,
  commands,
  now,
  onOpenTarget
}: {
  operation: WorkspaceOperationDto;
  workspace: WorkspaceDetailsDto | null;
  commands: RepositoryCommandController;
  now: number;
  onOpenTarget(target: RepositoryTargetDto): void;
}) {
  const targets = resolveOperationTargets(operation, workspace);
  const primaryTarget =
    targets.length === 1 ? targets[0]?.target : undefined;
  const canCancel =
    isRepositoryCommandKind(operation.kind) &&
    (operation.state === "queued" ||
      operation.state === "running" ||
      operation.state === "cancelling");
  const canRetry =
    operation.state === "failed" &&
    ["fetch", "pull", "push"].includes(operation.kind) &&
    Boolean(primaryTarget);

  return (
    <article className="operation-history-card">
      <span
        className={`operation-icon state-${operation.state}`}
      >
        <Icon
          name={
            operation.state === "failed" ||
            operation.state === "interrupted"
              ? "warning"
              : operation.state === "succeeded"
                ? "check"
                : operation.state === "cancelled"
                  ? "close"
                  : "refresh"
          }
          size={15}
        />
      </span>
      <div className="operation-history-copy">
        <div>
          <strong>{operationKindLabel(operation.kind)}</strong>
          <span
            className={`status-pill ${operationStateTone(
              operation.state
            )}`}
          >
            {operationStateLabel(operation.state)}
          </span>
        </div>
        <p>{operation.message}</p>
        <div className="operation-target-list">
          {targets.map(({ target, label, path }) => (
            <Button variant="unstyled"
              key={`${target.repositoryId}:${target.worktreeId}`}
              onClick={() => onOpenTarget(target)}
              title={path}
              type="button"
            >
              <Icon name="repository" size={11} />
              {label}
            </Button>
          ))}
          {targets.length === 0 && (
            <span>{operation.targetIds.length} 个目标</span>
          )}
        </div>
        <div
          aria-label={`${operationKindLabel(operation.kind)}进度`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(
            Math.max(0, Math.min(operation.progress, 1)) * 100
          )}
          className="operation-progress"
          role="progressbar"
        >
          <span
            style={{
              transform: `scaleX(${Math.max(
                0,
                Math.min(operation.progress, 1)
              )})`
            }}
          />
        </div>
      </div>
      <div className="operation-history-meta">
        <span>
          {formatDuration(operation, now)}
        </span>
        <span>
          成功 {operation.succeeded} · 失败 {operation.failed}
        </span>
        <div>
          {canRetry && primaryTarget && (
            <Button variant="unstyled"
              className="mini-action"
              disabled={commands.busy}
              onClick={() =>
                void retryOperation(
                  operation.kind,
                  primaryTarget,
                  commands
                )
              }
              type="button"
            >
              重新预检
            </Button>
          )}
          {canCancel && (
            <Button variant="unstyled"
              className="mini-action danger"
              disabled={operation.state === "cancelling"}
              onClick={() =>
                void commands.cancelOperation(operation.id)
              }
              type="button"
            >
              {operation.state === "cancelling"
                ? "取消中"
                : "取消"}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

function resolveOperationTargets(
  operation: WorkspaceOperationDto,
  workspace: WorkspaceDetailsDto | null
): Array<{
  target: RepositoryTargetDto;
  label: string;
  path: string;
}> {
  if (!workspace) {
    return [];
  }
  return operation.targetIds.flatMap((targetId) => {
    const separator = targetId.indexOf(":");
    if (separator < 1) {
      return [];
    }
    const target = {
      repositoryId: targetId.slice(0, separator),
      worktreeId: targetId.slice(separator + 1)
    };
    const resolved = resolveWorkspaceTarget(workspace, target);
    if (!resolved.worktree) {
      return [];
    }
    return [
      {
        target,
        label:
          resolved.worktree.name ??
          resolved.repository?.name ??
          target.repositoryId,
        path: resolved.worktree.path
      }
    ];
  });
}

function retryOperation(
  kind: WorkspaceOperationDto["kind"],
  target: RepositoryTargetDto,
  commands: RepositoryCommandController
): Promise<boolean> {
  if (kind === "fetch") {
    return commands.request({
      type: "fetch",
      targets: [target]
    });
  }
  if (kind === "pull") {
    return commands.request({
      type: "pull",
      targets: [target],
      strategy: "ff-only"
    });
  }
  return commands.request({
    type: "push",
    targets: [target]
  });
}

function operationMatchesFilter(
  operation: WorkspaceOperationDto,
  filter: OperationFilter
): boolean {
  if (filter === "active") {
    return isActive(operation.state);
  }
  if (filter === "failed") {
    return (
      operation.state === "failed" ||
      operation.state === "interrupted"
    );
  }
  if (filter === "completed") {
    return (
      operation.state === "succeeded" ||
      operation.state === "cancelled"
    );
  }
  return true;
}

function operationTargetKey(
  target: RepositoryTargetDto
): string {
  return `${target.repositoryId}\u0000${target.worktreeId}`;
}

function isActive(
  state: WorkspaceOperationDto["state"]
): boolean {
  return (
    state === "queued" ||
    state === "running" ||
    state === "cancelling"
  );
}

function isRepositoryCommandKind(
  kind: WorkspaceOperationDto["kind"]
): boolean {
  return [
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
  ].includes(kind);
}

function operationKindLabel(
  kind: WorkspaceOperationDto["kind"]
): string {
  return {
    scan: "Workspace 扫描",
    status: "仓库状态刷新",
    stage: "暂存文件",
    unstage: "取消暂存",
    discard: "放弃更改",
    commit: "创建提交",
    "stash-apply": "恢复储藏",
    "stash-drop": "删除储藏",
    "stash-pop": "恢复并删除储藏",
    fetch: "Fetch",
    pull: "Pull",
    push: "Push",
    "switch-branch": "切换分支",
    "create-branch": "创建分支",
    "rename-branch": "重命名分支",
    "delete-branch": "删除分支",
    "worktree-create": "创建 Worktree",
    "worktree-lock": "锁定 Worktree",
    "worktree-unlock": "解锁 Worktree",
    "worktree-move": "移动 Worktree",
    "worktree-repair": "修复 Worktree 登记",
    "worktree-prune": "清除失效 Worktree 登记",
    "worktree-remove": "移除 Worktree"
  }[kind];
}

function operationStateLabel(
  state: WorkspaceOperationDto["state"]
): string {
  return {
    queued: "排队中",
    running: "运行中",
    cancelling: "取消中",
    succeeded: "成功",
    failed: "失败",
    cancelled: "已取消",
    interrupted: "已中断"
  }[state];
}

function operationStateTone(
  state: WorkspaceOperationDto["state"]
): "neutral" | "blue" | "green" | "yellow" | "red" {
  if (state === "succeeded") {
    return "green";
  }
  if (state === "failed" || state === "interrupted") {
    return "red";
  }
  if (
    state === "queued" ||
    state === "running" ||
    state === "cancelling"
  ) {
    return "blue";
  }
  return "neutral";
}

function formatDuration(
  operation: WorkspaceOperationDto,
  now: number
): string {
  if (!operation.startedAt) {
    return "尚未开始";
  }
  const startedAt = Date.parse(operation.startedAt);
  const finishedAt = operation.finishedAt
    ? Date.parse(operation.finishedAt)
    : now;
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(finishedAt)
  ) {
    return "耗时未知";
  }
  const seconds = Math.max(
    0,
    Math.round((finishedAt - startedAt) / 1_000)
  );
  if (seconds < 60) {
    return `${seconds} 秒`;
  }
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
