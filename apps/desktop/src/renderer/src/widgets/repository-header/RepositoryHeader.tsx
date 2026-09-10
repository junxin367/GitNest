import { Button } from "../../shared/ui/Button";
import { useEffect, useState } from "react";

import type {
  RepositoryCommandDto,
  RepositoryStatusSnapshotDto,
  WorkspaceDetailsDto
} from "@gitnest/contracts";

import type {
  AppView,
  RepositoryTab,
  WorkspaceTab
} from "../../app/navigation";
import {
  findTargetSnapshot,
  getSnapshotChangeCount,
  resolveWorkspaceTarget
} from "../../entities/workspace/model";
import { useRepositoryBranchOptions } from "../../entities/repository/useRepositoryBranchOptions";
import type { ExternalApplicationController } from "../../features/external-application/useExternalApplications";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { Toast, ToastViewport } from "../../shared/ui/Toast";
import { BranchSwitchDialog } from "./BranchSwitchDialog";
import { OpenInControl } from "./OpenInControl";

interface RepositoryHeaderProps {
  inspectorOpen: boolean;
  refreshing: boolean;
  showPushActions?: boolean;
  view: AppView;
  repositoryTab: RepositoryTab;
  workspaceTab: WorkspaceTab;
  workspace: WorkspaceDetailsDto | null;
  snapshots: RepositoryStatusSnapshotDto[];
  externalApplications: ExternalApplicationController;
  commandActive: RepositoryCommandDto["type"] | null;
  commandCompletionVersion: number;
  commandLocked: boolean;
  workspaceCommandBusy: boolean;
  workspaceFetchCount: number;
  workspacePullCount: number;
  onRefresh(): void;
  onFetch(): void;
  onFetchWorkspace(): void;
  onPull(): void;
  onPullWorkspace(): void;
  onPush(): void;
  onForcePush(): void;
  onSwitchBranch(branch: string): void;
  onOpenWorkspace(): void;
  onOpenRepository(): void;
  onOpenOperations(): void;
  onOpenSettings(): void;
  onRepositoryTabChange(tab: RepositoryTab): void;
  onWorkspaceTabChange(tab: WorkspaceTab): void;
  onToggleInspector(): void;
}

const workspaceTabs: Array<{
  id: WorkspaceTab;
  label: string;
  icon: IconName;
}> = [
  { id: "overview", label: "概览", icon: "grid" },
  { id: "repositories", label: "仓库", icon: "repository" },
  { id: "activity", label: "活动", icon: "history" },
  { id: "worktrees", label: "Worktrees", icon: "worktree" }
];

const repositoryTabs: Array<{
  id: RepositoryTab;
  label: string;
  icon: IconName;
}> = [
  { id: "overview", label: "概览", icon: "grid" },
  { id: "changes", label: "变更", icon: "fileCode" },
  { id: "history", label: "历史", icon: "history" },
  { id: "branches", label: "分支", icon: "branch" },
  { id: "worktrees", label: "Worktrees", icon: "worktree" }
];

