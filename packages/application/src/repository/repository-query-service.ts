import type {
  Branch,
  CommitDiff,
  CommitDetails,
  CommitHistoryPage,
  CommitHistoryScope,
  GitClient,
  GitCommitDiffClient,
  GitStashClient,
  RepositoryDiff,
  RepositoryDiffMode,
  RepositorySnapshot,
  StashDiff,
  StashFiles,
  StashSummary
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

export interface RepositoryCommitDiffResult {
  target: RepositoryTarget;
  commit: {
    hash: string;
  };
  diff: CommitDiff;
}

export interface RepositoryBranchesResult {
  target: RepositoryTarget;
  branches: Branch[];
}

export interface RepositoryStashesResult {
  target: RepositoryTarget;
  stashes: StashSummary[];
}

export interface RepositoryStashFilesResult {
  target: RepositoryTarget;
  stash: StashFiles;
}

export interface RepositoryStashDiffResult {
  target: RepositoryTarget;
  stash: Pick<StashDiff, "ref" | "hash">;
  diff: Omit<StashDiff, "ref" | "hash">;
}

export class RepositoryQueryService {
  readonly #workspace: WorkspaceReader;
  readonly #gitClient: GitClient & GitStashClient;
  readonly #gitCommitDiffClient: GitCommitDiffClient;
  readonly #queries = new Map<string, AbortController>();

  constructor(
    workspace: WorkspaceReader,
    gitClient: GitClient & GitStashClient,
    gitCommitDiffClient: GitCommitDiffClient
  ) {
    this.#workspace = workspace;
    this.#gitClient = gitClient;
    this.#gitCommitDiffClient = gitCommitDiffClient;
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
            includeChangeStats: true,
            signal
          })
      };
    });
  }

  getDiff(
    queryId: string,
    target: RepositoryTarget,
    path: string,
    mode: RepositoryDiffMode,
    contextLines?: number
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
            ...(contextLines === undefined
              ? {}
              : { contextLines }),
            includeMedia: true,
            priority: "interactive",
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
    offset?: number,
    scope?: CommitHistoryScope
  ): Promise<RepositoryHistoryResult> {
    return this.#runQuery(queryId, async (signal) => {
      const path = await this.#resolveTargetPath(target);
      return {
        target,
        page: await this.#gitClient.readCommitHistory(path, {
          ...(limit === undefined ? {} : { limit }),
          ...(offset === undefined ? {} : { offset }),
          ...(scope === undefined ? {} : { scope }),
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

  getCommitDiff(
    queryId: string,
    target: RepositoryTarget,
    commitHash: string,
    path: string,
    contextLines?: number
  ): Promise<RepositoryCommitDiffResult> {
    return this.#runQuery(queryId, async (signal) => {
      const worktreePath = await this.#resolveTargetPath(target);
      return {
        target,
        commit: {
          hash: commitHash
        },
        diff: await this.#gitCommitDiffClient.readCommitDiff(
          worktreePath,
          {
            commitHash,
            path,
            ...(contextLines === undefined
              ? {}
              : { contextLines }),
            includeMedia: true,
            priority: "interactive",
            signal
          }
        )
      };
    });
  }

  getStashes(
    queryId: string,
    target: RepositoryTarget,
    limit?: number
  ): Promise<RepositoryStashesResult> {
    return this.#runQuery(queryId, async (signal) => {
      const path = await this.#resolveTargetPath(target);
      return {
        target,
        stashes: await this.#gitClient.readStashes(path, {
          ...(limit === undefined ? {} : { limit }),
          signal
        })
      };
    });
  }

  getStashFiles(
    queryId: string,
    target: RepositoryTarget,
    stashRef: string
  ): Promise<RepositoryStashFilesResult> {
    return this.#runQuery(queryId, async (signal) => {
      const path = await this.#resolveTargetPath(target);
      return {
        target,
        stash: await this.#gitClient.readStashFiles(
          path,
          stashRef,
          { signal }
        )
      };
    });
  }

  getStashDiff(
    queryId: string,
    target: RepositoryTarget,
    stashRef: string,
    path: string,
    contextLines?: number
  ): Promise<RepositoryStashDiffResult> {
    return this.#runQuery(queryId, async (signal) => {
      const worktreePath = await this.#resolveTargetPath(target);
      const stashDiff = await this.#gitClient.readStashDiff(
        worktreePath,
        {
          stashRef,
          path,
          ...(contextLines === undefined
            ? {}
            : { contextLines }),
          includeMedia: true,
          priority: "interactive",
          signal
        }
      );
      const { ref, hash, ...diff } = stashDiff;
      return {
        target,
        stash: { ref, hash },
        diff
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
