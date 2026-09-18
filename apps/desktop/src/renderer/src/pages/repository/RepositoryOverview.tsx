import type { RepositoryStatusSnapshotDto } from "@gitnest/contracts";

import type { RepositoryTab } from "../../app/navigation";
import type { useRepositoryDetails } from "../../entities/repository/useRepositoryDetails";
import { getSnapshotChangeCount } from "../../entities/workspace/model";
import { formatCommitTimestamp } from "../../shared/lib/formatCommitTimestamp";
import { Button } from "../../shared/ui/Button";
import { Icon } from "../../shared/ui/Icon";
import {
  Skeleton,
  SkeletonBoundary
} from "../../shared/ui/Skeleton";
import {
  repositoryOverviewStatus,
  snapshotTone
} from "./repositoryStatusPresentation";

export function RepositoryOverview({
  controller,
  directoryOpening,
  onCopyCommitId,
  onOpenDirectory,
  onOpenTab,
  repositoryName,
  repositoryPath,
  snapshot,
  worktreeCount
}: {
  controller: ReturnType<typeof useRepositoryDetails>;
  directoryOpening: boolean;
  onCopyCommitId(hash: string): Promise<void>;
  onOpenDirectory(): void;
  onOpenTab(tab: RepositoryTab): void;
  snapshot: RepositoryStatusSnapshotDto | undefined;
  worktreeCount: number;
  repositoryName: string;
  repositoryPath: string | undefined;
}) {
  const changes = getSnapshotChangeCount(snapshot);
  const commits =
    controller.history?.page.commits.slice(0, 3) ?? [];
  const latestCommit = commits[0];
  const historyLoading = controller.loading.history;
  const changeFoot =
    !snapshot
      ? "等待状态刷新"
      : changes > 0
        ? `${snapshot.untracked} 未跟踪 · ${snapshot.staged} 已暂存 · ${snapshot.unstaged} 未暂存${
            snapshot.conflicted
              ? ` · ${snapshot.conflicted} 冲突`
              : ""
          }`
        : "工作区干净";
  const branchFoot = snapshot
    ? snapshot.ahead
      ? `${snapshot.branch ?? "detached"} · 准备 Push`
      : `当前分支：${snapshot.branch ?? "detached"}`
    : "等待状态刷新";
  const upstreamFoot = snapshot
    ? snapshot.upstream
      ? `上游：${snapshot.upstream} · ${
          snapshot.behind ? "可执行快进更新" : "无需 Pull"
        }`
      : snapshot.behind
        ? "可执行快进更新 · 未配置上游"
        : "未配置上游"
    : "等待状态刷新";

  return (
    <>
      <section className="repository-hero">
        <span className="repository-hero-icon">
          <Icon name="repository" size={25} />
        </span>
        <div className="repository-hero-copy">
          <div className="repository-hero-title">
            {repositoryName}
          </div>
          <div
            className="repository-hero-path"
            title={repositoryPath}
          >
            {repositoryPath ?? "工作目录不可用"}
          </div>
          <div className="repository-hero-status">
            <span
              className={`status-pill ${snapshotTone(snapshot)}`}
            >
              {repositoryOverviewStatus(snapshot)}
            </span>
            <span className="status-pill neutral">
              <Icon name="branch" size={12} />
              {snapshot?.branch ?? "detached"}
            </span>
            {snapshot?.behind ? (
              <span className="status-pill blue">
                <Icon name="arrowDown" size={12} />
                本地引用显示落后 {snapshot.behind}
              </span>
            ) : null}
            <span className="status-pill neutral">
              Workspace
            </span>
          </div>
        </div>
        <div className="repository-hero-actions">
          <Button size="small"
            aria-busy={directoryOpening}
            className="repository-hero-action"
            disabled={!repositoryPath || directoryOpening}
            onClick={onOpenDirectory}
            type="button"
          >
            <Icon name="folder" />
            {directoryOpening ? "打开中…" : "打开目录"}
          </Button>
          <Button size="small" variant="primary"
            className="repository-hero-action"
            onClick={() => onOpenTab("changes")}
            type="button"
          >
            <Icon name="fileCode" />
            {changes > 0 ? "查看变更" : "查看状态"}
          </Button>
        </div>
      </section>

      <section className="metric-grid repository-metric-grid">
        <article className="metric-card tone-yellow">
          <div className="metric-label">
            <span>工作区变更</span>
            <span className="metric-icon">
              <Icon name="fileCode" />
            </span>
          </div>
          <strong className="metric-value">{changes}</strong>
          <span className="metric-foot">
            {changeFoot}
          </span>
        </article>
        <article className="metric-card tone-green">
          <div className="metric-label">
            <span>领先远程</span>
            <span className="metric-icon">
              <Icon name="arrowUp" />
            </span>
          </div>
          <strong className="metric-value">
            {snapshot?.ahead ?? 0}
          </strong>
          <span className="metric-foot">{branchFoot}</span>
        </article>
        <article className="metric-card tone-blue">
          <div className="metric-label">
            <span>落后远程</span>
            <span className="metric-icon">
              <Icon name="arrowDown" />
            </span>
          </div>
          <strong className="metric-value">
            {snapshot?.behind ?? 0}
          </strong>
          <span className="metric-foot">{upstreamFoot}</span>
        </article>
        <article className="metric-card tone-purple">
          <div className="metric-label">
            <span>Worktrees</span>
            <span className="metric-icon">
              <Icon name="worktree" />
            </span>
          </div>
          <strong className="metric-value">
            {worktreeCount}
          </strong>
          <span className="metric-foot">
            共享同一个 commonDir
          </span>
        </article>
      </section>

      <section className="dashboard-grid repository-dashboard">
        <article className="panel">
          <header className="panel-header">
            <div className="panel-title">
              <Icon name="history" />
              最近提交
            </div>
            <span className="panel-caption">
              {commits.length
                ? `快照采集 ${commits.length} 条`
                : "暂无提交"}
            </span>
            <Button variant="unstyled"
              className="panel-action"
              onClick={() => onOpenTab("history")}
              type="button"
            >
              打开历史视图
            </Button>
          </header>
          <SkeletonBoundary
            fallback={<RepositoryRecentCommitsSkeleton />}
            hasContent={Boolean(latestCommit)}
            label="正在读取最近提交"
            loading={historyLoading}
            surfaceClassName="repository-overview-skeleton"
          >
            {latestCommit ? (
              <div className="repository-overview-commit-list">
                {commits.map((commit) => (
                  <Button variant="unstyled"
                    aria-current={
                      controller.selectedCommitHash ===
                      commit.hash
                        ? "true"
                        : undefined
                    }
                    className="repository-overview-commit-row"
                    key={commit.hash}
                    onClick={() => {
                      void controller.selectCommit(commit.hash);
                      onOpenTab("history");
                    }}
                    type="button"
                  >
                    <span className="repository-overview-commit-graph">
                      <span className="repository-overview-commit-node" />
                    </span>
                    <span className="repository-overview-commit-message">
                      <strong>{commit.subject}</strong>
                      <span className="repository-overview-commit-refs">
                        {(commit.refs ?? []).length > 0
                          ? (commit.refs ?? []).map((ref) => (
                              <span
                                className={`repository-overview-ref-label${
                                  ref.startsWith("origin")
                                    ? " remote"
                                    : ""
                                }`}
                                key={ref}
                              >
                                {ref}
                              </span>
                            ))
                          : (
                              <span className="repository-overview-ref-label">
                                {snapshot?.branch ?? "detached"}
                              </span>
                            )}
                      </span>
                    </span>
                    <time
                      className="repository-overview-commit-time"
                      dateTime={commit.authoredAt}
                    >
                      {formatCommitTimestamp(commit.authoredAt)}
                    </time>
                    <span className="repository-overview-commit-author">
                      {commit.authorName}
                    </span>
                    <code
                      className="repository-overview-commit-id"
                      aria-label={`复制 Commit ID ${commit.hash}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onCopyCommitId(commit.hash);
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
                        void onCopyCommitId(commit.hash);
                      }}
                      role="button"
                      tabIndex={0}
                      title={`Commit ID ${commit.hash}`}
                    >
                      {commit.shortHash}
                    </code>
                  </Button>
                ))}
              </div>
            ) : (
              <div className="repository-overview-loading">
                <Icon name="history" size={18} />
                暂无提交历史
              </div>
            )}
          </SkeletonBoundary>
        </article>
      </section>
    </>
  );
}

function RepositoryRecentCommitsSkeleton() {
  return (
    <div className="gn-skeleton-list repository-recent-commits-skeleton">
      {[88, 72, 80, 64].map((width, index) => (
        <div className="gn-skeleton-row" key={width}>
          <Skeleton variant="circle" width={12} height={12} />
          <span className="gn-skeleton-row-copy">
            <Skeleton
              variant="text"
              width={`${width}%`}
              height={14}
            />
            <Skeleton variant="text" width="42%" height={11} />
          </span>
          <Skeleton variant="text" width={74} height={12} />
          <Skeleton variant="text" width={58} height={12} />
          <Skeleton
            variant="text"
            width={52 + index * 2}
            height={12}
          />
        </div>
      ))}
    </div>
  );
}
