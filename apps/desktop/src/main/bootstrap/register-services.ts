import {
  app,
  BrowserWindow,
  safeStorage,
  utilityProcess
} from "electron";
import { randomUUID } from "node:crypto";
import {
  normalize,
  resolve
} from "node:path";

import {
  AccountService,
  CodeAnalysisService,
  ExternalApplicationService,
  ExternalTerminalService,
  GitInspectionService,
  RepositoryCommandService,
  RepositoryMutationService,
  RepositoryQueryService,
  WorktreeCommandService,
  WorkspaceCollectionService,
  WorkspaceRuntimeService,
} from "@gitnest/application";
import { AnalysisSnapshotCache } from "@gitnest/code-analysis";
import { IPC_EVENTS } from "@gitnest/contracts";
import {
  GitCliClient,
  type GitRemoteCommandEnvironmentProvider
} from "@gitnest/git-cli";
import {
  JsonAccountMetadataStore,
  JsonWorkspaceCollectionStore,
  JsonWorkspaceOperationCollectionStore,
  JsonWorkspaceSnapshotCollectionStore
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
import codeAnalysisProcessPath from "../code-analysis/code-analysis-process-entry?modulePath";
import { LanguageServerInstaller } from "../code-analysis/language-server-installer";
import { installedLanguageServerSettingsPatch } from "../code-analysis/language-server-settings";
import { UtilityProcessCodeAnalysisRunner } from "../code-analysis/utility-process-code-analysis-runner";
import { AppSettingsService } from "../settings/app-settings";
import {
  createDataRegistry,
  type GitNestDataRegistry
} from "../storage/data-registry";
import { JsonWindowStateStore } from "../windows/window-state";

export interface ApplicationServices {
  accounts: AccountService;
  aiCommitMessages: AiCommitMessageService;
  codeAnalysis: CodeAnalysisService;
  dataRegistry: GitNestDataRegistry;
  diagnostics: RotatingDiagnosticLogger;
  externalApplication: ExternalApplicationService;
  externalTerminal: ExternalTerminalService;
  gitInspection: GitInspectionService;
  languageServerInstaller: LanguageServerInstaller;
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
  const dataRegistry = createDataRegistry(userDataPath);
  const diagnostics = new RotatingDiagnosticLogger(
    dataRegistry.paths.diagnosticLog,
    {
      redactedPaths: [
        app.getPath("home"),
        app.getPath("temp"),
        userDataPath
      ]
    }
  );
  const windowState = new JsonWindowStateStore(
    dataRegistry.paths.windowState
  );
  const credentialVault = new SafeStorageCredentialVault(
    dataRegistry.paths.credentialVault,
    safeStorage
  );
  const settings = new AppSettingsService(
    dataRegistry.paths.appSettings,
    credentialVault
  );
  const workspaceStore = new JsonWorkspaceCollectionStore({
    catalogFilePath: dataRegistry.paths.workspaceCatalog,
    workspaceDirectory: dataRegistry.paths.workspaceDocuments,
    legacyWorkspaceFilePath:
      dataRegistry.paths.defaultWorkspace
  });
  const snapshotStore =
    new JsonWorkspaceSnapshotCollectionStore({
      directoryPath: dataRegistry.paths.repositorySnapshots,
      legacyFilePath:
        dataRegistry.paths.defaultRepositorySnapshots
    });
  const operationStore =
    new JsonWorkspaceOperationCollectionStore({
      directoryPath: dataRegistry.paths.workspaceOperations,
      legacyFilePath:
        dataRegistry.paths.defaultWorkspaceOperations
    });
  const workspace = new WorkspaceRuntimeService(
    new WorkspaceCollectionService(
      gitClient,
      new NodeWorkspaceFileSystem(),
      workspaceStore
    ),
    gitClient,
    snapshotStore,
    new NodeWorkspaceWatcher(),
    {
      operationStore,
      onDiagnostic: ({ level, name, context }) => {
        void (
          level === "warning"
            ? diagnostics.warning(name, context)
            : diagnostics.info(name, context)
        ).catch(() => undefined);
      }
    }
  );
  const worktreePaths = new NodeWorktreePathPolicy();
  const codeAnalysisRunner =
    new UtilityProcessCodeAnalysisRunner({
      spawn: () =>
        utilityProcess.fork(codeAnalysisProcessPath, [], {
          execArgv: ["--max-old-space-size=512"],
          serviceName: "GitNest Code Analysis",
          stdio: ["ignore", "pipe", "pipe"]
      }),
      onDiagnostic: ({ name, context }) => {
        void (
          name === "code-analysis.process-spawned"
            ? diagnostics.info(name, context)
            : diagnostics.warning(name, context)
        ).catch(() => undefined);
      }
    });
  const codeAnalysisCacheDirectory =
    dataRegistry.paths.codeAnalysisIndex;
  const codeAnalysis = new CodeAnalysisService(
    workspace,
    gitClient,
    {
      cacheDirectory: codeAnalysisCacheDirectory,
      snapshotStore: new AnalysisSnapshotCache(
        dataRegistry.paths.codeAnalysisSnapshots,
        {
          fallbackDirectories: [
            codeAnalysisCacheDirectory
          ]
        }
      ),
      lspDataDirectory: dataRegistry.paths.lspRuntime,
      runner: codeAnalysisRunner,
      settingsProvider: async () => {
        const preferences = (await settings.get()).settings
          .codeAnalysis;
        return {
          enabled: preferences.enabled,
          staticFallback: preferences.staticFallback,
          maxFiles: preferences.maxFiles,
          maxTotalSourceBytes:
            preferences.maxTotalSourceMb * 1_024 * 1_024,
          maxGraphNodes: preferences.maxGraphNodes,
          maxGraphEdges: preferences.maxGraphEdges,
          maxRequestChains: preferences.maxRequestChains,
          maxDiagnostics: preferences.maxDiagnostics,
          maxFileSizeBytes:
            preferences.maxFileSizeKb * 1_024,
          readConcurrency: preferences.readConcurrency,
          graphDepth: preferences.graphDepth,
          lspTimeoutMs: preferences.lspTimeoutMs,
          ignoreDirectories: [
            ...preferences.ignoreDirectories
          ],
          typescript: {
            ...preferences.typescript,
            args: [...preferences.typescript.args]
          },
          java: {
            ...preferences.java,
            args: [...preferences.java.args]
          },
          ...(preferences.vue
            ? {
                vue: {
                  ...preferences.vue,
                  args: [...preferences.vue.args]
                }
              }
            : {}),
          ...(preferences.python
            ? {
                python: {
                  ...preferences.python,
                  args: [...preferences.python.args]
                }
              }
            : {}),
          ...(preferences.go
            ? {
                go: {
                  ...preferences.go,
                  args: [...preferences.go.args]
                }
              }
            : {}),
          ...(preferences.kotlin
            ? {
                kotlin: {
                  ...preferences.kotlin,
                  args: [...preferences.kotlin.args]
                }
              }
            : {}),
          ...(preferences.csharp
            ? {
                csharp: {
                  ...preferences.csharp,
                  args: [...preferences.csharp.args]
                }
              }
            : {}),
          ...(preferences.rust
            ? {
                rust: {
                  ...preferences.rust,
                  args: [...preferences.rust.args]
                }
              }
            : {})
        };
      },
      settingsValidator: (preferences) =>
        settings.assertLanguageServerLaunchesApproved(
          preferences
        ),
      idFactory: randomUUID
    }
  );
  const languageServerInstaller =
    new LanguageServerInstaller({
      runtimeDirectory: dataRegistry.paths.languageServers,
      updateLanguageServerSettings: async (
        language,
        command,
        args
      ) => {
        await settings.update(
          {
            codeAnalysis:
              installedLanguageServerSettingsPatch(
                language,
                command,
                args
              )
          },
          {
            approvedLanguageServerLaunches: [
              {
                language,
                command,
                args: [...args]
              }
            ]
          }
        );
      }
    });
  const externalTerminalAdapter =
    new WindowsExternalTerminalAdapter({
      gitExecutablePath: async () =>
        (await gitClient.getEnvironment()).executablePath
    });
  const accounts = new AccountService(
    new JsonAccountMetadataStore(
      dataRegistry.paths.accountMetadata
    ),
    credentialVault,
    new WindowsGitAskPassBroker(
      dataRegistry.paths.askpassRuntime
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
    codeAnalysis.handleWorkspaceChanged(state.workspace);
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
  codeAnalysis.subscribe((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(
          IPC_EVENTS.codeAnalysisStateChanged,
          state
        );
      }
    }
  });
  return {
    accounts,
    aiCommitMessages: new AiCommitMessageService(
      settings,
      workspace,
      gitClient
    ),
    codeAnalysis,
    dataRegistry,
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
    languageServerInstaller,
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
      gitClient,
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
