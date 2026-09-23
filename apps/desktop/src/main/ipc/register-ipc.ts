import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent
} from "electron";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  dirname,
  isAbsolute,
  normalize,
  relative,
  resolve,
  sep
} from "node:path";

import {
  MAX_CODE_ANALYSIS_DIAGNOSTICS,
  MAX_CODE_ANALYSIS_GRAPH_EDGES,
  MAX_CODE_ANALYSIS_GRAPH_NODES,
  MAX_CODE_ANALYSIS_REQUEST_CHAINS,
  MAX_CODE_ANALYSIS_TOTAL_SOURCE_MB,
  MAX_LSP_DOCUMENTS,
  MAX_CODE_ANALYSIS_AUTO_REFRESH_DEBOUNCE_MS,
  MAX_MCP_MAX_RESPONSE_KB,
  MAX_LSP_REFERENCES_PER_SYMBOL,
  MAX_LSP_REQUESTS,
  MAX_LSP_SYMBOLS_PER_DOCUMENT,
  MAX_DIFF_COMMIT_PANEL_HEIGHT,
  MIN_CODE_ANALYSIS_DIAGNOSTICS,
  MIN_CODE_ANALYSIS_AUTO_REFRESH_DEBOUNCE_MS,
  MIN_MCP_MAX_RESPONSE_KB,
  MIN_CODE_ANALYSIS_GRAPH_EDGES,
  MIN_CODE_ANALYSIS_GRAPH_NODES,
  MIN_CODE_ANALYSIS_REQUEST_CHAINS,
  MIN_CODE_ANALYSIS_TOTAL_SOURCE_MB,
  MIN_LSP_DOCUMENTS,
  MIN_LSP_REFERENCES_PER_SYMBOL,
  MIN_LSP_REQUESTS,
  MIN_LSP_SYMBOLS_PER_DOCUMENT,
  MIN_DIFF_COMMIT_PANEL_HEIGHT,
  IPC_CHANNELS,
  IPC_EVENTS,
  LANGUAGE_SERVER_LANGUAGES,
  type AiCommitMessageDto,
  type AiConnectionTestResultDto,
  type AcknowledgeApplicationUpdatePromptRequest,
  type AccountRemovalImpactRequest,
  type AddWorkspaceDirectoryRequest,
  type AppSettingsDto,
  type AppSettingsLoadDto,
  type AppThemeDto,
  type BindAccountRequest,
  type CancelCodeAnalysisRequest,
  type McpRegistrationStatusDto,
  type CancelRepositoryOperationRequest,
  type CancelRepositoryQueryRequest,
  type ClearAiApiKeyRequest,
  type CodeAnalysisAcceptedDto,
  type CodeAnalysisFileDto,
  type CodeAnalysisScopeDto,
  type CodeAnalysisSnapshotDto,
  type CodeAnalysisStateDto,
  type CreateWorkspaceRequest,
  type CreateRepositoryCommitRequest,
  type DeleteWorkspaceRequest,
  type GitReadErrorDto,
  type GitReadResult,
  type GenerateAiCommitMessageRequest,
  type InstallLanguageServerRequest,
  type InstallableLanguageServerDto,
  type LanguageServerInstallResultDto,
  type ExternalApplicationKindDto,
  type ExternalTerminalKindDto,
  type DiffFileViewDto,
  type DiffLayoutDto,
  type GitFetchModeDto,
  type GitPushStrategyDto,
  type IpcArguments,
  type IpcChannel,
  type IpcResult,
  type OpenDirectoryRequest,
  type OpenDiffViewerRequest,
  type OpenExternalApplicationRequest,
  type OpenExternalTerminalRequest,
  type OpenFileLocationRequest,
  type RemoveWorkspaceRepositoryRequest,
  type RemoveAccountRequest,
  type RenameWorkspaceRequest,
  type RepositoryInspectionRequest,
  type RepositoryCommitRequest,
  type RepositoryCommandDto,
  type RepositoryCommandExecuteRequest,
  type RepositoryCommandPreflightRequest,
  type RepositoryCommitDiffRequest,
  type RepositoryDiffRequest,
  type RepositoryHistoryRequest,
  type RepositoryStashDiffRequest,
  type RepositoryStashMutationRequest,
  type RepositoryStashRequest,
  type RepositoryStashesRequest,
  type RepositoryPathsMutationRequest,
  type RepositoryQueryRequest,
  type RepositoryTabDto,
  type ReadCodeAnalysisFileRequest,
  type RestoreCodeAnalysisSnapshotRequest,
  type RuntimeInfo,
  type RuntimePlatform,
  type SaveAccountRequest,
  type SetMcpRegistrationRequest,
  type StartCodeAnalysisRequest,
  type RepositoryTargetDto,
  type SelectRepositoryTargetRequest,
  type SetWorkspaceGroupCollapsedRequest,
  type SwitchWorkspaceRequest,
  type TestAccountRequest,
  type TestAiConnectionRequest,
  type UnbindAccountRequest,
  type UpdateAppSettingsRequest,
  type LastContentViewDto,
  type WorkspaceTabDto,
  type WorkspaceErrorDto,
  type WorkspaceResult,
  type WorktreeCommandDto,
  type WorktreeCommandExecuteRequest,
  type WorktreeCommandPreflightRequest
} from "@gitnest/contracts";
import { GitError } from "@gitnest/git-core";
import { WorkspaceError } from "@gitnest/workspace-core";

import type { ApplicationServices } from "../bootstrap/register-services";
import type { LanguageServerLaunchApprovalRequest } from "../settings/app-settings";
import {
  selectWorkspaceDirectory,
  selectWorktreeDirectory
} from "../adapters/dialog.adapter";
import { openDiffViewerWindow } from "../windows/diff-viewer-window";

let registered = false;
const MAX_MUTATION_PATHS = 200;
const MAX_MUTATION_PATH_LENGTH = 4_096;
const MAX_COMMIT_SUBJECT_LENGTH = 200;
const MAX_COMMIT_BODY_LENGTH = 100_000;
const MAX_REPOSITORY_COMMAND_TARGETS = 50;
const MAX_REPOSITORY_COMMAND_NAME_LENGTH = 255;
const MAX_REPOSITORY_REVISION_LENGTH = 4_096;
const MAX_OPERATION_ID_LENGTH = 160;
const MAX_REPOSITORY_TARGET_ID_LENGTH = 512;
const MAX_WORKSPACE_ID_LENGTH = 160;
const MAX_WORKSPACE_NAME_LENGTH = 120;
const MAX_WORKSPACE_PATH_LENGTH = 32_767;
const MAX_WORKTREE_PATH_LENGTH = 32_767;
const EXTERNAL_TERMINAL_KINDS = new Set([
  "windows-terminal",
  "powershell",
  "cmd",
  "git-bash"
]);
const EXTERNAL_APPLICATION_KINDS = new Set([
  "vscode",
  "cursor",
  "intellij-idea",
  "sublime-text",
  "file-explorer",
  "terminal",
  "git-bash"
]);
const ACCOUNT_PROVIDERS = new Set([
  "github",
  "gitlab",
  "gitee",
  "custom"
]);
const ACCOUNT_AUTH_TYPES = new Set([
  "https-token",
  "system-ssh"
]);
const MAX_ACCOUNT_HOST_LENGTH = 320;
const MAX_ACCOUNT_USERNAME_LENGTH = 255;
const MAX_ACCOUNT_TOKEN_LENGTH = 8_192;
const MAX_ACCOUNT_REPOSITORY_URL_LENGTH = 4_096;
const MAX_AI_API_URL_LENGTH = 2_048;
const MAX_AI_MODEL_LENGTH = 256;
const MAX_AI_API_KEY_LENGTH = 8_192;
const MAX_AI_PROMPT_LENGTH = 12_000;
const MAX_LSP_COMMAND_LENGTH = 2_048;
const MAX_LSP_ARGUMENTS = 64;
const MAX_LSP_ARGUMENT_LENGTH = 2_048;
const MAX_LSP_APPROVAL_DETAIL_LENGTH = 8_000;
const MAX_ANALYSIS_IGNORE_DIRECTORIES = 100;
const MAX_ANALYSIS_IGNORE_LENGTH = 255;
const MAX_ANALYSIS_NODE_ID_LENGTH = 512;
const APP_THEMES = new Set(["dark", "light"]);
const DIFF_FILE_VIEWS = new Set(["list", "tree"]);
const DIFF_LAYOUTS = new Set(["split", "unified"]);
const GIT_FETCH_MODES = new Set(["manual", "startup"]);
const GIT_PUSH_STRATEGIES = new Set(["rebase", "merge"]);
const LAST_CONTENT_VIEWS = new Set([
  "workspace",
  "repository"
]);
const WORKSPACE_TABS = new Set([
  "overview",
  "repositories",
  "activity",
  "worktrees"
]);
const REPOSITORY_TABS = new Set([
  "overview",
  "changes",
  "history",
  "branches",
  "worktrees"
]);
const CODE_ANALYSIS_SCOPES = new Set([
  "changed",
  "workspace"
]);
const INSTALLABLE_LANGUAGE_SERVERS = new Set<string>(
  LANGUAGE_SERVER_LANGUAGES
);

