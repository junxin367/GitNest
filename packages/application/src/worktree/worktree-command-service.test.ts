import { describe, expect, it } from "vitest";

import {
  GitError,
  type Branch,
  type CreateWorktreeOptions,
  type GitAncestry,
  type GitClient,
  type GitEnvironment,
  type GitReadOptions,
  type GitRepositoryCommandClient,
  type GitWorktreeCommandClient,
  type GitWriteOptions,
  type LockWorktreeOptions,
  type RemoteBranchRef,
  type RepositoryInspection,
  type RepositorySnapshot,
  type Worktree
} from "@gitnest/git-core";
import type {
  RepositoryTarget,
  Workspace
} from "@gitnest/workspace-core";

import type {
  RepositoryOperationKind,
  RepositoryOperationOptions
} from "../workspace/workspace-runtime-service";
import {
  WorktreeCommandService,
  type NormalizedWorktreePath,
  type WorktreeCommandRuntime,
  type WorktreePathInspection,
  type WorktreePathPolicy
} from "./worktree-command-service";

const PRIMARY_TARGET: RepositoryTarget = {
  repositoryId: "repository-1",
  worktreeId: "worktree-primary"
};
const LINKED_TARGET: RepositoryTarget = {
  repositoryId: "repository-1",
  worktreeId: "worktree-linked"
};
const PRIMARY_PATH = "C:\\workspace\\repository";
const LINKED_PATH = "C:\\workspace\\linked";
const LOCAL_HEAD = "a".repeat(40);

