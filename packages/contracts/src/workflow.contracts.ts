import type { RepositoryTargetDto } from "./workspace.contracts";

export type RepositoryWorkflowOperationDto = "merge" | "rebase" | "cherry-pick" | "revert";
export type RepositoryWorkflowActionDto = (
  | { type: "create-stash"; message?: string; includeUntracked?: boolean; paths?: string[] }
  | { type: "amend"; message: string; expectedHead?: string }
  | { type: "undo-commit"; mode: "soft" | "mixed"; expectedHead?: string }
  | { type: "cherry-pick"; commitHash: string; mainline?: number; noCommit?: boolean; recordOrigin?: boolean; expectedHead?: string }
  | { type: "revert"; commitHash: string; mainline?: number; noCommit?: boolean; expectedHead?: string }
  | { type: "reset"; commitHash: string; mode: "soft" | "mixed" | "hard"; expectedHead?: string }
  | { type: "checkout-commit"; commitHash: string; expectedHead?: string }
  | { type: "merge"; commitHash: string; mode: "normal" | "no-ff" | "squash"; noCommit?: boolean; expectedHead?: string }
  | { type: "rebase"; commitHash: string; preserveMerges?: boolean; expectedHead?: string }
  | { type: "mark-resolved"; paths: string[] }
  | { type: "continue" }
  | { type: "skip" }
  | { type: "keep-empty" }
  | { type: "abort" }
) & { expectedBranch?: string | null };
export type RepositoryWorkflowCommandDto = RepositoryWorkflowActionDto & { target: RepositoryTargetDto };
export interface RepositoryWorkflowStateDto {
  target: RepositoryTargetDto;
  head: string | null;
  branch: string | null;
  headMessage: string;
  parentCount: number;
  operation: RepositoryWorkflowOperationDto | null;
  currentReplay?: {
    commitHash: string;
    subject: string;
    isEmpty: boolean;
    canSkip: boolean;
    canKeepEmpty: boolean;
    blockedReason?: string;
    noCommit?: boolean;
    continueBlockedReason?: string;
  } | null;
  conflictedPaths: string[];
  changedPaths: string[];
  partialStashBlockedPaths?: string[];
  hasStagedChanges: boolean;
  hasUntrackedFiles: boolean;
  untrackedPaths: string[];
  remoteBranchesContainingHead: string[];
  fingerprint: string;
}
export interface RepositoryWorkflowPreflightDto {
  preflightId: string;
  expiresAt: string;
  command: RepositoryWorkflowCommandDto;
  state: RepositoryWorkflowStateDto;
  summary: string;
  warnings: string[];
  confirmationRequired: boolean;
}
export interface RepositoryWorkflowInspectRequest { target: RepositoryTargetDto }
export interface RepositoryWorkflowPreflightRequest { command: RepositoryWorkflowCommandDto }
export interface RepositoryWorkflowExecuteRequest {
  command: RepositoryWorkflowCommandDto;
  preflightId: string;
  confirmed: boolean;
}
export interface RepositoryWorkflowExecutionDto { operationId: string }
