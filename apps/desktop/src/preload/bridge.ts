import {
  IPC_CHANNELS,
  type ApplicationUpdateStateDto,
  type AppSettingsDto,
  type CodeAnalysisStateDto,
  type GitNestBridge,
  type IpcInvoke,
  type WorkspaceRuntimeStateDto
} from "@gitnest/contracts";

export function createGitNestBridge(
  invoke: IpcInvoke,
  subscribeWorkspaceState: (
    listener: (state: WorkspaceRuntimeStateDto) => void
  ) => () => void = () => () => undefined,
  subscribeCodeAnalysisState: (
    listener: (state: CodeAnalysisStateDto) => void
  ) => () => void = () => () => undefined,
  subscribeAppSettings: (
    listener: (settings: AppSettingsDto) => void
  ) => () => void = () => () => undefined,
  subscribeApplicationUpdateState: (
    listener: (state: ApplicationUpdateStateDto) => void
  ) => () => void = () => () => undefined,
  subscribeWindowMaximized: (
    listener: (maximized: boolean) => void
  ) => () => void = () => () => undefined
): GitNestBridge {
  return {
    update: {
      getState: () =>
        invoke(IPC_CHANNELS.updateGetState),
      check: () => invoke(IPC_CHANNELS.updateCheck),
      acknowledgePrompt: (request) =>
        invoke(
          IPC_CHANNELS.updateAcknowledgePrompt,
          request
        ),
      downloadAndInstall: () =>
        invoke(IPC_CHANNELS.updateDownloadAndInstall),
      openProjectPage: () =>
        invoke(IPC_CHANNELS.updateOpenProjectPage),
      openReleasePage: () =>
        invoke(IPC_CHANNELS.updateOpenReleasePage),
      onStateChanged: subscribeApplicationUpdateState
    },
    codeAnalysis: {
      getState: () =>
        invoke(IPC_CHANNELS.codeAnalysisGetState),
      start: (request) =>
        invoke(IPC_CHANNELS.codeAnalysisStart, request),
      restoreSnapshot: (request) =>
        invoke(
          IPC_CHANNELS.codeAnalysisRestoreSnapshot,
          request
        ),
      cancel: (request) =>
        invoke(IPC_CHANNELS.codeAnalysisCancel, request),
      getSnapshot: () =>
        invoke(IPC_CHANNELS.codeAnalysisGetSnapshot),
      readFile: (request) =>
        invoke(IPC_CHANNELS.codeAnalysisReadFile, request),
      installLanguageServer: (request) =>
        invoke(
          IPC_CHANNELS.codeAnalysisInstallLanguageServer,
          request
        ),
      onStateChanged: subscribeCodeAnalysisState,
      getMcpRegistration: () =>
        invoke(IPC_CHANNELS.codeAnalysisGetMcpRegistration),
      setMcpRegistration: (request) =>
        invoke(
          IPC_CHANNELS.codeAnalysisSetMcpRegistration,
          request
        )
    },
    settings: {
      get: () => invoke(IPC_CHANNELS.settingsGet),
      update: (request) =>
        invoke(IPC_CHANNELS.settingsUpdate, request),
      clearAiApiKey: (request) =>
        invoke(IPC_CHANNELS.settingsClearAiApiKey, request),
      onChanged: subscribeAppSettings
    },
    ai: {
      testConnection: (request) =>
        invoke(IPC_CHANNELS.aiTestConnection, request),
      generateCommitMessage: (request) =>
        invoke(IPC_CHANNELS.aiGenerateCommitMessage, request)
    },
    account: {
      list: () => invoke(IPC_CHANNELS.accountList),
      save: (request) =>
        invoke(IPC_CHANNELS.accountSave, request),
      bind: (request) =>
        invoke(IPC_CHANNELS.accountBind, request),
      unbind: (request) =>
        invoke(IPC_CHANNELS.accountUnbind, request),
      getRemovalImpact: (request) =>
        invoke(
          IPC_CHANNELS.accountGetRemovalImpact,
          request
        ),
      remove: (request) =>
        invoke(IPC_CHANNELS.accountRemove, request),
      test: (request) =>
        invoke(IPC_CHANNELS.accountTest, request)
    },
    system: {
      getRuntimeInfo: () =>
        invoke(IPC_CHANNELS.systemGetRuntimeInfo),
      listExternalApplications: () =>
        invoke(
          IPC_CHANNELS.systemListExternalApplications
        ),
      openExternalApplication: (request) =>
        invoke(
          IPC_CHANNELS.systemOpenExternalApplication,
          request
        ),
      listExternalTerminals: () =>
        invoke(IPC_CHANNELS.systemListExternalTerminals),
      openDirectory: (request) =>
        invoke(IPC_CHANNELS.systemOpenDirectory, request),
      openFileLocation: (request) =>
        invoke(
          IPC_CHANNELS.systemOpenFileLocation,
          request
        ),
      openExternalTerminal: (request) =>
        invoke(
          IPC_CHANNELS.systemOpenExternalTerminal,
          request
        )
    },
    git: {
      getEnvironment: () =>
        invoke(IPC_CHANNELS.gitGetEnvironment),
      inspectRepository: (request) =>
        invoke(IPC_CHANNELS.gitInspectRepository, request)
    },
    repository: {
      getChanges: (request) =>
        invoke(IPC_CHANNELS.repositoryGetChanges, request),
      getDiff: (request) =>
        invoke(IPC_CHANNELS.repositoryGetDiff, request),
      getHistory: (request) =>
        invoke(IPC_CHANNELS.repositoryGetHistory, request),
      getCommit: (request) =>
        invoke(IPC_CHANNELS.repositoryGetCommit, request),
      getCommitDiff: (request) =>
        invoke(
          IPC_CHANNELS.repositoryGetCommitDiff,
          request
        ),
      getStashes: (request) =>
        invoke(IPC_CHANNELS.repositoryGetStashes, request),
      getStashFiles: (request) =>
        invoke(
          IPC_CHANNELS.repositoryGetStashFiles,
          request
        ),
      getStashDiff: (request) =>
        invoke(IPC_CHANNELS.repositoryGetStashDiff, request),
      getBranches: (request) =>
        invoke(IPC_CHANNELS.repositoryGetBranches, request),
      cancelQuery: (request) =>
        invoke(IPC_CHANNELS.repositoryCancelQuery, request),
      stage: (request) =>
        invoke(IPC_CHANNELS.repositoryStage, request),
      unstage: (request) =>
        invoke(IPC_CHANNELS.repositoryUnstage, request),
      discard: (request) =>
        invoke(IPC_CHANNELS.repositoryDiscard, request),
      mutateStash: (request) =>
        invoke(
          IPC_CHANNELS.repositoryMutateStash,
          request
        ),
      createCommit: (request) =>
        invoke(IPC_CHANNELS.repositoryCreateCommit, request),
      preflightCommand: (request) =>
        invoke(
          IPC_CHANNELS.repositoryCommandPreflight,
          request
        ),
      executeCommand: (request) =>
        invoke(
          IPC_CHANNELS.repositoryCommandExecute,
          request
        ),
      cancelOperation: (request) =>
        invoke(
          IPC_CHANNELS.repositoryCancelOperation,
          request
        )
    },
    worktree: {
      selectDirectory: () =>
        invoke(IPC_CHANNELS.worktreeSelectDirectory),
      preflightCommand: (request) =>
        invoke(
          IPC_CHANNELS.worktreeCommandPreflight,
          request
        ),
      executeCommand: (request) =>
        invoke(
          IPC_CHANNELS.worktreeCommandExecute,
          request
        )
    },
    workspace: {
      getCurrent: () =>
        invoke(IPC_CHANNELS.workspaceGetCurrent),
      getState: () =>
        invoke(IPC_CHANNELS.workspaceGetState),
      create: (request) =>
        invoke(IPC_CHANNELS.workspaceCreate, request),
      switch: (request) =>
        invoke(IPC_CHANNELS.workspaceSwitch, request),
      rename: (request) =>
        invoke(IPC_CHANNELS.workspaceRename, request),
      delete: (request) =>
        invoke(IPC_CHANNELS.workspaceDelete, request),
      selectDirectory: () =>
        invoke(IPC_CHANNELS.workspaceSelectDirectory),
      addDirectory: (request) =>
        invoke(IPC_CHANNELS.workspaceAddDirectory, request),
      rescan: () =>
        invoke(IPC_CHANNELS.workspaceRescan),
      removeRepository: (request) =>
        invoke(
          IPC_CHANNELS.workspaceRemoveRepository,
          request
        ),
      setGroupCollapsed: (request) =>
        invoke(
          IPC_CHANNELS.workspaceSetGroupCollapsed,
          request
        ),
      selectTarget: (request) =>
        invoke(IPC_CHANNELS.workspaceSelectTarget, request),
      refresh: () =>
        invoke(IPC_CHANNELS.workspaceRefresh),
      onStateChanged: subscribeWorkspaceState
    },
    window: {
      isMaximized: () =>
        invoke(IPC_CHANNELS.windowIsMaximized),
      minimize: () =>
        invoke(IPC_CHANNELS.windowMinimize),
      toggleMaximize: () =>
        invoke(IPC_CHANNELS.windowToggleMaximize),
      onMaximizedChanged: subscribeWindowMaximized,
      close: () =>
        invoke(IPC_CHANNELS.windowClose),
      openDiffViewer: (request) =>
        invoke(IPC_CHANNELS.windowOpenDiffViewer, request)
    }
  };
}
