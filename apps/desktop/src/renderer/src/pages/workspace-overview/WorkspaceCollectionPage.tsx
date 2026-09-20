import { Button } from "../../shared/ui/Button";
import type {
  RepositoryStatusSnapshotDto,
  RepositoryTargetDto,
  WorkspaceDetailsDto,
  WorkspaceRepositoryDto,
  WorkspaceWorktreeDto
} from "@gitnest/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type { WorkspaceTab } from "../../app/navigation";
import {
  filterSnapshotsToTargets,
  getSnapshotChangeCount,
  listActiveWorkspaceTargets
} from "../../entities/workspace/model";
import { Icon } from "../../shared/ui/Icon";
import { Input } from "../../shared/ui/Input";
import {
  Skeleton,
  SkeletonBoundary
} from "../../shared/ui/Skeleton";
import {
  isEventInsideMenu,
  MenuItem,
  MenuPopover
} from "../../shared/ui/Menu";
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

type CollectionTab = Exclude<WorkspaceTab, "overview">;

interface WorkspaceCollectionPageProps {
  busy: boolean;
  loading: boolean;
  snapshots: RepositoryStatusSnapshotDto[];
  tab: CollectionTab;
  workspace: WorkspaceDetailsDto | null;
  onAddDirectory(): void;
  onSelectTarget(target: RepositoryTargetDto): void;
}

interface WorkspaceRepositoryRow {
  repository: WorkspaceRepositoryDto;
  target: RepositoryTargetDto | undefined;
  worktree: WorkspaceWorktreeDto | undefined;
  snapshot: RepositoryStatusSnapshotDto | undefined;
}

export function WorkspaceCollectionPage({
  busy,
  loading,
  snapshots,
  tab,
  workspace,
  onAddDirectory,
  onSelectTarget
}: WorkspaceCollectionPageProps) {
  if (!workspace) {
    return (
      <SkeletonBoundary
        fallback={<WorkspaceCollectionSkeleton />}
        hasContent={false}
        label="正在读取 Workspace"
        loading={loading}
        surfaceClassName="page-scroll gn-page-skeleton workspace-collection-skeleton"
      >
        <div className="page-scroll">
          <section className="page-heading">
            <div>
              <span className="eyebrow">多仓库工作区</span>
              <h1>Workspace</h1>
              <p>当前没有可展示的 Workspace 数据。</p>
            </div>
          </section>
          <div className="empty-state workspace-empty-state">
            <span className="empty-state-icon">
              <Icon name="folder" size={20} />
            </span>
            <div>
              <strong>尚未添加本地目录</strong>
              <p>添加目录后即可查看仓库和 Worktree。</p>
              <Button
                onClick={onAddDirectory}
                size="small"
                type="button"
                variant="primary"
              >
                <Icon name="plus" />
                添加目录
              </Button>
            </div>
          </div>
        </div>
      </SkeletonBoundary>
    );
  }

  const activeTargets = listActiveWorkspaceTargets(workspace);
  const activeTargetKeys = new Set(
    activeTargets.map(
      (target) => `${target.repositoryId}:${target.worktreeId}`
    )
  );
  const activeRepositoryIds = new Set(
    activeTargets.map((target) => target.repositoryId)
  );
  const activeRepositories = workspace.repositories.filter(
    (repository) => activeRepositoryIds.has(repository.id)
  );
  const activeWorktrees = workspace.worktrees.filter((worktree) =>
    activeTargetKeys.has(`${worktree.repositoryId}:${worktree.id}`)
  );
  const activeSnapshots = filterSnapshotsToTargets(
    snapshots,
    activeTargets
  );
  const worktreeById = new Map(
    activeWorktrees.map((worktree) => [
      worktree.id,
      worktree
    ])
  );
  const snapshotByTarget = new Map(
    activeSnapshots.map((snapshot) => [
      workspaceTargetKey(
        snapshot.repositoryId,
        snapshot.worktreeId
      ),
      snapshot
    ])
  );
  const repositoryRows = activeRepositories
    .map((repository) =>
      createRepositoryRow(
        repository,
        worktreeById,
        snapshotByTarget
      )
    )
    .sort(compareRepositoryRows);

  if (tab === "repositories") {
    return (
      <div className="page-scroll workspace-collection-page">
        <WorkspacePageHeading
          title="仓库管理"
          description="统一查看实际仓库路径、当前分支、工作区状态与本地远程跟踪引用差异。"
        />
        <section className="panel">
          <header className="panel-header">
            <div className="panel-title">
              <Icon name="repository" />
              全部仓库
            </div>
            <span className="panel-caption">
              {activeRepositories.length} 个仓库 ·{" "}
              {activeWorktrees.length} 个 Worktree
            </span>
            <Button variant="unstyled"
              className="panel-action"
              disabled={busy}
              onClick={onAddDirectory}
              type="button"
            >
              <Icon name="plus" size={13} />
              添加仓库
            </Button>
          </header>
          {repositoryRows.length > 0 ? (
            <RepositoryTable
              rows={repositoryRows}
              onSelectTarget={onSelectTarget}
            />
          ) : (
            <WorkspaceEmptyState
              busy={busy}
              onAddDirectory={onAddDirectory}
            />
          )}
        </section>
      </div>
    );
  }

  if (tab === "activity") {
    return (
      <div className="page-scroll workspace-collection-page">
        <WorkspacePageHeading
          title="Workspace 活动"
          description="按本次只读快照汇总各仓库当前 HEAD、分支与远程同步状态。"
        />
        <WorkspaceActivityPanel
          busy={busy}
          onAddDirectory={onAddDirectory}
          onSelectTarget={onSelectTarget}
          rows={repositoryRows}
        />
      </div>
    );
  }

  return (
    <div className="page-scroll workspace-collection-page">
      <WorkspacePageHeading
        title="跨仓 Worktrees"
        description={`聚合仓库实际登记 ${activeWorktrees.length} 个 Worktree；其中 ${activeWorktrees.filter((worktree) => worktree.isPrunable).length} 个记录指向不存在的目录。`}
      />
      <WorkspaceWorktreesPanel
        busy={busy}
        onAddDirectory={onAddDirectory}
        onSelectTarget={onSelectTarget}
        repositories={activeRepositories}
        snapshots={activeSnapshots}
        worktrees={activeWorktrees}
      />
    </div>
  );
}

