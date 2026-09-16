import { describe, expect, it } from "vitest";

import {
  type CommitDiff,
  GitError,
  type Branch,
  type CommitDetails,
  type CommitHistoryPage,
  type GitClient,
  type GitCommitDiffClient,
  type GitEnvironment,
  type GitReadOptions,
  type GitStashClient,
  type InspectRepositoryOptions,
  type ReadCommitHistoryOptions,
  type ReadCommitDiffOptions,
  type ReadRepositoryDiffOptions,
  type ReadRepositorySnapshotOptions,
  type ReadStashDiffOptions,
  type ReadStashesOptions,
  type RepositoryDiff,
  type RepositoryInspection,
  type RepositorySnapshot,
  type StashDiff,
  type StashFiles,
  type StashSummary
} from "@gitnest/git-core";
import type {
  RepositoryTarget,
  Workspace
} from "@gitnest/workspace-core";

import { RepositoryQueryService } from "./repository-query-service";

const TARGET: RepositoryTarget = {
  repositoryId: "repository",
  worktreeId: "worktree"
};
const WORKTREE_PATH = "C:\\workspace\\repository";

describe("RepositoryQueryService", () => {
  it("requests per-file stats for the repository changes query", async () => {
    const gitClient = new FakeGitClient();
    const service = createService(gitClient);

    await service.getChanges("changes_with_stats", TARGET);

    expect(gitClient.snapshotCalls).toEqual([
      {
        repositoryPath: WORKTREE_PATH,
        includeChangeStats: true,
        signal: expect.any(AbortSignal)
      }
    ]);
  });

  it("resolves registered targets inside Main and never accepts a renderer path", async () => {
    const gitClient = new FakeGitClient();
    const service = createService(gitClient);

    const result = await service.getDiff(
      "diff_1",
      TARGET,
      "src/app.ts",
      "unstaged",
      13
    );

    expect(result.target).toEqual(TARGET);
    expect(result.diff.path).toBe("src/app.ts");
    expect(gitClient.diffCalls).toEqual([
      {
        repositoryPath: WORKTREE_PATH,
        relativePath: "src/app.ts",
        mode: "unstaged",
        contextLines: 13,
        includeMedia: true,
        signal: expect.any(AbortSignal)
      }
    ]);
  });

  it("rejects targets that are not registered in the current Workspace", async () => {
    const gitClient = new FakeGitClient();
    const service = createService(gitClient);

    await expect(
      service.getChanges("changes_unknown", {
        repositoryId: "other",
        worktreeId: "other"
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    expect(gitClient.snapshotCalls).toHaveLength(0);
  });

  it("propagates cancellation through the query AbortSignal", async () => {
    const gitClient = new FakeGitClient(true);
    const service = createService(gitClient);
    const query = service.getChanges("changes_cancel", TARGET);
    const rejection = expect(query).rejects.toMatchObject({
      code: "COMMAND_CANCELLED"
    });

    await gitClient.snapshotStarted;
    service.cancel("changes_cancel");

    await rejection;
    expect(gitClient.snapshotCalls[0]?.signal.aborted).toBe(true);
  });

  it("requires active query identifiers to be unique", async () => {
    const gitClient = new FakeGitClient(true);
    const service = createService(gitClient);
    const first = service.getChanges("shared_query", TARGET);
    const firstRejection = expect(first).rejects.toMatchObject({
      code: "COMMAND_CANCELLED"
    });

    await gitClient.snapshotStarted;
    await expect(
      service.getChanges("shared_query", TARGET)
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });

    service.cancel("shared_query");
    await firstRejection;
  });

  it("rejects malformed query identifiers before touching Git", async () => {
    const gitClient = new FakeGitClient();
    const service = createService(gitClient);

    await expect(
      service.getBranches("bad query id", TARGET)
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    expect(gitClient.branchCalls).toBe(0);
  });

  it("forwards a read-only branch comparison scope to Git", async () => {
    const gitClient = new FakeGitClient();
    const service = createService(gitClient);

    await service.getHistory(
      "history_compare",
      TARGET,
      50,
      0,
      {
        kind: "compare",
        leftRef: "refs/heads/main",
        rightRef: "refs/heads/develop"
      }
    );

    expect(gitClient.historyCalls).toEqual([
      {
        repositoryPath: WORKTREE_PATH,
        limit: 50,
        offset: 0,
        scope: {
          kind: "compare",
          leftRef: "refs/heads/main",
          rightRef: "refs/heads/develop"
        },
        signal: expect.any(AbortSignal)
      }
    ]);
  });

  it("resolves stash list, files, and diff queries through the registered target", async () => {
    const gitClient = new FakeGitClient();
    const service = createService(gitClient);

    await service.getStashes("stashes_1", TARGET, 20);
    await service.getStashFiles(
      "stash_files_1",
      TARGET,
      "stash@{0}"
    );
    await service.getStashDiff(
      "stash_diff_1",
      TARGET,
      "stash@{0}",
      "src/app.ts",
      13
    );

    expect(gitClient.stashListCalls).toEqual([
      {
        repositoryPath: WORKTREE_PATH,
        limit: 20,
        signal: expect.any(AbortSignal)
      }
    ]);
    expect(gitClient.stashFileCalls).toEqual([
      {
        repositoryPath: WORKTREE_PATH,
        stashRef: "stash@{0}",
        signal: expect.any(AbortSignal)
      }
    ]);
    expect(gitClient.stashDiffCalls).toEqual([
      {
        repositoryPath: WORKTREE_PATH,
        stashRef: "stash@{0}",
        path: "src/app.ts",
        contextLines: 13,
        signal: expect.any(AbortSignal)
      }
    ]);
  });

  it("resolves commit file diffs through the dedicated read port", async () => {
    const gitClient = new FakeGitClient();
    const service = createService(gitClient);
    const result = await service.getCommitDiff(
      "commit_diff_1",
      TARGET,
      "abcdef",
      "src/app.ts",
      13
    );

    expect(result).toMatchObject({
      target: TARGET,
      commit: {
        hash: "abcdef"
      },
      diff: {
        path: "src/app.ts"
      }
    });
    expect(gitClient.commitDiffCalls).toEqual([
      {
        repositoryPath: WORKTREE_PATH,
        commitHash: "abcdef",
        path: "src/app.ts",
        contextLines: 13,
        signal: expect.any(AbortSignal)
      }
    ]);
  });
});

class FakeGitClient
  implements GitClient, GitCommitDiffClient, GitStashClient
{
  readonly snapshotCalls: Array<{
    repositoryPath: string;
    includeChangeStats: boolean | undefined;
    signal: AbortSignal;
  }> = [];
  readonly diffCalls: Array<{
    repositoryPath: string;
    relativePath: string;
    mode: ReadRepositoryDiffOptions["mode"];
    contextLines: number | undefined;
    includeMedia: boolean | undefined;
    signal: AbortSignal;
  }> = [];
  readonly historyCalls: Array<{
    repositoryPath: string;
    limit: number | undefined;
    offset: number | undefined;
    scope: ReadCommitHistoryOptions["scope"];
    signal: AbortSignal;
  }> = [];
  readonly commitDiffCalls: Array<{
    repositoryPath: string;
    commitHash: string;
    path: string;
    contextLines: number | undefined;
    signal: AbortSignal;
  }> = [];
  branchCalls = 0;
  readonly stashListCalls: Array<{
    repositoryPath: string;
    limit: number | undefined;
    signal: AbortSignal;
  }> = [];
  readonly stashFileCalls: Array<{
    repositoryPath: string;
    stashRef: string;
    signal: AbortSignal;
  }> = [];
  readonly stashDiffCalls: Array<{
    repositoryPath: string;
    stashRef: string;
    path: string;
    contextLines: number | undefined;
    signal: AbortSignal;
  }> = [];
  readonly snapshotStarted: Promise<void>;
  readonly #blockSnapshots: boolean;
  #markSnapshotStarted!: () => void;

  constructor(blockSnapshots = false) {
    this.#blockSnapshots = blockSnapshots;
    this.snapshotStarted = new Promise((resolve) => {
      this.#markSnapshotStarted = resolve;
    });
  }

  async getEnvironment(
    _options?: GitReadOptions
  ): Promise<GitEnvironment> {
    throw new Error("Not used.");
  }

  readRepositorySnapshot(
    repositoryPath: string,
    options?: ReadRepositorySnapshotOptions
  ): Promise<RepositorySnapshot> {
    const signal = options?.signal ?? new AbortController().signal;
    this.snapshotCalls.push({
      repositoryPath,
      includeChangeStats: options?.includeChangeStats,
      signal
    });
    this.#markSnapshotStarted();

    if (this.#blockSnapshots) {
      return new Promise<RepositorySnapshot>((_resolve, reject) => {
        const rejectCancelled = () => {
          reject(
            new GitError(
              "COMMAND_CANCELLED",
              "Repository query was cancelled."
            )
          );
        };

        if (signal.aborted) {
          rejectCancelled();
          return;
        }

        signal.addEventListener("abort", rejectCancelled, {
          once: true
        });
      });
    }

    return Promise.resolve(createSnapshot());
  }

  readRepositoryDiff(
    repositoryPath: string,
    options: ReadRepositoryDiffOptions
  ): Promise<RepositoryDiff> {
    const signal = options.signal ?? new AbortController().signal;
    this.diffCalls.push({
      repositoryPath,
      relativePath: options.path,
      mode: options.mode,
      contextLines: options.contextLines,
      includeMedia: options.includeMedia,
      signal
    });
    return Promise.resolve({
      path: options.path,
      mode: options.mode,
      content: "",
      binary: false,
      truncated: false,
      additions: 0,
      deletions: 0
    });
  }

  readCommitHistory(
    repositoryPath: string,
    options: ReadCommitHistoryOptions = {}
  ): Promise<CommitHistoryPage> {
    this.historyCalls.push({
      repositoryPath,
      limit: options.limit,
      offset: options.offset,
      scope: options.scope,
      signal:
        options.signal ?? new AbortController().signal
    });
    return Promise.resolve({
      commits: []
    });
  }

  async readCommitDetails(
    _path: string,
    _commitHash: string,
    _options?: GitReadOptions
  ): Promise<CommitDetails> {
    throw new Error("Not used.");
  }

  readCommitDiff(
    repositoryPath: string,
    options: ReadCommitDiffOptions
  ): Promise<CommitDiff> {
    this.commitDiffCalls.push({
      repositoryPath,
      commitHash: options.commitHash,
      path: options.path,
      contextLines: options.contextLines,
      signal:
        options.signal ?? new AbortController().signal
    });
    return Promise.resolve({
      path: options.path,
      content: "",
      binary: false,
      truncated: false,
      additions: 0,
      deletions: 0
    });
  }

  async readBranches(
    _path: string,
    _options?: GitReadOptions
  ): Promise<Branch[]> {
    this.branchCalls += 1;
    return [];
  }

  async readStashes(
    repositoryPath: string,
    options: ReadStashesOptions = {}
  ): Promise<StashSummary[]> {
    this.stashListCalls.push({
      repositoryPath,
      limit: options.limit,
      signal: options.signal ?? new AbortController().signal
    });
    return [];
  }

  async readStashFiles(
    repositoryPath: string,
    stashRef: string,
    options: GitReadOptions = {}
  ): Promise<StashFiles> {
    this.stashFileCalls.push({
      repositoryPath,
      stashRef,
      signal: options.signal ?? new AbortController().signal
    });
    return {
      ref: stashRef,
      hash: "0123456789abcdef0123456789abcdef01234567",
      files: [],
      additions: 0,
      deletions: 0
    };
  }

  async readStashDiff(
    repositoryPath: string,
    options: ReadStashDiffOptions
  ): Promise<StashDiff> {
    this.stashDiffCalls.push({
      repositoryPath,
      stashRef: options.stashRef,
      path: options.path,
      contextLines: options.contextLines,
      signal:
        options.signal ?? new AbortController().signal
    });
    return {
      ref: options.stashRef,
      hash: "0123456789abcdef0123456789abcdef01234567",
      path: options.path,
      content: "",
      binary: false,
      truncated: false,
      additions: 0,
      deletions: 0
    };
  }

  async inspectRepository(
    _path: string,
    _options?: InspectRepositoryOptions
  ): Promise<RepositoryInspection> {
    throw new Error("Not used.");
  }
}

function createService(
  gitClient: GitClient & GitCommitDiffClient & GitStashClient
): RepositoryQueryService {
  const workspace = createWorkspace();
  return new RepositoryQueryService(
    {
      getCurrent: async () => structuredClone(workspace)
    },
    gitClient,
    gitClient
  );
}

function createWorkspace(): Workspace {
  return {
    schemaVersion: 1,
    id: "workspace",
    name: "Workspace",
    entries: [
      {
        id: "entry",
        displayName: "Root",
        path: "C:\\workspace",
        canonicalPath: "c:\\workspace",
        excludes: [],
        order: 0,
        kind: "workspace-directory",
        groups: [
          {
            id: "group",
            name: "原/根仓库",
            targets: [TARGET],
            collapsed: false
          }
        ],
        scanIssues: [],
        lastScannedAt: "2026-09-04T12:00:00.000Z"
      }
    ],
    repositories: [
      {
        id: TARGET.repositoryId,
        name: "repository",
        commonDir: `${WORKTREE_PATH}\\.git`,
        canonicalCommonDir: "c:\\workspace\\repository\\.git",
        primaryWorktreeId: TARGET.worktreeId,
        worktreeIds: [TARGET.worktreeId]
      }
    ],
    worktrees: [
      {
        id: TARGET.worktreeId,
        repositoryId: TARGET.repositoryId,
        name: "repository",
        path: WORKTREE_PATH,
        canonicalPath: "c:\\workspace\\repository",
        gitDir: `${WORKTREE_PATH}\\.git`,
        head: "0123456789abcdef",
        branch: "main",
        isPrimary: true,
        isBare: false,
        isDetached: false,
        isLocked: false,
        isPrunable: false
      }
    ],
    selectedEntryId: "entry",
    selectedTarget: TARGET,
    updatedAt: "2026-09-04T12:00:00.000Z"
  };
}

function createSnapshot(): RepositorySnapshot {
  return {
    branch: "main",
    head: "0123456789abcdef",
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    changes: [],
    refreshedAt: "2026-09-04T12:00:00.000Z"
  };
}
