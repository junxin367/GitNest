import { useMemo, useState } from "react";

import type {
  RepositoryGroupDto,
  RepositoryStatusSnapshotDto,
  RepositoryTargetDto,
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

interface WorkspaceSidebarProps {
  activeView: AppView;
  workspace: WorkspaceDetailsDto | null;
  snapshots: RepositoryStatusSnapshotDto[];
  busy: boolean;
  onAddDirectory(): void;
  onOpenWorkspace(): void;
  onSelectEntry(entryId: string): void;
  onSelectTarget(target: RepositoryTargetDto): void;
  onSetGroupCollapsed(
    entryId: string,
    groupId: string,
    collapsed: boolean
  ): void;
}

interface VisibleEntry {
  entry: WorkspaceEntryDto;
  groups: Array<{
    group: RepositoryGroupDto;
    targets: RepositoryTargetDto[];
  }>;
}

export function WorkspaceSidebar({
  activeView,
  workspace,
  snapshots,
  busy,
  onAddDirectory,
  onOpenWorkspace,
  onSelectEntry,
  onSelectTarget,
  onSetGroupCollapsed
}: WorkspaceSidebarProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const entries = useMemo(
    () => getVisibleEntries(workspace, normalizedQuery),
    [normalizedQuery, workspace]
  );

  return (
    <aside className="workspace-sidebar">
      <div className="workspace-identity">
        <span className="workspace-avatar">
          <Icon name="layers" size={18} />
        </span>
        <span className="workspace-identity-copy">
          <strong>{workspace?.name ?? "GitNest Workspace"}</strong>
          <span>
            {workspace
              ? `${workspace.entries.length} 个顶层条目 · 本地持久化`
              : "正在恢复本地 Workspace…"}
          </span>
        </span>
      </div>

      <button
        aria-current={
          activeView === "workspace" ? "page" : undefined
        }
        className={`workspace-overview-button${
          activeView === "workspace" ? " active" : ""
        }`}
        onClick={onOpenWorkspace}
        type="button"
      >
        <Icon name="grid" />
        <span>Workspace 总览</span>
      </button>

      <div className="sidebar-search-wrap">
        <Icon name="search" size={15} />
        <input
          aria-label="筛选仓库"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="筛选仓库…"
          spellCheck={false}
          type="search"
          value={query}
        />
        {query && (
          <button
            aria-label="清除仓库筛选"
            className="sidebar-search-clear"
            onClick={() => setQuery("")}
            title="清除筛选"
            type="button"
          >
            <Icon name="close" size={14} />
          </button>
        )}
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
              }`}
              key={entry.id}
            >
              <button
                aria-current={
                  workspace.selectedEntryId === entry.id
                    ? "true"
                    : undefined
                }
                className="workspace-root-heading"
                onClick={() => onSelectEntry(entry.id)}
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
                  <span>{WORKSPACE_ENTRY_LABELS[entry.kind]}</span>
                  <small title={entry.path}>{entry.path}</small>
                </span>
                {entry.scanIssues.length > 0 && (
                  <span
                    className="root-issue-count"
                    title={`${entry.scanIssues.length} 个局部扫描问题`}
                  >
                    {entry.scanIssues.length}
                  </span>
                )}
              </button>

              {groups.map(({ group, targets }) => (
                <div
                  className={`repository-group${
                    group.collapsed ? " collapsed" : ""
                  }`}
                  key={group.id}
                >
                  <button
                    aria-expanded={!group.collapsed}
                    className="group-header"
                    onClick={() =>
                      onSetGroupCollapsed(
                        entry.id,
                        group.id,
                        !group.collapsed
                      )
                    }
                    type="button"
                  >
                    <Icon
                      className="group-chevron"
                      name="collapse"
                      size={13}
                    />
                    <span>{group.name}</span>
                    <span className="group-count">
                      {targets.length}
                    </span>
                  </button>
                  {!group.collapsed && (
                    <div className="group-body">
                      {targets.map((target) => {
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
                          repositoryTargetSelected(
                            workspace.selectedTarget,
                            target
                          );

                        return (
                          <button
                            aria-current={
                              selected ? "true" : undefined
                            }
                            className={`repository-row${
                              selected ? " selected" : ""
                            }`}
                            key={`${target.repositoryId}:${target.worktreeId}`}
                            onClick={() => onSelectTarget(target)}
                            title={resolved.worktree?.path}
                            type="button"
                          >
                            <span
                              className={`repository-state ${snapshotTone(snapshot)}`}
                            >
                              <Icon name="repository" size={13} />
                            </span>
                            <span>{name}</span>
                            <span
                              className={`sample-badge ${snapshotTone(snapshot)}`}
                            >
                              {snapshotBadge(
                                snapshot,
                                resolved.worktree?.branch
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
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
        <div>
          <Icon
            name={busy ? "refresh" : "check"}
            size={14}
          />
          {busy
            ? "正在处理 Workspace…"
            : "状态扫描只读 · 配置仅保存在本机"}
        </div>
        <button
          disabled={busy}
          onClick={onAddDirectory}
          type="button"
        >
          <Icon name="plus" size={14} />
          添加目录
        </button>
      </div>
    </aside>
  );
}

function snapshotTone(
  snapshot: RepositoryStatusSnapshotDto | undefined
): "clean" | "idle" | "pending" | "warning" | "danger" {
  if (snapshot?.refreshPending) {
    return "pending";
  }
  if (snapshot?.error || snapshot?.conflicted) {
    return "danger";
  }
  if (!snapshot || snapshot.stale) {
    return "idle";
  }
  if (getSnapshotChangeCount(snapshot) > 0) {
    return "warning";
  }
  return "clean";
}

function snapshotBadge(
  snapshot: RepositoryStatusSnapshotDto | undefined,
  fallbackBranch: string | undefined
): string {
  if (snapshot?.refreshPending) {
    return "刷新中";
  }
  if (snapshot?.error) {
    return "错误";
  }
  if (snapshot?.conflicted) {
    return `${snapshot.conflicted} 冲突`;
  }

  const changes = getSnapshotChangeCount(snapshot);
  if (changes > 0) {
    return `${changes} 变更`;
  }

  return snapshot?.branch ?? fallbackBranch ?? "detached";
}

function getVisibleEntries(
  workspace: WorkspaceDetailsDto | null,
  query: string
): VisibleEntry[] {
  if (!workspace) {
    return [];
  }

  return workspace.entries
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
            if (entryMatches) {
              return true;
            }

            const resolved = resolveWorkspaceTarget(
              workspace,
              target
            );
            return [
              group.name,
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
          ({ targets }) => entryMatches || targets.length > 0
        );

      return {
        entry,
        groups
      };
    })
    .filter(
      ({ entry, groups }) =>
        !query ||
        entry.displayName.toLocaleLowerCase().includes(query) ||
        entry.path.toLocaleLowerCase().includes(query) ||
        WORKSPACE_ENTRY_LABELS[entry.kind]
          .toLocaleLowerCase()
          .includes(query) ||
        groups.length > 0
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
  if (busy && !hasEntries) {
    return (
      <div className="sidebar-empty">
        正在恢复或扫描 Workspace…
      </div>
    );
  }

  if (query) {
    return (
      <div className="sidebar-empty">
        <span>当前筛选条件没有匹配的仓库。</span>
        <button
          className="button"
          onClick={onClearQuery}
          type="button"
        >
          清除筛选
        </button>
      </div>
    );
  }

  return (
    <div className="sidebar-empty">
      尚未添加目录。可通过选择器、手动路径或拖拽开始。
    </div>
  );
}
