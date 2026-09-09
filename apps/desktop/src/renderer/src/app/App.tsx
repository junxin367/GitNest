import {
  useEffect,
  useMemo,
  useState,
  type DragEvent
} from "react";

import type {
  GitEnvironmentDto,
  GitReadErrorDto,
  RepositoryCommitDto,
  RepositoryTargetDto,
  RuntimeInfo
} from "@gitnest/contracts";

import {
  preferredRepositoryTab,
  type AppView,
  type RepositoryTab,
  type WorkspaceTab
} from "./navigation";
import {
  findTargetSnapshot,
  getSnapshotChangeCount,
  listWorkspaceTargets
} from "../entities/workspace/model";
import { useWorkspace } from "../entities/workspace/useWorkspace";
import { useAccounts } from "../features/account-manage/useAccounts";
import { useExternalApplications } from "../features/external-application/useExternalApplications";
import { useExternalTerminals } from "../features/external-terminal/useExternalTerminals";
import { GlobalSearchDialog } from "../features/global-search/GlobalSearchDialog";
import { RepositoryCommandDialog } from "../features/repository-command/RepositoryCommandDialog";
import { useRepositoryCommands } from "../features/repository-command/useRepositoryCommands";
import { RepositoryPage } from "../pages/repository/RepositoryPage";
import { OperationCenterPage } from "../pages/operations/OperationCenterPage";
import { SettingsPage } from "../pages/settings/SettingsPage";
import { WorkspaceCollectionPage } from "../pages/workspace-overview/WorkspaceCollectionPage";
import { WorkspaceOverviewPage } from "../pages/workspace-overview/WorkspaceOverviewPage";
import { Icon } from "../shared/ui/Icon";
import { ActivityRail } from "../widgets/activity-rail/ActivityRail";
import { AppTitlebar } from "../widgets/app-titlebar/AppTitlebar";
import { DetailInspector } from "../widgets/detail-inspector/DetailInspector";
import { RepositoryHeader } from "../widgets/repository-header/RepositoryHeader";
import { repositoryDiffWorkspaceConfiguration } from "../widgets/diff-workspace/diffWorkspaceConfiguration";
import { StatusBar } from "../widgets/status-bar/StatusBar";
import { WorkspaceSidebar } from "../widgets/workspace-sidebar/WorkspaceSidebar";

type Theme = "dark" | "light";

