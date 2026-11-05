import type { GitReadOptions } from "./git-client";
import type { GitWriteOptions } from "./git-mutation-client";

export type GitWorkflowOperation = "merge" | "rebase" | "cherry-pick" | "revert";

export type GitWorkflowAction = (
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

export interface GitWorkflowState {
  head: string | null;
  branch: string | null;
  headMessage: string;
  parentCount: number;
  operation: GitWorkflowOperation | null;
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
  /** Removed index paths cannot be safely passed to Git's partial stash cleanup. */
  partialStashBlockedPaths?: string[];
  hasStagedChanges: boolean;
  hasUntrackedFiles: boolean;
  untrackedPaths: string[];
  remoteBranchesContainingHead: string[];
  fingerprint: string;
}

export interface GitWorkflowInspectOptions extends GitReadOptions {
  /** UI inspection may omit expensive content hashing. Preflight always hashes. */
  includeFingerprint?: boolean;
}

export interface GitWorkflowClient {
  inspect(path: string, options?: GitWorkflowInspectOptions): Promise<GitWorkflowState>;
  validateCommit(path: string, hash: string, options?: GitReadOptions & { allowMerge?: boolean; mainline?: number }): Promise<void>;
  execute(path: string, action: GitWorkflowAction, options?: GitWriteOptions): Promise<void>;
}
