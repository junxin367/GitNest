import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref
} from "react";

import { copyTextToClipboard } from "../../shared/lib/copyTextToClipboard";
import {
  collectDiffViewerSearchHits,
  parseDiffViewModel,
  type DiffSearchHit,
  type DiffViewerLayout,
  type SplitDiffCell
} from "../../shared/model/diffViewModel";
import { Button } from "../../shared/ui/Button";
import { DiffSearchPopover } from "../../shared/ui/DiffSearchPopover";
import { Icon, type IconName } from "../../shared/ui/Icon";
import type { DiffDocumentFeatureConfig } from "./diffWorkspaceConfiguration";

export type DiffPathCopyStatus =
  | "idle"
  | "copied"
  | "failed";

export interface DiffPanelState {
  icon: Extract<
    IconName,
    | "check"
    | "eye"
    | "fileCode"
    | "files"
    | "refresh"
    | "search"
    | "warning"
  >;
  title: string;
  message: string;
  busy?: boolean;
}

export interface DiffPanelProps {
  config: DiffDocumentFeatureConfig;
  scopeKey: string;
  path?: string | undefined;
  content?: string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
  statsAvailable?: boolean | undefined;
  binary?: boolean | undefined;
  truncated?: boolean | undefined;
  maxLines?: number | undefined;
  emptyPathLabel?: string | undefined;
  emptyStatsLabel?: string | undefined;
  state?: DiffPanelState | undefined;
  headerActions?: ReactNode | undefined;
  className?: string | undefined;
  onPathCopyStatusChange?(
    status: DiffPathCopyStatus
  ): void;
}

