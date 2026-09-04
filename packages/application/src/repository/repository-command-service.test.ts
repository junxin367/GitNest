import { describe, expect, it } from "vitest";

import {
  type Branch,
  type CommitDetails,
  type CommitHistoryPage,
  type FetchRemoteOptions,
  type GitAncestry,
  type GitClient,
  type GitEnvironment,
  type GitReadOptions,
  type GitRepositoryCommandClient,
  type GitWriteOptions,
  type InspectRepositoryOptions,
  type PushBranchOptions,
  type ReadCommitHistoryOptions,
  type ReadRepositoryDiffOptions,
  type RemoteBranchRef,
  type RepositoryDiff,
  type RepositoryInspection,
  type RepositorySnapshot
} from "@gitnest/git-core";
import type {
  RepositoryTarget,
  Workspace
} from "@gitnest/workspace-core";

import {
  RepositoryCommandService,
  type RepositoryCommand,
  type RepositoryCommandRuntime
} from "./repository-command-service";
import type {
  RepositoryOperationKind
} from "../workspace/workspace-runtime-service";

const TARGET: RepositoryTarget = {
  repositoryId: "repository-1",
  worktreeId: "worktree-1"
};
const SECOND_TARGET: RepositoryTarget = {
  repositoryId: "repository-2",
  worktreeId: "worktree-2"
};
const WORKTREE_PATH = "C:\\workspace\\repository-1";
const LOCAL_HEAD = "a".repeat(40);
const REMOTE_HEAD = "b".repeat(40);

