import {
  useEffect,
  useState,
  type FormEvent
} from "react";

import type {
  RepositoryStatusSnapshotDto,
  WorkspaceDetailsDto,
  WorkspaceWorktreeDto
} from "@gitnest/contracts";

import type { WorktreeCommandController } from "../../features/worktree-command/useWorktreeCommands";
import { Icon, type IconName } from "../../shared/ui/Icon";

interface RepositoryWorktreesProps {
  workspace: WorkspaceDetailsDto;
  repositoryId: string;
  worktreeId: string;
  snapshots: RepositoryStatusSnapshotDto[];
  commands: WorktreeCommandController;
  directoryOpening: boolean;
  onOpenDirectory(worktreeId: string): void;
}

export function RepositoryWorktrees({
  workspace,
  repositoryId,
  worktreeId,
  snapshots,
  commands,
  directoryOpening,
  onOpenDirectory
}: RepositoryWorktreesProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createPath, setCreatePath] = useState("");
  const [createBranch, setCreateBranch] = useState("");
  const [createStartPoint, setCreateStartPoint] =
    useState("");
  const [lockReasons, setLockReasons] = useState<
    Record<string, string>
  >({});
  const [moveDestinations, setMoveDestinations] = useState<
    Record<string, string>
  >({});
  const repository = workspace.repositories.find(
    (candidate) => candidate.id === repositoryId
  );
  const worktrees = workspace.worktrees.filter(
    (worktree) => worktree.repositoryId === repositoryId
  );
  const prunableCount = worktrees.filter(
    (worktree) => worktree.isPrunable
  ).length;
  const existingCount = worktrees.length - prunableCount;
  const detachedCount = worktrees.filter(
    (worktree) => worktree.isDetached || !worktree.branch
  ).length;
  const currentWorktree =
    worktrees.find((worktree) => worktree.id === worktreeId) ??
    worktrees.find((worktree) => worktree.isPrimary) ??
    worktrees[0];
  const currentSnapshot = currentWorktree
    ? snapshots.find(
        (snapshot) =>
          snapshot.repositoryId === repositoryId &&
          snapshot.worktreeId === currentWorktree.id
      )
    : undefined;

  useEffect(() => {
    setCreatePath("");
    setCreateBranch("");
    setCreateStartPoint("");
    setLockReasons({});
    setMoveDestinations({});
    setCreateOpen(false);
    commands.clearFeedback();
  }, [repositoryId]);

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    const path = createPath.trim();
    const branch = createBranch.trim();
    const startPoint = createStartPoint.trim();
    if (!path) {
      return;
    }
    void commands.request({
      type: "create",
      repositoryId,
      path,
      ...(branch ? { branch } : {}),
      ...(startPoint ? { startPoint } : {})
    }).then((accepted) => {
      if (accepted) {
        setCreateOpen(false);
      }
    });
  };

  if (!repository) {
    return (
      <div className="empty-state repository-empty-state">
        <span className="empty-state-icon warning-icon">
          <Icon name="warning" size={20} />
        </span>
        <div>
          <strong>仓库实例已不可用</strong>
          <p>请从左侧 Workspace 树重新选择一个有效仓库。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="worktree-management">
      <div className="page-heading worktree-page-heading">
        <div>
          <h1>{repository.name} Worktrees</h1>
          <p>
            显示本次只读扫描得到的登记数量与当前工作目录。
            聚合仓库可展开全部 {worktrees.length} 条实际登记路径。
          </p>
        </div>
        <div className="page-actions">
          <button
            aria-busy={commands.active === "prune"}
            className="button"
            disabled={commands.busy || prunableCount === 0}
            onClick={() =>
              void commands.request({
                type: "prune",
                repositoryId
              })
            }
            type="button"
          >
            <Icon name="eye" />
            Prune 预览
          </button>
          <button
            aria-controls="worktree-create-panel"
            aria-expanded={createOpen}
            className="button primary"
            onClick={() => setCreateOpen((open) => !open)}
            type="button"
          >
            <Icon name={createOpen ? "close" : "plus"} />
            {createOpen ? "收起创建" : "新建 Worktree"}
          </button>
        </div>
      </div>

      <div className="metric-grid worktree-metric-grid">
        <WorktreeMetricCard
          description="包含当前主工作目录"
          icon="worktree"
          label="已登记"
          tone="purple"
          value={worktrees.length}
        />
        <WorktreeMetricCard
          description="按可清理记录反推"
          icon="check"
          label="目录存在"
          tone="green"
          value={existingCount}
        />
        <WorktreeMetricCard
          description="gitdir 指向不存在位置"
          icon="warning"
          label="可清理"
          tone="red"
          value={prunableCount}
        />
        <WorktreeMetricCard
          description="未关联本地分支"
          icon="branch"
          label="Detached"
          tone="yellow"
          value={detachedCount}
        />
      </div>

      {currentWorktree ? (
        <div className="worktree-grid worktree-summary-grid">
          <WorktreeSummaryCard
            directoryOpening={directoryOpening}
            onOpenDirectory={onOpenDirectory}
            snapshot={currentSnapshot}
            worktree={currentWorktree}
          />
        </div>
      ) : (
        <div className="empty-state repository-empty-state">
          <span className="empty-state-icon">
            <Icon name="worktree" size={20} />
          </span>
          <div>
            <strong>没有可展示的 Worktree</strong>
            <p>创建或修复 Worktree 后会显示在这里。</p>
          </div>
        </div>
      )}

      {createOpen && (
        <section
          className="worktree-management-grid"
          id="worktree-create-panel"
        >
          <article className="panel worktree-create-panel">
            <header className="panel-header">
              <div className="panel-title">
                <Icon name="plus" />
                创建 Worktree
              </div>
              <span className="panel-caption">
                已有分支或新分支；留空分支将创建 detached HEAD
              </span>
            </header>
            <form onSubmit={submitCreate}>
              <div className="field">
                <label htmlFor="worktree-create-path">
                  目标绝对路径
                </label>
                <div className="worktree-path-input">
                  <input
                    aria-label="Worktree 目标绝对路径"
                    disabled={commands.busy}
                    id="worktree-create-path"
                    onChange={(event) =>
                      setCreatePath(event.target.value)
                    }
                    placeholder="C:\worktrees\feature-name"
                    spellCheck={false}
                    value={createPath}
                  />
                  <button
                    className="button"
                    disabled={commands.busy}
                    onClick={() => {
                      void commands
                        .chooseDirectory()
                        .then((path) => {
                          if (path) {
                            setCreatePath(path);
                          }
                        });
                    }}
                    type="button"
                  >
                    <Icon name="folder" />
                    选择
                  </button>
                </div>
                <small>
                  可选择一个空目录，或选择父目录后在路径末尾补充新目录名。
                </small>
              </div>
              <div className="worktree-create-fields">
                <label className="field">
                  <span>分支（可选）</span>
                  <input
                    disabled={commands.busy}
                    onChange={(event) =>
                      setCreateBranch(event.target.value)
                    }
                    placeholder="feature/worktree"
                    spellCheck={false}
                    value={createBranch}
                  />
                </label>
                <label className="field">
                  <span>起点（可选）</span>
                  <input
                    disabled={commands.busy}
                    onChange={(event) =>
                      setCreateStartPoint(event.target.value)
                    }
                    placeholder="HEAD 或提交"
                    spellCheck={false}
                    value={createStartPoint}
                  />
                </label>
              </div>
              <div className="worktree-form-footer">
                <span>
                  目标必须不存在或为空，且不能与已有 Worktree 重叠。
                </span>
                <button
                  aria-busy={commands.active === "create"}
                  className="button primary"
                  disabled={commands.busy || !createPath.trim()}
                  type="submit"
                >
                  <Icon
                    name={
                      commands.active === "create"
                        ? "refresh"
                        : "plus"
                    }
                  />
                  {commands.active === "create"
                    ? "预检中…"
                    : "预检并创建"}
                </button>
              </div>
            </form>
          </article>

          <article className="panel worktree-safety-panel">
            <header className="panel-header">
              <div className="panel-title">
                <Icon name="worktree" />
                安全边界
              </div>
            </header>
            <ul>
              <li>Primary Worktree 永不允许移除。</li>
              <li>脏、冲突、锁定目录不允许 Remove。</li>
              <li>Move/Remove 不提供强制模式。</li>
              <li>Prune 只清理失效 Git 登记。</li>
            </ul>
            <button
              aria-busy={commands.active === "prune"}
              className="button"
              disabled={commands.busy || prunableCount === 0}
              onClick={() =>
                void commands.request({
                  type: "prune",
                  repositoryId
                })
              }
              type="button"
            >
              <Icon name="refresh" />
              预检 Prune ({prunableCount})
            </button>
          </article>
        </section>
      )}

      {worktrees.length > 0 && (
        <details className="worktree-inventory-disclosure">
          <summary>
            展开全部 {worktrees.length} 条实际登记路径
          </summary>
          <section className="worktree-inventory">
            <header className="worktree-inventory-header">
              <div>
                <span className="eyebrow">Git common directory</span>
                <h2>已登记 Worktrees</h2>
              </div>
              <span>
                {worktrees.length} 个目录 · {prunableCount} 个失效登记
              </span>
            </header>

            <div className="worktree-grid">
              {worktrees.map((worktree) => {
                const snapshot = snapshots.find(
                  (candidate) =>
                    candidate.repositoryId === repositoryId &&
                    candidate.worktreeId === worktree.id
                );
                const dirty = Boolean(
                  snapshot &&
                    (snapshot.staged > 0 ||
                      snapshot.unstaged > 0 ||
                      snapshot.untracked > 0 ||
                      snapshot.conflicted > 0)
                );
                return (
                  <WorktreeCard
                    commands={commands}
                    dirty={dirty}
                    key={worktree.id}
                    lockReason={lockReasons[worktree.id] ?? ""}
                    moveDestination={
                      moveDestinations[worktree.id] ?? ""
                    }
                    onLockReasonChange={(value) =>
                      setLockReasons((current) => ({
                        ...current,
                        [worktree.id]: value
                      }))
                    }
                    onMoveDestinationChange={(value) =>
                      setMoveDestinations((current) => ({
                        ...current,
                        [worktree.id]: value
                      }))
                    }
                    worktree={worktree}
                  />
                );
              })}
            </div>

            {worktrees.length === 0 && (
              <div className="empty-state repository-empty-state">
                <span className="empty-state-icon">
                  <Icon name="worktree" size={20} />
                </span>
                <div>
                  <strong>没有可展示的 Worktree</strong>
                  <p>创建或修复 Worktree 后会显示在这里。</p>
                </div>
              </div>
            )}
          </section>
        </details>
      )}
    </div>
  );
}