function WorkspaceCollectionSkeleton() {
  return (
    <>
      <div className="gn-skeleton-heading">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
      <div className="gn-skeleton-panel">
        <div className="gn-skeleton-panel-header">
          <Skeleton height={14} width="32%" />
          <Skeleton height={28} width={132} />
        </div>
        <div className="gn-skeleton-list">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="gn-skeleton-row" key={index}>
              <div className="gn-skeleton-row-copy">
                <Skeleton height={11} />
                <Skeleton height={9} variant="text" />
              </div>
              <Skeleton height={18} width="100%" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function WorkspaceWorktreesPanel({
  busy,
  onAddDirectory,
  onSelectTarget,
  repositories,
  snapshots,
  worktrees
}: {
  busy: boolean;
  onAddDirectory(): void;
  onSelectTarget(target: RepositoryTargetDto): void;
  repositories: WorkspaceRepositoryDto[];
  snapshots: RepositoryStatusSnapshotDto[];
  worktrees: WorkspaceWorktreeDto[];
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<WorktreeFilterState>(
    createWorktreeFilterState
  );
  const [repoMenuOpen, setRepoMenuOpen] = useState(false);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const repoMenuRootRef = useRef<HTMLDivElement>(null);
  const repoMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const repoMenuRef = useRef<HTMLDivElement>(null);
  const setRepoMenuRef = useCallback((node: HTMLDivElement | null) => {
    repoMenuRef.current = node;
  }, []);
  const snapshotByTarget = useMemo(
    () =>
      new Map(
        snapshots.map((snapshot) => [
          workspaceTargetKey(
            snapshot.repositoryId,
            snapshot.worktreeId
          ),
          snapshot
        ])
      ),
    [snapshots]
  );
  const snapshotFor = (worktree: WorkspaceWorktreeDto) =>
    snapshotByTarget.get(
      workspaceTargetKey(worktree.repositoryId, worktree.id)
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
  const repositoryIdsWithWorktrees = useMemo(
    () =>
      new Set(
        worktrees.map((worktree) => worktree.repositoryId)
      ),
    [worktrees]
  );
  const repositoryOptions = useMemo(
    () =>
      repositories
        .filter((repository) =>
          repositoryIdsWithWorktrees.has(repository.id)
        )
        .sort((left, right) =>
          left.name.localeCompare(right.name)
        ),
    [repositories, repositoryIdsWithWorktrees]
  );
  const repositoryNames = useMemo(
    () =>
      new Map(
        repositories.map((repository) => [
          repository.id,
          repository.name
        ])
      ),
    [repositories]
  );
  const selectedRepositoryName =
    repositoryNames.get(filters.repositoryId) ?? "全部仓库";

  useEffect(() => {
    if (!repoMenuOpen) {
      return;
    }

    const close = () => setRepoMenuOpen(false);
    const handleScroll = (event: Event) => {
      if (isEventInsideMenu(event, repoMenuRef.current)) {
        return;
      }
      close();
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !repoMenuRootRef.current?.contains(event.target) &&
        !repoMenuRef.current?.contains(event.target)
      ) {
        close();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      setRepoMenuOpen(false);
      repoMenuTriggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", handleScroll, true);
    // 菜单首帧仍为 visibility:hidden，定位完成后才可聚焦；等一帧再聚焦当前选中项。
    const focusFrame = window.requestAnimationFrame(() => {
      const items =
        repoMenuRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role^="menuitem"]'
        ) ?? [];
      const checked = [...items].find(
        (item) => item.getAttribute("aria-checked") === "true"
      );
      (checked ?? items[0])?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [repoMenuOpen]);

  if (worktrees.length === 0) {
    return (
      <section className="panel">
        <WorkspaceEmptyState
          busy={busy}
          onAddDirectory={onAddDirectory}
        />
      </section>
    );
  }

  return (
    <div className="worktree-collection">
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
            aria-label="筛选跨仓 Worktree"
            autoFocus
            clearLabel="清除跨仓 Worktree 筛选"
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
            }}
            placeholder="筛选分支、路径或状态"
            ref={filterInputRef}
            size="small"
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
        {repositoryOptions.length > 1 && (
          <div className="worktree-repo-menu" ref={repoMenuRootRef}>
            <Button variant="unstyled"
              aria-expanded={repoMenuOpen}
              aria-haspopup="menu"
              aria-label="按仓库筛选 Worktree"
              className="worktree-repo-menu-trigger"
              onClick={() => setRepoMenuOpen((open) => !open)}
              ref={repoMenuTriggerRef}
              type="button"
            >
              <span className="worktree-repo-menu-trigger-value">
                {selectedRepositoryName}
              </span>
              <Icon name="chevron" size={14} />
            </Button>
            {repoMenuOpen && (
              <MenuPopover
                align="end"
                anchor={repoMenuTriggerRef.current}
                aria-label="按仓库筛选 Worktree"
                className="worktree-repo-menu-surface"
                ref={setRepoMenuRef}
                side="bottom"
              >
                <MenuItem
                  aria-checked={filters.repositoryId === ""}
                  className={
                    filters.repositoryId === "" ? "is-selected" : undefined
                  }
                  onClick={() => {
                    setFilters((current) => ({
                      ...current,
                      repositoryId: ""
                    }));
                    setRepoMenuOpen(false);
                    repoMenuTriggerRef.current?.focus();
                  }}
                  role="menuitemradio"
                >
                  全部仓库
                </MenuItem>
                {repositoryOptions.map((repository) => (
                  <MenuItem
                    aria-checked={filters.repositoryId === repository.id}
                    className={
                      filters.repositoryId === repository.id
                        ? "is-selected"
                        : undefined
                    }
                    key={repository.id}
                    onClick={() => {
                      setFilters((current) => ({
                        ...current,
                        repositoryId: repository.id
                      }));
                      setRepoMenuOpen(false);
                      repoMenuTriggerRef.current?.focus();
                    }}
                    role="menuitemradio"
                  >
                    {repository.name}
                  </MenuItem>
                ))}
              </MenuPopover>
            )}
          </div>
        )}
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
              disabled={facetCounts[option.id] === 0}
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
            }}
            type="button"
          >
            清除筛选（{activeFilterCount}）
          </Button>
        )}
      </div>
      {visibleWorktrees.length > 0 ? (
        <div className="worktree-grid">
          {visibleWorktrees.map((worktree) => {
            const target = {
              repositoryId: worktree.repositoryId,
              worktreeId: worktree.id
            };
            return (
              <WorkspaceWorktreeCard
                key={worktree.id}
                onSelect={() => onSelectTarget(target)}
                repositoryName={
                  repositoryNames.get(worktree.repositoryId) ?? ""
                }
                worktree={worktree}
              />
            );
          })}
        </div>
      ) : (
        <div className="worktree-filter-empty">
          <Icon name="search" size={18} />
          <strong>没有匹配的 Worktree</strong>
          <span>可修改筛选关键词后重试。</span>
        </div>
      )}
    </div>
  );
}

