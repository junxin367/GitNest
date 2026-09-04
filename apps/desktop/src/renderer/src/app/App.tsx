import {
  useEffect,
  useState,
  type DragEvent
} from "react";

import type {
  GitEnvironmentDto,
  GitReadErrorDto,
  RepositoryTargetDto,
  RuntimeInfo
} from "@gitnest/contracts";

import type {
  AppView,
  RepositoryTab
} from "./navigation";
import { useWorkspace } from "../entities/workspace/useWorkspace";
import { useAccounts } from "../features/account-manage/useAccounts";
import { useExternalTerminals } from "../features/external-terminal/useExternalTerminals";
import { RepositoryCommandDialog } from "../features/repository-command/RepositoryCommandDialog";
import { useRepositoryCommands } from "../features/repository-command/useRepositoryCommands";
import { RepositoryPage } from "../pages/repository/RepositoryPage";
import { OperationCenterPage } from "../pages/operations/OperationCenterPage";
import { SettingsPage } from "../pages/settings/SettingsPage";
import { WorkspaceOverviewPage } from "../pages/workspace-overview/WorkspaceOverviewPage";
import { Icon } from "../shared/ui/Icon";
import { ActivityRail } from "../widgets/activity-rail/ActivityRail";
import { AppTitlebar } from "../widgets/app-titlebar/AppTitlebar";
import { DetailInspector } from "../widgets/detail-inspector/DetailInspector";
import { RepositoryHeader } from "../widgets/repository-header/RepositoryHeader";
import { StatusBar } from "../widgets/status-bar/StatusBar";
import { WorkspaceSidebar } from "../widgets/workspace-sidebar/WorkspaceSidebar";

type Theme = "dark" | "light";

export function App() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(
    null
  );
  const [gitEnvironment, setGitEnvironment] =
    useState<GitEnvironmentDto | null>(null);
  const [gitError, setGitError] =
    useState<GitReadErrorDto | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [view, setView] = useState<AppView>("workspace");
  const [repositoryTab, setRepositoryTab] =
    useState<RepositoryTab>("overview");
  const workspace = useWorkspace();
  const repositoryCommands = useRepositoryCommands(
    workspace.workspace?.selectedTarget,
    workspace.operations
  );
  const externalTerminals = useExternalTerminals(
    workspace.workspace?.selectedTarget
  );
  const accounts = useAccounts();
  const runtimeRefreshing = workspace.operations.some(
    (operation) =>
      operation.state === "queued" ||
      operation.state === "running" ||
      operation.state === "cancelling"
  );
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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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

  const openRepositoryTarget = (target: RepositoryTargetDto) => {
    void workspace.selectTarget(target);
    setRepositoryTab("overview");
    setView("repository");
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
        onToggleTheme={() =>
          setTheme((current) =>
            current === "dark" ? "light" : "dark"
          )
        }
        runtimeInfo={runtimeInfo}
        theme={theme}
      />
      <div className="workspace-frame">
        <ActivityRail
          activeView={view}
          hasRepository={Boolean(
            workspace.workspace?.selectedTarget
          )}
          onNavigate={setView}
        />
        <WorkspaceSidebar
          activeView={view}
          busy={workspace.busy}
          snapshots={workspace.snapshots}
          onAddDirectory={() => void workspace.chooseDirectory()}
          onOpenWorkspace={() => setView("workspace")}
          onSelectEntry={(entryId) =>
            void workspace.selectEntry(entryId)
          }
          onSelectTarget={openRepositoryTarget}
          onSetGroupCollapsed={(
            entryId,
            groupId,
            collapsed
          ) =>
            void workspace.setGroupCollapsed(
              entryId,
              groupId,
              collapsed
            )
          }
          workspace={workspace.workspace}
        />
        <div
          className={`content-frame${
            inspectorOpen ? "" : " inspector-closed"
          }`}
        >
          <main className="main-column" id="main-content">
            <RepositoryHeader
              inspectorOpen={inspectorOpen}
              refreshing={
                workspace.operation === "scanning" ||
                runtimeRefreshing
              }
              repositoryTab={repositoryTab}
              snapshots={workspace.snapshots}
              view={view}
              workspace={workspace.workspace}
              commandActive={repositoryCommands.active}
              commandCompletionVersion={
                repositoryCommands.completionVersion
              }
              commandLocked={repositoryCommandLocked}
              terminalActive={externalTerminals.active}
              terminalLoading={externalTerminals.loading}
              terminalProfiles={externalTerminals.profiles}
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
              onOpenTerminal={(kind) =>
                void externalTerminals.open(kind)
              }
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
                if (workspace.workspace?.selectedTarget) {
                  setView("repository");
                }
              }}
              onOpenOperations={() => setView("operations")}
              onOpenSettings={() => setView("settings")}
              onOpenWorkspace={() => setView("workspace")}
              onRefresh={() => void workspace.refresh()}
              onRepositoryTabChange={setRepositoryTab}
              onToggleInspector={() =>
                setInspectorOpen((current) => !current)
              }
            />
            {view === "workspace" ? (
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
            ) : view === "repository" ? (
              <RepositoryPage
                operations={workspace.operations}
                snapshots={workspace.snapshots}
                tab={repositoryTab}
                target={workspace.workspace?.selectedTarget}
                workspace={workspace.workspace}
                commands={repositoryCommands}
                terminals={externalTerminals}
                onOpenTab={setRepositoryTab}
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
          {inspectorOpen && (
            <DetailInspector
              accountOverview={accounts.overview}
              gitEnvironment={gitEnvironment}
              gitError={gitError}
              busy={workspace.busy}
              monitor={workspace.monitor}
              onClose={() => setInspectorOpen(false)}
              onOpenSettings={() => setView("settings")}
              operations={workspace.operations}
              runtimeInfo={runtimeInfo}
              snapshots={workspace.snapshots}
              workspace={workspace.workspace}
              onUpdateEntry={workspace.updateEntry}
            />
          )}
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
