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
  RepositoryTargetDto,
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

export type ExternalTerminalKindDto =
  | "windows-terminal"
  | "powershell"
  | "cmd"
  | "git-bash";

export interface ExternalTerminalProfileDto {
  kind: ExternalTerminalKindDto;
  label: string;
}

export type ExternalApplicationKindDto =
  | "vscode"
  | "cursor"
  | "intellij-idea"
  | "sublime-text"
  | "file-explorer"
  | "terminal"
  | "git-bash";

export interface ExternalApplicationProfileDto {
  kind: ExternalApplicationKindDto;
  label: string;
  iconDataUrl?: string;
}

export type OpenExternalApplicationContextDto =
  | {
      scope: "workspace";
    }
  | {
      scope: "repository";
      target: RepositoryTargetDto;
    }
  | {
      scope: "file";
      target: RepositoryTargetDto;
      path: string;
    };

export interface OpenExternalApplicationRequest {
  context: OpenExternalApplicationContextDto;
  kind: ExternalApplicationKindDto;
}

export interface ExternalApplicationOpenedDto {
  kind: ExternalApplicationKindDto;
  label: string;
  scope: OpenExternalApplicationContextDto["scope"];
}

export interface OpenExternalTerminalRequest {
  target: RepositoryQueryRequest["target"];
  kind: ExternalTerminalKindDto;
}

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

export interface ExternalTerminalOpenedDto {
  target: RepositoryQueryRequest["target"];
  kind: ExternalTerminalKindDto;
  label: string;
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
    selectDirectory(): Promise<
      WorkspaceResult<WorkspaceDirectorySelectionDto>
    >;
    addEntry(
      request: AddWorkspaceEntryRequest
    ): Promise<WorkspaceResult<WorkspaceMutationResultDto>>;
    rescan(): Promise<WorkspaceResult<WorkspaceDetailsDto>>;
    updateEntry(
      request: UpdateWorkspaceEntryRequest
    ): Promise<WorkspaceResult<WorkspaceDetailsDto>>;
    removeEntry(
      request: RemoveWorkspaceEntryRequest
    ): Promise<WorkspaceResult<WorkspaceDetailsDto>>;
    setGroupCollapsed(
      request: SetWorkspaceGroupCollapsedRequest
    ): Promise<WorkspaceResult<WorkspaceDetailsDto>>;
    selectEntry(
      request: SelectWorkspaceEntryRequest
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
    resolveDroppedPath(file: unknown): string;
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
    minimize(): Promise<void>;
    toggleMaximize(): Promise<boolean>;
    close(): Promise<void>;
    openDiffViewer(request: OpenDiffViewerRequest): Promise<void>;
  };
}
