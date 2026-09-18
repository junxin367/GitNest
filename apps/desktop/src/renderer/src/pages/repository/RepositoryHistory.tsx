import {
  useEffect,
  useRef,
  useState
} from "react";

import type {
  CommitHistoryComparisonSideDto,
  RepositoryHistoryPageDto,
  RepositoryHistoryScopeDto,
  RepositoryTargetDto
} from "@gitnest/contracts";

import type { useRepositoryDetails } from "../../entities/repository/useRepositoryDetails";
import { formatCommitTimestamp } from "../../shared/lib/formatCommitTimestamp";
import { Button } from "../../shared/ui/Button";
import { Icon } from "../../shared/ui/Icon";
import { Input } from "../../shared/ui/Input";
import {
  Skeleton,
  SkeletonBoundary
} from "../../shared/ui/Skeleton";
import { RepositoryReadFailure } from "./RepositoryReadFailure";
import {
  RepositoryCommitDetail,
  type RepositoryCommitDetailView
} from "./RepositoryCommitDetail";
import { HistoryScopeControls } from "./RepositoryHistoryControls";

export { RepositoryCommitDetail } from "./RepositoryCommitDetail";
export {
  groupHistoryRefBranches,
  historyRefOptionClassName
} from "./RepositoryHistoryControls";


