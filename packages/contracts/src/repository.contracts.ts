import type {
  BranchDto,
  CommitSummaryDto,
  RepositorySnapshotDto
} from "./git.contracts";
import type { GitPushStrategyDto } from "./settings.contracts";
import type { RepositoryTargetDto } from "./workspace.contracts";

export interface RepositoryQueryRequest {
  queryId: string;
  target: RepositoryTargetDto;
}

export interface RepositoryDiffRequest
  extends RepositoryQueryRequest {
  path: string;
  mode: "unstaged" | "staged" | "untracked";
}

export interface RepositoryHistoryRequest
  extends RepositoryQueryRequest {
  limit?: number;
  offset?: number;
}

export interface RepositoryCommitRequest
  extends RepositoryQueryRequest {
  commitHash: string;
}

export interface CancelRepositoryQueryRequest {
  queryId: string;
}

export interface RepositoryPathsMutationRequest {
  target: RepositoryTargetDto;
  paths: string[];
}

export interface CreateRepositoryCommitRequest {
  target: RepositoryTargetDto;
  subject: string;
  body?: string;
}

export interface RepositoryChangesDto {
  target: RepositoryTargetDto;
  snapshot: RepositorySnapshotDto;
}

export interface RepositoryDiffDto {
  target: RepositoryTargetDto;
  diff: {
    path: string;
    mode: "unstaged" | "staged" | "untracked";
    content: string;
    binary: boolean;
    truncated: boolean;
    additions: number;
    deletions: number;
  };
}

export interface RepositoryHistoryPageDto {
  target: RepositoryTargetDto;
  page: {
    commits: CommitSummaryDto[];
    nextOffset?: number;
  };
}

export interface CommitFileStatDto {
  path: string;
  additions?: number;
  deletions?: number;
  binary: boolean;
}

export interface RepositoryCommitDto {
  target: RepositoryTargetDto;
  commit: CommitSummaryDto & {
    committerName: string;
    committerEmail: string;
    committedAt: string;
    body: string;
    refs: string[];
    files: CommitFileStatDto[];
    additions: number;
    deletions: number;
  };
}

export interface RepositoryBranchesDto {
  target: RepositoryTargetDto;
  branches: BranchDto[];
}

export interface RepositoryPathsMutationDto {
  target: RepositoryTargetDto;
  operationId: string;
}

export interface RepositoryCommitMutationDto
  extends RepositoryPathsMutationDto {
  commit: {
    hash?: string;
    shortHash?: string;
    subject: string;
  };
}

export type RepositoryCommandDto =
  | {
      type: "fetch";
      targets: RepositoryTargetDto[];
      remote?: string;
      prune?: boolean;
    }
  | {
      type: "pull";
      targets: RepositoryTargetDto[];
      strategy: "ff-only";
    }
  | {
      type: "push";
      targets: RepositoryTargetDto[];
      remote?: string;
      strategy?: GitPushStrategyDto;
    }
  | {
      type: "switch-branch";
      target: RepositoryTargetDto;
      branch: string;
    }
  | {
      type: "create-branch";
      target: RepositoryTargetDto;
      branch: string;
      startPoint?: string;
    }
  | {
      type: "rename-branch";
      target: RepositoryTargetDto;
      branch: string;
      newName: string;
    }
  | {
      type: "delete-branch";
      target: RepositoryTargetDto;
      branch: string;
    };

export interface RepositoryCommandImpactDto {
  kind:
    | "remote-refs"
    | "worktree-update"
    | "remote-branch"
    | "local-branch";
  target: RepositoryTargetDto;
  summary: string;
  detail: string;
}

export interface RepositoryCommandWarningDto {
  code:
    | "REMOTE_CONTACT"
    | "SET_UPSTREAM"
    | "REMOTE_BRANCH_EXISTS";
  severity: "info" | "warning" | "danger";
  message: string;
}

export interface RepositoryCommandPreflightRequest {
  command: RepositoryCommandDto;
}

export interface RepositoryCommandPreflightDto {
  preflightId: string;
  expiresAt: string;
  command: RepositoryCommandDto;
  targetSummary: string;
  impacts: RepositoryCommandImpactDto[];
  warnings: RepositoryCommandWarningDto[];
  confirmationRequired: boolean;
}

export interface RepositoryCommandExecuteRequest {
  command: RepositoryCommandDto;
  preflightId: string;
  confirmed: boolean;
}

export interface RepositoryCommandExecutionDto {
  operationIds: string[];
}

export interface CancelRepositoryOperationRequest {
  operationId: string;
}
