export type WorkspaceErrorCode =
  | "INVALID_REQUEST"
  | "DIRECTORY_UNAVAILABLE"
  | "NO_REPOSITORIES_FOUND"
  | "GROUP_NOT_FOUND"
  | "SCAN_CANCELLED"
  | "SCAN_FAILED"
  | "PERSISTENCE_FAILED"
  | "INVALID_PERSISTED_DATA";

export interface WorkspaceErrorDto {
  code: WorkspaceErrorCode;
  message: string;
  details: Readonly<Record<string, string | number | boolean>>;
}

export type WorkspaceResult<Value> =
  | {
      ok: true;
      value: Value;
    }
  | {
      ok: false;
      error: WorkspaceErrorDto;
    };

export interface RepositoryTargetDto {
  repositoryId: string;
  worktreeId: string;
}

export interface WorkspaceRepositoryDto {
  id: string;
  name: string;
  commonDir: string;
  canonicalCommonDir: string;
  primaryWorktreeId?: string;
  worktreeIds: string[];
}

export interface WorkspaceWorktreeDto {
  id: string;
  repositoryId: string;
  name: string;
  path: string;
  canonicalPath: string;
  gitDir?: string;
  head: string;
  branch?: string;
  isPrimary: boolean;
  isBare: boolean;
  isDetached: boolean;
  isLocked: boolean;
  lockReason?: string;
  isPrunable: boolean;
  pruneReason?: string;
}

export interface WorkspaceScanIssueDto {
  path: string;
  code:
    | "DIRECTORY_UNAVAILABLE"
    | "PERMISSION_DENIED"
    | "REPOSITORY_UNAVAILABLE"
    | "OUTSIDE_ROOT_LINK_SKIPPED"
    | "SYMLINK_LOOP_SKIPPED";
  message: string;
}

export interface RepositoryGroupDto {
  id: string;
  name: string;
  targets: RepositoryTargetDto[];
  collapsed: boolean;
}

export interface WorkspaceRootDto {
  path: string;
  canonicalPath: string;
  excludes: string[];
}

export interface WorkspaceDetailsDto {
  schemaVersion: 2;
  id: string;
  name: string;
  path?: string;
  canonicalPath?: string;
  excludes: string[];
  additionalRoots?: WorkspaceRootDto[];
  groups: RepositoryGroupDto[];
  scanIssues: WorkspaceScanIssueDto[];
  lastScannedAt?: string;
  repositories: WorkspaceRepositoryDto[];
  worktrees: WorkspaceWorktreeDto[];
  selectedTarget?: RepositoryTargetDto;
  updatedAt: string;
}

export interface WorkspaceSummaryDto {
  id: string;
  name: string;
  updatedAt: string;
}

export interface CreateWorkspaceRequest {
  name: string;
  path: string;
}

export interface SwitchWorkspaceRequest {
  workspaceId: string;
}

export interface RenameWorkspaceRequest {
  workspaceId: string;
  name: string;
}

export interface DeleteWorkspaceRequest {
  workspaceId: string;
}

export interface AddWorkspaceDirectoryRequest {
  path: string;
}

export interface AddWorkspaceDirectoryResultDto {
  workspace: WorkspaceDetailsDto;
  duplicate: boolean;
}

export interface RemoveWorkspaceRepositoryRequest {
  target: RepositoryTargetDto;
}

export interface SetWorkspaceGroupCollapsedRequest {
  groupId: string;
  collapsed: boolean;
}

export interface SelectRepositoryTargetRequest {
  target: RepositoryTargetDto;
}

export interface RepositoryStatusSnapshotDto
  extends RepositoryTargetDto {
  branch?: string;
  head: string;
  upstream?: string;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  operationState?:
    | "merge"
    | "rebase"
    | "cherry-pick"
    | "revert"
    | "bisect";
  contentVersion?: number;
  refreshPending: boolean;
  stale: boolean;
  refreshedAt: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface WorkspaceOperationDto {
  id: string;
  kind:
    | "scan"
    | "status"
    | "stage"
    | "unstage"
    | "discard"
    | "commit"
    | "stash-apply"
    | "stash-drop"
    | "stash-pop"
    | "fetch"
    | "pull"
    | "push"
    | "switch-branch"
    | "create-branch"
    | "rename-branch"
    | "delete-branch"
    | "worktree-create"
    | "worktree-lock"
    | "worktree-unlock"
    | "worktree-move"
    | "worktree-repair"
    | "worktree-prune"
    | "worktree-remove";
  scope: "workspace" | "repository" | "worktree";
  targetIds: string[];
  state:
    | "queued"
    | "running"
    | "cancelling"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "interrupted";
  progress: number;
  succeeded: number;
  failed: number;
  message: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface WorkspaceMonitorStateDto {
  mode: "inactive" | "watching" | "polling";
  watchedTargets: number;
  message: string;
  lastEventAt?: string;
}

export interface WorkspaceRuntimeStateDto {
  workspace: WorkspaceDetailsDto;
  workspaces: WorkspaceSummaryDto[];
  snapshots: RepositoryStatusSnapshotDto[];
  operations: WorkspaceOperationDto[];
  monitor: WorkspaceMonitorStateDto;
  cleanupWarning?: string;
}

export interface WorkspaceRefreshAcceptedDto {
  operationId: string;
}

export type WorkspaceDirectorySelectionDto =
  | {
      cancelled: true;
    }
  | {
      cancelled: false;
      path: string;
    };
