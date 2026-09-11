import {
  app,
  BrowserWindow,
  safeStorage
} from "electron";
import { randomUUID } from "node:crypto";
import {
  join,
  normalize,
  resolve
} from "node:path";

import {
  AccountService,
  ExternalApplicationService,
  ExternalTerminalService,
  GitInspectionService,
  RepositoryCommandService,
  RepositoryMutationService,
  RepositoryQueryService,
  WorktreeCommandService,
  WorkspaceRuntimeService,
  WorkspaceService
} from "@gitnest/application";
import { IPC_EVENTS } from "@gitnest/contracts";
import {
  GitCliClient,
  type GitRemoteCommandEnvironmentProvider
} from "@gitnest/git-cli";
import {
  JsonAccountMetadataStore,
  JsonRepositorySnapshotStore,
  JsonWorkspaceOperationStore,
  JsonWorkspaceStore
} from "@gitnest/persistence-json";

import {
  NodeWorkspaceFileSystem,
  NodeWorktreePathPolicy
} from "../adapters/filesystem.adapter";
import { WindowsExternalApplicationAdapter } from "../adapters/external-application.adapter";
import { WindowsExternalTerminalAdapter } from "../adapters/external-terminal.adapter";
import { SafeStorageCredentialVault } from "../adapters/credential-vault.adapter";
import { WindowsGitAskPassBroker } from "../adapters/git-askpass.adapter";
import { NodeWorkspaceWatcher } from "../adapters/watcher.adapter";
import { RotatingDiagnosticLogger } from "../adapters/diagnostic-logger.adapter";
import { AiCommitMessageService } from "../ai/ai-commit-message-service";
import { AppSettingsService } from "../settings/app-settings";
import { JsonWindowStateStore } from "../windows/window-state";

export interface ApplicationServices {
  accounts: AccountService;
  aiCommitMessages: AiCommitMessageService;
  diagnostics: RotatingDiagnosticLogger;
  externalApplication: ExternalApplicationService;
  externalTerminal: ExternalTerminalService;
  gitInspection: GitInspectionService;
  repositoryCommands: RepositoryCommandService;
  repositoryMutations: RepositoryMutationService;
  repositoryQueries: RepositoryQueryService;
  settings: AppSettingsService;
  worktreeCommands: WorktreeCommandService;
  worktreePaths: NodeWorktreePathPolicy;
  windowState: JsonWindowStateStore;
  workspace: WorkspaceRuntimeService;
}

export function registerServices(): ApplicationServices {
  let remoteEnvironmentProvider:
    | GitRemoteCommandEnvironmentProvider
    | undefined;
  const gitClient = new GitCliClient({
    remoteEnvironmentProvider: (context) =>
      remoteEnvironmentProvider?.(context) ??
      Promise.resolve(undefined)
  });
  const userDataPath = app.getPath("userData");
  const diagnostics = new RotatingDiagnosticLogger(
    join(userDataPath, "logs", "gitnest.log"),
    {
      redactedPaths: [
        app.getPath("home"),
        app.getPath("temp"),
        userDataPath
      ]
    }
  );
  const windowState = new JsonWindowStateStore(
    join(userDataPath, "settings", "window-state.json")
  );
  const settings = new AppSettingsService(
    join(userDataPath, "settings", "app-settings.json")
  );
  const workspaceStore = new JsonWorkspaceStore(
    join(
      userDataPath,
      "workspaces",
      "default.workspace.json"
    )
  );
  const snapshotStore = new JsonRepositorySnapshotStore(
    join(
      userDataPath,
      "cache",
      "repository-snapshots",
      "default.snapshots.json"
    )
  );
  const operationStore = new JsonWorkspaceOperationStore(
    join(
      userDataPath,
      "operations",
      "default.operations.json"
    )
  );
  const workspace = new WorkspaceRuntimeService(
    new WorkspaceService(
      gitClient,
      new NodeWorkspaceFileSystem(),
      workspaceStore
    ),
    gitClient,
    snapshotStore,
    new NodeWorkspaceWatcher(),
    { operationStore }
  );
  const worktreePaths = new NodeWorktreePathPolicy();
  const externalTerminalAdapter =
    new WindowsExternalTerminalAdapter({
      gitExecutablePath: async () =>
        (await gitClient.getEnvironment()).executablePath
    });
  const accounts = new AccountService(
    new JsonAccountMetadataStore(
      join(userDataPath, "accounts", "metadata.json")
    ),
    new SafeStorageCredentialVault(
      join(userDataPath, "accounts", "credentials"),
      safeStorage
    ),
    new WindowsGitAskPassBroker(
      join(userDataPath, "runtime", "askpass")
    ),
    {
      test: (input) =>
        gitClient.testRemoteConnection(input)
    },
    {
      idFactory: randomUUID
    }
  );
  remoteEnvironmentProvider = async (context) => {
    const current = await workspace.getCurrent();
    const repositoryPath = normalizePathForComparison(
      context.repositoryPath
    );
    const worktree = current.worktrees.find(
      (candidate) =>
        normalizePathForComparison(candidate.path) ===
        repositoryPath
    );
    if (!worktree) {
      return undefined;
    }
    return accounts.openAuthenticationSession(
      worktree.repositoryId,
      context.remoteUrl,
      context.signal
    );
  };

  const operationStates = new Map<string, string>();
  workspace.subscribe((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(
          IPC_EVENTS.workspaceStateChanged,
          state
        );
      }
    }
    for (const operation of state.operations) {
      if (
        operationStates.get(operation.id) ===
        operation.state
      ) {
        continue;
      }
      operationStates.set(operation.id, operation.state);
      void diagnostics
        .info("workspace.operation-state", {
          operationId: operation.id,
          kind: operation.kind,
          scope: operation.scope,
          state: operation.state,
          targetCount: operation.targetIds.length,
          succeeded: operation.succeeded,
          failed: operation.failed
        })
        .catch(() => undefined);
    }
  });

  return {
    accounts,
    aiCommitMessages: new AiCommitMessageService(
      settings,
      workspace,
      gitClient
    ),
    diagnostics,
    externalApplication: new ExternalApplicationService(
      workspace,
      new WindowsExternalApplicationAdapter(
        externalTerminalAdapter
      )
    ),
    externalTerminal: new ExternalTerminalService(
      workspace,
      externalTerminalAdapter
    ),
    gitInspection: new GitInspectionService(gitClient),
    repositoryCommands: new RepositoryCommandService(
      workspace,
      gitClient,
      gitClient,
      {
        idFactory: randomUUID
      }
    ),
    repositoryMutations: new RepositoryMutationService(
      workspace,
      gitClient,
      gitClient
    ),
    repositoryQueries: new RepositoryQueryService(
      workspace,
      gitClient
    ),
    settings,
    worktreeCommands: new WorktreeCommandService(
      workspace,
      gitClient,
      gitClient,
      gitClient,
      worktreePaths,
      {
        idFactory: randomUUID
      }
    ),
    worktreePaths,
    windowState,
    workspace
  };
}

function normalizePathForComparison(path: string): string {
  return normalize(resolve(path)).toLocaleLowerCase("en-US");
}
