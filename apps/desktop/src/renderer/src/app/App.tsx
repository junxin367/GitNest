import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
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
  shouldOpenGlobalSearch,
  type AppView,
  type RepositoryTab,
  type WorkspaceTab
} from "./navigation";
import { useRepositoryWorkflow } from "../features/repository-workflow/useRepositoryWorkflow";
import { RepositoryWorkflowDialog } from "../features/repository-workflow/RepositoryWorkflowDialog";
import { RepositoryWorkflowDraftDialog } from "../features/repository-workflow/RepositoryWorkflowToolbar";
import { CreateBranchFromCommitDialog, type RepositoryCommitActionHandler } from "../features/repository-workflow/RepositoryCommitActions";
import { Toast, ToastViewport } from "../shared/ui/Toast";
import {
  listWorkspaceTargets,
  findTargetSnapshot,
  getSnapshotContentRevision
} from "../entities/workspace/model";
import { useWorkspace } from "../entities/workspace/useWorkspace";
import type {
  RepositoryChangeLocation,
  RepositoryChangeSelectionRequest
} from "../entities/repository/changeSelection";
import { useExternalApplications } from "../features/external-application/useExternalApplications";
import { useExternalTerminals } from "../features/external-terminal/useExternalTerminals";
import { VersionDialog } from "../features/application-update/VersionDialog";
import { useApplicationUpdate } from "../features/application-update/useApplicationUpdate";
import { GlobalSearchDialog } from "../features/global-search/GlobalSearchDialog";
import { useWorkspaceChangedFiles } from "../features/global-search/useWorkspaceChangedFiles";
import { RepositoryCommandDialog } from "../features/repository-command/RepositoryCommandDialog";
import {
  isRepositoryCommandOperation,
  useRepositoryCommands
} from "../features/repository-command/useRepositoryCommands";
import { useAppSettings } from "../features/settings/useAppSettings";
import {
  useWorkspaceWorktreeCommands
} from "../features/worktree-command/useWorkspaceWorktreeCommands";
import {
  requestRepositoryFetchBatches,
  resolveDefaultTerminalProfile,
  resolveStartupNavigation
} from "../features/settings/settingsRuntime";
import { RepositoryPage } from "../pages/repository/RepositoryPage";
import type {
  ApplicationSettingsSection
} from "../pages/settings/ApplicationSettingsPage";
import { WorkspaceCollectionPage } from "../pages/workspace-overview/WorkspaceCollectionPage";
import { WorkspaceOverviewPage } from "../pages/workspace-overview/WorkspaceOverviewPage";
import { Skeleton, SkeletonSurface } from "../shared/ui/Skeleton";
import { DiffWorkspaceSkeleton } from "../widgets/diff-workspace/DiffWorkspace";
import { ActivityRail } from "../widgets/activity-rail/ActivityRail";
import { AppTitlebar } from "../widgets/app-titlebar/AppTitlebar";
import { DetailInspector } from "../widgets/detail-inspector/DetailInspector";
import { RepositoryHeader } from "../widgets/repository-header/RepositoryHeader";
import { StatusBar } from "../widgets/status-bar/StatusBar";
import { WorkspaceSidebar } from "../widgets/workspace-sidebar/WorkspaceSidebar";
import { AnalysisPageHost } from "./AnalysisPageHost";
import { CodeAnalysisLoadingFallback } from "../pages/code-analysis/CodeAnalysisSkeleton";

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
  const [view, setView] = useState<AppView>("workspace");
  const [sidebarCollapsed, setSidebarCollapsed] =
    useState(false);
  const [workspaceTab, setWorkspaceTab] =
    useState<WorkspaceTab>("overview");
  const [globalSearchOpen, setGlobalSearchOpen] =
    useState(false);
  const [versionDialogOpen, setVersionDialogOpen] =
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
  const promptedUpdateVersions = useRef(new Set<string>());
  const appSettings = useAppSettings();
  const applicationUpdate = useApplicationUpdate();
  const theme = appSettings.settings.appearance.theme;
  const workspace = useWorkspace();
  const workspaceChangedFiles = useWorkspaceChangedFiles(
    workspace.workspace,
    workspace.snapshots,
    globalSearchOpen
  );
  const repositoryCommands = useRepositoryCommands(
    workspace.workspace?.selectedTarget,
    workspace.operations,
    workspace.workspace?.id
  );
  const workspaceWorktreeCommands = useWorkspaceWorktreeCommands(
    workspace.workspace?.id,
    workspace.operations,
    workspace.syncCurrentWorkspace
  );
  const externalTerminals = useExternalTerminals(
    workspace.workspace?.selectedTarget,
    workspace.workspace?.id
  );
  const externalApplications = useExternalApplications(
    view === "repository" &&
      workspace.workspace?.selectedTarget
      ? {
          scope: "repository",
          target: workspace.workspace.selectedTarget
        }
      : undefined,
    workspace.workspace?.id
  );
  const workspaceApplications = useExternalApplications(
    workspace.workspace &&
      (view === "workspace" || view === "repository")
      ? { scope: "workspace" }
      : undefined,
    workspace.workspace?.id
  );
  const runtimeRefreshing = workspace.operations.some(
    (operation) =>
      operation.state === "queued" ||
      operation.state === "running" ||
      operation.state === "cancelling"
  );
  const activeWorkspaceTargets = useMemo(
    () => listWorkspaceTargets(workspace.workspace),
    [workspace.workspace]
  );
  const selectedTarget = workspace.workspace?.selectedTarget;
  const workflow = useRepositoryWorkflow(
    selectedTarget,
    workspace.operations,
    workspace.workspace?.id,
    view === "repository" && repositoryTab === "changes",
    getSnapshotContentRevision(findTargetSnapshot(workspace.snapshots, selectedTarget))
  );
  const [branchFromCommit, setBranchFromCommit] = useState<RepositoryCommitDto["commit"] | null>(null);
  const [commitActionError, setCommitActionError] = useState<string | null>(null);
  const [openingCommit, setOpeningCommit] = useState(false);
  const workflowScope = `${workspace.workspace?.id ?? ""}:${selectedTarget?.repositoryId ?? ""}:${selectedTarget?.worktreeId ?? ""}`;
  const workflowScopeRef = useRef(workflowScope);
  workflowScopeRef.current = workflowScope;
  useEffect(() => {
    setBranchFromCommit(null);
    setCommitActionError(null);
    setOpeningCommit(false);
  }, [workflowScope]);
  const onCommitAction: RepositoryCommitActionHandler = async (action, commit) => {
    if (!selectedTarget || workflow.busy || repositoryCommands.busy || openingCommit) return;
    setCommitActionError(null);
    if (action === "create-branch") { setBranchFromCommit(commit); return; }
    if (action === "cherry-pick" || action === "revert") {
      await workflow.request({ type: action, commitHash: commit.hash });
      return;
    }
    const scope = workflowScope;
    setOpeningCommit(true);
    try {
      const result = await window.gitnest.repositoryManagement.openCommit({ target: selectedTarget, hash: commit.hash });
      if (workflowScopeRef.current === scope && !result.ok) setCommitActionError(result.error.message);
    } catch (reason) {
      if (workflowScopeRef.current === scope) setCommitActionError(reason instanceof Error ? reason.message : "打开远程提交失败。");
    } finally {
      if (workflowScopeRef.current === scope) setOpeningCommit(false);
    }
  };
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
    workspace.busy ||
    workflow.busy ||
    workflow.preflight !== null ||
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
    changeNavigationSequence.current += 1;
    setSelectedCommit(null);
    setPendingChangeNavigation(null);
    setGlobalSearchOpen(false);
  }, [workspace.workspace?.id]);

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
    (targets: RepositoryTargetDto[]) =>
      requestRepositoryFetchBatches(targets, repositoryCommands.request),
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
        shouldOpenGlobalSearch(
          event,
          document.documentElement.dataset.modalOpen === "true"
        ) &&
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

  useEffect(() => {
    const version =
      applicationUpdate.state?.promptPending &&
      applicationUpdate.state.latestVersion
        ? applicationUpdate.state.latestVersion
        : null;
    if (
      version &&
      !globalSearchOpen &&
      !repositoryCommands.preflight &&
      !promptedUpdateVersions.current.has(version)
    ) {
      promptedUpdateVersions.current.add(version);
      setVersionDialogOpen(true);
    }
  }, [
    applicationUpdate.state?.latestVersion,
    applicationUpdate.state?.promptPending,
    globalSearchOpen,
    repositoryCommands.preflight
  ]);

  const openRepositoryTarget = useCallback(async (
    target: RepositoryTargetDto
  ) => {
    const navigationId = ++changeNavigationSequence.current;
    setPendingChangeNavigation(null);
    const selected = await workspace.selectTarget(target);
    if (
      !selected ||
      changeNavigationSequence.current !== navigationId
    ) {
      return;
    }
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
  }, [appSettings.update, repositoryTab, workspace.selectTarget]);
  const openRepositoryChange = useCallback(async (
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
  }, [appSettings.update, workspace.selectTarget]);
  const navigate = useCallback((
    nextView: AppView,
    nextSettingsSection: ApplicationSettingsSection =
      "general"
  ) => {
    // A user's navigation wins over startup settings that arrive later.
    startupNavigationApplied.current = true;
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
  }, [appSettings.update]);
  const openWorkspace = useCallback(() => navigate("workspace"), [navigate]);

  const openWorkspaceTab = useCallback((tab: WorkspaceTab) => {
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
  }, [appSettings.update]);

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
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主内容
      </a>
      <AppTitlebar
        onCreateWorkspace={() =>
          void workspace.createWorkspace()
        }
        onOpenSearch={() => setGlobalSearchOpen(true)}
        onOpenVersion={() => {
          setGlobalSearchOpen(false);
          setVersionDialogOpen(true);
        }}
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
          searchOpen={globalSearchOpen}
          sidebarCollapsed={directoryPanelHidden}
          sidebarDisabled={fullPageView}
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
          error={workspace.error}
          sidebarHidden={directoryPanelHidden}
          snapshots={workspace.snapshots}
          workspaces={workspace.workspaces}
          onCreateWorkspace={workspace.createWorkspace}
          onClearFeedback={workspace.clearFeedback}
          onSwitchWorkspace={workspace.switchWorkspace}
          onDeleteWorkspace={workspace.deleteWorkspace}
          onAddDirectory={workspace.chooseDirectory}
          onOpenWorkspace={openWorkspace}
          onRenameWorkspace={workspace.renameWorkspace}
          onRemoveRepository={workspace.removeRepository}
          onRescan={workspace.rescan}
          onSelectTarget={openRepositoryTarget}
          onSetGroupCollapsed={workspace.setGroupCollapsed}
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
              key={workspace.workspace?.id}
              inspectorOpen={inspectorOpen}
              refreshing={
                workspace.busy ||
                runtimeRefreshing
              }
              repositoryTab={repositoryTab}
              workspaceTab={workspaceTab}
              snapshots={workspace.snapshots}
              view={view}
              workspace={workspace.workspace}
              externalApplications={workspaceApplications}
              commandActive={repositoryCommands.active}
              commandFeedback={repositoryCommands}
              commandCompletionVersion={
                repositoryCommands.completionVersion
              }
              commandLocked={repositoryCommandLocked}
              workspaceCommandBusy={
                workspace.busy ||
                repositoryCommands.busy ||
                runtimeRefreshing
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
              <AnalysisPageHost active={view === "analysis"} workspace={workspace.workspace}>
                <Suspense fallback={
                  <AppPageLoadingFallback
                    view="analysis"
                    repositoryTab={repositoryTab}
                    workspaceTab={workspaceTab}
                    commitPanelHeight={appSettings.settings.diff.commitPanelHeight}
                  />
                }>
                  <CodeAnalysisPage
                    onOpenSettings={() => navigate("settings", "analysis")}
                    onReloadSettings={appSettings.reload}
                    settings={appSettings.settings}
                    snapshots={workspace.snapshots}
                    workspace={workspace.workspace}
                  />
                </Suspense>
              </AnalysisPageHost>
              <Suspense fallback={
                <AppPageLoadingFallback
                  view={view}
                  repositoryTab={repositoryTab}
                  workspaceTab={workspaceTab}
                  commitPanelHeight={appSettings.settings.diff.commitPanelHeight}
                />
              }>
                {workspace.operation === "switching" &&
                workspace.workspace?.id !== workspace.switchingWorkspaceId &&
                (view === "workspace" ||
                  view === "repository") ? (
                  <AppPageLoadingFallback
                    view={view}
                    repositoryTab={repositoryTab}
                    workspaceTab={workspaceTab}
                    commitPanelHeight={appSettings.settings.diff.commitPanelHeight}
                  />
                ) : view === "workspace" &&
                workspaceTab === "overview" ? (
                  <WorkspaceOverviewPage
                    key={workspace.workspace?.id}
                    busy={workspace.busy}
                    error={workspace.error}
                    notice={workspace.notice}
                    operation={workspace.operation}
                    snapshots={workspace.snapshots}
                    workspace={workspace.workspace}
                    onClearFeedback={workspace.clearFeedback}
                    onCreateWorkspace={workspace.createWorkspace}
                    onSelectTarget={openRepositoryTarget}
                  />
                ) : view === "workspace" ? (
                  <WorkspaceCollectionPage
                    key={workspace.workspace?.id}
                    busy={workspace.busy}
                    commands={workspaceWorktreeCommands}
                    loading={workspace.operation === "loading"}
                    onCreateWorkspace={workspace.createWorkspace}
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
                    workflow={workflow}
                    onCommitAction={onCommitAction}
                    actionBusy={repositoryCommandLocked || openingCommit}
                    key={workspace.workspace?.id}
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
                    onWorkspaceTopologyChanged={
                      workspace.syncCurrentWorkspace
                    }
                  />
                ) : view === "analysis" ? null : view === "operations" ? (
                  <OperationCenterPage
                    commands={repositoryCommands}
                    loading={workspace.operation === "loading"}
                    onOpenTarget={openRepositoryTarget}
                    operations={workspace.operations}
                    workspace={workspace.workspace}
                  />
                ) : (
                  <ApplicationSettingsPage
                    appSettings={appSettings}
                    gitEnvironment={gitEnvironment}
                    initialSection={settingsSection}
                    terminalProfiles={externalTerminals.profiles}
                  />
                )}
              </Suspense>
            </main>
            {inspectorVisible && (
              <DetailInspector
                onCommitAction={onCommitAction}
                actionBusy={repositoryCommandLocked || openingCommit}
                commit={selectedCommit}
                gitEnvironment={gitEnvironment}
                gitError={gitError}
                busy={workspace.busy}
                monitor={workspace.monitor}
                onClose={() => setInspectorOpen(false)}
                onOpenSettings={() =>
                  navigate("settings", "account")
                }
                operations={workspace.operations}
                runtimeInfo={runtimeInfo}
                snapshots={workspace.snapshots}
                workspace={workspace.workspace}
                onRenameWorkspace={workspace.renameWorkspace}
              />
            )}
          </div>
        </div>
      </div>
      <StatusBar
        cleanupWarning={workspace.cleanupWarning}
        gitEnvironment={gitEnvironment}
        gitError={gitError}
        operation={workspace.operation}
        monitor={workspace.monitor}
        operations={workspace.operations}
        snapshots={workspace.snapshots}
        workspace={workspace.workspace}
      />
      <RepositoryWorkflowDialog controller={workflow} />
      <RepositoryWorkflowDraftDialog controller={workflow} />
      {branchFromCommit && selectedTarget && <CreateBranchFromCommitDialog
        key={`${workflowScope}:${branchFromCommit.hash}`}
        commit={branchFromCommit} target={selectedTarget} commands={repositoryCommands}
        onClose={() => setBranchFromCommit(null)} />}
      <ToastViewport>
        {workflow.error && <Toast title="Git 操作未完成" message={workflow.error} tone="error" onClose={workflow.clearFeedback} />}
        {!workflow.error && workflow.notice && <Toast title="Git 操作" message={workflow.notice} onClose={workflow.clearFeedback} />}
        {commitActionError && <Toast title="提交操作未完成" message={commitActionError} tone="error" onClose={() => setCommitActionError(null)} />}
      </ToastViewport>
      {globalSearchOpen && (
        <GlobalSearchDialog
          changes={workspaceChangedFiles.changes}
          changesLoaded={workspaceChangedFiles.loaded}
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
      {versionDialogOpen && (
        <VersionDialog
          fallbackVersion={
            runtimeInfo?.appVersion ?? "0.0.1"
          }
          state={applicationUpdate.state}
          onAcknowledgePrompt={(version) =>
            void applicationUpdate
              .acknowledgePrompt(version)
              .catch(() => undefined)
          }
          onCheck={() =>
            void applicationUpdate
              .check()
              .catch(() => undefined)
          }
          onClose={() => setVersionDialogOpen(false)}
          onDownloadAndInstall={() =>
            void applicationUpdate
              .downloadAndInstall()
              .catch(() => undefined)
          }
          onOpenProjectPage={() =>
            void applicationUpdate
              .openProjectPage()
              .catch(() => undefined)
          }
          onOpenReleasePage={() =>
            void applicationUpdate
              .openReleasePage()
              .catch(() => undefined)
          }
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

export function AppPageLoadingFallback({
  view = "workspace",
  repositoryTab = "overview",
  workspaceTab = "overview",
  commitPanelHeight
}: {
  view?: AppView;
  repositoryTab?: RepositoryTab;
  workspaceTab?: WorkspaceTab;
  commitPanelHeight?: number;
}) {
  if (view === "analysis") {
    return <CodeAnalysisLoadingFallback />;
  }
  if (view === "repository" && repositoryTab === "changes") {
    return (
      <div className="changes-page">
        <DiffWorkspaceSkeleton
          className="changes-layout"
          commitPanelHeight={commitPanelHeight}
          showCommit
          showAuxiliary
        />
      </div>
    );
  }
  const overview =
    (view === "workspace" && workspaceTab === "overview") ||
    (view === "repository" && repositoryTab === "overview");
  const layout = view === "settings"
    ? view
    : overview ? "overview" : "list";
  const label = {
    workspace: workspaceTab === "overview"
      ? "正在读取 Workspace 概览" : "正在读取 Workspace",
    repository: repositoryTab === "history"
      ? "正在读取提交历史" : repositoryTab === "branches"
        ? "正在读取分支" : repositoryTab === "worktrees"
          ? "正在读取 Worktree" : "正在读取仓库概览",
    analysis: "正在读取代码分析",
    operations: "正在读取操作中心",
    settings: "正在读取应用设置"
  }[view];
  return (
    <SkeletonSurface
      label={label}
      className={layout === "settings"
        ? "page-scroll settings-page-scroll"
        : "page-scroll gn-page-skeleton"}
      data-layout={layout}
    >
      {layout !== "settings" && <div className="gn-skeleton-heading">
        <Skeleton height={12} variant="text" width="18%" />
        <Skeleton height={28} width="38%" />
        <Skeleton height={10} variant="text" width="62%" />
      </div>}
      {overview && (
        <div className="gn-skeleton-metric-grid" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="gn-skeleton-card" key={index}>
              <Skeleton height={10} width="48%" />
              <Skeleton height={24} width="32%" />
              <Skeleton height={9} width="72%" />
            </div>
          ))}
        </div>
      )}
      {layout === "settings" ? (
        <div className="settings-layout" aria-hidden="true">
          <aside className="settings-sidebar">
            <div className="gn-skeleton-heading">
              <Skeleton height={31} width={96} />
              <Skeleton height={10} variant="text" width="100%" />
              <Skeleton height={10} variant="text" width="72%" />
            </div>
            <div className="gn-skeleton-panel settings-nav">
              <AppLoadingRows count={5} />
            </div>
          </aside>
            <div className="settings-content">
              {Array.from({ length: 3 }, (_, index) => (
                <div className="gn-skeleton-panel" key={index}>
                  <div className="gn-skeleton-panel-header">
                    <Skeleton height={12} width="40%" />
                  </div>
                  <AppLoadingRows count={3} />
                </div>
              ))}
            </div>
        </div>
      ) : (
        <div className="gn-skeleton-panel" aria-hidden="true">
          <div className="gn-skeleton-panel-header">
            <Skeleton height={14} width="32%" />
            <Skeleton height={10} variant="text" width="20%" />
          </div>
          <AppLoadingRows count={5} />
        </div>
      )}
    </SkeletonSurface>
  );
}

function AppLoadingRows({ count }: { count: number }) {
  return (
    <div className="gn-skeleton-list">
      {Array.from({ length: count }, (_, index) => (
        <div className="gn-skeleton-row" key={index}>
          <div className="gn-skeleton-row-copy">
            <Skeleton height={11} />
            <Skeleton height={9} variant="text" />
          </div>
          <Skeleton height={18} width="100%" />
        </div>
      ))}
    </div>
  );
}