export function RepositoryHeader({
  inspectorOpen,
  refreshing,
  showPushActions = true,
  view,
  repositoryTab,
  workspaceTab,
  workspace,
  snapshots,
  externalApplications,
  commandActive,
  commandCompletionVersion,
  commandLocked,
  workspaceCommandBusy,
  workspaceFetchCount,
  workspacePullCount,
  onRefresh,
  onFetch,
  onFetchWorkspace,
  onPull,
  onPullWorkspace,
  onPush,
  onForcePush,
  onSwitchBranch,
  onOpenWorkspace,
  onOpenRepository,
  onOpenOperations,
  onOpenSettings,
  onRepositoryTabChange,
  onWorkspaceTabChange,
  onToggleInspector
}: RepositoryHeaderProps) {
  const [branchDialogOpen, setBranchDialogOpen] =
    useState(false);
  const selected = workspace?.selectedTarget
    ? resolveWorkspaceTarget(workspace, workspace.selectedTarget)
    : undefined;
  const snapshot = findTargetSnapshot(
    snapshots,
    workspace?.selectedTarget
  );
  const repositoryName =
    selected?.worktree?.name ??
    selected?.repository?.name ??
    "当前仓库";
  const workspaceRootPath =
    workspace?.entries.find(
      (entry) => entry.kind === "workspace-meta-repository"
    )?.path ??
    workspace?.entries[0]?.path ??
    "Workspace 根目录不可用";
  const selectedWorkspaceEntry =
    workspace?.entries.find(
      (entry) => entry.id === workspace.selectedEntryId
    ) ?? workspace?.entries[0];
  const workspaceContextName =
    selectedWorkspaceEntry?.displayName ??
    workspace?.name ??
    "GitNest Workspace";
  const workspaceContextPath =
    selectedWorkspaceEntry?.path ?? workspaceRootPath;
  const contextName =
    view === "repository"
      ? repositoryName
      : view === "operations"
        ? "操作中心"
        : view === "settings"
          ? "设置"
          : workspaceContextName;
  const contextPath =
    view === "repository"
      ? selected?.worktree?.path ?? "工作目录不可用"
      : view === "operations"
        ? "后台任务、批量同步与错误恢复"
        : view === "settings"
          ? "账号、安全凭据与外部工具"
          : workspaceContextPath;
  const contextIcon =
    view === "repository"
      ? "repository"
      : view === "operations"
        ? "operations"
        : view === "settings"
          ? "settings"
          : "grid";
  const branchOptions = useRepositoryBranchOptions(
    workspace?.selectedTarget,
    view === "repository"
  );
  const currentBranch =
    snapshot?.branch ?? selected?.worktree?.branch ?? "";
  const localBranches = [...branchOptions.branches].sort(
    (left, right) => {
      if (left.name === currentBranch) {
        return -1;
      }
      if (right.name === currentBranch) {
        return 1;
      }
      return left.name.localeCompare(right.name);
    }
  );
  const repositoryCommandDisabled =
    view !== "repository" ||
    !workspace?.selectedTarget ||
    commandLocked;
  const repositoryTabCounts: Partial<
    Record<RepositoryTab, number>
  > = {
    changes: getSnapshotChangeCount(snapshot),
    history: snapshot?.head ? 1 : 0,
    branches: branchOptions.branches.length,
    worktrees: selected?.repository?.worktreeIds.length ?? 0
  };
  const workspaceTabCounts: Partial<
    Record<WorkspaceTab, number>
  > = {
    repositories: workspace?.repositories.length ?? 0,
    activity: workspace?.repositories.length ?? 0,
    worktrees: workspace?.worktrees.length ?? 0
  };

  useEffect(() => {
    if (
      commandCompletionVersion > 0 &&
      view === "repository"
    ) {
      void branchOptions.reload();
    }
  }, [
    branchOptions.reload,
    commandCompletionVersion,
    view
  ]);

  return (
    <>
      <header className="repository-header">
        <div className="context-summary">
          <span className="context-icon">
            <Icon
              name={contextIcon}
              size={18}
            />
          </span>
          <div>
            <strong>
              {contextName ?? "GitNest Workspace"}
            </strong>
            <span title={contextPath}>
              <Icon name="folder" size={12} />
              <span>{contextPath}</span>
            </span>
          </div>
        </div>

        {view === "workspace" && (
          <div aria-hidden="true" className="toolbar-divider" />
        )}

        {view === "repository" && workspace?.selectedTarget && (
          <>
            <div aria-hidden="true" className="toolbar-divider" />
            <Button variant="unstyled"
              aria-label="切换分支"
              aria-expanded={branchDialogOpen}
              aria-haspopup="dialog"
              className="header-branch-switcher"
              disabled={repositoryCommandDisabled}
              onClick={() => {
                setBranchDialogOpen(true);
                void branchOptions.reload();
              }}
              title="打开切换分支弹窗"
              type="button"
            >
              <Icon name="branch" size={12} />
              <span>{currentBranch || "detached"}</span>
              <Icon name="chevron" size={12} />
            </Button>
          </>
        )}

        {(view === "workspace" ||
          (view === "repository" &&
            Boolean(workspace?.selectedTarget))) && (
          <OpenInControl
            applications={externalApplications}
            scope={
              view === "workspace"
                ? "workspace"
                : "repository"
            }
          />
        )}

        <div className="repository-actions">
          <Button variant="unstyled"
            aria-busy={refreshing}
            className="toolbar-button"
            disabled={refreshing || !workspace?.entries.length}
            onClick={onRefresh}
            title="重扫 Workspace 并刷新仓库状态"
            type="button"
          >
            <Icon name="refresh" />
            <span>{refreshing ? "刷新中" : "刷新"}</span>
          </Button>
          {view === "workspace" && (
            <>
              <Button variant="unstyled"
                aria-busy={commandActive === "pull"}
                className="toolbar-button"
                disabled={
                  workspaceCommandBusy ||
                  workspacePullCount === 0
                }
                onClick={onPullWorkspace}
                title={`批量 Pull ${workspacePullCount} 个可安全快进的仓库`}
                type="button"
              >
                <Icon name="arrowDown" />
                <span>
                  {commandActive === "pull"
                    ? "预检中"
                    : "Pull"}
                </span>
                {workspacePullCount > 0 ? (
                  <span className="toolbar-count">
                    {workspacePullCount}
                  </span>
                ) : null}
              </Button>
              <Button variant="unstyled"
                aria-busy={commandActive === "fetch"}
                className="toolbar-button"
                disabled={
                  workspaceCommandBusy ||
                  workspaceFetchCount === 0
                }
                onClick={onFetchWorkspace}
                title={`Fetch Workspace 中的全部 ${workspaceFetchCount} 个仓库`}
                type="button"
              >
                <Icon name="download" />
                <span>
                  {commandActive === "fetch"
                    ? "预检中"
                    : "Fetch 全部"}
                </span>
              </Button>
            </>
          )}
          {view === "repository" && (
            <>
              <Button variant="unstyled"
                aria-busy={commandActive === "fetch"}
                className="toolbar-button"
                disabled={repositoryCommandDisabled}
                onClick={onFetch}
                title="获取远程引用；不会修改工作目录"
                type="button"
              >
                <Icon name="download" />
                <span>
                  {commandActive === "fetch" ? "预检中" : "Fetch"}
                </span>
              </Button>
              <Button variant="unstyled"
                aria-busy={commandActive === "pull"}
                className="toolbar-button"
                disabled={repositoryCommandDisabled}
                onClick={onPull}
                title="仅允许 fast-forward，不自动 Merge、Rebase 或 Stash"
                type="button"
              >
                <Icon name="arrowDown" />
                <span>
                  {commandActive === "pull" ? "预检中" : "Pull"}
                </span>
                {snapshot?.behind ? (
                  <span className="toolbar-count">
                    {snapshot.behind}
                  </span>
                ) : null}
              </Button>
              {showPushActions ? (
                <>
                  <Button variant="unstyled"
                    aria-busy={commandActive === "push"}
                    className="toolbar-button"
                    disabled={repositoryCommandDisabled}
                    onClick={onPush}
                    title="普通 Push；执行前展示远程与分支影响"
                    type="button"
                  >
                    <Icon name="arrowUp" />
                    <span>
                      {commandActive === "push" ? "预检中" : "Push"}
                    </span>
                    {snapshot?.ahead ? (
                      <span className="toolbar-count">
                        {snapshot.ahead}
                      </span>
                    ) : null}
                  </Button>
                  <Button variant="unstyled"
                    aria-label="Force with lease"
                    className="toolbar-icon-button force-push-button"
                    disabled={repositoryCommandDisabled}
                    onClick={onForcePush}
                    title="Force with lease：独立危险入口，执行前需要再次确认"
                    type="button"
                  >
                    <Icon name="warning" />
                  </Button>
                </>
              ) : null}
            </>
          )}
          <Button variant="unstyled"
            aria-label={
              inspectorOpen ? "折叠详情面板" : "展开详情面板"
            }
            aria-pressed={inspectorOpen}
            className="toolbar-icon-button"
            onClick={onToggleInspector}
            title={
              inspectorOpen ? "折叠详情面板" : "展开详情面板"
            }
            type="button"
          >
            <Icon name="panel" />
          </Button>
        </div>
      </header>

      <nav
        className="context-tabs"
        aria-label={
          view === "repository"
            ? "仓库功能页面"
            : "Workspace 页面"
        }
        role="tablist"
      >
        {view === "repository" ? (
          repositoryTabs.map((tab) => (
            <Button variant="unstyled"
              aria-current={
                repositoryTab === tab.id ? "page" : undefined
              }
              aria-selected={repositoryTab === tab.id}
              className={
                repositoryTab === tab.id ? "active" : ""
              }
              key={tab.id}
              onClick={() => onRepositoryTabChange(tab.id)}
              role="tab"
              type="button"
            >
              <Icon name={tab.icon} />
              {tab.label}
              {repositoryTabCounts[tab.id] ? (
                <span className="tab-count">
                  {repositoryTabCounts[tab.id]}
                </span>
              ) : null}
            </Button>
          ))
        ) : view === "workspace" ? (
          workspaceTabs.map((tab) => (
            <Button variant="unstyled"
              aria-current={
                workspaceTab === tab.id ? "page" : undefined
              }
              aria-selected={workspaceTab === tab.id}
              className={
                workspaceTab === tab.id ? "active" : ""
              }
              key={tab.id}
              onClick={() => onWorkspaceTabChange(tab.id)}
              role="tab"
              type="button"
            >
              <Icon name={tab.icon} />
              <span>{tab.label}</span>
              {workspaceTabCounts[tab.id] ? (
                <span className="tab-count">
                  {workspaceTabCounts[tab.id]}
                </span>
              ) : null}
            </Button>
          ))
        ) : (
          <>
            <Button variant="unstyled"
              aria-selected={false}
              onClick={onOpenWorkspace}
              role="tab"
              type="button"
            >
              <Icon name="grid" />
              概览
            </Button>
            <Button variant="unstyled"
              aria-selected={false}
              disabled={!workspace?.selectedTarget}
              onClick={onOpenRepository}
              title={
                workspace?.selectedTarget
                  ? "打开当前仓库"
                  : "请先从 Workspace 选择一个仓库"
              }
              type="button"
              role="tab"
            >
              <Icon name="repository" />
              当前仓库
            </Button>
            <Button variant="unstyled"
              aria-current={
                view === "operations" ? "page" : undefined
              }
              aria-selected={view === "operations"}
              className={
                view === "operations" ? "active" : ""
              }
              onClick={onOpenOperations}
              role="tab"
              type="button"
            >
              <Icon name="operations" />
              操作中心
            </Button>
            <Button variant="unstyled"
              aria-current={
                view === "settings" ? "page" : undefined
              }
              aria-selected={view === "settings"}
              className={view === "settings" ? "active" : ""}
              onClick={onOpenSettings}
              role="tab"
              type="button"
            >
              <Icon name="settings" />
              设置
            </Button>
          </>
        )}
      </nav>
      {branchDialogOpen &&
        view === "repository" &&
        workspace?.selectedTarget && (
          <BranchSwitchDialog
            branches={localBranches}
            currentBranch={currentBranch}
            errorMessage={
              branchOptions.error?.message ?? null
            }
            isDisabled={(branch) =>
              branchOccupiedElsewhere(
                branch.worktreePath,
                selected?.worktree?.path
              )
            }
            loading={branchOptions.loading}
            onCancel={() => setBranchDialogOpen(false)}
            onRetry={() => void branchOptions.reload()}
            onSelect={(branch) => {
              setBranchDialogOpen(false);
              onSwitchBranch(branch);
            }}
            repositoryName={repositoryName}
            repositoryPath={
              selected?.worktree?.path ?? "工作目录不可用"
            }
          />
        )}
      {externalApplications.error && (
        <ToastViewport>
          <Toast
            message={externalApplications.error.message}
            onClose={externalApplications.clearError}
            title="无法打开本地应用"
            tone="error"
          />
        </ToastViewport>
      )}
    </>
  );
}

function branchOccupiedElsewhere(
  branchWorktreePath: string | undefined,
  currentWorktreePath: string | undefined
): boolean {
  if (!branchWorktreePath) {
    return false;
  }
  if (!currentWorktreePath) {
    return true;
  }
  return normalizePath(branchWorktreePath) !==
    normalizePath(currentWorktreePath);
}

function normalizePath(path: string): string {
  return path
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLocaleLowerCase("en-US");
}
