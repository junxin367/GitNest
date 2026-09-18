import type { RepositoryTarget } from "./workspace";

export interface RepositoryStatusError {
  code: string;
  message: string;
}

export interface RepositoryStatusSnapshot
  extends RepositoryTarget {
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
  error?: RepositoryStatusError;
}
