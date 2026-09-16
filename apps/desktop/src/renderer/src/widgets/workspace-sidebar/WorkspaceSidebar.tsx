import { Button } from "../../shared/ui/Button";
import {
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
  UpdateWorkspaceEntryRequest,
  WorkspaceDetailsDto,
  WorkspaceEntryDto
} from "@gitnest/contracts";

import {
  WORKSPACE_ENTRY_LABELS,
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
  WorkspaceGroupRenameDialog,
  WorkspaceEntryTapdKeywordDialog,
  WorkspaceEntryRemoveDialog,
  WorkspaceEntryRenameDialog
} from "./WorkspaceEntryDialogs";
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

interface WorkspaceSidebarProps {
  activeView: AppView;
  sidebarHidden: boolean;
  workspace: WorkspaceDetailsDto | null;
  snapshots: RepositoryStatusSnapshotDto[];
  busy: boolean;
  onAddDirectory(): void;
  onRemoveEntry(
    entryId: string,
    target?: RepositoryTargetDto
  ): Promise<boolean>;
  onRescan(): Promise<boolean>;
  onSelectEntry(entryId: string): void;
  onSelectTarget(target: RepositoryTargetDto): void;
  onUpdateEntry(
    request: UpdateWorkspaceEntryRequest
  ): Promise<boolean>;
  onSetGroupCollapsed(
    entryId: string,
    groupId: string,
    collapsed: boolean
  ): Promise<void>;
}

interface VisibleEntry {
  entry: WorkspaceEntryDto;
  groups: Array<{
    group: RepositoryGroupDto;
    targets: RepositoryTargetDto[];
  }>;
}

interface ContextMenuState {
  entryId: string;
  groupId?: string;
  targetName?: string;
  target?: RepositoryTargetDto;
  x: number;
  y: number;
}

interface GroupRenameState {
  entryId: string;
  groupId: string;
  automaticName: string;
  displayName: string;
}