describe("WorktreeCommandService", () => {
  it("creates a new branch Worktree through a bound two-phase plan", async () => {
    const fixture = createFixture();
    const preflight = await fixture.service.preflight({
      type: "create",
      repositoryId: "repository-1",
      path: "C:\\workspace\\new-worktree",
      branch: " feature/new "
    });

    expect(preflight).toMatchObject({
      preflightId: "worktree-preflight-1",
      command: {
        type: "create",
        repositoryId: "repository-1",
        path: "C:\\workspace\\new-worktree",
        branch: "feature/new"
      },
      confirmationRequired: true
    });
    expect(preflight.impacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "worktree-directory",
          detail: "C:\\workspace\\new-worktree"
        }),
        expect.objectContaining({
          kind: "local-branch",
          summary: "创建本地分支 feature/new"
        })
      ])
    );
    expect(preflight.warnings).toContainEqual(
      expect.objectContaining({
        code: "CREATE_BRANCH"
      })
    );

    await expect(
      fixture.service.execute(
        preflight.command,
        preflight.preflightId,
        false
      )
    ).rejects.toMatchObject({
      code: "CONFIRMATION_REQUIRED"
    });
    await expect(
      fixture.service.execute(
        preflight.command,
        preflight.preflightId,
        true
      )
    ).resolves.toEqual({
      operationId: "operation-1"
    });
    expect(fixture.runtime.queued[0]).toMatchObject({
      target: PRIMARY_TARGET,
      kind: "worktree-create",
      options: { refreshTopology: true }
    });

    await fixture.runtime.runQueued(0);
    expect(fixture.git.createCalls).toEqual([
      {
        repositoryPath: PRIMARY_PATH,
        destination: "C:\\workspace\\new-worktree",
        startPoint: LOCAL_HEAD,
        branch: "feature/new",
        createBranch: true,
        detached: false
      }
    ]);
  });

  it("requires a recent Main selection outside Workspace roots and invalidates changed destinations", async () => {
    const fixture = createFixture();
    const command = {
      type: "create" as const,
      repositoryId: "repository-1",
      path: "D:\\external\\new-worktree"
    };

    await expect(
      fixture.service.preflight(command)
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining(
        "Main-process directory selection"
      )
    });

    fixture.paths.grant("D:\\external");
    const preflight =
      await fixture.service.preflight(command);
    expect(preflight.warnings).toContainEqual(
      expect.objectContaining({
        code: "OUTSIDE_WORKSPACE"
      })
    );

    fixture.paths.setInspection(
      "D:\\external\\new-worktree",
      {
        exists: true,
        kind: "directory",
        empty: false
      }
    );
    await expect(
      fixture.service.execute(
        preflight.command,
        preflight.preflightId,
        true
      )
    ).rejects.toMatchObject({
      code: "PREFLIGHT_CHANGED"
    });
    expect(fixture.runtime.queued).toHaveLength(0);
  });

  it("rejects branch occupancy and prevents misleading start points for existing branches", async () => {
    const fixture = createFixture();
    fixture.git.branches.push({
      fullName: "refs/heads/feature/existing",
      name: "feature/existing",
      head: LOCAL_HEAD,
      current: false,
      remote: false,
      worktreePath: LINKED_PATH
    });
    fixture.git.worktrees[1] = {
      ...(fixture.git.worktrees[1] as Worktree),
      branch: "feature/existing"
    };

    await expect(
      fixture.service.preflight({
        type: "create",
        repositoryId: "repository-1",
        path: "C:\\workspace\\occupied",
        branch: "feature/existing"
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining(
        "already checked out"
      )
    });

    fixture.git.worktrees[1] = {
      ...(fixture.git.worktrees[1] as Worktree),
      branch: "feature/other"
    };
    await expect(
      fixture.service.preflight({
        type: "create",
        repositoryId: "repository-1",
        path: "C:\\workspace\\existing",
        branch: "feature/existing",
        startPoint: "main"
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining(
        "cannot be supplied"
      )
    });
  });

  it("locks and unlocks only exact linked Worktree registrations while preserving the reason", async () => {
    const fixture = createFixture();
    const lock = await fixture.service.preflight({
      type: "lock",
      worktreeId: "worktree-linked",
      reason: " release validation "
    });

    expect(lock.confirmationRequired).toBe(false);
    await fixture.service.execute(
      lock.command,
      lock.preflightId,
      false
    );
    await fixture.runtime.runQueued(0);
    expect(fixture.git.lockCalls).toEqual([
      {
        repositoryPath: PRIMARY_PATH,
        worktreePath: LINKED_PATH,
        reason: "release validation"
      }
    ]);

    fixture.git.worktrees[1] = {
      ...(fixture.git.worktrees[1] as Worktree),
      locked: true,
      lockReason: "release validation"
    };
    const unlock = await fixture.service.preflight({
      type: "unlock",
      worktreeId: "worktree-linked"
    });
    expect(unlock.impacts[0]?.detail).toContain(
      "release validation"
    );
    await fixture.service.execute(
      unlock.command,
      unlock.preflightId,
      false
    );
    await fixture.runtime.runQueued(1);
    expect(fixture.git.unlockCalls).toEqual([
      {
        repositoryPath: PRIMARY_PATH,
        worktreePath: LINKED_PATH
      }
    ]);

    await expect(
      fixture.service.preflight({
        type: "lock",
        worktreeId: "worktree-primary"
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining("Primary")
    });
  });

  it("moves only an unlocked linked Worktree to an absent authorized non-overlapping path", async () => {
    const fixture = createFixture();
    const preflight = await fixture.service.preflight({
      type: "move",
      worktreeId: "worktree-linked",
      destination: "C:\\workspace\\moved"
    });

    expect(preflight).toMatchObject({
      confirmationRequired: true,
      impacts: [
        expect.objectContaining({
          summary: "移动 Worktree",
          detail: `${LINKED_PATH} → C:\\workspace\\moved`
        })
      ]
    });
    await fixture.service.execute(
      preflight.command,
      preflight.preflightId,
      true
    );
    await fixture.runtime.runQueued(0);
    expect(fixture.git.moveCalls).toEqual([
      {
        repositoryPath: PRIMARY_PATH,
        worktreePath: LINKED_PATH,
        destination: "C:\\workspace\\moved"
      }
    ]);

    fixture.paths.setInspection("C:\\workspace\\exists", {
      exists: true,
      kind: "directory",
      empty: true
    });
    await expect(
      fixture.service.preflight({
        type: "move",
        worktreeId: "worktree-linked",
        destination: "C:\\workspace\\exists"
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining(
        "must not already exist"
      )
    });
    await expect(
      fixture.service.preflight({
        type: "move",
        worktreeId: "worktree-linked",
        destination: "C:\\workspace\\repository\\nested"
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining("overlaps")
    });
  });

  it("repairs one exact registration and previews every prune candidate before execution", async () => {
    const fixture = createFixture();
    const repair = await fixture.service.preflight({
      type: "repair",
      worktreeId: "worktree-linked"
    });
    await fixture.service.execute(
      repair.command,
      repair.preflightId,
      true
    );
    await fixture.runtime.runQueued(0);
    expect(fixture.git.repairCalls).toEqual([
      {
        repositoryPath: PRIMARY_PATH,
        worktreePaths: [LINKED_PATH]
      }
    ]);

    fixture.git.worktrees.push(
      createPrunableWorktree(
        "C:\\workspace\\missing-one",
        "missing metadata"
      ),
      createPrunableWorktree(
        "C:\\workspace\\missing-two",
        "missing directory"
      )
    );
    const prune = await fixture.service.preflight({
      type: "prune",
      repositoryId: "repository-1"
    });
    expect(prune.impacts).toHaveLength(2);
    expect(prune.impacts.map((impact) => impact.detail)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "C:\\workspace\\missing-one"
        ),
        expect.stringContaining(
          "C:\\workspace\\missing-two"
        )
      ])
    );
    expect(fixture.git.previewPruneReads).toBe(1);

    fixture.git.worktrees.push(
      createPrunableWorktree(
        "C:\\workspace\\new-candidate",
        "appeared later"
      )
    );
    await expect(
      fixture.service.execute(
        prune.command,
        prune.preflightId,
        true
      )
    ).rejects.toMatchObject({
      code: "PREFLIGHT_CHANGED"
    });
    expect(fixture.git.pruneCalls).toBe(0);

    const fresh = await fixture.service.preflight({
      type: "prune",
      repositoryId: "repository-1"
    });
    await fixture.service.execute(
      fresh.command,
      fresh.preflightId,
      true
    );
    await fixture.runtime.runQueued(1);
    expect(fixture.git.pruneCalls).toBe(1);
  });

  it("removes only clean, unlocked linked Worktrees and never requests force", async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.preflight({
        type: "remove",
        worktreeId: "worktree-primary"
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining("Primary")
    });

    fixture.git.snapshot.untracked = 1;
    await expect(
      fixture.service.preflight({
        type: "remove",
        worktreeId: "worktree-linked"
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining("clean")
    });

    fixture.git.snapshot.untracked = 0;
    const preflight = await fixture.service.preflight({
      type: "remove",
      worktreeId: "worktree-linked"
    });
    expect(preflight.warnings).toContainEqual(
      expect.objectContaining({
        code: "REMOVE_DIRECTORY",
        severity: "danger"
      })
    );
    await fixture.service.execute(
      preflight.command,
      preflight.preflightId,
      true
    );
    await fixture.runtime.runQueued(0);
    expect(fixture.git.removeCalls).toEqual([
      {
        repositoryPath: PRIMARY_PATH,
        worktreePath: LINKED_PATH
      }
    ]);
  });

  it("revalidates exact Git registration after queueing and rejects stale confirmation", async () => {
    const fixture = createFixture();
    const preflight = await fixture.service.preflight({
      type: "lock",
      worktreeId: "worktree-linked"
    });
    await fixture.service.execute(
      preflight.command,
      preflight.preflightId,
      false
    );

    fixture.git.worktrees[1] = {
      ...(fixture.git.worktrees[1] as Worktree),
      locked: true,
      lockReason: "external change"
    };
    await expect(
      fixture.runtime.runQueued(0)
    ).rejects.toMatchObject({
      code: "PREFLIGHT_CHANGED"
    });
    expect(fixture.git.lockCalls).toHaveLength(0);
  });

  it("falls back to an accessible linked anchor but never moves or removes the command anchor itself", async () => {
    const fixture = createFixture();
    fixture.paths.setInspection(PRIMARY_PATH, {
      exists: false,
      kind: "missing",
      empty: false
    });
    const lock = await fixture.service.preflight({
      type: "lock",
      worktreeId: "worktree-linked"
    });
    await fixture.service.execute(
      lock.command,
      lock.preflightId,
      false
    );
    expect(fixture.runtime.queued[0]?.target).toEqual(
      LINKED_TARGET
    );

    await expect(
      fixture.service.preflight({
        type: "move",
        worktreeId: "worktree-linked",
        destination: "C:\\workspace\\moved"
      })
    ).rejects.toMatchObject({
      code: "DIRECTORY_UNAVAILABLE"
    });
  });

  it("expires short-lived preflights and delegates cancellation", async () => {
    let nowMs = Date.parse("2026-09-04T12:00:00.000Z");
    const fixture = createFixture({
      clock: () => new Date(nowMs).toISOString(),
      preflightTtlMs: 1_000
    });
    const preflight = await fixture.service.preflight({
      type: "lock",
      worktreeId: "worktree-linked"
    });

    nowMs += 1_001;
    await expect(
      fixture.service.execute(
        preflight.command,
        preflight.preflightId,
        false
      )
    ).rejects.toMatchObject({
      code: "PREFLIGHT_EXPIRED"
    });

    await fixture.service.cancel("operation-9");
    expect(fixture.runtime.cancelled).toEqual([
      "operation-9"
    ]);
  });
});

