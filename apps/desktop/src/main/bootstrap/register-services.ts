import {
  app,
  BrowserWindow,
  safeStorage,
  shell,
  utilityProcess
} from "electron";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  dirname,
  join
} from "node:path";

import {
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
import {
  DEFAULT_CODE_ANALYSIS_AUTO_REFRESH_DEBOUNCE_MS,
  IPC_EVENTS
} from "@gitnest/contracts";
import { GitCliClient } from "@gitnest/git-cli";
import {
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
import { NodeWorkspaceWatcher } from "../adapters/watcher.adapter";
import {
  CodeAnalysisAutoRefreshScheduler,
  CodeAnalysisPeriodicRefreshScheduler,
  analysisSelectionKey,
  shouldAutoRefresh,
  waitForAnalysisCompletion
} from "../code-analysis/auto-refresh";
import { RotatingDiagnosticLogger } from "../adapters/diagnostic-logger.adapter";
import { AiCommitMessageService } from "../ai/ai-commit-message-service";
import codeAnalysisProcessPath from "../code-analysis/code-analysis-process-entry?modulePath";
import { LanguageServerInstaller } from "../code-analysis/language-server-installer";
import { McpRegistrationService } from "../code-analysis/mcp-registration";
import { installedLanguageServerSettingsPatch } from "../code-analysis/language-server-settings";
import { UtilityProcessCodeAnalysisRunner } from "../code-analysis/utility-process-code-analysis-runner";
import { AppSettingsService } from "../settings/app-settings";
import {
  createDataRegistry,
  type GitNestDataRegistry
} from "../storage/data-registry";
import { JsonWindowStateStore } from "../windows/window-state";
import {
  ApplicationUpdateService,
  detectApplicationUpdateDistribution
} from "../update/application-update-service";

export interface ApplicationServices {
  aiCommitMessages: AiCommitMessageService;
  applicationUpdate: ApplicationUpdateService;
  codeAnalysis: CodeAnalysisService;
  codeAnalysisRefresh: {
    dispose(): void;
  };
  dataRegistry: GitNestDataRegistry;
  diagnostics: RotatingDiagnosticLogger;
  externalApplication: ExternalApplicationService;
  externalTerminal: ExternalTerminalService;
  gitInspection: GitInspectionService;
  languageServerInstaller: LanguageServerInstaller;
  mcpRegistration: McpRegistrationService;
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
  const gitClient = new GitCliClient();
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
  const applicationUpdate = new ApplicationUpdateService({
    currentVersion: app.getVersion(),
    distribution:
      detectApplicationUpdateDistribution(app.isPackaged),
    platform: process.platform,
    architecture: process.arch,
    stateFilePath:
      dataRegistry.paths.applicationUpdateState,
    downloadDirectory:
      dataRegistry.paths.applicationUpdateDownloads,
    launchInstaller: (path) =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn(path, [], {
          detached: true,
          shell: false,
          stdio: "ignore",
          windowsHide: false
        });
        child.once("error", rejectPromise);
        child.once("spawn", () => {
          child.unref();
          resolvePromise();
        });
      }),
    openExternal: (url) => shell.openExternal(url),
    requestQuit: () => {
      setImmediate(() => app.quit());
    },
    onDiagnostic: ({ level, name, context }) => {
      void (
        level === "warning"
          ? diagnostics.warning(name, context)
          : diagnostics.info(name, context)
      ).catch(() => undefined);
    }
  });
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
  const mcpRegistration = new McpRegistrationService({
    executablePath: process.execPath,
    entryScriptPath: join(
      dirname(process.execPath),
      "resources",
      "mcp",
      "gitnest-mcp.mjs"
    ),
    dataDirectory: userDataPath,
    packaged: app.isPackaged
  });
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
  const runAutomaticCodeAnalysisRefresh = async (
    signal: AbortSignal
  ): Promise<void> => {
    let state = await codeAnalysis.getState();
    if (signal.aborted) {
      return;
    }
    if (state.state === "running" && state.analysisId) {
      await waitForAnalysisCompletion(
        (listener) => codeAnalysis.subscribe(listener),
        state.analysisId,
        signal
      );
      if (signal.aborted) {
        return;
      }
      state = await codeAnalysis.getState();
      if (state.state === "running") {
        return;
      }
    }
    const incremental = await codeAnalysis.refresh(
      "changed",
      signal
    );
    if (
      signal.aborted ||
      !incremental ||
      incremental.workspaceSnapshotUpdated
    ) {
      return;
    }
    await codeAnalysis.refresh("workspace", signal);
  };

  // Keep the full MCP graph and the focused changed graph current
  // without changing the scope currently displayed by the renderer.
  const codeAnalysisAutoRefresh =
    new CodeAnalysisAutoRefreshScheduler({
      debounceMs:
        DEFAULT_CODE_ANALYSIS_AUTO_REFRESH_DEBOUNCE_MS,
      enabled: async () => {
        const preferences = (await settings.get()).settings
          .codeAnalysis;
        if (!preferences.enabled) {
          return false;
        }
        codeAnalysisAutoRefresh.setDebounceMs(
          preferences.autoRefresh.debounceMs
        );
        return preferences.autoRefresh.enabled;
      },
      run: runAutomaticCodeAnalysisRefresh,
      onError: (error) => {
        void diagnostics
          .warning("code-analysis.auto-refresh-failed", {
            error
          })
          .catch(() => undefined);
      }
    });
  const codeAnalysisPeriodicRefresh =
    new CodeAnalysisPeriodicRefreshScheduler({
      configuration: async () => {
        const preferences = (await settings.get()).settings
          .codeAnalysis;
        const currentWorkspace = await workspace.getCurrent();
        return {
          enabled:
            preferences.enabled &&
            preferences.autoRefresh.periodicEnabled &&
            shouldAutoRefresh(currentWorkspace),
          intervalMs:
            preferences.autoRefresh
              .periodicIntervalMinutes *
            60_000
        };
      },
      run: runAutomaticCodeAnalysisRefresh,
      onError: (error) => {
        void diagnostics
          .warning("code-analysis.periodic-refresh-failed", {
            error
          })
          .catch(() => undefined);
      }
    });
  codeAnalysisPeriodicRefresh.start();
  const codeAnalysisRefresh = {
    dispose(): void {
      codeAnalysisAutoRefresh.dispose();
      codeAnalysisPeriodicRefresh.dispose();
    }
  };
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
  const operationStates = new Map<string, string>();
  let lastSelectionKey: string | undefined;
  let lastWatchEventAt: string | undefined;
  workspace.subscribe((state) => {
    codeAnalysis.handleWorkspaceChanged(state.workspace);
    const selectionKey = analysisSelectionKey(
      state.workspace
    );
    if (
      lastSelectionKey !== undefined &&
      selectionKey !== lastSelectionKey
    ) {
      // The queued refresh belongs to the previous selection.
      codeAnalysisAutoRefresh.cancel();
      codeAnalysisPeriodicRefresh.reset();
    }
    lastSelectionKey = selectionKey;
    const lastEventAt = state.monitor.lastEventAt;
    if (
      lastEventAt !== undefined &&
      lastEventAt !== lastWatchEventAt
    ) {
      lastWatchEventAt = lastEventAt;
      if (shouldAutoRefresh(state.workspace)) {
        codeAnalysisAutoRefresh.request();
      }
    }
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
  applicationUpdate.subscribe((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(
          IPC_EVENTS.applicationUpdateStateChanged,
          state
        );
      }
    }
  });
  return {
    aiCommitMessages: new AiCommitMessageService(
      settings,
      workspace,
      gitClient
    ),
    applicationUpdate,
    codeAnalysis,
    codeAnalysisRefresh,
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
    mcpRegistration,
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
