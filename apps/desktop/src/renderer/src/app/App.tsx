import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  repositoryTabForTargetSwitch,
  type AppView,
  type RepositoryTab,
  type WorkspaceTab
} from "./navigation";
import {
  listActiveWorkspaceTargets,
  listWorkspaceTargets
} from "../entities/workspace/model";
import { useWorkspace } from "../entities/workspace/useWorkspace";
import type {
  RepositoryChangeLocation,
  RepositoryChangeSelectionRequest
} from "../entities/repository/changeSelection";
import { useAccounts } from "../features/account-manage/useAccounts";
import { useExternalApplications } from "../features/external-application/useExternalApplications";
import { useExternalTerminals } from "../features/external-terminal/useExternalTerminals";
import { GlobalSearchDialog } from "../features/global-search/GlobalSearchDialog";
import { useWorkspaceChangedFiles } from "../features/global-search/useWorkspaceChangedFiles";
import { RepositoryCommandDialog } from "../features/repository-command/RepositoryCommandDialog";
import {
  isRepositoryCommandOperation,
  useRepositoryCommands
} from "../features/repository-command/useRepositoryCommands";
import { useAppSettings } from "../features/settings/useAppSettings";
import {
  chunkRepositoryTargets,
  resolveDefaultTerminalProfile,
  resolveStartupNavigation
} from "../features/settings/settingsRuntime";
import { RepositoryPage } from "../pages/repository/RepositoryPage";
import type {
  ApplicationSettingsSection
} from "../pages/settings/ApplicationSettingsPage";
import { WorkspaceCollectionPage } from "../pages/workspace-overview/WorkspaceCollectionPage";
import { WorkspaceOverviewPage } from "../pages/workspace-overview/WorkspaceOverviewPage";
import { Icon } from "../shared/ui/Icon";
import { Skeleton } from "../shared/ui/Skeleton";
import { ActivityRail } from "../widgets/activity-rail/ActivityRail";
import { AppTitlebar } from "../widgets/app-titlebar/AppTitlebar";
import { DetailInspector } from "../widgets/detail-inspector/DetailInspector";
import { RepositoryHeader } from "../widgets/repository-header/RepositoryHeader";
import { StatusBar } from "../widgets/status-bar/StatusBar";
import { WorkspaceSidebar } from "../widgets/workspace-sidebar/WorkspaceSidebar";

const CodeAnalysisPage = lazy(() =>
  import("../pages/code-analysis/CodeAnalysisPage").then(
    (module) => ({ default: module.CodeAnalysisPage })
  )
);
const OperationCenterPage = lazy(() =>
  import("../pages/operations/OperationCenterPage").then(
    (module) => ({ default: module.OperationCenterPage })
  )
);
const ApplicationSettingsPage = lazy(() =>
  import("../pages/settings/ApplicationSettingsPage").then(
    (module) => ({ default: module.ApplicationSettingsPage })
  )
);

