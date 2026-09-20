import { describe, expect, it, vi } from "vitest";

import {
  GitError,
  type GitClient,
  type GitEnvironment,
  type GitReadOptions,
  type InspectRepositoryOptions,
  type ReadRepositorySnapshotOptions,
  type RepositoryInspection,
  type RepositorySnapshot
} from "@gitnest/git-core";
import {
  WorkspaceError,
  listWorkspaceTargets,
  type RepositorySnapshotStore,
  type RepositoryStatusSnapshot,
  type RepositoryTarget,
  type Workspace,
  type WorkspaceWatchEvent,
  type WorkspaceWatchHandle,
  type WorkspaceWatcher,
  type WorkspaceWatchRegistration
} from "@gitnest/workspace-core";

import {
  WorkspaceRuntimeService,
  type WorkspaceConfigurationService,
  type WorkspaceOperation,
  type WorkspaceOperationStore,
  type WorkspaceRefreshDiagnostic,
  type WorkspaceRuntimeState
} from "./workspace-runtime-service";
import { WorkspaceRefreshScheduler } from "./workspace-refresh-scheduler";

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
            operation.kind === "scan" &&
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
            operation.kind === "scan" &&
            operation.state === "succeeded"
        )
    );

    expect(completed.snapshots).toHaveLength(6);
    expect(gitClient.maxActive).toBeLessThanOrEqual(4);
    expect(gitClient.calls).toHaveLength(7);
    expect(snapshotStore.saved).toHaveLength(6);
    expect(
      completed.operations.filter(
        (operation) => operation.kind === "status"
      )
    ).toHaveLength(0);

    unsubscribeThrowingListener();
    await runtime.dispose();
  });

  it("switches one active Workspace at a time and restores isolated snapshots and operation history", async () => {
    const first = createWorkspace(1);
    first.id = "workspace_first";
    first.name = "First Workspace";
    const second = structuredClone(first);
    second.id = "workspace_second";
    second.name = "Second Workspace";
    second.entries[0] = {
      ...(second.entries[0] as Workspace["entries"][number]),
      path: "C:\\second",
      canonicalPath: "c:\\second"
    };
    second.worktrees[0] = {
      ...(second.worktrees[0] as Workspace["worktrees"][number]),
      path: "C:\\second\\repository-0",
      canonicalPath: "c:\\second\\repository-0",
      head: "second-head"
    };
    const target = first.selectedTarget as RepositoryTarget;
    const snapshotStore =
      new WorkspaceScopedMemorySnapshotStore({
        workspace_first: [
          {
            ...createCachedSnapshot(target),
            head: "first-cache"
          }
        ],
        workspace_second: [
          {
            ...createCachedSnapshot(target),
            head: "second-cache"
          }
        ]
      });
    const operationStore =
      new WorkspaceScopedMemoryOperationStore({
        workspace_first: [
          completedOperation("operation_first")
        ],
        workspace_second: [
          completedOperation("operation_second")
        ]
      });
    const watcher = new FakeWatcher();
    const runtime = new WorkspaceRuntimeService(
      new SwitchingConfiguration([first, second]),
      new TrackingGitClient(),
      snapshotStore,
      watcher,
      {
        autoRefresh: false,
        operationStore
      }
    );

    const initial = await runtime.getState();
    expect(initial.workspaces.map(({ id }) => id)).toEqual([
      "workspace_first",
      "workspace_second"
    ]);
    expect(initial.snapshots[0]?.head).toBe("first-cache");
    expect(initial.operations[0]?.id).toBe("operation_first");

    const switched = await runtime.switchWorkspace(
      "workspace_second"
    );
    expect(switched.workspace.id).toBe("workspace_second");
    expect(switched.snapshots[0]?.head).toBe("second-cache");
    expect(switched.operations[0]?.id).toBe(
      "operation_second"
    );
    expect(
      watcher.registrations.map(({ path }) => path)
    ).toContain("C:\\second\\repository-0");

    const restored = await runtime.switchWorkspace(
      "workspace_first"
    );
    expect(restored.snapshots[0]?.head).toBe("first-cache");
    expect(restored.operations[0]?.id).toBe(
      "operation_first"
    );
    await runtime.dispose();
  });

  it("switches without waiting for superseded background status reads", async () => {
    const first = createWorkspace(2);
    first.id = "workspace_first";
    first.name = "First Workspace";
    const second = structuredClone(first);
    second.id = "workspace_second";
    second.name = "Second Workspace";
    second.entries[0] = {
      ...(second.entries[0] as Workspace["entries"][number]),
      path: "C:\\second",
      canonicalPath: "c:\\second"
    };
    second.worktrees = second.worktrees.map(
      (worktree, index) => ({
        ...worktree,
        path: `C:\\second\\repository-${index}`,
        canonicalPath: `c:\\second\\repository-${index}`,
        head: `second-head-${index}`
      })
    );
    let releaseRead: () => void = () => undefined;
    const readBlocked = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const observedSignals: AbortSignal[] = [];
    const gitClient = new TrackingGitClient(
      (_callIndex, _path, options) => {
        if (options?.signal) {
          observedSignals.push(options.signal);
        }
        return readBlocked;
      }
    );
    const runtime = new WorkspaceRuntimeService(
      new SwitchingConfiguration([first, second]),
      gitClient,
      new WorkspaceScopedMemorySnapshotStore({}),
      new FakeWatcher(),
      { autoRefresh: false }
    );

    await runtime.getState();
    await runtime.rescan();
    await waitForCondition(() => gitClient.calls.length > 0);

    let switched: WorkspaceRuntimeState;
    try {
      switched = await resolveWithin(
        runtime.switchWorkspace("workspace_second"),
        500
      );
    } finally {
      releaseRead();
    }

    expect(switched.workspace.id).toBe("workspace_second");
    expect(observedSignals.length).toBeGreaterThan(0);
    expect(
      observedSignals.every((signal) => signal.aborted)
    ).toBe(true);
    await waitForCondition(() => gitClient.active === 0);
    const settled = await runtime.getState();
    expect(settled.workspace.id).toBe("workspace_second");
    expect(settled.snapshots).toEqual([]);
    await runtime.dispose();
  });

  it("cancels the startup topology scan before switching Workspace", async () => {
    const first = createWorkspace(1);
    first.id = "workspace_first";
    const second = structuredClone(first);
    second.id = "workspace_second";
    second.name = "Second Workspace";
    const configuration =
      new BlockingStartupSwitchingConfiguration([
        first,
        second
      ]);
    const runtime = new WorkspaceRuntimeService(
      configuration,
      new TrackingGitClient(),
      new WorkspaceScopedMemorySnapshotStore({}),
      new FakeWatcher(),
      { autoRefresh: true }
    );

    await runtime.getState();
    await waitForCondition(
      () => configuration.rescanStarted
    );
    const switched = await resolveWithin(
      runtime.switchWorkspace("workspace_second"),
      500
    );

    expect(configuration.rescanAborted).toBe(true);
    expect(switched.workspace.id).toBe("workspace_second");
    await runtime.dispose();
  });

  it("keeps no-op heartbeat content versions stable and advances them for watcher changes", async () => {
    const workspace = createWorkspace(1);
    const target =
      workspace.selectedTarget as RepositoryTarget;
    const gitClient = new TrackingGitClient();
    const watcher = new FakeWatcher();
    let now = "2026-09-17T12:00:00.000Z";
    const runtime = new WorkspaceRuntimeService(
      new FakeConfiguration(workspace),
      gitClient,
      new MemorySnapshotStore(),
      watcher,
      {
        autoRefresh: false,
        currentTargetDebounceMs: 1,
        selectedTargetHeartbeatIntervalMs: 40,
        staleAfterMs: 1,
        clock: () => now
      }
    );

    await runtime.requestWorkspaceRefresh("manual");
    const initial = await waitForState(
      runtime,
      (state) =>
        state.monitor.mode === "watching" &&
        state.snapshots[0]?.contentVersion === 1 &&
        state.operations.some(
          (operation) =>
            operation.kind === "scan" &&
            operation.state === "succeeded"
        )
    );
    const initialOperationIds = initial.operations.map(
      (operation) => operation.id
    );

    now = "2026-09-17T12:01:00.000Z";
    const heartbeat = await waitForState(
      runtime,
      (state) =>
        gitClient.calls.length >= 2 &&
        !state.snapshots[0]?.refreshPending
    );

    expect(heartbeat.snapshots[0]?.contentVersion).toBe(1);
    expect(
      heartbeat.operations.map((operation) => operation.id)
    ).toEqual(initialOperationIds);

    now = "2026-09-17T12:00:00.000Z";
    watcher.emit(target);
    const watched = await waitForState(
      runtime,
      (state) =>
        state.snapshots[0]?.contentVersion === 2
    );

    expect(watched.snapshots[0]?.contentVersion).toBe(2);
    expect(
      watched.operations.map((operation) => operation.id)
    ).toEqual(initialOperationIds);
    await runtime.dispose();
  });

  it("deduplicates nested Git watches, routes linked metadata, and ignores transient Git locks", async () => {
    const workspace = addLinkedWorktree(createWorkspace(1));
    const gitClient = new TrackingGitClient();
    const watcher = new FakeWatcher();
    const runtime = new WorkspaceRuntimeService(
      new FakeConfiguration(workspace),
      gitClient,
      new MemorySnapshotStore(),
      watcher,
      {
        autoRefresh: false,
        currentTargetDebounceMs: 1,
        backgroundTargetDebounceMs: 1,
        selectedTargetPollingIntervalMs: 0
      }
    );

    await runtime.requestWorkspaceRefresh("manual");
    await waitForState(
      runtime,
      (state) =>
        state.monitor.mode === "watching" &&
        state.operations.some(
          (operation) =>
            operation.kind === "scan" &&
            operation.state === "succeeded"
        )
    );

    expect(
      watcher.registrations.map(({ path }) => path).sort()
    ).toEqual(
      [
        "C:\\root\\repository-0",
        "C:\\root\\repository-0-linked"
      ].sort()
    );

    gitClient.calls.length = 0;
    const primary = workspace.selectedTarget as RepositoryTarget;
    const linkedGitDir =
      "C:\\root\\repository-0\\.git\\worktrees\\repository-0-linked";

    watcher.emitPath(`${linkedGitDir}\\index.lock`, primary);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(gitClient.calls).toHaveLength(0);

    watcher.emitPath(`${linkedGitDir}\\index`, primary);
    await waitForCondition(() => gitClient.calls.length === 1);
    expect(gitClient.calls[0]).toBe(
      "C:\\root\\repository-0-linked"
    );

    await runtime.dispose();
  });

  it("coalesces watcher events that arrive during an in-flight refresh into one trailing refresh", async () => {
    const workspace = createWorkspace(1);
    const gitClient = new TrackingGitClient();
    const watcher = new FakeWatcher();
    const runtime = new WorkspaceRuntimeService(
      new FakeConfiguration(workspace),
      gitClient,
      new MemorySnapshotStore(),
      watcher,
      {
        autoRefresh: false,
        currentTargetDebounceMs: 1,
        selectedTargetPollingIntervalMs: 0
      }
    );
    const target = workspace.selectedTarget as RepositoryTarget;

    await runtime.requestWorkspaceRefresh("manual");
    const initial = await waitForState(
      runtime,
      (state) =>
        state.monitor.mode === "watching" &&
        state.operations.some(
          (operation) =>
            operation.kind === "scan" &&
            operation.state === "succeeded"
        )
    );
    const initialOperationIds = initial.operations.map(
      (operation) => operation.id
    );
    gitClient.calls.length = 0;

    watcher.emit(target);
    await waitForCondition(() => gitClient.calls.length === 1);
    for (let index = 0; index < 6; index += 1) {
      watcher.emit(target);
    }

    await waitForCondition(() => gitClient.calls.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const completed = await runtime.getState();

    expect(gitClient.calls).toHaveLength(2);
    expect(
      completed.operations.map((operation) => operation.id)
    ).toEqual(initialOperationIds);
    await runtime.dispose();
  });

  it("serializes whole-snapshot persistence so an older save cannot overwrite a newer state", async () => {
    const workspace = createWorkspace(2);
    const snapshotStore = new TrackingSnapshotStore();
    const watcher = new FakeWatcher();
    const runtime = new WorkspaceRuntimeService(
      new FakeConfiguration(workspace),
      new TrackingGitClient(),
      snapshotStore,
      watcher,
      {
        autoRefresh: false,
        currentTargetDebounceMs: 1,
        backgroundTargetDebounceMs: 1,
        selectedTargetPollingIntervalMs: 0
      }
    );

    await runtime.requestWorkspaceRefresh("manual");
    await waitForState(
      runtime,
      (state) =>
        state.monitor.mode === "watching" &&
        state.operations.some(
          (operation) =>
            operation.kind === "scan" &&
            operation.state === "succeeded"
        )
    );
    snapshotStore.reset();

    const targets = listWorkspaceTargets(workspace);
    watcher.emit(targets[0] as RepositoryTarget);
    await waitForCondition(() => snapshotStore.saveCalls >= 1);
    watcher.emit(targets[1] as RepositoryTarget);
    await waitForCondition(() => snapshotStore.saveCalls >= 2);
    await runtime.dispose();

    expect(snapshotStore.maxActive).toBe(1);
  });

  it("waits for an in-flight status read before starting a mutation on the same Worktree", async () => {
    const workspace = createWorkspace(1);
    let releaseFirstRead: (() => void) | undefined;
    const firstRead = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    const gitClient = new TrackingGitClient(
      async (callIndex) => {
        if (callIndex === 0) {
          await firstRead;
        }
      }
    );
    const runtime = new WorkspaceRuntimeService(
      new FakeConfiguration(workspace),
      gitClient,
      new MemorySnapshotStore(),
      new FakeWatcher(),
      {
        autoRefresh: false,
        selectedTargetPollingIntervalMs: 0
      }
    );
    const target = workspace.selectedTarget as RepositoryTarget;

    await runtime.requestWorkspaceRefresh("manual");
    await waitForCondition(() => gitClient.calls.length === 1);
    let mutationStarted = false;
    const mutation = runtime.runWorktreeMutation(
      target,
      "stage",
      async () => {
        mutationStarted = true;
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mutationStarted).toBe(false);
    releaseFirstRead?.();
    await mutation;
    expect(mutationStarted).toBe(true);
    await runtime.dispose();
  });

  it("closes a stale watcher when a newer monitoring restart wins the race", async () => {
    const workspace = createWorkspace(1);
    const watcher = new RacingWatcher();
    const runtime = new WorkspaceRuntimeService(
      new FakeConfiguration(workspace),
      new TrackingGitClient(),
      new MemorySnapshotStore(),
      watcher,
      {
        autoRefresh: false,
        selectedTargetPollingIntervalMs: 0
      }
    );

    await runtime.rescan();
    await waitForCondition(() => watcher.watchCalls === 1);
    await runtime.rescan();
    await waitForCondition(
      () => watcher.watchCalls === 2 && watcher.activeHandles === 1
    );
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(watcher.activeHandles).toBe(1);
    expect(watcher.closedHandles).toBe(1);
    await runtime.dispose();
    expect(watcher.activeHandles).toBe(0);
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
      },
      {
        id: "operation_5_20260904095900000",
        kind: "status",
        scope: "workspace",
        targetIds: ["repository-0:worktree-0"],
        state: "succeeded",
        progress: 1,
        succeeded: 1,
        failed: 0,
        message: "Legacy automatic refresh.",
        finishedAt: "2026-09-04T09:59:00.000Z"
      },
      {
        id: "operation_4_20260904095800000",
        kind: "status",
        scope: "workspace",
        targetIds: ["repository-0:worktree-0"],
        state: "running",
        progress: 0.5,
        succeeded: 0,
        failed: 0,
        message: "Legacy running refresh.",
        startedAt: "2026-09-04T09:58:00.000Z"
      },
      {
        id: "operation_3_20260904095700000",
        kind: "status",
        scope: "workspace",
        targetIds: ["repository-0:worktree-0"],
        state: "failed",
        progress: 1,
        succeeded: 0,
        failed: 1,
        message: "Legacy refresh failure.",
        finishedAt: "2026-09-04T09:57:00.000Z"
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
    expect(state.operations[2]).toMatchObject({
      kind: "status",
      state: "failed",
      message: "Legacy refresh failure."
    });
    expect(state.operations).toHaveLength(3);

    await runtime.dispose();
    expect(operationStore.saved).toHaveLength(3);
    expect(operationStore.saved[0]).toMatchObject({
      state: "interrupted"
    });
    expect(
      operationStore.saved.some(
        (operation) =>
          operation.kind === "status" &&
          operation.state === "succeeded"
      )
    ).toBe(false);
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
    const diagnostics: WorkspaceRefreshDiagnostic[] = [];
    const runtime = new WorkspaceRuntimeService(
      new FakeConfiguration(workspace),
      new TrackingGitClient(),
      new MemorySnapshotStore(),
      new FailingWatcher(),
      {
        autoRefresh: false,
        pollingIntervalMs: 60_000,
        onDiagnostic: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
        clock: () => "2026-09-04T12:00:00.000Z"
      }
    );

    await runtime.requestWorkspaceRefresh("manual");
    const state = await waitForState(
      runtime,
      (candidate) => candidate.monitor.mode === "polling"
    );

    expect(state.monitor.message).toContain("已降级为低频轮询");
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        name: "workspace.monitor-fallback",
        level: "warning",
        context: expect.objectContaining({
          monitorMode: "polling",
          activeTargetCount: 1
        })
      })
    );
    expect(JSON.stringify(diagnostics)).not.toContain(
      "repository-0"
    );
    await runtime.dispose();
  });

  it("polls selected, selected-entry, and background targets on separate distributed schedules", async () => {
    vi.useFakeTimers();
    const workspace = createWorkspaceWithBackgroundEntry();
    const selected =
      workspace.selectedTarget as RepositoryTarget;
    const selectedEntryTarget =
      workspace.entries[0]?.groups[0]?.targets[1] as RepositoryTarget;
    const backgroundTarget =
      workspace.entries[1]?.groups[0]?.targets[0] as RepositoryTarget;
    const startedAt = Date.now();
    const calls: Array<{
      at: number;
      target: RepositoryTarget;
    }> = [];
    const scheduler = new WorkspaceRefreshScheduler({
      selectedDebounceMs: 1,
      backgroundDebounceMs: 1,
      selectedMinIntervalMs: 1,
      backgroundMinIntervalMs: 1,
      heartbeatIntervalMs: 0,
      selectedPollingIntervalMs: 30,
      selectedEntryPollingIntervalMs: 70,
      backgroundPollingIntervalMs: 140,
      clock: () => "2026-09-20T12:00:00.000Z",
      isStale: () => true,
      execute: async (requests) => {
        for (const request of requests) {
          calls.push({
            at: Date.now() - startedAt,
            target: request.target
          });
        }
        return {
          requested: requests.length,
          succeeded: requests.length,
          failed: 0,
          changed: 0,
          failures: []
        };
      }
    });

    scheduler.updateWorkspace(workspace);
    scheduler.activatePolling();
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(calls[0]?.target).toEqual(selected);
      expect(calls).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(70);
      const selectedEntryCall = calls.find((call) =>
        repositoryTargetsMatch(
          call.target,
          selectedEntryTarget
        )
      );
      expect(selectedEntryCall?.at).toBe(70);

      await vi.advanceTimersByTimeAsync(70);
      const backgroundCall = calls.find((call) =>
        repositoryTargetsMatch(
          call.target,
          backgroundTarget
        )
      );
      expect(backgroundCall?.at).toBe(140);
      expect(backgroundCall?.at).toBeGreaterThan(
        selectedEntryCall?.at ?? 0
      );
    } finally {
      scheduler.dispose();
      vi.useRealTimers();
    }
  });

  it("pauses watcher heartbeat in the background and checks the selected target on return", async () => {
    vi.useFakeTimers();
    const workspace = createWorkspace(1);
    const reasons: string[] = [];
    const scheduler = new WorkspaceRefreshScheduler({
      selectedDebounceMs: 1,
      backgroundDebounceMs: 1,
      selectedMinIntervalMs: 1,
      backgroundMinIntervalMs: 1,
      heartbeatIntervalMs: 20,
      selectedPollingIntervalMs: 30,
      selectedEntryPollingIntervalMs: 70,
      backgroundPollingIntervalMs: 140,
      clock: () => "2026-09-20T12:00:00.000Z",
      isStale: () => true,
      execute: async (requests) => {
        reasons.push(...requests.map((request) => request.reason));
        return {
          requested: requests.length,
          succeeded: requests.length,
          failed: 0,
          changed: 0,
          failures: []
        };
      }
    });

    scheduler.updateWorkspace(workspace);
    scheduler.activateWatching();
    try {
      scheduler.setForeground(false);
      await vi.advanceTimersByTimeAsync(60);
      expect(reasons).toHaveLength(0);

      scheduler.setForeground(true);
      scheduler.requestSelectedIfStale("focus");
      await vi.advanceTimersByTimeAsync(0);
      expect(reasons).toEqual(["focus"]);

      await vi.advanceTimersByTimeAsync(21);
      expect(reasons).toEqual(["focus", "heartbeat"]);
    } finally {
      scheduler.dispose();
      vi.useRealTimers();
    }
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
        state.monitor.mode === "watching" &&
        state.snapshots.length === 1 &&
        state.snapshots.every(
          (snapshot) =>
            !snapshot.stale && !snapshot.refreshPending
        )
    );

    expect(configuration.rescanCount).toBe(1);
    expect(completed.operations).toHaveLength(0);
    await runtime.dispose();
  });

  it("refreshes only a stale selected target on focus without adding operation history", async () => {
    const workspace = createWorkspace(3);
    const gitClient = new TrackingGitClient();
    let now = "2026-09-04T12:00:00.000Z";
    const runtime = new WorkspaceRuntimeService(
      new FakeConfiguration(workspace),
      gitClient,
      new MemorySnapshotStore(),
      new FakeWatcher(),
      {
        autoRefresh: false,
        selectedTargetHeartbeatIntervalMs: 0,
        clock: () => now
      }
    );

    await runtime.requestWorkspaceRefresh("manual");
    const initial = await waitForState(
      runtime,
      (state) =>
        state.operations.some(
          (operation) =>
            operation.kind === "scan" &&
            operation.state === "succeeded"
        )
    );
    const initialOperationIds = initial.operations.map(
      (operation) => operation.id
    );
    gitClient.calls.length = 0;
    now = "2026-09-04T12:01:00.000Z";

    await runtime.refreshStaleOnFocus();
    await waitForCondition(() => gitClient.calls.length === 1);
    const completed = await runtime.getState();

    expect(gitClient.calls).toEqual([
      "C:\\root\\repository-0"
    ]);
    expect(
      completed.operations.map((operation) => operation.id)
    ).toEqual(initialOperationIds);
    await runtime.dispose();
  });

  it("merges repeated background failures and keeps raw paths out of operation history", async () => {
    const workspace = createWorkspace(1);
    const watcher = new FakeWatcher();
    const diagnostics: WorkspaceRefreshDiagnostic[] = [];
    let failReads = false;
    const gitClient = new TrackingGitClient(async () => {
      if (failReads) {
        throw new GitError(
          "COMMAND_FAILED",
          "git status failed in C:\\Users\\secret\\repository"
        );
      }
    });
    const runtime = new WorkspaceRuntimeService(
      new FakeConfiguration(workspace),
      gitClient,
      new MemorySnapshotStore(),
      watcher,
      {
        autoRefresh: false,
        currentTargetDebounceMs: 1,
        selectedTargetHeartbeatIntervalMs: 0,
        onDiagnostic: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
        clock: () => "2026-09-04T12:00:00.000Z"
      }
    );

    await runtime.requestWorkspaceRefresh("manual");
    await waitForState(
      runtime,
      (state) =>
        state.operations.some(
          (operation) =>
            operation.kind === "scan" &&
            operation.state === "succeeded"
        )
    );
    failReads = true;
    const target = workspace.selectedTarget as RepositoryTarget;

    watcher.emit(target);
    const first = await waitForState(
      runtime,
      (state) =>
        state.operations.some(
          (operation) =>
            operation.kind === "status" &&
            operation.state === "failed"
        )
    );
    const failure = first.operations.find(
      (operation) =>
        operation.kind === "status" &&
        operation.state === "failed"
    );

    watcher.emit(target);
    await waitForCondition(() => gitClient.calls.length >= 3);
    const repeated = await runtime.getState();
    const failures = repeated.operations.filter(
      (operation) =>
        operation.kind === "status" &&
        operation.state === "failed"
    );

    expect(failures).toHaveLength(1);
    expect(failures[0]?.id).toBe(failure?.id);
    expect(failures[0]?.failed).toBe(1);
    expect(failures[0]?.message).not.toContain(
      "C:\\Users\\secret"
    );
    await waitForCondition(() =>
      diagnostics.some(
        (diagnostic) =>
          diagnostic.name === "workspace.refresh-failed"
      )
    );
    expect(JSON.stringify(diagnostics)).not.toContain(
      "C:\\Users\\secret"
    );
    expect(JSON.stringify(diagnostics)).not.toContain(
      "repository-0"
    );
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

  async removeEntry(): Promise<Workspace> {
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

class SwitchingConfiguration
  implements WorkspaceConfigurationService
{
  readonly #workspaces: Map<string, Workspace>;
  #activeWorkspaceId: string;

  constructor(workspaces: Workspace[]) {
    this.#workspaces = new Map(
      workspaces.map((workspace) => [
        workspace.id,
        structuredClone(workspace)
      ])
    );
    this.#activeWorkspaceId =
      workspaces[0]?.id ?? "missing";
  }

  async getCurrent(): Promise<Workspace> {
    return structuredClone(this.#active());
  }

  async listWorkspaces() {
    return [...this.#workspaces.values()].map(
      ({ id, name, updatedAt }) => ({
        id,
        name,
        updatedAt
      })
    );
  }

  async switchWorkspace(
    workspaceId: string
  ): Promise<Workspace> {
    if (!this.#workspaces.has(workspaceId)) {
      throw new Error("Workspace not found.");
    }
    this.#activeWorkspaceId = workspaceId;
    return this.getCurrent();
  }

  async addEntry(): Promise<never> {
    throw new Error("Not used.");
  }

  async rescan(): Promise<Workspace> {
    return this.getCurrent();
  }

  async updateEntry(): Promise<Workspace> {
    return this.getCurrent();
  }

  async removeEntry(): Promise<Workspace> {
    return this.getCurrent();
  }

  async setGroupCollapsed(): Promise<Workspace> {
    return this.getCurrent();
  }

  async selectEntry(): Promise<Workspace> {
    return this.getCurrent();
  }

  async selectTarget(
    target: RepositoryTarget
  ): Promise<Workspace> {
    const workspace = this.#active();
    workspace.selectedTarget = target;
    return structuredClone(workspace);
  }

  #active(): Workspace {
    const workspace = this.#workspaces.get(
      this.#activeWorkspaceId
    );
    if (!workspace) {
      throw new Error("Active Workspace is unavailable.");
    }
    return workspace;
  }
}

class BlockingStartupSwitchingConfiguration
  extends SwitchingConfiguration
{
  rescanStarted = false;
  rescanAborted = false;

  override async rescan(
    signal?: AbortSignal
  ): Promise<Workspace> {
    this.rescanStarted = true;
    await new Promise<void>((_resolve, reject) => {
      const cancel = () => {
        this.rescanAborted = true;
        reject(
          new WorkspaceError(
            "SCAN_CANCELLED",
            "Workspace scan cancelled."
          )
        );
      };
      if (signal?.aborted) {
        cancel();
        return;
      }
      signal?.addEventListener("abort", cancel, {
        once: true
      });
    });
    return super.rescan();
  }
}

class TrackingGitClient implements GitClient {
  active = 0;
  maxActive = 0;
  calls: string[] = [];

  constructor(
    readonly beforeRead?: (
      callIndex: number,
      path: string,
      options?: ReadRepositorySnapshotOptions
    ) => Promise<void>
  ) {}

  async getEnvironment(
    _options?: GitReadOptions
  ): Promise<GitEnvironment> {
    throw new Error("Not used.");
  }

  async readRepositorySnapshot(
    path: string,
    options?: ReadRepositorySnapshotOptions
  ): Promise<RepositorySnapshot> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    const callIndex = this.calls.length;
    this.calls.push(path);
    try {
      await this.beforeRead?.(callIndex, path, options);
      await new Promise((resolve) => setTimeout(resolve, 25));
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
    } finally {
      this.active -= 1;
    }
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

class WorkspaceScopedMemorySnapshotStore
  implements RepositorySnapshotStore
{
  readonly #snapshots: Map<
    string,
    RepositoryStatusSnapshot[]
  >;

  constructor(
    snapshots: Record<string, RepositoryStatusSnapshot[]>
  ) {
    this.#snapshots = new Map(
      Object.entries(snapshots).map(
        ([workspaceId, values]) => [
          workspaceId,
          structuredClone(values)
        ]
      )
    );
  }

  async load(
    workspaceId: string
  ): Promise<RepositoryStatusSnapshot[]> {
    return structuredClone(
      this.#snapshots.get(workspaceId) ?? []
    );
  }

  async save(
    workspaceId: string,
    snapshots: RepositoryStatusSnapshot[]
  ): Promise<void> {
    this.#snapshots.set(
      workspaceId,
      structuredClone(snapshots)
    );
  }
}