describe("RepositoryCommandService", () => {
  it("normalizes the command and binds execution to its exact preflight parameters", async () => {
    const client = new FakeRepositoryClient();
    const runtime = new FakeRuntime();
    const service = createService(runtime, client);
    const preflight = await service.preflight({
      type: "fetch",
      targets: [TARGET],
      remote: " origin "
    });

    expect(preflight).toMatchObject({
      preflightId: "preflight_1",
      command: {
        type: "fetch",
        targets: [TARGET],
        remote: "origin",
        prune: false
      },
      targetSummary: "1 个仓库目标",
      confirmationRequired: false
    });
    expect(preflight.impacts[0]).toMatchObject({
      kind: "remote-refs",
      target: TARGET,
      summary: "Fetch origin"
    });

    await expect(
      service.execute(
        {
          type: "fetch",
          targets: [TARGET],
          remote: "origin",
          prune: true
        },
        preflight.preflightId,
        false
      )
    ).rejects.toMatchObject({
      code: "PREFLIGHT_CHANGED"
    });
    expect(runtime.queued).toHaveLength(0);
  });

  it("lists every stale tracking ref before Fetch with prune", async () => {
    const client = new FakeRepositoryClient();
    const service = createService(
      new FakeRuntime(),
      client
    );

    const preflight = await service.preflight({
      type: "fetch",
      targets: [TARGET],
      remote: "origin",
      prune: true
    });

    expect(preflight.impacts).toEqual([
      expect.objectContaining({
        summary: "Fetch origin",
        detail: expect.stringContaining(
          "1 个失效跟踪引用将被清理"
        )
      }),
      expect.objectContaining({
        summary: "Prune origin/feature",
        detail: expect.stringContaining(
          "refs/remotes/origin/feature"
        )
      })
    ]);
  });

  it("requires explicit confirmation for commands that can write refs or the worktree", async () => {
    const client = new FakeRepositoryClient();
    const runtime = new FakeRuntime();
    const service = createService(runtime, client);
    const preflight = await service.preflight({
      type: "push",
      targets: [TARGET]
    });

    expect(preflight.confirmationRequired).toBe(true);
    await expect(
      service.execute(
        preflight.command,
        preflight.preflightId,
        false
      )
    ).rejects.toMatchObject({
      code: "CONFIRMATION_REQUIRED"
    });
    expect(runtime.queued).toHaveLength(0);
  });

  it("rejects expired and unknown preflight ids", async () => {
    let nowMs = Date.parse("2026-09-04T12:00:00.000Z");
    const client = new FakeRepositoryClient();
    const runtime = new FakeRuntime();
    const service = createService(runtime, client, {
      clock: () => new Date(nowMs).toISOString(),
      preflightTtlMs: 1_000
    });
    const preflight = await service.preflight({
      type: "fetch",
      targets: [TARGET]
    });

    nowMs += 1_001;
    await expect(
      service.execute(
        preflight.command,
        preflight.preflightId,
        false
      )
    ).rejects.toMatchObject({
      code: "PREFLIGHT_EXPIRED"
    });
    await expect(
      service.execute(
        preflight.command,
        "preflight_missing",
        false
      )
    ).rejects.toMatchObject({
      code: "PREFLIGHT_EXPIRED"
    });
  });

  it("ignores refresh timestamps but rejects changed remote advertisements", async () => {
    const client = new FakeRepositoryClient();
    const runtime = new FakeRuntime();
    const service = createService(runtime, client);
    const stable = await service.preflight({
      type: "fetch",
      targets: [TARGET]
    });

    client.snapshot.refreshedAt =
      "2026-09-04T12:00:30.000Z";
    await expect(
      service.execute(
        stable.command,
        stable.preflightId,
        false
      )
    ).resolves.toEqual({
      operationIds: ["operation-1"]
    });

    const changed = await service.preflight({
      type: "fetch",
      targets: [TARGET]
    });
    client.remoteBranches.set("origin", [
      createRemoteBranch("main", REMOTE_HEAD)
    ]);
    await expect(
      service.execute(
        changed.command,
        changed.preflightId,
        false
      )
    ).rejects.toMatchObject({
      code: "PREFLIGHT_CHANGED"
    });
    expect(runtime.queued).toHaveLength(1);
  });

  it("limits force-with-lease to one repository target before reading Git", async () => {
    const client = new FakeRepositoryClient();
    const runtime = new FakeRuntime(createWorkspace(2));
    const service = createService(runtime, client);

    await expect(
      service.preflight({
        type: "push",
        targets: [TARGET, SECOND_TARGET],
        forceWithLease: true
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    expect(client.snapshotReads).toBe(0);
  });

  it.each<{
    label: string;
    command: RepositoryCommand;
  }>([
    {
      label: "Pull",
      command: {
        type: "pull",
        targets: [TARGET],
        strategy: "ff-only"
      }
    },
    {
      label: "Switch branch",
      command: {
        type: "switch-branch",
        target: TARGET,
        branch: "feature"
      }
    }
  ])(
    "rejects $label when the worktree is dirty",
    async ({ command }) => {
      const client = new FakeRepositoryClient();
      client.snapshot.unstaged = 1;
      const service = createService(
        new FakeRuntime(),
        client
      );

      await expect(
        service.preflight(command)
      ).rejects.toMatchObject({
        code: "INVALID_REQUEST",
        message: expect.stringContaining("clean Worktree")
      });
    }
  );

  it("allows an ff-only Pull preflight when local HEAD is only ahead", async () => {
    const client = new FakeRepositoryClient();
    client.snapshot.head = REMOTE_HEAD;
    const current = client.branches.find(
      (branch) => branch.current
    );
    if (current) {
      current.head = REMOTE_HEAD;
    }
    client.ancestry = "descendant";
    const service = createService(
      new FakeRuntime(),
      client
    );

    const preflight = await service.preflight({
      type: "pull",
      targets: [TARGET],
      strategy: "ff-only"
    });
    expect(preflight).toMatchObject({
      command: {
        type: "pull",
        strategy: "ff-only"
      },
      confirmationRequired: true
    });
    expect(preflight.impacts[0]?.detail).toContain(
      "已包含远程提交"
    );
  });

  it("rejects branches occupied by another worktree and unmerged deletion", async () => {
    const client = new FakeRepositoryClient();
    const service = createService(
      new FakeRuntime(),
      client
    );
    const feature = client.branches.find(
      (branch) => branch.name === "feature"
    ) as Branch;
    feature.worktreePath = "C:\\workspace\\other-worktree";

    await expect(
      service.preflight({
        type: "switch-branch",
        target: TARGET,
        branch: "feature"
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining("another Worktree")
    });

    delete feature.worktreePath;
    client.ancestry = "diverged";
    await expect(
      service.preflight({
        type: "delete-branch",
        target: TARGET,
        branch: "feature"
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining("not merged")
    });
  });

  it("validates renamed branch names through Git before planning", async () => {
    const client = new FakeRepositoryClient();
    client.invalidBranchNames.add("bad..name");
    const service = createService(
      new FakeRuntime(),
      client
    );

    await expect(
      service.preflight({
        type: "rename-branch",
        target: TARGET,
        branch: "feature",
        newName: "bad..name"
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining("Invalid branch name")
    });
    expect(client.branchNameChecks).toEqual(["bad..name"]);
  });

  it("rejects branch creation without a resolvable start point in an unborn repository", async () => {
    const client = new FakeRepositoryClient();
    client.snapshot.head = "";
    const service = createService(
      new FakeRuntime(),
      client
    );

    await expect(
      service.preflight({
        type: "create-branch",
        target: TARGET,
        branch: "first"
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining("start point")
    });
    expect(client.resolveRevisionCalls).toEqual([]);
  });

  it("queues and executes an exact force-with-lease push plan", async () => {
    const client = new FakeRepositoryClient();
    client.remotes = ["origin", "backup"];
    client.remoteBranches.set("backup", [
      createRemoteBranch("main", REMOTE_HEAD)
    ]);
    const runtime = new FakeRuntime();
    const service = createService(runtime, client);
    const preflight = await service.preflight({
      type: "push",
      targets: [TARGET],
      remote: "backup",
      forceWithLease: true
    });

    expect(preflight.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SET_UPSTREAM"
        }),
        expect.objectContaining({
          code: "FORCE_WITH_LEASE",
          severity: "danger"
        })
      ])
    );
    const accepted = await service.execute(
      preflight.command,
      preflight.preflightId,
      true
    );

    expect(accepted).toEqual({
      operationIds: ["operation-1"]
    });
    expect(runtime.queued[0]).toMatchObject({
      target: TARGET,
      kind: "push"
    });

    client.snapshot.refreshedAt =
      "2026-09-04T12:00:45.000Z";
    await runtime.runQueued(0);
    expect(client.pushCalls).toEqual([
      {
        path: WORKTREE_PATH,
        remote: "backup",
        localBranch: "main",
        remoteBranch: "main",
        setUpstream: true,
        forceWithLeaseExpected: REMOTE_HEAD
      }
    ]);
  });

  it("revalidates repository state after a command leaves the queue", async () => {
    const client = new FakeRepositoryClient();
    const runtime = new FakeRuntime();
    const service = createService(runtime, client);
    const preflight = await service.preflight({
      type: "fetch",
      targets: [TARGET]
    });
    await service.execute(
      preflight.command,
      preflight.preflightId,
      false
    );

    client.snapshot.head = REMOTE_HEAD;
    await expect(runtime.runQueued(0)).rejects.toMatchObject({
      code: "PREFLIGHT_CHANGED"
    });
    expect(client.fetchCalls).toEqual([]);
  });

  it("delegates cancellation to the runtime", async () => {
    const runtime = new FakeRuntime();
    const service = createService(
      runtime,
      new FakeRepositoryClient()
    );

    await service.cancel("operation-7");
    expect(runtime.cancelled).toEqual(["operation-7"]);
  });
});

interface QueuedOperation {
  operationId: string;
  target: RepositoryTarget;
  kind: RepositoryOperationKind;
  action: (
    worktreePath: string,
    signal: AbortSignal
  ) => Promise<void>;
}

class FakeRuntime implements RepositoryCommandRuntime {
  readonly queued: QueuedOperation[] = [];
  readonly cancelled: string[] = [];

  constructor(
    readonly workspace: Workspace = createWorkspace()
  ) {}

  async getCurrent(): Promise<Workspace> {
    return structuredClone(this.workspace);
  }

  async queueRepositoryOperation(
    target: RepositoryTarget,
    kind: RepositoryOperationKind,
    action: (
      worktreePath: string,
      signal: AbortSignal
    ) => Promise<void>
  ): Promise<{ operationId: string }> {
    const operationId = `operation-${this.queued.length + 1}`;
    this.queued.push({
      operationId,
      target: structuredClone(target),
      kind,
      action
    });
    return { operationId };
  }

  async cancelOperation(operationId: string): Promise<void> {
    this.cancelled.push(operationId);
  }

  async runQueued(index: number): Promise<void> {
    const queued = this.queued[index];
    if (!queued) {
      throw new Error(`Queued operation ${index} does not exist.`);
    }
    const worktree = this.workspace.worktrees.find(
      (candidate) =>
        candidate.repositoryId === queued.target.repositoryId &&
        candidate.id === queued.target.worktreeId
    );
    if (!worktree) {
      throw new Error("Queued worktree does not exist.");
    }
    await queued.action(
      worktree.path,
      new AbortController().signal
    );
  }
}

class FakeRepositoryClient
  implements GitClient, GitRepositoryCommandClient
{
  snapshot: RepositorySnapshot = createSnapshot();
  branches: Branch[] = createBranches();
  remotes = ["origin"];
  readonly remoteBranches = new Map<string, RemoteBranchRef[]>([
    ["origin", [createRemoteBranch("main", LOCAL_HEAD)]]
  ]);
  ancestry: GitAncestry = "ancestor";
  readonly invalidBranchNames = new Set<string>();
  readonly branchNameChecks: string[] = [];
  readonly resolveRevisionCalls: string[] = [];
  readonly fetchCalls: Array<{
    path: string;
    remote: string;
    prune: boolean;
  }> = [];
  readonly pushCalls: Array<{
    path: string;
    remote: string;
    localBranch: string;
    remoteBranch: string;
    setUpstream: boolean;
    forceWithLeaseExpected?: string;
  }> = [];
  snapshotReads = 0;

  async getEnvironment(
    _options?: GitReadOptions
  ): Promise<GitEnvironment> {
    throw new Error("Not used.");
  }

  async readRepositorySnapshot(
    _path: string,
    _options?: GitReadOptions
  ): Promise<RepositorySnapshot> {
    this.snapshotReads += 1;
    return structuredClone(this.snapshot);
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
    return structuredClone(this.branches);
  }

  async inspectRepository(
    _path: string,
    _options?: InspectRepositoryOptions
  ): Promise<RepositoryInspection> {
    throw new Error("Not used.");
  }

  async readRemotes(
    _path: string,
    _options?: GitReadOptions
  ): Promise<string[]> {
    return [...this.remotes];
  }

  async readRemoteBranches(
    _path: string,
    remote: string,
    _options?: GitReadOptions
  ): Promise<RemoteBranchRef[]> {
    return structuredClone(
      this.remoteBranches.get(remote) ?? []
    );
  }

  async checkBranchName(
    _path: string,
    branch: string,
    _options?: GitReadOptions
  ): Promise<boolean> {
    this.branchNameChecks.push(branch);
    return !this.invalidBranchNames.has(branch);
  }

  async resolveRevision(
    _path: string,
    revision: string,
    _options?: GitReadOptions
  ): Promise<string> {
    this.resolveRevisionCalls.push(revision);
    return revision;
  }

  async compareAncestry(
    _path: string,
    _ancestor: string,
    _descendant: string,
    _options?: GitReadOptions
  ): Promise<GitAncestry> {
    return this.ancestry;
  }

  async fetchRemote(
    path: string,
    remote: string,
    options?: FetchRemoteOptions
  ): Promise<void> {
    this.fetchCalls.push({
      path,
      remote,
      prune: options?.prune ?? false
    });
  }

  async pullFastForward(
    _path: string,
    _remote: string,
    _remoteBranch: string,
    _options?: GitWriteOptions
  ): Promise<void> {
    throw new Error("Not used.");
  }

  async pushBranch(
    path: string,
    options: PushBranchOptions
  ): Promise<void> {
    this.pushCalls.push({
      path,
      remote: options.remote,
      localBranch: options.localBranch,
      remoteBranch: options.remoteBranch,
      setUpstream: options.setUpstream ?? false,
      ...(options.forceWithLeaseExpected
        ? {
            forceWithLeaseExpected:
              options.forceWithLeaseExpected
          }
        : {})
    });
  }

  async createBranch(
    _path: string,
    _branch: string,
    _startPoint: string,
    _options?: GitWriteOptions
  ): Promise<void> {
    throw new Error("Not used.");
  }

  async switchBranch(
    _path: string,
    _branch: string,
    _options?: GitWriteOptions
  ): Promise<void> {
    throw new Error("Not used.");
  }

  async renameBranch(
    _path: string,
    _branch: string,
    _newName: string,
    _options?: GitWriteOptions
  ): Promise<void> {
    throw new Error("Not used.");
  }

  async deleteBranch(
    _path: string,
    _branch: string,
    _options?: GitWriteOptions
  ): Promise<void> {
    throw new Error("Not used.");
  }
}

function createService(
  runtime: FakeRuntime,
  client: FakeRepositoryClient,
  options: {
    clock?: () => string;
    preflightTtlMs?: number;
  } = {}
): RepositoryCommandService {
  let sequence = 0;
  return new RepositoryCommandService(runtime, client, client, {
    ...options,
    idFactory: () => `preflight_${++sequence}`
  });
}

function createWorkspace(targetCount = 1): Workspace {
  const targets = Array.from(
    { length: targetCount },
    (_, index): RepositoryTarget => ({
      repositoryId: `repository-${index + 1}`,
      worktreeId: `worktree-${index + 1}`
    })
  );
  const selectedTarget = targets[0];
  if (!selectedTarget) {
    throw new Error("A test workspace needs at least one target.");
  }

  return {
    schemaVersion: 1,
    id: "workspace",
    name: "Workspace",
    entries: [
      {
        id: "entry",
        displayName: "Workspace",
        path: "C:\\workspace",
        canonicalPath: "c:\\workspace",
        excludes: [],
        order: 0,
        groups: [
          {
            id: "group",
            name: "Repositories",
            targets,
            collapsed: false
          }
        ],
        scanIssues: [],
        lastScannedAt: "2026-09-04T12:00:00.000Z",
        kind: "workspace-directory"
      }
    ],
    repositories: targets.map((target, index) => ({
      id: target.repositoryId,
      name: `repository-${index + 1}`,
      commonDir: `C:\\workspace\\repository-${index + 1}\\.git`,
      canonicalCommonDir:
        `c:\\workspace\\repository-${index + 1}\\.git`,
      primaryWorktreeId: target.worktreeId,
      worktreeIds: [target.worktreeId]
    })),
    worktrees: targets.map((target, index) => ({
      id: target.worktreeId,
      repositoryId: target.repositoryId,
      name: `repository-${index + 1}`,
      path: `C:\\workspace\\repository-${index + 1}`,
      canonicalPath:
        `c:\\workspace\\repository-${index + 1}`,
      gitDir: `C:\\workspace\\repository-${index + 1}\\.git`,
      head: LOCAL_HEAD,
      branch: "main",
      isPrimary: true,
      isBare: false,
      isDetached: false,
      isLocked: false,
      isPrunable: false
    })),
    selectedEntryId: "entry",
    selectedTarget,
    updatedAt: "2026-09-04T12:00:00.000Z"
  };
}

function createSnapshot(): RepositorySnapshot {
  return {
    branch: "main",
    head: LOCAL_HEAD,
    upstream: "origin/main",
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

function createBranches(): Branch[] {
  return [
    {
      fullName: "refs/heads/main",
      name: "main",
      head: LOCAL_HEAD,
      upstream: "origin/main",
      current: true,
      remote: false,
      worktreePath: WORKTREE_PATH
    },
    {
      fullName: "refs/heads/feature",
      name: "feature",
      head: LOCAL_HEAD,
      current: false,
      remote: false
    },
    {
      fullName: "refs/remotes/origin/feature",
      name: "origin/feature",
      head: LOCAL_HEAD,
      current: false,
      remote: true
    }
  ];
}

function createRemoteBranch(
  name: string,
  head: string
): RemoteBranchRef {
  return {
    name,
    fullName: `refs/heads/${name}`,
    head
  };
}
