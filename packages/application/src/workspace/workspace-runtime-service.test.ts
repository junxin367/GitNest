import { describe, expect, it } from "vitest";

import {
  GitError,
  type GitClient,
  type GitEnvironment,
  type GitReadOptions,
  type InspectRepositoryOptions,
  type RepositoryInspection,
  type RepositorySnapshot
} from "@gitnest/git-core";
import type {
  RepositorySnapshotStore,
  RepositoryStatusSnapshot,
  RepositoryTarget,
  Workspace,
  WorkspaceWatchEvent,
  WorkspaceWatchHandle,
  WorkspaceWatcher,
  WorkspaceWatchRegistration
} from "@gitnest/workspace-core";

import {
  WorkspaceRuntimeService,
  type WorkspaceConfigurationService,
  type WorkspaceOperation,
  type WorkspaceOperationStore,
  type WorkspaceRuntimeState
} from "./workspace-runtime-service";

describe("WorkspaceRuntimeService", () => {
  it("shows cached snapshots first, caps Git reads at four, merges duplicate requests, and debounces watcher events", async () => {
    const workspace = createWorkspace(6);
    const configuration = new FakeConfiguration(workspace);
    const gitClient = new TrackingGitClient();
    const snapshotStore = new MemorySnapshotStore([
      createCachedSnapshot(workspace.selectedTarget as RepositoryTarget)
    ]);
    const watcher = new FakeWatcher();
    const runtime = new WorkspaceRuntimeService(
      configuration,
      gitClient,
      snapshotStore,
      watcher,
      {
        autoRefresh: false,
        concurrency: 4,
        currentTargetDebounceMs: 5,
        backgroundTargetDebounceMs: 10,
        pollingIntervalMs: 60_000,
        clock: () => "2026-09-04T12:00:00.000Z"
      }
    );

    const cachedState = await runtime.getState();
    expect(cachedState.snapshots).toEqual([
      expect.objectContaining({
        stale: true,
        refreshPending: false
      })
    ]);
    const unsubscribeThrowingListener = runtime.subscribe(() => {
      throw new Error("Renderer closed.");
    });

    const first = await runtime.requestWorkspaceRefresh("manual");
    const second = await runtime.requestWorkspaceRefresh("manual");
    expect(second.operationId).toBe(first.operationId);

    await waitForState(
      runtime,
      (state) =>
        state.monitor.mode === "watching" &&
        state.operations.some(
          (operation) =>
            operation.kind === "status" &&
            operation.state === "running"
        )
    );

    const selected = workspace.selectedTarget as RepositoryTarget;
    watcher.emit(selected);
    watcher.emit(selected);

    const completed = await waitForState(
      runtime,
      (state) =>
        state.snapshots.length === 6 &&
        state.snapshots.every(
          (snapshot) =>
            !snapshot.stale && !snapshot.refreshPending
        ) &&
        state.operations.some(
          (operation) =>
            operation.kind === "status" &&
            operation.state === "succeeded"
        )
    );

    expect(completed.snapshots).toHaveLength(6);
    expect(gitClient.maxActive).toBeLessThanOrEqual(4);
    expect(gitClient.calls).toHaveLength(7);
    expect(snapshotStore.saved).toHaveLength(6);

    unsubscribeThrowingListener();
    await runtime.dispose();
  });

  it("recovers active persisted operations as interrupted without inventing a Git result", async () => {
    const workspace = createWorkspace(1);
    const operationStore = new MemoryOperationStore([
      {
        id: "operation_7_20260904110000000",
        kind: "worktree-move",
        scope: "repository",
        targetIds: [
          "repository-0:worktree-0"
        ],
        state: "running",
        progress: 0.5,
        succeeded: 0,
        failed: 0,
        message: "Moving Worktree.",
        startedAt: "2026-09-04T11:00:00.000Z"
      },
      {
        id: "operation_6_20260904100000000",
        kind: "fetch",
        scope: "repository",
        targetIds: [
          "repository-0:worktree-0"
        ],
        state: "succeeded",
        progress: 1,
        succeeded: 1,
        failed: 0,
        message: "Fetch completed.",
        finishedAt: "2026-09-04T10:00:00.000Z"
      }
    ]);
    const runtime = new WorkspaceRuntimeService(
      new FakeConfiguration(workspace),
      new TrackingGitClient(),
      new MemorySnapshotStore(),
      new FakeWatcher(),
      {
        autoRefresh: false,
        operationStore,
        clock: () => "2026-09-04T12:00:00.000Z"
      }
    );

    const state = await runtime.getState();
    expect(state.operations[0]).toMatchObject({
      id: "operation_7_20260904110000000",
      state: "interrupted",
      progress: 1,
      succeeded: 0,
      failed: 0,
      finishedAt: "2026-09-04T12:00:00.000Z",
      message: expect.stringContaining(
        "未假定操作成功、失败或已回滚"
      )
    });
    expect(state.operations[1]).toMatchObject({
      state: "succeeded",
      message: "Fetch completed."
    });

    await runtime.dispose();
    expect(operationStore.saved[0]).toMatchObject({
      state: "interrupted"
    });
  });

  it("persists terminal operation transitions for the next launch", async () => {
    const workspace = createWorkspace(1);
    const target =
      workspace.selectedTarget as RepositoryTarget;
    const operationStore = new MemoryOperationStore();
    const runtime = new WorkspaceRuntimeService(
      new FakeConfiguration(workspace),
      new TrackingGitClient(),
      new MemorySnapshotStore(),
      new FakeWatcher(),
      {
        autoRefresh: false,
        operationStore,
        clock: () => "2026-09-04T12:00:00.000Z"
      }
    );

    const accepted = await runtime.queueRepositoryOperation(
      target,
      "fetch",
      async () => undefined
    );
    await waitForState(
      runtime,
      (state) =>
        state.operations.some(
          (operation) =>
            operation.id === accepted.operationId &&
            operation.state === "succeeded"
        )
    );
    await runtime.dispose();

    expect(
      operationStore.saved.find(
        (operation) =>
          operation.id === accepted.operationId
      )
    ).toMatchObject({
      state: "succeeded",
      progress: 1,
      succeeded: 1
    });
  });

  it("falls back to polling when file watching cannot start", async () => {
    const workspace = createWorkspace(1);
    const runtime = new WorkspaceRuntimeService(
      new FakeConfiguration(workspace),
      new TrackingGitClient(),
      new MemorySnapshotStore(),
      new FailingWatcher(),
      {
        autoRefresh: false,
        pollingIntervalMs: 60_000,
        clock: () => "2026-09-04T12:00:00.000Z"
      }
    );

    await runtime.requestWorkspaceRefresh("manual");
    const state = await waitForState(
      runtime,
      (candidate) => candidate.monitor.mode === "polling"
    );

    expect(state.monitor.message).toContain("已降级为低频轮询");
    await runtime.dispose();
  });

  it("lets the startup refresh own the first focus event", async () => {
    const workspace = createWorkspace(1);
    const configuration = new FakeConfiguration(workspace);
    const gitClient = new TrackingGitClient();
    const runtime = new WorkspaceRuntimeService(
      configuration,
      gitClient,
      new MemorySnapshotStore(),
      new FakeWatcher(),
      {
        autoRefresh: true,
        clock: () => "2026-09-04T12:00:00.000Z"
      }
    );

    await runtime.refreshStaleOnFocus();
    expect(configuration.rescanCount).toBe(0);
    expect(gitClient.calls).toHaveLength(0);

    await runtime.getState();
    const completed = await waitForState(
      runtime,
      (state) =>
        state.operations.some(
          (operation) =>
            operation.kind === "status" &&
            operation.state === "succeeded"
        )
    );

    expect(configuration.rescanCount).toBe(1);
    expect(
      completed.operations.filter(
        (operation) => operation.kind === "status"
      )
    ).toHaveLength(1);
    await runtime.dispose();
  });

  it("serializes mutations for one Worktree and refreshes the preserved snapshot after each write", async () => {
    const workspace = createWorkspace(1);
    const target =
      workspace.selectedTarget as RepositoryTarget;
    const gitClient = new TrackingGitClient();
    const runtime = new WorkspaceRuntimeService(
      new FakeConfiguration(workspace),
      gitClient,
      new MemorySnapshotStore([
        createCachedSnapshot(target)
      ]),
      new FakeWatcher(),
      {
        autoRefresh: false,
        clock: () => "2026-09-04T12:00:00.000Z"
      }
    );
    await runtime.getState();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = runtime.runWorktreeMutation(
      target,
      "stage",
      async (path) => {
        order.push(`first-start:${path}`);
        await firstGate;
        order.push("first-end");
        return "first-result";
      }
    );
    const second = runtime.runWorktreeMutation(
      target,
      "unstage",
      async (path) => {
        order.push(`second-start:${path}`);
        order.push("second-end");
        return "second-result";
      }
    );

    const pending = await waitForState(
      runtime,
      (state) =>
        state.snapshots[0]?.refreshPending === true &&
        state.operations.some(
          (operation) =>
            operation.kind === "stage" &&
            operation.state === "running"
        ) &&
        state.operations.some(
          (operation) =>
            operation.kind === "unstage" &&
            operation.state === "queued"
        )
    );

    expect(pending.snapshots[0]).toMatchObject({
      head: "cached",
      refreshPending: true
    });
    expect(order).toEqual([
      "first-start:C:\\root\\repository-0"
    ]);

    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([
      first,
      second
    ]);
    const completed = await runtime.getState();

    expect(firstResult.result).toBe("first-result");
    expect(secondResult.result).toBe("second-result");
    expect(order).toEqual([
      "first-start:C:\\root\\repository-0",
      "first-end",
      "second-start:C:\\root\\repository-0",
      "second-end"
    ]);
    expect(
      completed.operations
        .filter(
          (operation) =>
            operation.kind === "stage" ||
            operation.kind === "unstage"
        )
        .map((operation) => operation.state)
    ).toEqual(["succeeded", "succeeded"]);
    expect(completed.snapshots[0]).toMatchObject({
      refreshPending: false,
      stale: false
    });
    expect(gitClient.calls).toHaveLength(2);
    await runtime.dispose();
  });

  it("refreshes repository state after a failed mutation", async () => {
    const workspace = createWorkspace(1);
    const target =
      workspace.selectedTarget as RepositoryTarget;
    const gitClient = new TrackingGitClient();
    const runtime = new WorkspaceRuntimeService(
      new FakeConfiguration(workspace),
      gitClient,
      new MemorySnapshotStore([
        createCachedSnapshot(target)
      ]),
      new FakeWatcher(),
      {
        autoRefresh: false,
        clock: () => "2026-09-04T12:00:00.000Z"
      }
    );
    await runtime.getState();

    await expect(
      runtime.runWorktreeMutation(
        target,
        "commit",
        async () => {
          throw new Error("Commit hook rejected the message.");
        }
      )
    ).rejects.toThrow("Commit hook rejected the message.");

    const completed = await runtime.getState();
    expect(completed.operations[0]).toMatchObject({
      kind: "commit",
      state: "failed",
      failed: 1
    });
    expect(completed.snapshots[0]).toMatchObject({
      refreshPending: false,
      stale: false
    });
    expect(gitClient.calls).toHaveLength(1);
    await runtime.dispose();
  });

  it("queues repository operations behind local writes for the same repository", async () => {
    const workspace = createWorkspace(1);
    const target =
      workspace.selectedTarget as RepositoryTarget;
    const runtime = new WorkspaceRuntimeService(
      new FakeConfiguration(workspace),
      new TrackingGitClient(),
      new MemorySnapshotStore([
        createCachedSnapshot(target)
      ]),
      new FakeWatcher(),
      {
        autoRefresh: false,
        clock: () => "2026-09-04T12:00:00.000Z"
      }
    );
    await runtime.getState();
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const order: string[] = [];
    const write = runtime.runWorktreeMutation(
      target,
      "commit",
      async () => {
        order.push("write-start");
        await writeGate;
        order.push("write-end");
      }
    );
    const accepted = await runtime.queueRepositoryOperation(
      target,
      "fetch",
      async () => {
        order.push("fetch-start");
      }
    );

    await waitForState(
      runtime,
      (state) =>
        state.operations.some(
          (operation) =>
            operation.id === accepted.operationId &&
            operation.state === "queued"
        )
    );
    expect(order).toEqual(["write-start"]);

    releaseWrite();
    await write;
    const completed = await waitForState(
      runtime,
      (state) =>
        state.operations.some(
          (operation) =>
            operation.id === accepted.operationId &&
            operation.state === "succeeded"
        )
    );

    expect(order).toEqual([
      "write-start",
      "write-end",
      "fetch-start"
    ]);
    expect(
      completed.operations.find(
        (operation) => operation.id === accepted.operationId
      )
    ).toMatchObject({
      kind: "fetch",
      scope: "repository",
      state: "succeeded"
    });
    await runtime.dispose();
  });

  it("rescans topology after a successful worktree operation and refreshes the new targets", async () => {
    const workspace = createWorkspace(1);
    const rescannedWorkspace =
      addLinkedWorktree(workspace);
    const target =
      workspace.selectedTarget as RepositoryTarget;
    const configuration = new FakeConfiguration(workspace);
    configuration.nextRescanWorkspace =
      rescannedWorkspace;
    const gitClient = new TrackingGitClient();
    const runtime = new WorkspaceRuntimeService(
      configuration,
      gitClient,
      new MemorySnapshotStore(),
      new FakeWatcher(),
      {
        autoRefresh: false,
        clock: () => "2026-09-04T12:00:00.000Z"
      }
    );

    const accepted = await runtime.queueRepositoryOperation(
      target,
      "worktree-create",
      async () => undefined,
      { refreshTopology: true }
    );
    const completed = await waitForState(
      runtime,
      (state) =>
        state.operations.some(
          (operation) =>
            operation.id === accepted.operationId &&
            operation.state === "succeeded"
        )
    );
    const operation = completed.operations.find(
      (candidate) =>
        candidate.id === accepted.operationId
    );

    expect(configuration.rescanCount).toBe(1);
    expect(completed.workspace.worktrees).toHaveLength(2);
    expect(completed.snapshots).toHaveLength(2);
    expect(operation).toMatchObject({
      kind: "worktree-create",
      state: "succeeded",
      succeeded: 1
    });
    expect(operation?.targetIds).toEqual(
      expect.arrayContaining([
        "repository-0:worktree-0",
        "repository-0:worktree-linked"
      ])
    );
    await runtime.dispose();
  });

  it("keeps a successful Git result successful when topology rescan reports a warning", async () => {
    const workspace = createWorkspace(1);
    const target =
      workspace.selectedTarget as RepositoryTarget;
    const configuration = new FakeConfiguration(workspace);
    configuration.rescanError = new Error(
      "Topology store unavailable."
    );
    const runtime = new WorkspaceRuntimeService(
      configuration,
      new TrackingGitClient(),
      new MemorySnapshotStore(),
      new FakeWatcher(),
      {
        autoRefresh: false,
        clock: () => "2026-09-04T12:00:00.000Z"
      }
    );

    const accepted = await runtime.queueRepositoryOperation(
      target,
      "worktree-move",
      async () => undefined,
      { refreshTopology: true }
    );
    const completed = await waitForState(
      runtime,
      (state) =>
        state.operations.some(
          (operation) =>
            operation.id === accepted.operationId &&
            operation.state === "succeeded"
        )
    );

    expect(configuration.rescanCount).toBe(1);
    expect(
      completed.operations.find(
        (operation) =>
          operation.id === accepted.operationId
      )
    ).toMatchObject({
      state: "succeeded",
      succeeded: 1,
      failed: 0,
      message: expect.stringContaining(
        "拓扑刷新有警告"
      )
    });
    await runtime.dispose();
  });

  it("still rescans topology after a worktree command fails because Git may have partially changed it", async () => {
    const workspace = createWorkspace(1);
    const rescannedWorkspace =
      addLinkedWorktree(workspace);
    const target =
      workspace.selectedTarget as RepositoryTarget;
    const configuration = new FakeConfiguration(workspace);
    configuration.nextRescanWorkspace =
      rescannedWorkspace;
    const runtime = new WorkspaceRuntimeService(
      configuration,
      new TrackingGitClient(),
      new MemorySnapshotStore(),
      new FakeWatcher(),
      {
        autoRefresh: false,
        clock: () => "2026-09-04T12:00:00.000Z"
      }
    );

    const accepted = await runtime.queueRepositoryOperation(
      target,
      "worktree-remove",
      async () => {
        throw new GitError(
          "COMMAND_FAILED",
          "Worktree removal stopped after updating metadata."
        );
      },
      { refreshTopology: true }
    );
    const completed = await waitForState(
      runtime,
      (state) =>
        state.operations.some(
          (operation) =>
            operation.id === accepted.operationId &&
            operation.state === "failed"
        )
    );

    expect(configuration.rescanCount).toBe(1);
    expect(completed.workspace.worktrees).toHaveLength(2);
    expect(
      completed.operations.find(
        (operation) =>
          operation.id === accepted.operationId
      )
    ).toMatchObject({
      state: "failed",
      failed: 1
    });
    await runtime.dispose();
  });

  it("cancels a running repository operation through its AbortSignal", async () => {
    const workspace = createWorkspace(1);
    const target =
      workspace.selectedTarget as RepositoryTarget;
    const runtime = new WorkspaceRuntimeService(
      new FakeConfiguration(workspace),
      new TrackingGitClient(),
      new MemorySnapshotStore([
        createCachedSnapshot(target)
      ]),
      new FakeWatcher(),
      {
        autoRefresh: false,
        clock: () => "2026-09-04T12:00:00.000Z"
      }
    );
    await runtime.getState();
    const accepted = await runtime.queueRepositoryOperation(
      target,
      "push",
      async (_path, signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () =>
              reject(
                new GitError(
                  "COMMAND_CANCELLED",
                  "Push cancelled."
                )
              ),
            { once: true }
          );
        })
    );

    await waitForState(
      runtime,
      (state) =>
        state.operations.some(
          (operation) =>
            operation.id === accepted.operationId &&
            operation.state === "running"
        )
    );
    await runtime.cancelOperation(accepted.operationId);
    const completed = await waitForState(
      runtime,
      (state) =>
        state.operations.some(
          (operation) =>
            operation.id === accepted.operationId &&
            operation.state === "cancelled"
        )
    );

    expect(
      completed.operations.find(
        (operation) => operation.id === accepted.operationId
      )
    ).toMatchObject({
      state: "cancelled",
      failed: 0,
      progress: 1
    });
    expect(completed.snapshots[0]).toMatchObject({
      refreshPending: false,
      stale: false
    });
    await runtime.dispose();
  });
});

