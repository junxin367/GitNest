export interface RepositoryIdentity {
  worktreePath: string;
  gitDir: string;
  commonDir: string;
  head: string;
}

export interface ChangedPath {
  path: string;
  originalPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  kind: "ordinary" | "renamed" | "unmerged" | "untracked";
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
  refreshedAt: string;
}

export interface Branch {
  fullName: string;
  name: string;
  head: string;
  upstream?: string;
  current: boolean;
  remote: boolean;
  worktreePath?: string;
}

export interface CommitSummary {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  subject: string;
  parentHashes: string[];
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