function createFixture(
  options: {
    clock?: () => string;
    preflightTtlMs?: number;
  } = {}
): {
  service: WorktreeCommandService;
  runtime: FakeRuntime;
  git: FakeGitClient;
  paths: FakePathPolicy;
} {
  const workspace = createWorkspace();
  const runtime = new FakeRuntime(workspace);
  const git = new FakeGitClient();
  const paths = new FakePathPolicy();
  paths.setInspection(PRIMARY_PATH, {
    exists: true,
    kind: "directory",
    empty: false
  });
  paths.setInspection(LINKED_PATH, {
    exists: true,
    kind: "directory",
    empty: false
  });
  let sequence = 0;
  const service = new WorktreeCommandService(
    runtime,
    git,
    git,
    git,
    paths,
    {
      idFactory: () =>
        `worktree-preflight-${++sequence}`,
      ...(options.clock ? { clock: options.clock } : {}),
      ...(options.preflightTtlMs === undefined
        ? {}
        : { preflightTtlMs: options.preflightTtlMs })
    }
  );
  return { service, runtime, git, paths };
}

interface QueuedOperation {
  operationId: string;
  target: RepositoryTarget;
  kind: RepositoryOperationKind;
  action: (
    path: string,
    signal: AbortSignal
  ) => Promise<void>;
  options: RepositoryOperationOptions;
}

