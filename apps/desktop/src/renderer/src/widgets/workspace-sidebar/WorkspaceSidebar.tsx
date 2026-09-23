import { Button } from "../../shared/ui/Button";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent
} from "react";

import type {
  RepositoryGroupDto,
  RepositoryStatusSnapshotDto,
  RepositoryTargetDto,
  WorkspaceDetailsDto,
  WorkspaceSummaryDto
} from "@gitnest/contracts";

import {
  findTargetSnapshot,
  getSnapshotChangeCount,
  repositoryTargetSelected,
  resolveWorkspaceTarget
} from "../../entities/workspace/model";
import type { AppView } from "../../app/navigation";
import { Icon } from "../../shared/ui/Icon";
import { Input } from "../../shared/ui/Input";
import { LayerPortal } from "../../shared/ui/LayerPortal";
import {
  Skeleton,
  SkeletonBoundary
} from "../../shared/ui/Skeleton";
import {
  Menu,
  MenuHeading,
  MenuItem,
  MenuPopover,
  MenuSeparator
} from "../../shared/ui/Menu";
import {
  WorkspaceDeleteDialog,
  WorkspaceGroupRenameDialog,
  WorkspaceRepositoryRemoveDialog,
  WorkspaceRenameDialog,
  WorkspaceTapdKeywordDialog
} from "./WorkspaceDialogs";
import {
  changedRepositoriesOnlyPreferenceKey,
  getRendererPreferenceStorage,
  readChangedRepositoriesOnlyPreference,
  writeChangedRepositoriesOnlyPreference
} from "./sidebarPreferences";
import {
  readTapdKeywordPreference,
  writeTapdKeywordPreference
} from "./tapdKeywordPreferences";
import "./workspace-sidebar.css";

export interface WorkspaceSidebarProps {
  activeView: AppView;
  sidebarHidden: boolean;
  workspace: WorkspaceDetailsDto | null;
  workspaces: WorkspaceSummaryDto[];
  snapshots: RepositoryStatusSnapshotDto[];
  busy: boolean;
  onCreateWorkspace(): Promise<boolean>;
  onSwitchWorkspace(workspaceId: string): Promise<boolean>;
  onDeleteWorkspace(workspaceId: string): Promise<boolean>;
  onAddDirectory(): Promise<boolean>;
  onOpenWorkspace(): void;
  onRenameWorkspace(
    workspaceId: string,
    name: string
  ): Promise<boolean>;
  onRemoveRepository(
    target: RepositoryTargetDto
  ): Promise<boolean>;
  onRescan(): Promise<boolean>;
  onSelectTarget(target: RepositoryTargetDto): void;
  onSetGroupCollapsed(
    groupId: string,
    collapsed: boolean
  ): Promise<void>;
}

interface VisibleGroup {
  group: RepositoryGroupDto;
  displayName: string;
  targets: RepositoryTargetDto[];
}

type ContextMenuState =
  | {
      kind: "workspace";
      x: number;
      y: number;
    }
  | {
      kind: "group";
      groupId: string;
      x: number;
      y: number;
    }
  | {
      kind: "repository";
      target: RepositoryTargetDto;
      targetName: string;
      x: number;
      y: number;
    };

interface GroupRenameState {
  groupId: string;
  automaticName: string;
  displayName: string;
}

interface GroupDragState {
  groupId: string;
  overGroupId?: string;
  position?: "before" | "after";
}

function getWorkspaceContextMenuPosition(
  clientX: number,
  clientY: number,
  menuWidth: number,
  menuHeight: number
): Pick<ContextMenuState, "x" | "y"> {
  const viewportPadding = 8;
  const maxX = Math.max(
    viewportPadding,
    window.innerWidth - menuWidth - viewportPadding
  );
  const maxY = Math.max(
    viewportPadding,
    window.innerHeight - menuHeight - viewportPadding
  );

  return {
    x: Math.max(viewportPadding, Math.min(clientX, maxX)),
    y: Math.max(
      viewportPadding,
      Math.min(clientY, maxY)
    )
  };
}

