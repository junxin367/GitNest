import { Button } from "../../shared/ui/Button";
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
import { Input } from "../../shared/ui/Input";
import {
  WORKTREE_FACET_OPTIONS,
  activeWorktreeFilterCount,
  createWorktreeFilterState,
  isWorktreeSnapshotDirty,
  matchesWorktreeFilters,
  toggleWorktreeFacet,
  worktreeFacetIds,
  type WorktreeFacet,
  type WorktreeFilterState
} from "../../shared/lib/worktreeFilters";

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
  const [filterOpen, setFilterOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [filters, setFilters] = useState<WorktreeFilterState>(
    createWorktreeFilterState
  );
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
  const snapshotFor = (worktree: WorkspaceWorktreeDto) =>
    snapshots.find(
      (snapshot) =>
        snapshot.repositoryId === repositoryId &&
        snapshot.worktreeId === worktree.id
    );
  const visibleWorktrees = worktrees.filter((worktree) =>
    matchesWorktreeFilters(worktree, snapshotFor(worktree), filters)
  );
  const activeFilterCount = activeWorktreeFilterCount(filters);
  const facetCounts = worktrees.reduce<
    Record<WorktreeFacet, number>
  >(
    (counts, worktree) => {
      for (const facet of worktreeFacetIds(worktree)) {
        counts[facet] += 1;
      }
      return counts;
    },
    { primary: 0, linked: 0, detached: 0, locked: 0, prunable: 0 }
  );
  const dirtyCount = worktrees.filter((worktree) =>
    isWorktreeSnapshotDirty(snapshotFor(worktree))
  ).length;

  useEffect(() => {
    setCreatePath("");
    setCreateBranch("");
    setCreateStartPoint("");
    setLockReasons({});
    setMoveDestinations({});
    setCreateOpen(false);
    setFilters(createWorktreeFilterState());
    setFilterOpen(false);
    setInventoryOpen(false);
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
          <Button size="small"
            aria-busy={commands.active === "prune"}
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
          </Button>
          <Button size="small" variant="primary"
            aria-controls="worktree-create-panel"
            aria-expanded={createOpen}
            onClick={() => setCreateOpen((open) => !open)}
            type="button"
          >
            <Icon name={createOpen ? "close" : "plus"} />
            {createOpen ? "收起创建" : "新建 Worktree"}
          </Button>
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
          label="游离 HEAD"
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
                已有分支或新分支；留空分支将创建游离 HEAD
              </span>
            </header>
            <form onSubmit={submitCreate}>
              <div className="field">
                <label htmlFor="worktree-create-path">
                  目标绝对路径
                </label>
                <div className="worktree-path-input">
                  <Input
                    aria-label="Worktree 目标绝对路径"
                    disabled={commands.busy}
                    fullWidth
                    id="worktree-create-path"
                    onChange={(event) =>
                      setCreatePath(event.target.value)
                    }
                    placeholder="C:\worktrees\feature-name"
                    size="small"
                    spellCheck={false}
                    value={createPath}
                  />
                  <Button size="small"
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
                  </Button>
                </div>
                <small>
                  可选择一个空目录，或选择父目录后在路径末尾补充新目录名。
                </small>
              </div>
              <div className="worktree-create-fields">
                <div className="field">
                  <label htmlFor="worktree-create-branch">
                    分支（可选）
                  </label>
                  <Input
                    disabled={commands.busy}
                    fullWidth
                    id="worktree-create-branch"
                    onChange={(event) =>
                      setCreateBranch(event.target.value)
                    }
                    placeholder="feature/worktree"
                    size="small"
                    spellCheck={false}
                    value={createBranch}
                  />
                </div>
                <div className="field">
                  <label htmlFor="worktree-create-start-point">
                    起点（可选）
                  </label>
                  <Input
                    disabled={commands.busy}
                    fullWidth
                    id="worktree-create-start-point"
                    onChange={(event) =>
                      setCreateStartPoint(event.target.value)
                    }
                    placeholder="HEAD 或提交"
                    size="small"
                    spellCheck={false}
                    value={createStartPoint}
                  />
                </div>
              </div>
              <div className="worktree-form-footer">
                <span>
                  目标必须不存在或为空，且不能与已有 Worktree 重叠。
                </span>
                <Button size="small" variant="primary"
                  aria-busy={commands.active === "create"}
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
                </Button>
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
              <li>主 Worktree 永不允许移除。</li>
              <li>脏、冲突、锁定目录不允许 Remove。</li>
              <li>移动 / 移除不提供强制模式。</li>
              <li>Prune 只清理失效 Git 登记。</li>
            </ul>
            <Button size="small"
              aria-busy={commands.active === "prune"}
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
            </Button>
          </article>
        </section>
      )}

      {worktrees.length > 0 && (
          <details
            className="worktree-inventory-disclosure"
            onToggle={(event) =>
              setInventoryOpen(event.currentTarget.open)
            }
            open={inventoryOpen}
          >
            <summary>
              {inventoryOpen
                ? `收起 ${worktrees.length} 条实际登记路径`
                : `展开全部 ${worktrees.length} 条实际登记路径`}
            </summary>
          <section className="worktree-inventory">
            <header className="worktree-inventory-header">
              <div>
                <span className="eyebrow">Git common directory</span>
                <h2>已登记 Worktrees</h2>
              </div>
              <span>
                {activeFilterCount === 0
                  ? `${worktrees.length} 个目录 · ${prunableCount} 个失效登记`
                  : `已筛出 ${visibleWorktrees.length}/${worktrees.length} 个目录`}
              </span>
              {filterOpen && (
                <Input
                  appearance="unstyled"
                  aria-label="筛选 Worktree"
                  autoFocus
                  className="worktree-filter-input"
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      query: event.target.value
                    }))
                  }
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") {
                      return;
                    }
                    event.preventDefault();
                    setFilterOpen(false);
                    setFilters((current) => ({
                      ...current,
                      query: ""
                    }));
                  }}
                  placeholder="筛选分支、路径或状态"
                  value={filters.query}
                />
              )}
              <Button size="small"
                aria-expanded={filterOpen}
                className={`panel-header-action${
                  filterOpen ? " worktree-filter-open" : ""
                }`}
                onClick={() => setFilterOpen((open) => !open)}
                type="button"
              >
                <Icon name="filter" size={13} />
                筛选
              </Button>
            </header>

            <div
              aria-label="按状态筛选 Worktree"
              className="worktree-filter-bar"
              role="group"
            >
              <span className="worktree-filter-bar-label">
                状态
              </span>
              {WORKTREE_FACET_OPTIONS.map((option) => {
                const selected = filters.facets.includes(option.id);
                return (
                  <Button variant="unstyled"
                    aria-pressed={selected}
                    className={`worktree-filter-chip${
                      selected ? " selected" : ""
                    }`}
                    disabled={facetCounts[option.id] === 0}
                    key={option.id}
                    onClick={() =>
                      setFilters((current) => ({
                        ...current,
                        facets: toggleWorktreeFacet(
                          current.facets,
                          option.id
                        )
                      }))
                    }
                    type="button"
                  >
                    {option.label}
                    <span className="worktree-filter-chip-count">
                      {facetCounts[option.id]}
                    </span>
                  </Button>
                );
              })}
              <Button variant="unstyled"
                aria-pressed={filters.onlyDirty}
                className={`worktree-filter-chip worktree-filter-chip-dirty${
                  filters.onlyDirty ? " selected" : ""
                }`}
                disabled={dirtyCount === 0 && !filters.onlyDirty}
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    onlyDirty: !current.onlyDirty
                  }))
                }
                type="button"
              >
                仅看有变更
                <span className="worktree-filter-chip-count">
                  {dirtyCount}
                </span>
              </Button>
              {activeFilterCount > 0 && (
                <Button variant="unstyled"
                  className="worktree-filter-clear"
                  onClick={() => {
                    setFilters(createWorktreeFilterState());
                    setFilterOpen(false);
                  }}
                  type="button"
                >
                  清除筛选（{activeFilterCount}）
                </Button>
              )}
            </div>

            <div className="worktree-grid">
              {visibleWorktrees.map((worktree) => {
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


            {worktrees.length > 0 &&
              visibleWorktrees.length === 0 && (
                <div className="worktree-filter-empty">
                  <Icon name="search" size={18} />
                  <strong>没有匹配的 Worktree</strong>
                  <span>可修改筛选关键词后重试。</span>
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
  const openDirectory = () => {
    if (!directoryOpening) {
      onOpenDirectory(worktree.id);
    }
  };

  return (
    <article
      aria-busy={directoryOpening || undefined}
      aria-disabled={directoryOpening || undefined}
      aria-label={`打开当前工作目录，${
        worktree.branch ?? "游离 HEAD"
      }，${status}，${worktree.path}`}
      className="worktree-card worktree-summary-card primary"
      onClick={openDirectory}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openDirectory();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="worktree-card-head">
          <span className="worktree-symbol">
            <Icon name="worktree" size={16} />
          </span>
          <span className="worktree-card-head-copy">
          <span className="worktree-title">当前工作目录</span>
          <span className="worktree-branch">
              <Icon name="branch" size={16} />
            <span>{worktree.branch ?? "游离 HEAD"}</span>
          </span>
        </span>
        <span className="status-pill green worktree-card-status">
          {worktree.isPrimary ? "主工作目录" : "当前目录"}
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
        <span className="worktree-foot-action">
            <Icon name="external" size={16} />
          打开
        </span>
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
          {worktree.isPrimary ? "主工作目录" : "已登记"}
        </span>
        <span className="status-pill blue">
          {worktree.branch ?? "游离 HEAD"}
        </span>
        {worktree.isLocked && (
          <span className="status-pill yellow">已锁定</span>
        )}
        {worktree.isPrunable && (
          <span className="status-pill yellow">可清理登记</span>
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
            <Input
              appearance="unstyled"
              aria-label={`${worktree.name} 锁定原因`}
              disabled={commands.busy}
              maxLength={512}
              onChange={(event) =>
                onLockReasonChange(event.target.value)
              }
              placeholder="锁定原因（可选）"
              value={lockReason}
            />
            <Button variant="unstyled"
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
            </Button>
          </div>
        )}

        {linked && worktree.isLocked && (
          <Button size="small"
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
          </Button>
        )}

        {mutable && (
          <div className="worktree-inline-action move">
            <Input
              appearance="unstyled"
              aria-label={`${worktree.name} 移动目标`}
              disabled={commands.busy}
              onChange={(event) =>
                onMoveDestinationChange(event.target.value)
              }
              placeholder="新的绝对路径"
              spellCheck={false}
              value={moveDestination}
            />
            <Button variant="unstyled"
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
            </Button>
            <Button variant="unstyled"
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
            </Button>
          </div>
        )}

        <div className="worktree-button-row">
          <Button size="small"
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
          </Button>
          {linked && (
            <Button size="small" emphasis="strong" variant="danger"
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
                    ? "可清理登记请使用 Prune"
                    : dirty
                      ? "脏 Worktree 不允许移除"
                      : "安全移除 linked Worktree"
              }
              type="button"
            >
              移除
            </Button>
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
