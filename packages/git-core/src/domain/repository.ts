export interface RepositoryIdentity {
  worktreePath: string;
  gitDir: string;
  commonDir: string;
  head: string;
}

export interface ChangedPathStats {
  additions: number;
  deletions: number;
}

export interface ChangedPath {
  path: string;
  originalPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  kind: "ordinary" | "renamed" | "unmerged" | "untracked";
  stagedStats?: ChangedPathStats;
  unstagedStats?: ChangedPathStats;
  untrackedStats?: ChangedPathStats;
}

export interface RepositorySnapshot {
  branch?: string;
  head: string;
  upstream?: string;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  changes: ChangedPath[];
  /** Lightweight identity of index contents and changed worktree file metadata. */
  contentFingerprint?: string;
  refreshedAt: string;
}

export type RepositorySnapshotProgress =
  | {
      kind: "snapshot";
      snapshot: RepositorySnapshot;
      completed: number;
      total: number;
    }
  | {
      kind: "stats";
      changes: ChangedPath[];
      completed: number;
      total: number;
    };

export interface Branch {
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

export interface CommitSummary {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  subject: string;
  parentHashes: string[];
  refs?: string[];
}

export interface Worktree {
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

export interface RepositoryInspection {
  identity: RepositoryIdentity;
  snapshot: RepositorySnapshot;
  branches: Branch[];
  commits: CommitSummary[];
  worktrees: Worktree[];
}

export interface RepositoryTopology {
  identity: RepositoryIdentity;
  branch?: string;
  worktrees: Worktree[];
}
