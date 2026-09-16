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
  contextLines?: number;
}

export interface RepositoryHistoryRequest
  extends RepositoryQueryRequest {
  limit?: number;
  offset?: number;
  scope?: RepositoryHistoryScopeDto;
}

export type RepositoryHistoryScopeDto =
  | {
      kind: "ref";
      ref: string;
    }
  | {
      kind: "compare";
      leftRef: string;
      rightRef: string;
    };

export type CommitHistoryComparisonSideDto =
  | "left"
  | "right"
  | "base";

export interface RepositoryCommitRequest
  extends RepositoryQueryRequest {
  commitHash: string;
}

export interface RepositoryCommitDiffRequest
  extends RepositoryCommitRequest {
  path: string;
  contextLines?: number;
}

export interface RepositoryStashesRequest
  extends RepositoryQueryRequest {
  limit?: number;
}

export interface RepositoryStashRequest
  extends RepositoryQueryRequest {
  stashRef: string;
}

export interface RepositoryStashDiffRequest
  extends RepositoryStashRequest {
  path: string;
  contextLines?: number;
}

export interface CancelRepositoryQueryRequest {
  queryId: string;
}

export interface RepositoryPathsMutationRequest {
  target: RepositoryTargetDto;
  paths: string[];
}

export type RepositoryStashMutationAction =
  | "apply"
  | "drop"
  | "pop";

export interface RepositoryStashMutationRequest {
  target: RepositoryTargetDto;
  stashRef: string;
  stashHash: string;
  action: RepositoryStashMutationAction;
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

export type RepositoryMediaKindDto =
  | "image"
  | "video"
  | "audio";

export type RepositoryMediaUnavailableReasonDto =
  | "too-large"
  | "missing"
  | "not-file";

export type RepositoryMediaPreviewDto =
  | {
      status: "available";
      kind: RepositoryMediaKindDto;
      mimeType: string;
      size: number;
      content: Uint8Array;
    }
  | {
      status: "unavailable";
      kind: RepositoryMediaKindDto;
      mimeType: string;
      reason: RepositoryMediaUnavailableReasonDto;
      size?: number;
    };

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
    media?: RepositoryMediaPreviewDto;
  };
}

export interface RepositoryHistoryPageDto {
  target: RepositoryTargetDto;
  page: {
    commits: Array<
      CommitSummaryDto & {
        comparisonSide?: CommitHistoryComparisonSideDto;
      }
    >;
    nextOffset?: number;
    comparison?: {
      leftRef: string;
      rightRef: string;
      leftOnly: number;
      rightOnly: number;
      mergeBase?: string;
    };
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

export interface RepositoryCommitDiffDto {
  target: RepositoryTargetDto;
  commit: {
    hash: string;
  };
  diff: {
    path: string;
    content: string;
    binary: boolean;
    truncated: boolean;
    additions: number;
    deletions: number;
  };
}

export interface StashFileStatDto {
  path: string;
  additions?: number;
  deletions?: number;
  binary: boolean;
}

export interface StashSummaryDto {
  ref: string;
  hash: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  parentHashes: string[];
  baseHash?: string;
  files?: number;
  additions?: number;
  deletions?: number;
}

export interface RepositoryStashesDto {
  target: RepositoryTargetDto;
  stashes: StashSummaryDto[];
}

export interface RepositoryStashFilesDto {
  target: RepositoryTargetDto;
  stash: {
    ref: string;
    hash: string;
    files: StashFileStatDto[];
    additions: number;
    deletions: number;
  };
}

export interface RepositoryStashDiffDto {
  target: RepositoryTargetDto;
  stash: {
    ref: string;
    hash: string;
  };
  diff: {
    path: string;
    content: string;
    binary: boolean;
    truncated: boolean;
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

export interface RepositoryStashMutationDto
  extends RepositoryPathsMutationDto {
  action: RepositoryStashMutationAction;
  stashRef: string;
  stashHash: string;
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
