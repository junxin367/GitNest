import { describe, expect, it, vi } from "vitest";

import {
  CodeAnalysisAutoRefreshScheduler,
  CodeAnalysisPeriodicRefreshScheduler,
  analysisSelectionKey,
  shouldAutoRefresh,
  waitForAnalysisCompletion
} from "./auto-refresh";

function createScheduler(
  overrides: {
    debounceMs?: number;
    enabled?: boolean;
    run?: (signal: AbortSignal) => Promise<void>;
  } = {}
): {
  scheduler: CodeAnalysisAutoRefreshScheduler;
  run: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn(overrides.run ?? (async () => undefined));
  const scheduler = new CodeAnalysisAutoRefreshScheduler({
    debounceMs: overrides.debounceMs ?? 10,
    enabled: async () => overrides.enabled ?? true,
    run
  });
  return { scheduler, run };
}

describe("CodeAnalysisAutoRefreshScheduler", () => {
  it("collapses rapid changes into a single run", async () => {
    const { scheduler, run } = createScheduler({ debounceMs: 20 });
    for (let index = 0; index < 10; index += 1) {
      scheduler.request();
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
    scheduler.dispose();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not run when the feature is disabled", async () => {
    const { scheduler, run } = createScheduler({
      debounceMs: 10,
      enabled: false
    });
    scheduler.request();
    await new Promise((resolve) => setTimeout(resolve, 60));
    scheduler.dispose();
    expect(run).not.toHaveBeenCalled();
  });

  it("drops a pending refresh when cancelled", async () => {
    const { scheduler, run } = createScheduler({ debounceMs: 40 });
    scheduler.request();
    scheduler.cancel();
    await new Promise((resolve) => setTimeout(resolve, 90));
    scheduler.dispose();
    expect(run).not.toHaveBeenCalled();
  });

  it("cancels a running wait and its trailing refresh", async () => {
    const { scheduler, run } = createScheduler({
      debounceMs: 10,
      run: (signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), {
            once: true
          });
        })
    });
    scheduler.request();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    scheduler.request();
    scheduler.cancel();
    await vi.waitFor(() => expect(scheduler.running).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it("keeps a single run in flight and re-runs once afterwards", async () => {
    let release: (() => void) | undefined;
    const { scheduler, run } = createScheduler({
      debounceMs: 10,
      run: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    });
    scheduler.request();
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledTimes(1);
    });
    // Requests arriving during the run are coalesced into one follow-up.
    scheduler.request();
    scheduler.request();
    release?.();
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledTimes(2);
    });
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 40));
    scheduler.dispose();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("applies a new debounce window from settings", async () => {
    const { scheduler, run } = createScheduler({ debounceMs: 5_000 });
    scheduler.setDebounceMs(10);
    scheduler.request();
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledTimes(1);
    });
    scheduler.dispose();
  });

  it("ignores an invalid debounce window", async () => {
    const { scheduler, run } = createScheduler({ debounceMs: 20 });
    scheduler.setDebounceMs(Number.NaN);
    scheduler.setDebounceMs(-1);
    scheduler.request();
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledTimes(1);
    });
    scheduler.dispose();
  });

  it("survives a failing run and stays usable", async () => {
    let attempt = 0;
    const run = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("analysis exploded");
      }
    });
    const scheduler = new CodeAnalysisAutoRefreshScheduler({
      debounceMs: 10,
      enabled: async () => true,
      run
    });
    scheduler.request();
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledTimes(1);
    });
    scheduler.request();
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledTimes(2);
    });
    scheduler.dispose();
  });

  it("does not schedule after dispose", async () => {
    const { scheduler, run } = createScheduler({ debounceMs: 10 });
    scheduler.dispose();
    scheduler.request();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(run).not.toHaveBeenCalled();
  });
});

