import type {
  Branch,
  CommitDetails,
  CommitHistoryPage,
  GitClient,
  GitEnvironment,
  GitReadOptions,
  InspectRepositoryOptions,
  ReadCommitHistoryOptions,
  ReadRepositoryDiffOptions,
  RepositoryDiff,
  RepositoryInspection,
  RepositorySnapshot
} from "@gitnest/git-core";

export class GitInspectionService {
  readonly #gitClient: GitClient;

  constructor(gitClient: GitClient) {
    this.#gitClient = gitClient;
  }

  getEnvironment(options?: GitReadOptions): Promise<GitEnvironment> {
    return this.#gitClient.getEnvironment(options);
  }

  inspectRepository(
    path: string,
    options?: InspectRepositoryOptions
  ): Promise<RepositoryInspection> {
    return this.#gitClient.inspectRepository(path, options);
  }

  readRepositorySnapshot(
    path: string,
    options?: GitReadOptions
  ): Promise<RepositorySnapshot> {
    return this.#gitClient.readRepositorySnapshot(path, options);
  }

  readRepositoryDiff(
    path: string,
    options: ReadRepositoryDiffOptions
  ): Promise<RepositoryDiff> {
    return this.#gitClient.readRepositoryDiff(path, options);
  }

  readCommitHistory(
    path: string,
    options?: ReadCommitHistoryOptions
  ): Promise<CommitHistoryPage> {
    return this.#gitClient.readCommitHistory(path, options);
  }

  readCommitDetails(
    path: string,
    commitHash: string,
    options?: GitReadOptions
  ): Promise<CommitDetails> {
    return this.#gitClient.readCommitDetails(
      path,
      commitHash,
      options
    );
  }

  readBranches(
    path: string,
    options?: GitReadOptions
  ): Promise<Branch[]> {
    return this.#gitClient.readBranches(path, options);
  }
}
