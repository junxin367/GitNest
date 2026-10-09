import {
  memo,
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
  type DiffViewerLayout,
  type SplitDiffCell,
  type UnifiedDiffLine
} from "../../shared/model/diffViewModel";
import { Icon } from "../../shared/ui/Icon";
import { Skeleton, SkeletonSurface } from "../../shared/ui/Skeleton";
import {
  DEFAULT_DIFF_CONTEXT_LINES,
  DIFF_CONTEXT_STEP,
  type DiffHunkContextControlsProps,
  type DiffPanelState
} from "./DiffPanel.types";

const EMPTY_SEARCH_HITS: readonly DiffSearchHit[] = [];

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
  const previewKey = objectUrl.url ? `${scopeKey}\0${objectUrl.url}` : null;
  const [decodeFailedKey, setDecodeFailedKey] = useState<string | null>(null);

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

  if (objectUrl.failed || (previewKey !== null && decodeFailedKey === previewKey)) {
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
      key={previewKey}
      className={`diff-viewer-media ${media.kind}`}
      data-media-kind={media.kind}
    >
      {media.kind === "image" ? (
        <img
          alt={`${label} 图片预览`}
          onError={() => setDecodeFailedKey(previewKey)}
          src={objectUrl.url}
        />
      ) : media.kind === "video" ? (
        <video
          aria-label={`${label} 视频预览`}
          controls
          onError={() => setDecodeFailedKey(previewKey)}
          preload="metadata"
          src={objectUrl.url}
        />
      ) : (
        <audio
          aria-label={`${label} 音频预览`}
          controls
          onError={() => setDecodeFailedKey(previewKey)}
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

export function DiffContentSkeleton({
  layout = "unified",
  wrap = false,
  immediate = false
}: { layout?: DiffViewerLayout; wrap?: boolean; immediate?: boolean }) {
  return (
    <SkeletonSurface
      className="diff-content-skeleton"
      data-layout={layout}
      data-wrap={wrap}
      label="正在读取文件内容"
      immediate={immediate}
    >
      {Array.from({ length: layout === "split" ? 2 : 1 }, (_, pane) => (
        <div className="diff-content-skeleton-pane" key={pane}>
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
      ))}
    </SkeletonSurface>
  );
}

export const SplitDiff = memo(function SplitDiff({
  rows,
  hits,
  contextControls,
  wrap
}: {
  rows: ReturnType<typeof parseDiffViewModel>["splitRows"];
  hits: ReadonlyMap<string, DiffSearchHit[]>;
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
              cell={row.oldCell}
              hits={hits.get(`${row.key}:old`) ?? EMPTY_SEARCH_HITS}
            />
            <SplitCell
              cell={row.newCell}
              hits={hits.get(`${row.key}:new`) ?? EMPTY_SEARCH_HITS}
            />
          </div>
        ) : (
          <SplitWideRow
            contextControls={contextControls}
            hits={hits}
            key={row.key}
            row={row}
          />
        )
      )}
    </div>
  );
});

function SplitPane({
  rows,
  hits,
  side,
  paneRef,
  contentRef,
  contextControls,
  showContextControls,
  onHorizontalScroll
}: {
  rows: ReturnType<typeof parseDiffViewModel>["splitRows"];
  hits: ReadonlyMap<string, DiffSearchHit[]>;
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
                cell={
                  side === "old" ? row.oldCell : row.newCell
                }
                hits={hits.get(`${row.key}:${side}`) ?? EMPTY_SEARCH_HITS}
              />
            </div>
          ) : row.kind === "hunk" ? (
            <SplitWideRow
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
  contextControls
}: {
  row: Exclude<
    ReturnType<typeof parseDiffViewModel>["splitRows"][number],
    { kind: "content" }
  >;
  hits: ReadonlyMap<string, DiffSearchHit[]>;
  contextControls?: DiffHunkContextControlsProps | undefined;
}) {
  return (
    <div
      className={`diff-viewer-wide-row ${row.kind}`}
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
            hits.get(`${row.key}:full`) ?? EMPTY_SEARCH_HITS
          )}
        </DiffHunkContextTrigger>
      ) : (
        <code>
          {highlightSearchHits(
            row.text ?? " ",
            hits.get(`${row.key}:full`) ?? EMPTY_SEARCH_HITS
          )}
        </code>
      )}
    </div>
  );
}

const SplitCell = memo(function SplitCell({
  cell,
  hits
}: {
  cell: SplitDiffCell | undefined;
  hits: readonly DiffSearchHit[];
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
                hits
              )
            : " "}
        </code>
      </span>
    </>
  );
});

export const UnifiedDiff = memo(function UnifiedDiff({
  lines,
  hits,
  focusedLineKey,
  contextControls
}: {
  lines: ReturnType<typeof parseDiffViewModel>["unifiedLines"];
  hits: ReadonlyMap<string, DiffSearchHit[]>;
  focusedLineKey?: string | null | undefined;
  contextControls?: DiffHunkContextControlsProps | undefined;
}) {
  return (
    <div className="diff-viewer-unified">
      {lines.map((line) => (
        <UnifiedLine
          contextControls={line.kind === "hunk" ? contextControls : undefined}
          focused={line.key === focusedLineKey}
          hits={hits.get(line.key) ?? EMPTY_SEARCH_HITS}
          key={line.key}
          line={line}
        />
      ))}
    </div>
  );
});

const UnifiedLine = memo(function UnifiedLine({
  line,
  hits,
  focused,
  contextControls
}: {
  line: UnifiedDiffLine;
  hits: readonly DiffSearchHit[];
  focused: boolean;
  contextControls?: DiffHunkContextControlsProps | undefined;
}) {
  if (
    line.kind === "hunk" ||
    line.kind === "header" ||
    line.kind === "meta"
  ) {
    return (
      <div
        className={`diff-viewer-wide-row ${line.kind}`}
        data-diff-viewer-hunk={line.hunkIndex}
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
              hits
            )}
          </DiffHunkContextTrigger>
        ) : (
          <code>
            {highlightSearchHits(
              line.text || " ",
              hits
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
  return (
    <div
      aria-current={focused ? "location" : undefined}
      className={`diff-viewer-unified-line ${line.kind}${
        focused ? " focus-target" : ""
      }`}
      data-diff-viewer-focus-line={
        focused ? "true" : undefined
      }
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
            hits
          )}
        </code>
      </span>
    </div>
  );
});

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
  hits: readonly DiffSearchHit[]
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
        className="diff-viewer-search-hit"
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