describe("CodeAnalysisPeriodicRefreshScheduler", () => {
  it("runs only after the configured interval is due", async () => {
    let now = 0;
    const run = vi.fn(async () => undefined);
    const scheduler = new CodeAnalysisPeriodicRefreshScheduler({
      checkIntervalMs: 5,
      clock: () => now,
      configuration: async () => ({
        enabled: true,
        intervalMs: 100
      }),
      run
    });

    scheduler.start();
    now = 99;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(run).not.toHaveBeenCalled();

    now = 100;
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    scheduler.dispose();
  });

  it("re-reads disabled configuration before each run", async () => {
    let enabled = false;
    let now = 100;
    const run = vi.fn(async () => undefined);
    const scheduler = new CodeAnalysisPeriodicRefreshScheduler({
      checkIntervalMs: 5,
      clock: () => now,
      configuration: async () => ({
        enabled,
        intervalMs: 100
      }),
      run
    });

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(run).not.toHaveBeenCalled();

    enabled = true;
    now = 200;
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    scheduler.dispose();
  });

  it("reset aborts an active run and restarts the interval", async () => {
    let now = 0;
    let activeSignal: AbortSignal | undefined;
    const run = vi.fn(
      (signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          activeSignal = signal;
          signal.addEventListener("abort", () => resolve(), {
            once: true
          });
        })
    );
    const scheduler = new CodeAnalysisPeriodicRefreshScheduler({
      checkIntervalMs: 5,
      clock: () => now,
      configuration: async () => ({
        enabled: true,
        intervalMs: 100
      }),
      run
    });

    scheduler.start();
    now = 100;
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(scheduler.running).toBe(true);

    now = 150;
    scheduler.reset();
    expect(activeSignal?.aborted).toBe(true);
    await vi.waitFor(() => expect(scheduler.running).toBe(false));

    now = 249;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(run).toHaveBeenCalledTimes(1);

    now = 250;
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    scheduler.dispose();
  });

  it("does not schedule after dispose", async () => {
    let now = 100;
    const run = vi.fn(async () => undefined);
    const scheduler = new CodeAnalysisPeriodicRefreshScheduler({
      checkIntervalMs: 5,
      clock: () => now,
      configuration: async () => ({
        enabled: true,
        intervalMs: 100
      }),
      run
    });

    scheduler.start();
    scheduler.dispose();
    now = 1_000;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(run).not.toHaveBeenCalled();
  });
});

describe("waitForAnalysisCompletion", () => {
  it("waits for the matching analysis id to finish", async () => {
    const controller = new AbortController();
    let listener:
      | ((state: {
          state: "running" | "ready";
          analysisId: string;
          snapshotAvailable: boolean;
        }) => void)
      | undefined;
    const unsubscribe = vi.fn();
    const wait = waitForAnalysisCompletion(
      (callback) => {
        listener = callback;
        callback({
          state: "running",
          analysisId: "current",
          snapshotAvailable: false
        });
        return unsubscribe;
      },
      "current",
      controller.signal
    );
    let finished = false;
    void wait.then(() => {
      finished = true;
    });
    listener?.({
      state: "ready",
      analysisId: "other",
      snapshotAvailable: true
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    listener?.({
      state: "ready",
      analysisId: "current",
      snapshotAvailable: true
    });
    await wait;
    expect(finished).toBe(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe("analysisSelectionKey", () => {
  it("changes when the selected target changes", () => {
    const base = {
      id: "workspace-1",
      selectedTarget: {
        repositoryId: "repo-1",
        worktreeId: "worktree-1"
      }
    } as Parameters<typeof analysisSelectionKey>[0];
    const switched = {
      ...base,
      selectedTarget: {
        repositoryId: "repo-2",
        worktreeId: "worktree-2"
      }
    } as Parameters<typeof analysisSelectionKey>[0];
    expect(analysisSelectionKey(base)).not.toBe(
      analysisSelectionKey(switched)
    );
    expect(analysisSelectionKey(base)).toBe(
      analysisSelectionKey({ ...base })
    );
  });

  it("distinguishes an empty selection", () => {
    const withoutTarget = {
      id: "workspace-1"
    } as Parameters<typeof analysisSelectionKey>[0];
    expect(analysisSelectionKey(withoutTarget)).toContain("none");
  });
});

describe("shouldAutoRefresh", () => {
  const workspace = (
    overrides: Partial<{
      groups: unknown[];
      worktrees: unknown[];
    }>
  ) =>
    ({
      id: "workspace-1",
      groups: [{ id: "group-1" }],
      worktrees: [{ id: "worktree-1", isBare: false }],
      ...overrides
    }) as unknown as Parameters<typeof shouldAutoRefresh>[0];

  it("requires a workspace with targets", () => {
    expect(shouldAutoRefresh(undefined)).toBe(false);
    expect(shouldAutoRefresh(workspace({ groups: [] }))).toBe(false);
    expect(shouldAutoRefresh(workspace({ worktrees: [] }))).toBe(false);
    expect(
      shouldAutoRefresh(
        workspace({ worktrees: [{ id: "w", isBare: true }] })
      )
    ).toBe(false);
    expect(shouldAutoRefresh(workspace({}))).toBe(true);
  });
});
