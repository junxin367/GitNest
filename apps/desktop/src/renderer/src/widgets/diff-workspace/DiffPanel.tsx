import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from "react";

import { copyTextToClipboard } from "../../shared/lib/copyTextToClipboard";
import {
  buildLocalizedDiffContent,
  collectDiffViewerSearchHits,
  parseDiffViewModel,
  type DiffViewerLayout
} from "../../shared/model/diffViewModel";
import { Button } from "../../shared/ui/Button";
import { DiffSearchPopover } from "../../shared/ui/DiffSearchPopover";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { LayerPortal } from "../../shared/ui/LayerPortal";
import { Menu, MenuItem } from "../../shared/ui/Menu";
import {
  DiffContentSkeleton,
  DiffMediaPreview,
  DiffViewerState,
  SplitDiff,
  UnifiedDiff,
  groupSearchHits
} from "./DiffPanelContent";
import {
  DEFAULT_DIFF_CONTEXT_LINES,
  DIFF_CONTEXT_STEP,
  FULL_DIFF_CONTEXT_LINES,
  type DiffContextRequest,
  type DiffHunkContextState,
  type DiffPanelProps,
  type DiffPathCopyStatus
} from "./DiffPanel.types";

export {
  DEFAULT_DIFF_CONTEXT_LINES,
  DIFF_CONTEXT_STEP,
  FULL_DIFF_CONTEXT_LINES
} from "./DiffPanel.types";
export type {
  DiffContextDirection,
  DiffContextRequest,
  DiffPanelProps,
  DiffPanelState,
  DiffPathCopyStatus
} from "./DiffPanel.types";
export {
  DiffContentSkeleton,
  DiffViewerState
} from "./DiffPanelContent";

const HUNK_CONTEXT_MENU_WIDTH = 222;
const HUNK_CONTEXT_MENU_HEIGHT = 52;
const CONTEXT_MENU_VIEWPORT_PADDING = 8;
const searchQueriesByScope = new Map<string, string>();

interface DiffContextState {
  scopeKey: string;
  hunks: Record<number, DiffHunkContextState>;
}

interface DiffHunkContextMenuState {
  contentIdentity: string;
  hunkIndex: number;
  x: number;
  y: number;
}

interface PendingDiffHunkFocus {
  contentIdentity: string;
  hunkIndex: number;
  sawLoading: boolean;
  waitForRefresh: boolean;
}

