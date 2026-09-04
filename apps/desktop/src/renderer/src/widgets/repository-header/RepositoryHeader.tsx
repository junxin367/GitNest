import {
  useEffect
} from "react";

import type {
  ExternalTerminalKindDto,
  ExternalTerminalProfileDto,
  RepositoryCommandDto,
  RepositoryStatusSnapshotDto,
  WorkspaceDetailsDto
} from "@gitnest/contracts";

import type {
  AppView,
  RepositoryTab
} from "../../app/navigation";
import {
  findTargetSnapshot,
  resolveWorkspaceTarget
} from "../../entities/workspace/model";
import { useRepositoryBranchOptions } from "../../entities/repository/useRepositoryBranchOptions";
import { Icon } from "../../shared/ui/Icon";

interface RepositoryHeaderProps {
  inspectorOpen: boolean;
  refreshing: boolean;
  view: AppView;
  repositoryTab: RepositoryTab;
  workspace: WorkspaceDetailsDto | null;
  snapshots: RepositoryStatusSnapshotDto[];
  commandActive: RepositoryCommandDto["type"] | null;
  commandCompletionVersion: number;
  commandLocked: boolean;
  terminalProfiles: ExternalTerminalProfileDto[];
  terminalLoading: boolean;
  terminalActive: ExternalTerminalKindDto | null;
  onRefresh(): void;
  onFetch(): void;
  onPull(): void;
  onPush(): void;
  onForcePush(): void;
  onOpenTerminal(kind: ExternalTerminalKindDto): void;
  onSwitchBranch(branch: string): void;
  onOpenWorkspace(): void;
  onOpenRepository(): void;
  onOpenOperations(): void;
  onOpenSettings(): void;
  onRepositoryTabChange(tab: RepositoryTab): void;
  onToggleInspector(): void;
}

const repositoryTabs: Array<{
  id: RepositoryTab;
  label: string;
}> = [
  { id: "overview", label: "概览" },
  { id: "changes", label: "变更" },
  { id: "history", label: "历史" },
  { id: "branches", label: "分支" },
  { id: "worktrees", label: "Worktrees" }
];

