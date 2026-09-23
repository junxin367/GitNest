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
  CancelCodeAnalysisRequest,
  CodeAnalysisAcceptedDto,
  CodeAnalysisFileDto,
  CodeAnalysisSnapshotDto,
  CodeAnalysisStateDto,
  InstallLanguageServerRequest,
  LanguageServerInstallResultDto,
  McpRegistrationStatusDto,
  ReadCodeAnalysisFileRequest,
  SetMcpRegistrationRequest,
  RestoreCodeAnalysisSnapshotRequest,
  StartCodeAnalysisRequest
} from "./analysis.contracts";
import type {
  ExternalApplicationOpenedDto,
  ExternalApplicationProfileDto,
  ExternalTerminalOpenedDto,
  ExternalTerminalProfileDto,
  OpenExternalApplicationRequest,
  OpenExternalTerminalRequest
} from "./external.contracts";
import type {
  GitEnvironmentDto,
  GitReadResult,
  RepositoryInspectionDto,
  RepositoryInspectionRequest
} from "./git.contracts";
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
  RepositoryTargetDto,
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
  AppSettingsDto,
  AppSettingsLoadDto,
  ClearAiApiKeyRequest,
  GenerateAiCommitMessageRequest,
  TestAiConnectionRequest,
  UpdateAppSettingsRequest
} from "./settings.contracts";
import type {
  AcknowledgeApplicationUpdatePromptRequest,
  ApplicationUpdateStateDto
} from "./update.contracts";

export interface OpenDirectoryRequest {
  target: RepositoryTargetDto;
}

export interface OpenFileLocationRequest {
  target: RepositoryTargetDto;
  path: string;
}

export interface OpenDiffViewerRequest {
  target: RepositoryTargetDto;
  path: string;
  mode: RepositoryDiffRequest["mode"];
}

export type RuntimePlatform =
  | "aix"
  | "android"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "openbsd"
  | "sunos"
  | "win32"
  | "cygwin"
  | "netbsd";

export interface RuntimeInfo {
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  platform: RuntimePlatform;
}