export function WorkspaceSidebar({
  activeView,
  sidebarHidden,
  workspace,
  workspaces,
  snapshots,
  busy,
  onCreateWorkspace,
  onSwitchWorkspace,
  onDeleteWorkspace,
  onAddDirectory,
  onOpenWorkspace,
  onRenameWorkspace,
  onRemoveRepository,
  onRescan,
  onSelectTarget,
  onSetGroupCollapsed
}: WorkspaceSidebarProps) {
  const [query, setQuery] = useState("");
  const [workspaceRootCollapsed, setWorkspaceRootCollapsed] =
    useState(false);
  const [bulkCollapsing, setBulkCollapsing] = useState(false);
  const [groupOrder, setGroupOrder] = useState<string[]>([]);
  const [groupDragState, setGroupDragState] =
    useState<GroupDragState | null>(null);
  const suppressGroupClickUntil = useRef(0);
  const [contextMenu, setContextMenu] =
    useState<ContextMenuState | null>(null);
  const [groupNameOverrides, setGroupNameOverrides] =
    useState<Record<string, string>>({});
  const [renameGroup, setRenameGroup] =
    useState<GroupRenameState | null>(null);
  const [renameWorkspaceOpen, setRenameWorkspaceOpen] =
    useState(false);
  const [
    renameWorkspaceSubmitting,
    setRenameWorkspaceSubmitting
  ] = useState(false);
  const [deleteWorkspaceOpen, setDeleteWorkspaceOpen] =
    useState(false);
  const [
    deleteWorkspaceSubmitting,
    setDeleteWorkspaceSubmitting
  ] = useState(false);
  const [tapdKeyword, setTapdKeyword] =
    useState<string | null>(null);
  const [tapdKeywordSubmitting, setTapdKeywordSubmitting] =
    useState(false);
  const [removeTarget, setRemoveTarget] =
    useState<RepositoryTargetDto | null>(null);
  const [removeSubmitting, setRemoveSubmitting] =
    useState(false);
  const [repositoryMenuOpen, setRepositoryMenuOpen] =
    useState(false);
  const [
    changedRepositoriesPreference,
    setChangedRepositoriesPreference
  ] = useState<{
    key: string | undefined;
    enabled: boolean;
  }>({ key: undefined, enabled: false });
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const repositoryMenuRef = useRef<HTMLDivElement>(null);
  const repositoryMenuTriggerRef =
    useRef<HTMLButtonElement>(null);
  const repositoryMenuSurfaceRef =
    useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const workspaceId = workspace?.id;
  const changedRepositoriesPreferenceKey =
    workspaceId
      ? changedRepositoriesOnlyPreferenceKey(workspaceId)
      : undefined;
  const showChangedRepositoriesOnly =
    changedRepositoriesPreference.key ===
    changedRepositoriesPreferenceKey
      ? changedRepositoriesPreference.enabled
      : readChangedRepositoriesOnlyPreference(
          getRendererPreferenceStorage(),
          workspaceId
        );
  const visibleGroups = useMemo(
    () =>
      getVisibleGroups(
        workspace,
        snapshots,
        normalizedQuery,
        groupNameOverrides,
        showChangedRepositoriesOnly
      ),
    [
      groupNameOverrides,
      normalizedQuery,
      showChangedRepositoriesOnly,
      snapshots,
      workspace
    ]
  );
  const orderedVisibleGroups = useMemo(
    () => orderGroups(visibleGroups, groupOrder),
    [groupOrder, visibleGroups]
  );
  const allGroupsHaveExpanded = visibleGroups.some(
    ({ group }) => !group.collapsed
  );
  const allGroupsActionLabel = allGroupsHaveExpanded
    ? "收起所有仓库分组"
    : "展开所有仓库分组";
  const contextGroup =
    contextMenu?.kind === "group"
      ? workspace?.groups.find(
          (group) => group.id === contextMenu.groupId
        )
      : undefined;
  const contextRepository =
    contextMenu?.kind === "repository" && workspace
      ? resolveWorkspaceTarget(workspace, contextMenu.target)
      : null;
  const workspaceCanonicalPath = workspace?.canonicalPath;
  const contextRepositoryCanonicalPath =
    contextRepository?.worktree?.canonicalPath;
  const contextRepositoryIsRoot =
    workspaceCanonicalPath !== undefined &&
    contextRepositoryCanonicalPath !== undefined &&
    workspaceCanonicalPath.toLocaleLowerCase() ===
      contextRepositoryCanonicalPath.toLocaleLowerCase();
  const removeTargetDetails =
    removeTarget && workspace
      ? resolveWorkspaceTarget(workspace, removeTarget)
      : null;
  const removeTargetName =
    removeTargetDetails?.repository?.name ??
    removeTargetDetails?.worktree?.name ??
    "未知仓库";
  const removeTargetPath = removeTargetDetails?.worktree?.path;
  const directoryPath =
    workspace?.path ??
    workspace?.canonicalPath ??
    "Workspace 根目录不可用";

  const toggleChangedRepositoriesOnly = () => {
    const next = !showChangedRepositoriesOnly;
    setChangedRepositoriesPreference({
      key: changedRepositoriesPreferenceKey,
      enabled: next
    });
    writeChangedRepositoriesOnlyPreference(
      getRendererPreferenceStorage(),
      workspaceId,
      next
    );
  };

  const handleGroupDragStart = (
    event: DragEvent<HTMLButtonElement>,
    groupId: string
  ) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", groupId);
    suppressGroupClickUntil.current = Date.now() + 800;
    setGroupDragState({ groupId });
  };

  const handleGroupDragOver = (
    event: DragEvent<HTMLButtonElement>,
    groupId: string
  ) => {
    if (
      !groupDragState ||
      groupDragState.groupId === groupId
    ) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    const position =
      event.clientY < bounds.top + bounds.height / 2
        ? "before"
        : "after";
    setGroupDragState((current) =>
      current && current.groupId !== groupId
        ? {
            ...current,
            overGroupId: groupId,
            position
          }
        : current
    );
  };

  const handleGroupDrop = (
    event: DragEvent<HTMLButtonElement>,
    groupId: string
  ) => {
    event.preventDefault();
    const drag = groupDragState;
    if (!drag || drag.groupId === groupId || !workspace) {
      setGroupDragState(null);
      return;
    }

    const allGroupIds = workspace.groups.map(
      (group) => group.id
    );
    const currentOrder = [
      ...groupOrder.filter((id) => allGroupIds.includes(id)),
      ...allGroupIds.filter((id) => !groupOrder.includes(id))
    ];
    const nextOrder = currentOrder.filter(
      (currentId) => currentId !== drag.groupId
    );
    const targetIndex = nextOrder.indexOf(groupId);
    if (targetIndex < 0) {
      setGroupDragState(null);
      return;
    }

    const insertIndex =
      targetIndex + (drag.position === "after" ? 1 : 0);
    nextOrder.splice(insertIndex, 0, drag.groupId);
    setGroupOrder(nextOrder);
    setGroupDragState(null);
  };

  const toggleAllGroups = async () => {
    if (!visibleGroups.length || bulkCollapsing) {
      return;
    }

    const nextCollapsed = allGroupsHaveExpanded;
    setBulkCollapsing(true);
    try {
      for (const { group } of visibleGroups) {
        if (group.collapsed !== nextCollapsed) {
          await onSetGroupCollapsed(
            group.id,
            nextCollapsed
          );
        }
      }
    } finally {
      setBulkCollapsing(false);
    }
  };

  useEffect(() => {
    setChangedRepositoriesPreference({
      key: changedRepositoriesPreferenceKey,
      enabled: readChangedRepositoriesOnlyPreference(
        getRendererPreferenceStorage(),
        workspaceId
      )
    });
  }, [changedRepositoriesPreferenceKey, workspaceId]);

  useEffect(() => {
    setQuery("");
    setWorkspaceRootCollapsed(false);
    setGroupOrder([]);
    setGroupDragState(null);
    setContextMenu(null);
    setGroupNameOverrides({});
    setRenameGroup(null);
    setRenameWorkspaceOpen(false);
    setRenameWorkspaceSubmitting(false);
    setDeleteWorkspaceOpen(false);
    setDeleteWorkspaceSubmitting(false);
    setTapdKeyword(null);
    setRemoveTarget(null);
    setRepositoryMenuOpen(false);
  }, [workspaceId]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeFromOutside = (
      event: globalThis.PointerEvent
    ) => {
      const target = event.target;
      if (
        target instanceof Node &&
        contextMenuRef.current?.contains(target)
      ) {
        return;
      }
      setContextMenu(null);
    };
    const closeFromKeyboard = (
      event: globalThis.KeyboardEvent
    ) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setContextMenu(null);
      }
    };

    document.addEventListener(
      "pointerdown",
      closeFromOutside
    );
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
  }, [contextMenu]);

  useEffect(() => {
    if (!repositoryMenuOpen) {
      return;
    }

    const closeFromOutside = (
      event: globalThis.PointerEvent
    ) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (repositoryMenuRef.current?.contains(target) ||
          repositoryMenuSurfaceRef.current?.contains(target))
      ) {
        return;
      }
      setRepositoryMenuOpen(false);
    };
    const closeFromKeyboard = (
      event: globalThis.KeyboardEvent
    ) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setRepositoryMenuOpen(false);
      }
    };

    document.addEventListener(
      "pointerdown",
      closeFromOutside
    );
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
  }, [repositoryMenuOpen]);

  useEffect(() => {
    if (sidebarHidden) {
      setRepositoryMenuOpen(false);
      setContextMenu(null);
    }
  }, [sidebarHidden]);

  const openWorkspaceContextMenu = (
    event: MouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const position = getWorkspaceContextMenuPosition(
      event.clientX,
      event.clientY,
      222,
      184
    );
    setContextMenu({
      kind: "workspace",
      ...position
    });
  };

  const toggleWorkspaceRoot = () => {
    onOpenWorkspace();
    setWorkspaceRootCollapsed((collapsed) => !collapsed);
  };

  const openRepositoryContextMenu = (
    event: MouseEvent<HTMLButtonElement>,
    target: RepositoryTargetDto,
    targetName: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const position = getWorkspaceContextMenuPosition(
      event.clientX,
      event.clientY,
      222,
      56
    );
    setContextMenu({
      kind: "repository",
      target,
      targetName,
      ...position
    });
  };

  const openGroupContextMenu = (
    event: MouseEvent<HTMLButtonElement>,
    group: RepositoryGroupDto
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const position = getWorkspaceContextMenuPosition(
      event.clientX,
      event.clientY,
      222,
      56
    );
    setContextMenu({
      kind: "group",
      groupId: group.id,
      ...position
    });
  };

  const startGroupRename = () => {
    if (!contextGroup) {
      return;
    }
    setContextMenu(null);
    setRenameGroup({
      groupId: contextGroup.id,
      automaticName: contextGroup.name,
      displayName: getGroupDisplayName(
        groupNameOverrides,
        contextGroup
      )
    });
  };

  const confirmGroupRename = async (
    displayName: string
  ): Promise<boolean> => {
    if (!renameGroup) {
      return false;
    }
    setGroupNameOverrides((current) => ({
      ...current,
      [renameGroup.groupId]: displayName
    }));
    return true;
  };

  const startWorkspaceRename = () => {
    if (!workspace) {
      return;
    }
    setContextMenu(null);
    setRenameWorkspaceSubmitting(false);
    setRenameWorkspaceOpen(true);
  };

  const confirmWorkspaceRename = async (
    name: string
  ): Promise<boolean> => {
    if (!workspace || renameWorkspaceSubmitting) {
      return false;
    }
    setRenameWorkspaceSubmitting(true);
    try {
      return await onRenameWorkspace(workspace.id, name);
    } finally {
      setRenameWorkspaceSubmitting(false);
    }
  };

  const startWorkspaceDelete = () => {
    if (!workspace || workspaces.length <= 1) {
      return;
    }
    setContextMenu(null);
    setDeleteWorkspaceSubmitting(false);
    setDeleteWorkspaceOpen(true);
  };

  const confirmWorkspaceDelete =
    async (): Promise<boolean> => {
      if (
        !workspace ||
        workspaces.length <= 1 ||
        deleteWorkspaceSubmitting
      ) {
        return false;
      }
      setDeleteWorkspaceSubmitting(true);
      try {
        return await onDeleteWorkspace(workspace.id);
      } finally {
        setDeleteWorkspaceSubmitting(false);
      }
    };

  const startTapdKeyword = useCallback(() => {
    if (!workspaceId) {
      return;
    }
    setContextMenu(null);
    setTapdKeywordSubmitting(false);
    setTapdKeyword(
      readTapdKeywordPreference(
        getRendererPreferenceStorage(),
        workspaceId
      )
    );
  }, [workspaceId]);

  const confirmTapdKeyword = async (
    keyword: string
  ): Promise<boolean> => {
    if (tapdKeyword === null || !workspaceId) {
      return false;
    }
    setTapdKeywordSubmitting(true);
    try {
      writeTapdKeywordPreference(
        getRendererPreferenceStorage(),
        workspaceId,
        keyword
      );
      return true;
    } finally {
      setTapdKeywordSubmitting(false);
    }
  };

  const startRemoveRepository = () => {
    if (contextMenu?.kind !== "repository") {
      return;
    }
    setRemoveSubmitting(false);
    setRemoveTarget(contextMenu.target);
    setContextMenu(null);
  };

  const confirmRemoveRepository =
    async (): Promise<boolean> => {
      if (!removeTarget || removeSubmitting) {
        return false;
      }
      setRemoveSubmitting(true);
      try {
        return await onRemoveRepository(removeTarget);
      } finally {
        setRemoveSubmitting(false);
      }
    };

  const renderRepositoryRow = (
    target: RepositoryTargetDto
  ) => {
    if (!workspace) {
      return null;
    }
    const resolved = resolveWorkspaceTarget(workspace, target);
    const name =
      resolved.worktree?.name ??
      resolved.repository?.name ??
      "未知仓库";
    const snapshot = findTargetSnapshot(snapshots, target);
    const selected =
      activeView === "repository" &&
      repositoryTargetSelected(
        workspace.selectedTarget,
        target
      );
    const branch =
      snapshot?.branch ??
      resolved.worktree?.branch ??
      "detached";
    const tone = snapshotTone(snapshot);
    const status = snapshotStatus(snapshot);

    return (
      <Button
        variant="unstyled"
        aria-current={selected ? "true" : undefined}
        aria-haspopup="menu"
        className={`repository-row${
          selected ? " selected" : ""
        }`}
        key={`${target.repositoryId}:${target.worktreeId}`}
        onClick={() => onSelectTarget(target)}
        onContextMenu={(event) =>
          openRepositoryContextMenu(event, target, name)
        }
        title={resolved.worktree?.path}
        type="button"
      >
        <span className={`repository-state ${tone}`}>
          <Icon name="repository" size={13} />
        </span>
        <span className="repository-row-main">
          <span
            className="repository-row-name"
            title={name}
          >
            {name}
          </span>
          <span className="repository-row-branch">
            <Icon name="branch" size={11} />
            <span title={branch}>{branch}</span>
          </span>
        </span>
        {status.label && (
          <span
            aria-label={status.ariaLabel}
            className={`repository-row-status ${tone}`}
          >
            {status.label}
          </span>
        )}
      </Button>
    );
  };

  return (
    <aside className="workspace-sidebar">
      <WorkspaceSwitcher
        busy={busy}
        hidden={sidebarHidden}
        workspace={workspace}
        workspaces={workspaces}
        onCreateWorkspace={onCreateWorkspace}
        onDeleteWorkspace={onDeleteWorkspace}
        onSwitchWorkspace={onSwitchWorkspace}
      />

      <div className="sidebar-search-wrap">
        <div className="sidebar-search-field">
          <Input
            aria-label="筛选仓库"
            autoComplete="off"
            clearLabel="清除仓库筛选"
            fullWidth
            leading={<Icon name="search" size={14} />}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="筛选仓库…"
            size="small"
            spellCheck={false}
            value={query}
            {...(query
              ? { onClear: () => setQuery("") }
              : {})}
          />
        </div>
        <div
          className="sidebar-repository-menu-wrap"
          ref={repositoryMenuRef}
        >
          <Button
            variant="unstyled"
            aria-expanded={repositoryMenuOpen}
            aria-haspopup="menu"
            aria-label="仓库筛选菜单"
            className="sidebar-repository-menu-trigger"
            onClick={() =>
              setRepositoryMenuOpen((open) => !open)
            }
            ref={repositoryMenuTriggerRef}
            title="仓库筛选菜单"
            type="button"
          >
            <Icon name="more" size={15} />
          </Button>
          {repositoryMenuOpen && (
            <MenuPopover
              align="start"
              anchor={repositoryMenuTriggerRef.current}
              aria-label="仓库筛选"
              className="sidebar-repository-menu"
              ref={repositoryMenuSurfaceRef}
              side="bottom"
            >
              <MenuItem
                leading={
                  <Icon
                    name={
                      showChangedRepositoriesOnly
                        ? "layers"
                        : "fileCode"
                    }
                    size={15}
                  />
                }
                onClick={() => {
                  setRepositoryMenuOpen(false);
                  toggleChangedRepositoriesOnly();
                }}
              >
                {showChangedRepositoriesOnly
                  ? "全部仓库"
                  : "变更仓库"}
              </MenuItem>
              {visibleGroups.length > 0 && (
                <MenuItem
                  aria-label={allGroupsActionLabel}
                  disabled={bulkCollapsing}
                  leading={
                    <Icon
                      name={
                        allGroupsHaveExpanded
                          ? "collapse"
                          : "chevron"
                      }
                      size={15}
                    />
                  }
                  onClick={() => {
                    setRepositoryMenuOpen(false);
                    void toggleAllGroups();
                  }}
                  title={allGroupsActionLabel}
                >
                  {allGroupsHaveExpanded
                    ? "收起分组"
                    : "展开分组"}
                </MenuItem>
              )}
            </MenuPopover>
          )}
        </div>
      </div>

      <nav
        aria-label="Workspace 仓库"
        className="repository-list"
      >
        {workspace ? (
          <section
            className={`workspace-root${
              activeView === "workspace" ? " selected" : ""
            }${
              workspaceRootCollapsed ? " collapsed" : ""
            }`}
          >
            <Button
              variant="unstyled"
              aria-controls="workspace-root-body"
              aria-current={
                activeView === "workspace" ? "page" : undefined
              }
              aria-expanded={!workspaceRootCollapsed}
              aria-label={`打开 ${workspace.name} 概览`}
              aria-haspopup="menu"
              className="workspace-root-heading"
              onClick={toggleWorkspaceRoot}
              onContextMenu={openWorkspaceContextMenu}
              title="打开 Workspace 概览"
              type="button"
            >
              <span className="workspace-root-icon">
                <Icon name="folder" size={15} />
              </span>
              <span className="workspace-root-copy">
                <strong>{workspace.name}</strong>
                <small title={directoryPath}>
                  {directoryPath}
                </small>
              </span>
              <span
                aria-hidden="true"
                className="workspace-root-toggle"
              >
                <Icon
                  name={
                    workspaceRootCollapsed
                      ? "collapse"
                      : "chevron"
                  }
                  size={14}
                />
              </span>
            </Button>

            <div
              aria-hidden={workspaceRootCollapsed}
              className="workspace-root-body"
              id="workspace-root-body"
              inert={workspaceRootCollapsed}
            >
              <div className="workspace-root-body-inner">
                {orderedVisibleGroups.length > 0 ? (
                  orderedVisibleGroups.map(
                    ({ group, displayName, targets }) => (
                      <div
                        className={`repository-group${
                          group.collapsed ? " collapsed" : ""
                        }`}
                        key={group.id}
                      >
                        <Button
                          variant="unstyled"
                          aria-expanded={!group.collapsed}
                          aria-label={displayName}
                          className={`group-header${
                            groupDragState?.groupId === group.id
                              ? " dragging"
                              : ""
                          }${
                            groupDragState?.overGroupId === group.id &&
                            groupDragState.position === "before"
                              ? " drag-over-before"
                              : ""
                          }${
                            groupDragState?.overGroupId === group.id &&
                            groupDragState.position === "after"
                              ? " drag-over-after"
                              : ""
                          }`}
                          disabled={bulkCollapsing}
                          draggable={!bulkCollapsing}
                          onClick={(event) => {
                            if (
                              Date.now() <
                              suppressGroupClickUntil.current
                            ) {
                              event.preventDefault();
                              suppressGroupClickUntil.current = 0;
                              return;
                            }
                            void onSetGroupCollapsed(
                              group.id,
                              !group.collapsed
                            );
                          }}
                          onContextMenu={(event) =>
                            openGroupContextMenu(event, group)
                          }
                          onDragEnd={() =>
                            setGroupDragState(null)
                          }
                          onDragOver={(event) =>
                            handleGroupDragOver(event, group.id)
                          }
                          onDragStart={(event) =>
                            handleGroupDragStart(event, group.id)
                          }
                          onDrop={(event) =>
                            handleGroupDrop(event, group.id)
                          }
                          type="button"
                        >
                          <Icon
                            className="group-chevron"
                            name="collapse"
                            size={13}
                          />
                          <span>{displayName}</span>
                          <span className="group-count">
                            {targets.length}
                          </span>
                        </Button>
                        {!group.collapsed && (
                          <div className="group-body">
                            {targets.length === 0 ? (
                              <div className="repository-group-empty">
                                暂无仓库
                              </div>
                            ) : (
                              targets.map(renderRepositoryRow)
                            )}
                          </div>
                        )}
                      </div>
                    )
                  )
                ) : (
                  <SidebarEmpty
                    busy={busy}
                    hasRepositories={Boolean(
                      workspace.repositories.length
                    )}
                    onClearQuery={() => setQuery("")}
                    query={normalizedQuery}
                  />
                )}
              </div>
            </div>
          </section>
        ) : (
          <SidebarEmpty
            busy={busy}
            hasRepositories={false}
            onClearQuery={() => setQuery("")}
            query={normalizedQuery}
          />
        )}
      </nav>

      <div className="sidebar-footer">
        <Button
          variant="unstyled"
          className="sidebar-add-directory"
          disabled={busy}
          onClick={() => void onAddDirectory()}
          type="button"
        >
          <Icon name="plus" size={14} />
          添加目录
        </Button>
        <Button
          variant="unstyled"
          aria-busy={busy}
          aria-label="重新扫描 Workspace"
          className="icon-button"
          disabled={busy || !workspace}
          onClick={() => void onRescan()}
          title="重新扫描 Workspace"
          type="button"
        >
          <Icon name="refresh" size={14} />
        </Button>
      </div>

      {contextMenu && (
        <LayerPortal>
          <Menu
            aria-label={
              contextMenu.kind === "workspace"
                ? `${workspace?.name ?? "Workspace"} 操作`
                : contextMenu.kind === "group"
                ? `${getGroupDisplayName(
                    groupNameOverrides,
                    contextGroup
                  )} 操作`
                : `${contextMenu.targetName} 操作`
            }
            className="workspace-context-menu"
            ref={contextMenuRef}
            style={{
              left: contextMenu.x,
              top: contextMenu.y
            }}
          >
            {contextMenu.kind === "workspace" ? (
              <>
                <MenuItem
                  disabled={!workspace || busy}
                  leading={<Icon name="settings" size={14} />}
                  onClick={startWorkspaceRename}
                >
                  修改显示名称
                </MenuItem>
                <MenuItem
                  disabled={!workspace}
                  leading={<Icon name="tag" size={14} />}
                  onClick={startTapdKeyword}
                >
                  设置 TAPD 关键字
                </MenuItem>
                <MenuItem
                  disabled={!workspace || busy}
                  leading={<Icon name="refresh" size={14} />}
                  onClick={() => {
                    setContextMenu(null);
                    void onRescan();
                  }}
                >
                  重新扫描
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  disabled={
                    !workspace ||
                    busy ||
                    workspaces.length <= 1
                  }
                  leading={<Icon name="warning" size={14} />}
                  onClick={startWorkspaceDelete}
                  title={
                    workspaces.length <= 1
                      ? "至少需要保留一个 Workspace"
                      : undefined
                  }
                  tone="danger"
                >
                  删除 Workspace
                </MenuItem>
              </>
            ) : contextMenu.kind === "group" ? (
              <MenuItem
                disabled={!contextGroup}
                leading={<Icon name="tag" size={14} />}
                onClick={startGroupRename}
              >
                重命名分组
              </MenuItem>
            ) : (
              <MenuItem
                disabled={busy || contextRepositoryIsRoot}
                leading={<Icon name="warning" size={14} />}
                onClick={startRemoveRepository}
                tone="danger"
              >
                {contextRepositoryIsRoot
                  ? "Workspace 根仓库"
                  : "移出 Workspace"}
              </MenuItem>
            )}
          </Menu>
        </LayerPortal>
      )}

      {renameGroup && (
        <WorkspaceGroupRenameDialog
          busy={false}
          displayName={renameGroup.displayName}
          onCancel={() => setRenameGroup(null)}
          onConfirm={confirmGroupRename}
        />
      )}
      {renameWorkspaceOpen && workspace && (
        <WorkspaceRenameDialog
          busy={renameWorkspaceSubmitting || busy}
          initialName={workspace.name}
          {...(workspace.path ? { path: workspace.path } : {})}
          onCancel={() => setRenameWorkspaceOpen(false)}
          onConfirm={confirmWorkspaceRename}
        />
      )}
      {tapdKeyword !== null && workspace && (
        <WorkspaceTapdKeywordDialog
          busy={tapdKeywordSubmitting}
          initialKeyword={tapdKeyword}
          workspaceName={workspace.name}
          onCancel={() => setTapdKeyword(null)}
          onConfirm={confirmTapdKeyword}
        />
      )}
      {deleteWorkspaceOpen && workspace && (
        <WorkspaceDeleteDialog
          busy={deleteWorkspaceSubmitting || busy}
          name={workspace.name}
          onCancel={() => setDeleteWorkspaceOpen(false)}
          onConfirm={confirmWorkspaceDelete}
        />
      )}
      {removeTarget && (
        <WorkspaceRepositoryRemoveDialog
          busy={removeSubmitting || busy}
          name={removeTargetName}
          {...(removeTargetPath
            ? { path: removeTargetPath }
            : {})}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={confirmRemoveRepository}
        />
      )}
    </aside>
  );
}

