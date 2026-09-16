import type { CreatedCommit } from "../domain/repository-mutations";

export interface GitWriteOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface CreateCommitOptions extends GitWriteOptions {
  subject: string;
  body?: string;
}

export type StashMutationAction =
  | "apply"
  | "drop"
  | "pop";

export interface GitMutationClient {
  stageAll(
    path: string,
    options?: GitWriteOptions
  ): Promise<void>;
  stagePaths(
    path: string,
    paths: readonly string[],
    options?: GitWriteOptions
  ): Promise<void>;
  unstagePaths(
    path: string,
    paths: readonly string[],
    options?: GitWriteOptions
  ): Promise<void>;
  restoreWorktreePaths(
    path: string,
    paths: readonly string[],
    options?: GitWriteOptions
  ): Promise<void>;
  removeUntrackedPaths(
    path: string,
    paths: readonly string[],
    options?: GitWriteOptions
  ): Promise<void>;
  mutateStash(
    path: string,
    action: StashMutationAction,
    stashRef: string,
    stashHash: string,
    options?: GitWriteOptions
  ): Promise<void>;
  createCommit(
    path: string,
    options: CreateCommitOptions
  ): Promise<CreatedCommit>;
}
