import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";

import type {
  RepositoryHistoryPageDto,
  RepositoryHistoryScopeDto,
  RepositoryHistoryFilterDto,
  RepositoryTargetDto
} from "@gitnest/contracts";

import type { useRepositoryDetails } from "../../entities/repository/useRepositoryDetails";
import { formatCommitTimestamp } from "../../shared/lib/formatCommitTimestamp";
import { Button } from "../../shared/ui/Button";
import { Icon } from "../../shared/ui/Icon";
import {
  Skeleton,
  SkeletonBoundary
} from "../../shared/ui/Skeleton";
import { RepositoryReadFailure } from "./RepositoryReadFailure";
import {
  RepositoryCommitDetail,
  type RepositoryCommitDetailView
} from "./RepositoryCommitDetail";
import { HistoryScopeControls, HistorySearchControls } from "./RepositoryHistoryControls";
import type { RepositoryCommitActionHandler } from "../../features/repository-workflow/RepositoryCommitActions";
import type { RepositoryWorkflowController } from "../../features/repository-workflow/useRepositoryWorkflow";
import {
  buildHistoryGraph,
  equalHistoryGraphRows,
  HISTORY_GRAPH_ROW_HEIGHT,
  type HistoryGraphRow
} from "./historyGraph";
import { useHistoryScroll } from "./useHistoryScroll";
import { repositoryHistoryGraphColors, saveHistoryGraphColors } from "./historyGraphColors";

export { RepositoryCommitDetail } from "./RepositoryCommitDetail";
export {
  groupHistoryRefBranches,
  historyRefOptionClassName
} from "./RepositoryHistoryControls";