interface WorkspaceSwitcherProps {
  busy: boolean;
  hidden: boolean;
  workspace: WorkspaceDetailsDto | null;
  workspaces: WorkspaceSummaryDto[];
  onCreateWorkspace(): Promise<boolean>;
  onSwitchWorkspace(workspaceId: string): Promise<boolean>;
  onDeleteWorkspace(workspaceId: string): Promise<boolean>;
}

const WorkspaceSwitcher = memo(function WorkspaceSwitcher({
  busy,
  hidden,
  workspace,
  workspaces,
  onCreateWorkspace,
  onSwitchWorkspace,
  onDeleteWorkspace
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"delete" | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
    setDialog(null);
    setDialogBusy(false);
  }, [hidden, workspace?.id]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeFromOutside = (
      event: globalThis.PointerEvent
    ) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (wrapRef.current?.contains(target) ||
          menuRef.current?.contains(target))
      ) {
        return;
      }
      setOpen(false);
    };
    const closeFromKeyboard = (
      event: globalThis.KeyboardEvent
    ) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };

    document.addEventListener(
      "pointerdown",
      closeFromOutside
    );
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
  }, [open]);

  const confirmDelete = async (): Promise<boolean> => {
    if (
      !workspace ||
      workspaces.length <= 1 ||
      dialogBusy
    ) {
      return false;
    }
    setDialogBusy(true);
    try {
      return await onDeleteWorkspace(workspace.id);
    } finally {
      setDialogBusy(false);
    }
  };

  return (
    <>
      <div className="workspace-switcher-wrap" ref={wrapRef}>
        <Button
          variant="unstyled"
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="切换 Workspace"
          className="workspace-switcher"
          onClick={() => setOpen((current) => !current)}
          ref={triggerRef}
          title="切换 Workspace"
          type="button"
        >
          <span className="workspace-avatar">
            <Icon name="layers" size={18} />
          </span>
          <span className="workspace-meta">
            <span className="workspace-name">
              {workspace?.name ?? "GitNest Workspace"}
            </span>
            <span className="workspace-caption">
              {workspace ? (
                `${workspaces.length} 个 Workspace · 本地持久化`
              ) : (
                <Skeleton variant="text" width="72%" />
              )}
            </span>
          </span>
          <span
            aria-hidden="true"
            className="workspace-switcher-chevron"
          >
            <Icon name="chevron" size={16} />
          </span>
        </Button>
        {open && (
          <MenuPopover
            align="start"
            anchor={triggerRef.current}
            aria-label="切换 Workspace"
            className="workspace-switcher-menu"
            ref={menuRef}
            side="bottom"
          >
            <MenuHeading>Workspace</MenuHeading>
            {workspaces.map((candidate) => (
              <MenuItem
                aria-checked={candidate.id === workspace?.id}
                className={
                  candidate.id === workspace?.id
                    ? "is-selected"
                    : undefined
                }
                disabled={busy}
                key={candidate.id}
                leading={<Icon name="layers" size={15} />}
                onClick={() => {
                  setOpen(false);
                  void onSwitchWorkspace(candidate.id);
                }}
                role="menuitemradio"
              >
                {candidate.name}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem
              disabled={busy}
              leading={<Icon name="plus" size={15} />}
              onClick={() => {
                setOpen(false);
                void onCreateWorkspace();
              }}
            >
              新建 Workspace
            </MenuItem>
            <MenuItem
              disabled={
                busy || !workspace || workspaces.length <= 1
              }
              leading={<Icon name="warning" size={15} />}
              onClick={() => {
                setOpen(false);
                setDialogBusy(false);
                setDialog("delete");
              }}
              tone="danger"
            >
              删除当前 Workspace
            </MenuItem>
          </MenuPopover>
        )}
      </div>
      {dialog === "delete" && workspace && (
        <WorkspaceDeleteDialog
          busy={dialogBusy || busy}
          name={workspace.name}
          onCancel={() => setDialog(null)}
          onConfirm={confirmDelete}
        />
      )}
    </>
  );
}, workspaceSwitcherPropsEqual);

function workspaceSwitcherPropsEqual(
  previous: WorkspaceSwitcherProps,
  next: WorkspaceSwitcherProps
): boolean {
  return (
    previous.busy === next.busy &&
    previous.hidden === next.hidden &&
    previous.workspace?.id === next.workspace?.id &&
    previous.workspace?.name === next.workspace?.name &&
    workspaceSummariesEqual(
      previous.workspaces,
      next.workspaces
    ) &&
    previous.onCreateWorkspace === next.onCreateWorkspace &&
    previous.onSwitchWorkspace === next.onSwitchWorkspace &&
    previous.onDeleteWorkspace === next.onDeleteWorkspace
  );
}

function workspaceSummariesEqual(
  previous: WorkspaceSummaryDto[],
  next: WorkspaceSummaryDto[]
): boolean {
  return (
    previous.length === next.length &&
    previous.every((workspace, index) => {
      const candidate = next[index];
      return (
        candidate?.id === workspace.id &&
        candidate.name === workspace.name &&
        candidate.updatedAt === workspace.updatedAt
      );
    })
  );
}

function snapshotTone(
  snapshot: RepositoryStatusSnapshotDto | undefined
):
  | "clean"
  | "idle"
  | "warning"
  | "danger"
  | "behind"
  | "ahead" {
  if (snapshot?.error || snapshot?.conflicted) {
    return "danger";
  }
  if (!snapshot || snapshot.stale) {
    return "idle";
  }
  if (getSnapshotChangeCount(snapshot) > 0) {
    return "warning";
  }
  if (snapshot.behind > 0) {
    return "behind";
  }
  if (snapshot.ahead > 0) {
    return "ahead";
  }
  return "clean";
}

function snapshotStatus(
  snapshot: RepositoryStatusSnapshotDto | undefined
): {
  label: string | null;
  ariaLabel: string;
} {
  if (snapshot?.error) {
    return {
      label: "错误",
      ariaLabel: "仓库状态读取错误"
    };
  }
  if (snapshot?.conflicted) {
    return {
      label: `${snapshot.conflicted} 冲突`,
      ariaLabel: `${snapshot.conflicted} 个冲突`
    };
  }

  const changes = getSnapshotChangeCount(snapshot);
  if (changes > 0) {
    return {
      label: `M ${changes}`,
      ariaLabel: `${changes} 项变更`
    };
  }
  if (snapshot?.behind) {
    return {
      label: `↓ ${snapshot.behind}`,
      ariaLabel: `落后 ${snapshot.behind} 个提交`
    };
  }
  if (snapshot?.ahead) {
    return {
      label: `↑ ${snapshot.ahead}`,
      ariaLabel: `领先 ${snapshot.ahead} 个提交`
    };
  }
  if (!snapshot || snapshot.stale) {
    return {
      label: "—",
      ariaLabel: "状态暂不可用"
    };
  }

  return {
    label: null,
    ariaLabel: "工作区干净"
  };
}

function getVisibleGroups(
  workspace: WorkspaceDetailsDto | null,
  snapshots: RepositoryStatusSnapshotDto[],
  query: string,
  groupNameOverrides: Record<string, string> = {},
  showChangedRepositoriesOnly = false
): VisibleGroup[] {
  if (!workspace) {
    return [];
  }

  return workspace.groups
    .map((group) => {
      const displayName = getGroupDisplayName(
        groupNameOverrides,
        group
      );
      const groupMatches =
        !query ||
        displayName.toLocaleLowerCase().includes(query);
      const targets = group.targets.filter((target) => {
        if (
          showChangedRepositoriesOnly &&
          !targetHasLocalChanges(snapshots, target)
        ) {
          return false;
        }
        return (
          groupMatches ||
          workspaceTargetMatchesQuery(
            workspace,
            target,
            query
          )
        );
      });

      return {
        group,
        displayName,
        targets
      };
    })
    .filter(
      ({ group, targets }) =>
        targets.length > 0 ||
        (!query &&
          !showChangedRepositoriesOnly &&
          group.targets.length === 0)
    );
}

function orderGroups(
  groups: VisibleGroup[],
  order: string[]
): VisibleGroup[] {
  if (!order.length) {
    return groups;
  }

  const used = new Set<string>();
  const ordered = order.flatMap((groupId) => {
    const match = groups.find(
      ({ group }) => group.id === groupId
    );
    if (!match) {
      return [];
    }
    used.add(groupId);
    return [match];
  });

  return [
    ...ordered,
    ...groups.filter(({ group }) => !used.has(group.id))
  ];
}

function workspaceTargetMatchesQuery(
  workspace: WorkspaceDetailsDto,
  target: RepositoryTargetDto,
  query: string
): boolean {
  if (!query) {
    return true;
  }
  const resolved = resolveWorkspaceTarget(workspace, target);
  return [
    resolved.repository?.name,
    resolved.repository?.commonDir,
    resolved.worktree?.name,
    resolved.worktree?.path,
    resolved.worktree?.branch
  ]
    .filter(Boolean)
    .some((value) =>
      String(value).toLocaleLowerCase().includes(query)
    );
}

function targetHasLocalChanges(
  snapshots: RepositoryStatusSnapshotDto[],
  target: RepositoryTargetDto
): boolean {
  const snapshot = findTargetSnapshot(snapshots, target);
  return (
    Boolean(snapshot?.conflicted) ||
    getSnapshotChangeCount(snapshot) > 0
  );
}

function getGroupDisplayName(
  overrides: Record<string, string>,
  group: RepositoryGroupDto | undefined
): string {
  if (!group) {
    return "仓库分组";
  }
  return overrides[group.id] ?? group.name;
}

function SidebarEmpty({
  busy,
  hasRepositories,
  query,
  onClearQuery
}: {
  busy: boolean;
  hasRepositories: boolean;
  query: string;
  onClearQuery(): void;
}) {
  return (
    <SkeletonBoundary
      fallback={<SidebarSkeleton />}
      hasContent={hasRepositories}
      label="正在读取 Workspace 仓库"
      loading={busy}
      surfaceClassName="sidebar-skeleton"
    >
      {query ? (
        <div className="sidebar-empty">
          <span>当前筛选条件没有匹配的仓库。</span>
          <Button
            size="small"
            onClick={onClearQuery}
            type="button"
          >
            清除筛选
          </Button>
        </div>
      ) : (
        <div className="sidebar-empty">
          Workspace 根目录中尚未发现仓库，可尝试重新扫描。
        </div>
      )}
    </SkeletonBoundary>
  );
}

function SidebarSkeleton() {
  return (
    <div className="sidebar-skeleton-list">
      {Array.from({ length: 5 }, (_, index) => (
        <div className="sidebar-skeleton-row" key={index}>
          <Skeleton height={20} variant="circle" width={20} />
          <div className="gn-skeleton-row-copy">
            <Skeleton height={10} />
            <Skeleton height={8} variant="text" />
          </div>
        </div>
      ))}
    </div>
  );
}