class FakeRuntime implements WorktreeCommandRuntime {
  readonly queued: QueuedOperation[] = [];
  readonly cancelled: string[] = [];

  constructor(readonly workspace: Workspace) {}

  async getCurrent(): Promise<Workspace> {
    return structuredClone(this.workspace);
  }

  async queueRepositoryOperation(
    target: RepositoryTarget,
    kind: RepositoryOperationKind,
    action: (
      path: string,
      signal: AbortSignal
    ) => Promise<void>,
    options: RepositoryOperationOptions = {}
  ): Promise<{ operationId: string }> {
    const operationId = `operation-${this.queued.length + 1}`;
    this.queued.push({
      operationId,
      target: structuredClone(target),
      kind,
      action,
      options
    });
    return { operationId };
  }

  async cancelOperation(operationId: string): Promise<void> {
    this.cancelled.push(operationId);
  }

  async runQueued(index: number): Promise<void> {
    const queued = this.queued[index];
    if (!queued) {
      throw new Error(`Queued operation ${index} is missing.`);
    }
    const worktree = this.workspace.worktrees.find(
      (candidate) =>
        candidate.repositoryId === queued.target.repositoryId &&
        candidate.id === queued.target.worktreeId
    );
    if (!worktree) {
      throw new Error("Queued anchor Worktree is missing.");
    }
    await queued.action(
      worktree.path,
      new AbortController().signal
    );
  }
}

class FakePathPolicy implements WorktreePathPolicy {
  readonly #inspections = new Map<
    string,
    Pick<
      WorktreePathInspection,
      "exists" | "kind" | "empty"
    >
  >();
  readonly #selected = new Set<string>();

  normalizePath(path: string): NormalizedWorktreePath {
    if (
      typeof path !== "string" ||
      !/^[a-zA-Z]:[\\/]/.test(path) ||
      path.includes("\0") ||
      /[\r\n]/.test(path)
    ) {
      throw new GitError(
        "INVALID_REQUEST",
        "Test paths must be absolute Windows paths."
      );
    }
    const normalized = path
      .replace(/\//g, "\\")
      .replace(/\\+$/, "");
    return {
      path: normalized,
      canonicalPath:
        normalized.toLocaleLowerCase("en-US")
    };
  }

  async inspectPath(
    path: string
  ): Promise<WorktreePathInspection> {
    const normalized = this.normalizePath(path);
    const configured = this.#inspections.get(
      normalized.canonicalPath
    ) ?? {
      exists: false,
      kind: "missing" as const,
      empty: false
    };
    return {
      ...normalized,
      ...configured
    };
  }

