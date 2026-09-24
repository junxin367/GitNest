import { IPC_CHANNELS } from "./channels";
import type {
  CancelCodeAnalysisRequest,
  CodeAnalysisAcceptedDto,
  CodeAnalysisFileDto,
  CodeAnalysisSnapshotDto,
  CodeAnalysisStateDto,
  GetCodeAnalysisSnapshotRequest,
  InstallLanguageServerRequest,
  LanguageServerInstallResultDto,
  McpRegistrationStatusDto,
  ReadCodeAnalysisFileRequest,
  RestoreCodeAnalysisSnapshotRequest,
  SetMcpRegistrationRequest,
  StartCodeAnalysisRequest
} from "./analysis.contracts";
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
  OpenExternalApplicationRequest,
  OpenExternalTerminalRequest
} from "./external.contracts";
import type {
  OpenDirectoryRequest,
  OpenDiffViewerRequest,
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
  RepositoryCommitDiffDto,
  RepositoryCommitDiffRequest,
  RepositoryCommitDto,
  RepositoryCommitMutationDto,
  RepositoryCommitRequest,
  RepositoryDiffDto,
  RepositoryDiffRequest,
  RepositoryHistoryPageDto,
  RepositoryHistoryRequest,
  RepositoryStashDiffDto,
  RepositoryStashDiffRequest,
  RepositoryStashFilesDto,
  RepositoryStashRequest,
  RepositoryStashMutationDto,
  RepositoryStashMutationRequest,
  RepositoryStashesDto,
  RepositoryStashesRequest,
  RepositoryPathsMutationDto,
  RepositoryPathsMutationRequest,
  RepositoryQueryRequest
} from "./repository.contracts";
import type {
  AddWorkspaceDirectoryRequest,
  AddWorkspaceDirectoryResultDto,
  CreateWorkspaceRequest,
  DeleteWorkspaceRequest,
  RemoveWorkspaceRepositoryRequest,
  RenameWorkspaceRequest,
  SelectRepositoryTargetRequest,
  SetWorkspaceGroupCollapsedRequest,
  SwitchWorkspaceRequest,
  WorkspaceDetailsDto,
  WorkspaceDirectorySelectionDto,
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
  AiApiKeyValueDto,
  AppSettingsDto,
  AppSettingsLoadDto,
  ClearAiApiKeyRequest,
  GenerateAiCommitMessageRequest,
  ReadAiApiKeyRequest,
  TestAiConnectionRequest,
  UpdateAppSettingsRequest
} from "./settings.contracts";
import type {
  AcknowledgeApplicationUpdatePromptRequest,
  ApplicationUpdateStateDto
} from "./update.contracts";

interface IpcContract<
  Arguments extends unknown[],
  Result
> {
  arguments: Arguments;
  result: Result;
}