export function registerIpcHandlers(
  services: ApplicationServices
): void {
  if (registered) {
    return;
  }

  registered = true;

  registerHandler(
    IPC_CHANNELS.settingsGet,
    (): Promise<GitReadResult<AppSettingsLoadDto>> =>
      captureGitRead(() => services.settings.get())
  );

  registerHandler(
    IPC_CHANNELS.settingsUpdate,
    (
      event,
      request
    ): Promise<GitReadResult<AppSettingsDto>> =>
      captureAppSettingsMutation(async () => {
        const patch =
          validateUpdateAppSettingsRequest(request);
        const launches =
          await services.settings.languageServerLaunchesRequiringApproval(
            patch
          );
        if (launches.length > 0) {
          await confirmLanguageServerLaunches(
            getSenderWindow(event),
            launches
          );
        }
        return services.settings.update(patch, {
          approvedLanguageServerLaunches: launches
        });
      })
  );

  registerHandler(
    IPC_CHANNELS.settingsClearAiApiKey,
    (
      _event,
      request
    ): Promise<GitReadResult<AppSettingsDto>> =>
      captureAppSettingsMutation(() =>
        services.settings.clearAiApiKey(
          validateClearAiApiKeyRequest(request).confirmed
        )
      )
  );

  registerHandler(
    IPC_CHANNELS.aiTestConnection,
    (
      _event,
      request
    ): Promise<GitReadResult<AiConnectionTestResultDto>> =>
      captureGitRead(() =>
        services.aiCommitMessages.testConnection(
          validateTestAiConnectionRequest(request)
        )
      )
  );

  registerHandler(
    IPC_CHANNELS.aiGenerateCommitMessage,
    (
      _event,
      request
    ): Promise<GitReadResult<AiCommitMessageDto>> =>
      captureGitRead(() =>
        services.aiCommitMessages.generateCommitMessage(
          validateGenerateAiCommitMessageRequest(request).target
        )
      )
  );

  registerHandler(
    IPC_CHANNELS.codeAnalysisGetState,
    (): Promise<GitReadResult<CodeAnalysisStateDto>> =>
      captureGitRead(async () =>
        services.codeAnalysis.getState()
      )
  );

  registerHandler(
    IPC_CHANNELS.codeAnalysisStart,
    (
      _event,
      request
    ): Promise<GitReadResult<CodeAnalysisAcceptedDto>> =>
      captureGitRead(() =>
        services.codeAnalysis.start(
          validateStartCodeAnalysisRequest(request).scope
        )
      )
  );

  registerHandler(
    IPC_CHANNELS.codeAnalysisRestoreSnapshot,
    (
      _event,
      request
    ): Promise<GitReadResult<boolean>> =>
      captureGitRead(() =>
        services.codeAnalysis.restoreSnapshot(
          validateRestoreCodeAnalysisSnapshotRequest(
            request
          ).scope
        )
      )
  );

  registerHandler(
    IPC_CHANNELS.codeAnalysisCancel,
    (
      _event,
      request
    ): Promise<GitReadResult<void>> =>
      captureGitRead(async () => {
        services.codeAnalysis.cancel(
          validateCancelCodeAnalysisRequest(request)
            .analysisId
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.codeAnalysisGetSnapshot,
    (): Promise<
      GitReadResult<CodeAnalysisSnapshotDto | null>
    > =>
      captureGitRead(() =>
        services.codeAnalysis.getSnapshot()
      )
  );

  registerHandler(
    IPC_CHANNELS.codeAnalysisReadFile,
    (
      _event,
      request
    ): Promise<GitReadResult<CodeAnalysisFileDto>> =>
      captureGitRead(() =>
        services.codeAnalysis.readFile(
          validateReadCodeAnalysisFileRequest(request)
            .nodeId
        )
      )
  );

  registerHandler(
    IPC_CHANNELS.codeAnalysisInstallLanguageServer,
    (
      _event,
      request
    ): Promise<
      GitReadResult<LanguageServerInstallResultDto>
    > =>
      captureGitRead(() =>
        services.languageServerInstaller.install(
          validateInstallLanguageServerRequest(request)
            .language
        )
      )
  );

  registerHandler(
    IPC_CHANNELS.systemGetRuntimeInfo,
    (): RuntimeInfo => ({
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      platform: process.platform as RuntimePlatform
    })
  );

  registerHandler(
    IPC_CHANNELS.codeAnalysisGetMcpRegistration,
    (): Promise<GitReadResult<McpRegistrationStatusDto>> =>
      captureGitRead(() => services.mcpRegistration.status())
  );

  registerHandler(
    IPC_CHANNELS.codeAnalysisSetMcpRegistration,
    (
      _event,
      request
    ): Promise<GitReadResult<McpRegistrationStatusDto>> =>
      captureGitRead(() =>
        services.mcpRegistration.setRegistered(
          validateSetMcpRegistrationRequest(request).registered
        )
      )
  );

  registerHandler(
    IPC_CHANNELS.updateGetState,
    () => services.applicationUpdate.getState()
  );

  registerHandler(
    IPC_CHANNELS.updateCheck,
    () => services.applicationUpdate.check("manual")
  );

  registerHandler(
    IPC_CHANNELS.updateAcknowledgePrompt,
    (_event, request) =>
      services.applicationUpdate.acknowledgePrompt(
        validateAcknowledgeApplicationUpdatePromptRequest(
          request
        ).version
      )
  );

  registerHandler(
    IPC_CHANNELS.updateDownloadAndInstall,
    () =>
      services.applicationUpdate.downloadAndInstall()
  );

  registerHandler(
    IPC_CHANNELS.updateOpenProjectPage,
    () => services.applicationUpdate.openProjectPage()
  );

  registerHandler(
    IPC_CHANNELS.updateOpenReleasePage,
    () => services.applicationUpdate.openReleasePage()
  );

  registerHandler(
    IPC_CHANNELS.systemListExternalApplications,
    () =>
      captureGitRead(async () =>
        (
          await services.externalApplication.listAvailable()
        ).map((profile) => ({
          kind: profile.kind,
          label: profile.label,
          ...(profile.iconDataUrl
            ? { iconDataUrl: profile.iconDataUrl }
            : {})
        }))
      )
  );

  registerHandler(
    IPC_CHANNELS.systemOpenExternalApplication,
    (_event, request) =>
      captureGitRead(() => {
        const input =
          validateOpenExternalApplicationRequest(request);
        return services.externalApplication.open(
          input.context,
          input.kind
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.systemListExternalTerminals,
    () =>
      captureGitRead(async () =>
        (await services.externalTerminal.listAvailable()).map(
          (profile) => ({
            kind: profile.kind,
            label: profile.label
          })
        )
      )
  );

  registerHandler(
    IPC_CHANNELS.systemOpenExternalTerminal,
    (_event, request) =>
      captureGitRead(() => {
        const input =
          validateOpenExternalTerminalRequest(request);
        return services.externalTerminal.open(
          input.target,
          input.kind
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.systemOpenDirectory,
    (_event, request) =>
      captureGitRead(async () => {
        const input = validateOpenDirectoryRequest(request);
        const workspace = await services.workspace.getCurrent();
        const worktree = workspace.worktrees.find(
          (candidate) =>
            candidate.repositoryId ===
              input.target.repositoryId &&
            candidate.id === input.target.worktreeId
        );

        if (!worktree) {
          throw new GitError(
            "DIRECTORY_UNAVAILABLE",
            "The requested Worktree directory is unavailable."
          );
        }

        const openError = await shell.openPath(
          worktree.path
        );
        if (openError) {
          throw new GitError(
            "DIRECTORY_UNAVAILABLE",
            openError
          );
        }
      })
  );

  registerHandler(
    IPC_CHANNELS.systemOpenFileLocation,
    (_event, request) =>
      captureGitRead(async () => {
        const input =
          validateOpenFileLocationRequest(request);
        const workspace = await services.workspace.getCurrent();
        const worktree = workspace.worktrees.find(
          (candidate) =>
            candidate.repositoryId ===
              input.target.repositoryId &&
            candidate.id === input.target.worktreeId
        );

        if (!worktree) {
          throw new GitError(
            "DIRECTORY_UNAVAILABLE",
            "The requested Worktree directory is unavailable."
          );
        }

        const rootPath = resolve(worktree.path);
        const filePath = resolve(rootPath, input.path);
        const pathFromRoot = relative(rootPath, filePath);
        if (
          !pathFromRoot ||
          pathFromRoot === ".." ||
          pathFromRoot.startsWith(`..${sep}`) ||
          isAbsolute(pathFromRoot)
        ) {
          throw new GitError(
            "INVALID_REQUEST",
            "File locations must stay inside the selected Worktree."
          );
        }

        let fileExists = true;
        try {
          await stat(filePath);
        } catch (error) {
          if (!isMissingFilesystemPath(error)) {
            throw new GitError(
              "DIRECTORY_UNAVAILABLE",
              "The requested file location is unavailable."
            );
          }
          fileExists = false;
        }

        if (fileExists) {
          shell.showItemInFolder(filePath);
          return;
        }

        const parentPath = dirname(filePath);
        let openError = await shell.openPath(parentPath);
        if (openError && parentPath !== rootPath) {
          openError = await shell.openPath(rootPath);
        }
        if (openError) {
          throw new GitError(
            "DIRECTORY_UNAVAILABLE",
            openError
          );
        }
      })
  );

  registerHandler(IPC_CHANNELS.accountList, () =>
    captureGitRead(() => services.accounts.list())
  );

  registerHandler(
    IPC_CHANNELS.accountSave,
    (_event, request) =>
      captureGitRead(() =>
        services.accounts.save(
          validateSaveAccountRequest(request)
        )
      )
  );

  registerHandler(
    IPC_CHANNELS.accountBind,
    (_event, request) =>
      captureGitRead(() =>
        services.accounts.bind(
          validateBindAccountRequest(request)
        )
      )
  );

  registerHandler(
    IPC_CHANNELS.accountUnbind,
    (_event, request) =>
      captureGitRead(() =>
        services.accounts.unbind(
          validateUnbindAccountRequest(request)
        )
      )
  );

  registerHandler(
    IPC_CHANNELS.accountGetRemovalImpact,
    (_event, request) =>
      captureGitRead(() =>
        services.accounts.getRemovalImpact(
          validateAccountRemovalImpactRequest(request)
            .accountId
        )
      )
  );

  registerHandler(
    IPC_CHANNELS.accountRemove,
    (_event, request) =>
      captureGitRead(() => {
        const input = validateRemoveAccountRequest(request);
        return services.accounts.remove(
          input.accountId,
          input.confirmed
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.accountTest,
    (_event, request) =>
      captureGitRead(() => {
        const input = validateTestAccountRequest(request);
        return services.accounts.test(
          input.accountId,
          input.repositoryUrl
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.windowIsMaximized,
    (event): boolean => getSenderWindow(event).isMaximized()
  );

  registerHandler(IPC_CHANNELS.windowMinimize, (event): void => {
    getSenderWindow(event).minimize();
  });

  registerHandler(
    IPC_CHANNELS.windowToggleMaximize,
    (event): boolean => {
      const window = getSenderWindow(event);

      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }

      return window.isMaximized();
    }
  );

  registerHandler(IPC_CHANNELS.windowClose, (event): void => {
    getSenderWindow(event).close();
  });

  registerHandler(
    IPC_CHANNELS.windowOpenDiffViewer,
    (_event, request): Promise<void> =>
      openDiffViewerWindow(
        validateOpenDiffViewerRequest(request)
      )
  );

  registerHandler(IPC_CHANNELS.gitGetEnvironment, () =>
    captureGitRead(() => services.gitInspection.getEnvironment())
  );

  registerHandler(
    IPC_CHANNELS.gitInspectRepository,
    (_event, request) =>
      captureGitRead(() => {
        const input = validateInspectionRequest(request);

        return services.gitInspection.inspectRepository(input.path, {
          ...(input.historyLimit === undefined
            ? {}
            : { historyLimit: input.historyLimit })
        });
      })
  );

  registerHandler(IPC_CHANNELS.workspaceGetCurrent, () =>
    captureWorkspace(() => services.workspace.getCurrent())
  );

  registerHandler(IPC_CHANNELS.workspaceGetState, () =>
    captureWorkspace(() => services.workspace.getState())
  );

  registerHandler(
    IPC_CHANNELS.workspaceCreate,
    (_event, request) =>
      captureWorkspace(() =>
        services.workspace.createWorkspace(
          validateCreateWorkspaceRequest(request)
        )
      )
  );

  registerHandler(
    IPC_CHANNELS.workspaceSwitch,
    (_event, request) =>
      captureWorkspace(() =>
        services.workspace.switchWorkspace(
          validateSwitchWorkspaceRequest(request).workspaceId
        )
      )
  );

  registerHandler(
    IPC_CHANNELS.workspaceRename,
    (_event, request) =>
      captureWorkspace(() =>
        services.workspace.renameWorkspace(
          validateRenameWorkspaceRequest(request)
        )
      )
  );

  registerHandler(
    IPC_CHANNELS.workspaceDelete,
    (_event, request) =>
      captureWorkspace(() =>
        services.workspace.deleteWorkspace(
          validateDeleteWorkspaceRequest(request).workspaceId
        )
      )
  );

  registerHandler(
    IPC_CHANNELS.workspaceSelectDirectory,
    (event) =>
      captureWorkspace(() =>
        selectWorkspaceDirectory(getSenderWindow(event))
      )
  );

  registerHandler(
    IPC_CHANNELS.workspaceAddDirectory,
    (_event, request) =>
      captureWorkspace(() =>
        services.workspace.addDirectory(
          validateAddWorkspaceDirectoryRequest(request)
        )
      )
  );

  registerHandler(IPC_CHANNELS.workspaceRescan, () =>
    captureWorkspace(() => services.workspace.rescan())
  );

  registerHandler(
    IPC_CHANNELS.workspaceRemoveRepository,
    (_event, request) =>
      captureWorkspace(() =>
        services.workspace.excludeRepository(
          validateRemoveWorkspaceRepositoryRequest(request)
        )
      )
  );

  registerHandler(
    IPC_CHANNELS.workspaceSetGroupCollapsed,
    (_event, request) =>
      captureWorkspace(() =>
        services.workspace.setGroupCollapsed(
          validateSetGroupCollapsedRequest(request)
        )
      )
  );

  registerHandler(
    IPC_CHANNELS.workspaceSelectTarget,
    (_event, request) =>
      captureWorkspace(() =>
        services.workspace.selectTarget(
          validateSelectRepositoryTargetRequest(request).target
        )
      )
  );

  registerHandler(IPC_CHANNELS.workspaceRefresh, () =>
    captureWorkspace(() =>
      services.workspace.requestWorkspaceRefresh("manual")
    )
  );

  registerHandler(
    IPC_CHANNELS.worktreeSelectDirectory,
    (event) =>
      captureWorkspace(async () => {
        const selection = await selectWorktreeDirectory(
          getSenderWindow(event)
        );
        if (!selection.cancelled) {
          await services.worktreePaths.grantSelection(
            selection.path
          );
        }
        return selection;
      })
  );

  registerHandler(
    IPC_CHANNELS.worktreeCommandPreflight,
    (_event, request) =>
      captureGitRead(() => {
        const input =
          validateWorktreeCommandPreflightRequest(
            request
          );
        return services.worktreeCommands.preflight(
          input.command
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.worktreeCommandExecute,
    (_event, request) =>
      captureGitRead(() => {
        const input =
          validateWorktreeCommandExecuteRequest(request);
        return services.worktreeCommands.execute(
          input.command,
          input.preflightId,
          input.confirmed
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.repositoryGetChanges,
    (_event, request) =>
      captureGitRead(() => {
        const input = validateRepositoryQueryRequest(request);
        return services.repositoryQueries.getChanges(
          input.queryId,
          input.target
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.repositoryGetDiff,
    (_event, request) =>
      captureGitRead(() => {
        const input = validateRepositoryDiffRequest(request);
        return services.repositoryQueries.getDiff(
          input.queryId,
          input.target,
          input.path,
          input.mode,
          input.contextLines
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.repositoryGetHistory,
    (_event, request) =>
      captureGitRead(() => {
        const input = validateRepositoryHistoryRequest(request);
        return services.repositoryQueries.getHistory(
          input.queryId,
          input.target,
          input.limit,
          input.offset,
          input.scope
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.repositoryGetCommit,
    (_event, request) =>
      captureGitRead(() => {
        const input = validateRepositoryCommitRequest(request);
        return services.repositoryQueries.getCommit(
          input.queryId,
          input.target,
          input.commitHash
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.repositoryGetCommitDiff,
    (_event, request) =>
      captureGitRead(() => {
        const input =
          validateRepositoryCommitDiffRequest(request);
        return services.repositoryQueries.getCommitDiff(
          input.queryId,
          input.target,
          input.commitHash,
          input.path,
          input.contextLines
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.repositoryGetStashes,
    (_event, request) =>
      captureGitRead(() => {
        const input = validateRepositoryStashesRequest(request);
        return services.repositoryQueries.getStashes(
          input.queryId,
          input.target,
          input.limit
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.repositoryGetStashFiles,
    (_event, request) =>
      captureGitRead(() => {
        const input = validateRepositoryStashRequest(request);
        return services.repositoryQueries.getStashFiles(
          input.queryId,
          input.target,
          input.stashRef
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.repositoryGetStashDiff,
    (_event, request) =>
      captureGitRead(() => {
        const input =
          validateRepositoryStashDiffRequest(request);
        return services.repositoryQueries.getStashDiff(
          input.queryId,
          input.target,
          input.stashRef,
          input.path,
          input.contextLines
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.repositoryGetBranches,
    (_event, request) =>
      captureGitRead(() => {
        const input = validateRepositoryQueryRequest(request);
        return services.repositoryQueries.getBranches(
          input.queryId,
          input.target
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.repositoryCancelQuery,
    (_event, request) =>
      captureGitRead(async () => {
        services.repositoryQueries.cancel(
          validateCancelRepositoryQueryRequest(request).queryId
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.repositoryStage,
    (_event, request) =>
      captureGitRead(() => {
        const input =
          validateRepositoryPathsMutationRequest(request);
        return services.repositoryMutations.stage(
          input.target,
          input.paths
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.repositoryUnstage,
    (_event, request) =>
      captureGitRead(() => {
        const input =
          validateRepositoryPathsMutationRequest(request);
        return services.repositoryMutations.unstage(
          input.target,
          input.paths
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.repositoryDiscard,
    (_event, request) =>
      captureGitRead(() => {
        const input =
          validateRepositoryPathsMutationRequest(request);
        return services.repositoryMutations.discard(
          input.target,
          input.paths
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.repositoryMutateStash,
    (_event, request) =>
      captureGitRead(() => {
        const input =
          validateRepositoryStashMutationRequest(request);
        return services.repositoryMutations.mutateStash(
          input.target,
          input.action,
          input.stashRef,
          input.stashHash
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.repositoryCreateCommit,
    (_event, request) =>
      captureGitRead(() => {
        const input =
          validateCreateRepositoryCommitRequest(request);
        return services.repositoryMutations.commit(
          input.target,
          input.subject,
          input.body
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.repositoryCommandPreflight,
    (_event, request) =>
      captureGitRead(() => {
        const input =
          validateRepositoryCommandPreflightRequest(request);
        return services.repositoryCommands.preflight(
          input.command
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.repositoryCommandExecute,
    (_event, request) =>
      captureGitRead(() => {
        const input =
          validateRepositoryCommandExecuteRequest(request);
        return services.repositoryCommands.execute(
          input.command,
          input.preflightId,
          input.confirmed
        );
      })
  );

  registerHandler(
    IPC_CHANNELS.repositoryCancelOperation,
    (_event, request) =>
      captureGitRead(() =>
        services.repositoryCommands.cancel(
          validateCancelRepositoryOperationRequest(request)
            .operationId
        )
      )
  );
}

function getSenderWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);

  if (!window) {
    throw new Error("Unable to resolve the sender window.");
  }

  return window;
}

async function confirmLanguageServerLaunches(
  window: BrowserWindow,
  launches: readonly LanguageServerLaunchApprovalRequest[]
): Promise<void> {
  const detail =
    formatLanguageServerLaunchApprovalDetail(launches);
  const result = await dialog.showMessageBox(window, {
    type: "warning",
    title: "确认 Language Server 启动命令",
    message:
      "自定义 Language Server 配置可以在本机启动程序。",
    detail: `${detail}\n\n仅在你信任以上程序与参数时允许。`,
    buttons: ["允许并保存", "取消"],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (result.response !== 0) {
    throw new GitError(
      "COMMAND_CANCELLED",
      "Language Server 启动命令未获确认。"
    );
  }
}

export function formatLanguageServerLaunchApprovalDetail(
  launches: readonly LanguageServerLaunchApprovalRequest[]
): string {
  const detail = launches
    .map(
      (launch) =>
        `${languageServerDisplayName(launch.language)}\n命令：${
          JSON.stringify(launch.command)
        }\n参数：${
          JSON.stringify(launch.args)
        }`
    )
    .join("\n\n");
  if (detail.length > MAX_LSP_APPROVAL_DETAIL_LENGTH) {
    throw new GitError(
      "INVALID_REQUEST",
      `Language Server 启动命令与参数过长，无法在确认框中完整展示；请缩短到 ${MAX_LSP_APPROVAL_DETAIL_LENGTH} 个字符以内后重试。`
    );
  }
  return detail;
}

function languageServerDisplayName(
  language: InstallableLanguageServerDto
): string {
  return {
    typescript: "TypeScript",
    vue: "Vue",
    java: "Java",
    python: "Python",
    go: "Go",
    kotlin: "Kotlin",
    csharp: "C#",
    rust: "Rust"
  }[language];
}

type IpcHandler<Channel extends IpcChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcArguments<Channel>
) => IpcResult<Channel> | Promise<IpcResult<Channel>>;

function registerHandler<Channel extends IpcChannel>(
  channel: Channel,
  handler: IpcHandler<Channel>
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    assertTrustedSender(event);

    return handler(
      event,
      ...(args as IpcArguments<Channel>)
    );
  });
}

async function captureGitRead<Value>(
  action: () => Promise<Value>
): Promise<GitReadResult<Value>> {
  try {
    return {
      ok: true,
      value: await action()
    };
  } catch (error) {
    return {
      ok: false,
      error: toGitReadError(error)
    };
  }
}

interface AppSettingsEventWindow {
  isDestroyed(): boolean;
  webContents: {
    isDestroyed(): boolean;
    getURL(): string;
    send(
      channel: typeof IPC_EVENTS.settingsChanged,
      settings: AppSettingsDto
    ): void;
  };
}

interface AppSettingsBroadcastOptions {
  windows?: readonly AppSettingsEventWindow[];
  isTrustedUrl?: (url: string) => boolean;
}

export function broadcastAppSettingsChanged(
  settings: AppSettingsDto,
  options: AppSettingsBroadcastOptions = {}
): void {
  const windows =
    options.windows ?? BrowserWindow.getAllWindows();
  const isTrustedUrl =
    options.isTrustedUrl ??
    ((senderUrl: string) =>
      isTrustedSenderUrl({
        senderUrl,
        rendererUrl: process.env.ELECTRON_RENDERER_URL,
        rendererDirectory: resolve(
          import.meta.dirname,
          "../renderer"
        ),
        packaged: app.isPackaged
      }));

  for (const window of windows) {
    if (
      window.isDestroyed() ||
      window.webContents.isDestroyed()
    ) {
      continue;
    }
    try {
      if (!isTrustedUrl(window.webContents.getURL())) {
        continue;
      }
      window.webContents.send(
        IPC_EVENTS.settingsChanged,
        settings
      );
    } catch {
      // A window may close or navigate while the broadcast is running.
    }
  }
}

export async function captureAppSettingsMutation(
  action: () => Promise<AppSettingsDto>,
  publish: (settings: AppSettingsDto) => void =
    broadcastAppSettingsChanged
): Promise<GitReadResult<AppSettingsDto>> {
  return captureGitRead(async () => {
    const settings = await action();
    try {
      publish(settings);
    } catch {
      // Settings persistence must not be reported as failed because
      // a renderer closed while the best-effort event was sent.
    }
    return settings;
  });
}

function isMissingFilesystemPath(error: unknown): boolean {
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "";

  return code === "ENOENT" || code === "ENOTDIR";
}

async function captureWorkspace<Value>(
  action: () => Promise<Value>
): Promise<WorkspaceResult<Value>> {
  try {
    return {
      ok: true,
      value: await action()
    };
  } catch (error) {
    return {
      ok: false,
      error: toWorkspaceError(error)
    };
  }
}

function toGitReadError(error: unknown): GitReadErrorDto {
  if (error instanceof GitError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    };
  }

  if (error instanceof WorkspaceError) {
    return {
      code:
        error.code === "INVALID_REQUEST" ||
        error.code === "DIRECTORY_UNAVAILABLE"
          ? error.code
          : "COMMAND_FAILED",
      message: error.message,
      details: error.details
    };
  }

  return {
    code: "COMMAND_FAILED",
    message:
      error instanceof Error
        ? error.message
        : "An unknown Git read error occurred.",
    details: {}
  };
}

function toWorkspaceError(error: unknown): WorkspaceErrorDto {
  if (error instanceof WorkspaceError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    };
  }

  return {
    code: "SCAN_FAILED",
    message:
      error instanceof Error
        ? error.message
        : "An unknown Workspace error occurred.",
    details: {}
  };
}

export function validateUpdateAppSettingsRequest(
  request: unknown
): UpdateAppSettingsRequest {
  if (!isRecord(request)) {
    throw new GitError(
      "INVALID_REQUEST",
      "Updating application settings requires an object."
    );
  }
  const result: UpdateAppSettingsRequest = {};

  if ("general" in request) {
    if (!isRecord(request.general)) {
      throw invalidSettingsRequest();
    }
    const general: NonNullable<
      UpdateAppSettingsRequest["general"]
    > = {};
    if ("restoreLastView" in request.general) {
      general.restoreLastView = requireBoolean(
        request.general.restoreLastView
      );
    }
    if ("defaultTerminalKind" in request.general) {
      const value = request.general.defaultTerminalKind;
      if (
        value !== null &&
        (typeof value !== "string" ||
          !EXTERNAL_TERMINAL_KINDS.has(value))
      ) {
        throw invalidSettingsRequest();
      }
      general.defaultTerminalKind =
        value as ExternalTerminalKindDto | null;
    }
    result.general = general;
  }

  if ("appearance" in request) {
    if (!isRecord(request.appearance)) {
      throw invalidSettingsRequest();
    }
    const appearance: NonNullable<
      UpdateAppSettingsRequest["appearance"]
    > = {};
    if ("theme" in request.appearance) {
      appearance.theme = requireEnum(
        request.appearance.theme,
        APP_THEMES
      ) as AppThemeDto;
    }
    result.appearance = appearance;
  }

  if ("diff" in request) {
    if (!isRecord(request.diff)) {
      throw invalidSettingsRequest();
    }
    const diff: NonNullable<
      UpdateAppSettingsRequest["diff"]
    > = {};
    if ("fileView" in request.diff) {
      diff.fileView = requireEnum(
        request.diff.fileView,
        DIFF_FILE_VIEWS
      ) as DiffFileViewDto;
    }
    if ("layout" in request.diff) {
      diff.layout = requireEnum(
        request.diff.layout,
        DIFF_LAYOUTS
      ) as DiffLayoutDto;
    }
    if ("wrap" in request.diff) {
      diff.wrap = requireBoolean(request.diff.wrap);
    }
    if ("treeDirectoriesCollapsed" in request.diff) {
      diff.treeDirectoriesCollapsed = requireBoolean(
        request.diff.treeDirectoriesCollapsed
      );
    }
    if ("commitPanelHeight" in request.diff) {
      diff.commitPanelHeight = requireIntegerInRange(
        request.diff.commitPanelHeight,
        MIN_DIFF_COMMIT_PANEL_HEIGHT,
        MAX_DIFF_COMMIT_PANEL_HEIGHT
      );
    }
    result.diff = diff;
  }

  if ("git" in request) {
    if (!isRecord(request.git)) {
      throw invalidSettingsRequest();
    }
    const git: NonNullable<
      UpdateAppSettingsRequest["git"]
    > = {};
    if ("fetchMode" in request.git) {
      git.fetchMode = requireEnum(
        request.git.fetchMode,
        GIT_FETCH_MODES
      ) as GitFetchModeDto;
    }
    if ("pushStrategy" in request.git) {
      git.pushStrategy = requireEnum(
        request.git.pushStrategy,
        GIT_PUSH_STRATEGIES
      ) as GitPushStrategyDto;
    }
    result.git = git;
  }

  if ("ai" in request) {
    if (!isRecord(request.ai)) {
      throw invalidSettingsRequest();
    }
    const ai: NonNullable<
      UpdateAppSettingsRequest["ai"]
    > = {};
    if ("enabled" in request.ai) {
      ai.enabled = requireBoolean(request.ai.enabled);
    }
    if ("apiUrl" in request.ai) {
      ai.apiUrl = requireBoundedString(
        request.ai.apiUrl,
        MAX_AI_API_URL_LENGTH,
        true
      );
      if (ai.apiUrl) {
        validateAiUrl(ai.apiUrl);
      }
    }
    if ("model" in request.ai) {
      ai.model = requireBoundedString(
        request.ai.model,
        MAX_AI_MODEL_LENGTH,
        true
      );
    }
    if ("apiKey" in request.ai) {
      ai.apiKey = requireBoundedString(
        request.ai.apiKey,
        MAX_AI_API_KEY_LENGTH,
        true
      );
      if (!ai.apiKey) {
        throw new GitError(
          "INVALID_REQUEST",
          "Use the dedicated action to clear the AI API Key."
        );
      }
    }
    if ("prompt" in request.ai) {
      ai.prompt = requireBoundedString(
        request.ai.prompt,
        MAX_AI_PROMPT_LENGTH,
        false
      );
    }
    result.ai = ai;
  }

  if ("codeAnalysis" in request) {
    if (!isRecord(request.codeAnalysis)) {
      throw invalidSettingsRequest();
    }
    const codeAnalysis: NonNullable<
      UpdateAppSettingsRequest["codeAnalysis"]
    > = {};
    if ("enabled" in request.codeAnalysis) {
      codeAnalysis.enabled = requireBoolean(
        request.codeAnalysis.enabled
      );
    }
    if ("defaultScope" in request.codeAnalysis) {
      codeAnalysis.defaultScope = requireEnum(
        request.codeAnalysis.defaultScope,
        CODE_ANALYSIS_SCOPES
      ) as CodeAnalysisScopeDto;
    }
    if ("staticFallback" in request.codeAnalysis) {
      codeAnalysis.staticFallback = requireBoolean(
        request.codeAnalysis.staticFallback
      );
    }
    if ("mcp" in request.codeAnalysis) {
      const mcp = request.codeAnalysis.mcp;
      if (!isRecord(mcp)) {
        throw invalidSettingsRequest();
      }
      const validated: NonNullable<
        UpdateAppSettingsRequest["codeAnalysis"]
      >["mcp"] = {};
      if ("enabled" in mcp) {
        validated.enabled = requireBoolean(mcp.enabled);
      }
      if ("allowSourceSnippets" in mcp) {
        validated.allowSourceSnippets = requireBoolean(
          mcp.allowSourceSnippets
        );
      }
      if ("maxResponseKb" in mcp) {
        validated.maxResponseKb = requireIntegerInRange(
          mcp.maxResponseKb,
          MIN_MCP_MAX_RESPONSE_KB,
          MAX_MCP_MAX_RESPONSE_KB
        );
      }
      codeAnalysis.mcp = validated;
    }
    if ("autoRefresh" in request.codeAnalysis) {
      const autoRefresh = request.codeAnalysis.autoRefresh;
      if (!isRecord(autoRefresh)) {
        throw invalidSettingsRequest();
      }
      const validated: NonNullable<
        UpdateAppSettingsRequest["codeAnalysis"]
      >["autoRefresh"] = {};
      if ("enabled" in autoRefresh) {
        validated.enabled = requireBoolean(autoRefresh.enabled);
      }
      if ("debounceMs" in autoRefresh) {
        validated.debounceMs = requireIntegerInRange(
          autoRefresh.debounceMs,
          MIN_CODE_ANALYSIS_AUTO_REFRESH_DEBOUNCE_MS,
          MAX_CODE_ANALYSIS_AUTO_REFRESH_DEBOUNCE_MS
        );
      }
      codeAnalysis.autoRefresh = validated;
    }
    if ("maxFiles" in request.codeAnalysis) {
      codeAnalysis.maxFiles = requireIntegerInRange(
        request.codeAnalysis.maxFiles,
        100,
        50_000
      );
    }
    if ("maxTotalSourceMb" in request.codeAnalysis) {
      codeAnalysis.maxTotalSourceMb =
        requireIntegerInRange(
          request.codeAnalysis.maxTotalSourceMb,
          MIN_CODE_ANALYSIS_TOTAL_SOURCE_MB,
          MAX_CODE_ANALYSIS_TOTAL_SOURCE_MB
        );
    }
    if ("maxGraphNodes" in request.codeAnalysis) {
      codeAnalysis.maxGraphNodes = requireIntegerInRange(
        request.codeAnalysis.maxGraphNodes,
        MIN_CODE_ANALYSIS_GRAPH_NODES,
        MAX_CODE_ANALYSIS_GRAPH_NODES
      );
    }
    if ("maxGraphEdges" in request.codeAnalysis) {
      codeAnalysis.maxGraphEdges = requireIntegerInRange(
        request.codeAnalysis.maxGraphEdges,
        MIN_CODE_ANALYSIS_GRAPH_EDGES,
        MAX_CODE_ANALYSIS_GRAPH_EDGES
      );
    }
    if ("maxRequestChains" in request.codeAnalysis) {
      codeAnalysis.maxRequestChains =
        requireIntegerInRange(
          request.codeAnalysis.maxRequestChains,
          MIN_CODE_ANALYSIS_REQUEST_CHAINS,
          MAX_CODE_ANALYSIS_REQUEST_CHAINS
        );
    }
    if ("maxDiagnostics" in request.codeAnalysis) {
      codeAnalysis.maxDiagnostics = requireIntegerInRange(
        request.codeAnalysis.maxDiagnostics,
        MIN_CODE_ANALYSIS_DIAGNOSTICS,
        MAX_CODE_ANALYSIS_DIAGNOSTICS
      );
    }
    if ("maxFileSizeKb" in request.codeAnalysis) {
      codeAnalysis.maxFileSizeKb = requireIntegerInRange(
        request.codeAnalysis.maxFileSizeKb,
        64,
        4_096
      );
    }
    if ("readConcurrency" in request.codeAnalysis) {
      codeAnalysis.readConcurrency = requireIntegerInRange(
        request.codeAnalysis.readConcurrency,
        1,
        4
      );
    }
    if ("graphDepth" in request.codeAnalysis) {
      codeAnalysis.graphDepth = requireIntegerInRange(
        request.codeAnalysis.graphDepth,
        1,
        12
      );
    }
    if ("lspTimeoutMs" in request.codeAnalysis) {
      codeAnalysis.lspTimeoutMs = requireIntegerInRange(
        request.codeAnalysis.lspTimeoutMs,
        1_000,
        60_000
      );
    }
    if ("ignoreDirectories" in request.codeAnalysis) {
      codeAnalysis.ignoreDirectories =
        requireBoundedStringArray(
          request.codeAnalysis.ignoreDirectories,
          MAX_ANALYSIS_IGNORE_DIRECTORIES,
          MAX_ANALYSIS_IGNORE_LENGTH
        );
    }
    if ("typescript" in request.codeAnalysis) {
      codeAnalysis.typescript =
        validateLanguageServerSettingsPatch(
          request.codeAnalysis.typescript
        );
    }
    if ("java" in request.codeAnalysis) {
      codeAnalysis.java =
        validateLanguageServerSettingsPatch(
          request.codeAnalysis.java
        );
    }
    if ("vue" in request.codeAnalysis) {
      codeAnalysis.vue =
        validateLanguageServerSettingsPatch(
          request.codeAnalysis.vue
        );
    }
    if ("python" in request.codeAnalysis) {
      codeAnalysis.python =
        validateLanguageServerSettingsPatch(
          request.codeAnalysis.python
        );
    }
    if ("go" in request.codeAnalysis) {
      codeAnalysis.go =
        validateLanguageServerSettingsPatch(
          request.codeAnalysis.go
        );
    }
    if ("kotlin" in request.codeAnalysis) {
      codeAnalysis.kotlin =
        validateLanguageServerSettingsPatch(
          request.codeAnalysis.kotlin
        );
    }
    if ("csharp" in request.codeAnalysis) {
      codeAnalysis.csharp =
        validateLanguageServerSettingsPatch(
          request.codeAnalysis.csharp
        );
    }
    if ("rust" in request.codeAnalysis) {
      codeAnalysis.rust =
        validateLanguageServerSettingsPatch(
          request.codeAnalysis.rust
        );
    }
    result.codeAnalysis = codeAnalysis;
  }

  if ("navigation" in request) {
    if (!isRecord(request.navigation)) {
      throw invalidSettingsRequest();
    }
    const navigation: NonNullable<
      UpdateAppSettingsRequest["navigation"]
    > = {};
    if ("lastContentView" in request.navigation) {
      navigation.lastContentView = requireEnum(
        request.navigation.lastContentView,
        LAST_CONTENT_VIEWS
      ) as LastContentViewDto;
    }
    if ("workspaceTab" in request.navigation) {
      navigation.workspaceTab = requireEnum(
        request.navigation.workspaceTab,
        WORKSPACE_TABS
      ) as WorkspaceTabDto;
    }
    if ("repositoryTab" in request.navigation) {
      navigation.repositoryTab = requireEnum(
        request.navigation.repositoryTab,
        REPOSITORY_TABS
      ) as RepositoryTabDto;
    }
    result.navigation = navigation;
  }

  return result;
}

export function validateClearAiApiKeyRequest(
  request: unknown
): ClearAiApiKeyRequest {
  if (
    !isRecord(request) ||
    typeof request.confirmed !== "boolean"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Clearing the AI API Key requires confirmation state."
    );
  }
  return { confirmed: request.confirmed };
}

export function validateAcknowledgeApplicationUpdatePromptRequest(
  value: unknown
): AcknowledgeApplicationUpdatePromptRequest {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Update prompt acknowledgement is invalid."
    );
  }
  const version = (
    value as Record<string, unknown>
  ).version;
  if (
    typeof version !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(
      version
    )
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Update prompt version is invalid."
    );
  }
  return { version };
}

export function validateStartCodeAnalysisRequest(
  request: unknown
): StartCodeAnalysisRequest {
  if (!isRecord(request)) {
    throw new GitError(
      "INVALID_REQUEST",
      "Starting code analysis requires a supported scope."
    );
  }
  const scope = requireEnum(
    request.scope,
    CODE_ANALYSIS_SCOPES
  ) as CodeAnalysisScopeDto;
  return { scope };
}

export function validateRestoreCodeAnalysisSnapshotRequest(
  request: unknown
): RestoreCodeAnalysisSnapshotRequest {
  if (!isRecord(request)) {
    throw new GitError(
      "INVALID_REQUEST",
      "Restoring code analysis requires a supported scope."
    );
  }
  const scope = requireEnum(
    request.scope,
    CODE_ANALYSIS_SCOPES
  ) as CodeAnalysisScopeDto;
  return { scope };
}

export function validateCancelCodeAnalysisRequest(
  request: unknown
): CancelCodeAnalysisRequest {
  if (
    !isRecord(request) ||
    typeof request.analysisId !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Cancelling code analysis requires its task id."
    );
  }
  return {
    analysisId: validateOperationIdentifier(
      request.analysisId,
      "Code analysis"
    )
  };
}

export function validateReadCodeAnalysisFileRequest(
  request: unknown
): ReadCodeAnalysisFileRequest {
  if (!isRecord(request)) {
    throw new GitError(
      "INVALID_REQUEST",
      "Reading node source requires a code analysis node id."
    );
  }
  const nodeId = requireBoundedString(
    request.nodeId,
    MAX_ANALYSIS_NODE_ID_LENGTH,
    true
  );
  if (!nodeId) {
    throw new GitError(
      "INVALID_REQUEST",
      "Reading node source requires a code analysis node id."
    );
  }
  return { nodeId };
}

export function validateSetMcpRegistrationRequest(
  request: unknown
): SetMcpRegistrationRequest {
  if (!isRecord(request)) {
    throw invalidSettingsRequest();
  }
  return {
    registered: requireBoolean(request.registered)
  };
}

export function validateInstallLanguageServerRequest(
  request: unknown
): InstallLanguageServerRequest {
  if (!isRecord(request)) {
    throw new GitError(
      "INVALID_REQUEST",
      "Installing a Language Server requires a supported language."
    );
  }
  return {
    language: requireEnum(
      request.language,
      INSTALLABLE_LANGUAGE_SERVERS
    ) as InstallableLanguageServerDto
  };
}

export function validateTestAiConnectionRequest(
  request: unknown
): TestAiConnectionRequest {
  if (!isRecord(request)) {
    throw new GitError(
      "INVALID_REQUEST",
      "Testing AI requires an API URL and model."
    );
  }
  const apiUrl = requireBoundedString(
    request.apiUrl,
    MAX_AI_API_URL_LENGTH,
    true
  );
  const model = requireBoundedString(
    request.model,
    MAX_AI_MODEL_LENGTH,
    true
  );
  if (!apiUrl || !model) {
    throw new GitError(
      "INVALID_REQUEST",
      "Testing AI requires an API URL and model."
    );
  }
  validateAiUrl(apiUrl);
  const apiKey =
    "apiKey" in request
      ? requireBoundedString(
          request.apiKey,
          MAX_AI_API_KEY_LENGTH,
          true
        )
      : undefined;
  if ("apiKey" in request && !apiKey) {
    throw new GitError(
      "INVALID_REQUEST",
      "AI API Keys cannot be empty."
    );
  }
  return {
    apiUrl,
    model,
    ...(apiKey ? { apiKey } : {})
  };
}

export function validateGenerateAiCommitMessageRequest(
  request: unknown
): GenerateAiCommitMessageRequest {
  if (!isRecord(request) || !("target" in request)) {
    throw new GitError(
      "INVALID_REQUEST",
      "AI generation requires a repository target."
    );
  }
  return {
    target: validateRepositoryTarget(request.target)
  };
}

function invalidSettingsRequest(): GitError {
  return new GitError(
    "INVALID_REQUEST",
    "Application settings contain unsupported values."
  );
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw invalidSettingsRequest();
  }
  return value;
}

function requireIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw invalidSettingsRequest();
  }
  return value;
}

function requireEnum(
  value: unknown,
  allowed: ReadonlySet<string>
): string {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw invalidSettingsRequest();
  }
  return value;
}

function requireBoundedString(
  value: unknown,
  maximumLength: number,
  trim: boolean
): string {
  if (typeof value !== "string") {
    throw invalidSettingsRequest();
  }
  const normalized = trim ? value.trim() : value;
  if (
    normalized.length > maximumLength ||
    normalized.includes("\0")
  ) {
    throw invalidSettingsRequest();
  }
  return normalized;
}

function validateAiUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GitError(
      "INVALID_REQUEST",
      "The AI API URL is invalid."
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "The AI API URL must use HTTP or HTTPS and cannot contain credentials or a fragment."
    );
  }
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return Boolean(
    value && typeof value === "object" && !Array.isArray(value)
  );
}

function validateInspectionRequest(
  request: unknown
): RepositoryInspectionRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("path" in request) ||
    typeof request.path !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Repository inspection requires an absolute path."
    );
  }

  if (
    "historyLimit" in request &&
    request.historyLimit !== undefined &&
    typeof request.historyLimit !== "number"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "History limit must be numeric when provided."
    );
  }

  return {
    path: request.path,
    ...("historyLimit" in request &&
    typeof request.historyLimit === "number"
      ? { historyLimit: request.historyLimit }
      : {})
  };
}

export function validateCreateWorkspaceRequest(
  request: unknown
): CreateWorkspaceRequest {
  return {
    name: readWorkspaceName(request),
    path: readWorkspacePath(request)
  };
}

export function validateAddWorkspaceDirectoryRequest(
  request: unknown
): AddWorkspaceDirectoryRequest {
  return {
    path: readWorkspacePath(request)
  };
}

function validateSwitchWorkspaceRequest(
  request: unknown
): SwitchWorkspaceRequest {
  return {
    workspaceId: readWorkspaceId(request)
  };
}

function validateRenameWorkspaceRequest(
  request: unknown
): RenameWorkspaceRequest {
  return {
    workspaceId: readWorkspaceId(request),
    name: readWorkspaceName(request)
  };
}

function validateDeleteWorkspaceRequest(
  request: unknown
): DeleteWorkspaceRequest {
  return {
    workspaceId: readWorkspaceId(request)
  };
}

function readWorkspaceId(request: unknown): string {
  if (
    !request ||
    typeof request !== "object" ||
    !("workspaceId" in request) ||
    typeof request.workspaceId !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(request.workspaceId) ||
    request.workspaceId.length > MAX_WORKSPACE_ID_LENGTH
  ) {
    throw new WorkspaceError(
      "INVALID_REQUEST",
      "A valid Workspace id is required."
    );
  }
  return request.workspaceId;
}

function readWorkspaceName(request: unknown): string {
  if (
    !request ||
    typeof request !== "object" ||
    !("name" in request) ||
    typeof request.name !== "string"
  ) {
    throw new WorkspaceError(
      "INVALID_REQUEST",
      "A Workspace name is required."
    );
  }
  const name = request.name.trim();
  if (!name || name.length > MAX_WORKSPACE_NAME_LENGTH) {
    throw new WorkspaceError(
      "INVALID_REQUEST",
      "Workspace name must contain 1 to 120 characters."
    );
  }
  return name;
}

function readWorkspacePath(request: unknown): string {
  if (
    !request ||
    typeof request !== "object" ||
    !("path" in request) ||
    typeof request.path !== "string" ||
    !request.path ||
    request.path.length > MAX_WORKSPACE_PATH_LENGTH ||
    request.path.includes("\0") ||
    /[\r\n]/.test(request.path) ||
    !isAbsolute(request.path)
  ) {
    throw new WorkspaceError(
      "INVALID_REQUEST",
      `Workspace paths must be absolute single-line paths of at most ${MAX_WORKSPACE_PATH_LENGTH} characters.`
    );
  }

  return normalize(resolve(request.path));
}

export function validateRemoveWorkspaceRepositoryRequest(
  request: unknown
): RemoveWorkspaceRepositoryRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("target" in request)
  ) {
    throw new WorkspaceError(
      "INVALID_REQUEST",
      "Removing a repository requires a repository target."
    );
  }

  return {
    target: readWorkspaceRepositoryTarget(request.target)
  };
}

function readWorkspaceRepositoryTarget(
  target: unknown
): RepositoryTargetDto {
  if (
    !target ||
    typeof target !== "object" ||
    !("repositoryId" in target) ||
    typeof target.repositoryId !== "string" ||
    !target.repositoryId ||
    target.repositoryId.length >
      MAX_REPOSITORY_TARGET_ID_LENGTH ||
    target.repositoryId.includes("\0") ||
    /[\r\n]/.test(target.repositoryId) ||
    !("worktreeId" in target) ||
    typeof target.worktreeId !== "string" ||
    !target.worktreeId ||
    target.worktreeId.length > MAX_REPOSITORY_TARGET_ID_LENGTH ||
    target.worktreeId.includes("\0") ||
    /[\r\n]/.test(target.worktreeId)
  ) {
    throw new WorkspaceError(
      "INVALID_REQUEST",
      "Repository targets require repository and worktree ids."
    );
  }

  return {
    repositoryId: target.repositoryId,
    worktreeId: target.worktreeId
  };
}

export function validateSetGroupCollapsedRequest(
  request: unknown
): SetWorkspaceGroupCollapsedRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("groupId" in request) ||
    typeof request.groupId !== "string" ||
    !request.groupId ||
    request.groupId.length > MAX_WORKSPACE_ID_LENGTH ||
    !("collapsed" in request) ||
    typeof request.collapsed !== "boolean"
  ) {
    throw new WorkspaceError(
      "INVALID_REQUEST",
      "Updating a group requires a group id and collapsed state."
    );
  }

  return {
    groupId: request.groupId,
    collapsed: request.collapsed
  };
}

function validateSelectRepositoryTargetRequest(
  request: unknown
): SelectRepositoryTargetRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("target" in request) ||
    !request.target ||
    typeof request.target !== "object" ||
    !("repositoryId" in request.target) ||
    typeof request.target.repositoryId !== "string" ||
    !("worktreeId" in request.target) ||
    typeof request.target.worktreeId !== "string"
  ) {
    throw new WorkspaceError(
      "INVALID_REQUEST",
      "Selecting a repository requires a repository and worktree id."
    );
  }

  return {
    target: {
      repositoryId: request.target.repositoryId,
      worktreeId: request.target.worktreeId
    }
  };
}

function validateRepositoryQueryRequest(
  request: unknown
): RepositoryQueryRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("queryId" in request) ||
    typeof request.queryId !== "string" ||
    !("target" in request)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Repository queries require a query id and target."
    );
  }

  return {
    queryId: request.queryId,
    target: validateRepositoryTarget(request.target)
  };
}

export function validateRepositoryDiffRequest(
  request: unknown
): RepositoryDiffRequest {
  const base = validateRepositoryQueryRequest(request);

  if (
    !request ||
    typeof request !== "object" ||
    !("path" in request) ||
    typeof request.path !== "string" ||
    !("mode" in request) ||
    !["unstaged", "staged", "untracked"].includes(
      String(request.mode)
    )
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Diff queries require a path and supported mode."
    );
  }

  const contextLines =
    "contextLines" in request
      ? request.contextLines
      : undefined;
  if (
    contextLines !== undefined &&
    (typeof contextLines !== "number" ||
      !Number.isInteger(contextLines) ||
      contextLines < 0)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Diff context lines must be a non-negative integer."
    );
  }

  return {
    ...base,
    path: request.path,
    mode: request.mode as RepositoryDiffRequest["mode"],
    ...(contextLines === undefined
      ? {}
      : { contextLines })
  };
}

export function validateRepositoryHistoryRequest(
  request: unknown
): RepositoryHistoryRequest {
  const base = validateRepositoryQueryRequest(request);

  if (!request || typeof request !== "object") {
    throw new GitError(
      "INVALID_REQUEST",
      "History queries require a request object."
    );
  }

  const limit = "limit" in request ? request.limit : undefined;
  const offset = "offset" in request ? request.offset : undefined;
  const rawScope =
    "scope" in request ? request.scope : undefined;

  if (
    (limit !== undefined && typeof limit !== "number") ||
    (offset !== undefined && typeof offset !== "number")
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "History limit and offset must be numeric."
    );
  }

  const scope =
    rawScope === undefined
      ? undefined
      : validateRepositoryHistoryScope(rawScope);

  return {
    ...base,
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
    ...(scope === undefined ? {} : { scope })
  };
}

function validateRepositoryHistoryScope(
  scope: unknown
): RepositoryHistoryRequest["scope"] {
  if (!scope || typeof scope !== "object" || !("kind" in scope)) {
    throw new GitError(
      "INVALID_REQUEST",
      "History scope must identify a ref or comparison."
    );
  }

  if (scope.kind === "ref") {
    if (!("ref" in scope)) {
      throw new GitError(
        "INVALID_REQUEST",
        "Single-ref history requires a ref."
      );
    }
    return {
      kind: "ref",
      ref: validateRepositoryHistoryRef(scope.ref)
    };
  }

  if (scope.kind === "compare") {
    if (!("leftRef" in scope) || !("rightRef" in scope)) {
      throw new GitError(
        "INVALID_REQUEST",
        "Compared history requires two refs."
      );
    }
    const leftRef = validateRepositoryHistoryRef(scope.leftRef);
    const rightRef = validateRepositoryHistoryRef(scope.rightRef);
    if (leftRef === rightRef) {
      throw new GitError(
        "INVALID_REQUEST",
        "Compared history requires two different refs."
      );
    }
    return {
      kind: "compare",
      leftRef,
      rightRef
    };
  }

  throw new GitError(
    "INVALID_REQUEST",
    "Unsupported history scope."
  );
}

function validateRepositoryHistoryRef(value: unknown): string {
  if (typeof value !== "string") {
    throw new GitError(
      "INVALID_REQUEST",
      "History refs must be strings."
    );
  }
  const ref = value.trim();
  const allowedPrefix =
    ref.startsWith("refs/heads/") ||
    ref.startsWith("refs/remotes/");
  const invalidSyntax =
    !ref ||
    ref.length > 1_024 ||
    /[\x00-\x20\x7f~^:?*[\]\\]/.test(ref) ||
    ref.includes("..") ||
    ref.includes("@{") ||
    ref.includes("//") ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    ref.split("/").some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        segment.endsWith(".lock")
    );

  if (!allowedPrefix || invalidSyntax) {
    throw new GitError(
      "INVALID_REQUEST",
      "History refs must be exact local or remote-tracking refs."
    );
  }
  return ref;
}

function validateRepositoryCommitRequest(
  request: unknown
): RepositoryCommitRequest {
  const base = validateRepositoryQueryRequest(request);

  if (
    !request ||
    typeof request !== "object" ||
    !("commitHash" in request) ||
    typeof request.commitHash !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Commit queries require an object id."
    );
  }

  return {
    ...base,
    commitHash: validateRepositoryCommitHash(request.commitHash)
  };
}

export function validateRepositoryCommitDiffRequest(
  request: unknown
): RepositoryCommitDiffRequest {
  const base = validateRepositoryCommitRequest(request);

  if (
    !request ||
    typeof request !== "object" ||
    !("path" in request)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Commit Diff queries require a file path."
    );
  }

  const contextLines =
    "contextLines" in request
      ? request.contextLines
      : undefined;
  if (
    contextLines !== undefined &&
    (typeof contextLines !== "number" ||
      !Number.isInteger(contextLines) ||
      contextLines < 0)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Diff context lines must be a non-negative integer."
    );
  }

  return {
    ...base,
    path: validateRelativeWorktreeFilePath(request.path),
    ...(contextLines === undefined
      ? {}
      : { contextLines })
  };
}

function validateRepositoryCommitHash(value: unknown): string {
  if (typeof value !== "string") {
    throw new GitError(
      "INVALID_REQUEST",
      "Commit queries require an object id."
    );
  }

  const commitHash = value.trim();
  if (!/^[0-9a-f]{4,64}$/i.test(commitHash)) {
    throw new GitError(
      "INVALID_REQUEST",
      "Commit hashes must be hexadecimal object ids."
    );
  }

  return commitHash;
}

export function validateRepositoryStashesRequest(
  request: unknown
): RepositoryStashesRequest {
  const base = validateRepositoryQueryRequest(request);
  const limit =
    request && typeof request === "object" && "limit" in request
      ? request.limit
      : undefined;

  if (
    limit !== undefined &&
    (typeof limit !== "number" ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Stash limits must be integers between 1 and 100."
    );
  }

  return {
    ...base,
    ...(limit === undefined ? {} : { limit })
  };
}

export function validateRepositoryStashRequest(
  request: unknown
): RepositoryStashRequest {
  const base = validateRepositoryQueryRequest(request);

  if (
    !request ||
    typeof request !== "object" ||
    !("stashRef" in request) ||
    typeof request.stashRef !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Stash queries require a stash reference."
    );
  }

  const stashRef = request.stashRef.trim();
  if (!/^stash@\{(?:0|[1-9]\d{0,8})\}$/.test(stashRef)) {
    throw new GitError(
      "INVALID_REQUEST",
      "Stash references must use the exact stash@{n} form."
    );
  }

  return {
    ...base,
    stashRef
  };
}

export function validateRepositoryStashDiffRequest(
  request: unknown
): RepositoryStashDiffRequest {
  const base = validateRepositoryStashRequest(request);

  if (
    !request ||
    typeof request !== "object" ||
    !("path" in request) ||
    typeof request.path !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Stash Diff queries require a file path."
    );
  }

  const contextLines =
    "contextLines" in request
      ? request.contextLines
      : undefined;
  if (
    contextLines !== undefined &&
    (typeof contextLines !== "number" ||
      !Number.isInteger(contextLines) ||
      contextLines < 0)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Diff context lines must be a non-negative integer."
    );
  }

  return {
    ...base,
    path: request.path,
    ...(contextLines === undefined
      ? {}
      : { contextLines })
  };
}

export function validateRepositoryStashMutationRequest(
  request: unknown
): RepositoryStashMutationRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("target" in request) ||
    !("action" in request) ||
    !("stashRef" in request) ||
    !("stashHash" in request) ||
    typeof request.action !== "string" ||
    typeof request.stashRef !== "string" ||
    typeof request.stashHash !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Stash mutations require a target, action, reference, and full object id."
    );
  }

  const action = request.action;
  if (
    action !== "apply" &&
    action !== "drop" &&
    action !== "pop"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Stash mutations require apply, drop, or pop."
    );
  }

  const stashRef = request.stashRef.trim();
  if (!/^stash@\{(?:0|[1-9]\d{0,8})\}$/.test(stashRef)) {
    throw new GitError(
      "INVALID_REQUEST",
      "Stash references must use the exact stash@{n} form."
    );
  }

  const stashHash = request.stashHash
    .trim()
    .toLocaleLowerCase("en-US");
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(stashHash)) {
    throw new GitError(
      "INVALID_REQUEST",
      "Stash hashes must be complete 40- or 64-character hexadecimal object ids."
    );
  }

  return {
    target: validateRepositoryTarget(request.target),
    action,
    stashRef,
    stashHash
  };
}

function validateCancelRepositoryQueryRequest(
  request: unknown
): CancelRepositoryQueryRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("queryId" in request) ||
    typeof request.queryId !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Cancelling a query requires its id."
    );
  }

  return { queryId: request.queryId };
}

function validateRepositoryPathsMutationRequest(
  request: unknown
): RepositoryPathsMutationRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("target" in request) ||
    !("paths" in request) ||
    !Array.isArray(request.paths) ||
    request.paths.length === 0 ||
    request.paths.length > MAX_MUTATION_PATHS
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `Repository mutations require a target and between 1 and ${MAX_MUTATION_PATHS} paths.`
    );
  }

  const paths = request.paths.map((path) => {
    if (
      typeof path !== "string" ||
      !path ||
      path.length > MAX_MUTATION_PATH_LENGTH ||
      path === "." ||
      path.includes("\0") ||
      isAbsolute(path) ||
      /^[a-zA-Z]:/.test(path) ||
      path.startsWith("/") ||
      path.startsWith("\\") ||
      path
        .split(/[\\/]+/)
        .some((segment) => segment === ".." || segment === ".")
    ) {
      throw new GitError(
        "INVALID_REQUEST",
        "Mutation paths must be exact relative paths inside the Worktree."
      );
    }

    return path;
  });

  if (new Set(paths).size !== paths.length) {
    throw new GitError(
      "INVALID_REQUEST",
      "Mutation paths must not contain duplicates."
    );
  }

  return {
    target: validateRepositoryTarget(request.target),
    paths
  };
}

function validateCreateRepositoryCommitRequest(
  request: unknown
): CreateRepositoryCommitRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("target" in request) ||
    !("subject" in request) ||
    typeof request.subject !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Creating a commit requires a target and subject."
    );
  }

  const body = "body" in request ? request.body : undefined;
  if (
    body !== undefined &&
    typeof body !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Commit bodies must be strings when provided."
    );
  }

  const subject = request.subject.trim();
  const normalizedBody = body?.trim();
  if (
    !subject ||
    subject.length > MAX_COMMIT_SUBJECT_LENGTH ||
    subject.includes("\0") ||
    /[\r\n]/.test(subject) ||
    (normalizedBody !== undefined &&
      (normalizedBody.length > MAX_COMMIT_BODY_LENGTH ||
        normalizedBody.includes("\0")))
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Commit messages exceed the supported bounds or contain invalid characters."
    );
  }

  return {
    target: validateRepositoryTarget(request.target),
    subject,
    ...(normalizedBody ? { body: normalizedBody } : {})
  };
}

export function validateRepositoryCommandPreflightRequest(
  request: unknown
): RepositoryCommandPreflightRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("command" in request)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Repository command preflight requires a command."
    );
  }

  return {
    command: validateRepositoryCommand(request.command)
  };
}

export function validateRepositoryCommandExecuteRequest(
  request: unknown
): RepositoryCommandExecuteRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("command" in request) ||
    !("preflightId" in request) ||
    typeof request.preflightId !== "string" ||
    !("confirmed" in request) ||
    typeof request.confirmed !== "boolean"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Executing a repository command requires command, preflight id, and confirmation state."
    );
  }

  return {
    command: validateRepositoryCommand(request.command),
    preflightId: validateOperationIdentifier(
      request.preflightId,
      "Preflight"
    ),
    confirmed: request.confirmed
  };
}

export function validateCancelRepositoryOperationRequest(
  request: unknown
): CancelRepositoryOperationRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("operationId" in request) ||
    typeof request.operationId !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Cancelling an operation requires its id."
    );
  }

  return {
    operationId: validateOperationIdentifier(
      request.operationId,
      "Operation"
    )
  };
}

export function validateOpenExternalTerminalRequest(
  request: unknown
): OpenExternalTerminalRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("target" in request) ||
    !("kind" in request) ||
    typeof request.kind !== "string" ||
    !EXTERNAL_TERMINAL_KINDS.has(request.kind)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Opening a terminal requires a target and supported terminal kind."
    );
  }

  return {
    target: validateRepositoryTarget(request.target),
    kind: request.kind as OpenExternalTerminalRequest["kind"]
  };
}

export function validateOpenExternalApplicationRequest(
  request: unknown
): OpenExternalApplicationRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("context" in request) ||
    !request.context ||
    typeof request.context !== "object" ||
    !("scope" in request.context) ||
    typeof request.context.scope !== "string" ||
    !("kind" in request) ||
    typeof request.kind !== "string" ||
    !EXTERNAL_APPLICATION_KINDS.has(request.kind)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Opening an external application requires a supported context and application kind."
    );
  }

  const context =
    request.context.scope === "workspace"
      ? { scope: "workspace" as const }
      : request.context.scope === "repository" &&
          "target" in request.context
        ? {
            scope: "repository" as const,
            target: validateRepositoryTarget(
              request.context.target
            )
          }
        : request.context.scope === "file" &&
            "target" in request.context &&
            "path" in request.context
          ? {
              scope: "file" as const,
              target: validateRepositoryTarget(
                request.context.target
              ),
              path: validateRelativeWorktreeFilePath(
                request.context.path
              ),
              ...("line" in request.context &&
              request.context.line !== undefined
                ? {
                    line: requireIntegerInRange(
                      request.context.line,
                      1,
                      10_000_000
                    )
                  }
                : {}),
              ...("column" in request.context &&
              request.context.column !== undefined
                ? {
                    column: requireIntegerInRange(
                      request.context.column,
                      1,
                      100_000
                    )
                  }
                : {})
            }
        : undefined;
  if (!context) {
    throw new GitError(
      "INVALID_REQUEST",
      "External applications support only Workspace, repository, and file contexts."
    );
  }
  if (
    context.scope === "file" &&
    context.column !== undefined &&
    context.line === undefined
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Opening an editor column requires a line number."
    );
  }

  return {
    context,
    kind: request.kind as ExternalApplicationKindDto
  };
}

