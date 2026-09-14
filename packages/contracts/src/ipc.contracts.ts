import { IPC_CHANNELS } from "./channels";
import type {
  AccountConnectionTestResultDto,
  AccountOverviewDto,
  AccountProfileDto,
  AccountRemovalImpactDto,
  AccountRemovalImpactRequest,
  BindAccountRequest,
  RemoveAccountRequest,
  SaveAccountRequest,
  TestAccountRequest,
  UnbindAccountRequest
} from "./account.contracts";
import type {
  GitEnvironmentDto,
  GitReadResult,
  RepositoryInspectionDto,
  RepositoryInspectionRequest
} from "./git.contracts";
import type {
  ExternalApplicationOpenedDto,
  ExternalApplicationProfileDto,
  ExternalTerminalOpenedDto,
  ExternalTerminalProfileDto,
  OpenDirectoryRequest,
  OpenDiffViewerRequest,
  OpenExternalApplicationRequest,
  OpenExternalTerminalRequest,
  OpenFileLocationRequest,
  RuntimeInfo
} from "./system.contracts";
import type {
  CancelRepositoryOperationRequest,
  CancelRepositoryQueryRequest,
  CreateRepositoryCommitRequest,
  RepositoryBranchesDto,
  RepositoryChangesDto,
  RepositoryCommandExecuteRequest,
  RepositoryCommandExecutionDto,
  RepositoryCommandPreflightDto,
  RepositoryCommandPreflightRequest,
  RepositoryCommitDto,
  RepositoryCommitMutationDto,
  RepositoryCommitRequest,
  RepositoryDiffDto,
  RepositoryDiffRequest,
  RepositoryHistoryPageDto,
  RepositoryHistoryRequest,
  RepositoryPathsMutationDto,
  RepositoryPathsMutationRequest,
  RepositoryQueryRequest
} from "./repository.contracts";
import type {
  AddWorkspaceEntryRequest,
  RemoveWorkspaceEntryRequest,
  SelectRepositoryTargetRequest,
  SelectWorkspaceEntryRequest,
  SetWorkspaceGroupCollapsedRequest,
  UpdateWorkspaceEntryRequest,
  WorkspaceDetailsDto,
  WorkspaceDirectorySelectionDto,
  WorkspaceMutationResultDto,
  WorkspaceRefreshAcceptedDto,
  WorkspaceRuntimeStateDto,
  WorkspaceResult
} from "./workspace.contracts";
import type {
  WorktreeCommandExecuteRequest,
  WorktreeCommandExecutionDto,
  WorktreeCommandPreflightDto,
  WorktreeCommandPreflightRequest
} from "./worktree.contracts";
import type {
  AiCommitMessageDto,
  AiConnectionTestResultDto,
  AppSettingsDto,
  AppSettingsLoadDto,
  ClearAiApiKeyRequest,
  GenerateAiCommitMessageRequest,
  TestAiConnectionRequest,
  UpdateAppSettingsRequest
} from "./settings.contracts";

interface IpcContract<
  Arguments extends unknown[],
  Result
> {
  arguments: Arguments;
  result: Result;
}