export function RepositoryHistory({
  branch,
  controller,
  onCopyCommitId,
  onCommitAction,
  actionBusy,
  repositoryKey,
  target
}: {
  branch: string | undefined;
  controller: ReturnType<typeof useRepositoryDetails>;
  onCopyCommitId(hash: string): Promise<void>;
  onCommitAction?: RepositoryCommitActionHandler;
  actionBusy?: boolean;
  workflow?: RepositoryWorkflowController;
  repositoryKey: string;
  target: RepositoryTargetDto;
}) {
  const controllerHistoryKey = controller.history
    ? `${controller.history.target.repositoryId}:${controller.history.target.worktreeId}`
    : null;
  const history =
    controllerHistoryKey === repositoryKey
      ? controller.history
      : null;
  const historyLifecycleRef = useRef({
    repositoryKey,
    hasLoaded: false
  });
  if (
    historyLifecycleRef.current.repositoryKey !== repositoryKey
  ) {
    historyLifecycleRef.current = {
      repositoryKey,
      hasLoaded: false
    };
  }
  if (history) {
    historyLifecycleRef.current.hasLoaded = true;
  }
  const hasLoadedHistory =
    historyLifecycleRef.current.hasLoaded;
  const loadingRegion = resolveHistoryLoadingRegion({
    hasCurrentHistory: Boolean(history),
    hasLoadedHistory,
    loading: controller.loading.history
  });
  const commits = history?.page.commits;
  const graphColors = repositoryHistoryGraphColors(target.repositoryId);
  const branches = controller.branches?.branches ?? [];
  const graph = useMemo(
    () => buildHistoryGraph(commits ?? [], graphColors, branches),
    [commits, graphColors, controller.branches?.branches]
  );
  useEffect(() => {
    saveHistoryGraphColors(target.repositoryId, graphColors);
  }, [graph, graphColors, target.repositoryId]);
  const commitCount = commits?.length ?? 0;
  const scroll = useHistoryScroll({
    resetKey: `${repositoryKey}:${JSON.stringify(controller.historyScope)}:${JSON.stringify(controller.historySearch)}`,
    commits: commits ?? [],
    nextOffset: history?.page.nextOffset,
    loading: controller.loading.history,
    failed: Boolean(controller.historyLoadMoreError),
    selectedHash: controller.historyDetailOpen ? controller.selectedCommitHash : null,
    loadMore: controller.loadMoreHistory
  });
  const remoteRefs = useMemo(() => new Set(
    controller.branches?.branches
      .filter((item) => item.remote)
      .map((item) => item.name)
  ), [controller.branches?.branches]);
  const selected = controller.commit?.commit;
  const showCommitDetail = Boolean(
    controller.historyDetailOpen &&
      (controller.selectedCommitHash ||
        selected ||
        controller.loading.commit)
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const [commitDetailView, setCommitDetailView] =
    useState<RepositoryCommitDetailView>("details");
  useEffect(() => {
    setFilterOpen(false);
  }, [repositoryKey]);
  useEffect(() => {
    setCommitDetailView("details");
  }, [
    controller.historyDetailOpen,
    controller.selectedCommitHash,
    repositoryKey,
    selected?.hash
  ]);
  const hasSearch = Object.values(controller.historySearch ?? {}).some(Boolean);

  if (
    !controller.loading.history &&
    !history &&
    !hasLoadedHistory &&
    controller.error
  ) {
    return <RepositoryReadFailure label="提交历史暂时不可用" />;
  }

  return (
    <SkeletonBoundary
      fallback={<RepositoryHistorySkeleton />}
      hasContent={Boolean(history)}
      label="正在读取提交历史"
      loading={loadingRegion === "page"}
      surfaceAs="section"
      surfaceClassName="history-layout repository-history-skeleton"
    >
      <section
        className={`history-layout${
          showCommitDetail ? " has-detail" : ""
        }`}
      >
        <div className="history-list">
          <header className="panel-header">
            <div className="panel-title">
              <Icon name="history" />
              提交历史
            </div>
            <span className="panel-caption">
              {loadingRegion === "content"
                ? "正在查询提交历史…"
                : hasSearch ? `全历史搜索 · 已加载 ${commitCount} 条匹配提交` : historyScopeCaption(
                    controller.historyScope,
                    commitCount,
                    branch
                  )}
            </span>
            <div className="history-header-actions">
              <HistoryScopeControls
                branches={branches}
                currentBranchName={branch}
                loading={controller.loading.branches}
                onChange={(scope) =>
                  void controller.selectHistoryScope(scope)
                }
                scope={controller.historyScope}
              />
              <div className="history-filter-controls">
                <Button
                  aria-expanded={filterOpen}
                  aria-pressed={hasSearch}
                  ref={filterTriggerRef}
                  className="panel-header-action"
                  onClick={() => {
                    setFilterOpen((open) => !open);
                  }}
                  size="small"
                  type="button"
                >
                  <Icon name="filter" size={13} />
                  筛选{hasSearch ? " · 已应用" : ""}
                </Button>
              </div>
            </div>
          </header>
          {filterOpen && (
            <HistorySearchControls
              key={repositoryKey}
              search={controller.historySearch}
              onSearch={(search: RepositoryHistoryFilterDto | null) =>
                void controller.searchHistory(search)
              }
              onClose={() => {
                setFilterOpen(false);
                filterTriggerRef.current?.focus();
              }}
            />
          )}
          <SkeletonBoundary
            fallback={<RepositoryHistoryRowsSkeleton />}
            hasContent={Boolean(history)}
            label="正在切换提交历史"
            loading={loadingRegion === "content"}
            surfaceClassName="history-content-region repository-history-content-skeleton"
          >
            <div className="history-content-region">
              <div
                className="commit-list"
                aria-label="提交历史记录"
                tabIndex={-1}
                onKeyDown={scroll.onKeyDown}
                ref={scroll.listRef}
                style={{ "--history-graph-width": `${graph.width}px` } as CSSProperties}
              >
                <div className="history-table-header" aria-hidden="true">
                  <span>关系图</span>
                  <span>提交说明</span>
                  <span>日期</span>
                  <span>作者</span>
                  <span>提交</span>
                </div>
                {scroll.start > 0 && (
                  <div aria-hidden="true" style={{ height: scroll.start * HISTORY_GRAPH_ROW_HEIGHT }} />
                )}
                {commits?.slice(scroll.start, scroll.end).map((item, index) => (
                  <HistoryCommitRow
                    graph={graph.rows[scroll.start + index]!}
                    item={item}
                    key={item.hash}
                    onCopyCommitId={onCopyCommitId}
                    onSelectCommit={controller.selectCommit}
                    remoteRefs={remoteRefs}
                    selected={controller.historyDetailOpen && item.hash === controller.selectedCommitHash}
                  />
                ))}
                {scroll.end < commitCount && (
                  <div aria-hidden="true" style={{ height: (commitCount - scroll.end) * HISTORY_GRAPH_ROW_HEIGHT }} />
                )}
                {controller.error && !history ? (
                  <div className="history-filter-empty error">
                    <Icon name="warning" size={18} />
                    <strong>提交历史切换失败</strong>
                    <span>{controller.error.message}</span>
                  </div>
                ) : commitCount === 0 ? (
                  <div className="history-filter-empty">
                    <Icon
                      name={hasSearch ? "search" : "history"}
                      size={18}
                    />
                    <strong>
                      {hasSearch
                        ? "没有匹配的提交"
                        : "该引用暂无提交历史"}
                    </strong>
                    <span>
                      {hasSearch
                        ? "已搜索所选引用的完整历史，可修改搜索条件后重试。"
                        : "可选择其他本地或远程引用查看。"}
                    </span>
                  </div>
                ) : null}
                {commitCount > 0 && (
                  <div className="history-scroll-status" role="status">
                    {controller.historyLoadMoreError ? (
                      <>
                        <Icon name="warning" size={14} />
                        <span>后续记录加载失败，已保留当前记录。</span>
                        <Button size="small" onClick={() => void controller.loadMoreHistory()} type="button">重试</Button>
                      </>
                    ) : controller.loading.history ? (
                      "正在加载记录…"
                    ) : history?.page.nextOffset !== undefined ? (
                      "向下滚动以继续查看"
                    ) : (
                      "已显示全部记录"
                    )}
                  </div>
                )}
              </div>
            </div>
          </SkeletonBoundary>
        </div>

        {showCommitDetail && (
          <article
            aria-label="提交详情"
            className="commit-detail history-commit-detail panel"
          >
            <header className="panel-header">
              <RepositoryCommitDetailBreadcrumb
                additions={selected?.additions}
                deletions={selected?.deletions}
                fileCount={selected?.files.length ?? 0}
                filesDisabled={!selected}
                onViewChange={setCommitDetailView}
                view={commitDetailView}
              />
            </header>
            <SkeletonBoundary
              fallback={<RepositoryCommitDetailSkeleton />}
              hasContent={Boolean(selected)}
              label="正在读取提交详情"
              loading={controller.loading.commit}
              surfaceClassName="repository-commit-detail-skeleton"
            >
              {selected ? (
                <RepositoryCommitDetail
                  {...(onCommitAction ? { onCommitAction, actionBusy: actionBusy ?? false } : {})}
                  commit={selected}
                  key={selected.hash}
                  target={target}
                  view={commitDetailView}
                />
              ) : (
                <div className="diff-empty">
                  <Icon name="activity" size={20} />
                  <strong>选择提交查看详情</strong>
                </div>
              )}
            </SkeletonBoundary>
          </article>
        )}
      </section>
    </SkeletonBoundary>
  );
}


const HistoryCommitRow = memo(function HistoryCommitRow({
  graph,
  item,
  onCopyCommitId,
  onSelectCommit,
  remoteRefs,
  selected
}: {
  graph: HistoryGraphRow;
  item: RepositoryHistoryPageDto["page"]["commits"][number];
  onCopyCommitId(hash: string): Promise<void>;
  onSelectCommit(hash: string): Promise<void>;
  remoteRefs: ReadonlySet<string>;
  selected: boolean;
}) {
  const refs = [...new Set(item.refs ?? [])].sort((left, right) =>
    Number(right === "HEAD" || right.startsWith("HEAD -> "))
    - Number(left === "HEAD" || left.startsWith("HEAD -> "))
  );
  const hiddenRefs = refs.slice(3);
  const timestamp = formatCommitTimestamp(item.authoredAt);
  return (
    <div
      aria-current={
        selected
          ? "true"
          : undefined
      }
      className={`commit-row${
        selected
          ? " selected"
          : ""
      }`}
      data-history-hash={item.hash}
      key={item.hash}
      style={{ "--lane-color": graph.color } as CSSProperties}
      onClick={() =>
        void onSelectCommit(item.hash)
      }
      onKeyDown={(event) => {
        if (
          event.key !== "Enter" &&
          event.key !== " "
        ) {
          return;
        }
        event.preventDefault();
        void onSelectCommit(item.hash);
      }}
      role="button"
      tabIndex={0}
    >
      <svg className="commit-graph" aria-hidden="true" height={HISTORY_GRAPH_ROW_HEIGHT}>
        <title>
          {item.stashRef ? "暂存记录" : item.parentHashes.length > 1 ? "合并提交" : "提交"}
          {graph.boundary ? " · 部分父提交未在当前列表中显示" : ""}
        </title>
        {graph.paths.map((path, index) => (
          <path key={index} d={path.d} stroke={path.color} />
        ))}
        {graph.boundary && (
          <path className="commit-graph-boundary" d={graph.boundary} stroke={graph.color} />
        )}
        <circle
          className={`commit-node${item.stashRef ? " stash" : item.parentHashes.length > 1 ? " merge" : ""}`}
          cx={16 + graph.lane * 16}
          cy={HISTORY_GRAPH_ROW_HEIGHT / 2}
          r={item.stashRef || item.parentHashes.length > 1 ? 4.5 : 3.5}
        />
      </svg>
      <span className="commit-message">
        {(item.stashRef || refs.length > 0) && (
          <span className="commit-refs-inline">
            {item.stashRef && (
              <span className="ref-label stash" title={`暂存记录 · ${item.stashRef}`}>
                <Icon name="layers" size={12} />
                <span className="commit-ref-name">{item.stashRef}</span>
              </span>
            )}
            {refs.slice(0, 3).map((ref) => {
              const current = ref === "HEAD" || ref.startsWith("HEAD -> ");
              const tag = ref.startsWith("tag: ");
              const name = historyRefDisplayName(ref.replace(/^HEAD -> |^tag: /, ""));
              const remote = ref.startsWith("refs/remotes/") || remoteRefs.has(name) || name.startsWith("origin/");
              return (
                <span
                  className={`ref-label${current ? " current" : ""}${tag ? " tag" : remote ? " remote" : ""}`}
                  key={ref}
                  title={current ? `当前检出 · ${name}` : tag ? `标签 · ${name}` : remote ? `远程分支 · ${name}` : `本地分支 · ${name}`}
                >
                  <Icon name={tag ? "tag" : "branch"} size={12} />
                  {current && name !== "HEAD" && <span className="commit-ref-head">HEAD</span>}
                  <span className="commit-ref-name">{name}</span>
                </span>
              );
            })}
            {hiddenRefs.length > 0 && (
              <span className="ref-label more" title={`其他 ${hiddenRefs.length} 个引用\n${hiddenRefs.join("\n")}`}>
                +{hiddenRefs.length}
              </span>
            )}
          </span>
        )}
        <strong className="commit-subject" title={item.subject}>
          {item.subject}
        </strong>
      </span>
      <time
        className="commit-time"
        dateTime={item.authoredAt}
        title={timestamp}
      >
        {timestamp}
      </time>
      <span className="commit-author" title={`${item.authorName} <${item.authorEmail}>`}>
        {item.authorName}
      </span>
      <code
        className="commit-id"
        aria-label={`复制 Commit ID ${item.hash}`}
        onClick={(event) => {
          event.stopPropagation();
          void onCopyCommitId(item.hash);
        }}
        onKeyDown={(event) => {
          if (
            event.key !== "Enter" &&
            event.key !== " "
          ) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          void onCopyCommitId(item.hash);
        }}
        role="button"
        tabIndex={0}
        title={`点击复制 Commit ID ${item.hash}`}
      >
        {item.shortHash}
      </code>
    </div>
  );
}, (previous, next) =>
  previous.item === next.item
  && previous.onCopyCommitId === next.onCopyCommitId
  && previous.onSelectCommit === next.onSelectCommit
  && previous.remoteRefs === next.remoteRefs
  && previous.selected === next.selected
  && equalHistoryGraphRows(previous.graph, next.graph)
);

export function resolveHistoryLoadingRegion({
  hasCurrentHistory,
  hasLoadedHistory,
  loading
}: {
  hasCurrentHistory: boolean;
  hasLoadedHistory: boolean;
  loading: boolean;
}): "content" | "page" | "ready" {
  if (!loading || hasCurrentHistory) {
    return "ready";
  }
  return hasLoadedHistory ? "content" : "page";
}

function historyScopeCaption(
  scope: RepositoryHistoryScopeDto | null,
  commitCount: number,
  currentBranch: string | undefined
): string {
  if (!scope) {
    return `只读快照 · 最近 ${commitCount} 条 ${
      currentBranch ?? "HEAD"
    } 记录`;
  }
  if (scope.kind === "all") {
    return `全部分支与 stash · 已加载 ${commitCount} 条记录`;
  }
  return `只读快照 · 最近 ${commitCount} 条 ${historyRefDisplayName(scope.ref)} 记录`;
}

function historyRefDisplayName(ref: string): string {
  return ref
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/remotes\//, "");
}

export function RepositoryCommitDetailBreadcrumb({
  additions,
  deletions,
  fileCount,
  filesDisabled = false,
  onViewChange,
  view
}: {
  additions: number | undefined;
  deletions: number | undefined;
  fileCount: number;
  filesDisabled?: boolean;
  onViewChange(view: RepositoryCommitDetailView): void;
  view: RepositoryCommitDetailView;
}) {
  const hasStats =
    Number.isFinite(additions) && Number.isFinite(deletions);

  return (
    <div className="history-commit-heading">
      <nav
        aria-label="提交详情导航"
        className="history-commit-breadcrumb"
      >
        <ol>
          <li>
            <button
              aria-current={
                view === "details" ? "page" : undefined
              }
              data-history-commit-view="details"
              onClick={() => onViewChange("details")}
              type="button"
            >
              <Icon name="commit" size={14} />
              <span>提交详情</span>
            </button>
          </li>
          <li
            aria-hidden="true"
            className="history-commit-breadcrumb-separator"
          >
            ›
          </li>
          <li>
            <button
              aria-current={
                view === "files" ? "page" : undefined
              }
              data-history-commit-view="files"
              disabled={filesDisabled}
              onClick={() => onViewChange("files")}
              type="button"
            >
              <span>变更文件</span>
              <span
                aria-label={`${fileCount} 个文件`}
                className="history-commit-breadcrumb-count"
              >
                {fileCount}
              </span>
            </button>
          </li>
        </ol>
      </nav>
      {view === "files" && hasStats ? (
        <span
          aria-label={`新增 ${additions} 行，删除 ${deletions} 行`}
          className="history-commit-file-stats history-commit-heading-stats"
        >
          <span className="additions">+{additions}</span>
          <span className="deletions">-{deletions}</span>
        </span>
      ) : null}
    </div>
  );
}

function RepositoryHistorySkeleton() {
  return (
    <div className="history-list repository-history-list-skeleton">
      <div className="gn-skeleton-panel-header">
        <Skeleton variant="text" width={132} height={16} />
        <Skeleton variant="text" width={196} height={13} />
        <Skeleton width={152} height={30} />
      </div>
      <div className="history-content-region">
        <RepositoryHistoryRowsSkeleton />
      </div>
    </div>
  );
}

function RepositoryHistoryRowsSkeleton() {
  return (
    <div className="gn-skeleton-list repository-history-rows-skeleton">
      <div className="history-table-header" aria-hidden="true">
        <span>关系图</span>
        <span>提交说明</span>
        <span>日期</span>
        <span>作者</span>
        <span>提交</span>
      </div>
      {[78, 92, 70, 84, 66, 88, 74].map((width, index) => (
        <div className="gn-skeleton-row" key={`${width}-${index}`}>
          <Skeleton variant="circle" width={8} height={8} />
          <span className="gn-skeleton-row-copy">
            <Skeleton
              variant="text"
              width={`${width}%`}
              height={14}
            />
          </span>
          <Skeleton variant="text" width={82} height={12} />
          <Skeleton variant="text" width={68} height={12} />
          <Skeleton variant="text" width={54} height={12} />
        </div>
      ))}
    </div>
  );
}

function RepositoryCommitDetailSkeleton() {
  return (
    <div className="gn-skeleton-panel-body repository-commit-skeleton-body">
      <Skeleton variant="text" width="76%" height={24} />
      <div className="repository-commit-skeleton-meta">
        <Skeleton variant="text" width={90} height={12} />
        <Skeleton variant="text" width="58%" height={12} />
        <Skeleton variant="text" width={118} height={12} />
      </div>
      <Skeleton variant="text" width="92%" height={13} />
      <Skeleton variant="text" width="86%" height={13} />
      <Skeleton variant="text" width="64%" height={13} />
    </div>
  );
}
