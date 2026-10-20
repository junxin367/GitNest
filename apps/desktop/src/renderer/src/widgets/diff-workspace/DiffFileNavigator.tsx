import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
  type RefObject
} from "react";

import type { DiffFileViewDto } from "@gitnest/contracts";

import {
  buildChangeTree,
  changeTreeDirectoryPaths,
  compactChangeTreeNodes,
  type ChangeTreeNode
} from "../../shared/model/changeTree";
import {
  matchesDiffViewerFileFilter,
  type DiffViewerContentMatch,
  type DiffViewerFile,
  type DiffViewerMode
} from "../../shared/model/diffViewModel";
import { Button } from "../../shared/ui/Button";
import { Icon } from "../../shared/ui/Icon";
import { Input } from "../../shared/ui/Input";
import {
  MenuItem,
  MenuPopover
} from "../../shared/ui/Menu";
import { DiffViewerState } from "./DiffPanel";
import type {
  DiffNavigationFeatureConfig
} from "./diffWorkspaceConfiguration";
import {
  VirtualDiffSection,
  VIRTUAL_DIFF_FILE_THRESHOLD,
  type DiffSelectionReveal
} from "./VirtualDiffSection";

interface DiffFileSection {
  title: string;
  mode: DiffViewerMode;
  files: DiffViewerFile[];
  stats: DiffFileSectionStats | null;
}

interface DiffFileSectionStats {
  additions: number;
  deletions: number;
}

interface DiffFileSectionTree {
  filesByPath: ReadonlyMap<string, DiffViewerFile>;
  nodes: readonly ChangeTreeNode[];
}

type DiffFileSectionCollapseState = Record<
  DiffViewerMode,
  boolean
>;

interface DiffFileNavigatorState {
  filter: string;
  collapsedSections: DiffFileSectionCollapseState;
}

// A directory only needs its own collapsed flag. Keep subscriptions local so
// toggling one branch does not rebuild every visible file in the navigator.
function createDirectoryCollapseStore() {
  let snapshot: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();
  const directoryListeners = new Map<string, Set<() => void>>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    subscribeDirectory(key: string, listener: () => void) {
      let subscribers = directoryListeners.get(key);
      if (!subscribers) {
        subscribers = new Set();
        directoryListeners.set(key, subscribers);
      }
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
        if (subscribers.size === 0) {
          directoryListeners.delete(key);
        }
      };
    },
    update(
      value: ReadonlySet<string> |
        ((current: ReadonlySet<string>) => ReadonlySet<string>)
    ) {
      const previous = snapshot;
      const next = typeof value === "function" ? value(previous) : value;
      if (previous === next) {
        return;
      }
      if (previous.size === next.size) {
        let equal = true;
        for (const key of previous) {
          if (!next.has(key)) { equal = false; break; }
        }
        if (equal) return;
      }
      snapshot = next;
      for (const [key, subscribers] of directoryListeners) {
        if (previous.has(key) !== next.has(key)) {
          subscribers.forEach((listener) => listener());
        }
      }
      listeners.forEach((listener) => listener());
    }
  };
}

type DirectoryCollapseStore = ReturnType<typeof createDirectoryCollapseStore>;

export type DiffFileSelectionOrigin = "automatic" | "user";

const MAX_GROUP_MUTATION_PATHS = 200;
const DEFAULT_COLLAPSED_SECTIONS: DiffFileSectionCollapseState = {
  staged: false,
  unstaged: false,
  untracked: false
};
const DEFAULT_NAVIGATOR_STATE: DiffFileNavigatorState = {
  filter: "",
  collapsedSections: DEFAULT_COLLAPSED_SECTIONS
};
const EMPTY_CONTENT_MATCHES: readonly DiffViewerContentMatch[] = [];
const navigatorStateByScope = new Map<
  string,
  DiffFileNavigatorState
>();

export interface DiffWorkspaceMessage {
  icon: Parameters<typeof DiffViewerState>[0]["icon"];
  title: string;
  message: string;
}

export interface DiffWorkspaceTreePreference {
  scopeKey: string;
  initiallyCollapsed: boolean;
  onCollapsedPreferenceChange?(
    collapsed: boolean
  ): void | undefined;
}

