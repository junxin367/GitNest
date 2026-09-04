import type { GitEnvironment } from "../domain/git-environment";
import type {
  Branch,
  RepositoryInspection,
  RepositorySnapshot
} from "../domain/repository";
import type {
  CommitDetails,
  CommitHistoryPage,
  RepositoryDiff,
  RepositoryDiffMode
} from "../domain/repository-queries";

export interface GitReadOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface InspectRepositoryOptions extends GitReadOptions {
  historyLimit?: number;
}

export interface ReadRepositoryDiffOptions extends GitReadOptions {
  path: string;
  mode: RepositoryDiffMode;
  contextLines?: number;
}

export interface ReadCommitHistoryOptions extends GitReadOptions {
  limit?: number;
  offset?: number;
}

export interface GitClient {
  getEnvironment(options?: GitReadOptions): Promise<GitEnvironment>;
  readRepositorySnapshot(
    path: string,
    options?: GitReadOptions
  ): Promise<RepositorySnapshot>;
  readRepositoryDiff(
    path: string,
    options: ReadRepositoryDiffOptions
  ): Promise<RepositoryDiff>;
  readCommitHistory(
    path: string,
    options?: ReadCommitHistoryOptions
  ): Promise<CommitHistoryPage>;
  readCommitDetails(
    path: string,
    commitHash: string,
    options?: GitReadOptions
  ): Promise<CommitDetails>;
  readBranches(
    path: string,
    options?: GitReadOptions
  ): Promise<Branch[]>;
  inspectRepository(
    path: string,
    options?: InspectRepositoryOptions
  ): Promise<RepositoryInspection>;
}
