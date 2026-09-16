export type GitReadErrorCode =
  | "GIT_NOT_FOUND"
  | "GIT_VERSION_UNSUPPORTED"
  | "NOT_A_REPOSITORY"
  | "DIRECTORY_UNAVAILABLE"
  | "COMMAND_CANCELLED"
  | "COMMAND_TIMEOUT"
  | "COMMAND_FAILED"
  | "OUTPUT_LIMIT_EXCEEDED"
  | "INVALID_GIT_OUTPUT"
  | "INVALID_REQUEST"
  | "PREFLIGHT_EXPIRED"
  | "PREFLIGHT_CHANGED"
  | "CONFIRMATION_REQUIRED"
  | "NON_FAST_FORWARD"
  | "AUTHENTICATION_FAILED";

export interface GitReadErrorDto {
  code: GitReadErrorCode;
  message: string;
  details: Readonly<Record<string, string | number | boolean>>;
}

export type GitReadResult<Value> =
  | {
      ok: true;
      value: Value;
    }
  | {
      ok: false;
      error: GitReadErrorDto;
    };

export interface GitEnvironmentDto {
  executablePath: string;
  version: string;
  lfs: {
    available: boolean;
    version?: string;
  };
  credentialHelpers: string[];
  ssh: {
    command: string;
    authSockConfigured: boolean;
    configPath?: string;
    configExists: boolean;
  };
  detectedAt: string;
}

export interface RepositoryInspectionRequest {
  path: string;
  historyLimit?: number;
}

export interface RepositoryIdentityDto {
  worktreePath: string;
  gitDir: string;
  commonDir: string;
  head: string;
}

export interface ChangedPathStatsDto {
  additions: number;
  deletions: number;
}

export interface ChangedPathDto {
  path: string;
  originalPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  kind: "ordinary" | "renamed" | "unmerged" | "untracked";
  stagedStats?: ChangedPathStatsDto;
  unstagedStats?: ChangedPathStatsDto;
  untrackedStats?: ChangedPathStatsDto;
}

export interface RepositorySnapshotDto {
  branch?: string;
  head: string;
  upstream?: string;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  changes: ChangedPathDto[];
  refreshedAt: string;
}

export interface BranchDto {
  fullName: string;
  name: string;
  head: string;
  upstream?: string;
  current: boolean;
  remote: boolean;
  merged?: boolean;
  worktreePath?: string;
  updatedAt?: string;
}

export interface CommitSummaryDto {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  subject: string;
  parentHashes: string[];
  refs?: string[];
}

export interface WorktreeDto {
  path: string;
  head: string;
  branch?: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  lockReason?: string;
  prunable: boolean;
  pruneReason?: string;
  primary: boolean;
}

export interface RepositoryInspectionDto {
  identity: RepositoryIdentityDto;
  snapshot: RepositorySnapshotDto;
  branches: BranchDto[];
  commits: CommitSummaryDto[];
  worktrees: WorktreeDto[];
}