export function validateOpenDirectoryRequest(
  request: unknown
): OpenDirectoryRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("target" in request)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Opening a directory requires a repository target."
    );
  }

  return {
    target: validateRepositoryTarget(request.target)
  };
}

export function validateOpenFileLocationRequest(
  request: unknown
): OpenFileLocationRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("target" in request) ||
    !("path" in request)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Opening a file location requires an exact relative path inside the Worktree."
    );
  }

  return {
    target: validateRepositoryTarget(request.target),
    path: validateRelativeWorktreeFilePath(request.path)
  };
}

export function validateOpenDiffViewerRequest(
  request: unknown
): OpenDiffViewerRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("target" in request) ||
    !("path" in request) ||
    !("mode" in request) ||
    !["unstaged", "staged", "untracked"].includes(
      String(request.mode)
    )
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Opening the Diff viewer requires a target, relative path, and supported mode."
    );
  }

  return {
    target: validateRepositoryTarget(request.target),
    path: validateRelativeWorktreeFilePath(request.path),
    mode: request.mode as OpenDiffViewerRequest["mode"]
  };
}

function validateRelativeWorktreeFilePath(path: unknown): string {
  if (
    typeof path !== "string" ||
    !path ||
    path.length > MAX_MUTATION_PATH_LENGTH ||
    path === "." ||
    path.includes("\0") ||
    isAbsolute(path) ||
    /^[a-zA-Z]:/.test(path) ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path
      .split(/[\\/]+/)
      .some((segment) => segment === ".." || segment === ".")
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Opening a file location requires an exact relative path inside the Worktree."
    );
  }

  return path;
}