export interface DiffFileNavigatorProps {
  configuration: DiffNavigationFeatureConfig;
  files: readonly DiffViewerFile[];
  selectedFileKey?: string | undefined;
  selectionRevealKey?: string | undefined;
  mutationBusy?: boolean | undefined;
  changesLoading?: boolean | undefined;
  changesError?: DiffWorkspaceMessage | undefined;
  contentMatches?: readonly DiffViewerContentMatch[] | undefined;
  contentSearchLoading?: boolean | undefined;
  contentSearchIncomplete?: boolean | undefined;
  contentSearchMinimumQueryLength?: number | undefined;
  treePreference?: DiffWorkspaceTreePreference | undefined;
  fileView?: DiffFileViewDto | undefined;
  onFileViewChange?:
    | ((value: DiffFileViewDto) => void)
    | undefined;
  onSelectedFileChange(
    file: DiffViewerFile,
    origin: DiffFileSelectionOrigin,
    contentMatch?: DiffViewerContentMatch
  ): void;
  onFilterChange?: ((value: string) => void) | undefined;
  onStageFile?:
    | ((
        file: DiffViewerFile
      ) => void | boolean | Promise<void | boolean>)
    | undefined;
  onUnstageFile?:
    | ((
        file: DiffViewerFile
      ) => void | boolean | Promise<void | boolean>)
    | undefined;
  onDiscardFile?:
    | ((
        file: DiffViewerFile
      ) => void | boolean | Promise<void | boolean>)
    | undefined;
  canDiscardFile?:
    | ((file: DiffViewerFile) => boolean)
    | undefined;
  onStageFiles?:
    | ((
        files: readonly DiffViewerFile[]
      ) => void | boolean | Promise<void | boolean>)
    | undefined;
  onUnstageFiles?:
    | ((
        files: readonly DiffViewerFile[]
      ) => void | boolean | Promise<void | boolean>)
    | undefined;
  onDiscardFiles?:
    | ((
        files: readonly DiffViewerFile[]
      ) => void | boolean | Promise<void | boolean>)
    | undefined;
  canStageFile?:
    | ((file: DiffViewerFile) => boolean)
    | undefined;
  canUnstageFile?:
    | ((file: DiffViewerFile) => boolean)
    | undefined;
  onRefresh?: (() => void) | undefined;
  onFileContextMenu?:
    | ((
        event: MouseEvent<HTMLDivElement>,
        file: DiffViewerFile
      ) => void)
    | undefined;
}