export function App() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(
    null
  );
  const [gitEnvironment, setGitEnvironment] =
    useState<GitEnvironmentDto | null>(null);
  const [gitError, setGitError] =
    useState<GitReadErrorDto | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [view, setView] = useState<AppView>("workspace");
  const [sidebarCollapsed, setSidebarCollapsed] =
    useState(false);
  const [workspaceTab, setWorkspaceTab] =
    useState<WorkspaceTab>("overview");
  const [globalSearchOpen, setGlobalSearchOpen] =
    useState(false);
  const [repositoryTab, setRepositoryTab] =
    useState<RepositoryTab>("overview");
  const [selectedCommit, setSelectedCommit] = useState<
    RepositoryCommitDto["commit"] | null
  >(null);
  const workspace = useWorkspace();
  const repositoryCommands = useRepositoryCommands(
    workspace.workspace?.selectedTarget,
    workspace.operations
  );
  const externalTerminals = useExternalTerminals(
    workspace.workspace?.selectedTarget
  );
  const externalApplications = useExternalApplications(
    view === "workspace"
      ? {
          scope: "workspace"
        }
      : view === "repository" &&
          workspace.workspace?.selectedTarget
        ? {
            scope: "repository",
            target: workspace.workspace.selectedTarget
          }
        : undefined
  );
  const accounts = useAccounts();
  const runtimeRefreshing = workspace.operations.some(
    (operation) =>
      operation.state === "queued" ||
      operation.state === "running" ||
      operation.state === "cancelling"
  );
  const workspaceTargets = useMemo(
    () =>
      workspace.workspace
        ? listWorkspaceTargets(workspace.workspace)
        : [],
    [workspace.workspace]
  );
  const workspacePullTargets = useMemo(
    () =>
      workspaceTargets.filter((target) => {
        const snapshot = findTargetSnapshot(
          workspace.snapshots,
          target
        );
        return Boolean(
          snapshot?.upstream &&
            snapshot.behind > 0 &&
            getSnapshotChangeCount(snapshot) === 0
        );
      }),
    [workspace.snapshots, workspaceTargets]
  );
  const operationAttentionCount = workspace.operations.filter(
    (operation) =>
      operation.state === "queued" ||
      operation.state === "running" ||
      operation.state === "cancelling" ||
      operation.state === "failed" ||
      operation.state === "interrupted"
  ).length;
  const selectedTarget = workspace.workspace?.selectedTarget;
  const selectedTargetKey = selectedTarget
    ? `${selectedTarget.repositoryId}:${selectedTarget.worktreeId}`
    : "";
  const selectedRepositoryBusy = workspace.operations.some(
    (operation) =>
      isRepositoryCommandOperation(operation.kind) &&
      (operation.state === "queued" ||
        operation.state === "running" ||
        operation.state === "cancelling") &&
      operation.targetIds.includes(selectedTargetKey)
  );
  const repositoryCommandLocked =
    repositoryCommands.active !== null ||
    repositoryCommands.preflight !== null ||
    selectedRepositoryBusy;
  const defaultTerminalProfile =
    externalTerminals.profiles[0];
  const fullPageView =
    view === "operations" || view === "settings";
  const inspectorVisible =
    inspectorOpen && !fullPageView;
  const directoryPanelHidden =
    sidebarCollapsed || fullPageView;
  const toggleTheme = () =>
    setTheme((current) =>
      current === "dark" ? "light" : "dark"
    );
  const resetLayout = () => {
    setSidebarCollapsed(false);
    setInspectorOpen(false);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        getComputedStyle(document.documentElement)
          .getPropertyValue("--titlebar")
          .trim()
      );
    try {
      localStorage.setItem("gitnest.theme", theme);
    } catch {
      // Theme persistence is best-effort in restricted environments.
    }
  }, [theme]);

  useEffect(() => {
    if (view !== "repository") {
      setSelectedCommit(null);
    }
  }, [view]);

  useEffect(() => {
    let active = true;

    void window.gitnest.system
      .getRuntimeInfo()
      .then((info) => {
        if (active) {
          setRuntimeInfo(info);
        }
      })
      .catch(() => {
        if (active) {
          setRuntimeInfo(null);
        }
      });

    void window.gitnest.git
      .getEnvironment()
      .then((result) => {
        if (!active) {
          return;
        }

        if (result.ok) {
          setGitEnvironment(result.value);
          setGitError(null);
        } else {
          setGitEnvironment(null);
          setGitError(result.error);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setGitEnvironment(null);
          setGitError({
            code: "COMMAND_FAILED",
            message:
              error instanceof Error
                ? error.message
                : "Unable to read the Git environment.",
            details: {}
          });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      view === "repository" &&
      !workspace.workspace?.selectedTarget
    ) {
      setView("workspace");
    }
  }, [view, workspace.workspace?.selectedTarget]);

  useEffect(() => {
    const handleGlobalSearchShortcut = (
      event: KeyboardEvent
    ) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        !repositoryCommands.preflight
      ) {
        event.preventDefault();
        setGlobalSearchOpen(true);
      }
    };

    window.addEventListener(
      "keydown",
      handleGlobalSearchShortcut
    );
    return () =>
      window.removeEventListener(
        "keydown",
        handleGlobalSearchShortcut
      );
  }, [repositoryCommands.preflight]);

  const openRepositoryTarget = (target: RepositoryTargetDto) => {
    const snapshot = findTargetSnapshot(
      workspace.snapshots,
      target
    );
    void workspace.selectTarget(target);
    setRepositoryTab(
      preferredRepositoryTab(
        getSnapshotChangeCount(snapshot)
      )
    );
    setView("repository");
  };
  const navigate = (nextView: AppView) => {
    if (nextView === "workspace") {
      setRepositoryTab("overview");
      setWorkspaceTab("overview");
    }
    if (
      nextView === "operations" ||
      nextView === "settings"
    ) {
      setInspectorOpen(false);
    }
    setView(nextView);
  };

  const openWorkspaceTab = (tab: WorkspaceTab) => {
    setWorkspaceTab(tab);
    setView("workspace");
  };

  return (
    <div
      className={`app-shell${dragActive ? " dragging-files" : ""}`}
      onDragEnter={(event) => handleDragEnter(event, setDragActive)}
      onDragLeave={(event) => handleDragLeave(event, setDragActive)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        void workspace.addDroppedFiles(
          Array.from(event.dataTransfer.files)
        );
      }}
    >
      <a className="skip-link" href="#main-content">
        跳到主内容
      </a>
      <AppTitlebar
        activeView={view}
        hasRepository={Boolean(
          workspace.workspace?.selectedTarget
        )}
        inspectorOpen={inspectorOpen}
        layoutControlsDisabled={fullPageView}
        onCreateWorkspace={() =>
          void workspace.chooseDirectory()
        }
        onNavigate={navigate}
        onOpenSearch={() => setGlobalSearchOpen(true)}
        onResetLayout={resetLayout}
        onToggleInspector={() =>
          setInspectorOpen((current) => !current)
        }
        onToggleSidebar={() =>
          setSidebarCollapsed((current) => !current)
        }
        onToggleTheme={toggleTheme}
        runtimeInfo={runtimeInfo}
        searchOpen={globalSearchOpen}
        sidebarCollapsed={sidebarCollapsed}
        theme={theme}
      />
      <div
        className={`workspace-frame${
          directoryPanelHidden ? " sidebar-collapsed" : ""
        }${
          fullPageView ? " full-page-view" : ""
        }`}
      >
        <ActivityRail
          activeView={view}
          operationAttentionCount={operationAttentionCount}
          searchOpen={globalSearchOpen}
          sidebarCollapsed={directoryPanelHidden}
          terminalDisabled={
            !selectedTarget ||
            externalTerminals.loading ||
            externalTerminals.active !== null ||
            !defaultTerminalProfile
          }
          terminalTitle={
            defaultTerminalProfile
              ? `使用 ${defaultTerminalProfile.label} 打开当前 Worktree`
              : externalTerminals.loading
                ? "正在检测外部终端"
                : "未检测到支持的外部终端"
          }
          theme={theme}
          onNavigate={navigate}
          onOpenSearch={() => setGlobalSearchOpen(true)}
          onOpenTerminal={() => {
            if (defaultTerminalProfile) {
              void externalTerminals.open(
                defaultTerminalProfile.kind
              );
            }
          }}
          onToggleSidebar={() =>
            setSidebarCollapsed((current) => !current)
          }
          onToggleTheme={toggleTheme}
        />
        <WorkspaceSidebar
          activeView={view}
          busy={workspace.busy}
          sidebarHidden={directoryPanelHidden}
          snapshots={workspace.snapshots}
          onAddDirectory={() => void workspace.chooseDirectory()}
          onOpenWorkspace={() => navigate("workspace")}
          onRemoveEntry={workspace.removeEntry}
          onRescan={workspace.rescan}
          onSelectEntry={(entryId) =>
            void workspace.selectEntry(entryId).then(() =>
              navigate("workspace")
            )
          }
          onSelectTarget={openRepositoryTarget}
          onUpdateEntry={workspace.updateEntry}
          onSetGroupCollapsed={(
            entryId,
            groupId,
            collapsed
          ) =>
            workspace.setGroupCollapsed(
              entryId,
              groupId,
              collapsed
            )
          }
          workspace={workspace.workspace}
        />
        <div
          className={`workspace-main${
            fullPageView
              ? " full-page-workspace-main"
              : ""
          }`}
        >
          {!fullPageView && (
            <RepositoryHeader
              inspectorOpen={inspectorOpen}
              refreshing={
                workspace.operation === "scanning" ||
                runtimeRefreshing
              }
              showPushActions={
                repositoryDiffWorkspaceConfiguration.extensions
                  .pushRegion
              }
              repositoryTab={repositoryTab}
              workspaceTab={workspaceTab}
              snapshots={workspace.snapshots}
              view={view}
              workspace={workspace.workspace}
              externalApplications={externalApplications}
              commandActive={repositoryCommands.active}
              commandCompletionVersion={
                repositoryCommands.completionVersion
              }
              commandLocked={repositoryCommandLocked}
              workspaceCommandBusy={
                repositoryCommands.busy || runtimeRefreshing
              }
              workspaceFetchCount={workspaceTargets.length}
              workspacePullCount={workspacePullTargets.length}
              onFetch={() => {
                if (selectedTarget) {
                  void repositoryCommands.request({
                    type: "fetch",
                    targets: [selectedTarget]
                  });
                }
              }}
              onPull={() => {
                if (selectedTarget) {
                  void repositoryCommands.request({
                    type: "pull",
                    targets: [selectedTarget],
                    strategy: "ff-only"
                  });
                }
              }}
              onFetchWorkspace={() => {
                if (workspaceTargets.length > 0) {
                  void repositoryCommands.request({
                    type: "fetch",
                    targets: workspaceTargets
                  });
                }
              }}
              onPullWorkspace={() => {
                if (workspacePullTargets.length > 0) {
                  void repositoryCommands.request({
                    type: "pull",
                    targets: workspacePullTargets,
                    strategy: "ff-only"
                  });
                }
              }}
              onPush={() => {
                if (selectedTarget) {
                  void repositoryCommands.request({
                    type: "push",
                    targets: [selectedTarget]
                  });
                }
              }}
              onForcePush={() => {
                if (selectedTarget) {
                  void repositoryCommands.request({
                    type: "push",
                    targets: [selectedTarget],
                    forceWithLease: true
                  });
                }
              }}
              onSwitchBranch={(branch) => {
                if (selectedTarget) {
                  void repositoryCommands.request({
                    type: "switch-branch",
                    target: selectedTarget,
                    branch
                  });
                }
              }}
              onOpenRepository={() => {
                if (selectedTarget) {
                  openRepositoryTarget(selectedTarget);
                }
              }}
              onOpenOperations={() => navigate("operations")}
              onOpenSettings={() => navigate("settings")}
              onOpenWorkspace={() => navigate("workspace")}
              onRefresh={() => void workspace.refresh()}
              onRepositoryTabChange={setRepositoryTab}
              onWorkspaceTabChange={openWorkspaceTab}
              onToggleInspector={() =>
                setInspectorOpen((current) => !current)
              }
            />
          )}
          <div
            className={`content-frame${
              inspectorVisible ? "" : " inspector-closed"
            }`}
          >
            <main
              className="main-content"
              id="main-content"
              tabIndex={-1}
            >
              {view === "workspace" && workspaceTab === "overview" ? (
                <WorkspaceOverviewPage
                  busy={workspace.busy}
                  error={workspace.error}
                  notice={workspace.notice}
                  monitor={workspace.monitor}
                  operation={workspace.operation}
                  operations={workspace.operations}
                  snapshots={workspace.snapshots}
                  workspace={workspace.workspace}
                  onAddDirectory={() =>
                    void workspace.chooseDirectory()
                  }
                  onAddManualPath={workspace.addManualPath}
                  onClearFeedback={workspace.clearFeedback}
                  onCancelOperation={(operationId) =>
                    void repositoryCommands.cancelOperation(
                      operationId
                    )
                  }
                  onSelectTarget={openRepositoryTarget}
                />
              ) : view === "workspace" ? (
                <WorkspaceCollectionPage
                  busy={workspace.busy}
                  onAddDirectory={() =>
                    void workspace.chooseDirectory()
                  }
                  onSelectTarget={openRepositoryTarget}
                  snapshots={workspace.snapshots}
                  tab={
                    workspaceTab === "overview"
                      ? "repositories"
                      : workspaceTab
                  }
                  workspace={workspace.workspace}
                />
              ) : view === "repository" ? (
                <RepositoryPage
                  externalApplications={externalApplications}
                  operations={workspace.operations}
                  snapshots={workspace.snapshots}
                  tab={repositoryTab}
                  target={workspace.workspace?.selectedTarget}
                  workspace={workspace.workspace}
                  commands={repositoryCommands}
                  terminals={externalTerminals}
                  onOpenTab={setRepositoryTab}
                  onCommitSelectionChange={setSelectedCommit}
                />
              ) : view === "operations" ? (
                <OperationCenterPage
                  commands={repositoryCommands}
                  onOpenTarget={openRepositoryTarget}
                  operations={workspace.operations}
                  snapshots={workspace.snapshots}
                  workspace={workspace.workspace}
                />
              ) : (
                <SettingsPage
                  accounts={accounts}
                  gitEnvironment={gitEnvironment}
                  terminalProfiles={externalTerminals.profiles}
                  workspace={workspace.workspace}
                />
              )}
            </main>
            {inspectorVisible && (
              <DetailInspector
                accountOverview={accounts.overview}
                commit={selectedCommit}
                gitEnvironment={gitEnvironment}
                gitError={gitError}
                busy={workspace.busy}
                monitor={workspace.monitor}
                onClose={() => setInspectorOpen(false)}
                onOpenSettings={() => navigate("settings")}
                operations={workspace.operations}
                runtimeInfo={runtimeInfo}
                snapshots={workspace.snapshots}
                workspace={workspace.workspace}
                onUpdateEntry={workspace.updateEntry}
              />
            )}
          </div>
        </div>
      </div>
      <StatusBar
        gitEnvironment={gitEnvironment}
        gitError={gitError}
        operation={workspace.operation}
        monitor={workspace.monitor}
        operations={workspace.operations}
        snapshots={workspace.snapshots}
        workspace={workspace.workspace}
      />
      {dragActive && (
        <div className="drop-overlay" aria-hidden="true">
          <span>
            <Icon name="folder" size={24} />
          </span>
          <strong>放下目录以加入 Workspace</strong>
          <small>目录将进入只读发现与分类管线</small>
        </div>
      )}
      {globalSearchOpen && (
        <GlobalSearchDialog
          onClose={() => setGlobalSearchOpen(false)}
          onFetchAll={() => {
            if (!workspace.workspace) {
              return;
            }
            const targets = listWorkspaceTargets(
              workspace.workspace
            );
            if (targets.length > 0) {
              void repositoryCommands.request({
                type: "fetch",
                targets
              });
            }
          }}
          onNavigate={navigate}
          onOpenTarget={openRepositoryTarget}
          onRefresh={() => void workspace.refresh()}
          onToggleTheme={toggleTheme}
          snapshots={workspace.snapshots}
          workspace={workspace.workspace}
        />
      )}
      {repositoryCommands.preflight && (
        <RepositoryCommandDialog
          active={repositoryCommands.active}
          onCancel={repositoryCommands.dismissPreflight}
          onConfirm={() => void repositoryCommands.confirm()}
          preflight={repositoryCommands.preflight}
          workspace={workspace.workspace}
        />
      )}
    </div>
  );
}

