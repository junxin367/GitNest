import type { GitReadOptions } from "./git-client";
import type { GitWriteOptions } from "./git-mutation-client";

export type GitIgnoreScope = "file" | "directory" | "extension";
export interface GitIgnoreInput { path: string; scope: GitIgnoreScope }
export interface GitIgnorePlan extends GitIgnoreInput {
  ignoreFilePath: string;
  rule: string;
  summary: string;
  warnings: string[];
  fingerprint: string;
}
export interface GitIgnoreClient {
  inspect(worktreePath: string, input: GitIgnoreInput, options?: GitReadOptions): Promise<GitIgnorePlan>;
  execute(worktreePath: string, plan: GitIgnorePlan, options?: GitWriteOptions): Promise<void>;
}
