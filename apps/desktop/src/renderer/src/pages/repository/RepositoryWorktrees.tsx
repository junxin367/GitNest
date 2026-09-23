import { Button } from "../../shared/ui/Button";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";

import type {
  RepositoryStatusSnapshotDto,
  WorkspaceDetailsDto,
  WorkspaceWorktreeDto
} from "@gitnest/contracts";

import type { WorktreeCommandController } from "../../features/worktree-command/useWorktreeCommands";
import {
  MAX_WORKTREE_BATCH_COMMANDS,
  type WorkspaceWorktreeCommandController
} from "../../features/worktree-command/useWorkspaceWorktreeCommands";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { Input } from "../../shared/ui/Input";
import {
  WORKTREE_FACET_OPTIONS,
  activeWorktreeFilterCount,
  buildWorktreeDeletePlan,
  createWorktreeFilterState,
  isWorktreeSnapshotDirty,
  isWorktreeSnapshotReadyForDelete,
  matchesWorktreeFilters,
  toggleWorktreeFacet,
  worktreeDeleteActionTitle,
  worktreeFacetIds,
  worktreeStatusLabel,
  worktreeStatusTone,
  type WorktreeFacet,
  type WorktreeFilterState
} from "../../shared/lib/worktreeFilters";

interface RepositoryWorktreesProps {
  batchCommands: WorkspaceWorktreeCommandController;
  workspace: WorkspaceDetailsDto;
  repositoryId: string;
  worktreeId: string;
  snapshots: RepositoryStatusSnapshotDto[];
  commands: WorktreeCommandController;
  directoryOpening: boolean;
  onOpenDirectory(worktreeId: string): void;
}

