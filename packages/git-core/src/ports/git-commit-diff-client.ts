import type { CommitDiff } from "../domain/repository-queries";
import type { GitReadOptions } from "./git-client";

export interface ReadCommitDiffOptions extends GitReadOptions {
  commitHash: string;
  path: string;
  contextLines?: number;
  includeMedia?: boolean;
}

export interface GitCommitDiffClient {
  readCommitDiff(
    path: string,
    options: ReadCommitDiffOptions
  ): Promise<CommitDiff>;
}