export function validateSaveAccountRequest(
  request: unknown
): SaveAccountRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("provider" in request) ||
    typeof request.provider !== "string" ||
    !ACCOUNT_PROVIDERS.has(request.provider) ||
    !("host" in request) ||
    typeof request.host !== "string" ||
    !("authType" in request) ||
    typeof request.authType !== "string" ||
    !ACCOUNT_AUTH_TYPES.has(request.authType)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Saving an account requires a supported provider, host, and authentication type."
    );
  }

  const id =
    "id" in request ? request.id : undefined;
  const username =
    "username" in request ? request.username : undefined;
  const token =
    "token" in request ? request.token : undefined;
  const makeHostDefault =
    "makeHostDefault" in request
      ? request.makeHostDefault
      : undefined;
  if (id !== undefined && typeof id !== "string") {
    throw new GitError(
      "INVALID_REQUEST",
      "Account ids must be strings."
    );
  }
  if (
    username !== undefined &&
    typeof username !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Account usernames must be strings."
    );
  }
  if (token !== undefined && typeof token !== "string") {
    throw new GitError(
      "INVALID_REQUEST",
      "Account tokens must be strings."
    );
  }
  if (
    makeHostDefault !== undefined &&
    typeof makeHostDefault !== "boolean"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Host default selection must be boolean."
    );
  }

  const host = request.host.trim();
  const normalizedUsername = username?.trim();
  const normalizedToken = token?.trim();
  if (
    !host ||
    host.length > MAX_ACCOUNT_HOST_LENGTH ||
    host.includes("\0") ||
    /[\r\n]/.test(host) ||
    (normalizedUsername !== undefined &&
      (normalizedUsername.length >
        MAX_ACCOUNT_USERNAME_LENGTH ||
        normalizedUsername.includes("\0") ||
        /[\r\n]/.test(normalizedUsername))) ||
    (normalizedToken !== undefined &&
      (normalizedToken.length > MAX_ACCOUNT_TOKEN_LENGTH ||
        normalizedToken.includes("\0") ||
        /[\r\n]/.test(normalizedToken)))
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Account fields exceed the supported bounds or contain invalid characters."
    );
  }
  if (
    request.authType === "system-ssh" &&
    normalizedToken
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "System SSH accounts do not accept tokens."
    );
  }

  return {
    ...(id !== undefined
      ? { id: validateAccountIdentifier(id) }
      : {}),
    provider:
      request.provider as SaveAccountRequest["provider"],
    host,
    ...(normalizedUsername
      ? { username: normalizedUsername }
      : {}),
    authType:
      request.authType as SaveAccountRequest["authType"],
    ...(normalizedToken ? { token: normalizedToken } : {}),
    makeHostDefault: makeHostDefault ?? false
  };
}

