import type {
  Branch,
  CommitSummary,
  RepositorySnapshot
} from "./repository";

export type RepositoryDiffMode =
  | "unstaged"
  | "staged"
  | "untracked";

export interface RepositoryDiff {
  path: string;
  mode: RepositoryDiffMode;
  content: string;
  binary: boolean;
  truncated: boolean;
  additions: number;
  deletions: number;
}

export interface CommitHistoryPage {
  commits: CommitSummary[];
  nextOffset?: number;
}

export interface CommitFileStat {
  path: string;
  additions?: number;
  deletions?: number;
  binary: boolean;
}

export interface CommitDetails extends CommitSummary {
  committerName: string;
  committerEmail: string;
  committedAt: string;
  body: string;
  refs: string[];
  files: CommitFileStat[];
  additions: number;
  deletions: number;
}

export interface RepositoryChanges {
  snapshot: RepositorySnapshot;
}

export interface RepositoryBranches {
  branches: Branch[];
}
