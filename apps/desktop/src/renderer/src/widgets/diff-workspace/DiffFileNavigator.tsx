import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode
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

interface DiffFileSection {
  title: string;
  mode: DiffViewerMode;
  files: DiffViewerFile[];
}

const MAX_GROUP_MUTATION_PATHS = 200;

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
  mutationBusy?: boolean | undefined;
  changesLoading?: boolean | undefined;
  changesError?: DiffWorkspaceMessage | undefined;
  treePreference?: DiffWorkspaceTreePreference | undefined;
  fileView?: DiffFileViewDto | undefined;
  onFileViewChange?:
    | ((value: DiffFileViewDto) => void)
    | undefined;
  onSelectedFileChange(file: DiffViewerFile): void;
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
  mutationBusy = false,
  changesLoading = false,
  changesError,
  treePreference,
  fileView,
  onFileViewChange,
  onSelectedFileChange,
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
  const [filter, setFilter] = useState("");
  const [internalViewMode, setInternalViewMode] =
    useState<DiffFileViewDto>("list");
  const viewMode = fileView ?? internalViewMode;
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<
    Record<DiffViewerMode, boolean>
  >({
    staged: false,
    unstaged: false,
    untracked: false
  });
  const [collapsedDirectories, setCollapsedDirectories] =
    useState<Set<string>>(() => new Set());
  const viewMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const treeScopeRef = useRef("");
  const knownDirectoryKeysRef = useRef<Set<string>>(new Set());
  const requestedSelectionRef = useRef("");

  const filteredFiles = useMemo(
    () =>
      files.filter((file) =>
        matchesDiffViewerFileFilter(file, filter)
      ),
    [files, filter]
  );
  const sections = useMemo<DiffFileSection[]>(
    () =>
      (["staged", "unstaged", "untracked"] as const)
        .map((mode) => ({
          mode,
          title: modeLabel(mode),
          files: filteredFiles.filter(
            (file) => file.mode === mode
          )
        }))
        .filter((section) => section.files.length > 0),
    [filteredFiles]
  );
  const selectedFile =
    filteredFiles.find(
      (file) => file.key === selectedFileKey
    ) ?? filteredFiles[0];
  const directoryKeys = useMemo(
    () =>
      [
        ...new Set(
          sections.flatMap((section) =>
            section.files.flatMap((file) =>
              changeTreeDirectoryPaths(file.path).map(
                (path) => `${section.mode}:${path}`
              )
            )
          )
        )
      ].sort(),
    [sections]
  );
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
    onSelectedFileChange(selectedFile);
  }, [
    onSelectedFileChange,
    selectedFile,
    selectedFileKey
  ]);

  useEffect(() => {
    if (selectedFile?.key === selectedFileKey) {
      requestedSelectionRef.current = "";
    }
  }, [selectedFile?.key, selectedFileKey]);

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

    if (treeScopeRef.current !== scopeKey) {
      treeScopeRef.current = scopeKey;
      knownDirectoryKeysRef.current = nextKeys;
      setCollapsedDirectories(
        treePreference?.initiallyCollapsed
          ? nextKeys
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
      !selectedFile ||
      viewMode !== "tree"
    ) {
      return;
    }
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      changeTreeDirectoryPaths(selectedFile.path).forEach(
        (path) => next.delete(`${selectedFile.mode}:${path}`)
      );
      return next;
    });
  }, [
    selectedFile,
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

  const renderFileRow = (
    file: DiffViewerFile,
    depth = 0
  ): ReactNode => {
    const selected = file.key === selectedFile?.key;
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
          onClick={() => onSelectedFileChange(file)}
          type="button"
        >
          <strong title={file.path}>{displayName}</strong>
          <span className="diff-workspace-file-meta">
            <span
              className={`diff-workspace-file-status kind-${file.kind}`}
            >
              {file.status}
            </span>
            <small>
              {file.change.originalPath
                ? `原路径：${file.change.originalPath}`
                : modeLabel(file.mode)}
            </small>
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
  };
  const renderTreeNodes = (
    nodes: readonly ChangeTreeNode[],
    section: DiffFileSection,
    depth = 0
  ): ReactNode[] =>
    nodes.flatMap((node) => {
      if (!node.directory && node.change) {
        const file = section.files.find(
          (candidate) => candidate.path === node.change?.path
        );
        return file ? [renderFileRow(file, depth)] : [];
      }
      const key = `${section.mode}:${node.path}`;
      const collapsed = collapsedDirectories.has(key);
      return [
        <Button variant="unstyled"
          aria-expanded={!collapsed}
          className={`diff-workspace-tree-directory${
            collapsed ? " collapsed" : ""
          }`}
          key={`${key}:directory`}
          onClick={() =>
            setCollapsedDirectories((current) => {
              const next = new Set(current);
              if (next.has(key)) {
                next.delete(key);
              } else {
                next.add(key);
              }
              return next;
            })
          }
          style={{
            paddingLeft: `calc(var(--space-3) + ${depth} * var(--space-4))`
          }}
          type="button"
        >
          <Icon
            className="diff-workspace-tree-directory-chevron"
            name="collapse"
            size={13}
          />
          <Icon
            className="diff-workspace-tree-directory-folder"
            name="folder"
            size={13}
          />
          <span title={node.path}>{node.name}</span>
        </Button>,
        ...(collapsed
          ? []
          : renderTreeNodes(
              node.children,
              section,
              depth + 1
            ))
      ];
    });

  const renderSectionRows = (
    section: DiffFileSection
  ): ReactNode =>
    viewMode === "tree"
      ? renderTreeNodes(
          compactChangeTreeNodes(
            buildChangeTree(
              section.files.map((file) => file.change)
            )
          ),
          section
        )
      : section.files.map((file) => renderFileRow(file));

  const renderSectionActions = (
    section: DiffFileSection
  ): ReactNode => {
    const stagedSection = section.mode === "staged";
    const toggleCandidates = stagedSection
      ? section.files.filter(
          (file) => canUnstageFile?.(file) ?? true
        )
      : section.files.filter(
          (file) => canStageFile?.(file) ?? true
        );
    const discardCandidates = stagedSection
      ? []
      : section.files.filter(
          (file) => canDiscardFile?.(file) ?? true
        );
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
  };

  return (
    <>
      <header className="diff-workspace-sidebar-header">
        <strong>文件变更</strong>
        <div className="diff-workspace-sidebar-tools">
          <Input
            aria-label="筛选变更文件"
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
            placeholder="筛选变更…"
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
      <div className="diff-workspace-file-list">
        {changesError ? (
          <DiffViewerState {...changesError} />
        ) : files.length === 0 && !changesLoading ? (
          <DiffViewerState
            icon="check"
            message="当前工作区没有可查看的本地变更。"
            title="工作区干净"
          />
        ) : filter && sections.length === 0 ? (
          <DiffViewerState
            icon="search"
            message="尝试文件名、目录或状态。"
            title="没有匹配的变更"
          />
        ) : (
          sections.map((section) => {
            const collapsed = collapsedSections[section.mode];
            const bodyId = `diff-workspace-section-${section.mode}`;
            const sectionActions = renderSectionActions(section);
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
                    onClick={() =>
                      setCollapsedSections((current) => ({
                        ...current,
                        [section.mode]: !current[section.mode]
                      }))
                    }
                    type="button"
                  >
                    <Icon
                      className="diff-workspace-file-section-chevron"
                      name="collapse"
                      size={12}
                    />
                    <span>{section.title}</span>
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
                    {renderSectionRows(section)}
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

export function findNewDiffTreeDirectoryKeys(
  knownDirectoryKeys: ReadonlySet<string>,
  directoryKeys: readonly string[]
): string[] {
  return directoryKeys.filter(
    (key) => !knownDirectoryKeys.has(key)
  );
}
