import type { Worktree } from "../domain/repository";
import type { GitReadOptions } from "./git-client";
import type { GitWriteOptions } from "./git-mutation-client";

export interface CreateWorktreeOptions
  extends GitWriteOptions {
  startPoint: string;
  branch?: string;
  createBranch: boolean;
  detached: boolean;
}

export interface LockWorktreeOptions
  extends GitWriteOptions {
  reason?: string;
}

export interface GitWorktreeCommandClient {
  readWorktrees(
    repositoryPath: string,
    options?: GitReadOptions
  ): Promise<Worktree[]>;
  previewPruneWorktrees(
    repositoryPath: string,
    options?: GitReadOptions
  ): Promise<Worktree[]>;
  createWorktree(
    repositoryPath: string,
    destination: string,
    options: CreateWorktreeOptions
  ): Promise<void>;
  lockWorktree(
    repositoryPath: string,
    worktreePath: string,
    options?: LockWorktreeOptions
  ): Promise<void>;
  unlockWorktree(
    repositoryPath: string,
    worktreePath: string,
    options?: GitWriteOptions
  ): Promise<void>;
  moveWorktree(
    repositoryPath: string,
    worktreePath: string,
    destination: string,
    options?: GitWriteOptions
  ): Promise<void>;
  repairWorktrees(
    repositoryPath: string,
    worktreePaths: readonly string[],
    options?: GitWriteOptions
  ): Promise<void>;
  pruneWorktrees(
    repositoryPath: string,
    options?: GitWriteOptions
  ): Promise<void>;
  removeWorktree(
    repositoryPath: string,
    worktreePath: string,
    options?: GitWriteOptions
  ): Promise<void>;
}