interface TapdKeywordState {
  entryId: string;
  keyword: string;
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
  snapshots,
  busy,
  onAddDirectory,
  onRemoveEntry,
  onRescan,
  onSelectEntry,
  onSelectTarget,
  onSetGroupCollapsed,
  onUpdateEntry
}: WorkspaceSidebarProps) {
  const [query, setQuery] = useState("");
  const [bulkCollapsing, setBulkCollapsing] = useState(false);
  const [groupOrderByEntry, setGroupOrderByEntry] =
    useState<Record<string, string[]>>({});
  const [groupDragState, setGroupDragState] = useState<{
    entryId: string;
    groupId: string;
    overGroupId?: string;
    position?: "before" | "after";
  } | null>(null);
  const suppressGroupClickUntil = useRef(0);
  const [collapsedEntryIds, setCollapsedEntryIds] =
    useState<Set<string>>(() => new Set());
  const [contextMenu, setContextMenu] =
    useState<ContextMenuState | null>(null);
  const [groupNameOverrides, setGroupNameOverrides] =
    useState<Record<string, string>>({});
  const [removedEmptyGroupKeys, setRemovedEmptyGroupKeys] =
    useState<Set<string>>(() => new Set());
  const [renameGroup, setRenameGroup] =
    useState<GroupRenameState | null>(null);
  const [tapdKeyword, setTapdKeyword] =
    useState<TapdKeywordState | null>(null);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] =
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
  const [renameEntryId, setRenameEntryId] =
    useState<string | null>(null);
  const [renameSubmitting, setRenameSubmitting] =
    useState(false);
  const [removeEntryId, setRemoveEntryId] =
    useState<string | null>(null);
  const [removeTarget, setRemoveTarget] =
    useState<RepositoryTargetDto | null>(null);
  const [removeSubmitting, setRemoveSubmitting] =
    useState(false);
  const [tapdKeywordSubmitting, setTapdKeywordSubmitting] =
    useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const workspaceSwitcherRef = useRef<HTMLDivElement>(null);
  const workspaceSwitcherTriggerRef =
    useRef<HTMLButtonElement>(null);
  const workspaceSwitcherMenuRef =
    useRef<HTMLDivElement>(null);
  const repositoryMenuRef = useRef<HTMLDivElement>(null);
  const repositoryMenuTriggerRef =
    useRef<HTMLButtonElement>(null);
  const repositoryMenuSurfaceRef =
    useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const workspaceId = workspace?.id;
  const activeEntryId =
    workspace?.selectedEntryId ?? workspace?.entries[0]?.id;
  const changedRepositoriesPreferenceKey =
    workspaceId && activeEntryId
      ? changedRepositoriesOnlyPreferenceKey(
          workspaceId,
          activeEntryId
        )
      : undefined;
  const showChangedRepositoriesOnly =
    changedRepositoriesPreference.key ===
    changedRepositoriesPreferenceKey
      ? changedRepositoriesPreference.enabled
      : readChangedRepositoriesOnlyPreference(
          getRendererPreferenceStorage(),
          workspaceId,
          activeEntryId
        );
  const entries = useMemo(
    () =>
      getVisibleEntries(
        workspace,
        snapshots,
        normalizedQuery,
        activeEntryId,
        groupNameOverrides,
        showChangedRepositoriesOnly,
        removedEmptyGroupKeys
      ),
    [
      activeEntryId,
      groupNameOverrides,
      normalizedQuery,
      removedEmptyGroupKeys,
      showChangedRepositoriesOnly,
      snapshots,
      workspace
    ]
  );
  const allGroups = useMemo(
    () =>
      entries.flatMap(({ entry }) =>
        entry.groups.map((group) => ({
          entryId: entry.id,
          groupId: group.id,
          collapsed: group.collapsed
        }))
      ),
    [entries]
  );
  const allGroupsHaveExpanded = allGroups.some(
    ({ collapsed }) => !collapsed
  );
  const allGroupsActionLabel = allGroupsHaveExpanded
    ? "收起所有仓库分组"
    : "展开所有仓库分组";

  const toggleChangedRepositoriesOnly = () => {
    const next = !showChangedRepositoriesOnly;
    setChangedRepositoriesPreference({
      key: changedRepositoriesPreferenceKey,
      enabled: next
    });
    writeChangedRepositoriesOnlyPreference(
      getRendererPreferenceStorage(),
      workspaceId,
      activeEntryId,
      next
    );
  };
  const orderedGroups = (
    entryId: string,
    groups: VisibleEntry["groups"]
  ): VisibleEntry["groups"] => {
    const savedOrder = groupOrderByEntry[entryId];
    if (!savedOrder) {
      return groups;
    }

    const used = new Set<string>();
    const savedGroups = savedOrder.flatMap((groupId) => {
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
      ...savedGroups,
      ...groups.filter(({ group }) => !used.has(group.id))
    ];
  };

  const handleGroupDragStart = (
    event: DragEvent<HTMLButtonElement>,
    entryId: string,
    groupId: string
  ) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "text/plain",
      `${entryId}:${groupId}`
    );
    suppressGroupClickUntil.current = Date.now() + 800;
    setGroupDragState({ entryId, groupId });
  };

  const handleGroupDragOver = (
    event: DragEvent<HTMLButtonElement>,
    entryId: string,
    groupId: string
  ) => {
    if (
      !groupDragState ||
      groupDragState.entryId !== entryId ||
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
      current &&
      current.entryId === entryId &&
      current.groupId !== groupId
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
    entryId: string,
    groupId: string
  ) => {
    event.preventDefault();
    const drag = groupDragState;
    if (
      !drag ||
      drag.entryId !== entryId ||
      drag.groupId === groupId
    ) {
      setGroupDragState(null);
      return;
    }

    const entry = workspace?.entries.find(
      ({ id }) => id === entryId
    );
    if (!entry) {
      setGroupDragState(null);
      return;
    }

    const currentOrder =
      groupOrderByEntry[entryId] ??
      entry.groups.map(({ id }) => id);
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
    setGroupOrderByEntry((current) => ({
      ...current,
      [entryId]: nextOrder
    }));
    setGroupDragState(null);
  };

  const handleGroupDragEnd = () => {
    setGroupDragState(null);
  };

  const toggleAllGroups = async () => {
    if (!allGroups.length || bulkCollapsing) {
      return;
    }

    const nextCollapsed = allGroupsHaveExpanded;
    setBulkCollapsing(true);
    try {
      for (const group of allGroups) {
        if (group.collapsed !== nextCollapsed) {
          await onSetGroupCollapsed(
            group.entryId,
            group.groupId,
            nextCollapsed
          );
        }
      }
    } finally {
      setBulkCollapsing(false);
    }
  };

  const toggleEntry = (entryId: string) => {
    onSelectEntry(entryId);
    setCollapsedEntryIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };

  const contextEntry = workspace?.entries.find(
    (entry) => entry.id === contextMenu?.entryId
  );
  const contextGroup =
    contextEntry && contextMenu?.groupId
      ? contextEntry.groups.find(
          (group) => group.id === contextMenu.groupId
        )
      : undefined;
  const contextGroupCanBeDeleted =
    contextGroup?.targets.length === 0;
  const renameEntry = workspace?.entries.find(
    (entry) => entry.id === renameEntryId
  );
  const removeEntry = workspace?.entries.find(
    (entry) => entry.id === removeEntryId
  );
  const removeTargetDetails =
    removeTarget && workspace
      ? resolveWorkspaceTarget(workspace, removeTarget)
      : null;
  const removeTargetName =
    removeTargetDetails?.worktree?.name ??
    removeTargetDetails?.repository?.name;
  const removeTargetPath = removeTargetDetails?.worktree?.path;
  const tapdKeywordEntry = workspace?.entries.find(
    (entry) => entry.id === tapdKeyword?.entryId
  );

  useEffect(() => {
    setChangedRepositoriesPreference({
      key: changedRepositoriesPreferenceKey,
      enabled: readChangedRepositoriesOnlyPreference(
        getRendererPreferenceStorage(),
        workspaceId,
        activeEntryId
      )
    });
  }, [
    activeEntryId,
    changedRepositoriesPreferenceKey,
    workspaceId
  ]);

  useEffect(() => {
    if (
      contextMenu &&
      (!workspace?.entries.some(
        (entry) => entry.id === contextMenu.entryId
      ) ||
        (contextMenu.groupId && !contextGroup))
    ) {
      setContextMenu(null);
    }
  }, [contextGroup, contextMenu, workspace]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeFromOutside = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        contextMenuRef.current?.contains(target)
      ) {
        return;
      }
      setContextMenu(null);
    };
    const closeFromKeyboard = (event: globalThis.KeyboardEvent) => {
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
    if (!workspaceSwitcherOpen) {
      return;
    }

    const closeFromOutside = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (workspaceSwitcherRef.current?.contains(target) ||
          workspaceSwitcherMenuRef.current?.contains(target))
      ) {
        return;
      }
      setWorkspaceSwitcherOpen(false);
    };
    const closeFromKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setWorkspaceSwitcherOpen(false);
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
  }, [workspaceSwitcherOpen]);

  useEffect(() => {
    if (!repositoryMenuOpen) {
      return;
    }

    const closeFromOutside = (event: globalThis.PointerEvent) => {
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
    const closeFromKeyboard = (event: globalThis.KeyboardEvent) => {
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
      setWorkspaceSwitcherOpen(false);
      setRepositoryMenuOpen(false);
    }
  }, [sidebarHidden]);

  const openContextMenu = (
    event: MouseEvent<HTMLButtonElement>,
    entryId: string,
    targetName?: string,
    target?: RepositoryTargetDto
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 222;
    const menuHeight =
      target || workspace?.entries.find((entry) => entry.id === entryId)
        ?.kind !== "workspace-meta-repository"
        ? 136
        : 176;
    const position = getWorkspaceContextMenuPosition(
      event.clientX,
      event.clientY,
      menuWidth,
      menuHeight
    );
    setContextMenu({
      entryId,
      ...(targetName ? { targetName } : {}),
      ...(target ? { target } : {}),
      ...position
    });
  };

  const openGroupContextMenu = (
    event: MouseEvent<HTMLButtonElement>,
    entryId: string,
    group: RepositoryGroupDto
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 222;
    const menuHeight = 104;
    const position = getWorkspaceContextMenuPosition(
      event.clientX,
      event.clientY,
      menuWidth,
      menuHeight
    );
    setContextMenu({
      entryId,
      groupId: group.id,
      ...position
    });
  };

  const startRename = () => {
    if (!contextEntry || contextGroup) {
      return;
    }
    setContextMenu(null);
    setRenameSubmitting(false);
    setRenameEntryId(contextEntry.id);
  };

  const startTapdKeyword = () => {
    if (
      !contextEntry ||
      contextGroup ||
      contextMenu?.target ||
      contextEntry.kind !== "workspace-meta-repository" ||
      !workspaceId
    ) {
      return;
    }

    setContextMenu(null);
    setTapdKeywordSubmitting(false);
    setTapdKeyword({
      entryId: contextEntry.id,
      keyword: readTapdKeywordPreference(
        getRendererPreferenceStorage(),
        workspaceId,
        contextEntry.id
      )
    });
  };

  const confirmTapdKeyword = async (
    keyword: string
  ): Promise<boolean> => {
    if (!tapdKeyword || !workspaceId) {
      return false;
    }

    setTapdKeywordSubmitting(true);
    try {
      writeTapdKeywordPreference(
        getRendererPreferenceStorage(),
        workspaceId,
        tapdKeyword.entryId,
        keyword
      );
      return true;
    } finally {
      setTapdKeywordSubmitting(false);
    }
  };

  const startGroupRename = () => {
    if (!contextEntry || !contextGroup) {
      return;
    }

    setContextMenu(null);
    setRenameGroup({
      entryId: contextEntry.id,
      groupId: contextGroup.id,
      automaticName: contextGroup.name,
      displayName:
        groupNameOverrides[
          groupNameKey(contextEntry.id, contextGroup.id)
        ] ?? contextGroup.name
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
      [groupNameKey(renameGroup.entryId, renameGroup.groupId)]:
        displayName
    }));
    return true;
  };

  const removeContextGroup = () => {
    if (
      !contextEntry ||
      !contextGroup ||
      contextGroup.targets.length > 0
    ) {
      return;
    }

    const key = groupNameKey(
      contextEntry.id,
      contextGroup.id
    );
    setRemovedEmptyGroupKeys((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
    setGroupNameOverrides((current) => {
      if (!(key in current)) {
        return current;
      }

      const next = { ...current };
      delete next[key];
      return next;
    });
    setGroupOrderByEntry((current) => {
      const order = current[contextEntry.id];
      if (!order?.includes(contextGroup.id)) {
        return current;
      }

      const nextOrder = order.filter(
        (groupId) => groupId !== contextGroup.id
      );
      if (nextOrder.length > 0) {
        return {
          ...current,
          [contextEntry.id]: nextOrder
        };
      }

      const {
        [contextEntry.id]: _removedOrder,
        ...remainingOrders
      } = current;
      return remainingOrders;
    });
    setContextMenu(null);
  };

  const startRemove = () => {
    if (!contextEntry) {
      return;
    }
    setContextMenu(null);
    setRemoveSubmitting(false);
    setRemoveTarget(contextMenu?.target ?? null);
    setRemoveEntryId(contextEntry.id);
  };

  const confirmRename = async (
    displayName: string
  ): Promise<boolean> => {
    if (!renameEntry || renameSubmitting) {
      return false;
    }
    setRenameSubmitting(true);
    try {
      return await onUpdateEntry({
        entryId: renameEntry.id,
        displayName
      });
    } finally {
      setRenameSubmitting(false);
    }
  };

  const confirmRemove = async (): Promise<boolean> => {
    if (!removeEntry || removeSubmitting) {
      return false;
    }
    setRemoveSubmitting(true);
    try {
      return await onRemoveEntry(
        removeEntry.id,
        removeTarget ?? undefined
      );
    } finally {
      setRemoveSubmitting(false);
    }
  };

  return (
    <aside className="workspace-sidebar">
      <div
        className="workspace-switcher-wrap"
        ref={workspaceSwitcherRef}
      >
        <Button variant="unstyled"
          aria-expanded={workspaceSwitcherOpen}
          aria-haspopup="menu"
          aria-label="切换 Workspace"
          className="workspace-switcher"
          onClick={() =>
            setWorkspaceSwitcherOpen((current) => !current)
          }
          ref={workspaceSwitcherTriggerRef}
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
                "1 个 Workspace · 本地持久化"
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
        {workspaceSwitcherOpen && (
          <MenuPopover
            align="start"
            anchor={workspaceSwitcherTriggerRef.current}
            aria-label="切换 Workspace"
            className="workspace-switcher-menu"
            ref={workspaceSwitcherMenuRef}
            side="bottom"
          >
            <MenuHeading>Workspace</MenuHeading>
            {workspace?.entries.map((entry) => (
              <MenuItem
                key={entry.id}
                leading={
                  <Icon
                    name={
                      entry.kind === "standalone-repository"
                        ? "repository"
                        : "folder"
                    }
                    size={15}
                  />
                }
                onClick={() => {
                  setWorkspaceSwitcherOpen(false);
                  void onSelectEntry(entry.id);
                }}
              >
                {entry.displayName}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem
              leading={<Icon name="plus" size={15} />}
              onClick={() => {
                setWorkspaceSwitcherOpen(false);
                onAddDirectory();
              }}
            >
              新建 Workspace
            </MenuItem>
          </MenuPopover>
        )}
      </div>

      <div className="sidebar-search-wrap">
        <div className="sidebar-search-field">
          <span className="sidebar-search-icon">
            <Icon name="search" size={15} />
          </span>
          <Input
            appearance="unstyled"
            aria-label="筛选仓库"
            autoComplete="off"
            className={query ? "has-value" : undefined}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="筛选仓库…"
            spellCheck={false}
            type="search"
            value={query}
          />
          {query && (
            <Button variant="unstyled"
              aria-label="清除仓库筛选"
              className="sidebar-search-clear"
              onClick={() => setQuery("")}
              title="清除筛选"
              type="button"
            >
              <Icon name="close" size={14} />
            </Button>
          )}
        </div>
        <div
          className="sidebar-repository-menu-wrap"
          ref={repositoryMenuRef}
        >
          <Button variant="unstyled"
            aria-expanded={repositoryMenuOpen}
            aria-haspopup="menu"
            aria-label="仓库筛选菜单"
            className="sidebar-repository-menu-trigger"
            onClick={() => setRepositoryMenuOpen((open) => !open)}
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
              {allGroups.length > 0 && (
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
        {entries.length > 0 && workspace ? (
          entries.map(({ entry, groups }) => (
            <section
              className={`workspace-root${
                workspace.selectedEntryId === entry.id
                  ? " selected"
                  : ""
              }${
                collapsedEntryIds.has(entry.id)
                  ? " collapsed"
                  : ""
              }`}
              key={entry.id}
            >
              <Button variant="unstyled"
                aria-current={
                  workspace.selectedEntryId === entry.id
                    ? "true"
                    : undefined
                }
                aria-controls={`workspace-root-body-${entry.id}`}
                aria-expanded={!collapsedEntryIds.has(entry.id)}
                aria-haspopup="menu"
                className="workspace-root-heading"
                onClick={() => toggleEntry(entry.id)}
                onContextMenu={(event) =>
                  openContextMenu(event, entry.id)
                }
                type="button"
              >
                <span className="workspace-root-icon">
                  <Icon
                    name={
                      entry.kind === "standalone-repository"
                        ? "repository"
                        : "folder"
                    }
                    size={15}
                  />
                </span>
                <span className="workspace-root-copy">
                  <strong>{entry.displayName}</strong>
                  {entry.kind !== "workspace-meta-repository" &&
                  entry.kind !== "standalone-repository" && (
                    <span>{WORKSPACE_ENTRY_LABELS[entry.kind]}</span>
                  )}
                  <small title={entry.path}>{entry.path}</small>
                </span>
                <span
                  aria-hidden="true"
                  className="workspace-root-toggle"
                >
                  <Icon
                    name={
                      collapsedEntryIds.has(entry.id)
                        ? "collapse"
                        : "chevron"
                    }
                    size={14}
                  />
                </span>
                {entry.scanIssues.length > 0 && (
                  <span
                    className="root-issue-count"
                    title={`${entry.scanIssues.length} 个局部扫描问题`}
                  >
                    {entry.scanIssues.length}
                  </span>
                )}
              </Button>

              <div
                aria-hidden={collapsedEntryIds.has(entry.id)}
                className={`workspace-root-body${
                  collapsedEntryIds.has(entry.id)
                    ? " collapsed"
                    : ""
                }`}
                id={`workspace-root-body-${entry.id}`}
                inert={collapsedEntryIds.has(entry.id)}
              >
                <div className="workspace-root-body-inner">
                  {orderedGroups(entry.id, groups).map(
                    ({ group, targets }) => (
                    <div
                      className={`repository-group${
                        group.collapsed ? " collapsed" : ""
                      }`}
                      key={group.id}
                  >
                  <Button variant="unstyled"
                    aria-expanded={!group.collapsed}
                    className={`group-header${
                      groupDragState?.entryId === entry.id &&
                      groupDragState.groupId === group.id
                        ? " dragging"
                        : ""
                    }${
                      groupDragState?.entryId === entry.id &&
                      groupDragState.overGroupId === group.id &&
                      groupDragState.position === "before"
                        ? " drag-over-before"
                        : ""
                    }${
                      groupDragState?.entryId === entry.id &&
                      groupDragState.overGroupId === group.id &&
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
                        entry.id,
                        group.id,
                        !group.collapsed
                      );
                    }}
                    onDragEnd={handleGroupDragEnd}
                    onDragOver={(event) =>
                      handleGroupDragOver(
                        event,
                        entry.id,
                        group.id
                      )
                    }
                    onDragStart={(event) =>
                      handleGroupDragStart(
                        event,
                        entry.id,
                        group.id
                      )
                    }
                    onDrop={(event) =>
                      handleGroupDrop(
                        event,
                        entry.id,
                        group.id
                      )
                    }
                    onContextMenu={(event) =>
                      openGroupContextMenu(
                        event,
                        entry.id,
                        group
                      )
                    }
                    type="button"
                  >
                    <Icon
                      className="group-chevron"
                      name="collapse"
                      size={13}
                    />
                    <span>
                      {getGroupDisplayName(
                        groupNameOverrides,
                        entry.id,
                        group
                      )}
                    </span>
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
                        targets.map((target) => {
                          const resolved = resolveWorkspaceTarget(
                            workspace,
                            target
                          );
                          const name =
                            resolved.worktree?.name ??
                            resolved.repository?.name ??
                            "未知仓库";
                          const snapshot = findTargetSnapshot(
                            snapshots,
                            target
                          );
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
                          const status =
                            snapshotStatus(snapshot);

                          return (
                            <Button variant="unstyled"
                              aria-current={
                                selected ? "true" : undefined
                              }
                              aria-haspopup="menu"
                              className={`repository-row${
                                selected ? " selected" : ""
                              }`}
                              key={`${target.repositoryId}:${target.worktreeId}`}
                              onClick={() => onSelectTarget(target)}
                              onContextMenu={(event) =>
                                openContextMenu(
                                  event,
                                  entry.id,
                                  name,
                                  target
                                )
                              }
                              title={resolved.worktree?.path}
                              type="button"
                            >
                              <span
                                className={`repository-state ${tone}`}
                              >
                                <Icon name="repository" size={13} />
                              </span>
                              <span
                                className="repository-row-main"
                              >
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
                        })
                      )}
                    </div>
                  )}
                </div>
                    )
                  )}
                </div>
              </div>
            </section>
          ))
        ) : (
          <SidebarEmpty
            busy={busy}
            hasEntries={Boolean(workspace?.entries.length)}
            onClearQuery={() => setQuery("")}
            query={normalizedQuery}
          />
        )}
      </nav>

      <div className="sidebar-footer">
        <Button variant="unstyled"
          className="sidebar-add-directory"
          disabled={busy}
          onClick={onAddDirectory}
          type="button"
        >
          <Icon
            name="plus"
            size={14}
          />
          添加目录
        </Button>
        <Button variant="unstyled"
          aria-busy={busy}
          aria-label="重新扫描 Workspace"
          className="icon-button"
          disabled={busy}
          onClick={() => void onRescan()}
          title="重新扫描 Workspace"
          type="button"
        >
          <Icon name="refresh" size={14} />
        </Button>
      </div>
      {contextMenu && contextEntry && (
        <LayerPortal>
          <Menu
            aria-label={`${contextGroup ? getGroupDisplayName(groupNameOverrides, contextEntry.id, contextGroup) : contextMenu.targetName ?? contextEntry.displayName} 操作`}
            className="workspace-context-menu"
            ref={contextMenuRef}
            style={{
              left: contextMenu.x,
              top: contextMenu.y
            }}
          >
            {contextGroup ? (
              <>
                  <MenuItem
                    leading={<Icon name="tag" size={14} />}
                  onClick={startGroupRename}
                >
                  重命名分组
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  disabled={!contextGroupCanBeDeleted}
                  leading={<Icon name="warning" size={14} />}
                  onClick={removeContextGroup}
                  title={
                    contextGroupCanBeDeleted
                      ? "删除空分组"
                      : "分组中仍有仓库，无法删除"
                  }
                  tone="danger"
                >
                  删除分组
                </MenuItem>
              </>
            ) : (
              <>
                <MenuItem
                  leading={<Icon name="settings" size={14} />}
                  onClick={startRename}
                >
                  修改显示名称
                </MenuItem>
                {!contextMenu.target &&
                  contextEntry.kind === "workspace-meta-repository" && (
                    <MenuItem
                      leading={<Icon name="tag" size={14} />}
                      onClick={startTapdKeyword}
                    >
                      设置 TAPD 关键字
                    </MenuItem>
                  )}
                <MenuItem
                  disabled={busy}
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
                  disabled={busy}
                  leading={<Icon name="warning" size={14} />}
                  onClick={startRemove}
                  tone="danger"
                >
                  移出 Workspace
                </MenuItem>
              </>
            )}
          </Menu>
        </LayerPortal>
      )}
      {renameGroup && (
        <WorkspaceGroupRenameDialog
          automaticName={renameGroup.automaticName}
          busy={false}
          displayName={renameGroup.displayName}
          onCancel={() => setRenameGroup(null)}
          onConfirm={confirmGroupRename}
        />
      )}
      {renameEntry && (
        <WorkspaceEntryRenameDialog
          busy={renameSubmitting || busy}
          entry={renameEntry}
          onCancel={() => setRenameEntryId(null)}
          onConfirm={confirmRename}
        />
      )}
      {tapdKeyword && tapdKeywordEntry && (
        <WorkspaceEntryTapdKeywordDialog
          busy={tapdKeywordSubmitting}
          entry={tapdKeywordEntry}
          initialKeyword={tapdKeyword.keyword}
          onCancel={() => setTapdKeyword(null)}
          onConfirm={confirmTapdKeyword}
        />
      )}
      {removeEntry && (
        <WorkspaceEntryRemoveDialog
          busy={removeSubmitting || busy}
          entry={removeEntry}
          {...(removeTargetName
            ? { targetName: removeTargetName }
            : {})}
          {...(removeTargetPath
            ? { targetPath: removeTargetPath }
            : {})}
          onCancel={() => {
            setRemoveEntryId(null);
            setRemoveTarget(null);
          }}
          onConfirm={confirmRemove}
        />
      )}
    </aside>
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

function getVisibleEntries(
  workspace: WorkspaceDetailsDto | null,
  snapshots: RepositoryStatusSnapshotDto[],
  query: string,
  activeEntryId?: string,
  groupNameOverrides: Record<string, string> = {},
  showChangedRepositoriesOnly = false,
  removedEmptyGroupKeys: ReadonlySet<string> = new Set()
): VisibleEntry[] {
  if (!workspace) {
    return [];
  }

  return workspace.entries
    .filter(
      (entry) => !activeEntryId || entry.id === activeEntryId
    )
    .map((entry) => {
      const entryMatches =
        !query ||
        entry.displayName.toLocaleLowerCase().includes(query) ||
        entry.path.toLocaleLowerCase().includes(query) ||
        WORKSPACE_ENTRY_LABELS[entry.kind]
          .toLocaleLowerCase()
          .includes(query);
      const groups = entry.groups
        .map((group) => ({
          group,
          targets: group.targets.filter((target) => {
            if (
              showChangedRepositoriesOnly &&
              !targetHasLocalChanges(snapshots, target)
            ) {
              return false;
            }

            if (entryMatches) {
              return true;
            }

            const resolved = resolveWorkspaceTarget(
              workspace,
              target
            );
            return [
              getGroupDisplayName(
                groupNameOverrides,
                entry.id,
                group
              ),
              resolved.repository?.name,
              resolved.worktree?.name,
              resolved.worktree?.path,
              resolved.worktree?.branch
            ]
              .filter(Boolean)
              .some((value) =>
                String(value).toLocaleLowerCase().includes(query)
              );
          })
        }))
        .filter(
          ({ group, targets }) =>
            !removedEmptyGroupKeys.has(
              groupNameKey(entry.id, group.id)
            ) &&
            (targets.length > 0 ||
              (!query &&
                !showChangedRepositoriesOnly &&
                group.targets.length === 0))
        );

      return {
        entry,
        groups
      };
    })
    .filter(
      ({ entry, groups }) =>
        showChangedRepositoriesOnly
          ? groups.length > 0
          : !query ||
            entry.displayName
              .toLocaleLowerCase()
              .includes(query) ||
            entry.path.toLocaleLowerCase().includes(query) ||
            WORKSPACE_ENTRY_LABELS[entry.kind]
              .toLocaleLowerCase()
              .includes(query) ||
            groups.length > 0
    );
}

function targetHasLocalChanges(
  snapshots: RepositoryStatusSnapshotDto[],
  target: RepositoryTargetDto
): boolean {
  const snapshot = findTargetSnapshot(snapshots, target);
  return Boolean(snapshot?.conflicted) ||
    getSnapshotChangeCount(snapshot) > 0;
}

function groupNameKey(entryId: string, groupId: string): string {
  return `${entryId}:${groupId}`;
}

function getGroupDisplayName(
  overrides: Record<string, string>,
  entryId: string,
  group: RepositoryGroupDto
): string {
  return (
    overrides[groupNameKey(entryId, group.id)] ??
    group.name
  );
}

function SidebarEmpty({
  busy,
  hasEntries,
  query,
  onClearQuery
}: {
  busy: boolean;
  hasEntries: boolean;
  query: string;
  onClearQuery(): void;
}) {
  return (
    <SkeletonBoundary
      fallback={<SidebarSkeleton />}
      hasContent={hasEntries}
      label="正在读取 Workspace 仓库"
      loading={busy}
      surfaceClassName="sidebar-skeleton"
    >
      {query ? (
        <div className="sidebar-empty">
          <span>当前筛选条件没有匹配的仓库。</span>
          <Button size="small"
            onClick={onClearQuery}
            type="button"
          >
            清除筛选
          </Button>
        </div>
      ) : (
        <div className="sidebar-empty">
          尚未添加目录。可通过选择器、手动路径或拖拽开始。
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