export function RepositoryHistory({
  branch,
  controller,
  onCopyCommitId,
  repositoryKey,
  target
}: {
  branch: string | undefined;
  controller: ReturnType<typeof useRepositoryDetails>;
  onCopyCommitId(hash: string): Promise<void>;
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
  const commits = history?.page.commits ?? [];
  const branches = controller.branches?.branches ?? [];
  const comparison = history?.page.comparison;
  const selected = controller.commit?.commit;
  const showCommitDetail = Boolean(
    controller.historyDetailOpen &&
      (controller.selectedCommitHash ||
        selected ||
        controller.loading.commit)
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [commitDetailView, setCommitDetailView] =
    useState<RepositoryCommitDetailView>("details");
  const scopeKey = historyScopeKey(controller.historyScope);
  useEffect(() => {
    setFilterOpen(false);
    setFilterQuery("");
  }, [scopeKey]);
  useEffect(() => {
    setCommitDetailView("details");
  }, [
    controller.historyDetailOpen,
    controller.selectedCommitHash,
    repositoryKey,
    selected?.hash
  ]);
  const normalizedFilter = filterQuery.trim().toLocaleLowerCase();
  const visibleCommits = normalizedFilter
    ? commits.filter((item) =>
        [
          item.subject,
          item.authorName,
          item.shortHash,
          item.hash,
          item.authoredAt,
          ...(item.refs ?? [])
        ].some((value) =>
          value.toLocaleLowerCase().includes(normalizedFilter)
        )
      )
    : commits;

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
      hasContent={false}
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
                ? "正在读取所选引用…"
                : historyScopeCaption(
                    controller.historyScope,
                    commits.length,
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
                {filterOpen && (
                  <Input
                    appearance="unstyled"
                    aria-label="筛选提交历史"
                    autoFocus
                    className="history-filter-input"
                    onKeyDown={(event) => {
                      if (event.key !== "Escape") {
                        return;
                      }
                      event.preventDefault();
                      setFilterOpen(false);
                      setFilterQuery("");
                    }}
                    onChange={(event) =>
                      setFilterQuery(event.target.value)
                    }
                    placeholder="筛选提交、作者或 Hash"
                    value={filterQuery}
                  />
                )}
                <Button
                  aria-expanded={filterOpen}
                  className="panel-header-action"
                  onClick={() =>
                    setFilterOpen((open) => !open)
                  }
                  size="small"
                  type="button"
                >
                  <Icon name="filter" size={13} />
                  筛选
                </Button>
              </div>
            </div>
          </header>
          <SkeletonBoundary
            fallback={<RepositoryHistoryRowsSkeleton />}
            hasContent={false}
            label="正在切换提交历史"
            loading={loadingRegion === "content"}
            surfaceClassName="history-content-region repository-history-content-skeleton"
          >
            <div className="history-content-region">
              {comparison && (
                <div className="history-comparison-summary">
                  <span className="history-comparison-side left">
                    {historyRefDisplayName(comparison.leftRef)}
                    <strong>{comparison.leftOnly}</strong>
                    条独有
                  </span>
                  <span className="history-comparison-side right">
                    {historyRefDisplayName(comparison.rightRef)}
                    <strong>{comparison.rightOnly}</strong>
                    条独有
                  </span>
                  <span className="history-comparison-base">
                    共同基点
                    <code>
                      {comparison.mergeBase?.slice(0, 7) ?? "无"}
                    </code>
                  </span>
                  <span className="history-comparison-note">
                    仅显示差异提交与共同基点
                  </span>
                </div>
              )}
              <div className="commit-list">
            {visibleCommits.map((item, index) => {
              const displayRef = item.comparisonSide
                ? comparisonSideLabel(
                    item.comparisonSide,
                    comparison
                  )
                : getPrimaryCommitRef(item.refs, branch);

              return (
                <div
                  aria-current={
                    controller.historyDetailOpen &&
                    item.hash === controller.selectedCommitHash
                      ? "true"
                      : undefined
                  }
                  className={`commit-row${
                    controller.historyDetailOpen &&
                    item.hash === controller.selectedCommitHash
                      ? " selected"
                      : ""
                  }${
                    item.comparisonSide
                      ? ` comparison-${item.comparisonSide}`
                      : ""
                  }`}
                  key={item.hash}
                  onClick={() =>
                    void controller.selectCommit(item.hash)
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key !== "Enter" &&
                      event.key !== " "
                    ) {
                      return;
                    }
                    event.preventDefault();
                    void controller.selectCommit(item.hash);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span
                    className={`commit-graph ${
                      item.comparisonSide
                        ? `comparison-${item.comparisonSide}`
                        : `${index === 2 ? "branch " : ""}lane-${index % 3}`
                    }`}
                  >
                    <span className="commit-node" />
                  </span>
                  <span className="commit-message">
                    <strong className="commit-subject">
                      {item.subject}
                    </strong>
                    <span className="commit-meta">
                      <span
                        className={`ref-label${
                          displayRef.startsWith("origin/")
                            ? " remote"
                            : ""
                        }${
                          item.comparisonSide
                            ? ` comparison-${item.comparisonSide}`
                            : ""
                        }`}
                        title={displayRef}
                      >
                        {displayRef}
                      </span>
                    </span>
                  </span>
                  <time
                    className="commit-time"
                    dateTime={item.authoredAt}
                  >
                    {formatCommitTimestamp(item.authoredAt)}
                  </time>
                  <span className="commit-author">
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
            })}
            {controller.error && !history ? (
              <div className="history-filter-empty error">
                <Icon name="warning" size={18} />
                <strong>提交历史切换失败</strong>
                <span>{controller.error.message}</span>
              </div>
            ) : visibleCommits.length === 0 ? (
              <div className="history-filter-empty">
                <Icon
                  name={normalizedFilter ? "search" : "history"}
                  size={18}
                />
                <strong>
                  {normalizedFilter
                    ? "没有匹配的提交"
                    : comparison
                      ? "两个分支没有差异提交"
                      : "该引用暂无提交历史"}
                </strong>
                <span>
                  {normalizedFilter
                    ? "可修改筛选关键词后重试。"
                    : comparison
                      ? "双方当前指向相同历史，或没有可展示的独有提交。"
                      : "可选择其他本地或远程引用查看。"}
                </span>
              </div>
            ) : null}
            {history?.page.nextOffset !== undefined && (
              <Button variant="unstyled"
                aria-busy={controller.loading.history}
                className="load-more-button"
                disabled={controller.loading.history}
                onClick={() => void controller.loadMoreHistory()}
                type="button"
              >
                {controller.loading.history
                  ? "加载中…"
                  : "加载更多"}
              </Button>
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


function historyScopeKey(
  scope: RepositoryHistoryScopeDto | null
): string {
  if (!scope) {
    return "head";
  }
  return scope.kind === "ref"
    ? `ref:${scope.ref}`
    : `compare:${scope.leftRef}:${scope.rightRef}`;
}

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
    } 提交`;
  }
  if (scope.kind === "ref") {
    return `只读快照 · 最近 ${commitCount} 条 ${historyRefDisplayName(
      scope.ref
    )} 提交`;
  }
  return `只读对比 · ${historyRefDisplayName(
    scope.leftRef
  )} ↔ ${historyRefDisplayName(scope.rightRef)}`;
}

function historyRefDisplayName(ref: string): string {
  return ref
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/remotes\//, "");
}

function comparisonSideLabel(
  side: CommitHistoryComparisonSideDto,
  comparison: RepositoryHistoryPageDto["page"]["comparison"]
): string {
  if (side === "base") {
    return "共同基点";
  }
  const ref =
    side === "left"
      ? comparison?.leftRef
      : comparison?.rightRef;
  return ref
    ? historyRefDisplayName(ref)
    : side === "left"
      ? "基准分支"
      : "目标分支";
}

function getPrimaryCommitRef(
  refs: string[] | undefined,
  branch: string | undefined
): string {
  const ref =
    (refs ?? []).find(
      (value) =>
        !value.startsWith("origin/") &&
        !value.startsWith("tag:")
    ) ??
    (refs ?? []).find((value) => !value.startsWith("tag:")) ??
    (refs ?? [])[0] ??
    branch ??
    "detached";

  return ref.replace(/^HEAD -> /, "");
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
      {[78, 92, 70, 84, 66, 88, 74].map((width, index) => (
        <div className="gn-skeleton-row" key={`${width}-${index}`}>
          <Skeleton variant="circle" width={12} height={12} />
          <span className="gn-skeleton-row-copy">
            <Skeleton
              variant="text"
              width={`${width}%`}
              height={14}
            />
            <Skeleton
              variant="text"
              width={`${32 + index * 4}%`}
              height={11}
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
