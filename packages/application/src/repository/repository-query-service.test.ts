import { describe, expect, it } from "vitest";

import {
  GitError,
  type Branch,
  type CommitDetails,
  type CommitHistoryPage,
  type GitClient,
  type GitEnvironment,
  type GitReadOptions,
  type InspectRepositoryOptions,
  type ReadCommitHistoryOptions,
  type ReadRepositoryDiffOptions,
  type RepositoryDiff,
  type RepositoryInspection,
  type RepositorySnapshot
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
  it("resolves registered targets inside Main and never accepts a renderer path", async () => {
    const gitClient = new FakeGitClient();
    const service = createService(gitClient);

    const result = await service.getDiff(
      "diff_1",
      TARGET,
      "src/app.ts",
      "unstaged"
    );

    expect(result.target).toEqual(TARGET);
    expect(result.diff.path).toBe("src/app.ts");
    expect(gitClient.diffCalls).toEqual([
      {
        repositoryPath: WORKTREE_PATH,
        relativePath: "src/app.ts",
        mode: "unstaged",
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
});

class FakeGitClient implements GitClient {
  readonly snapshotCalls: Array<{
    repositoryPath: string;
    signal: AbortSignal;
  }> = [];
  readonly diffCalls: Array<{
    repositoryPath: string;
    relativePath: string;
    mode: ReadRepositoryDiffOptions["mode"];
    signal: AbortSignal;
  }> = [];
  branchCalls = 0;
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
    options?: GitReadOptions
  ): Promise<RepositorySnapshot> {
    const signal = options?.signal ?? new AbortController().signal;
    this.snapshotCalls.push({ repositoryPath, signal });
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

  async readCommitHistory(
    _path: string,
    _options?: ReadCommitHistoryOptions
  ): Promise<CommitHistoryPage> {
    throw new Error("Not used.");
  }

  async readCommitDetails(
    _path: string,
    _commitHash: string,
    _options?: GitReadOptions
  ): Promise<CommitDetails> {
    throw new Error("Not used.");
  }

  async readBranches(
    _path: string,
    _options?: GitReadOptions
  ): Promise<Branch[]> {
    this.branchCalls += 1;
    return [];
  }

  async inspectRepository(
    _path: string,
    _options?: InspectRepositoryOptions
  ): Promise<RepositoryInspection> {
    throw new Error("Not used.");
  }
}

function createService(
  gitClient: GitClient
): RepositoryQueryService {
  const workspace = createWorkspace();
  return new RepositoryQueryService(
    {
      getCurrent: async () => structuredClone(workspace)
    },
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
            name: "根目录仓库",
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