export function validateBindAccountRequest(
  request: unknown
): BindAccountRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("accountId" in request) ||
    typeof request.accountId !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Binding an account requires its id."
    );
  }
  const repositoryId =
    "repositoryId" in request
      ? request.repositoryId
      : undefined;
  if (
    repositoryId !== undefined &&
    typeof repositoryId !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Repository ids must be strings."
    );
  }
  return {
    accountId: validateAccountIdentifier(request.accountId),
    ...(repositoryId !== undefined
      ? {
          repositoryId:
            validateAccountIdentifier(repositoryId)
        }
      : {})
  };
}

export function validateUnbindAccountRequest(
  request: unknown
): UnbindAccountRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("host" in request) ||
    typeof request.host !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Unbinding an account requires its host."
    );
  }
  const repositoryId =
    "repositoryId" in request
      ? request.repositoryId
      : undefined;
  if (
    repositoryId !== undefined &&
    typeof repositoryId !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Repository ids must be strings."
    );
  }
  const host = request.host.trim();
  if (
    !host ||
    host.length > MAX_ACCOUNT_HOST_LENGTH ||
    host.includes("\0") ||
    /[\r\n]/.test(host)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Account hosts exceed the supported bounds."
    );
  }
  return {
    host,
    ...(repositoryId !== undefined
      ? {
          repositoryId:
            validateAccountIdentifier(repositoryId)
        }
      : {})
  };
}

