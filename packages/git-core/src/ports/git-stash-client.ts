import type {
  StashDiff,
  StashFiles,
  StashSummary
} from "../domain/repository-queries";
import type { GitReadOptions } from "./git-client";

export interface ReadStashesOptions extends GitReadOptions {
  limit?: number;
}

export interface ReadStashDiffOptions extends GitReadOptions {
  stashRef: string;
  path: string;
  contextLines?: number;
  includeMedia?: boolean;
}

export interface GitStashClient {
  readStashes(
    path: string,
    options?: ReadStashesOptions
  ): Promise<StashSummary[]>;
  readStashFiles(
    path: string,
    stashRef: string,
    options?: GitReadOptions
  ): Promise<StashFiles>;
  readStashDiff(
    path: string,
    options: ReadStashDiffOptions
  ): Promise<StashDiff>;
}