export function RepositoryHeader({
  inspectorOpen,
  refreshing,
  view,
  repositoryTab,
  workspace,
  snapshots,
  commandActive,
  commandCompletionVersion,
  commandLocked,
  terminalProfiles,
  terminalLoading,
  terminalActive,
  onRefresh,
  onFetch,
  onPull,
  onPush,
  onForcePush,
  onOpenTerminal,
  onSwitchBranch,
  onOpenWorkspace,
  onOpenRepository,
  onOpenOperations,
  onOpenSettings,
  onRepositoryTabChange,
  onToggleInspector
}: RepositoryHeaderProps) {
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
  const workspaceSubtitle = workspace?.entries.length
    ? `${workspace.entries.length} 个顶层条目 · ${workspace.repositories.length} 个仓库`
    : "尚未添加真实目录";
  const contextName =
    view === "repository"
      ? repositoryName
      : view === "operations"
        ? "操作中心"
        : view === "settings"
          ? "设置"
          : workspace?.name;
  const contextPath =
    view === "repository"
      ? selected?.worktree?.path ?? "工作目录不可用"
      : view === "operations"
        ? "后台任务、批量同步与错误恢复"
        : view === "settings"
          ? "账号、安全凭据与外部工具"
          : workspaceSubtitle;
  const contextIcon =
    view === "repository"
      ? "repository"
      : view === "operations"
        ? "operations"
        : view === "settings"
          ? "settings"
          : "layers";
  const openContext =
    view === "repository"
      ? onOpenRepository
      : view === "operations"
        ? onOpenOperations
        : view === "settings"
          ? onOpenSettings
          : onOpenWorkspace;
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
        <button
          className="context-summary context-summary-button"
          onClick={openContext}
          type="button"
        >
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
            <span>
              <Icon name="folder" size={12} />
              {contextPath}
            </span>
          </div>
        </button>

        {view === "repository" && workspace?.selectedTarget && (
          <label
            className="header-branch-switcher"
            title={
              branchOptions.error?.message ??
              "选择本地分支后将先执行安全预检"
            }
          >
            <Icon name="branch" size={12} />
            <select
              aria-label="切换本地分支"
              disabled={
                commandLocked ||
                branchOptions.loading ||
                localBranches.length === 0
              }
              onChange={(event) => {
                const branch = event.target.value;
                if (branch && branch !== currentBranch) {
                  onSwitchBranch(branch);
                }
              }}
              onFocus={() => void branchOptions.reload()}
              value={currentBranch}
            >
              {!localBranches.some(
                (branch) => branch.name === currentBranch
              ) && (
                <option value={currentBranch}>
                  {currentBranch || "detached"}
                </option>
              )}
              {localBranches.map((branch) => (
                <option
                  disabled={branchOccupiedElsewhere(
                    branch.worktreePath,
                    selected?.worktree?.path
                  )}
                  key={branch.fullName}
                  value={branch.name}
                >
                  {branch.name}
                  {branchOccupiedElsewhere(
                    branch.worktreePath,
                    selected?.worktree?.path
                  )
                    ? " · 其他 Worktree"
                    : ""}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="repository-actions">
          <button
            className="toolbar-button"
            disabled={refreshing || !workspace?.entries.length}
            onClick={onRefresh}
            title="重扫 Workspace 并刷新仓库状态"
            type="button"
          >
            <Icon name="refresh" />
            {refreshing ? "刷新中" : "刷新"}
          </button>
          {view === "repository" && (
            <>
          <button
            className="toolbar-button"
            disabled={repositoryCommandDisabled}
            onClick={onFetch}
            title="获取远程引用；不会修改工作目录"
            type="button"
          >
            <Icon name="download" />
            {commandActive === "fetch" ? "预检中" : "Fetch"}
          </button>
          <button
            className="toolbar-button"
            disabled={repositoryCommandDisabled}
            onClick={onPull}
            title="仅允许 fast-forward，不自动 Merge、Rebase 或 Stash"
            type="button"
          >
            <Icon name="download" />
            {commandActive === "pull" ? "预检中" : "Pull"}
          </button>
          <button
            className="toolbar-button"
            disabled={repositoryCommandDisabled}
            onClick={onPush}
            title="普通 Push；执行前展示远程与分支影响"
            type="button"
          >
            <Icon name="upload" />
            {commandActive === "push" ? "预检中" : "Push"}
          </button>
          <button
            aria-label="Force with lease"
            className="toolbar-icon-button force-push-button"
            disabled={repositoryCommandDisabled}
            onClick={onForcePush}
            title="Force with lease：独立危险入口，执行前需要再次确认"
            type="button"
          >
            <Icon name="warning" />
          </button>
          <details className="toolbar-menu terminal-menu">
            <summary
              aria-disabled={
                repositoryCommandDisabled ||
                terminalLoading ||
                terminalProfiles.length === 0
              }
              aria-label="打开外部终端"
              className="toolbar-icon-button"
              onClick={(event) => {
                if (
                  repositoryCommandDisabled ||
                  terminalLoading ||
                  terminalProfiles.length === 0
                ) {
                  event.preventDefault();
                }
              }}
              title={
                terminalProfiles.length > 0
                  ? "在当前 Worktree 打开外部终端"
                  : terminalLoading
                    ? "正在检测外部终端"
                    : "未检测到支持的外部终端"
              }
            >
              <Icon name="terminal" />
            </summary>
            <div className="toolbar-menu-popover">
              <span>打开外部终端</span>
              {terminalProfiles.map((profile) => (
                <button
                  disabled={terminalActive !== null}
                  key={profile.kind}
                  onClick={(event) => {
                    onOpenTerminal(profile.kind);
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                  }}
                  type="button"
                >
                  <Icon name="terminal" size={13} />
                  {terminalActive === profile.kind
                    ? "启动中…"
                    : profile.label}
                </button>
              ))}
            </div>
          </details>
            </>
          )}
          <button
            aria-label="切换详情面板"
            aria-pressed={inspectorOpen}
            className="toolbar-icon-button"
            onClick={onToggleInspector}
            title="切换详情面板"
            type="button"
          >
            <Icon name="panel" />
          </button>
        </div>
      </header>

      <nav
        className="context-tabs"
        aria-label={
          view === "repository"
            ? "仓库功能页面"
            : "Workspace 页面"
        }
      >
        {view === "repository" ? (
          repositoryTabs.map((tab) => (
            <button
              aria-current={
                repositoryTab === tab.id ? "page" : undefined
              }
              className={
                repositoryTab === tab.id ? "active" : ""
              }
              key={tab.id}
              onClick={() => onRepositoryTabChange(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))
        ) : (
          <>
            <button
              aria-current={
                view === "workspace" ? "page" : undefined
              }
              className={view === "workspace" ? "active" : ""}
              onClick={onOpenWorkspace}
              type="button"
            >
              概览
            </button>
            <button
              disabled={!workspace?.selectedTarget}
              onClick={onOpenRepository}
              type="button"
            >
              当前仓库
            </button>
            <button
              aria-current={
                view === "operations" ? "page" : undefined
              }
              className={
                view === "operations" ? "active" : ""
              }
              onClick={onOpenOperations}
              type="button"
            >
              操作中心
            </button>
            <button
              aria-current={
                view === "settings" ? "page" : undefined
              }
              className={view === "settings" ? "active" : ""}
              onClick={onOpenSettings}
              type="button"
            >
              设置
            </button>
            <button disabled type="button">
              搜索
            </button>
          </>
        )}
      </nav>
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