export function DiffFileNavigator({
  configuration,
  files,
  selectedFileKey,
  selectionRevealKey,
  mutationBusy = false,
  changesLoading = false,
  changesError,
  contentMatches = EMPTY_CONTENT_MATCHES,
  contentSearchLoading = false,
  contentSearchIncomplete = false,
  contentSearchMinimumQueryLength = 2,
  treePreference,
  fileView,
  onFileViewChange,
  onSelectedFileChange,
  onFilterChange,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  canDiscardFile,
  onStageFiles,
  onUnstageFiles,
  onDiscardFiles,
  canStageFile,
  canUnstageFile,
  onRefresh,
  onFileContextMenu
}: DiffFileNavigatorProps) {
  const [internalViewMode, setInternalViewMode] =
    useState<DiffFileViewDto>("list");
  const viewMode = fileView ?? internalViewMode;
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const navigatorScopeKey = treePreference?.scopeKey ?? "";
  const [navigatorStates, setNavigatorStates] = useState<
    ReadonlyMap<string, DiffFileNavigatorState>
  >(() => new Map(navigatorStateByScope));
  const navigatorStatesRef = useRef(navigatorStates);
  navigatorStatesRef.current = navigatorStates;
  const navigatorState =
    navigatorStates.get(navigatorScopeKey) ??
    navigatorStateByScope.get(navigatorScopeKey) ??
    DEFAULT_NAVIGATOR_STATE;
  const { filter, collapsedSections } = navigatorState;
  const [directoryCollapseStore] = useState(createDirectoryCollapseStore);
  const collapsedDirectories = useSyncExternalStore(
    directoryCollapseStore.subscribe,
    directoryCollapseStore.getSnapshot
  );
  const setCollapsedDirectories = directoryCollapseStore.update;
  const [pendingSelectionReveal, setPendingSelectionReveal] =
    useState<DiffSelectionReveal | null>(null);
  const viewMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const fileListRef = useRef<HTMLDivElement>(null);
  const treeScopeRef = useRef("");
  const treeCollapsedPreferenceRef =
    useRef<boolean | undefined>(undefined);
  const knownDirectoryKeysRef = useRef<Set<string>>(new Set());
  const requestedSelectionRef = useRef("");
  const revealedSelectionRef = useRef("");
  const reportedContentMatchRef = useRef("");

  const contentMatchesByFileKey = useMemo(
    () =>
      new Map(
        contentMatches.map((match) => [
          match.fileKey,
          match
        ])
      ),
    [contentMatches]
  );
  const filteredFiles = useMemo(
    () =>
      !filter && contentMatchesByFileKey.size === 0 ? files : files.filter((file) =>
        matchesDiffViewerFileFilter(file, filter) ||
        contentMatchesByFileKey.has(file.key)
      ),
    [contentMatchesByFileKey, files, filter]
  );
  const sections = useMemo<DiffFileSection[]>(
    () =>
      (["staged", "unstaged", "untracked"] as const)
        .map((mode) => {
          const sectionFiles = filteredFiles.filter(
            (file) => file.mode === mode
          );
          return {
            mode,
            title: modeLabel(mode),
            files: sectionFiles,
            stats: aggregateFileStats(sectionFiles)
          };
        })
        .filter((section) => section.files.length > 0),
    [filteredFiles]
  );
  const structureKey = useMemo(
    () => filteredFiles.map((file) => file.key).join("\0"),
    [filteredFiles]
  );
  // Stats patches replace file objects while preserving paths, modes and order.
  // Keep structural inputs stable so they do not rebuild the tree or its counts.
  const structuralFiles = useMemo(() => filteredFiles, [structureKey]);
  const selectedFile = useMemo(
    () =>
      filteredFiles.find(
        (file) => file.key === selectedFileKey
      ) ?? filteredFiles[0],
    [filteredFiles, selectedFileKey]
  );
  const selectedContentMatch = selectedFile
    ? contentMatchesByFileKey.get(selectedFile.key)
    : undefined;
  const selectedPath = selectedFile?.path;
  const selectedMode = selectedFile?.mode;
  const directoryKeys = useMemo(
    () =>
      [
        ...new Set(
          structuralFiles.flatMap((file) =>
            changeTreeDirectoryPaths(file.path).map(
              (path) => `${file.mode}:${path}`
            )
          )
        )
      ].sort(),
    [structuralFiles]
  );
  const treeNodesByMode = useMemo(() => {
    const nodes = new Map<DiffViewerMode, ChangeTreeNode[]>();
    if (viewMode !== "tree") return nodes;
    for (const mode of ["staged", "unstaged", "untracked"] as const) {
      const changes = structuralFiles.filter((file) => file.mode === mode)
        .map((file) => file.change);
      if (changes.length > 0) {
        nodes.set(mode, compactChangeTreeNodes(buildChangeTree(changes)));
      }
    }
    return nodes;
  }, [structuralFiles, viewMode]);
  const sectionTrees = useMemo<
    ReadonlyMap<DiffViewerMode, DiffFileSectionTree>
  >(() => {
    if (viewMode !== "tree") {
      return new Map();
    }

    return new Map(
      sections.map((section) => {
        const filesByPath = new Map<
          string,
          DiffViewerFile
        >();
        for (const file of section.files) {
          if (!filesByPath.has(file.path)) {
            filesByPath.set(file.path, file);
          }
        }

        return [
          section.mode,
          {
            filesByPath,
            nodes: treeNodesByMode.get(section.mode) ?? []
          }
        ] as const;
      })
    );
  }, [sections, treeNodesByMode, viewMode]);
  const canToggleDirectories =
    viewMode === "tree" && directoryKeys.length > 0;
  const hasExpandedDirectories = directoryKeys.some(
    (key) => !collapsedDirectories.has(key)
  );

  useEffect(() => {
    if (
      !selectedFile ||
      selectedFile.key === selectedFileKey ||
      requestedSelectionRef.current === selectedFile.key
    ) {
      return;
    }
    requestedSelectionRef.current = selectedFile.key;
    if (selectedContentMatch) {
      reportedContentMatchRef.current =
        `${selectedFile.key}\u0000${selectedContentMatch.query}`;
      onSelectedFileChange(
        selectedFile,
        "automatic",
        selectedContentMatch
      );
    } else {
      reportedContentMatchRef.current = "";
      onSelectedFileChange(selectedFile, "automatic");
    }
  }, [
    onSelectedFileChange,
    selectedFile,
    selectedContentMatch,
    selectedFileKey
  ]);

  useEffect(() => {
    if (selectedFile?.key === selectedFileKey) {
      requestedSelectionRef.current = "";
    }
  }, [selectedFile?.key, selectedFileKey]);

  useEffect(() => {
    if (
      !selectedFile ||
      !selectedContentMatch
    ) {
      reportedContentMatchRef.current = "";
      return;
    }
    if (selectedFile.key !== selectedFileKey) {
      return;
    }
    const requestKey =
      `${selectedFile.key}\u0000${selectedContentMatch.query}`;
    if (reportedContentMatchRef.current === requestKey) {
      return;
    }
    reportedContentMatchRef.current = requestKey;
    onSelectedFileChange(
      selectedFile,
      "automatic",
      selectedContentMatch
    );
  }, [
    onSelectedFileChange,
    selectedContentMatch,
    selectedFile,
    selectedFileKey
  ]);

  useEffect(() => {
    onFilterChange?.(filter);
  }, [filter, onFilterChange]);

  useEffect(() => {
    if (!viewMenuOpen) {
      return;
    }

    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (viewMenuTriggerRef.current?.contains(target) ||
          viewMenuRef.current?.contains(target))
      ) {
        return;
      }
      setViewMenuOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setViewMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener(
        "pointerdown",
        closeFromOutside
      );
      document.removeEventListener(
        "keydown",
        closeFromKeyboard
      );
    };
  }, [viewMenuOpen]);

  useEffect(() => {
    const scopeKey = treePreference?.scopeKey ?? "";
    const nextKeys = new Set(directoryKeys);

    const initiallyCollapsed =
      treePreference?.initiallyCollapsed ?? false;
    if (
      treeScopeRef.current !== scopeKey ||
      treeCollapsedPreferenceRef.current !== initiallyCollapsed
    ) {
      treeScopeRef.current = scopeKey;
      treeCollapsedPreferenceRef.current = initiallyCollapsed;
      knownDirectoryKeysRef.current = nextKeys;
      // Discovery adds keys in place; subscribers need an immutable old snapshot.
      setCollapsedDirectories(
        treePreference?.initiallyCollapsed
          ? new Set(nextKeys)
          : new Set()
      );
      return;
    }

    const newKeys = findNewDiffTreeDirectoryKeys(
      knownDirectoryKeysRef.current,
      directoryKeys
    );
    if (newKeys.length === 0) {
      return;
    }
    newKeys.forEach((key) =>
      knownDirectoryKeysRef.current.add(key)
    );
    if (treePreference?.initiallyCollapsed) {
      setCollapsedDirectories((current) => {
        const next = new Set(current);
        newKeys.forEach((key) => next.add(key));
        return next;
      });
    }
  }, [
    directoryKeys,
    treePreference?.initiallyCollapsed,
    treePreference?.scopeKey
  ]);

  useEffect(() => {
    if (
      treePreference?.initiallyCollapsed ||
      !selectedPath ||
      !selectedMode ||
      viewMode !== "tree"
    ) {
      return;
    }
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      changeTreeDirectoryPaths(selectedPath).forEach(
        (path) => next.delete(`${selectedMode}:${path}`)
      );
      return next;
    });
  }, [
    selectedPath,
    selectedMode,
    treePreference?.initiallyCollapsed,
    viewMode
  ]);

  const toggleAllDirectories = () => {
    if (!canToggleDirectories) {
      return;
    }
    const collapse = hasExpandedDirectories;
    setCollapsedDirectories(
      collapse ? new Set(directoryKeys) : new Set()
    );
    treePreference?.onCollapsedPreferenceChange?.(collapse);
    setViewMenuOpen(false);
  };

  const updateNavigatorState = (
    update: (
      current: DiffFileNavigatorState
    ) => DiffFileNavigatorState
  ) => {
    const currentStates = navigatorStatesRef.current;
    const currentState =
      currentStates.get(navigatorScopeKey) ??
      navigatorStateByScope.get(navigatorScopeKey) ??
      DEFAULT_NAVIGATOR_STATE;
    const nextState = update(currentState);
    if (nextState === currentState) {
      return;
    }

    const nextStates = new Map(currentStates);
    nextStates.set(navigatorScopeKey, nextState);
    navigatorStatesRef.current = nextStates;
    if (navigatorScopeKey) {
      navigatorStateByScope.set(navigatorScopeKey, nextState);
    }
    setNavigatorStates(nextStates);
  };

  const setFilter = (value: string) => {
    updateNavigatorState((current) =>
      current.filter === value
        ? current
        : {
            ...current,
            filter: value
          }
    );
  };

  const toggleSection = (mode: DiffViewerMode) => {
    updateNavigatorState((current) => ({
      ...current,
      collapsedSections: {
        ...current.collapsedSections,
        [mode]: !current.collapsedSections[mode]
      }
    }));
  };

  useEffect(() => {
    if (
      !selectionRevealKey ||
      revealedSelectionRef.current ===
        selectionRevealKey ||
      !selectedFileKey
    ) {
      return;
    }

    const file = files.find(
      (candidate) => candidate.key === selectedFileKey
    );
    if (!file) {
      return;
    }

    updateNavigatorState((current) => {
      if (
        !current.filter &&
        !current.collapsedSections[file.mode]
      ) {
        return current;
      }
      return {
        filter: "",
        collapsedSections: {
          ...current.collapsedSections,
          [file.mode]: false
        }
      };
    });
    if (viewMode === "tree") {
      setCollapsedDirectories((current) => {
        const next = new Set(current);
        changeTreeDirectoryPaths(file.path).forEach((path) =>
          next.delete(`${file.mode}:${path}`)
        );
        return next;
      });
    }
    setPendingSelectionReveal({
      fileKey: file.key,
      requestKey: selectionRevealKey
    });
  }, [
    files,
    navigatorScopeKey,
    selectedFileKey,
    selectionRevealKey,
    viewMode
  ]);

  useLayoutEffect(() => {
    if (!pendingSelectionReveal) {
      return;
    }
    const row = Array.from(
      fileListRef.current?.querySelectorAll<HTMLElement>(
        "[data-diff-file-key]"
      ) ?? []
    ).find(
      (element) =>
        element.dataset.diffFileKey ===
        pendingSelectionReveal.fileKey
    );
    if (!row) {
      return;
    }

    row.scrollIntoView({
      block: "nearest"
    });
    row
      .querySelector<HTMLButtonElement>(
        ".diff-workspace-file-select"
      )
      ?.focus({ preventScroll: true });
    revealedSelectionRef.current =
      pendingSelectionReveal.requestKey;
    setPendingSelectionReveal(null);
  }, [pendingSelectionReveal]);

  const finishSelectionReveal = useCallback((requestKey: string) => {
    revealedSelectionRef.current = requestKey;
    setPendingSelectionReveal((current) =>
      current?.requestKey === requestKey ? null : current
    );
  }, []);

  const renderFileRow = useCallback((
    file: DiffViewerFile,
    depth = 0
  ): ReactNode => {
    return <DiffFileRow
      key={file.key}
      file={file}
      depth={depth}
      selected={file.key === selectedFile?.key}
      contentMatch={contentMatchesByFileKey.get(file.key)}
      mutationBusy={mutationBusy}
      onSelectedFileChange={onSelectedFileChange}
      onFileContextMenu={onFileContextMenu}
      onStageFile={onStageFile}
      onUnstageFile={onUnstageFile}
      onDiscardFile={onDiscardFile}
      canStageFile={canStageFile}
      canUnstageFile={canUnstageFile}
      canDiscardFile={canDiscardFile}
    />;
  }, [
    contentMatchesByFileKey,
    selectedFile?.key,
    mutationBusy,
    onSelectedFileChange,
    onFileContextMenu,
    onStageFile,
    onUnstageFile,
    onDiscardFile,
    canStageFile,
    canUnstageFile,
    canDiscardFile
  ]);
  const renderSectionActions = useCallback((
    section: DiffFileSection
  ): ReactNode => {
    const stagedSection = section.mode === "staged";
    const toggleCandidates: DiffViewerFile[] = [];
    const discardCandidates: DiffViewerFile[] = [];
    for (const file of section.files) {
      if (
        toggleCandidates.length <= MAX_GROUP_MUTATION_PATHS &&
        (stagedSection ? canUnstageFile?.(file) ?? true : canStageFile?.(file) ?? true)
      ) toggleCandidates.push(file);
      if (
        !stagedSection && discardCandidates.length <= MAX_GROUP_MUTATION_PATHS &&
        (canDiscardFile?.(file) ?? true)
      ) discardCandidates.push(file);
      if (
        toggleCandidates.length > MAX_GROUP_MUTATION_PATHS &&
        (stagedSection || discardCandidates.length > MAX_GROUP_MUTATION_PATHS)
      ) break;
    }
    const canToggleGroup =
      toggleCandidates.length > 0 &&
      toggleCandidates.length <= MAX_GROUP_MUTATION_PATHS &&
      Boolean(stagedSection ? onUnstageFiles : onStageFiles);
    const canDiscardGroup =
      discardCandidates.length > 0 &&
      discardCandidates.length <= MAX_GROUP_MUTATION_PATHS &&
      Boolean(onDiscardFiles);

    if (!canToggleGroup && !canDiscardGroup) {
      return null;
    }

    return (
      <div className="diff-workspace-file-section-actions">
        {canDiscardGroup ? (
          <Button
            aria-label={`放弃${section.title}分组的更改`}
            className="diff-workspace-discard-toggle"
            disabled={mutationBusy}
            icon={<Icon name="undo" size={12} />}
            onClick={() => void onDiscardFiles?.(discardCandidates)}
            size="small"
            title={`放弃更改（${discardCandidates.length} 个文件）`}
            variant="icon"
          />
        ) : null}
        {canToggleGroup ? (
          <Button
            aria-label={`${stagedSection ? "取消暂存" : "暂存"}${section.title}分组的文件`}
            className="diff-workspace-stage-toggle"
            disabled={mutationBusy}
            icon={
              <Icon
                name={stagedSection ? "minus" : "plus"}
                size={12}
              />
            }
            onClick={() => {
              if (stagedSection) {
                void onUnstageFiles?.(toggleCandidates);
              } else {
                void onStageFiles?.(toggleCandidates);
              }
            }}
            size="small"
            title={`${
              stagedSection ? "取消暂存" : "暂存"
            }（${toggleCandidates.length} 个文件）`}
            variant="icon"
          />
        ) : null}
      </div>
    );
  }, [
    mutationBusy,
    onStageFiles,
    onUnstageFiles,
    onDiscardFiles,
    canStageFile,
    canUnstageFile,
    canDiscardFile
  ]);
  const sectionActionsByMode = useMemo(
    () => new Map(
      sections.map((section) => [
        section.mode,
        renderSectionActions(section)
      ])
    ),
    [sections, renderSectionActions]
  );

  return (
    <>
      <header className="diff-workspace-sidebar-header">
        <strong>变更文件</strong>
        <div className="diff-workspace-sidebar-tools">
          <Input
            aria-label="筛选变更文件"
            aria-busy={contentSearchLoading}
            className="diff-workspace-file-filter"
            fieldClassName="diff-workspace-file-filter-field"
            fullWidth
            leading={<Icon name="search" size={14} />}
            onChange={(event) => setFilter(event.target.value)}
            {...(filter
              ? {
                  onClear: () => setFilter("")
                }
              : {})}
            placeholder="筛选文件或 Diff…"
            size="small"
            spellCheck={false}
            value={filter}
          />
          <Button
            aria-expanded={viewMenuOpen}
            aria-haspopup="menu"
            aria-label="打开变更文件视图菜单"
            icon={<Icon name="more" size={14} />}
            onClick={() => setViewMenuOpen((open) => !open)}
            ref={viewMenuTriggerRef}
            size="small"
            title="变更文件视图"
            variant="icon"
          />
          {viewMenuOpen ? (
            <MenuPopover
              align="end"
              anchor={viewMenuTriggerRef.current}
              aria-label="变更文件视图"
              className="diff-workspace-file-view-menu"
              ref={viewMenuRef}
              side="bottom"
            >
              {configuration.allowTreeView ? (
                <MenuItem
                  leading={
                    <Icon
                      name={
                        viewMode === "tree"
                          ? "fileCode"
                          : "folder"
                      }
                      size={14}
                    />
                  }
                  onClick={() => {
                    const next =
                      viewMode === "tree" ? "list" : "tree";
                    if (onFileViewChange) {
                      onFileViewChange(next);
                    } else {
                      setInternalViewMode(next);
                    }
                    setViewMenuOpen(false);
                  }}
                >
                  {viewMode === "tree"
                    ? "以列表形式查看"
                    : "以树形式查看"}
                </MenuItem>
              ) : null}
              {configuration.allowTreeView ? (
                <MenuItem
                  disabled={!canToggleDirectories}
                  leading={
                    <Icon
                      name={
                        hasExpandedDirectories
                          ? "collapse"
                          : "chevron"
                      }
                      size={14}
                    />
                  }
                  onClick={toggleAllDirectories}
                  title={
                    canToggleDirectories
                      ? hasExpandedDirectories
                        ? "收起全部目录"
                        : "展开全部目录"
                      : "切换到树形式查看后可用"
                  }
                >
                  {hasExpandedDirectories
                    ? "收起目录"
                    : "展开目录"}
                </MenuItem>
              ) : null}
              {configuration.allowRefresh && onRefresh ? (
                <MenuItem
                  disabled={changesLoading}
                  leading={<Icon name="refresh" size={14} />}
                  onClick={() => {
                    onRefresh();
                    setViewMenuOpen(false);
                  }}
                >
                  重新读取变更
                </MenuItem>
              ) : null}
            </MenuPopover>
          ) : null}
        </div>
      </header>
      <div
        aria-busy={contentSearchLoading}
        className="diff-workspace-file-list"
        ref={fileListRef}
      >
        {changesError ? (
          <DiffViewerState {...changesError} />
        ) : files.length === 0 && !changesLoading ? (
          <DiffViewerState
            icon="check"
            message="当前工作区没有可查看的本地变更。"
            title="工作区干净"
          />
        ) : filter &&
          sections.length === 0 &&
          contentSearchLoading ? (
          <DiffViewerState
            icon="refresh"
            message="正在读取变更文件的 Diff 文本。"
            title="搜索 Diff…"
          />
        ) : filter && sections.length === 0 && !changesLoading ? (
          <DiffViewerState
            icon={contentSearchIncomplete ? "warning" : "search"}
            message={
              filter.trim().length <
              contentSearchMinimumQueryLength
                ? `尝试文件名、目录或状态；输入至少 ${contentSearchMinimumQueryLength} 个字符可搜索 Diff 内容。`
                : contentSearchIncomplete
                  ? "已搜索可读取的 Diff；部分文件内容未能完整建立索引。"
                  : "尝试文件名、目录、状态或 Diff 代码内容。"
            }
            title="没有匹配的变更"
          />
        ) : (
          sections.map((section) => {
            const collapsed = collapsedSections[section.mode];
            const bodyId = `diff-workspace-section-${section.mode}`;
            const sectionActions = sectionActionsByMode.get(section.mode);
            return (
              <section
                className={`diff-workspace-file-section${
                  collapsed ? " collapsed" : ""
                }`}
                key={section.mode}
              >
                <div
                  className={`diff-workspace-file-section-header${
                    sectionActions ? " has-actions" : ""
                  }`}
                >
                  <Button variant="unstyled"
                    aria-controls={bodyId}
                    aria-expanded={!collapsed}
                    className="diff-workspace-file-section-title"
                    onClick={() => toggleSection(section.mode)}
                    type="button"
                  >
                    <Icon
                      className="diff-workspace-file-section-chevron"
                      name="collapse"
                      size={12}
                    />
                    <span className="diff-workspace-file-section-copy">
                      <span className="diff-workspace-file-section-label">
                        {section.title}
                      </span>
                      {section.stats ? (
                        <span
                          aria-hidden="true"
                          className="diff-workspace-file-section-stats"
                          title={`新增 ${section.stats.additions} 行，删除 ${section.stats.deletions} 行`}
                        >
                          <strong>
                            +{section.stats.additions}
                          </strong>
                          <em>-{section.stats.deletions}</em>
                        </span>
                      ) : null}
                    </span>
                  </Button>
                  <div className="diff-workspace-file-section-tail">
                    <span className="diff-workspace-file-section-count">
                      {section.files.length}
                    </span>
                    {sectionActions}
                  </div>
                </div>
                {collapsed ? null : (
                  <div id={bodyId}>
                    <DiffSectionRows
                      section={section}
                      tree={sectionTrees.get(section.mode)}
                      directoryCollapseStore={directoryCollapseStore}
                      renderFileRow={renderFileRow}
                      scrollContainer={fileListRef}
                      selectionReveal={pendingSelectionReveal}
                      onSelectionRevealed={finishSelectionReveal}
                      scopeKey={navigatorScopeKey}
                      layoutKey={Object.values(collapsedSections).join(":")}
                    />
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>
    </>
  );
}

type FileRowRenderer = (file: DiffViewerFile, depth?: number) => ReactNode;

const DiffSectionRows = memo(function DiffSectionRows({
  section,
  tree,
  directoryCollapseStore,
  renderFileRow,
  scrollContainer,
  selectionReveal,
  onSelectionRevealed,
  scopeKey,
  layoutKey
}: {
  section: DiffFileSection;
  tree: DiffFileSectionTree | undefined;
  directoryCollapseStore: DirectoryCollapseStore;
  renderFileRow: FileRowRenderer;
  scrollContainer: RefObject<HTMLDivElement | null>;
  selectionReveal: DiffSelectionReveal | null;
  onSelectionRevealed(requestKey: string): void;
  scopeKey: string;
  layoutKey: string;
}) {
  if (section.files.length >= VIRTUAL_DIFF_FILE_THRESHOLD) {
    return (
      <VirtualDiffSection
        key={scopeKey}
        files={section.files}
        nodes={tree?.nodes}
        mode={section.mode}
        directoryState={directoryCollapseStore}
        scrollContainer={scrollContainer}
        layoutKey={layoutKey}
        selectionReveal={selectionReveal}
        onSelectionRevealed={onSelectionRevealed}
        renderFile={renderFileRow}
        renderDirectory={(node, depth) => tree ? (
          <DiffTreeDirectory
            node={node}
            mode={section.mode}
            filesByPath={tree.filesByPath}
            depth={depth}
            directoryCollapseStore={directoryCollapseStore}
            renderFileRow={renderFileRow}
            renderChildren={false}
          />
        ) : null}
      />
    );
  }
  return tree ? (
    <DiffTreeRows
      nodes={tree.nodes}
      mode={section.mode}
      filesByPath={tree.filesByPath}
      depth={0}
      directoryCollapseStore={directoryCollapseStore}
      renderFileRow={renderFileRow}
    />
  ) : section.files.map((file) => renderFileRow(file));
});

interface DiffTreeRowsProps {
  nodes: readonly ChangeTreeNode[];
  mode: DiffViewerMode;
  filesByPath: ReadonlyMap<string, DiffViewerFile>;
  depth: number;
  directoryCollapseStore: DirectoryCollapseStore;
  renderFileRow: FileRowRenderer;
}

const DiffTreeRows = memo(function DiffTreeRows({
  nodes,
  ...props
}: DiffTreeRowsProps) {
  return nodes.map((node) => {
    if (!node.directory && node.change) {
      const file = props.filesByPath.get(node.change.path);
      return file ? props.renderFileRow(file, props.depth) : null;
    }
    return <DiffTreeDirectory key={node.path} node={node} {...props} />;
  });
});

const DiffTreeDirectory = memo(function DiffTreeDirectory({
  node,
  renderChildren = true,
  ...props
}: Omit<DiffTreeRowsProps, "nodes"> & { node: ChangeTreeNode; renderChildren?: boolean }) {
  const { mode, depth, directoryCollapseStore } = props;
  const key = `${mode}:${node.path}`;
  const subscribe = useCallback(
    (listener: () => void) =>
      directoryCollapseStore.subscribeDirectory(key, listener),
    [directoryCollapseStore, key]
  );
  const collapsed = useSyncExternalStore(
    subscribe,
    () => directoryCollapseStore.getSnapshot().has(key)
  );
  const fileCount = useMemo(
    () => depth === 0 ? countTreeFiles(node.children) : undefined,
    [depth, node]
  );
  return (
    <>
      <Button
        variant="unstyled"
        aria-expanded={!collapsed}
        className={`diff-workspace-tree-directory${collapsed ? " collapsed" : ""}${depth === 0 ? " has-count" : ""}`}
        onClick={() => directoryCollapseStore.update((current) => {
          const next = new Set(current);
          if (next.has(key)) {
            next.delete(key);
          } else {
            next.add(key);
          }
          return next;
        })}
        style={{
          paddingLeft: `calc(var(--space-3) + ${depth} * var(--space-4))`
        }}
        type="button"
      >
        <Icon className="diff-workspace-tree-directory-chevron" name="collapse" size={13} />
        <Icon className="diff-workspace-tree-directory-folder" name="folder" size={13} />
        <span className="diff-workspace-tree-directory-label" title={node.path}>{node.name}</span>
        {fileCount !== undefined ? (
          <span className="diff-workspace-file-section-count diff-workspace-tree-directory-count">
            {fileCount}
          </span>
        ) : null}
      </Button>
      {collapsed || !renderChildren ? null : (
        <DiffTreeRows nodes={node.children} {...props} depth={depth + 1} />
      )}
    </>
  );
});

const treeFileCounts = new WeakMap<readonly ChangeTreeNode[], number>();

function countTreeFiles(nodes: readonly ChangeTreeNode[]): number {
  const previous = treeFileCounts.get(nodes);
  if (previous !== undefined) return previous;
  const count = nodes.reduce(
    (count, node) => count + (node.directory ? countTreeFiles(node.children) : 1),
    0
  );
  treeFileCounts.set(nodes, count);
  return count;
}

const DiffFileRow = memo(function DiffFileRow({
  file,
  depth,
  selected,
  contentMatch,
  mutationBusy,
  onSelectedFileChange,
  onFileContextMenu,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  canStageFile,
  canUnstageFile,
  canDiscardFile
}: Pick<DiffFileNavigatorProps,
  | "onSelectedFileChange"
  | "onFileContextMenu"
  | "onStageFile"
  | "onUnstageFile"
  | "onDiscardFile"
  | "canStageFile"
  | "canUnstageFile"
  | "canDiscardFile"
> & {
  file: DiffViewerFile;
  depth: number;
  selected: boolean;
  contentMatch?: DiffViewerContentMatch | undefined;
  mutationBusy: boolean;
}) {
  const staged = file.mode === "staged";
  const canToggle = staged
    ? Boolean(onUnstageFile) &&
      (canUnstageFile?.(file) ?? true)
    : Boolean(onStageFile) &&
      (canStageFile?.(file) ?? true);
  const canDiscard =
    !staged &&
    Boolean(onDiscardFile) &&
    (canDiscardFile?.(file) ?? true);
  const displayName =
    depth > 0 ? fileName(file.path) : file.path;
  const showStats =
    Number.isFinite(file.additions) &&
    Number.isFinite(file.deletions);

  return (
    <div
      className={`diff-workspace-file${
        selected ? " selected" : ""
      }`}
      data-diff-file-key={file.key}
      key={file.key}
      onContextMenu={(event) =>
        onFileContextMenu?.(event, file)
      }
      style={
        depth > 0
          ? {
              paddingLeft: `calc(var(--space-3) + ${depth} * var(--space-4))`
            }
          : undefined
      }
    >
      <Button variant="unstyled"
        aria-current={selected ? "true" : undefined}
        aria-label={displayName}
        className="diff-workspace-file-select"
        onClick={() => {
          if (contentMatch) {
            onSelectedFileChange(
              file,
              "user",
              contentMatch
            );
          } else {
            onSelectedFileChange(file, "user");
          }
        }}
        type="button"
      >
        <strong title={file.path}>{displayName}</strong>
        <span className="diff-workspace-file-meta">
          <span
            className={`diff-workspace-file-status kind-${file.kind}`}
            data-status={file.status}
          >
            {file.status}
          </span>
          {contentMatch ? (
            <small
              className="diff-workspace-file-content-match"
              title={contentMatch.preview}
            >
              匹配：{contentMatch.preview}
            </small>
          ) : null}
          {file.change.originalPath ? (
            <small>
              原路径：{file.change.originalPath}
            </small>
          ) : null}
          {showStats ? (
            <span
              aria-label={`新增 ${file.additions} 行，删除 ${file.deletions} 行`}
              className="diff-workspace-file-stats"
            >
              <strong>+{file.additions}</strong>
              <em>-{file.deletions}</em>
            </span>
          ) : null}
        </span>
      </Button>
      <div className="diff-workspace-file-actions">
        {!staged ? (
          <Button
            aria-label={`放弃更改 ${file.path}`}
            className="diff-workspace-discard-toggle"
            disabled={!canDiscard || mutationBusy}
            icon={<Icon name="undo" size={12} />}
            onClick={() => void onDiscardFile?.(file)}
            size="small"
            title="放弃更改"
            variant="icon"
          />
        ) : null}
        <Button
          aria-label={`${staged ? "取消暂存" : "暂存"} ${file.path}`}
          className="diff-workspace-stage-toggle"
          disabled={!canToggle || mutationBusy}
          icon={<Icon name={staged ? "minus" : "plus"} size={12} />}
          onClick={() => {
            if (staged) {
              void onUnstageFile?.(file);
            } else {
              void onStageFile?.(file);
            }
          }}
          size="small"
          title={staged ? "取消暂存" : "暂存"}
          variant="icon"
        />
      </div>
    </div>
  );
});

function modeLabel(mode: DiffViewerMode): string {
  if (mode === "staged") {
    return "已暂存";
  }
  if (mode === "untracked") {
    return "未跟踪";
  }
  return "未暂存";
}

function fileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function aggregateFileStats(
  files: readonly DiffViewerFile[]
): DiffFileSectionStats | null {
  if (
    !files.every(
      (file) =>
        Number.isFinite(file.additions) &&
        Number.isFinite(file.deletions)
    )
  ) {
    return null;
  }

  return files.reduce<DiffFileSectionStats>(
    (stats, file) => ({
      additions: stats.additions + (file.additions ?? 0),
      deletions: stats.deletions + (file.deletions ?? 0)
    }),
    {
      additions: 0,
      deletions: 0
    }
  );
}

export function findNewDiffTreeDirectoryKeys(
  knownDirectoryKeys: ReadonlySet<string>,
  directoryKeys: readonly string[]
): string[] {
  return directoryKeys.filter(
    (key) => !knownDirectoryKeys.has(key)
  );
}