export function DiffPanel({
  config,
  scopeKey,
  searchScopeKey,
  path,
  content,
  additions = 0,
  deletions = 0,
  statsAvailable,
  binary = false,
  media,
  truncated = false,
  maxLines,
  emptyPathLabel = "没有匹配的文件",
  emptyStatsLabel = "筛选结果为空",
  state,
  focusLine,
  headerActions,
  className,
  keyboardShortcutsEnabled = true,
  searchOpen: controlledSearchOpen,
  onSearchOpenChange,
  onPathCopyStatusChange,
  preferredLayout,
  preferredWrap,
  onLayoutPreferenceChange,
  onWrapPreferenceChange,
  contextLines = DEFAULT_DIFF_CONTEXT_LINES,
  contextLoading = false,
  onContextRequest
}: DiffPanelProps) {
  const availableLayouts = config.layouts.length
    ? config.layouts
    : (["unified"] as const);
  const configuredDefaultLayout = availableLayouts.includes(
    config.defaultLayout
  )
    ? config.defaultLayout
    : (availableLayouts[0] ?? "unified");
  const [internalLayout, setInternalLayout] =
    useState<DiffViewerLayout>(
    configuredDefaultLayout
  );
  const layout =
    preferredLayout &&
    availableLayouts.includes(preferredLayout)
      ? preferredLayout
      : internalLayout;
  const [internalWrap, setInternalWrap] = useState(false);
  const wrap = preferredWrap ?? internalWrap;
  const [pathCopyStatus, setPathCopyStatus] =
    useState<DiffPathCopyStatus>("idle");
  const [internalSearchOpen, setInternalSearchOpen] =
    useState(false);
  const searchOpen =
    controlledSearchOpen ?? internalSearchOpen;
  const setSearchOpen = useCallback(
    (open: boolean) => {
      setInternalSearchOpen(open);
      onSearchOpenChange?.(open);
    },
    [onSearchOpenChange]
  );
  const resolvedSearchScopeKey = searchScopeKey ?? scopeKey;
  const [searchQueries, setSearchQueries] = useState<
    ReadonlyMap<string, string>
  >(() => new Map(searchQueriesByScope));
  const searchQuery =
    searchQueries.get(resolvedSearchScopeKey) ??
    searchQueriesByScope.get(resolvedSearchScopeKey) ??
    "";
  const setSearchQuery = useCallback(
    (value: string) => {
      setSearchQueries((current) => {
        if (
          (current.get(resolvedSearchScopeKey) ?? "") === value
        ) {
          return current;
        }
        const next = new Map(current);
        if (value) {
          next.set(resolvedSearchScopeKey, value);
        } else {
          next.delete(resolvedSearchScopeKey);
        }
        if (resolvedSearchScopeKey) {
          if (value) {
            searchQueriesByScope.set(
              resolvedSearchScopeKey,
              value
            );
          } else {
            searchQueriesByScope.delete(
              resolvedSearchScopeKey
            );
          }
        }
        return next;
      });
    },
    [resolvedSearchScopeKey]
  );
  const [activeSearchHit, setActiveSearchHit] = useState(0);
  const [activeHunk, setActiveHunk] = useState(0);
  const [diffContextState, setDiffContextState] =
    useState<DiffContextState>({
      scopeKey,
      hunks: {}
    });
  const [hunkContextMenu, setHunkContextMenu] =
    useState<DiffHunkContextMenuState | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const hunkContextMenuRef = useRef<HTMLDivElement>(null);
  const hunkContextMenuReturnFocusRef =
    useRef<HTMLButtonElement | null>(null);
  const pendingHunkContextFocusRef =
    useRef<PendingDiffHunkFocus | null>(null);
  const compactContentRef = useRef({
    scopeKey,
    content: content ?? ""
  });
  const contextAnchorRef = useRef<{
    hunkIndex: number;
    offsetTop: number;
    scrollTop: number;
  } | null>(null);
  const hasMediaPreview = media !== undefined;
  const contentIdentity = content ?? "";
  if (compactContentRef.current.scopeKey !== scopeKey) {
    compactContentRef.current = {
      scopeKey,
      content: content ?? ""
    };
  }
  const hunkContextStates =
    diffContextState.scopeKey === scopeKey
      ? diffContextState.hunks
      : {};
  const localizedContent = useMemo(
    () =>
      hasMediaPreview
        ? ""
        : buildLocalizedDiffContent(
            compactContentRef.current.content || content || "",
            content || "",
            hunkContextStates
          ),
    [
      content,
      hasMediaPreview,
      hunkContextStates,
      scopeKey
    ]
  );

  const limitedContent = useMemo(() => {
    if (!localizedContent || !maxLines || maxLines <= 0) {
      return {
        content: localizedContent,
        rendererTruncated: false
      };
    }

    const lines = localizedContent.split(/\r?\n/);
    if (lines.length <= maxLines) {
      return {
        content: localizedContent,
        rendererTruncated: false
      };
    }
    return {
      content: lines.slice(0, maxLines).join("\n"),
      rendererTruncated: true
    };
  }, [localizedContent, maxLines]);
  const model = useMemo(
    () => parseDiffViewModel(limitedContent.content),
    [limitedContent.content]
  );
  const focusedUnifiedLineKey = useMemo(() => {
    if (
      focusLine === undefined ||
      focusLine < 1 ||
      !Number.isInteger(focusLine)
    ) {
      return null;
    }
    return (
      model.unifiedLines.find(
        (line) => line.newLineNumber === focusLine
      )?.key ??
      model.unifiedLines.find(
        (line) => line.oldLineNumber === focusLine
      )?.key ??
      null
    );
  }, [focusLine, model.unifiedLines]);
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
    Boolean(limitedContent.content) &&
    !binary &&
    !hasMediaPreview &&
    !state;
  const canExpandContext = Boolean(
    config.allowContextExpansion &&
      onContextRequest &&
      limitedContent.content &&
      !binary &&
      !hasMediaPreview &&
      !truncated &&
      !limitedContent.rendererTruncated &&
      !state
  );
  const showToolbar =
    !hasMediaPreview &&
    config.showToolbar &&
    (availableLayouts.length > 1 ||
      config.allowWrap ||
      config.showHunkNavigation);
  const hasHeaderActions = Boolean(headerActions);
  const showStats = statsAvailable ?? Boolean(path);
  const showEmptyStatsLabel = Boolean(
    emptyStatsLabel.trim()
  );
  const showStatsContent = showStats || showEmptyStatsLabel;

  const reportPathCopyStatus = useCallback(
    (status: DiffPathCopyStatus) => {
      setPathCopyStatus(status);
      onPathCopyStatusChange?.(status);
    },
    [onPathCopyStatusChange]
  );
  const requestDiffContext = useCallback(
    (request: DiffContextRequest) => {
      const viewport = contentRef.current;
      const hunk = viewport?.querySelector<HTMLElement>(
        `[data-diff-viewer-hunk="${request.hunkIndex}"]`
      );
      if (viewport && hunk) {
        contextAnchorRef.current = {
          hunkIndex: request.hunkIndex,
          offsetTop:
            hunk.getBoundingClientRect().top -
            viewport.getBoundingClientRect().top,
          scrollTop: viewport.scrollTop
        };
      }

      if (
        contextLines <= DEFAULT_DIFF_CONTEXT_LINES &&
        content
      ) {
        compactContentRef.current = {
          scopeKey,
          content
        };
      }

      const currentHunks =
        diffContextState.scopeKey === scopeKey
          ? diffContextState.hunks
          : {};
      const current = currentHunks[request.hunkIndex] ?? {
        beforeLines: DEFAULT_DIFF_CONTEXT_LINES,
        afterLines: DEFAULT_DIFF_CONTEXT_LINES,
        full: false
      };
      const next =
        request.direction === "reset"
          ? undefined
          : request.direction === "all"
            ? {
                beforeLines: FULL_DIFF_CONTEXT_LINES,
                afterLines: FULL_DIFF_CONTEXT_LINES,
                full: true
              }
            : request.direction === "around"
              ? {
                  beforeLines: DIFF_CONTEXT_STEP,
                  afterLines: DIFF_CONTEXT_STEP,
                  full: false
                }
              : request.direction === "up"
              ? {
                  ...current,
                  beforeLines:
                    current.beforeLines + DIFF_CONTEXT_STEP,
                  full: false
                }
              : {
                  ...current,
                  afterLines:
                    current.afterLines + DIFF_CONTEXT_STEP,
                  full: false
                };
      const nextHunks = { ...currentHunks };
      if (next) {
        nextHunks[request.hunkIndex] = next;
      } else {
        delete nextHunks[request.hunkIndex];
      }
      setDiffContextState({
        scopeKey,
        hunks: nextHunks
      });

      if (!next) {
        return;
      }
      const requiredContextLines = Math.max(
        next.beforeLines,
        next.afterLines
      );
      if (requiredContextLines > contextLines) {
        onContextRequest?.({
          ...request,
          contextLines: requiredContextLines
        });
      }
    },
    [
      content,
      contextLines,
      diffContextState,
      onContextRequest,
      scopeKey
    ]
  );
  const closeHunkContextMenu = useCallback(
    (restoreFocus = false) => {
      const returnFocus =
        hunkContextMenuReturnFocusRef.current;
      hunkContextMenuReturnFocusRef.current = null;
      setHunkContextMenu(null);
      if (restoreFocus && returnFocus?.isConnected) {
        window.requestAnimationFrame(() =>
          returnFocus.focus({ preventScroll: true })
        );
      }
    },
    []
  );
  const openHunkContextMenu = useCallback(
    (
      event: ReactMouseEvent<HTMLButtonElement>,
      hunkIndex: number
    ) => {
      event.preventDefault();
      event.stopPropagation();
      if (!canExpandContext || contextLoading) {
        return;
      }

      const trigger = event.currentTarget;
      const triggerRect = trigger.getBoundingClientRect();
      const useTriggerPosition =
        event.clientX === 0 && event.clientY === 0;
      const requestedX = useTriggerPosition
        ? triggerRect.left + Math.min(triggerRect.width, 24)
        : event.clientX;
      const requestedY = useTriggerPosition
        ? triggerRect.bottom
        : event.clientY;
      const maxX = Math.max(
        CONTEXT_MENU_VIEWPORT_PADDING,
        window.innerWidth -
          HUNK_CONTEXT_MENU_WIDTH -
          CONTEXT_MENU_VIEWPORT_PADDING
      );
      const maxY = Math.max(
        CONTEXT_MENU_VIEWPORT_PADDING,
        window.innerHeight -
          HUNK_CONTEXT_MENU_HEIGHT -
          CONTEXT_MENU_VIEWPORT_PADDING
      );

      hunkContextMenuReturnFocusRef.current = trigger;
      setActiveHunk(hunkIndex);
      setHunkContextMenu({
        contentIdentity,
        hunkIndex,
        x: Math.max(
          CONTEXT_MENU_VIEWPORT_PADDING,
          Math.min(requestedX, maxX)
        ),
        y: Math.max(
          CONTEXT_MENU_VIEWPORT_PADDING,
          Math.min(requestedY, maxY)
        )
      });
    },
    [canExpandContext, contentIdentity, contextLoading]
  );
  const chooseHunkContextMenuAction = useCallback(() => {
    if (
      !hunkContextMenu ||
      !canExpandContext ||
      contextLoading ||
      hunkContextMenu.contentIdentity !== contentIdentity
    ) {
      closeHunkContextMenu();
      return;
    }

    const full = Boolean(
      hunkContextStates[hunkContextMenu.hunkIndex]?.full
    );
    const hunkIndex = hunkContextMenu.hunkIndex;
    pendingHunkContextFocusRef.current = {
      contentIdentity,
      hunkIndex,
      sawLoading: false,
      waitForRefresh:
        !full && FULL_DIFF_CONTEXT_LINES > contextLines
    };
    closeHunkContextMenu();
    contentRef.current?.focus({ preventScroll: true });
    requestDiffContext({
      direction: full ? "reset" : "all",
      hunkIndex,
      contextLines: full
        ? DEFAULT_DIFF_CONTEXT_LINES
        : FULL_DIFF_CONTEXT_LINES
    });
  }, [
    canExpandContext,
    closeHunkContextMenu,
    contentIdentity,
    contextLines,
    contextLoading,
    hunkContextMenu,
    hunkContextStates,
    requestDiffContext
  ]);
  const contextControls = canExpandContext
    ? {
        hunkContextStates,
        contextLoading,
        onContextMenu: openHunkContextMenu,
        onContextRequest: requestDiffContext
      }
    : undefined;
  useEffect(() => {
    hunkContextMenuReturnFocusRef.current = null;
    pendingHunkContextFocusRef.current = null;
    setHunkContextMenu(null);
  }, [scopeKey]);
  useEffect(() => {
    if (!hunkContextMenu) {
      return;
    }
    if (
      !canExpandContext ||
      contextLoading ||
      hunkContextMenu.contentIdentity !== contentIdentity ||
      hunkContextMenu.hunkIndex >= model.hunkCount
    ) {
      closeHunkContextMenu();
      return;
    }

    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        hunkContextMenuRef.current?.contains(target)
      ) {
        return;
      }
      closeHunkContextMenu();
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeHunkContextMenu(true);
      }
    };
    const closeFromViewportChange = () => {
      closeHunkContextMenu();
    };
    const focusFrame = window.requestAnimationFrame(() => {
      hunkContextMenuRef.current
        ?.querySelector<HTMLButtonElement>(
          "[role='menuitem']:not(:disabled)"
        )
        ?.focus();
    });

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    document.addEventListener(
      "scroll",
      closeFromViewportChange,
      true
    );
    window.addEventListener("blur", closeFromViewportChange);
    window.addEventListener(
      "resize",
      closeFromViewportChange
    );
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener(
        "pointerdown",
        closeFromOutside
      );
      document.removeEventListener(
        "keydown",
        closeFromKeyboard
      );
      document.removeEventListener(
        "scroll",
        closeFromViewportChange,
        true
      );
      window.removeEventListener(
        "blur",
        closeFromViewportChange
      );
      window.removeEventListener(
        "resize",
        closeFromViewportChange
      );
    };
  }, [
    canExpandContext,
    closeHunkContextMenu,
    contentIdentity,
    contextLoading,
    hunkContextMenu,
    model.hunkCount
  ]);
  useEffect(() => {
    const pending = pendingHunkContextFocusRef.current;
    if (!pending) {
      return;
    }
    if (contextLoading) {
      pending.sawLoading = true;
      return;
    }
    if (
      pending.waitForRefresh &&
      !pending.sawLoading &&
      pending.contentIdentity === contentIdentity
    ) {
      return;
    }

    const focusFrame = window.requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      if (
        activeElement &&
        activeElement !== document.body &&
        activeElement !== contentRef.current
      ) {
        pendingHunkContextFocusRef.current = null;
        return;
      }

      const trigger =
        contentRef.current?.querySelector<HTMLButtonElement>(
          `[data-diff-viewer-hunk="${pending.hunkIndex}"] .diff-viewer-hunk-trigger:not(:disabled)`
        );
      if (trigger) {
        trigger.focus({ preventScroll: true });
      } else {
        contentRef.current?.focus({ preventScroll: true });
      }
      pendingHunkContextFocusRef.current = null;
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [
    contentIdentity,
    contextLoading,
    hunkContextStates,
    layout,
    limitedContent.content
  ]);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setActiveSearchHit(0);
    window.requestAnimationFrame(() => {
      contentRef.current?.focus({ preventScroll: true });
    });
  }, [setSearchOpen, setSearchQuery]);
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
    setInternalLayout(nextLayout);
    if (preferredWrap === undefined) {
      setInternalWrap(false);
    }
  }, [
    availableLayouts,
    config.allowWrap,
    config.defaultLayout,
    preferredWrap
  ]);

  useEffect(() => {
    contextAnchorRef.current = null;
    setSearchOpen(false);
    setActiveSearchHit(0);
    setActiveHunk(0);
    reportPathCopyStatus("idle");
    contentRef.current?.scrollTo({ top: 0, left: 0 });
  }, [
    reportPathCopyStatus,
    resolvedSearchScopeKey,
    setSearchOpen,
    scopeKey
  ]);

  useEffect(() => {
    setDiffContextState({
      scopeKey,
      hunks: {}
    });
  }, [scopeKey]);

  useEffect(() => {
    if (
      contextLines <= DEFAULT_DIFF_CONTEXT_LINES &&
      Object.keys(hunkContextStates).length === 0
    ) {
      compactContentRef.current = {
        scopeKey,
        content: content ?? ""
      };
    }
  }, [content, contextLines, hunkContextStates, scopeKey]);

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

  useLayoutEffect(() => {
    const anchor = contextAnchorRef.current;
    const viewport = contentRef.current;
    if (!anchor || !viewport) {
      return;
    }

    const hunks = viewport.querySelectorAll<HTMLElement>(
      "[data-diff-viewer-hunk]"
    );
    const hunk =
      viewport.querySelector<HTMLElement>(
        `[data-diff-viewer-hunk="${anchor.hunkIndex}"]`
      ) ?? hunks.item(hunks.length - 1);
    if (hunk) {
      const nextOffsetTop =
        hunk.getBoundingClientRect().top -
        viewport.getBoundingClientRect().top;
      viewport.scrollTop += nextOffsetTop - anchor.offsetTop;
    } else {
      viewport.scrollTop = anchor.scrollTop;
    }
    contextAnchorRef.current = null;
  }, [layout, limitedContent.content]);

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
    if (
      !focusedUnifiedLineKey ||
      layout !== "unified" ||
      state
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      contentRef.current
        ?.querySelector<HTMLElement>(
          '[data-diff-viewer-focus-line="true"]'
        )
        ?.scrollIntoView({
          block: "center",
          inline: "nearest"
        });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    contentIdentity,
    focusedUnifiedLineKey,
    layout,
    scopeKey,
    state
  ]);

  useEffect(() => {
    if (!keyboardShortcutsEnabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
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
    keyboardShortcutsEnabled,
    moveSearchHit,
    searchHits.length,
    searchOpen
  ]);

  const searchCountLabel = searchQuery.trim()
    ? `${normalizedActiveSearchHit >= 0 ? normalizedActiveSearchHit + 1 : 0} / ${searchHits.length}`
    : "0 / 0";
  const hunkCountLabel = `${normalizedActiveHunk >= 0 ? normalizedActiveHunk + 1 : 0} / ${model.hunkCount}`;
  const visibleHunkContextMenu =
    hunkContextMenu &&
    canExpandContext &&
    hunkContextMenu.contentIdentity === contentIdentity
      ? hunkContextMenu
      : null;
  const hunkContextMenuFull = Boolean(
    visibleHunkContextMenu &&
      hunkContextStates[
        visibleHunkContextMenu.hunkIndex
      ]?.full
  );
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
                  onClick={() => {
                    if (onLayoutPreferenceChange) {
                      onLayoutPreferenceChange("split");
                    } else {
                      setInternalLayout("split");
                    }
                  }}
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
                  onClick={() => {
                    if (onLayoutPreferenceChange) {
                      onLayoutPreferenceChange("unified");
                    } else {
                      setInternalLayout("unified");
                    }
                  }}
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
              onClick={() => {
                const next = !wrap;
                if (onWrapPreferenceChange) {
                  onWrapPreferenceChange(next);
                } else {
                  setInternalWrap(next);
                }
              }}
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
            ) : showEmptyStatsLabel ? (
              <span className="diff-viewer-stats muted">
                {emptyStatsLabel}
              </span>
            ) : null}
            {hasHeaderActions ? (
              <>
                {showStatsContent ? (
                  <span
                    aria-hidden="true"
                    className="diff-viewer-file-header-separator"
                  />
                ) : null}
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
          aria-label={hasMediaPreview ? "文件预览" : "文件 Diff"}
          aria-busy={state?.busy}
          className={`diff-viewer-code${
            hasMediaPreview ? " media-preview" : ""
          }${
            wrap && !hasMediaPreview ? " wrap" : ""
          }${
            layout === "split" && !wrap && !hasMediaPreview
              ? " split-nowrap"
              : ""
          }`}
          ref={contentRef}
          role="region"
          tabIndex={0}
        >
          {state?.busy ? (
            <DiffContentSkeleton />
          ) : state ? (
            <DiffViewerState {...state} />
          ) : media ? (
            <DiffMediaPreview
              media={media}
              path={path}
              scopeKey={scopeKey}
            />
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
              contextControls={contextControls}
              hits={searchHitsBySegment}
              rows={model.splitRows}
              wrap={wrap}
            />
          ) : (
            <UnifiedDiff
              activeHunk={normalizedActiveHunk}
              activeSearchHit={normalizedActiveSearchHit}
              contextControls={contextControls}
              focusedLineKey={focusedUnifiedLineKey}
              hits={searchHitsBySegment}
              lines={model.unifiedLines}
            />
          )}
          {!state &&
          !media &&
          !binary &&
          (truncated || limitedContent.rendererTruncated) ? (
            <div className="diff-viewer-truncated">
              Diff 已达到安全显示上限，其余内容未载入。
            </div>
          ) : null}
        </div>
      </main>
      {visibleHunkContextMenu ? (
        <LayerPortal>
          <Menu
            aria-label={`第 ${visibleHunkContextMenu.hunkIndex + 1} 个变更块上下文操作`}
            className="workspace-context-menu diff-hunk-context-menu"
            ref={hunkContextMenuRef}
            style={{
              left: visibleHunkContextMenu.x,
              top: visibleHunkContextMenu.y
            }}
          >
            <MenuItem
              disabled={contextLoading}
              leading={
                <Icon
                  name={
                    hunkContextMenuFull
                      ? "minimize"
                      : "maximize"
                  }
                  size={14}
                />
              }
              onClick={chooseHunkContextMenuAction}
              title={
                hunkContextMenuFull
                  ? "恢复默认 3 行上下文"
                  : "显示当前变更块的全部上下文"
              }
            >
              {hunkContextMenuFull
                ? "恢复精简"
                : "展开全部"}
            </MenuItem>
          </Menu>
        </LayerPortal>
      ) : null}
    </section>
  );
}
