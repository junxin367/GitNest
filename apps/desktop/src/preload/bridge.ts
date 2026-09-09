import {
  IPC_CHANNELS,
  type GitNestBridge,
  type IpcInvoke,
  type WorkspaceRuntimeStateDto
} from "@gitnest/contracts";

export function createGitNestBridge(
  invoke: IpcInvoke,
  resolveDroppedPath: (file: unknown) => string = () => "",
  subscribeWorkspaceState: (
    listener: (state: WorkspaceRuntimeStateDto) => void
  ) => () => void = () => () => undefined
): GitNestBridge {
  return {
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
      getBranches: (request) =>
        invoke(IPC_CHANNELS.repositoryGetBranches, request),
      cancelQuery: (request) =>
        invoke(IPC_CHANNELS.repositoryCancelQuery, request),
      stage: (request) =>
        invoke(IPC_CHANNELS.repositoryStage, request),
      unstage: (request) =>
        invoke(IPC_CHANNELS.repositoryUnstage, request),
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
      selectDirectory: () =>
        invoke(IPC_CHANNELS.workspaceSelectDirectory),
      addEntry: (request) =>
        invoke(IPC_CHANNELS.workspaceAddEntry, request),
      rescan: () =>
        invoke(IPC_CHANNELS.workspaceRescan),
      updateEntry: (request) =>
        invoke(IPC_CHANNELS.workspaceUpdateEntry, request),
      removeEntry: (request) =>
        invoke(IPC_CHANNELS.workspaceRemoveEntry, request),
      setGroupCollapsed: (request) =>
        invoke(
          IPC_CHANNELS.workspaceSetGroupCollapsed,
          request
        ),
      selectEntry: (request) =>
        invoke(IPC_CHANNELS.workspaceSelectEntry, request),
      selectTarget: (request) =>
        invoke(IPC_CHANNELS.workspaceSelectTarget, request),
      refresh: () =>
        invoke(IPC_CHANNELS.workspaceRefresh),
      onStateChanged: subscribeWorkspaceState,
      resolveDroppedPath
    },
    window: {
      minimize: () =>
        invoke(IPC_CHANNELS.windowMinimize),
      toggleMaximize: () =>
        invoke(IPC_CHANNELS.windowToggleMaximize),
      close: () =>
        invoke(IPC_CHANNELS.windowClose),
      openDiffViewer: (request) =>
        invoke(IPC_CHANNELS.windowOpenDiffViewer, request)
    }
  };
}