function WorkspacePageHeading({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </section>
  );
}

function WorkspaceActivityPanel({
  busy,
  onAddDirectory,
  onSelectTarget,
  rows
}: {
  busy: boolean;
  onAddDirectory(): void;
  onSelectTarget(target: RepositoryTargetDto): void;
  rows: WorkspaceRepositoryRow[];
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const normalizedFilter = filterQuery.trim().toLocaleLowerCase();
  const activityRows = [...rows].sort(compareActivityRows);
  const visibleRows = normalizedFilter
    ? activityRows.filter((row) =>
        workspaceActivitySearchValues(row).some((value) =>
          value.toLocaleLowerCase().includes(normalizedFilter)
        )
      )
    : activityRows;
  const snapshotAt = activityRows.find((row) => row.snapshot)?.snapshot
    ?.refreshedAt;
  const countLabel =
    visibleRows.length === activityRows.length
      ? `${activityRows.length} 条`
      : `${visibleRows.length}/${activityRows.length} 条`;

  return (
    <section className="panel">
      <header className="panel-header">
        <div className="panel-title">
          <Icon name="history" />
          最近 HEAD 提交
        </div>
        <span className="panel-caption">
          {countLabel}
          {snapshotAt
            ? ` · 快照 ${formatWorkspaceTimestamp(snapshotAt)}`
            : ""}
        </span>
        {filterOpen && (
          <Input
            appearance="unstyled"
            aria-label="筛选 Workspace 活动"
            autoFocus
            className="workspace-activity-filter-input"
            onChange={(event) => setFilterQuery(event.target.value)}
            placeholder="筛选仓库、分支或 Hash"
            value={filterQuery}
          />
        )}
        <Button variant="unstyled"
          aria-expanded={filterOpen}
          className={`panel-action${
            filterOpen ? " workspace-activity-filter-open" : ""
          }`}
          onClick={() => setFilterOpen((open) => !open)}
          type="button"
        >
          <Icon name="filter" size={13} />
          筛选
        </Button>
      </header>
      <div className="workspace-activity-list">
        {visibleRows.map((row, index) => {
          const name = row.worktree?.name ?? row.repository.name;
          const snapshot = row.snapshot;
          const time = snapshot
            ? formatWorkspaceTimestamp(snapshot.refreshedAt)
            : "—";
          const detail = snapshot
            ? `${shortHead(snapshot.head)} · ${workspaceActivityStatus(
                snapshot
              )}`
            : "等待状态刷新";

          return (
            <Button variant="unstyled"
              aria-label={`${name} 的 HEAD 最近提交，${detail}，${time}`}
              className={`workspace-activity-row${
                index === visibleRows.length - 1 ? " last" : ""
              }`}
              disabled={!row.target}
              key={row.repository.id}
              onClick={() => {
                if (row.target) {
                  onSelectTarget(row.target);
                }
              }}
              type="button"
            >
              <span
                aria-hidden="true"
                className={`workspace-activity-marker ${repositoryTone(
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
                  {snapshot ? (
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
                dateTime={snapshot?.refreshedAt}
              >
                {time}
              </time>
            </Button>
          );
        })}
        {activityRows.length === 0 && (
          <WorkspaceEmptyState
            busy={busy}
            onAddDirectory={onAddDirectory}
          />
        )}
        {activityRows.length > 0 && visibleRows.length === 0 && (
          <div className="workspace-activity-filter-empty">
            没有匹配的 HEAD 快照
          </div>
        )}
      </div>
    </section>
  );
}

function RepositoryTable({
  rows,
  onSelectTarget
}: {
  rows: WorkspaceRepositoryRow[];
  onSelectTarget(target: RepositoryTargetDto): void;
}) {
  return (
    <div
      aria-label="Workspace 全部仓库"
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
      {rows.map((row) => {
        const name = row.worktree?.name ?? row.repository.name;
        const branch =
          row.snapshot?.branch ?? row.worktree?.branch ?? "detached";
        const state = workspaceStatusLabel(row.snapshot);
        const target = row.target;

        return (
          <div
            className="repository-status-item"
            key={row.repository.id}
            role="listitem"
          >
            <Button variant="unstyled"
              aria-label={`${name}，分支 ${branch}，工作区 ${state}，同步 ${syncLabel(
                row.snapshot
              )}`}
              className={`repository-status-row${
                target ? "" : " disabled"
              }`}
              disabled={!target}
              onClick={() => {
                if (target) {
                  onSelectTarget(target);
                }
              }}
              type="button"
            >
              <span className="table-name">
                <span
                  className={`repository-state ${repositoryTone(
                    row.snapshot
                  )}`}
                >
                  <Icon name="repository" size={13} />
                </span>
                <span className="table-name-copy" title={name}>
                  {name}
                  <small
                    title={row.worktree?.path ?? "路径不可用"}
                  >
                    {row.worktree?.path ?? "路径不可用"}
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
                  className={`status-pill ${workspaceStatusTone(
                    row.snapshot
                  )}`}
                >
                  {state}
                </span>
              </span>
              <span
                className="repository-status-sync"
                title={syncLabel(row.snapshot)}
              >
                {syncLabel(row.snapshot)}
              </span>
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function WorkspaceWorktreeCard({
  onSelect,
  repositoryName,
  worktree
}: {
  onSelect(): void;
  repositoryName: string;
  worktree: WorkspaceWorktreeDto;
}) {
  const statusTone = worktree.isPrunable
    ? "red"
    : worktree.isDetached
      ? "yellow"
      : worktree.isPrimary
        ? "green"
        : "neutral";
  const statusLabel = worktree.isPrunable
    ? "可清理登记"
    : worktree.isPrimary
        ? "主工作目录"
        : worktree.isDetached
          ? "游离 HEAD"
          : "已登记";
  const title = worktree.branch || "游离 HEAD";
  const locationLabel = worktree.isPrunable ? "目录不存在" : "目录存在";

  return (
    <article
      aria-label={`${repositoryName ? `${repositoryName} 的 ` : ""}${title}，${statusLabel}，提交 ${shortHead(
        worktree.head
      )}，${locationLabel}，${worktree.path}`}
      className={`worktree-card worktree-summary-card${
        worktree.isPrimary ? " primary" : ""
      }`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
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
          <span className="worktree-title" title={title}>
            {title}
          </span>
          <span className="worktree-branch">
              <Icon name="commit" size={16} />
            <span>{shortHead(worktree.head)}</span>
          </span>
        </span>
        <span className={`status-pill ${statusTone} worktree-card-status`}>
          {statusLabel}
        </span>
      </div>
      <div className="worktree-path" title={worktree.path}>
        {worktree.path}
      </div>
      <div className="worktree-foot">
        {repositoryName && (
          <span className="worktree-repository-tag">
              <Icon name="repository" size={16} />
            {repositoryName}
          </span>
        )}
        <span
          className={`worktree-location-status${
            worktree.isPrunable ? " missing" : ""
          }`}
        >
          {locationLabel}
        </span>
          <span className="spacer" />
          {!worktree.isPrunable && (
            <span className="worktree-foot-action">
              <Icon name="external" size={16} />
              登记路径
            </span>
          )}
      </div>
    </article>
  );
}

function WorkspaceEmptyState({
  busy,
  onAddDirectory
}: {
  busy: boolean;
  onAddDirectory(): void;
}) {
  return (
    <div className="empty-state workspace-empty-state">
      <span className="empty-state-icon">
        <Icon name="folder" size={20} />
      </span>
      <div>
        <strong>尚未添加本地目录</strong>
        <p>使用目录选择器添加 Workspace 后，这里会显示对应内容。</p>
        <Button size="small" variant="primary"
          disabled={busy}
          onClick={onAddDirectory}
          type="button"
        >
          <Icon name="plus" />
          添加目录
        </Button>
      </div>
    </div>
  );
}

function createRepositoryRow(
  repository: WorkspaceRepositoryDto,
  worktreeById: Map<string, WorkspaceWorktreeDto>,
  snapshotByTarget: Map<
    string,
    RepositoryStatusSnapshotDto
  >
): WorkspaceRepositoryRow {
  const worktree =
    repository.worktreeIds
      .map((worktreeId) => worktreeById.get(worktreeId))
      .find((candidate) => candidate?.isPrimary) ??
    repository.worktreeIds
      .map((worktreeId) => worktreeById.get(worktreeId))
      .find(Boolean);
  const target = worktree
    ? {
        repositoryId: repository.id,
        worktreeId: worktree.id
      }
    : undefined;

  return {
    repository,
    target,
    worktree,
    snapshot: target
      ? snapshotByTarget.get(
          workspaceTargetKey(
            target.repositoryId,
            target.worktreeId
          )
        )
      : undefined
  };
}

function workspaceTargetKey(
  repositoryId: string,
  worktreeId: string
): string {
  return `${repositoryId}\u0000${worktreeId}`;
}

function compareRepositoryRows(
  left: WorkspaceRepositoryRow,
  right: WorkspaceRepositoryRow
): number {
  return (
    repositoryPriority(right.snapshot) -
      repositoryPriority(left.snapshot) ||
    (left.worktree?.name ?? left.repository.name).localeCompare(
      right.worktree?.name ?? right.repository.name,
      undefined,
      { sensitivity: "base" }
    )
  );
}

function compareActivityRows(
  left: WorkspaceRepositoryRow,
  right: WorkspaceRepositoryRow
): number {
  return (
    snapshotTimestamp(right.snapshot) - snapshotTimestamp(left.snapshot) ||
    compareRepositoryRows(left, right)
  );
}

function snapshotTimestamp(
  snapshot: RepositoryStatusSnapshotDto | undefined
): number {
  if (!snapshot) {
    return Number.NEGATIVE_INFINITY;
  }
  const timestamp = new Date(snapshot.refreshedAt).getTime();
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function repositoryPriority(
  snapshot: RepositoryStatusSnapshotDto | undefined
): number {
  if (snapshot?.error || snapshot?.conflicted) {
    return 4;
  }
  if (snapshot && getSnapshotChangeCount(snapshot) > 0) {
    return 3;
  }
  if (snapshot && (snapshot.ahead > 0 || snapshot.behind > 0)) {
    return 2;
  }
  if (!snapshot || snapshot.stale) {
    return 1;
  }
  return 0;
}

function repositoryTone(
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
  return getSnapshotChangeCount(snapshot) > 0 ? "warning" : "clean";
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

function workspaceStatusTone(
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

function workspaceActivitySearchValues(
  row: WorkspaceRepositoryRow
): string[] {
  return [
    row.repository.name,
    row.worktree?.name ?? "",
    row.snapshot?.branch ?? "",
    row.snapshot?.head ?? "",
    row.snapshot?.upstream ?? ""
  ];
}

function shortHead(head: string): string {
  return head ? head.slice(0, 7) : "—";
}


function formatWorkspaceTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "时间未知";
  }
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
