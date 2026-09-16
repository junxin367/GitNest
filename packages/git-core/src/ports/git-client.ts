import type { GitEnvironment } from "../domain/git-environment";
import type {
  Branch,
  RepositoryInspection,
  RepositorySnapshot
} from "../domain/repository";
import type {
  CommitHistoryScope,
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

export interface ReadRepositorySnapshotOptions
  extends GitReadOptions {
  includeChangeStats?: boolean;
}

export interface ReadRepositoryDiffOptions extends GitReadOptions {
  path: string;
  mode: RepositoryDiffMode;
  contextLines?: number;
  includeMedia?: boolean;
}

export interface ReadCommitHistoryOptions extends GitReadOptions {
  limit?: number;
  offset?: number;
  scope?: CommitHistoryScope;
}

export interface GitClient {
  getEnvironment(options?: GitReadOptions): Promise<GitEnvironment>;
  readRepositorySnapshot(
    path: string,
    options?: ReadRepositorySnapshotOptions
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