export function validateAccountRemovalImpactRequest(
  request: unknown
): AccountRemovalImpactRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("accountId" in request) ||
    typeof request.accountId !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Account removal impact requires an account id."
    );
  }
  return {
    accountId: validateAccountIdentifier(request.accountId)
  };
}

export function validateRemoveAccountRequest(
  request: unknown
): RemoveAccountRequest {
  const impact =
    validateAccountRemovalImpactRequest(request);
  if (
    !request ||
    typeof request !== "object" ||
    !("confirmed" in request) ||
    typeof request.confirmed !== "boolean"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Removing an account requires explicit confirmation state."
    );
  }
  return {
    ...impact,
    confirmed: request.confirmed
  };
}

export function validateTestAccountRequest(
  request: unknown
): TestAccountRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("accountId" in request) ||
    typeof request.accountId !== "string" ||
    !("repositoryUrl" in request) ||
    typeof request.repositoryUrl !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Testing an account requires its id and a repository URL."
    );
  }
  const repositoryUrl = request.repositoryUrl.trim();
  if (
    !repositoryUrl ||
    repositoryUrl.length >
      MAX_ACCOUNT_REPOSITORY_URL_LENGTH ||
    repositoryUrl.includes("\0") ||
    /[\r\n]/.test(repositoryUrl)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "The repository URL exceeds the supported bounds."
    );
  }
  return {
    accountId: validateAccountIdentifier(request.accountId),
    repositoryUrl
  };
}