function isRepositoryCommandOperation(kind: string): boolean {
  return [
    "fetch",
    "pull",
    "push",
    "switch-branch",
    "create-branch",
    "rename-branch",
    "delete-branch",
    "worktree-create",
    "worktree-lock",
    "worktree-unlock",
    "worktree-move",
    "worktree-repair",
    "worktree-prune",
    "worktree-remove"
  ].includes(kind);
}

function handleDragEnter(
  event: DragEvent<HTMLDivElement>,
  setDragActive: (active: boolean) => void
): void {
  if (event.dataTransfer.types.includes("Files")) {
    event.preventDefault();
    setDragActive(true);
  }
}

function handleDragLeave(
  event: DragEvent<HTMLDivElement>,
  setDragActive: (active: boolean) => void
): void {
  const relatedTarget = event.relatedTarget;

  if (
    !relatedTarget ||
    !(relatedTarget instanceof Node) ||
    !event.currentTarget.contains(relatedTarget)
  ) {
    setDragActive(false);
  }
}

function readInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem("gitnest.theme");
    if (stored === "dark" || stored === "light") {
      return stored;
    }
  } catch {
    // Fall through to the operating-system preference.
  }

  return window.matchMedia("(prefers-color-scheme: light)")
    .matches
    ? "light"
    : "dark";
}
