import { Skeleton, SkeletonSurface } from "../../shared/ui/Skeleton";

export const CODE_ANALYSIS_SKELETON_CLASS =
  "page-scroll code-analysis-page analysis-page-skeleton";

export function CodeAnalysisLoadingFallback() {
  return (
    <SkeletonSurface
      label="正在读取代码分析"
      className={CODE_ANALYSIS_SKELETON_CLASS}
      data-layout="analysis"
    >
      <CodeAnalysisSkeleton />
    </SkeletonSurface>
  );
}

export function CodeAnalysisSkeleton() {
  return (
    <>
      <header aria-hidden="true" className="analysis-page-header">
        <div className="analysis-page-title-row">
          <h1 className="analysis-skeleton-title">
            <Skeleton height={24} width={96} />
          </h1>
          <div className="analysis-header-actions">
            <Skeleton height={38} width={178} />
            <Skeleton height="var(--control-compact)" width={96} />
            <Skeleton
              className="analysis-skeleton-run-action"
              height="var(--control-compact)"
              width={112}
            />
          </div>
        </div>
        <p className="analysis-skeleton-description">
          <Skeleton
            height={10}
            variant="text"
            width="min(260px, 100%)"
          />
        </p>
      </header>

      <section
        aria-hidden="true"
        className="analysis-summary-grid"
      >
        {[56, 48, 52, 46, 50].map((width, index) => (
          <article
            className="panel analysis-summary-card analysis-skeleton-summary-card"
            key={index}
          >
            <div className="analysis-skeleton-summary-label">
              <Skeleton
                height={9}
                variant="text"
                width={`${width}%`}
              />
            </div>
            <div className="analysis-skeleton-summary-value">
              <Skeleton height={16} width="42%" />
            </div>
          </article>
        ))}
      </section>

      <div
        aria-hidden="true"
        className="analysis-runtime-strip analysis-skeleton-runtime"
      >
        {/* Only time and duration are guaranteed before the snapshot arrives. */}
        {[208, 88].map((width) => (
          <span key={width}>
            <Skeleton height={9} variant="text" width={width} />
          </span>
        ))}
      </div>

      <div
        aria-hidden="true"
        className="analysis-workbench"
      >
        <aside className="panel analysis-chain-panel">
          <header>
            <div className="analysis-skeleton-heading-row">
              <Skeleton height={13} width={72} />
              <Skeleton
                height={9}
                variant="text"
                width={68}
              />
            </div>
            <div className="analysis-navigation-tabs">
              <Skeleton height={28} />
              <Skeleton height={28} />
            </div>
            <Skeleton height="var(--control-compact)" />
            <Skeleton height="var(--control-compact)" />
          </header>
          <div className="analysis-chain-list analysis-skeleton-navigation-list">
            <div className="analysis-skeleton-navigation-rows">
              {[76, 62, 82, 68, 72].map((width, index) => (
                <div
                  className="analysis-skeleton-navigation-row"
                  key={index}
                >
                  <div>
                    <Skeleton height={20} width={48} />
                    <Skeleton height={11} width={`${width}%`} />
                  </div>
                  <div className="analysis-skeleton-navigation-meta">
                    <Skeleton
                      height={9}
                      variant="text"
                      width={`${Math.max(44, width - 18)}%`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <div className="analysis-graph-workspace">
          <section className="panel analysis-graph-panel">
            <header className="analysis-panel-heading">
              <div className="analysis-skeleton-graph-heading">
                <strong>
                  <Skeleton height={13} width={42} />
                </strong>
                <span>
                  <Skeleton height={9} variant="text" width={148} />
                </span>
              </div>
              <div className="analysis-panel-heading-actions">
                <span className="status-pill neutral">
                  <span className="analysis-skeleton-copy">
                    自由拖动 · 滚轮缩放
                    <Skeleton height={9} variant="text" />
                  </span>
                </span>
                <Skeleton
                  height="var(--control-compact)"
                  width="var(--control-compact)"
                />
              </div>
            </header>
            <div className="analysis-graph-stage">
              {/* Graph topology is unknown until a snapshot is available. */}
              <Skeleton className="analysis-skeleton-canvas" />
              <div className="analysis-graph-controls analysis-skeleton-graph-controls">
                {[26, 84, 38, 26, 26, 26].map((width, index) => (
                  <div key={index}>
                    <Skeleton
                      height={index === 1 || index === 2 ? 9 : 26}
                      width={width}
                    />
                  </div>
                ))}
              </div>
              <div className="analysis-graph-direction-hint">
                <span className="analysis-skeleton-copy">
                  滚轮缩放 · 任意方向拖动画布 · 点击空白关闭详情
                  <Skeleton height={9} variant="text" />
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