class TrackingSnapshotStore
  implements RepositorySnapshotStore
{
  active = 0;
  maxActive = 0;
  saveCalls = 0;

  async load(): Promise<RepositoryStatusSnapshot[]> {
    return [];
  }

  async save(): Promise<void> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.saveCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    this.active -= 1;
  }

  reset(): void {
    this.active = 0;
    this.maxActive = 0;
    this.saveCalls = 0;
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

class WorkspaceScopedMemoryOperationStore
  implements WorkspaceOperationStore
{
  readonly #operations: Map<string, WorkspaceOperation[]>;

  constructor(
    operations: Record<string, WorkspaceOperation[]>
  ) {
    this.#operations = new Map(
      Object.entries(operations).map(
        ([workspaceId, values]) => [
          workspaceId,
          structuredClone(values)
        ]
      )
    );
  }

  async load(
    workspaceId: string
  ): Promise<WorkspaceOperation[]> {
    return structuredClone(
      this.#operations.get(workspaceId) ?? []
    );
  }

  async save(
    workspaceId: string,
    operations: WorkspaceOperation[]
  ): Promise<void> {
    this.#operations.set(
      workspaceId,
      structuredClone(operations)
    );
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

  get registrations(): WorkspaceWatchRegistration[] {
    return structuredClone(this.#registrations);
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

  emitPath(path: string, target: RepositoryTarget): void {
    this.#onChange?.({ path, target });
  }
}

class RacingWatcher implements WorkspaceWatcher {
  watchCalls = 0;
  activeHandles = 0;
  closedHandles = 0;

  async watch(): Promise<WorkspaceWatchHandle> {
    this.watchCalls += 1;
    const call = this.watchCalls;
    if (call === 1) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    this.activeHandles += 1;
    let closed = false;
    return {
      close: () => {
        if (!closed) {
          closed = true;
          this.activeHandles -= 1;
          this.closedHandles += 1;
        }
      }
    };
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
            name: "原/根仓库",
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

function createWorkspaceWithBackgroundEntry(): Workspace {
  const workspace = createWorkspace(3);
  const entry = workspace.entries[0];
  const group = entry?.groups[0];
  const selected = group?.targets[0];
  const selectedEntryTarget = group?.targets[1];
  const backgroundTarget = group?.targets[2];
  if (
    !entry ||
    !group ||
    !selected ||
    !selectedEntryTarget ||
    !backgroundTarget
  ) {
    throw new Error("Workspace fixture is incomplete.");
  }

  group.targets = [selected, selectedEntryTarget];
  workspace.entries.push({
    id: "entry-background",
    displayName: "Background",
    path: "C:\\background",
    canonicalPath: "c:\\background",
    excludes: [],
    order: 1,
    kind: "workspace-directory",
    groups: [
      {
        id: "group-background",
        name: "后台仓库",
        targets: [backgroundTarget],
        collapsed: false
      }
    ],
    scanIssues: [],
    lastScannedAt: "2026-09-20T11:00:00.000Z"
  });
  return workspace;
}

function repositoryTargetsMatch(
  left: RepositoryTarget,
  right: RepositoryTarget
): boolean {
  return (
    left.repositoryId === right.repositoryId &&
    left.worktreeId === right.worktreeId
  );
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

function completedOperation(id: string): WorkspaceOperation {
  return {
    id,
    kind: "scan",
    scope: "workspace",
    targetIds: [],
    state: "succeeded",
    progress: 1,
    succeeded: 1,
    failed: 0,
    message: "Workspace refreshed.",
    startedAt: "2026-09-20T11:00:00.000Z",
    finishedAt: "2026-09-20T11:01:00.000Z"
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

async function waitForCondition(
  predicate: () => boolean
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 3_000) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function resolveWithin<Result>(
  promise: Promise<Result>,
  timeoutMs: number
): Promise<Result> {
  return new Promise<Result>((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error(
            `Operation did not finish within ${timeoutMs} ms.`
          )
        ),
      timeoutMs
    );
    void promise.then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}
