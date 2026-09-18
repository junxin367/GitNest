import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref
} from "react";

import type { RepositoryMediaPreviewDto } from "@gitnest/contracts";

import {
  parseDiffViewModel,
  type DiffSearchHit,
  type SplitDiffCell
} from "../../shared/model/diffViewModel";
import { Icon } from "../../shared/ui/Icon";
import { Skeleton } from "../../shared/ui/Skeleton";
import {
  DEFAULT_DIFF_CONTEXT_LINES,
  DIFF_CONTEXT_STEP,
  type DiffHunkContextControlsProps,
  type DiffPanelState
} from "./DiffPanel.types";

const DIFF_CONTENT_SKELETON_ROWS = [
  "short",
  "medium",
  "long",
  "medium",
  "short",
  "long",
  "medium",
  "long",
  "short",
  "medium"
] as const;

export function DiffMediaPreview({
  media,
  path,
  scopeKey
}: {
  media: RepositoryMediaPreviewDto;
  path?: string | undefined;
  scopeKey: string;
}) {
  const objectUrl = useMediaObjectUrl(media);
  const [decodeFailed, setDecodeFailed] = useState(false);

  useEffect(() => {
    setDecodeFailed(false);
  }, [media, scopeKey]);

  if (media.status === "unavailable") {
    if (media.reason === "too-large") {
      return (
        <DiffViewerState
          icon="files"
          message="媒体文件超过 50 MB 预览上限，请通过文件右键菜单在外部应用中打开。"
          title="文件过大"
        />
      );
    }
    if (media.reason === "missing") {
      return (
        <DiffViewerState
          icon="eye"
          message="所选变更的当前版本不存在，可能已被删除。"
          title="当前版本不可预览"
        />
      );
    }
    return (
      <DiffViewerState
        icon="warning"
        message="当前路径不是可安全预览的普通文件，请在外部应用中查看。"
        title="无法预览文件"
      />
    );
  }

  if (objectUrl.failed || decodeFailed) {
    return (
      <DiffViewerState
        icon="warning"
        message="Electron 无法解码该媒体格式或编码，请在外部应用中打开。"
        title="媒体预览失败"
      />
    );
  }
  if (!objectUrl.url) {
    return (
      <DiffViewerState
        icon="refresh"
        message="正在创建安全的本地媒体预览。"
        title="准备媒体预览…"
      />
    );
  }

  const label = path ?? "所选文件";
  return (
    <div
      className={`diff-viewer-media ${media.kind}`}
      data-media-kind={media.kind}
    >
      {media.kind === "image" ? (
        <img
          alt={`${label} 图片预览`}
          onError={() => setDecodeFailed(true)}
          src={objectUrl.url}
        />
      ) : media.kind === "video" ? (
        <video
          aria-label={`${label} 视频预览`}
          controls
          onError={() => setDecodeFailed(true)}
          preload="metadata"
          src={objectUrl.url}
        />
      ) : (
        <audio
          aria-label={`${label} 音频预览`}
          controls
          onError={() => setDecodeFailed(true)}
          preload="metadata"
          src={objectUrl.url}
        />
      )}
    </div>
  );
}