function validateAccountIdentifier(value: string): string {
  if (
    !value ||
    value.length > MAX_REPOSITORY_TARGET_ID_LENGTH ||
    !/^[a-zA-Z0-9_-]+$/.test(value)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Account and repository ids contain invalid characters."
    );
  }
  return value;
}

function validateRepositoryCommand(
  command: unknown
): RepositoryCommandDto {
  if (
    !command ||
    typeof command !== "object" ||
    !("type" in command) ||
    typeof command.type !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Repository commands require a supported type."
    );
  }

  const input = command as Record<string, unknown>;
  switch (command.type) {
    case "fetch": {
      const remote = validateOptionalCommandText(
        input.remote,
        "Remote",
        MAX_REPOSITORY_COMMAND_NAME_LENGTH
      );
      return {
        type: "fetch",
        targets: validateRepositoryCommandTargets(input.targets),
        ...(remote ? { remote } : {}),
        prune: validateOptionalBoolean(
          input.prune,
          "Fetch prune"
        )
      };
    }
    case "pull":
      if (input.strategy !== "ff-only") {
        throw new GitError(
          "INVALID_REQUEST",
          "Pull supports only the ff-only strategy."
        );
      }
      return {
        type: "pull",
        targets: validateRepositoryCommandTargets(input.targets),
        strategy: "ff-only"
      };
    case "push": {
      const targets = validateRepositoryCommandTargets(
        input.targets
      );
      const remote = validateOptionalCommandText(
        input.remote,
        "Remote",
        MAX_REPOSITORY_COMMAND_NAME_LENGTH
      );
      const strategy =
        input.strategy === undefined
          ? undefined
          : (requireEnum(
              input.strategy,
              GIT_PUSH_STRATEGIES
            ) as GitPushStrategyDto);
      return {
        type: "push",
        targets,
        ...(remote ? { remote } : {}),
        ...(strategy ? { strategy } : {})
      };
    }
    case "switch-branch":
      return {
        type: "switch-branch",
        target: validateRepositoryTarget(input.target),
        branch: validateCommandText(
          input.branch,
          "Branch",
          MAX_REPOSITORY_COMMAND_NAME_LENGTH
        )
      };
    case "create-branch": {
      const startPoint = validateOptionalCommandText(
        input.startPoint,
        "Start point",
        MAX_REPOSITORY_REVISION_LENGTH
      );
      return {
        type: "create-branch",
        target: validateRepositoryTarget(input.target),
        branch: validateCommandText(
          input.branch,
          "Branch",
          MAX_REPOSITORY_COMMAND_NAME_LENGTH
        ),
        ...(startPoint ? { startPoint } : {})
      };
    }
    case "rename-branch":
      return {
        type: "rename-branch",
        target: validateRepositoryTarget(input.target),
        branch: validateCommandText(
          input.branch,
          "Branch",
          MAX_REPOSITORY_COMMAND_NAME_LENGTH
        ),
        newName: validateCommandText(
          input.newName,
          "New branch",
          MAX_REPOSITORY_COMMAND_NAME_LENGTH
        )
      };
    case "delete-branch":
      return {
        type: "delete-branch",
        target: validateRepositoryTarget(input.target),
        branch: validateCommandText(
          input.branch,
          "Branch",
          MAX_REPOSITORY_COMMAND_NAME_LENGTH
        )
      };
    default:
      throw new GitError(
        "INVALID_REQUEST",
        "Unsupported repository command."
      );
  }
}

