import type {
  Branch,
  CommitSummary,
  RepositorySnapshot
} from "./repository";

export type RepositoryDiffMode =
  | "unstaged"
  | "staged"
  | "untracked";

export type RepositoryMediaKind =
  | "image"
  | "video"
  | "audio";

export type RepositoryMediaUnavailableReason =
  | "too-large"
  | "missing"
  | "not-file";

export type RepositoryMediaPreview =
  | {
      status: "available";
      kind: RepositoryMediaKind;
      mimeType: string;
      size: number;
      content: Uint8Array;
    }
  | {
      status: "unavailable";
      kind: RepositoryMediaKind;
      mimeType: string;
      reason: RepositoryMediaUnavailableReason;
      size?: number;
    };

export interface RepositoryDiff {
  path: string;
  mode: RepositoryDiffMode;
  content: string;
  binary: boolean;
  truncated: boolean;
  additions: number;
  deletions: number;
  media?: RepositoryMediaPreview;
}

export type CommitHistoryComparisonSide =
  | "left"
  | "right"
  | "base";

export interface CommitHistoryEntry extends CommitSummary {
  comparisonSide?: CommitHistoryComparisonSide;
}

export type CommitHistoryScope =
  | {
      kind: "ref";
      ref: string;
    }
  | {
      kind: "compare";
      leftRef: string;
      rightRef: string;
    };

export interface CommitHistoryComparison {
  leftRef: string;
  rightRef: string;
  leftOnly: number;
  rightOnly: number;
  mergeBase?: string;
}

export interface CommitHistoryPage {
  commits: CommitHistoryEntry[];
  nextOffset?: number;
  comparison?: CommitHistoryComparison;
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

export interface CommitDiff {
  path: string;
  content: string;
  binary: boolean;
  truncated: boolean;
  additions: number;
  deletions: number;
}

export interface StashFileStat {
  path: string;
  additions?: number;
  deletions?: number;
  binary: boolean;
}

export interface StashSummary {
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

export interface StashFiles {
  ref: string;
  hash: string;
  files: StashFileStat[];
  additions: number;
  deletions: number;
}

export interface StashDiff {
  ref: string;
  hash: string;
  path: string;
  content: string;
  binary: boolean;
  truncated: boolean;
  additions: number;
  deletions: number;
}

export interface RepositoryChanges {
  snapshot: RepositorySnapshot;
}

export interface RepositoryBranches {
  branches: Branch[];
}