function useMediaObjectUrl(
  media: RepositoryMediaPreviewDto
): {
  url: string | undefined;
  failed: boolean;
} {
  const [state, setState] = useState<{
    source: RepositoryMediaPreviewDto | undefined;
    url: string | undefined;
    failed: boolean;
  }>({
    source: undefined,
    url: undefined,
    failed: false
  });

  useEffect(() => {
    if (media.status !== "available") {
      setState({
        source: media,
        url: undefined,
        failed: false
      });
      return;
    }

    let nextUrl: string | undefined;
    try {
      const bytes = Uint8Array.from(media.content);
      nextUrl = URL.createObjectURL(
        new Blob([bytes.buffer], {
          type: media.mimeType
        })
      );
      setState({
        source: media,
        url: nextUrl,
        failed: false
      });
    } catch {
      setState({
        source: media,
        url: undefined,
        failed: true
      });
    }

    return () => {
      if (nextUrl) {
        URL.revokeObjectURL(nextUrl);
      }
    };
  }, [media]);

  return state.source === media
    ? {
        url: state.url,
        failed: state.failed
      }
    : {
        url: undefined,
        failed: false
      };
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

export function DiffContentSkeleton() {
  return (
    <div aria-hidden="true" className="diff-content-skeleton">
      <div className="diff-workspace-skeleton-hunk">
        <Skeleton className="diff-workspace-skeleton-hunk-title" />
      </div>
      <div className="diff-workspace-skeleton-code">
        {DIFF_CONTENT_SKELETON_ROWS.map((width, index) => (
          <div
            className={`diff-workspace-skeleton-code-row is-${width}`}
            key={`code-${index + 1}`}
          >
            <Skeleton className="diff-workspace-skeleton-line-number" />
            <Skeleton className="diff-workspace-skeleton-code-line" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SplitDiff({
  rows,
  hits,
  activeSearchHit,
  activeHunk,
  contextControls,
  wrap
}: {
  rows: ReturnType<typeof parseDiffViewModel>["splitRows"];
  hits: ReadonlyMap<string, DiffSearchHit[]>;
  activeSearchHit: number;
  activeHunk: number;
  contextControls?: DiffHunkContextControlsProps | undefined;
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
                  contextControls={contextControls}
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
              contextControls={contextControls}
              hits={hits}
              onHorizontalScroll={syncHorizontalScroll}
              paneRef={oldPaneRef}
              rows={rows}
              showContextControls
              side="old"
            />
            <SplitPane
              activeHunk={activeHunk}
              activeSearchHit={activeSearchHit}
              contentRef={newContentRef}
              contextControls={contextControls}
              hits={hits}
              onHorizontalScroll={syncHorizontalScroll}
              paneRef={newPaneRef}
              rows={rows}
              showContextControls
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
            contextControls={contextControls}
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
  contextControls,
  showContextControls,
  onHorizontalScroll
}: {
  rows: ReturnType<typeof parseDiffViewModel>["splitRows"];
  hits: ReadonlyMap<string, DiffSearchHit[]>;
  activeSearchHit: number;
  activeHunk: number;
  side: "old" | "new";
  paneRef: Ref<HTMLDivElement>;
  contentRef: Ref<HTMLDivElement>;
  contextControls?: DiffHunkContextControlsProps | undefined;
  showContextControls: boolean;
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
              contextControls={
                showContextControls
                  ? contextControls
                  : undefined
              }
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
  activeHunk,
  contextControls
}: {
  row: Exclude<
    ReturnType<typeof parseDiffViewModel>["splitRows"][number],
    { kind: "content" }
  >;
  hits: ReadonlyMap<string, DiffSearchHit[]>;
  activeSearchHit: number;
  activeHunk: number;
  contextControls?: DiffHunkContextControlsProps | undefined;
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
      {row.kind === "hunk" &&
      row.hunkIndex !== undefined &&
      contextControls ? (
        <DiffHunkContextTrigger
          {...contextControls}
          hunkIndex={row.hunkIndex}
        >
          {highlightSearchHits(
            row.text ?? " ",
            hits.get(`${row.key}:full`) ?? [],
            activeSearchHit
          )}
        </DiffHunkContextTrigger>
      ) : (
        <code>
          {highlightSearchHits(
            row.text ?? " ",
            hits.get(`${row.key}:full`) ?? [],
            activeSearchHit
          )}
        </code>
      )}
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

export function UnifiedDiff({
  lines,
  hits,
  activeSearchHit,
  activeHunk,
  focusedLineKey,
  contextControls
}: {
  lines: ReturnType<typeof parseDiffViewModel>["unifiedLines"];
  hits: ReadonlyMap<string, DiffSearchHit[]>;
  activeSearchHit: number;
  activeHunk: number;
  focusedLineKey?: string | null | undefined;
  contextControls?: DiffHunkContextControlsProps | undefined;
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
              {line.kind === "hunk" &&
              line.hunkIndex !== undefined &&
              contextControls ? (
                <DiffHunkContextTrigger
                  {...contextControls}
                  hunkIndex={line.hunkIndex}
                >
                  {highlightSearchHits(
                    line.text || " ",
                    hits.get(line.key) ?? [],
                    activeSearchHit
                  )}
                </DiffHunkContextTrigger>
              ) : (
                <code>
                  {highlightSearchHits(
                    line.text || " ",
                    hits.get(line.key) ?? [],
                    activeSearchHit
                  )}
                </code>
              )}
            </div>
          );
        }

        const marker =
          line.kind === "removed"
            ? "−"
            : line.kind === "added"
              ? "+"
              : "";
        const focused = line.key === focusedLineKey;
        return (
          <div
            aria-current={focused ? "location" : undefined}
            className={`diff-viewer-unified-line ${line.kind}${
              focused ? " focus-target" : ""
            }`}
            data-diff-viewer-focus-line={
              focused ? "true" : undefined
            }
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

function DiffHunkContextTrigger({
  hunkContextStates,
  contextLoading,
  hunkIndex,
  onContextMenu,
  onContextRequest,
  children
}: DiffHunkContextControlsProps & {
  hunkIndex: number;
  children: ReactNode;
}) {
  const context = hunkContextStates[hunkIndex] ?? {
    beforeLines: DEFAULT_DIFF_CONTEXT_LINES,
    afterLines: DEFAULT_DIFF_CONTEXT_LINES,
    full: false
  };
  const expanded =
    context.full ||
    context.beforeLines > DEFAULT_DIFF_CONTEXT_LINES ||
    context.afterLines > DEFAULT_DIFF_CONTEXT_LINES;
  const direction = expanded ? "reset" : "around";
  return (
    <button
      aria-label={
        expanded
          ? `收起第 ${hunkIndex + 1} 个变更块上下文`
          : `展开第 ${hunkIndex + 1} 个变更块上下各 ${DIFF_CONTEXT_STEP} 行`
      }
      aria-expanded={expanded}
      className="diff-viewer-hunk-trigger"
      disabled={contextLoading}
      onContextMenu={(event) =>
        onContextMenu(event, hunkIndex)
      }
      onClick={() =>
        onContextRequest({
          direction,
          hunkIndex,
          contextLines: expanded
            ? DEFAULT_DIFF_CONTEXT_LINES
            : DIFF_CONTEXT_STEP
        })
      }
      title={
        expanded
          ? "点击收起当前变更块，恢复默认 3 行上下文"
          : `点击查看当前变更块上方和下方各 ${DIFF_CONTEXT_STEP} 行代码`
      }
      type="button"
    >
      <code>{children}</code>
    </button>
  );
}

export function groupSearchHits(
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