export function validateWorktreeCommandPreflightRequest(
  request: unknown
): WorktreeCommandPreflightRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("command" in request)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Worktree command preflight requires a command."
    );
  }
  return {
    command: validateWorktreeCommand(request.command)
  };
}

export function validateWorktreeCommandExecuteRequest(
  request: unknown
): WorktreeCommandExecuteRequest {
  if (
    !request ||
    typeof request !== "object" ||
    !("command" in request) ||
    !("preflightId" in request) ||
    typeof request.preflightId !== "string" ||
    !("confirmed" in request) ||
    typeof request.confirmed !== "boolean"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Worktree execution requires a command, preflight id, and explicit confirmation state."
    );
  }
  return {
    command: validateWorktreeCommand(request.command),
    preflightId: validateOperationIdentifier(
      request.preflightId,
      "Preflight"
    ),
    confirmed: request.confirmed
  };
}

function validateWorktreeCommand(
  command: unknown
): WorktreeCommandDto {
  if (
    !command ||
    typeof command !== "object" ||
    !("type" in command) ||
    typeof command.type !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Worktree commands require a supported type."
    );
  }
  const input = command as Record<string, unknown>;
  switch (command.type) {
    case "create": {
      const branch = validateOptionalCommandText(
        input.branch,
        "Branch",
        MAX_REPOSITORY_COMMAND_NAME_LENGTH
      );
      const startPoint = validateOptionalCommandText(
        input.startPoint,
        "Start point",
        MAX_REPOSITORY_REVISION_LENGTH
      );
      return {
        type: "create",
        repositoryId: validateCommandText(
          input.repositoryId,
          "Repository id",
          MAX_REPOSITORY_TARGET_ID_LENGTH
        ),
        path: validateWorktreePath(input.path),
        ...(branch ? { branch } : {}),
        ...(startPoint ? { startPoint } : {})
      };
    }
    case "lock": {
      const reason = validateOptionalCommandText(
        input.reason,
        "Lock reason",
        512
      );
      return {
        type: "lock",
        worktreeId: validateCommandText(
          input.worktreeId,
          "Worktree id",
          MAX_REPOSITORY_TARGET_ID_LENGTH
        ),
        ...(reason ? { reason } : {})
      };
    }
    case "unlock":
    case "repair":
    case "remove":
      return {
        type: command.type,
        worktreeId: validateCommandText(
          input.worktreeId,
          "Worktree id",
          MAX_REPOSITORY_TARGET_ID_LENGTH
        )
      };
    case "move":
      return {
        type: "move",
        worktreeId: validateCommandText(
          input.worktreeId,
          "Worktree id",
          MAX_REPOSITORY_TARGET_ID_LENGTH
        ),
        destination: validateWorktreePath(
          input.destination
        )
      };
    case "prune":
      return {
        type: "prune",
        repositoryId: validateCommandText(
          input.repositoryId,
          "Repository id",
          MAX_REPOSITORY_TARGET_ID_LENGTH
        )
      };
    default:
      throw new GitError(
        "INVALID_REQUEST",
        "Unsupported Worktree command."
      );
  }
}

function validateWorktreePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > MAX_WORKTREE_PATH_LENGTH ||
    value.includes("\0") ||
    /[\r\n]/.test(value) ||
    !isAbsolute(value)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `Worktree paths must be absolute single-line paths of at most ${MAX_WORKTREE_PATH_LENGTH} characters.`
    );
  }
  return normalize(resolve(value));
}

function validateRepositoryCommandTargets(
  targets: unknown
): RepositoryQueryRequest["target"][] {
  if (
    !Array.isArray(targets) ||
    targets.length === 0 ||
    targets.length > MAX_REPOSITORY_COMMAND_TARGETS
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `Repository commands require between 1 and ${MAX_REPOSITORY_COMMAND_TARGETS} targets.`
    );
  }

  const validated = targets.map(validateRepositoryTarget);
  const targetKeys = validated.map(
    (target) =>
      `${target.repositoryId}\0${target.worktreeId}`
  );
  if (new Set(targetKeys).size !== targetKeys.length) {
    throw new GitError(
      "INVALID_REQUEST",
      "Repository command targets must be unique."
    );
  }
  return validated;
}

function validateOptionalBoolean(
  value: unknown,
  label: string
): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw new GitError(
      "INVALID_REQUEST",
      `${label} must be boolean when provided.`
    );
  }
  return value;
}

function validateLanguageServerSettingsPatch(
  value: unknown
): NonNullable<
  NonNullable<
    UpdateAppSettingsRequest["codeAnalysis"]
  >["typescript"]
> {
  if (!isRecord(value)) {
    throw invalidSettingsRequest();
  }
  const result: NonNullable<
    NonNullable<
      UpdateAppSettingsRequest["codeAnalysis"]
    >["typescript"]
  > = {};
  if ("enabled" in value) {
    result.enabled = requireBoolean(value.enabled);
  }
  if ("command" in value) {
    result.command = requireBoundedString(
      value.command,
      MAX_LSP_COMMAND_LENGTH,
      false
    );
  }
  if ("args" in value) {
    result.args = requireBoundedStringArray(
      value.args,
      MAX_LSP_ARGUMENTS,
      MAX_LSP_ARGUMENT_LENGTH
    );
  }
  if ("maxDocuments" in value) {
    result.maxDocuments = requireIntegerInRange(
      value.maxDocuments,
      MIN_LSP_DOCUMENTS,
      MAX_LSP_DOCUMENTS
    );
  }
  if ("maxSymbolsPerDocument" in value) {
    result.maxSymbolsPerDocument =
      requireIntegerInRange(
        value.maxSymbolsPerDocument,
        MIN_LSP_SYMBOLS_PER_DOCUMENT,
        MAX_LSP_SYMBOLS_PER_DOCUMENT
      );
  }
  if ("maxCallHierarchyRequests" in value) {
    result.maxCallHierarchyRequests =
      requireIntegerInRange(
        value.maxCallHierarchyRequests,
        MIN_LSP_REQUESTS,
        MAX_LSP_REQUESTS
      );
  }
  if ("maxTypeHierarchyRequests" in value) {
    result.maxTypeHierarchyRequests =
      requireIntegerInRange(
        value.maxTypeHierarchyRequests,
        MIN_LSP_REQUESTS,
        MAX_LSP_REQUESTS
      );
  }
  if ("maxReferenceRequests" in value) {
    result.maxReferenceRequests = requireIntegerInRange(
      value.maxReferenceRequests,
      MIN_LSP_REQUESTS,
      MAX_LSP_REQUESTS
    );
  }
  if ("maxDocumentationRequests" in value) {
    result.maxDocumentationRequests =
      requireIntegerInRange(
        value.maxDocumentationRequests,
        MIN_LSP_REQUESTS,
        MAX_LSP_REQUESTS
      );
  }
  if ("maxReferencesPerSymbol" in value) {
    result.maxReferencesPerSymbol =
      requireIntegerInRange(
        value.maxReferencesPerSymbol,
        MIN_LSP_REFERENCES_PER_SYMBOL,
        MAX_LSP_REFERENCES_PER_SYMBOL
      );
  }
  return result;
}

function requireBoundedStringArray(
  value: unknown,
  maximumItems: number,
  maximumItemLength: number
): string[] {
  if (
    !Array.isArray(value) ||
    value.length > maximumItems
  ) {
    throw invalidSettingsRequest();
  }
  return value.map((item) =>
    requireBoundedString(
      item,
      maximumItemLength,
      false
    )
  );
}

function validateOptionalCommandText(
  value: unknown,
  label: string,
  maxLength: number
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return validateCommandText(value, label, maxLength);
}

function validateCommandText(
  value: unknown,
  label: string,
  maxLength: number
): string {
  if (typeof value !== "string") {
    throw new GitError(
      "INVALID_REQUEST",
      `${label} must be a string.`
    );
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maxLength ||
    normalized.includes("\0") ||
    /[\r\n]/.test(normalized)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `${label} exceeds the supported bounds or contains invalid characters.`
    );
  }
  return normalized;
}

function validateOperationIdentifier(
  value: string,
  label: string
): string {
  if (
    !value ||
    value.length > MAX_OPERATION_ID_LENGTH ||
    !/^[a-zA-Z0-9_-]+$/.test(value)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `${label} ids contain invalid characters.`
    );
  }
  return value;
}

function validateRepositoryTarget(
  target: unknown
): RepositoryQueryRequest["target"] {
  if (
    !target ||
    typeof target !== "object" ||
    !("repositoryId" in target) ||
    typeof target.repositoryId !== "string" ||
    !target.repositoryId ||
    target.repositoryId.length > MAX_REPOSITORY_TARGET_ID_LENGTH ||
    target.repositoryId.includes("\0") ||
    /[\r\n]/.test(target.repositoryId) ||
    !("worktreeId" in target) ||
    typeof target.worktreeId !== "string" ||
    !target.worktreeId ||
    target.worktreeId.length > MAX_REPOSITORY_TARGET_ID_LENGTH ||
    target.worktreeId.includes("\0") ||
    /[\r\n]/.test(target.worktreeId)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Repository targets require repository and worktree ids."
    );
  }

  return {
    repositoryId: target.repositoryId,
    worktreeId: target.worktreeId
  };
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url ?? event.sender.getURL();
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  const rendererDirectory = resolve(import.meta.dirname, "../renderer");

  if (
    !isTrustedSenderUrl({
      senderUrl,
      rendererUrl,
      rendererDirectory,
      packaged: app.isPackaged
    })
  ) {
    throw new Error("Rejected IPC request from an untrusted renderer.");
  }
}

interface TrustedSenderInput {
  senderUrl: string;
  rendererUrl?: string | undefined;
  rendererDirectory: string;
  packaged: boolean;
}

export function isTrustedSenderUrl({
  senderUrl,
  rendererUrl,
  rendererDirectory,
  packaged
}: TrustedSenderInput): boolean {
  try {
    const parsedSender = new URL(senderUrl);

    if (!packaged && rendererUrl) {
      const parsedRenderer = new URL(rendererUrl);
      return (
        parsedSender.protocol === parsedRenderer.protocol &&
        parsedSender.host === parsedRenderer.host
      );
    }

    if (parsedSender.protocol !== "file:") {
      return false;
    }

    const senderPath = fileURLToPath(parsedSender);
    const relativePath = relative(rendererDirectory, senderPath);

    return (
      relativePath === "" ||
      (relativePath !== ".." &&
        !relativePath.startsWith(`..${sep}`) &&
        !isAbsolute(relativePath))
    );
  } catch {
    return false;
  }
}
