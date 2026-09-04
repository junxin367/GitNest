import type {
  Branch,
  CommitDetails,
  CommitHistoryPage,
  GitClient,
  RepositoryDiff,
  RepositoryDiffMode,
  RepositorySnapshot
} from "@gitnest/git-core";
import {
  WorkspaceError,
  listWorkspaceTargets,
  repositoryTargetKey,
  type RepositoryTarget,
  type Workspace
} from "@gitnest/workspace-core";

interface WorkspaceReader {
  getCurrent(): Promise<Workspace>;
}

export interface RepositoryChangesResult {
  target: RepositoryTarget;
  snapshot: RepositorySnapshot;
}

export interface RepositoryDiffResult {
  target: RepositoryTarget;
  diff: RepositoryDiff;
}

export interface RepositoryHistoryResult {
  target: RepositoryTarget;
  page: CommitHistoryPage;
}

export interface RepositoryCommitResult {
  target: RepositoryTarget;
  commit: CommitDetails;
}

export interface RepositoryBranchesResult {
  target: RepositoryTarget;
  branches: Branch[];
}

export class RepositoryQueryService {
  readonly #workspace: WorkspaceReader;
  readonly #gitClient: GitClient;
  readonly #queries = new Map<string, AbortController>();

  constructor(workspace: WorkspaceReader, gitClient: GitClient) {
    this.#workspace = workspace;
    this.#gitClient = gitClient;
  }

  getChanges(
    queryId: string,
    target: RepositoryTarget
  ): Promise<RepositoryChangesResult> {
    return this.#runQuery(queryId, async (signal) => {
      const path = await this.#resolveTargetPath(target);
      return {
        target,
        snapshot:
          await this.#gitClient.readRepositorySnapshot(path, {
            signal
          })
      };
    });
  }

  getDiff(
    queryId: string,
    target: RepositoryTarget,
    path: string,
    mode: RepositoryDiffMode
  ): Promise<RepositoryDiffResult> {
    return this.#runQuery(queryId, async (signal) => {
      const worktreePath = await this.#resolveTargetPath(target);
      return {
        target,
        diff: await this.#gitClient.readRepositoryDiff(
          worktreePath,
          {
            path,
            mode,
            signal
          }
        )
      };
    });
  }

  getHistory(
    queryId: string,
    target: RepositoryTarget,
    limit?: number,
    offset?: number
  ): Promise<RepositoryHistoryResult> {
    return this.#runQuery(queryId, async (signal) => {
      const path = await this.#resolveTargetPath(target);
      return {
        target,
        page: await this.#gitClient.readCommitHistory(path, {
          ...(limit === undefined ? {} : { limit }),
          ...(offset === undefined ? {} : { offset }),
          signal
        })
      };
    });
  }

  getCommit(
    queryId: string,
    target: RepositoryTarget,
    commitHash: string
  ): Promise<RepositoryCommitResult> {
    return this.#runQuery(queryId, async (signal) => {
      const path = await this.#resolveTargetPath(target);
      return {
        target,
        commit: await this.#gitClient.readCommitDetails(
          path,
          commitHash,
          { signal }
        )
      };
    });
  }

  getBranches(
    queryId: string,
    target: RepositoryTarget
  ): Promise<RepositoryBranchesResult> {
    return this.#runQuery(queryId, async (signal) => {
      const path = await this.#resolveTargetPath(target);
      return {
        target,
        branches: await this.#gitClient.readBranches(path, {
          signal
        })
      };
    });
  }

  cancel(queryId: string): void {
    this.#queries.get(validateQueryId(queryId))?.abort();
  }

  async #resolveTargetPath(
    target: RepositoryTarget
  ): Promise<string> {
    const workspace = await this.#workspace.getCurrent();
    const key = repositoryTargetKey(target);

    if (
      !listWorkspaceTargets(workspace).some(
        (candidate) => repositoryTargetKey(candidate) === key
      )
    ) {
      throw new WorkspaceError(
        "INVALID_REQUEST",
        "Repository queries require a target registered in the current Workspace."
      );
    }

    const worktree = workspace.worktrees.find(
      (candidate) => candidate.id === target.worktreeId
    );

    if (!worktree) {
      throw new WorkspaceError(
        "DIRECTORY_UNAVAILABLE",
        "The selected Worktree path is unavailable."
      );
    }

    return worktree.path;
  }

  async #runQuery<Result>(
    queryId: string,
    query: (signal: AbortSignal) => Promise<Result>
  ): Promise<Result> {
    const id = validateQueryId(queryId);

    if (this.#queries.has(id)) {
      throw new WorkspaceError(
        "INVALID_REQUEST",
        "Repository query identifiers must be unique while active."
      );
    }

    const controller = new AbortController();
    this.#queries.set(id, controller);

    try {
      return await query(controller.signal);
    } finally {
      this.#queries.delete(id);
    }
  }
}

function validateQueryId(queryId: string): string {
  if (
    !queryId ||
    queryId.length > 96 ||
    !/^[a-zA-Z0-9_-]+$/.test(queryId)
  ) {
    throw new WorkspaceError(
      "INVALID_REQUEST",
      "Repository query identifiers contain invalid characters."
    );
  }

  return queryId;
}