export function DiffPanel({
  config,
  scopeKey,
  path,
  content,
  additions = 0,
  deletions = 0,
  statsAvailable,
  binary = false,
  truncated = false,
  maxLines,
  emptyPathLabel = "没有匹配的文件",
  emptyStatsLabel = "筛选结果为空",
  state,
  headerActions,
  className,
  onPathCopyStatusChange
}: DiffPanelProps) {
  const availableLayouts = config.layouts.length
    ? config.layouts
    : (["unified"] as const);
  const configuredDefaultLayout = availableLayouts.includes(
    config.defaultLayout
  )
    ? config.defaultLayout
    : (availableLayouts[0] ?? "unified");
  const [layout, setLayout] = useState<DiffViewerLayout>(
    configuredDefaultLayout
  );
  const [wrap, setWrap] = useState(false);
  const [pathCopyStatus, setPathCopyStatus] =
    useState<DiffPathCopyStatus>("idle");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchHit, setActiveSearchHit] = useState(0);
  const [activeHunk, setActiveHunk] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const limitedContent = useMemo(() => {
    if (!content || !maxLines || maxLines <= 0) {
      return {
        content: content ?? "",
        rendererTruncated: false
      };
    }

    const lines = content.split(/\r?\n/);
    if (lines.length <= maxLines) {
      return { content, rendererTruncated: false };
    }
    return {
      content: lines.slice(0, maxLines).join("\n"),
      rendererTruncated: true
    };
  }, [content, maxLines]);
  const model = useMemo(
    () => parseDiffViewModel(limitedContent.content),
    [limitedContent.content]
  );
  const searchHits = useMemo(
    () =>
      collectDiffViewerSearchHits(model, layout, searchQuery),
    [layout, model, searchQuery]
  );
  const searchHitsBySegment = useMemo(
    () => groupSearchHits(searchHits),
    [searchHits]
  );
  const normalizedActiveSearchHit =
    searchHits.length === 0
      ? -1
      : Math.min(activeSearchHit, searchHits.length - 1);
  const normalizedActiveHunk =
    model.hunkCount === 0
      ? -1
      : Math.min(activeHunk, model.hunkCount - 1);
  const canSearch =
    Boolean(limitedContent.content) && !binary && !state;
  const showToolbar =
    config.showToolbar &&
    (availableLayouts.length > 1 ||
      config.allowWrap ||
      config.showHunkNavigation);
  const hasHeaderActions = Boolean(headerActions);
  const showStats = statsAvailable ?? Boolean(path);

  const reportPathCopyStatus = useCallback(
    (status: DiffPathCopyStatus) => {
      setPathCopyStatus(status);
      onPathCopyStatusChange?.(status);
    },
    [onPathCopyStatusChange]
  );
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setActiveSearchHit(0);
    window.requestAnimationFrame(() => {
      contentRef.current?.focus({ preventScroll: true });
    });
  }, []);
  const moveSearchHit = useCallback(
    (direction: -1 | 1) => {
      if (searchHits.length === 0) {
        return;
      }
      setActiveSearchHit((current) => {
        const normalized =
          ((current % searchHits.length) + searchHits.length) %
          searchHits.length;
        return (
          (normalized + direction + searchHits.length) %
          searchHits.length
        );
      });
    },
    [searchHits.length]
  );
  const moveHunk = (direction: -1 | 1) => {
    if (model.hunkCount === 0) {
      return;
    }
    const next =
      (activeHunk + direction + model.hunkCount) %
      model.hunkCount;
    setActiveHunk(next);
    contentRef.current
      ?.querySelector<HTMLElement>(
        `[data-diff-viewer-hunk="${next}"]`
      )
      ?.scrollIntoView({
        block: "start",
        inline: "nearest"
      });
  };
  const copyPath = async () => {
    if (!path) {
      return;
    }
    reportPathCopyStatus("idle");
    try {
      await copyTextToClipboard(path);
      reportPathCopyStatus("copied");
    } catch {
      reportPathCopyStatus("failed");
    }
  };

  useEffect(() => {
    const nextLayout = availableLayouts.includes(
      config.defaultLayout
    )
      ? config.defaultLayout
      : (availableLayouts[0] ?? "unified");
    setLayout(nextLayout);
    setWrap(false);
  }, [
    availableLayouts,
    config.allowWrap,
    config.defaultLayout
  ]);

  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setActiveSearchHit(0);
    setActiveHunk(0);
    reportPathCopyStatus("idle");
    contentRef.current?.scrollTo({ top: 0, left: 0 });
  }, [reportPathCopyStatus, scopeKey]);

  useEffect(() => {
    if (pathCopyStatus === "idle") {
      return;
    }
    const timeoutId = window.setTimeout(
      () => reportPathCopyStatus("idle"),
      1_600
    );
    return () => window.clearTimeout(timeoutId);
  }, [pathCopyStatus, reportPathCopyStatus]);

  useEffect(() => {
    setActiveSearchHit(0);
  }, [layout, searchQuery]);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus({ preventScroll: true });
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchOpen]);

  useEffect(() => {
    if (normalizedActiveSearchHit < 0) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      contentRef.current
        ?.querySelector<HTMLElement>(
          `[data-diff-viewer-search-hit="${normalizedActiveSearchHit}"]`
        )
        ?.scrollIntoView({
          block: "center",
          inline: "nearest"
        });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [normalizedActiveSearchHit, searchHits]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLocaleLowerCase() === "f" &&
        canSearch
      ) {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        closeSearch();
        return;
      }
      if (
        event.key === "F3" &&
        searchOpen &&
        searchHits.length > 0
      ) {
        event.preventDefault();
        moveSearchHit(event.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () =>
      window.removeEventListener("keydown", handleKeyDown);
  }, [
    canSearch,
    closeSearch,
    moveSearchHit,
    searchHits.length,
    searchOpen
  ]);

  const searchCountLabel = searchQuery.trim()
    ? `${normalizedActiveSearchHit >= 0 ? normalizedActiveSearchHit + 1 : 0} / ${searchHits.length}`
    : "0 / 0";
  const hunkCountLabel = `${normalizedActiveHunk >= 0 ? normalizedActiveHunk + 1 : 0} / ${model.hunkCount}`;
  const pathCopyIcon: IconName =
    pathCopyStatus === "copied"
      ? "check"
      : pathCopyStatus === "failed"
        ? "close"
        : "fileCode";

  return (
    <section
      className={[
        "diff-viewer-panel",
        showToolbar ? "with-toolbar" : "",
        className ?? ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {showToolbar ? (
        <div
          aria-label="Diff 查看工具"
          className="diff-viewer-toolbar"
          role="toolbar"
        >
          <div className="diff-viewer-toolbar-spacer" />
          {availableLayouts.length > 1 ? (
            <div
              aria-label="Diff 布局"
              className="diff-viewer-segmented"
              role="group"
            >
              {availableLayouts.includes("split") ? (
                <Button
                  aria-pressed={layout === "split"}
                  onClick={() => setLayout("split")}
                  selected={layout === "split"}
                  size="small"
                  variant="toolbar"
                >
                  并排
                </Button>
              ) : null}
              {availableLayouts.includes("unified") ? (
                <Button
                  aria-pressed={layout === "unified"}
                  onClick={() => setLayout("unified")}
                  selected={layout === "unified"}
                  size="small"
                  variant="toolbar"
                >
                  统一
                </Button>
              ) : null}
            </div>
          ) : null}
          {config.allowWrap ? (
            <Button
              aria-label="自动换行"
              aria-pressed={wrap}
              className="diff-viewer-wrap-button"
              disabled={!limitedContent.content}
              icon={<Icon name="wrap" size={14} />}
              onClick={() => setWrap((value) => !value)}
              selected={wrap}
              size="small"
              variant="toolbar"
            >
              自动换行
            </Button>
          ) : null}
          {config.showHunkNavigation ? (
            <>
              <span
                aria-hidden="true"
                className="diff-viewer-toolbar-separator"
              />
              <div
                aria-label="变更导航"
                className="diff-viewer-hunk-navigation"
                role="group"
              >
                <Button
                  aria-label="上一处变更"
                  disabled={model.hunkCount === 0}
                  icon={<Icon name="arrowUp" size={14} />}
                  onClick={() => moveHunk(-1)}
                  size="small"
                  title="上一处变更"
                  variant="icon"
                />
                <span className="diff-viewer-hunk-count">
                  {hunkCountLabel}
                </span>
                <Button
                  aria-label="下一处变更"
                  disabled={model.hunkCount === 0}
                  icon={<Icon name="arrowDown" size={14} />}
                  onClick={() => moveHunk(1)}
                  size="small"
                  title="下一处变更"
                  variant="icon"
                />
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <main className="diff-viewer-main">
        <header className="diff-viewer-file-header">
          <div className="diff-viewer-file-heading">
            <Button
              aria-label={
                pathCopyStatus === "copied"
                  ? "文件路径已复制"
                  : pathCopyStatus === "failed"
                    ? "复制文件路径失败"
                    : "复制文件路径"
              }
              className={`diff-viewer-path-copy-button ${pathCopyStatus}`}
              disabled={!path}
              icon={<Icon name={pathCopyIcon} size={14} />}
              onClick={() => void copyPath()}
              size="small"
              title={
                pathCopyStatus === "copied"
                  ? "文件路径已复制"
                  : pathCopyStatus === "failed"
                    ? "复制失败，请重试"
                    : "复制完整文件路径"
              }
              variant="icon"
            />
            <span title={path}>{path ?? emptyPathLabel}</span>
          </div>
          <div className="diff-viewer-header-actions">
            {showStats ? (
              <span
                aria-label={`新增 ${additions} 行，删除 ${deletions} 行`}
                className="diff-viewer-stats"
              >
                <strong>+{additions}</strong>
                <em>-{deletions}</em>
              </span>
            ) : (
              <span className="diff-viewer-stats muted">
                {emptyStatsLabel}
              </span>
            )}
            {hasHeaderActions ? (
              <>
                <span
                  aria-hidden="true"
                  className="diff-viewer-file-header-separator"
                />
                <div className="diff-viewer-header-action-slot">
                  {headerActions}
                </div>
              </>
            ) : null}
          </div>
        </header>

        <DiffSearchPopover
          className="diff-viewer-search"
          countLabel={searchCountLabel}
          hasMatches={searchHits.length > 0}
          onChange={(event) => {
            setSearchQuery(event.target.value);
            setActiveSearchHit(0);
          }}
          onClose={closeSearch}
          onNext={() => moveSearchHit(1)}
          onPrevious={() => moveSearchHit(-1)}
          open={searchOpen && canSearch}
          ref={searchInputRef}
          value={searchQuery}
        />

        <div
          aria-label="文件 Diff"
          aria-busy={state?.busy}
          className={`diff-viewer-code${
            wrap ? " wrap" : ""
          }${
            layout === "split" && !wrap
              ? " split-nowrap"
              : ""
          }`}
          ref={contentRef}
          role="region"
          tabIndex={0}
        >
          {state ? (
            <DiffViewerState {...state} />
          ) : binary ? (
            <DiffViewerState
              icon="files"
              message="二进制文件不在 Renderer 中加载内容。"
              title="二进制文件"
            />
          ) : !limitedContent.content ? (
            <DiffViewerState
              icon="eye"
              message="该文件可能只存在行尾或索引元数据变化。"
              title="没有文本内容差异"
            />
          ) : layout === "split" ? (
            <SplitDiff
              activeHunk={normalizedActiveHunk}
              activeSearchHit={normalizedActiveSearchHit}
              hits={searchHitsBySegment}
              rows={model.splitRows}
              wrap={wrap}
            />
          ) : (
            <UnifiedDiff
              activeHunk={normalizedActiveHunk}
              activeSearchHit={normalizedActiveSearchHit}
              hits={searchHitsBySegment}
              lines={model.unifiedLines}
            />
          )}
          {!state &&
          !binary &&
          (truncated || limitedContent.rendererTruncated) ? (
            <div className="diff-viewer-truncated">
              Diff 已达到安全显示上限，其余内容未载入。
            </div>
          ) : null}
        </div>
      </main>
    </section>
  );
}

export function DiffViewerState({
  icon,
  title,
  message
}: Omit<DiffPanelState, "busy">) {
  return (
    <div className="diff-viewer-state">
      <span>
        <Icon name={icon} size={20} />
      </span>
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}

function SplitDiff({
  rows,
  hits,
  activeSearchHit,
  activeHunk,
  wrap
}: {
  rows: ReturnType<typeof parseDiffViewModel>["splitRows"];
  hits: ReadonlyMap<string, DiffSearchHit[]>;
  activeSearchHit: number;
  activeHunk: number;
  wrap: boolean;
}) {
  const oldPaneRef = useRef<HTMLDivElement>(null);
  const newPaneRef = useRef<HTMLDivElement>(null);
  const oldContentRef = useRef<HTMLDivElement>(null);
  const newContentRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const scrollbarTrackRef = useRef<HTMLDivElement>(null);
  const syncHorizontalScroll = useCallback(
    (source: HTMLDivElement, scrollLeft: number) => {
      [
        oldPaneRef.current,
        newPaneRef.current,
        scrollbarRef.current
      ].forEach((element) => {
        if (
          element &&
          element !== source &&
          element.scrollLeft !== scrollLeft
        ) {
          element.scrollLeft = scrollLeft;
        }
      });
    },
    []
  );
  const updateScrollMetrics = useCallback(() => {
    const oldPane = oldPaneRef.current;
    const newPane = newPaneRef.current;
    const oldContent = oldContentRef.current;
    const newContent = newContentRef.current;
    const scrollbar = scrollbarRef.current;
    const scrollbarTrack = scrollbarTrackRef.current;
    if (
      !oldPane ||
      !newPane ||
      !oldContent ||
      !newContent ||
      !scrollbar ||
      !scrollbarTrack
    ) {
      return;
    }

    oldContent.style.removeProperty("min-width");
    newContent.style.removeProperty("min-width");
    const paneWidth = Math.min(
      oldPane.clientWidth,
      newPane.clientWidth
    );
    const contentWidth = Math.max(
      paneWidth,
      oldPane.scrollWidth,
      newPane.scrollWidth
    );
    oldContent.style.minWidth = `${contentWidth}px`;
    newContent.style.minWidth = `${contentWidth}px`;
    scrollbarTrack.style.width = `${
      contentWidth +
      Math.max(0, scrollbar.clientWidth - paneWidth)
    }px`;
    syncHorizontalScroll(
      scrollbar,
      Math.min(
        scrollbar.scrollLeft,
        Math.max(0, contentWidth - paneWidth)
      )
    );
  }, [syncHorizontalScroll]);

  useLayoutEffect(() => {
    if (wrap) {
      return;
    }

    updateScrollMetrics();
    window.addEventListener("resize", updateScrollMetrics);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateScrollMetrics);
    if (shellRef.current) {
      observer?.observe(shellRef.current);
    }
    return () => {
      window.removeEventListener("resize", updateScrollMetrics);
      observer?.disconnect();
    };
  }, [rows, updateScrollMetrics, wrap]);

  if (!wrap) {
    return (
      <div className="diff-viewer-split-shell" ref={shellRef}>
        <div className="diff-viewer-split-scroll-region">
          <div className="diff-viewer-split-metadata">
            {rows.map((row) =>
              row.kind === "header" || row.kind === "meta" ? (
                <SplitWideRow
                  activeHunk={activeHunk}
                  activeSearchHit={activeSearchHit}
                  hits={hits}
                  key={row.key}
                  row={row}
                />
              ) : null
            )}
          </div>
          <div className="diff-viewer-split-panes">
            <SplitPane
              activeHunk={activeHunk}
              activeSearchHit={activeSearchHit}
              contentRef={oldContentRef}
              hits={hits}
              onHorizontalScroll={syncHorizontalScroll}
              paneRef={oldPaneRef}
              rows={rows}
              side="old"
            />
            <SplitPane
              activeHunk={activeHunk}
              activeSearchHit={activeSearchHit}
              contentRef={newContentRef}
              hits={hits}
              onHorizontalScroll={syncHorizontalScroll}
              paneRef={newPaneRef}
              rows={rows}
              side="new"
            />
          </div>
        </div>
        <div
          aria-label="并排 Diff 水平滚动"
          className="diff-viewer-split-scrollbar"
          onScroll={(event) =>
            syncHorizontalScroll(
              event.currentTarget,
              event.currentTarget.scrollLeft
            )
          }
          ref={scrollbarRef}
          tabIndex={0}
        >
          <div
            className="diff-viewer-split-scrollbar-track"
            ref={scrollbarTrackRef}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="diff-viewer-split-table">
      {rows.map((row) =>
        row.kind === "content" ? (
          <div
            className="diff-viewer-split-row content"
            key={row.key}
          >
            <SplitCell
              activeSearchHit={activeSearchHit}
              cell={row.oldCell}
              hits={hits.get(`${row.key}:old`) ?? []}
            />
            <SplitCell
              activeSearchHit={activeSearchHit}
              cell={row.newCell}
              hits={hits.get(`${row.key}:new`) ?? []}
            />
          </div>
        ) : (
          <SplitWideRow
            activeHunk={activeHunk}
            activeSearchHit={activeSearchHit}
            hits={hits}
            key={row.key}
            row={row}
          />
        )
      )}
    </div>
  );
}

function SplitPane({
  rows,
  hits,
  activeSearchHit,
  activeHunk,
  side,
  paneRef,
  contentRef,
  onHorizontalScroll
}: {
  rows: ReturnType<typeof parseDiffViewModel>["splitRows"];
  hits: ReadonlyMap<string, DiffSearchHit[]>;
  activeSearchHit: number;
  activeHunk: number;
  side: "old" | "new";
  paneRef: Ref<HTMLDivElement>;
  contentRef: Ref<HTMLDivElement>;
  onHorizontalScroll(
    source: HTMLDivElement,
    scrollLeft: number
  ): void;
}) {
  return (
    <div
      aria-label={side === "old" ? "原文件" : "新文件"}
      className={`diff-viewer-split-pane ${side}`}
      onScroll={(event) =>
        onHorizontalScroll(
          event.currentTarget,
          event.currentTarget.scrollLeft
        )
      }
      ref={paneRef}
    >
      <div
        className="diff-viewer-split-pane-content"
        ref={contentRef}
      >
        {rows.map((row) =>
          row.kind === "content" ? (
            <div
              className="diff-viewer-split-pane-row content"
              key={row.key}
            >
              <SplitCell
                activeSearchHit={activeSearchHit}
                cell={
                  side === "old" ? row.oldCell : row.newCell
                }
                hits={hits.get(`${row.key}:${side}`) ?? []}
              />
            </div>
          ) : row.kind === "hunk" ? (
            <SplitWideRow
              activeHunk={activeHunk}
              activeSearchHit={activeSearchHit}
              hits={hits}
              key={row.key}
              row={row}
            />
          ) : null
        )}
      </div>
    </div>
  );
}

function SplitWideRow({
  row,
  hits,
  activeSearchHit,
  activeHunk
}: {
  row: Exclude<
    ReturnType<typeof parseDiffViewModel>["splitRows"][number],
    { kind: "content" }
  >;
  hits: ReadonlyMap<string, DiffSearchHit[]>;
  activeSearchHit: number;
  activeHunk: number;
}) {
  return (
    <div
      className={`diff-viewer-wide-row ${row.kind}${
        row.kind === "hunk" && row.hunkIndex === activeHunk
          ? " current"
          : ""
      }`}
      data-diff-viewer-hunk={row.hunkIndex}
    >
      {row.kind === "hunk" ? <Icon name="diff" size={14} /> : null}
      <code>
        {highlightSearchHits(
          row.text ?? " ",
          hits.get(`${row.key}:full`) ?? [],
          activeSearchHit
        )}
      </code>
    </div>
  );
}

function SplitCell({
  cell,
  hits,
  activeSearchHit
}: {
  cell: SplitDiffCell | undefined;
  hits: readonly DiffSearchHit[];
  activeSearchHit: number;
}) {
  const kind = cell?.kind ?? "empty";
  const marker =
    kind === "removed" ? "−" : kind === "added" ? "+" : "";

  return (
    <>
      <span className={`diff-viewer-line-number ${kind}`}>
        {cell?.lineNumber ?? ""}
      </span>
      <span className={`diff-viewer-change-marker ${kind}`}>
        {marker}
      </span>
      <span className={`diff-viewer-code-cell ${kind}`}>
        <code>
          {cell
            ? highlightSearchHits(
                cell.text || " ",
                hits,
                activeSearchHit
              )
            : " "}
        </code>
      </span>
    </>
  );
}

function UnifiedDiff({
  lines,
  hits,
  activeSearchHit,
  activeHunk
}: {
  lines: ReturnType<typeof parseDiffViewModel>["unifiedLines"];
  hits: ReadonlyMap<string, DiffSearchHit[]>;
  activeSearchHit: number;
  activeHunk: number;
}) {
  return (
    <div className="diff-viewer-unified">
      {lines.map((line) => {
        if (
          line.kind === "hunk" ||
          line.kind === "header" ||
          line.kind === "meta"
        ) {
          return (
            <div
              className={`diff-viewer-wide-row ${line.kind}${
                line.kind === "hunk" &&
                line.hunkIndex === activeHunk
                  ? " current"
                  : ""
              }`}
              data-diff-viewer-hunk={line.hunkIndex}
              key={line.key}
            >
              {line.kind === "hunk" ? (
                <Icon name="diff" size={14} />
              ) : null}
              <code>
                {highlightSearchHits(
                  line.text || " ",
                  hits.get(line.key) ?? [],
                  activeSearchHit
                )}
              </code>
            </div>
          );
        }

        const marker =
          line.kind === "removed"
            ? "−"
            : line.kind === "added"
              ? "+"
              : "";
        return (
          <div
            className={`diff-viewer-unified-line ${line.kind}`}
            key={line.key}
          >
            <span className={`diff-viewer-line-number ${line.kind}`}>
              {line.oldLineNumber ?? ""}
            </span>
            <span className={`diff-viewer-line-number ${line.kind}`}>
              {line.newLineNumber ?? ""}
            </span>
            <span className={`diff-viewer-change-marker ${line.kind}`}>
              {marker}
            </span>
            <span className={`diff-viewer-code-cell ${line.kind}`}>
              <code>
                {highlightSearchHits(
                  line.text || " ",
                  hits.get(line.key) ?? [],
                  activeSearchHit
                )}
              </code>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function groupSearchHits(
  hits: readonly DiffSearchHit[]
): Map<string, DiffSearchHit[]> {
  const grouped = new Map<string, DiffSearchHit[]>();
  for (const hit of hits) {
    const segmentHits = grouped.get(hit.segmentKey);
    if (segmentHits) {
      segmentHits.push(hit);
    } else {
      grouped.set(hit.segmentKey, [hit]);
    }
  }
  return grouped;
}

function highlightSearchHits(
  text: string,
  hits: readonly DiffSearchHit[],
  activeSearchHit: number
): ReactNode {
  if (hits.length === 0) {
    return text;
  }

  const parts: ReactNode[] = [];
  let offset = 0;
  for (const hit of hits) {
    if (hit.start > offset) {
      parts.push(text.slice(offset, hit.start));
    }
    parts.push(
      <mark
        className={`diff-viewer-search-hit${
          hit.index === activeSearchHit ? " current" : ""
        }`}
        data-diff-viewer-search-hit={hit.index}
        key={`${hit.index}:${hit.start}`}
      >
        {text.slice(hit.start, hit.end)}
      </mark>
    );
    offset = hit.end;
  }
  if (offset < text.length) {
    parts.push(text.slice(offset));
  }
  return parts;
}