export interface IpcContractMap {
  [IPC_CHANNELS.settingsGet]: IpcContract<
    [],
    GitReadResult<AppSettingsLoadDto>
  >;
  [IPC_CHANNELS.settingsUpdate]: IpcContract<
    [request: UpdateAppSettingsRequest],
    GitReadResult<AppSettingsDto>
  >;
  [IPC_CHANNELS.settingsClearAiApiKey]: IpcContract<
    [request: ClearAiApiKeyRequest],
    GitReadResult<AppSettingsDto>
  >;
  [IPC_CHANNELS.aiTestConnection]: IpcContract<
    [request: TestAiConnectionRequest],
    GitReadResult<AiConnectionTestResultDto>
  >;
  [IPC_CHANNELS.aiGenerateCommitMessage]: IpcContract<
    [request: GenerateAiCommitMessageRequest],
    GitReadResult<AiCommitMessageDto>
  >;
  [IPC_CHANNELS.systemGetRuntimeInfo]: IpcContract<[], RuntimeInfo>;
  [IPC_CHANNELS.systemListExternalApplications]: IpcContract<
    [],
    GitReadResult<ExternalApplicationProfileDto[]>
  >;
  [IPC_CHANNELS.systemOpenExternalApplication]: IpcContract<
    [request: OpenExternalApplicationRequest],
    GitReadResult<ExternalApplicationOpenedDto>
  >;
  [IPC_CHANNELS.systemListExternalTerminals]: IpcContract<
    [],
    GitReadResult<ExternalTerminalProfileDto[]>
  >;
  [IPC_CHANNELS.systemOpenExternalTerminal]: IpcContract<
    [request: OpenExternalTerminalRequest],
    GitReadResult<ExternalTerminalOpenedDto>
  >;
  [IPC_CHANNELS.systemOpenDirectory]: IpcContract<
    [request: OpenDirectoryRequest],
    GitReadResult<void>
  >;
  [IPC_CHANNELS.systemOpenFileLocation]: IpcContract<
    [request: OpenFileLocationRequest],
    GitReadResult<void>
  >;
  [IPC_CHANNELS.accountList]: IpcContract<
    [],
    GitReadResult<AccountOverviewDto>
  >;
  [IPC_CHANNELS.accountSave]: IpcContract<
    [request: SaveAccountRequest],
    GitReadResult<AccountProfileDto>
  >;
  [IPC_CHANNELS.accountBind]: IpcContract<
    [request: BindAccountRequest],
    GitReadResult<AccountOverviewDto>
  >;
  [IPC_CHANNELS.accountUnbind]: IpcContract<
    [request: UnbindAccountRequest],
    GitReadResult<AccountOverviewDto>
  >;
  [IPC_CHANNELS.accountGetRemovalImpact]: IpcContract<
    [request: AccountRemovalImpactRequest],
    GitReadResult<AccountRemovalImpactDto>
  >;
  [IPC_CHANNELS.accountRemove]: IpcContract<
    [request: RemoveAccountRequest],
    GitReadResult<AccountRemovalImpactDto>
  >;
  [IPC_CHANNELS.accountTest]: IpcContract<
    [request: TestAccountRequest],
    GitReadResult<AccountConnectionTestResultDto>
  >;
  [IPC_CHANNELS.windowMinimize]: IpcContract<[], void>;
  [IPC_CHANNELS.windowToggleMaximize]: IpcContract<[], boolean>;
  [IPC_CHANNELS.windowClose]: IpcContract<[], void>;
  [IPC_CHANNELS.windowOpenDiffViewer]: IpcContract<
    [request: OpenDiffViewerRequest],
    void
  >;
  [IPC_CHANNELS.gitGetEnvironment]: IpcContract<
    [],
    GitReadResult<GitEnvironmentDto>
  >;
  [IPC_CHANNELS.gitInspectRepository]: IpcContract<
    [request: RepositoryInspectionRequest],
    GitReadResult<RepositoryInspectionDto>
  >;
  [IPC_CHANNELS.workspaceGetCurrent]: IpcContract<
    [],
    WorkspaceResult<WorkspaceDetailsDto>
  >;
  [IPC_CHANNELS.workspaceGetState]: IpcContract<
    [],
    WorkspaceResult<WorkspaceRuntimeStateDto>
  >;
  [IPC_CHANNELS.workspaceSelectDirectory]: IpcContract<
    [],
    WorkspaceResult<WorkspaceDirectorySelectionDto>
  >;
  [IPC_CHANNELS.workspaceAddEntry]: IpcContract<
    [request: AddWorkspaceEntryRequest],
    WorkspaceResult<WorkspaceMutationResultDto>
  >;
  [IPC_CHANNELS.workspaceRescan]: IpcContract<
    [],
    WorkspaceResult<WorkspaceDetailsDto>
  >;
  [IPC_CHANNELS.workspaceUpdateEntry]: IpcContract<
    [request: UpdateWorkspaceEntryRequest],
    WorkspaceResult<WorkspaceDetailsDto>
  >;
  [IPC_CHANNELS.workspaceRemoveEntry]: IpcContract<
    [request: RemoveWorkspaceEntryRequest],
    WorkspaceResult<WorkspaceDetailsDto>
  >;
  [IPC_CHANNELS.workspaceSetGroupCollapsed]: IpcContract<
    [request: SetWorkspaceGroupCollapsedRequest],
    WorkspaceResult<WorkspaceDetailsDto>
  >;
  [IPC_CHANNELS.workspaceSelectEntry]: IpcContract<
    [request: SelectWorkspaceEntryRequest],
    WorkspaceResult<WorkspaceDetailsDto>
  >;
  [IPC_CHANNELS.workspaceSelectTarget]: IpcContract<
    [request: SelectRepositoryTargetRequest],
    WorkspaceResult<WorkspaceDetailsDto>
  >;
  [IPC_CHANNELS.workspaceRefresh]: IpcContract<
    [],
    WorkspaceResult<WorkspaceRefreshAcceptedDto>
  >;
  [IPC_CHANNELS.repositoryGetChanges]: IpcContract<
    [request: RepositoryQueryRequest],
    GitReadResult<RepositoryChangesDto>
  >;
  [IPC_CHANNELS.repositoryGetDiff]: IpcContract<
    [request: RepositoryDiffRequest],
    GitReadResult<RepositoryDiffDto>
  >;
  [IPC_CHANNELS.repositoryGetHistory]: IpcContract<
    [request: RepositoryHistoryRequest],
    GitReadResult<RepositoryHistoryPageDto>
  >;
  [IPC_CHANNELS.repositoryGetCommit]: IpcContract<
    [request: RepositoryCommitRequest],
    GitReadResult<RepositoryCommitDto>
  >;
  [IPC_CHANNELS.repositoryGetBranches]: IpcContract<
    [request: RepositoryQueryRequest],
    GitReadResult<RepositoryBranchesDto>
  >;
  [IPC_CHANNELS.repositoryCancelQuery]: IpcContract<
    [request: CancelRepositoryQueryRequest],
    GitReadResult<void>
  >;
  [IPC_CHANNELS.repositoryStage]: IpcContract<
    [request: RepositoryPathsMutationRequest],
    GitReadResult<RepositoryPathsMutationDto>
  >;
  [IPC_CHANNELS.repositoryUnstage]: IpcContract<
    [request: RepositoryPathsMutationRequest],
    GitReadResult<RepositoryPathsMutationDto>
  >;
  [IPC_CHANNELS.repositoryDiscard]: IpcContract<
    [request: RepositoryPathsMutationRequest],
    GitReadResult<RepositoryPathsMutationDto>
  >;
  [IPC_CHANNELS.repositoryCreateCommit]: IpcContract<
    [request: CreateRepositoryCommitRequest],
    GitReadResult<RepositoryCommitMutationDto>
  >;
  [IPC_CHANNELS.repositoryCommandPreflight]: IpcContract<
    [request: RepositoryCommandPreflightRequest],
    GitReadResult<RepositoryCommandPreflightDto>
  >;
  [IPC_CHANNELS.repositoryCommandExecute]: IpcContract<
    [request: RepositoryCommandExecuteRequest],
    GitReadResult<RepositoryCommandExecutionDto>
  >;
  [IPC_CHANNELS.repositoryCancelOperation]: IpcContract<
    [request: CancelRepositoryOperationRequest],
    GitReadResult<void>
  >;
  [IPC_CHANNELS.worktreeSelectDirectory]: IpcContract<
    [],
    WorkspaceResult<WorkspaceDirectorySelectionDto>
  >;
  [IPC_CHANNELS.worktreeCommandPreflight]: IpcContract<
    [request: WorktreeCommandPreflightRequest],
    GitReadResult<WorktreeCommandPreflightDto>
  >;
  [IPC_CHANNELS.worktreeCommandExecute]: IpcContract<
    [request: WorktreeCommandExecuteRequest],
    GitReadResult<WorktreeCommandExecutionDto>
  >;
}

export type IpcChannel = keyof IpcContractMap;

export type IpcArguments<Channel extends IpcChannel> =
  IpcContractMap[Channel]["arguments"];

export type IpcResult<Channel extends IpcChannel> =
  IpcContractMap[Channel]["result"];

export type IpcInvoke = <Channel extends IpcChannel>(
  channel: Channel,
  ...args: IpcArguments<Channel>
) => Promise<IpcResult<Channel>>;