  isWithin(parent: string, child: string): boolean {
    return (
      child === parent ||
      child.startsWith(`${parent}\\`)
    );
  }

  isExplicitlySelected(canonicalPath: string): boolean {
    return [...this.#selected].some((selected) =>
      this.isWithin(selected, canonicalPath)
    );
  }

  setInspection(
    path: string,
    inspection: Pick<
      WorktreePathInspection,
      "exists" | "kind" | "empty"
    >
  ): void {
    this.#inspections.set(
      this.normalizePath(path).canonicalPath,
      inspection
    );
  }

  grant(path: string): void {
    this.#selected.add(
      this.normalizePath(path).canonicalPath
    );
  }
}

class FakeGitClient
  implements
    GitClient,
    GitRepositoryCommandClient,
    GitWorktreeCommandClient
{
  snapshot: RepositorySnapshot = createSnapshot();
  branches: Branch[] = [
    {
      fullName: "refs/heads/main",
      name: "main",
      head: LOCAL_HEAD,
      current: true,
      remote: false,
      worktreePath: PRIMARY_PATH
    }
  ];
  worktrees: Worktree[] = [
    {
      path: PRIMARY_PATH,
      head: LOCAL_HEAD,
      branch: "main",
      bare: false,
      detached: false,
      locked: false,
      prunable: false,
      primary: true
    },
    {
      path: LINKED_PATH,
      head: LOCAL_HEAD,
      branch: "feature/linked",
      bare: false,
      detached: false,
      locked: false,
      prunable: false,
      primary: false
    }
  ];
  previewPruneReads = 0;
  pruneCalls = 0;
  readonly createCalls: Array<{
    repositoryPath: string;
    destination: string;
    startPoint: string;
    branch?: string;
    createBranch: boolean;
    detached: boolean;
  }> = [];
  readonly lockCalls: Array<{
    repositoryPath: string;
    worktreePath: string;
    reason?: string;
  }> = [];
  readonly unlockCalls: Array<{
    repositoryPath: string;
    worktreePath: string;
  }> = [];
  readonly moveCalls: Array<{
    repositoryPath: string;
    worktreePath: string;
    destination: string;
  }> = [];
  readonly repairCalls: Array<{
    repositoryPath: string;
    worktreePaths: string[];
  }> = [];
  readonly removeCalls: Array<{
    repositoryPath: string;
    worktreePath: string;
  }> = [];

  async getEnvironment(): Promise<GitEnvironment> {
    throw new Error("Not used.");
  }

  async readRepositorySnapshot(): Promise<RepositorySnapshot> {
    return structuredClone(this.snapshot);
  }

  async readRepositoryDiff(): Promise<never> {
    throw new Error("Not used.");
  }

  async readCommitHistory(): Promise<never> {
    throw new Error("Not used.");
  }

  async readCommitDetails(): Promise<never> {
    throw new Error("Not used.");
  }

  async readBranches(): Promise<Branch[]> {
    return structuredClone(this.branches);
  }

  async inspectRepository(): Promise<RepositoryInspection> {
    throw new Error("Not used.");
  }

  async readRemotes(): Promise<string[]> {
    return [];
  }

  async readRemoteBranches(): Promise<RemoteBranchRef[]> {
    return [];
  }

  async checkBranchName(
    _path: string,
    branch: string
  ): Promise<boolean> {
    return !branch.includes("..");
  }

  async resolveRevision(
    _path: string,
    _revision: string
  ): Promise<string> {
    return LOCAL_HEAD;
  }

  async compareAncestry(): Promise<GitAncestry> {
    return "ancestor";
  }

  async fetchRemote(): Promise<void> {}
  async pullFastForward(): Promise<void> {}
  async pullBranch(): Promise<void> {}
  async pushBranch(): Promise<void> {}
  async createBranch(): Promise<void> {}
  async switchBranch(): Promise<void> {}
  async renameBranch(): Promise<void> {}
  async deleteBranch(): Promise<void> {}

  async readWorktrees(
    _repositoryPath: string,
    _options?: GitReadOptions
  ): Promise<Worktree[]> {
    return structuredClone(this.worktrees);
  }

  async previewPruneWorktrees(): Promise<Worktree[]> {
    this.previewPruneReads += 1;
    return structuredClone(
      this.worktrees.filter(
        (worktree) =>
          worktree.prunable &&
          !worktree.locked &&
          !worktree.primary
      )
    );
  }

  async createWorktree(
    repositoryPath: string,
    destination: string,
    options: CreateWorktreeOptions
  ): Promise<void> {
    this.createCalls.push({
      repositoryPath,
      destination,
      startPoint: options.startPoint,
      ...(options.branch
        ? { branch: options.branch }
        : {}),
      createBranch: options.createBranch,
      detached: options.detached
    });
  }

  async lockWorktree(
    repositoryPath: string,
    worktreePath: string,
    options: LockWorktreeOptions = {}
  ): Promise<void> {
    this.lockCalls.push({
      repositoryPath,
      worktreePath,
      ...(options.reason
        ? { reason: options.reason }
        : {})
    });
  }

  async unlockWorktree(
    repositoryPath: string,
    worktreePath: string,
    _options?: GitWriteOptions
  ): Promise<void> {
    this.unlockCalls.push({
      repositoryPath,
      worktreePath
    });
  }

  async moveWorktree(
    repositoryPath: string,
    worktreePath: string,
    destination: string
  ): Promise<void> {
    this.moveCalls.push({
      repositoryPath,
      worktreePath,
      destination
    });
  }

  async repairWorktrees(
    repositoryPath: string,
    worktreePaths: readonly string[]
  ): Promise<void> {
    this.repairCalls.push({
      repositoryPath,
      worktreePaths: [...worktreePaths]
    });
  }

  async pruneWorktrees(): Promise<void> {
    this.pruneCalls += 1;
  }

  async removeWorktree(
    repositoryPath: string,
    worktreePath: string
  ): Promise<void> {
    this.removeCalls.push({
      repositoryPath,
      worktreePath
    });
  }
}