export function App() {
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
  const [settingsSection, setSettingsSection] =
    useState<ApplicationSettingsSection>("general");
  const [selectedCommit, setSelectedCommit] = useState<
    RepositoryCommitDto["commit"] | null
  >(null);
  const [
    pendingChangeNavigation,
    setPendingChangeNavigation
  ] = useState<RepositoryChangeSelectionRequest | null>(null);
  const changeNavigationSequence = useRef(0);
  const appSettings = useAppSettings();
  const theme = appSettings.settings.appearance.theme;
  const workspace = useWorkspace();
  const workspaceChangedFiles = useWorkspaceChangedFiles(
    workspace.workspace,
    workspace.snapshots,
    globalSearchOpen
  );
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
  const activeWorkspaceTargets = useMemo(
    () => listActiveWorkspaceTargets(workspace.workspace),
    [workspace.workspace]
  );
  const activeWorkspaceRepositoryCount = useMemo(
    () =>
      new Set(
        activeWorkspaceTargets.map((target) => target.repositoryId)
      ).size,
    [activeWorkspaceTargets]
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
    resolveDefaultTerminalProfile(
      externalTerminals.profiles,
      appSettings.settings.general.defaultTerminalKind
    );
  const fullPageView =
    view === "analysis" ||
    view === "operations" ||
    view === "settings";
  const inspectorVisible =
    inspectorOpen && !fullPageView;
  const directoryPanelHidden =
    sidebarCollapsed || fullPageView;
  const startupNavigationApplied = useRef(false);
  const startupFetchAttempted = useRef(false);
  const toggleTheme = () =>
    appSettings.update(
      {
        appearance: {
          theme: theme === "dark" ? "light" : "dark"
        }
      },
      { silent: true }
    );
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
    if (
      startupNavigationApplied.current ||
      appSettings.loading ||
      workspace.operation === "loading"
    ) {
      return;
    }

    startupNavigationApplied.current = true;
    const destination = resolveStartupNavigation(
      appSettings.settings,
      Boolean(workspace.workspace?.selectedTarget)
    );
    setWorkspaceTab(destination.workspaceTab);
    setRepositoryTab(destination.repositoryTab);
    setView(destination.view);
  }, [
    appSettings.loading,
    appSettings.settings,
    workspace.operation,
    workspace.workspace?.selectedTarget
  ]);

  const fetchTargets = useCallback(
    async (targets: RepositoryTargetDto[]) => {
      for (const batch of chunkRepositoryTargets(targets)) {
        await repositoryCommands.request({
          type: "fetch",
          targets: batch
        });
      }
    },
    [repositoryCommands.request]
  );

  useEffect(() => {
    if (
      startupFetchAttempted.current ||
      !startupNavigationApplied.current ||
      appSettings.loading ||
      workspace.operation === "loading" ||
      !workspace.workspace
    ) {
      return;
    }

    startupFetchAttempted.current = true;
    if (appSettings.settings.git.fetchMode !== "startup") {
      return;
    }
    const targets = listWorkspaceTargets(workspace.workspace);
    if (targets.length > 0) {
      void fetchTargets(targets);
    }
  }, [
    appSettings.loading,
    appSettings.settings.git.fetchMode,
    fetchTargets,
    workspace.operation,
    workspace.workspace
  ]);

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
    changeNavigationSequence.current += 1;
    setPendingChangeNavigation(null);
    void workspace.selectTarget(target);
    const nextTab = repositoryTabForTargetSwitch(repositoryTab);
    setRepositoryTab(nextTab);
    setView("repository");
    void appSettings.update(
      {
        navigation: {
          lastContentView: "repository",
          repositoryTab: nextTab
        }
      },
      { silent: true }
    );
  };
  const openRepositoryChange = async (
    location: RepositoryChangeLocation
  ) => {
    const navigationId = ++changeNavigationSequence.current;
    setPendingChangeNavigation(null);
    const selected = await workspace.selectTarget(
      location.target
    );
    if (
      !selected ||
      changeNavigationSequence.current !== navigationId
    ) {
      return;
    }

    setPendingChangeNavigation({
      ...location,
      id: navigationId
    });
    setRepositoryTab("changes");
    setView("repository");
    void appSettings.update(
      {
        navigation: {
          lastContentView: "repository",
          repositoryTab: "changes"
        }
      },
      { silent: true }
    );
  };
  const navigate = (
    nextView: AppView,
    nextSettingsSection: ApplicationSettingsSection =
      "general"
  ) => {
    changeNavigationSequence.current += 1;
    setPendingChangeNavigation(null);
    if (nextView === "workspace") {
      setWorkspaceTab("overview");
      void appSettings.update(
        {
          navigation: {
            lastContentView: "workspace",
            workspaceTab: "overview"
          }
        },
        { silent: true }
      );
    }
    if (
      nextView === "analysis" ||
      nextView === "operations" ||
      nextView === "settings"
    ) {
      setInspectorOpen(false);
    }
    if (nextView === "settings") {
      setSettingsSection(nextSettingsSection);
    }
    setView(nextView);
  };

  const openWorkspaceTab = (tab: WorkspaceTab) => {
    changeNavigationSequence.current += 1;
    setPendingChangeNavigation(null);
    setWorkspaceTab(tab);
    setView("workspace");
    void appSettings.update(
      {
        navigation: {
          lastContentView: "workspace",
          workspaceTab: tab
        }
      },
      { silent: true }
    );
  };

  const openRepositoryTab = (tab: RepositoryTab) => {
    changeNavigationSequence.current += 1;
    setPendingChangeNavigation(null);
    setRepositoryTab(tab);
    setView("repository");
    void appSettings.update(
      {
        navigation: {
          lastContentView: "repository",
          repositoryTab: tab
        }
      },
      { silent: true }
    );
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
        onCreateWorkspace={() =>
          void workspace.chooseDirectory()
        }
        onNavigate={navigate}
        onOpenSearch={() => setGlobalSearchOpen(true)}
        runtimeInfo={runtimeInfo}
        searchOpen={globalSearchOpen}
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
          workspaces={workspace.workspaces}
          onCreateWorkspace={workspace.createWorkspace}
          onSwitchWorkspace={workspace.switchWorkspace}
          onDeleteWorkspace={workspace.deleteWorkspace}
          onAddDirectory={() => void workspace.chooseDirectory()}
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
              workspaceRepositoryCount={
                activeWorkspaceRepositoryCount
              }
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
                if (activeWorkspaceTargets.length > 0) {
                  void fetchTargets(activeWorkspaceTargets);
                }
              }}
              onPullWorkspace={() => {
                if (activeWorkspaceTargets.length > 0) {
                  void repositoryCommands.request({
                    type: "pull",
                    targets: activeWorkspaceTargets,
                    strategy: "ff-only"
                  });
                }
              }}
              onPushWorkspace={() => {
                if (activeWorkspaceTargets.length > 0) {
                  void repositoryCommands.request({
                    type: "push",
                    targets: activeWorkspaceTargets,
                    strategy: appSettings.settings.git.pushStrategy
                  });
                }
              }}
              onPush={() => {
                if (selectedTarget) {
                  void repositoryCommands.request({
                    type: "push",
                    targets: [selectedTarget],
                    strategy: appSettings.settings.git.pushStrategy
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
              onRepositoryTabChange={openRepositoryTab}
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
              <Suspense fallback={<AppPageLoadingFallback />}>
                {view === "workspace" &&
                workspaceTab === "overview" ? (
                  <WorkspaceOverviewPage
                    busy={workspace.busy}
                    error={workspace.error}
                    notice={workspace.notice}
                    operation={workspace.operation}
                    snapshots={workspace.snapshots}
                    workspace={workspace.workspace}
                    onAddDirectory={() =>
                      void workspace.chooseDirectory()
                    }
                    onAddManualPath={workspace.addManualPath}
                    onClearFeedback={workspace.clearFeedback}
                    onSelectTarget={openRepositoryTarget}
                  />
                ) : view === "workspace" ? (
                  <WorkspaceCollectionPage
                    busy={workspace.busy}
                    loading={workspace.operation === "loading"}
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
                    appSettings={appSettings}
                    changeSelectionRequest={
                      pendingChangeNavigation
                    }
                    externalApplications={externalApplications}
                    operations={workspace.operations}
                    snapshots={workspace.snapshots}
                    tab={repositoryTab}
                    target={workspace.workspace?.selectedTarget}
                    workspace={workspace.workspace}
                    commands={repositoryCommands}
                    terminals={externalTerminals}
                    onOpenTab={openRepositoryTab}
                    onCommitSelectionChange={setSelectedCommit}
                    onChangeSelectionHandled={(requestId) =>
                      setPendingChangeNavigation((current) =>
                        current?.id === requestId
                          ? null
                          : current
                      )
                    }
                  />
                ) : view === "analysis" ? (
                  <CodeAnalysisPage
                    onOpenSettings={() =>
                      navigate("settings", "analysis")
                    }
                    onReloadSettings={appSettings.reload}
                    settings={appSettings.settings}
                    workspace={workspace.workspace}
                  />
                ) : view === "operations" ? (
                  <OperationCenterPage
                    commands={repositoryCommands}
                    loading={workspace.operation === "loading"}
                    onOpenTarget={openRepositoryTarget}
                    operations={workspace.operations}
                    snapshots={workspace.snapshots}
                    workspace={workspace.workspace}
                  />
                ) : (
                  <ApplicationSettingsPage
                    accounts={accounts}
                    appSettings={appSettings}
                    gitEnvironment={gitEnvironment}
                    initialSection={settingsSection}
                    terminalProfiles={externalTerminals.profiles}
                    workspace={workspace.workspace}
                  />
                )}
              </Suspense>
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
          changes={workspaceChangedFiles.changes}
          changesLoading={workspaceChangedFiles.loading}
          failedChangeTargetCount={
            workspaceChangedFiles.failedTargetCount
          }
          onClose={() => setGlobalSearchOpen(false)}
          onFetchAll={() => {
            if (!workspace.workspace) {
              return;
            }
            const targets = listWorkspaceTargets(
              workspace.workspace
            );
            if (targets.length > 0) {
              void fetchTargets(targets);
            }
          }}
          onNavigate={navigate}
          onOpenChange={(location) =>
            void openRepositoryChange(location)
          }
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

function AppPageLoadingFallback() {
  return (
    <div
      aria-busy="true"
      aria-label="正在加载页面"
      className="page-scroll gn-page-skeleton"
      role="status"
    >
      <div className="gn-skeleton-heading">
        <Skeleton height={12} variant="text" width="18%" />
        <Skeleton height={28} width="38%" />
        <Skeleton height={10} variant="text" width="62%" />
      </div>
      <div className="gn-skeleton-panel">
        <div className="gn-skeleton-panel-header">
          <Skeleton height={14} width="32%" />
          <Skeleton height={10} variant="text" width="20%" />
        </div>
        <div className="gn-skeleton-list">
          {Array.from({ length: 5 }, (_, index) => (
            <div className="gn-skeleton-row" key={index}>
              <div className="gn-skeleton-row-copy">
                <Skeleton height={11} />
                <Skeleton height={9} variant="text" />
              </div>
              <Skeleton height={18} width="100%" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
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
