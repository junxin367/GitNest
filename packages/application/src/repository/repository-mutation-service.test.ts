import { describe, expect, it } from "vitest";

import type {
  Branch,
  CommitDetails,
  CommitHistoryPage,
  CreateCommitOptions,
  GitClient,
  GitEnvironment,
  GitMutationClient,
  GitReadOptions,
  GitWriteOptions,
  InspectRepositoryOptions,
  ReadCommitHistoryOptions,
  ReadRepositoryDiffOptions,
  RepositoryDiff,
  RepositoryInspection,
  RepositorySnapshot
} from "@gitnest/git-core";
import type {
  RepositoryTarget
} from "@gitnest/workspace-core";

import {
  RepositoryMutationService,
  type RepositoryMutationRuntime
} from "./repository-mutation-service";

const TARGET: RepositoryTarget = {
  repositoryId: "repository",
  worktreeId: "worktree"
};
const WORKTREE_PATH = "C:\\workspace\\repository";

describe("RepositoryMutationService", () => {
  it("revalidates exact changed paths immediately before staging", async () => {
    const git = new FakeGitMutationClient({
      changes: [
        {
          path: "renamed.txt",
          originalPath: "old.txt",
          indexStatus: ".",
          worktreeStatus: "R",
          kind: "renamed"
        }
      ]
    });
    const runtime = new ImmediateMutationRuntime();
    const service = new RepositoryMutationService(
      runtime,
      git,
      git
    );

    await expect(
      service.stage(TARGET, ["renamed.txt", "old.txt"])
    ).resolves.toEqual({
      target: TARGET,
      operationId: "operation-stage"
    });
    expect(git.stageCalls).toEqual([
      {
        path: WORKTREE_PATH,
        paths: ["renamed.txt", "old.txt"]
      }
    ]);
  });

  it("rejects broad or no-longer-current paths without touching the index", async () => {
    const git = new FakeGitMutationClient({
      changes: [
        {
          path: "current.txt",
          indexStatus: ".",
          worktreeStatus: "M",
          kind: "ordinary"
        }
      ]
    });
    const runtime = new ImmediateMutationRuntime();
    const service = new RepositoryMutationService(
      runtime,
      git,
      git
    );

    await expect(
      service.stage(TARGET, ["."])
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    await expect(
      service.stage(TARGET, ["other.txt"])
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    expect(git.stageCalls).toHaveLength(0);
  });

  it("only permits currently staged paths to be unstaged", async () => {
    const git = new FakeGitMutationClient({
      staged: 1,
      changes: [
        {
          path: "staged.txt",
          indexStatus: "M",
          worktreeStatus: ".",
          kind: "ordinary"
        },
        {
          path: "unstaged.txt",
          indexStatus: ".",
          worktreeStatus: "M",
          kind: "ordinary"
        }
      ]
    });
    const service = new RepositoryMutationService(
      new ImmediateMutationRuntime(),
      git,
      git
    );

    await expect(
      service.unstage(TARGET, ["unstaged.txt"])
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    await service.unstage(TARGET, ["staged.txt"]);

    expect(git.unstageCalls).toEqual([
      {
        path: WORKTREE_PATH,
        paths: ["staged.txt"]
      }
    ]);
  });

  it("creates a commit only from a conflict-free staged index", async () => {
    const git = new FakeGitMutationClient({
      staged: 1,
      changes: [
        {
          path: "staged.txt",
          indexStatus: "M",
          worktreeStatus: ".",
          kind: "ordinary"
        }
      ]
    });
    const service = new RepositoryMutationService(
      new ImmediateMutationRuntime(),
      git,
      git
    );

    await expect(
      service.commit(
        TARGET,
        "  Safe subject  ",
        "  Body line  "
      )
    ).resolves.toEqual({
      target: TARGET,
      operationId: "operation-commit",
      commit: {
        hash: "a".repeat(40),
        shortHash: "aaaaaaaa",
        subject: "Safe subject"
      }
    });
    expect(git.commitCalls).toEqual([
      {
        path: WORKTREE_PATH,
        subject: "Safe subject",
        body: "Body line"
      }
    ]);
  });

  it("rejects empty commits, unresolved conflicts, and multiline subjects", async () => {
    const git = new FakeGitMutationClient({
      staged: 0,
      conflicted: 1,
      changes: [
        {
          path: "conflict.txt",
          indexStatus: "U",
          worktreeStatus: "U",
          kind: "unmerged"
        }
      ]
    });
    const service = new RepositoryMutationService(
      new ImmediateMutationRuntime(),
      git,
      git
    );

    await expect(
      service.commit(TARGET, "subject")
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    await expect(
      service.commit(TARGET, "line one\nline two")
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    expect(git.commitCalls).toHaveLength(0);
  });
});

class ImmediateMutationRuntime
  implements RepositoryMutationRuntime
{
  async runWorktreeMutation<Result>(
    _target: RepositoryTarget,
    kind: "stage" | "unstage" | "commit",
    action: (worktreePath: string) => Promise<Result>
  ) {
    return {
      operationId: `operation-${kind}`,
      result: await action(WORKTREE_PATH)
    };
  }
}

class FakeGitMutationClient
  implements GitClient, GitMutationClient
{
  snapshot: RepositorySnapshot;
  readonly stageCalls: Array<{
    path: string;
    paths: string[];
  }> = [];
  readonly unstageCalls: Array<{
    path: string;
    paths: string[];
  }> = [];
  readonly commitCalls: Array<{
    path: string;
    subject: string;
    body?: string;
  }> = [];

  constructor(
    snapshot: Partial<RepositorySnapshot> = {}
  ) {
    this.snapshot = {
      branch: "main",
      head: "a".repeat(40),
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
      changes: [],
      refreshedAt: "2026-09-04T12:00:00.000Z",
      ...snapshot
    };
  }

  async readRepositorySnapshot(): Promise<RepositorySnapshot> {
    return structuredClone(this.snapshot);
  }

  async stagePaths(
    path: string,
    paths: readonly string[]
  ): Promise<void> {
    this.stageCalls.push({ path, paths: [...paths] });
  }

  async unstagePaths(
    path: string,
    paths: readonly string[]
  ): Promise<void> {
    this.unstageCalls.push({ path, paths: [...paths] });
  }

  async createCommit(
    path: string,
    options: CreateCommitOptions
  ) {
    this.commitCalls.push({
      path,
      subject: options.subject,
      ...(options.body ? { body: options.body } : {})
    });
    return {
      hash: "a".repeat(40),
      shortHash: "aaaaaaaa",
      subject: options.subject
    };
  }

  async getEnvironment(
    _options?: GitReadOptions
  ): Promise<GitEnvironment> {
    throw new Error("Not used.");
  }

  async readRepositoryDiff(
    _path: string,
    _options: ReadRepositoryDiffOptions
  ): Promise<RepositoryDiff> {
    throw new Error("Not used.");
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
    throw new Error("Not used.");
  }

  async inspectRepository(
    _path: string,
    _options?: InspectRepositoryOptions
  ): Promise<RepositoryInspection> {
    throw new Error("Not used.");
  }
}