function createSnapshot(): RepositorySnapshot {
  return {
    branch: "main",
    head: LOCAL_HEAD,
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

function createPrunableWorktree(
  path: string,
  reason: string
): Worktree {
  return {
    path,
    head: LOCAL_HEAD,
    branch: `stale/${reason.replace(/\s+/g, "-")}`,
    bare: false,
    detached: false,
    locked: false,
    prunable: true,
    pruneReason: reason,
    primary: false
  };
}

function createWorkspace(): Workspace {
  return {
    schemaVersion: 1,
    id: "workspace",
    name: "Workspace",
    entries: [
      {
        id: "entry",
        displayName: "Workspace root",
        path: "C:\\workspace",
        canonicalPath: "c:\\workspace",
        excludes: [],
        order: 0,
        kind: "workspace-directory",
        groups: [
          {
            id: "group",
            name: "Repositories",
            targets: [PRIMARY_TARGET, LINKED_TARGET],
            collapsed: false
          }
        ],
        scanIssues: [],
        lastScannedAt: "2026-09-04T12:00:00.000Z"
      }
    ],
    repositories: [
      {
        id: "repository-1",
        name: "repository",
        commonDir: "C:\\workspace\\repository\\.git",
        canonicalCommonDir:
          "c:\\workspace\\repository\\.git",
        primaryWorktreeId: "worktree-primary",
        worktreeIds: [
          "worktree-primary",
          "worktree-linked"
        ]
      }
    ],
    worktrees: [
      {
        id: "worktree-primary",
        repositoryId: "repository-1",
        name: "repository",
        path: PRIMARY_PATH,
        canonicalPath:
          PRIMARY_PATH.toLocaleLowerCase("en-US"),
        gitDir: "C:\\workspace\\repository\\.git",
        head: LOCAL_HEAD,
        branch: "main",
        isPrimary: true,
        isBare: false,
        isDetached: false,
        isLocked: false,
        isPrunable: false
      },
      {
        id: "worktree-linked",
        repositoryId: "repository-1",
        name: "linked",
        path: LINKED_PATH,
        canonicalPath:
          LINKED_PATH.toLocaleLowerCase("en-US"),
        gitDir:
          "C:\\workspace\\repository\\.git\\worktrees\\linked",
        head: LOCAL_HEAD,
        branch: "feature/linked",
        isPrimary: false,
        isBare: false,
        isDetached: false,
        isLocked: false,
        isPrunable: false
      }
    ],
    selectedEntryId: "entry",
    selectedTarget: PRIMARY_TARGET,
    updatedAt: "2026-09-04T12:00:00.000Z"
  };
}