export interface IpcContractMap {
  [IPC_CHANNELS.updateGetState]: IpcContract<
    [],
    ApplicationUpdateStateDto
  >;
  [IPC_CHANNELS.updateCheck]: IpcContract<
    [],
    ApplicationUpdateStateDto
  >;
  [IPC_CHANNELS.updateAcknowledgePrompt]: IpcContract<
    [request: AcknowledgeApplicationUpdatePromptRequest],
    ApplicationUpdateStateDto
  >;
  [IPC_CHANNELS.updateDownloadAndInstall]: IpcContract<
    [],
    ApplicationUpdateStateDto
  >;
  [IPC_CHANNELS.updateOpenProjectPage]: IpcContract<
    [],
    ApplicationUpdateStateDto
  >;
  [IPC_CHANNELS.updateOpenReleasePage]: IpcContract<
    [],
    ApplicationUpdateStateDto
  >;
  [IPC_CHANNELS.codeAnalysisGetState]: IpcContract<
    [],
    GitReadResult<CodeAnalysisStateDto>
  >;
  [IPC_CHANNELS.codeAnalysisStart]: IpcContract<
    [request: StartCodeAnalysisRequest],
    GitReadResult<CodeAnalysisAcceptedDto>
  >;
  [IPC_CHANNELS.codeAnalysisRestoreSnapshot]: IpcContract<
    [request: RestoreCodeAnalysisSnapshotRequest],
    GitReadResult<boolean>
  >;
  [IPC_CHANNELS.codeAnalysisCancel]: IpcContract<
    [request: CancelCodeAnalysisRequest],
    GitReadResult<void>
  >;
  [IPC_CHANNELS.codeAnalysisGetSnapshot]: IpcContract<
    [request?: GetCodeAnalysisSnapshotRequest],
    GitReadResult<CodeAnalysisSnapshotDto | null>
  >;
  [IPC_CHANNELS.codeAnalysisReadFile]: IpcContract<
    [request: ReadCodeAnalysisFileRequest],
    GitReadResult<CodeAnalysisFileDto>
  >;
  [IPC_CHANNELS.codeAnalysisInstallLanguageServer]: IpcContract<
    [request: InstallLanguageServerRequest],
    GitReadResult<LanguageServerInstallResultDto>
  >;
  [IPC_CHANNELS.codeAnalysisGetMcpRegistration]: IpcContract<
    [],
    GitReadResult<McpRegistrationStatusDto>
  >;
  [IPC_CHANNELS.codeAnalysisSetMcpRegistration]: IpcContract<
    [request: SetMcpRegistrationRequest],
    GitReadResult<McpRegistrationStatusDto>
  >;
  [IPC_CHANNELS.settingsGet]: IpcContract<
    [],
    GitReadResult<AppSettingsLoadDto>
  >;
  [IPC_CHANNELS.settingsUpdate]: IpcContract<
    [request: UpdateAppSettingsRequest],
    GitReadResult<AppSettingsDto>
  >;
  [IPC_CHANNELS.settingsReadAiApiKey]: IpcContract<
    [request: ReadAiApiKeyRequest],
    GitReadResult<AiApiKeyValueDto>
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
  [IPC_CHANNELS.systemOpenIssuesPage]: IpcContract<[], void>;
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
  [IPC_CHANNELS.windowIsMaximized]: IpcContract<[], boolean>;
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
  [IPC_CHANNELS.workspaceCreate]: IpcContract<
    [request: CreateWorkspaceRequest],
    WorkspaceResult<WorkspaceRuntimeStateDto>
  >;
  [IPC_CHANNELS.workspaceSwitch]: IpcContract<
    [request: SwitchWorkspaceRequest],
    WorkspaceResult<WorkspaceRuntimeStateDto>
  >;
  [IPC_CHANNELS.workspaceRename]: IpcContract<
    [request: RenameWorkspaceRequest],
    WorkspaceResult<WorkspaceRuntimeStateDto>
  >;
  [IPC_CHANNELS.workspaceDelete]: IpcContract<
    [request: DeleteWorkspaceRequest],
    WorkspaceResult<WorkspaceRuntimeStateDto>
  >;
  [IPC_CHANNELS.workspaceSelectDirectory]: IpcContract<
    [],
    WorkspaceResult<WorkspaceDirectorySelectionDto>
  >;
  [IPC_CHANNELS.workspaceAddDirectory]: IpcContract<
    [request: AddWorkspaceDirectoryRequest],
    WorkspaceResult<AddWorkspaceDirectoryResultDto>
  >;
  [IPC_CHANNELS.workspaceRescan]: IpcContract<
    [],
    WorkspaceResult<WorkspaceDetailsDto>
  >;
  [IPC_CHANNELS.workspaceRemoveRepository]: IpcContract<
    [request: RemoveWorkspaceRepositoryRequest],
    WorkspaceResult<WorkspaceDetailsDto>
  >;
  [IPC_CHANNELS.workspaceSetGroupCollapsed]: IpcContract<
    [request: SetWorkspaceGroupCollapsedRequest],
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
  [IPC_CHANNELS.repositoryGetCommitDiff]: IpcContract<
    [request: RepositoryCommitDiffRequest],
    GitReadResult<RepositoryCommitDiffDto>
  >;
  [IPC_CHANNELS.repositoryGetStashes]: IpcContract<
    [request: RepositoryStashesRequest],
    GitReadResult<RepositoryStashesDto>
  >;
  [IPC_CHANNELS.repositoryGetStashFiles]: IpcContract<
    [request: RepositoryStashRequest],
    GitReadResult<RepositoryStashFilesDto>
  >;
  [IPC_CHANNELS.repositoryGetStashDiff]: IpcContract<
    [request: RepositoryStashDiffRequest],
    GitReadResult<RepositoryStashDiffDto>
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
  [IPC_CHANNELS.repositoryMutateStash]: IpcContract<
    [request: RepositoryStashMutationRequest],
    GitReadResult<RepositoryStashMutationDto>
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
