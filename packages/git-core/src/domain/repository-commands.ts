export interface RemoteBranchRef {
  name: string;
  fullName: string;
  head: string;
}

export type GitAncestry =
  | "ancestor"
  | "descendant"
  | "diverged"
  | "unknown";