function WorktreeMetricCard({
  icon,
  label,
  value,
  description,
  tone
}: {
  icon: IconName;
  label: string;
  value: number;
  description: string;
  tone: "green" | "purple" | "red" | "yellow";
}) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <div className="metric-label">
        <span>{label}</span>
        <span className="metric-icon">
          <Icon name={icon} size={14} />
        </span>
      </div>
      <strong className="metric-value">{value}</strong>
      <span className="metric-foot">{description}</span>
    </article>
  );
}

function WorktreeSummaryCard({
  worktree,
  snapshot,
  directoryOpening,
  onOpenDirectory
}: {
  worktree: WorkspaceWorktreeDto;
  snapshot: RepositoryStatusSnapshotDto | undefined;
  directoryOpening: boolean;
  onOpenDirectory(worktreeId: string): void;
}) {
  const changes = snapshot ? worktreeChangeCount(snapshot) : 0;
  const status = snapshot
    ? changes > 0
      ? `${changes} 项变更`
      : "工作区干净"
    : "状态待刷新";

  return (
    <article className="worktree-card worktree-summary-card primary">
      <div className="worktree-card-head">
        <span className="worktree-symbol">
          <Icon name="worktree" size={20} />
        </span>
        <span className="worktree-card-head-copy">
          <span className="worktree-title">当前工作目录</span>
          <span className="worktree-branch">
            <Icon name="branch" size={11} />
            <span>{worktree.branch ?? "detached"}</span>
          </span>
        </span>
        <span className="status-pill green worktree-card-status">
          {worktree.isPrimary ? "Primary" : "Current"}
        </span>
      </div>
      <div className="worktree-path" title={worktree.path}>
        {worktree.path}
      </div>
      <div className="worktree-foot">
        <span>{shortWorktreeHead(worktree.head)}</span>
        <span>·</span>
        <span
          className={
            changes > 0
              ? "worktree-summary-status dirty"
              : "worktree-summary-status"
          }
        >
          {status}
        </span>
        <span className="spacer" />
        <button
          className="worktree-open-button"
          disabled={directoryOpening}
          onClick={() => onOpenDirectory(worktree.id)}
          type="button"
        >
          <Icon name="folder" size={12} />
          打开
        </button>
      </div>
    </article>
  );
}