export function RepositoryWorktrees({
  batchCommands,
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<WorktreeFilterState>(
    createWorktreeFilterState
  );
  const filterInputRef = useRef<HTMLInputElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const repository = useMemo(
    () =>
      workspace.repositories.find(
        (candidate) => candidate.id === repositoryId
      ),
    [repositoryId, workspace.repositories]
  );
  const worktrees = useMemo(
    () =>
      workspace.worktrees.filter(
        (worktree) => worktree.repositoryId === repositoryId
      ),
    [repositoryId, workspace.worktrees]
  );
  const snapshotByWorktreeId = useMemo(
    () =>
      new Map(
        snapshots
          .filter(
            (snapshot) =>
              snapshot.repositoryId === repositoryId
          )
          .map((snapshot) => [
            snapshot.worktreeId,
            snapshot
          ])
      ),
    [repositoryId, snapshots]
  );
  const prunableCount = worktrees.filter(
    (worktree) => worktree.isPrunable
  ).length;
  const existingCount = worktrees.length - prunableCount;
  const detachedCount = worktrees.filter(
    (worktree) => worktree.isDetached || !worktree.branch
  ).length;
  const snapshotFor = (worktree: WorkspaceWorktreeDto) =>
    snapshotByWorktreeId.get(worktree.id);
  const visibleWorktrees = worktrees.filter((worktree) =>
    matchesWorktreeFilters(worktree, snapshotFor(worktree), filters)
  );
  const activeFilterCount = activeWorktreeFilterCount(filters);
  const facetCountWorktrees = worktrees.filter((worktree) =>
    matchesWorktreeFilters(
      worktree,
      snapshotFor(worktree),
      {
        ...filters,
        facet: null
      }
    )
  );
  const facetCounts = facetCountWorktrees.reduce<
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
  const dirtyCount = worktrees.filter(
    (worktree) =>
      matchesWorktreeFilters(
        worktree,
        snapshotFor(worktree),
        {
          ...filters,
          onlyDirty: false
        }
      ) &&
      isWorktreeSnapshotDirty(snapshotFor(worktree))
  ).length;
  const deletePlan = buildWorktreeDeletePlan(
    visibleWorktrees,
    snapshotFor,
    filters.facet
  );
  const pruning = deletePlan.mode === "prune";
  const worktreeBusy = commands.busy || batchCommands.busy;
  const batchLimitExceeded =
    deletePlan.commands.length >
    MAX_WORKTREE_BATCH_COMMANDS;
  const deleteActionTitle = batchLimitExceeded
    ? `当前范围需要 ${deletePlan.commands.length} 个命令，一次最多处理 ${MAX_WORKTREE_BATCH_COMMANDS} 个；请缩小筛选范围`
    : worktreeDeleteActionTitle(
        deletePlan,
        filters.facet,
        worktreeBusy
      );
  const deleteStatusId = "repository-worktree-delete-status";

  useEffect(() => {
    setCreatePath("");
    setCreateBranch("");
    setCreateStartPoint("");
    setCreateOpen(false);
    setFilters(createWorktreeFilterState());
    setFilterOpen(false);
    commands.clearFeedback();
    batchCommands.clearFeedback();
  }, [repositoryId]);

  useEffect(() => {
    setFilters((current) => {
      const facet = current.facet;
      if (
        !facet ||
        worktrees.some((worktree) =>
          worktreeFacetIds(worktree).includes(facet)
        )
      ) {
        return current;
      }
      return {
        ...current,
        facet: null
      };
    });
  }, [worktrees]);

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
                    disabled={worktreeBusy}
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
                    disabled={worktreeBusy}
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
                    disabled={worktreeBusy}
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
                    disabled={worktreeBusy}
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
                  disabled={worktreeBusy || !createPath.trim()}
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
              <li>清除只会移除失效 Git 登记，不会删除目录。</li>
            </ul>
          </article>
        </section>
      )}

      {worktrees.length > 0 ? (
        <>
          <div className="worktree-toolbar">
            <span className="worktree-toolbar-title">
              <Icon name="worktree" size={14} />
              已登记 Worktrees
            </span>
            <span className="worktree-toolbar-count">
              共 {worktrees.length} 个
              {activeFilterCount === 0
                ? ""
                : ` · 已筛出 ${visibleWorktrees.length} 个`}
            </span>
            {filterOpen && (
              <Input
                aria-label="筛选 Worktree"
                autoFocus
                clearLabel="清除 Worktree 筛选"
                fieldClassName="worktree-filter-field"
                fullWidth
                inputClassName="worktree-filter-input"
                leading={<Icon name="search" size={13} />}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    query: event.target.value
                  }))
                }
                {...(filters.query
                  ? {
                      onClear: () => {
                        setFilters((current) => ({
                          ...current,
                          query: ""
                        }));
                        filterInputRef.current?.focus({
                          preventScroll: true
                        });
                      }
                    }
                  : {})}
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
                  filterTriggerRef.current?.focus({
                    preventScroll: true
                  });
                }}
                placeholder="筛选分支、路径或状态"
                ref={filterInputRef}
                size="small"
                value={filters.query}
              />
            )}
            <Button
              aria-busy={worktreeBusy}
              aria-describedby={deleteStatusId}
              aria-label={
                worktreeBusy
                  ? "Worktree 操作处理中"
                  : pruning
                  ? "清除失效 Worktree 登记"
                  : "删除筛选中的 Worktree"
              }
              className="worktree-delete-action"
              disabled={
                worktreeBusy ||
                batchLimitExceeded ||
                deletePlan.commands.length === 0
              }
              icon={
                <Icon
                  name={pruning ? "refresh" : "trash"}
                  size={13}
                />
              }
              onClick={() =>
                void batchCommands.request(deletePlan.commands)
              }
              size="small"
              title={deleteActionTitle}
              type="button"
              variant="danger"
            >
              {batchCommands.active !== null
                ? "预检中…"
                : batchCommands.busy
                  ? "处理中…"
                  : pruning
                    ? `清除 (${deletePlan.eligibleCount})`
                    : `删除 (${deletePlan.eligibleCount})`}
            </Button>
            <Button size="small"
              aria-expanded={filterOpen}
              className={`panel-header-action${
                filterOpen ? " worktree-filter-open" : ""
              }`}
              onClick={() => setFilterOpen((open) => !open)}
              ref={filterTriggerRef}
              type="button"
            >
              <Icon name="filter" size={13} />
              筛选
            </Button>
          </div>

          <div
            aria-label="按类型筛选 Worktree"
            className="worktree-filter-bar"
            role="group"
          >
            <span className="worktree-filter-bar-label">类型</span>
            {WORKTREE_FACET_OPTIONS.map((option) => {
              const selected = filters.facet === option.id;
              return (
                <Button variant="unstyled"
                  aria-pressed={selected}
                  className={`worktree-filter-chip${
                    selected ? " selected" : ""
                  }`}
                  disabled={
                    facetCounts[option.id] === 0 && !selected
                  }
                  key={option.id}
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      facet: toggleWorktreeFacet(
                        current.facet,
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
                  filterTriggerRef.current?.focus({
                    preventScroll: true
                  });
                }}
                type="button"
              >
                清除筛选（{activeFilterCount}）
              </Button>
            )}
          </div>
          <div
            className="worktree-delete-status"
            id={deleteStatusId}
            role="status"
          >
            {deleteActionTitle}
          </div>

          {visibleWorktrees.length > 0 ? (
            <div className="worktree-grid">
              {visibleWorktrees.map((worktree) => (
                <WorktreeSummaryCard
                  current={worktree.id === worktreeId}
                  directoryOpening={directoryOpening}
                  key={worktree.id}
                  onOpenDirectory={onOpenDirectory}
                  repositoryName={repository.name}
                  snapshot={snapshotFor(worktree)}
                  worktree={worktree}
                />
              ))}
            </div>
          ) : (
            <div className="worktree-filter-empty">
              <Icon name="search" size={18} />
              <strong>没有匹配的 Worktree</strong>
              <span>可修改筛选条件后重试。</span>
            </div>
          )}
        </>
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
  repositoryName,
  current,
  directoryOpening,
  onOpenDirectory
}: {
  worktree: WorkspaceWorktreeDto;
  snapshot: RepositoryStatusSnapshotDto | undefined;
  repositoryName: string;
  current: boolean;
  directoryOpening: boolean;
  onOpenDirectory(worktreeId: string): void;
}) {
  const changes = snapshot ? worktreeChangeCount(snapshot) : 0;
  const title = worktree.branch ?? "游离 HEAD";
  const statusLabel = worktreeStatusLabel(worktree);
  const statusTone = worktreeStatusTone(worktree);
  const snapshotReady =
    isWorktreeSnapshotReadyForDelete(snapshot);
  const interactive = !worktree.isPrunable && !worktree.isBare;
  const locationLabel = worktree.isBare
    ? "无工作目录"
    : worktree.isPrunable
      ? "目录不存在"
      : "目录存在";
  const stateDetail = [
    changes > 0 ? `${changes} 项变更` : "",
    interactive && !snapshotReady ? "状态未就绪" : ""
  ]
    .filter(Boolean)
    .join("，");
  const activate = () => {
    if (!interactive) {
      return;
    }
    if (!directoryOpening) {
      onOpenDirectory(worktree.id);
    }
  };

  return (
    <article
      aria-busy={
        interactive && directoryOpening
          ? true
          : undefined
      }
      aria-current={current ? "location" : undefined}
      aria-disabled={
        interactive && directoryOpening ? true : undefined
      }
      aria-label={`${interactive ? "打开 " : ""}${title}，${statusLabel}，提交 ${shortWorktreeHead(
        worktree.head
      )}，${locationLabel}${
        stateDetail ? `，${stateDetail}` : ""
      }，${worktree.path}`}
      className={`worktree-card worktree-summary-card${
        worktree.isPrimary ? " primary" : ""
      }${worktree.isPrunable ? " prunable" : ""}${
        worktree.isBare ? " bare" : ""
      }`}
      onClick={interactive ? activate : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                activate();
              }
            }
          : undefined
      }
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <div className="worktree-card-head">
        <span className="worktree-symbol">
          <Icon name="worktree" size={16} />
        </span>
        <span className="worktree-card-head-copy">
          <span className="worktree-title" title={title}>
            {title}
          </span>
          <span className="worktree-branch">
            <Icon name="commit" size={16} />
            <span>{shortWorktreeHead(worktree.head)}</span>
          </span>
        </span>
        <span
          className={`status-pill ${statusTone} worktree-card-status`}
        >
          {statusLabel}
        </span>
      </div>
      <div className="worktree-path" title={worktree.path}>
        {worktree.path}
      </div>
      <div className="worktree-foot">
        <span className="worktree-repository-tag">
          <Icon name="repository" size={16} />
          {repositoryName}
        </span>
        <span
          className={`worktree-location-status${
            worktree.isPrunable ? " missing" : ""
          }`}
        >
          {locationLabel}
        </span>
        {changes > 0 && (
          <span className="worktree-change-count">
            {changes} 项变更
          </span>
        )}
        {interactive && !snapshotReady && (
          <span className="worktree-status-unavailable">
            状态未就绪
          </span>
        )}
        <span className="spacer" />
        {interactive && (
          <span className="worktree-foot-action">
            <Icon name="external" size={16} />
            登记路径
          </span>
        )}
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
