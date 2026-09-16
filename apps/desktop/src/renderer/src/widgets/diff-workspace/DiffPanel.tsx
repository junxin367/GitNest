import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref
} from "react";

import type { RepositoryMediaPreviewDto } from "@gitnest/contracts";

import { copyTextToClipboard } from "../../shared/lib/copyTextToClipboard";
import {
  buildLocalizedDiffContent,
  collectDiffViewerSearchHits,
  parseDiffViewModel,
  type DiffHunkContextRange,
  type DiffSearchHit,
  type DiffViewerLayout,
  type SplitDiffCell
} from "../../shared/model/diffViewModel";
import { Button } from "../../shared/ui/Button";
import { DiffSearchPopover } from "../../shared/ui/DiffSearchPopover";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { LayerPortal } from "../../shared/ui/LayerPortal";
import { Menu, MenuItem } from "../../shared/ui/Menu";
import { Skeleton } from "../../shared/ui/Skeleton";
import type { DiffDocumentFeatureConfig } from "./diffWorkspaceConfiguration";

export type DiffPathCopyStatus =
  | "idle"
  | "copied"
  | "failed";

export const DEFAULT_DIFF_CONTEXT_LINES = 3;
export const DIFF_CONTEXT_STEP = 10;
export const FULL_DIFF_CONTEXT_LINES = 100_000;
const HUNK_CONTEXT_MENU_WIDTH = 222;
const HUNK_CONTEXT_MENU_HEIGHT = 52;
const CONTEXT_MENU_VIEWPORT_PADDING = 8;
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
const searchQueriesByScope = new Map<string, string>();

export type DiffContextDirection =
  | "up"
  | "down"
  | "around"
  | "all"
  | "reset";

export interface DiffContextRequest {
  direction: DiffContextDirection;
  hunkIndex: number;
  contextLines: number;
}

interface DiffHunkContextState extends DiffHunkContextRange {
  full: boolean;
}

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
  searchScopeKey?: string | undefined;
  path?: string | undefined;
  content?: string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
  statsAvailable?: boolean | undefined;
  binary?: boolean | undefined;
  media?: RepositoryMediaPreviewDto | undefined;
  truncated?: boolean | undefined;
  maxLines?: number | undefined;
  emptyPathLabel?: string | undefined;
  emptyStatsLabel?: string | undefined;
  state?: DiffPanelState | undefined;
  headerActions?: ReactNode | undefined;
  className?: string | undefined;
  keyboardShortcutsEnabled?: boolean | undefined;
  onPathCopyStatusChange?(
    status: DiffPathCopyStatus
  ): void;
  preferredLayout?: DiffViewerLayout | undefined;
  preferredWrap?: boolean | undefined;
  onLayoutPreferenceChange?(
    layout: DiffViewerLayout
  ): void;
  onWrapPreferenceChange?(wrap: boolean): void;
  contextLines?: number | undefined;
  contextLoading?: boolean | undefined;
  onContextRequest?(
    request: DiffContextRequest
  ): void;
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
  headerActions,
  className,
  keyboardShortcutsEnabled = true,
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
  const [searchOpen, setSearchOpen] = useState(false);
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
  }, [setSearchQuery]);
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

function DiffMediaPreview({
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

function SplitDiff({
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

function UnifiedDiff({
  lines,
  hits,
  activeSearchHit,
  activeHunk,
  contextControls
}: {
  lines: ReturnType<typeof parseDiffViewModel>["unifiedLines"];
  hits: ReadonlyMap<string, DiffSearchHit[]>;
  activeSearchHit: number;
  activeHunk: number;
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

interface DiffHunkContextControlsProps {
  hunkContextStates: Readonly<
    Record<number, DiffHunkContextState>
  >;
  contextLoading: boolean;
  onContextMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    hunkIndex: number
  ): void;
  onContextRequest(request: DiffContextRequest): void;
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