function worktreeChangeCount(
  snapshot: RepositoryStatusSnapshotDto
): number {
  return (
    snapshot.staged +
    snapshot.unstaged +
    snapshot.untracked +
    snapshot.conflicted
  );
}

function shortWorktreeHead(head: string): string {
  return head ? head.slice(0, 7) : "—";
}

function WorktreeCard({
  worktree,
  dirty,
  commands,
  lockReason,
  moveDestination,
  onLockReasonChange,
  onMoveDestinationChange
}: {
  worktree: WorkspaceWorktreeDto;
  dirty: boolean;
  commands: WorktreeCommandController;
  lockReason: string;
  moveDestination: string;
  onLockReasonChange(value: string): void;
  onMoveDestinationChange(value: string): void;
}) {
  const linked = !worktree.isPrimary && !worktree.isBare;
  const mutable =
    linked && !worktree.isLocked && !worktree.isPrunable;
  const removable = mutable && !dirty;

  return (
    <article
      className={`worktree-card worktree-management-card${
        worktree.isPrunable ? " prunable" : ""
      }`}
    >
      <div className="worktree-card-heading">
        <span className="runtime-hero-icon">
          <Icon name="worktree" size={20} />
        </span>
        <div>
          <strong>{worktree.name}</strong>
          <code title={worktree.path}>{worktree.path}</code>
        </div>
      </div>

      <div className="worktree-badges">
        <span className="status-pill neutral">
          {worktree.isPrimary ? "Primary" : "Linked"}
        </span>
        <span className="status-pill blue">
          {worktree.branch ?? "detached"}
        </span>
        {worktree.isLocked && (
          <span className="status-pill yellow">Locked</span>
        )}
        {worktree.isPrunable && (
          <span className="status-pill yellow">Prunable</span>
        )}
        {dirty && (
          <span className="status-pill yellow">有未提交变更</span>
        )}
      </div>

      {(worktree.lockReason || worktree.pruneReason) && (
        <div className="worktree-reason">
          {worktree.lockReason && (
            <span>锁定原因：{worktree.lockReason}</span>
          )}
          {worktree.pruneReason && (
            <span>失效原因：{worktree.pruneReason}</span>
          )}
        </div>
      )}

      <div className="worktree-card-actions">
        {linked && !worktree.isLocked && !worktree.isPrunable && (
          <div className="worktree-inline-action">
            <input
              aria-label={`${worktree.name} 锁定原因`}
              disabled={commands.busy}
              maxLength={512}
              onChange={(event) =>
                onLockReasonChange(event.target.value)
              }
              placeholder="锁定原因（可选）"
              value={lockReason}
            />
            <button
              className="mini-action"
              disabled={commands.busy}
              onClick={() =>
                void commands.request({
                  type: "lock",
                  worktreeId: worktree.id,
                  ...(lockReason.trim()
                    ? { reason: lockReason.trim() }
                    : {})
                })
              }
              type="button"
            >
              锁定
            </button>
          </div>
        )}

        {linked && worktree.isLocked && (
          <button
            className="button"
            disabled={commands.busy}
            onClick={() =>
              void commands.request({
                type: "unlock",
                worktreeId: worktree.id
              })
            }
            type="button"
          >
            解锁 Worktree
          </button>
        )}

        {mutable && (
          <div className="worktree-inline-action move">
            <input
              aria-label={`${worktree.name} 移动目标`}
              disabled={commands.busy}
              onChange={(event) =>
                onMoveDestinationChange(event.target.value)
              }
              placeholder="新的绝对路径"
              spellCheck={false}
              value={moveDestination}
            />
            <button
              aria-label={`选择 ${worktree.name} 移动父目录`}
              className="mini-action"
              disabled={commands.busy}
              onClick={() => {
                void commands
                  .chooseDirectory()
                  .then((path) => {
                    if (path) {
                      onMoveDestinationChange(
                        joinWindowsPath(
                          path,
                          pathBasename(worktree.path)
                        )
                      );
                    }
                  });
              }}
              type="button"
            >
              选择
            </button>
            <button
              className="mini-action"
              disabled={
                commands.busy || !moveDestination.trim()
              }
              onClick={() =>
                void commands.request({
                  type: "move",
                  worktreeId: worktree.id,
                  destination: moveDestination.trim()
                })
              }
              type="button"
            >
              移动
            </button>
          </div>
        )}

        <div className="worktree-button-row">
          <button
            className="button"
            disabled={commands.busy || worktree.isBare}
            onClick={() =>
              void commands.request({
                type: "repair",
                worktreeId: worktree.id
              })
            }
            type="button"
          >
            修复登记
          </button>
          {linked && (
            <button
              className="button danger"
              disabled={commands.busy || !removable}
              onClick={() =>
                void commands.request({
                  type: "remove",
                  worktreeId: worktree.id
                })
              }
              title={
                worktree.isLocked
                  ? "请先解锁 Worktree"
                  : worktree.isPrunable
                    ? "失效登记请使用 Prune"
                    : dirty
                      ? "脏 Worktree 不允许移除"
                      : "安全移除 linked Worktree"
              }
              type="button"
            >
              移除
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function pathBasename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || "worktree";
}

function joinWindowsPath(parent: string, child: string): string {
  return `${parent.replace(/[\\/]+$/, "")}\\${child}`;
}