class FakeConfiguration implements WorkspaceConfigurationService {
  #workspace: Workspace;
  rescanCount = 0;
  nextRescanWorkspace: Workspace | undefined;
  rescanError: Error | undefined;

  constructor(workspace: Workspace) {
    this.#workspace = structuredClone(workspace);
  }

  async getCurrent(): Promise<Workspace> {
    return structuredClone(this.#workspace);
  }

  async addEntry(): Promise<never> {
    throw new Error("Not used.");
  }

  async rescan(): Promise<Workspace> {
    this.rescanCount += 1;
    if (this.rescanError) {
      throw this.rescanError;
    }
    if (this.nextRescanWorkspace) {
      this.#workspace = structuredClone(
        this.nextRescanWorkspace
      );
    }
    return structuredClone(this.#workspace);
  }

  async updateEntry(): Promise<Workspace> {
    return structuredClone(this.#workspace);
  }

  async setGroupCollapsed(): Promise<Workspace> {
    return structuredClone(this.#workspace);
  }

  async selectEntry(): Promise<Workspace> {
    return structuredClone(this.#workspace);
  }

  async selectTarget(
    target: RepositoryTarget
  ): Promise<Workspace> {
    this.#workspace = {
      ...this.#workspace,
      selectedTarget: target
    };
    return structuredClone(this.#workspace);
  }
}

class TrackingGitClient implements GitClient {
  active = 0;
  maxActive = 0;
  calls: string[] = [];

  async getEnvironment(
    _options?: GitReadOptions
  ): Promise<GitEnvironment> {
    throw new Error("Not used.");
  }

  async readRepositorySnapshot(
    path: string
  ): Promise<RepositorySnapshot> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.calls.push(path);
    await new Promise((resolve) => setTimeout(resolve, 25));
    this.active -= 1;
    return {
      branch: "main",
      head: path,
      ahead: 0,
      behind: 0,
      staged: path.endsWith("1") ? 1 : 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
      changes: [],
      refreshedAt: "2026-09-04T12:00:00.000Z"
    };
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

  async readBranches(): Promise<never> {
    throw new Error("Not used.");
  }

  async inspectRepository(
    _path: string,
    _options?: InspectRepositoryOptions
  ): Promise<RepositoryInspection> {
    throw new Error("Not used.");
  }
}

class MemorySnapshotStore implements RepositorySnapshotStore {
  readonly #initial: RepositoryStatusSnapshot[];
  saved: RepositoryStatusSnapshot[] = [];

  constructor(initial: RepositoryStatusSnapshot[] = []) {
    this.#initial = structuredClone(initial);
  }

  async load(): Promise<RepositoryStatusSnapshot[]> {
    return structuredClone(this.#initial);
  }

  async save(
    _workspaceId: string,
    snapshots: RepositoryStatusSnapshot[]
  ): Promise<void> {
    this.saved = structuredClone(snapshots);
  }
}

class MemoryOperationStore
  implements WorkspaceOperationStore
{
  readonly #initial: WorkspaceOperation[];
  saved: WorkspaceOperation[] = [];

  constructor(initial: WorkspaceOperation[] = []) {
    this.#initial = structuredClone(initial);
  }

  async load(): Promise<WorkspaceOperation[]> {
    return structuredClone(this.#initial);
  }

  async save(
    _workspaceId: string,
    operations: WorkspaceOperation[]
  ): Promise<void> {
    this.saved = structuredClone(operations);
  }
}

class FakeWatcher implements WorkspaceWatcher {
  #registrations: WorkspaceWatchRegistration[] = [];
  #onChange:
    | ((event: WorkspaceWatchEvent) => void)
    | undefined;

  async watch(
    registrations: WorkspaceWatchRegistration[],
    onChange: (event: WorkspaceWatchEvent) => void
  ): Promise<WorkspaceWatchHandle> {
    this.#registrations = registrations;
    this.#onChange = onChange;
    return {
      close: () => {
        this.#registrations = [];
        this.#onChange = undefined;
      }
    };
  }

  emit(target: RepositoryTarget): void {
    const registration = this.#registrations.find(
      (candidate) =>
        candidate.target.repositoryId === target.repositoryId &&
        candidate.target.worktreeId === target.worktreeId
    );

    if (registration) {
      this.#onChange?.({
        path: registration.path,
        target
      });
    }
  }
}

class FailingWatcher implements WorkspaceWatcher {
  async watch(): Promise<WorkspaceWatchHandle> {
    throw new Error("Watcher unavailable.");
  }
}

function createWorkspace(count: number): Workspace {
  const targets = Array.from({ length: count }, (_, index) => ({
    repositoryId: `repository-${index}`,
    worktreeId: `worktree-${index}`
  }));
  return {
    schemaVersion: 1,
    id: "workspace",
    name: "Workspace",
    entries: [
      {
        id: "entry",
        displayName: "Root",
        path: "C:\\root",
        canonicalPath: "c:\\root",
        excludes: [],
        order: 0,
        kind: "workspace-directory",
        groups: [
          {
            id: "group",
            name: "根目录仓库",
            targets,
            collapsed: false
          }
        ],
        scanIssues: [],
        lastScannedAt: "2026-09-04T11:00:00.000Z"
      }
    ],
    repositories: targets.map((target, index) => ({
      id: target.repositoryId,
      name: `repository-${index}`,
      commonDir: `C:\\root\\repository-${index}\\.git`,
      canonicalCommonDir: `c:\\root\\repository-${index}\\.git`,
      primaryWorktreeId: target.worktreeId,
      worktreeIds: [target.worktreeId]
    })),
    worktrees: targets.map((target, index) => ({
      id: target.worktreeId,
      repositoryId: target.repositoryId,
      name: `repository-${index}`,
      path: `C:\\root\\repository-${index}`,
      canonicalPath: `c:\\root\\repository-${index}`,
      gitDir: `C:\\root\\repository-${index}\\.git`,
      head: `head-${index}`,
      branch: "main",
      isPrimary: true,
      isBare: false,
      isDetached: false,
      isLocked: false,
      isPrunable: false
    })),
    selectedEntryId: "entry",
    selectedTarget: targets[0] as RepositoryTarget,
    updatedAt: "2026-09-04T11:00:00.000Z"
  };
}

function addLinkedWorktree(workspace: Workspace): Workspace {
  const copy = structuredClone(workspace);
  const repository = copy.repositories[0];
  const entry = copy.entries[0];
  const target: RepositoryTarget = {
    repositoryId: "repository-0",
    worktreeId: "worktree-linked"
  };

  if (!repository || !entry) {
    throw new Error("Workspace fixture is incomplete.");
  }
  repository.worktreeIds.push(target.worktreeId);
  entry.groups[0]?.targets.push(target);
  copy.worktrees.push({
    id: target.worktreeId,
    repositoryId: target.repositoryId,
    name: "repository-0-linked",
    path: "C:\\root\\repository-0-linked",
    canonicalPath: "c:\\root\\repository-0-linked",
    gitDir:
      "C:\\root\\repository-0\\.git\\worktrees\\repository-0-linked",
    head: "head-linked",
    branch: "feature/linked",
    isPrimary: false,
    isBare: false,
    isDetached: false,
    isLocked: false,
    isPrunable: false
  });
  return copy;
}

function createCachedSnapshot(
  target: RepositoryTarget
): RepositoryStatusSnapshot {
  return {
    ...target,
    branch: "main",
    head: "cached",
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    refreshPending: false,
    stale: false,
    refreshedAt: "2026-09-04T11:59:00.000Z"
  };
}

async function waitForState(
  runtime: WorkspaceRuntimeService,
  predicate: (state: WorkspaceRuntimeState) => boolean
): Promise<WorkspaceRuntimeState> {
  const current = await runtime.getState();
  if (predicate(current)) {
    return current;
  }

  return new Promise<WorkspaceRuntimeState>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for runtime state."));
    }, 3_000);
    const unsubscribe = runtime.subscribe((state) => {
      if (predicate(state)) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(state);
      }
    });
  });
}