export interface GitNestBridge {
  update: {
    getState(): Promise<ApplicationUpdateStateDto>;
    check(): Promise<ApplicationUpdateStateDto>;
    acknowledgePrompt(
      request: AcknowledgeApplicationUpdatePromptRequest
    ): Promise<ApplicationUpdateStateDto>;
    downloadAndInstall(): Promise<ApplicationUpdateStateDto>;
    openProjectPage(): Promise<ApplicationUpdateStateDto>;
    openReleasePage(): Promise<ApplicationUpdateStateDto>;
    onStateChanged(
      listener: (state: ApplicationUpdateStateDto) => void
    ): () => void;
  };
  codeAnalysis: {
    getState(): Promise<GitReadResult<CodeAnalysisStateDto>>;
    start(
      request: StartCodeAnalysisRequest
    ): Promise<GitReadResult<CodeAnalysisAcceptedDto>>;
    restoreSnapshot(
      request: RestoreCodeAnalysisSnapshotRequest
    ): Promise<GitReadResult<boolean>>;
    cancel(
      request: CancelCodeAnalysisRequest
    ): Promise<GitReadResult<void>>;
    getSnapshot(): Promise<
      GitReadResult<CodeAnalysisSnapshotDto | null>
    >;
    readFile(
      request: ReadCodeAnalysisFileRequest
    ): Promise<GitReadResult<CodeAnalysisFileDto>>;
    installLanguageServer(
      request: InstallLanguageServerRequest
    ): Promise<GitReadResult<LanguageServerInstallResultDto>>;
    getMcpRegistration(): Promise<
      GitReadResult<McpRegistrationStatusDto>
    >;
    setMcpRegistration(
      request: SetMcpRegistrationRequest
    ): Promise<GitReadResult<McpRegistrationStatusDto>>;
    onStateChanged(
      listener: (state: CodeAnalysisStateDto) => void
    ): () => void;
  };
  settings: {
    get(): Promise<GitReadResult<AppSettingsLoadDto>>;
    update(
      request: UpdateAppSettingsRequest
    ): Promise<GitReadResult<AppSettingsDto>>;
    clearAiApiKey(
      request: ClearAiApiKeyRequest
    ): Promise<GitReadResult<AppSettingsDto>>;
    onChanged(
      listener: (settings: AppSettingsDto) => void
    ): () => void;
  };
  ai: {
    testConnection(
      request: TestAiConnectionRequest
    ): Promise<GitReadResult<AiConnectionTestResultDto>>;
    generateCommitMessage(
      request: GenerateAiCommitMessageRequest
    ): Promise<GitReadResult<AiCommitMessageDto>>;
  };
  account: {
    list(): Promise<GitReadResult<AccountOverviewDto>>;
    save(
      request: SaveAccountRequest
    ): Promise<GitReadResult<AccountProfileDto>>;
    bind(
      request: BindAccountRequest
    ): Promise<GitReadResult<AccountOverviewDto>>;
    unbind(
      request: UnbindAccountRequest
    ): Promise<GitReadResult<AccountOverviewDto>>;
    getRemovalImpact(
      request: AccountRemovalImpactRequest
    ): Promise<GitReadResult<AccountRemovalImpactDto>>;
    remove(
      request: RemoveAccountRequest
    ): Promise<GitReadResult<AccountRemovalImpactDto>>;
    test(
      request: TestAccountRequest
    ): Promise<GitReadResult<AccountConnectionTestResultDto>>;
  };
  system: {
    getRuntimeInfo(): Promise<RuntimeInfo>;
    listExternalApplications(): Promise<
      GitReadResult<ExternalApplicationProfileDto[]>
    >;
    openExternalApplication(
      request: OpenExternalApplicationRequest
    ): Promise<GitReadResult<ExternalApplicationOpenedDto>>;
    listExternalTerminals(): Promise<
      GitReadResult<ExternalTerminalProfileDto[]>
    >;
    openExternalTerminal(
      request: OpenExternalTerminalRequest
    ): Promise<GitReadResult<ExternalTerminalOpenedDto>>;
    openDirectory(
      request: OpenDirectoryRequest
    ): Promise<GitReadResult<void>>;
    openFileLocation(
      request: OpenFileLocationRequest
    ): Promise<GitReadResult<void>>;
  };
  git: {
    getEnvironment(): Promise<GitReadResult<GitEnvironmentDto>>;
    inspectRepository(
      request: RepositoryInspectionRequest
    ): Promise<GitReadResult<RepositoryInspectionDto>>;
  };
  workspace: {
    getCurrent(): Promise<WorkspaceResult<WorkspaceDetailsDto>>;
    getState(): Promise<WorkspaceResult<WorkspaceRuntimeStateDto>>;
    create(
      request: CreateWorkspaceRequest
    ): Promise<WorkspaceResult<WorkspaceRuntimeStateDto>>;
    switch(
      request: SwitchWorkspaceRequest
    ): Promise<WorkspaceResult<WorkspaceRuntimeStateDto>>;
    rename(
      request: RenameWorkspaceRequest
    ): Promise<WorkspaceResult<WorkspaceRuntimeStateDto>>;
    delete(
      request: DeleteWorkspaceRequest
    ): Promise<WorkspaceResult<WorkspaceRuntimeStateDto>>;
    selectDirectory(): Promise<
      WorkspaceResult<WorkspaceDirectorySelectionDto>
    >;
    addDirectory(
      request: AddWorkspaceDirectoryRequest
    ): Promise<WorkspaceResult<AddWorkspaceDirectoryResultDto>>;
    rescan(): Promise<WorkspaceResult<WorkspaceDetailsDto>>;
    removeRepository(
      request: RemoveWorkspaceRepositoryRequest
    ): Promise<WorkspaceResult<WorkspaceDetailsDto>>;
    setGroupCollapsed(
      request: SetWorkspaceGroupCollapsedRequest
    ): Promise<WorkspaceResult<WorkspaceDetailsDto>>;
    selectTarget(
      request: SelectRepositoryTargetRequest
    ): Promise<WorkspaceResult<WorkspaceDetailsDto>>;
    refresh(): Promise<
      WorkspaceResult<WorkspaceRefreshAcceptedDto>
    >;
    onStateChanged(
      listener: (state: WorkspaceRuntimeStateDto) => void
    ): () => void;
  };
  repository: {
    getChanges(
      request: RepositoryQueryRequest
    ): Promise<GitReadResult<RepositoryChangesDto>>;
    getDiff(
      request: RepositoryDiffRequest
    ): Promise<GitReadResult<RepositoryDiffDto>>;
    getHistory(
      request: RepositoryHistoryRequest
    ): Promise<GitReadResult<RepositoryHistoryPageDto>>;
    getCommit(
      request: RepositoryCommitRequest
    ): Promise<GitReadResult<RepositoryCommitDto>>;
    getCommitDiff(
      request: RepositoryCommitDiffRequest
    ): Promise<GitReadResult<RepositoryCommitDiffDto>>;
    getStashes(
      request: RepositoryStashesRequest
    ): Promise<GitReadResult<RepositoryStashesDto>>;
    getStashFiles(
      request: RepositoryStashRequest
    ): Promise<GitReadResult<RepositoryStashFilesDto>>;
    getStashDiff(
      request: RepositoryStashDiffRequest
    ): Promise<GitReadResult<RepositoryStashDiffDto>>;
    getBranches(
      request: RepositoryQueryRequest
    ): Promise<GitReadResult<RepositoryBranchesDto>>;
    cancelQuery(
      request: CancelRepositoryQueryRequest
    ): Promise<GitReadResult<void>>;
    stage(
      request: RepositoryPathsMutationRequest
    ): Promise<GitReadResult<RepositoryPathsMutationDto>>;
    unstage(
      request: RepositoryPathsMutationRequest
    ): Promise<GitReadResult<RepositoryPathsMutationDto>>;
    discard(
      request: RepositoryPathsMutationRequest
    ): Promise<GitReadResult<RepositoryPathsMutationDto>>;
    mutateStash(
      request: RepositoryStashMutationRequest
    ): Promise<GitReadResult<RepositoryStashMutationDto>>;
    createCommit(
      request: CreateRepositoryCommitRequest
    ): Promise<GitReadResult<RepositoryCommitMutationDto>>;
    preflightCommand(
      request: RepositoryCommandPreflightRequest
    ): Promise<GitReadResult<RepositoryCommandPreflightDto>>;
    executeCommand(
      request: RepositoryCommandExecuteRequest
    ): Promise<GitReadResult<RepositoryCommandExecutionDto>>;
    cancelOperation(
      request: CancelRepositoryOperationRequest
    ): Promise<GitReadResult<void>>;
  };
  worktree: {
    selectDirectory(): Promise<
      WorkspaceResult<WorkspaceDirectorySelectionDto>
    >;
    preflightCommand(
      request: WorktreeCommandPreflightRequest
    ): Promise<GitReadResult<WorktreeCommandPreflightDto>>;
    executeCommand(
      request: WorktreeCommandExecuteRequest
    ): Promise<GitReadResult<WorktreeCommandExecutionDto>>;
  };
  window: {
    isMaximized(): Promise<boolean>;
    minimize(): Promise<void>;
    toggleMaximize(): Promise<boolean>;
    onMaximizedChanged(
      listener: (maximized: boolean) => void
    ): () => void;
    close(): Promise<void>;
    openDiffViewer(request: OpenDiffViewerRequest): Promise<void>;
  };
}
