import type {
  GitAncestry,
  RemoteBranchRef
} from "../domain/repository-commands";
import type {
  GitReadOptions
} from "./git-client";
import type {
  GitWriteOptions
} from "./git-mutation-client";

export interface FetchRemoteOptions extends GitWriteOptions {
  prune?: boolean;
}

export type GitPullStrategy = "rebase" | "merge";

export interface PushBranchOptions extends GitWriteOptions {
  remote: string;
  localBranch: string;
  remoteBranch: string;
  setUpstream?: boolean;
  forceWithLeaseExpected?: string;
}

export interface GitRepositoryCommandClient {
  readRemotes(
    path: string,
    options?: GitReadOptions
  ): Promise<string[]>;
  readRemoteBranches(
    path: string,
    remote: string,
    options?: GitReadOptions
  ): Promise<RemoteBranchRef[]>;
  checkBranchName(
    path: string,
    branch: string,
    options?: GitReadOptions
  ): Promise<boolean>;
  resolveRevision(
    path: string,
    revision: string,
    options?: GitReadOptions
  ): Promise<string>;
  compareAncestry(
    path: string,
    ancestor: string,
    descendant: string,
    options?: GitReadOptions
  ): Promise<GitAncestry>;
  fetchRemote(
    path: string,
    remote: string,
    options?: FetchRemoteOptions
  ): Promise<void>;
  pullFastForward(
    path: string,
    remote: string,
    remoteBranch: string,
    options?: GitWriteOptions
  ): Promise<void>;
  pullBranch(
    path: string,
    remote: string,
    remoteBranch: string,
    strategy: GitPullStrategy,
    options?: GitWriteOptions
  ): Promise<void>;
  pushBranch(
    path: string,
    options: PushBranchOptions
  ): Promise<void>;
  createBranch(
    path: string,
    branch: string,
    startPoint: string,
    options?: GitWriteOptions
  ): Promise<void>;
  switchBranch(
    path: string,
    branch: string,
    options?: GitWriteOptions
  ): Promise<void>;
  renameBranch(
    path: string,
    branch: string,
    newName: string,
    options?: GitWriteOptions
  ): Promise<void>;
  deleteBranch(
    path: string,
    branch: string,
    options?: GitWriteOptions
  ): Promise<void>;
}
