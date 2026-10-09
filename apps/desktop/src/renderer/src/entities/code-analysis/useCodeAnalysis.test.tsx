/** @vitest-environment jsdom */

import { act } from "react";
import {
  createRoot,
  type Root
} from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import type {
  CodeAnalysisSnapshotDto,
  CodeAnalysisStateDto,
  GitNestBridge
} from "@gitnest/contracts";

import {
  useCodeAnalysis,
  type CodeAnalysisController
} from "./useCodeAnalysis";
import { AnalysisPageHost } from "../../app/AnalysisPageHost";

describe("useCodeAnalysis snapshot synchronization", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: CodeAnalysisController | undefined;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("immediately restores a visited page while revalidating, without rereading an unchanged full graph", async () => {
    const ready = readyState("retained", "2026-10-09T03:00:00.000Z");
    const revalidation = deferred<Awaited<ReturnType<GitNestBridge["codeAnalysis"]["getState"]>>>();
    const unsubscribe = vi.fn();
    const getState = vi.fn<GitNestBridge["codeAnalysis"]["getState"]>()
      .mockResolvedValueOnce({ ok: true, value: ready })
      .mockImplementationOnce(() => revalidation.promise);
    const getSnapshot = vi.fn(async () => ({
      ok: true as const, value: { ...snapshotFor(ready), detailLevel: "full" as const }
    }));
    installBridge({ getState, getSnapshot, onStateChanged: vi.fn(() => unsubscribe) });
    function Content() {
      controller = useCodeAnalysis();
      return <section>{controller.snapshot?.analysisId ?? "no content"}</section>;
    }
    const render = async (active: boolean) => {
      await act(async () => {
        root.render(<AnalysisPageHost active={active} workspace={null}><Content /></AnalysisPageHost>);
        await flushAsyncWork();
      });
    };
    await render(false);
    expect(getState).not.toHaveBeenCalled();
    await render(true);
    const original = container.querySelector("section")!;
    const snapshot = controller?.snapshot;
    expect(original.textContent).toBe("retained");
    await render(false);
    expect(original.style.display).toBe("none");
    expect(unsubscribe).toHaveBeenCalledOnce();
    await render(true);
    expect(container.querySelector("section")).toBe(original);
    expect(original.style.display).not.toBe("none");
    expect(original.textContent).toBe("retained");
    expect(controller?.snapshot).toBe(snapshot);
    expect(controller?.loading).toBe(true);
    await act(async () => {
      revalidation.resolve({ ok: true, value: ready });
      await flushAsyncWork();
    });
    expect(controller?.loading).toBe(false);
    expect(controller?.snapshot).toBe(snapshot);
    expect(controller?.snapshotDetail).toBe("full");
    expect(getSnapshot).toHaveBeenCalledOnce();
  });

  it("keeps navigation visible and ignores an older node query finishing after a newer query", async () => {
    const ready = readyState("nodes", "2026-10-09T03:00:00.000Z");
    const first = deferredSnapshot();
    const second = deferredSnapshot();
    const navigation = { ...snapshotFor(ready), detailLevel: "navigation" as const };
    const getSnapshot = vi.fn<GitNestBridge["codeAnalysis"]["getSnapshot"]>()
      .mockResolvedValueOnce({ ok: true, value: navigation })
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    installBridge({
      getState: vi.fn(async () => ({ ok: true as const, value: ready })),
      getSnapshot, onStateChanged: vi.fn(() => vi.fn())
    });
    await act(async () => {
      root.render(<Harness onChange={value => { controller = value; }} />);
      await flushAsyncWork();
    });
    const original = controller!.snapshot;
    let oldRequest!: Promise<boolean>;
    let newRequest!: Promise<boolean>;
    act(() => { oldRequest = controller!.loadNodeView({ query: "old" }); });
    expect(controller!.loading).toBe(false);
    expect(controller!.loadingNodes).toBe(true);
    expect(controller!.snapshot).toBe(original);
    act(() => { newRequest = controller!.loadNodeView({ query: "new", focusNodeId: "new-node" }); });
    const latest = {
      ...snapshotFor(ready), detailLevel: "nodes" as const,
      nodePage: { query: "new", nodeIds: [], totalMatches: 0, graphTruncated: false }
    };
    await act(async () => {
      second.resolve({ ok: true, value: latest });
      expect(await newRequest).toBe(true);
    });
    await act(async () => {
      first.resolve({ ok: false, error: {
        code: "COMMAND_FAILED", message: "old query failed", details: {}
      } });
      expect(await oldRequest).toBe(false);
    });
    expect(controller!.nodeView).toBe(latest);
    expect(controller!.snapshot).toBe(original);
    expect(controller!.loadingNodes).toBe(false);
    expect(controller!.nodeViewError).toBeNull();
    expect(getSnapshot.mock.calls.map(([request]) => request?.detail)).toEqual(["navigation", "nodes", "nodes"]);
  });

  it("discards pending node views on a workspace change and supports retry after failure", async () => {
    const ready = readyState("nodes", "2026-10-09T03:00:00.000Z");
    const pending = deferredSnapshot();
    let listener!: (state: CodeAnalysisStateDto) => void;
    const getSnapshot = vi.fn<GitNestBridge["codeAnalysis"]["getSnapshot"]>()
      .mockResolvedValueOnce({ ok: true, value: snapshotFor(ready) })
      .mockResolvedValueOnce({ ok: false, error: {
        code: "COMMAND_FAILED", message: "query failed", details: {}
      } })
      .mockImplementationOnce(() => pending.promise);
    installBridge({
      getState: vi.fn(async () => ({ ok: true as const, value: ready })),
      getSnapshot, onStateChanged: vi.fn(callback => { listener = callback; return vi.fn(); })
    });
    await act(async () => {
      root.render(<Harness onChange={value => { controller = value; }} />);
      await flushAsyncWork();
    });
    await act(async () => {
      expect(await controller!.loadNodeView({ query: "retry" })).toBe(false);
    });
    expect(controller!.nodeViewError?.message).toBe("query failed");
    let retried!: Promise<boolean>;
    act(() => { retried = controller!.loadNodeView({ query: "retry" }); });
    expect(controller!.nodeViewError).toBeNull();
    act(() => listener({ state: "idle", workspaceId: "other", snapshotAvailable: false }));
    await act(async () => {
      pending.resolve({ ok: true, value: snapshotFor(ready) });
      expect(await retried).toBe(false);
    });
    expect(controller!.nodeView).toBeNull();
    expect(controller!.loadingNodes).toBe(false);
    expect(controller!.nodeViewError).toBeNull();
  });

  it("loads a newer result produced while the retained page was hidden", async () => {
    const first = readyState("before", "2026-10-09T03:00:00.000Z");
    const next = readyState("after", "2026-10-09T03:01:00.000Z");
    const pending = deferredSnapshot();
    const getSnapshot = vi.fn<GitNestBridge["codeAnalysis"]["getSnapshot"]>()
      .mockResolvedValueOnce({ ok: true, value: snapshotFor(first) })
      .mockImplementationOnce(() => pending.promise);
    installBridge({
      getState: vi.fn<GitNestBridge["codeAnalysis"]["getState"]>()
        .mockResolvedValueOnce({ ok: true, value: first })
        .mockResolvedValueOnce({ ok: true, value: next }),
      getSnapshot, onStateChanged: vi.fn(() => vi.fn())
    });
    const render = async (active: boolean) => {
      await act(async () => {
        root.render(<AnalysisPageHost active={active} workspace={null}>
          <Harness onChange={value => { controller = value; }} />
        </AnalysisPageHost>);
        await flushAsyncWork();
      });
    };
    await render(true);
    await render(false);
    await render(true);
    expect(controller?.snapshot?.analysisId).toBe("before");
    expect(controller?.loading).toBe(true);
    await act(async () => {
      pending.resolve({ ok: true, value: snapshotFor(next) });
      await flushAsyncWork();
    });
    expect(controller?.snapshot?.analysisId).toBe("after");
    expect(controller?.loading).toBe(false);
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });

  it("keeps loading active until an event-triggered snapshot read settles", async () => {
    const pending = deferredSnapshot();
    const nextState = readyState("analysis-ready", "2026-09-19T01:00:00.000Z");
    let listener: ((state: CodeAnalysisStateDto) => void) | undefined;
    installBridge({
      getState: vi.fn(async () => ({
        ok: true as const,
        value: { state: "idle" as const, snapshotAvailable: false }
      })),
      getSnapshot: vi.fn(() => pending.promise),
      onStateChanged: vi.fn((nextListener) => {
        listener = nextListener;
        return vi.fn();
      })
    });
    await act(async () => {
      root.render(<Harness onChange={(value) => (controller = value)} />);
      await flushAsyncWork();
    });
    expect(controller?.loading).toBe(false);
    await act(async () => {
      listener?.(nextState);
      await flushAsyncWork();
    });
    expect(controller?.loading).toBe(true);
    expect(controller?.snapshot).toBeNull();
    await act(async () => {
      pending.resolve({
        ok: false,
        error: { code: "COMMAND_FAILED", message: "snapshot unavailable", details: {} }
      });
      await flushAsyncWork();
    });
    expect(controller?.loading).toBe(false);
    expect(controller?.error?.message).toBe("snapshot unavailable");
  });

  it("settles loading when a reload supersedes a pending snapshot and fails", async () => {
    const pending = deferredSnapshot();
    const initialState = readyState("analysis-ready", "2026-09-19T01:00:00.000Z");
    installBridge({
      getState: vi.fn<GitNestBridge["codeAnalysis"]["getState"]>()
        .mockResolvedValueOnce({ ok: true, value: initialState })
        .mockResolvedValueOnce({
          ok: false,
          error: { code: "COMMAND_FAILED", message: "state unavailable", details: {} }
        }),
      getSnapshot: vi.fn(() => pending.promise),
      onStateChanged: vi.fn(() => vi.fn())
    });
    await act(async () => {
      root.render(<Harness onChange={(value) => (controller = value)} />);
      await flushAsyncWork();
    });
    expect(controller?.loading).toBe(true);
    await act(async () => { await controller?.reload(); });
    expect(controller?.loading).toBe(false);
    expect(controller?.error?.message).toBe("state unavailable");
  });

  it("restarts a superseded snapshot read when the same ready state arrives during reload", async () => {
    const oldSnapshot = deferredSnapshot();
    const newSnapshot = deferredSnapshot();
    const nextState = deferred<Awaited<ReturnType<GitNestBridge["codeAnalysis"]["getState"]>>>();
    const ready = readyState("analysis-ready", "2026-09-19T01:00:00.000Z");
    let listener: ((state: CodeAnalysisStateDto) => void) | undefined;
    installBridge({
      getState: vi.fn<GitNestBridge["codeAnalysis"]["getState"]>()
        .mockResolvedValueOnce({ ok: true, value: ready })
        .mockImplementationOnce(() => nextState.promise),
      getSnapshot: vi.fn<GitNestBridge["codeAnalysis"]["getSnapshot"]>()
        .mockImplementationOnce(() => oldSnapshot.promise)
        .mockImplementationOnce(() => newSnapshot.promise),
      onStateChanged: vi.fn((nextListener) => {
        listener = nextListener;
        return vi.fn();
      })
    });
    await act(async () => {
      root.render(<Harness onChange={(value) => (controller = value)} />);
      await flushAsyncWork();
    });
    let reloading!: Promise<void>;
    await act(async () => {
      reloading = controller!.reload();
      listener?.(ready);
      await flushAsyncWork();
    });
    expect(controller?.loading).toBe(true);
    await act(async () => {
      newSnapshot.resolve({ ok: true, value: snapshotFor(ready) });
      oldSnapshot.resolve({ ok: true, value: { ...snapshotFor(ready), warnings: ["superseded"] } });
      nextState.resolve({ ok: true, value: ready });
      await reloading;
      await flushAsyncWork();
    });
    expect(controller?.snapshot?.analysisId).toBe("analysis-ready");
    expect(controller?.snapshot?.warnings).toEqual([]);
    expect(controller?.loading).toBe(false);
  });

  it("reports loading while a scope cache restore is pending and settles a cache miss", async () => {
    const restored = deferred<Awaited<ReturnType<GitNestBridge["codeAnalysis"]["restoreSnapshot"]>>>();
    installBridge({
      getState: vi.fn(async () => ({
        ok: true as const,
        value: { state: "idle" as const, snapshotAvailable: false, workspaceId: "workspace" }
      })),
      getSnapshot: vi.fn(),
      restoreSnapshot: vi.fn(() => restored.promise),
      onStateChanged: vi.fn(() => vi.fn())
    });
    await act(async () => {
      root.render(<Harness onChange={(value) => (controller = value)} />);
      await flushAsyncWork();
    });
    let restoring!: Promise<boolean | null>;
    await act(async () => {
      restoring = controller!.restoreSnapshot("workspace");
      await flushAsyncWork();
    });
    expect(controller?.loading).toBe(true);
    expect(controller?.action).toBe("restoring");
    await act(async () => {
      restored.resolve({ ok: true, value: false });
      await restoring;
    });
    expect(controller?.loading).toBe(false);
    expect(controller?.snapshot).toBeNull();
    expect(controller?.error).toBeNull();
  });

  it("preserves a valid current snapshot when a background response fails identity validation", async () => {
    const ready = readyState("analysis-ready", "2026-09-19T01:00:00.000Z");
    const current = snapshotFor(ready);
    installBridge({
      getState: vi.fn(async () => ({ ok: true as const, value: ready })),
      getSnapshot: vi.fn<GitNestBridge["codeAnalysis"]["getSnapshot"]>()
        .mockResolvedValueOnce({ ok: true, value: current })
        .mockResolvedValueOnce({
          ok: true,
          value: { ...current, workspaceId: "other-workspace" }
        }),
      onStateChanged: vi.fn(() => vi.fn())
    });
    await act(async () => {
      root.render(<Harness onChange={(value) => (controller = value)} />);
      await flushAsyncWork();
    });
    await act(async () => { await controller?.reload(); });
    expect(controller?.snapshot?.workspaceId).toBe("workspace");
    expect(controller?.snapshot?.analysisId).toBe("analysis-ready");
    expect(controller?.loading).toBe(false);
    expect(controller?.error?.message).toContain("不匹配");
  });

  it("keeps a pending restore busy when an unrelated state event arrives", async () => {
    const pending = deferred<Awaited<ReturnType<GitNestBridge["codeAnalysis"]["restoreSnapshot"]>>>();
    const idle: CodeAnalysisStateDto = {
      state: "idle", snapshotAvailable: false, workspaceId: "workspace", scope: "changed"
    };
    let listener!: (state: CodeAnalysisStateDto) => void;
    installBridge({
      getState: vi.fn(async () => ({ ok: true as const, value: idle })),
      getSnapshot: vi.fn(),
      restoreSnapshot: vi.fn(() => pending.promise),
      onStateChanged: vi.fn((next) => { listener = next; return vi.fn(); })
    });
    await act(async () => {
      root.render(<Harness onChange={(value) => (controller = value)} />);
      await flushAsyncWork();
    });
    let restoring!: Promise<boolean | null>;
    act(() => { restoring = controller!.restoreSnapshot("workspace"); });
    act(() => { listener(idle); });
    expect(controller?.action).toBe("restoring");
    expect(controller?.loading).toBe(true);
    await act(async () => {
      pending.resolve({ ok: true, value: false });
      await restoring;
    });
    expect(controller?.action).toBeNull();
    expect(controller?.loading).toBe(false);
  });

  it("clears a snapshot read failure after the same ready state successfully retries", async () => {
    const ready = readyState("analysis-ready", "2026-09-19T01:00:00.000Z");
    let listener: ((state: CodeAnalysisStateDto) => void) | undefined;
    installBridge({
      getState: vi.fn(async () => ({ ok: true as const, value: ready })),
      getSnapshot: vi.fn<GitNestBridge["codeAnalysis"]["getSnapshot"]>()
        .mockResolvedValueOnce({
          ok: false,
          error: { code: "COMMAND_FAILED", message: "temporary read failure", details: {} }
        })
        .mockResolvedValueOnce({ ok: true, value: snapshotFor(ready) }),
      onStateChanged: vi.fn((nextListener) => {
        listener = nextListener;
        return vi.fn();
      })
    });
    await act(async () => {
      root.render(<Harness onChange={(value) => (controller = value)} />);
      await flushAsyncWork();
    });
    expect(controller?.error?.message).toBe("temporary read failure");
    await act(async () => {
      listener?.(ready);
      await flushAsyncWork();
    });
    expect(controller?.snapshot?.analysisId).toBe("analysis-ready");
    expect(controller?.error).toBeNull();
    expect(controller?.loading).toBe(false);
  });

  it("settles full-snapshot loading when reload supersedes its pending request", async () => {
    const ready = readyState("analysis-ready", "2026-09-19T01:00:00.000Z");
    const full = deferredSnapshot();
    installBridge({
      getState: vi.fn(async () => ({ ok: true as const, value: ready })),
      getSnapshot: vi.fn<GitNestBridge["codeAnalysis"]["getSnapshot"]>()
        .mockResolvedValueOnce({ ok: true, value: snapshotFor(ready) })
        .mockImplementationOnce(() => full.promise)
        .mockResolvedValueOnce({ ok: true, value: snapshotFor(ready) }),
      onStateChanged: vi.fn(() => vi.fn())
    });
    await act(async () => {
      root.render(<Harness onChange={(value) => (controller = value)} />);
      await flushAsyncWork();
    });
    let fullLoading!: Promise<boolean>;
    await act(async () => {
      fullLoading = controller!.loadFullSnapshot();
      await flushAsyncWork();
    });
    expect(controller?.loadingFullSnapshot).toBe(true);
    await act(async () => { await controller?.reload(); });
    expect(controller?.loadingFullSnapshot).toBe(false);
    expect(controller?.loading).toBe(false);
    await act(async () => {
      full.resolve({ ok: true, value: { ...snapshotFor(ready), detailLevel: "full" } });
      await fullLoading;
    });
    expect(controller?.snapshotDetail).toBe("navigation");
  });

  it("does not let an older ready snapshot overwrite a newer one", async () => {
    const first = deferredSnapshot();
    const second = deferredSnapshot();
    const states = {
      first: readyState("analysis-a", "2026-09-19T01:00:00.000Z"),
      second: readyState("analysis-b", "2026-09-19T02:00:00.000Z")
    };
    let listener:
      | ((state: CodeAnalysisStateDto) => void)
      | undefined;
    const getSnapshot = vi
      .fn<GitNestBridge["codeAnalysis"]["getSnapshot"]>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    installBridge({
      getState: vi.fn(async () => ({
        ok: true as const,
        value: states.first
      })),
      getSnapshot,
      onStateChanged: vi.fn((nextListener) => {
        listener = nextListener;
        return vi.fn();
      })
    });

    await act(async () => {
      root.render(<Harness onChange={(value) => (controller = value)} />);
      await flushAsyncWork();
    });
    expect(getSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      listener?.(states.second);
      await flushAsyncWork();
    });
    expect(getSnapshot).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve({
        ok: true as const,
        value: snapshotFor(states.second)
      });
      await flushAsyncWork();
    });
    expect(controller?.snapshot?.analysisId).toBe("analysis-b");

    await act(async () => {
      first.resolve({
        ok: true as const,
        value: snapshotFor(states.first)
      });
      await flushAsyncWork();
    });
    expect(controller?.snapshot?.analysisId).toBe("analysis-b");
  });

  it("does not let an older state response overwrite a newer state event", async () => {
    const stateResponse = deferred<
      Awaited<
        ReturnType<GitNestBridge["codeAnalysis"]["getState"]>
      >
    >();
    const olderState = readyState(
      "analysis-a",
      "2026-09-19T01:00:00.000Z"
    );
    const newerState = readyState(
      "analysis-b",
      "2026-09-19T02:00:00.000Z"
    );
    let listener:
      | ((state: CodeAnalysisStateDto) => void)
      | undefined;
    const getSnapshot = vi.fn(
      async () => ({
        ok: true as const,
        value: snapshotFor(newerState)
      })
    );
    installBridge({
      getState: vi.fn(() => stateResponse.promise),
      getSnapshot,
      onStateChanged: vi.fn((nextListener) => {
        listener = nextListener;
        return vi.fn();
      })
    });

    await act(async () => {
      root.render(
        <Harness onChange={(value) => (controller = value)} />
      );
      await flushAsyncWork();
    });

    await act(async () => {
      listener?.(newerState);
      await flushAsyncWork();
    });
    expect(controller?.state.analysisId).toBe("analysis-b");
    expect(controller?.snapshot?.analysisId).toBe(
      "analysis-b"
    );

    await act(async () => {
      stateResponse.resolve({
        ok: true,
        value: olderState
      });
      await flushAsyncWork();
    });

    expect(controller?.state.analysisId).toBe("analysis-b");
    expect(controller?.snapshot?.analysisId).toBe(
      "analysis-b"
    );
    expect(getSnapshot).toHaveBeenCalledTimes(1);
  });

  it("loads another scope when snapshots share the same analysis identity", async () => {
    const generatedAt = "2026-09-24T01:00:00.000Z";
    const workspaceState = readyState(
      "shared-analysis",
      generatedAt,
      "workspace"
    );
    const changedState = readyState(
      "shared-analysis",
      generatedAt,
      "changed"
    );
    let listener:
      | ((state: CodeAnalysisStateDto) => void)
      | undefined;
    const getSnapshot = vi
      .fn<GitNestBridge["codeAnalysis"]["getSnapshot"]>()
      .mockResolvedValueOnce({
        ok: true as const,
        value: snapshotFor(workspaceState)
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: snapshotFor(changedState)
      });
    installBridge({
      getState: vi.fn(async () => ({
        ok: true as const,
        value: workspaceState
      })),
      getSnapshot,
      onStateChanged: vi.fn((nextListener) => {
        listener = nextListener;
        return vi.fn();
      })
    });

    await act(async () => {
      root.render(<Harness onChange={(value) => (controller = value)} />);
      await flushAsyncWork();
    });
    expect(controller?.snapshot?.scope).toBe("workspace");

    await act(async () => {
      listener?.(changedState);
      await flushAsyncWork();
    });

    expect(getSnapshot).toHaveBeenCalledTimes(2);
    expect(controller?.state.scope).toBe("changed");
    expect(controller?.snapshot?.scope).toBe("changed");
  });

  it("loads a navigation snapshot first and upgrades it on demand", async () => {
    const state = readyState(
      "analysis-a",
      "2026-09-24T01:00:00.000Z"
    );
    const getSnapshot = vi
      .fn<GitNestBridge["codeAnalysis"]["getSnapshot"]>()
      .mockResolvedValueOnce({
        ok: true as const,
        value: {
          ...snapshotFor(state),
          detailLevel: "navigation"
        }
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: {
          ...snapshotFor(state),
          detailLevel: "full"
        }
      });
    installBridge({
      getState: vi.fn(async () => ({
        ok: true as const,
        value: state
      })),
      getSnapshot,
      onStateChanged: vi.fn(() => vi.fn())
    });

    await act(async () => {
      root.render(<Harness onChange={(value) => (controller = value)} />);
      await flushAsyncWork();
    });

    expect(getSnapshot).toHaveBeenNthCalledWith(1, {
      detail: "navigation"
    });
    expect(controller?.snapshotDetail).toBe("navigation");

    await act(async () => {
      await controller?.loadFullSnapshot();
      await flushAsyncWork();
    });

    expect(getSnapshot).toHaveBeenNthCalledWith(2, {
      detail: "full"
    });
    expect(controller?.snapshotDetail).toBe("full");
    expect(controller?.loadingFullSnapshot).toBe(false);
  });

  it.each([true, false])("coalesces concurrent full-snapshot upgrades, releasing them after success=%s", async (success) => {
    const ready = readyState("analysis-full", "2026-09-19T01:00:00.000Z");
    const pending = deferredSnapshot();
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { ...snapshotFor(ready), detailLevel: "navigation" }
      })
      .mockImplementationOnce(() => pending.promise);
    installBridge({
      getState: vi.fn(async () => ({ ok: true as const, value: ready })),
      getSnapshot,
      onStateChanged: vi.fn(() => vi.fn())
    });
    await act(async () => {
      root.render(<Harness onChange={(value) => (controller = value)} />);
      await flushAsyncWork();
    });
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = controller!.loadFullSnapshot();
      second = controller!.loadFullSnapshot();
    });
    expect(getSnapshot).toHaveBeenCalledTimes(2);
    expect(controller?.loadingFullSnapshot).toBe(true);
    await act(async () => {
      pending.resolve(success
        ? {
            ok: true,
            value: { ...snapshotFor(ready), detailLevel: "full" }
          }
        : {
            ok: false,
            error: { code: "COMMAND_FAILED", message: "read failed", details: {} }
          });
      expect(await Promise.all([first, second])).toEqual([success, success]);
    });
    expect(controller?.loadingFullSnapshot).toBe(false);
    if (!success) {
      getSnapshot.mockResolvedValueOnce({
        ok: true,
        value: { ...snapshotFor(ready), detailLevel: "full" }
      });
      await act(async () => {
        expect(await controller!.loadFullSnapshot()).toBe(true);
      });
      expect(getSnapshot).toHaveBeenCalledTimes(3);
    }
    expect(controller?.snapshotDetail).toBe("full");
  });

  it("does not let a delayed navigation response replace a full snapshot", async () => {
    const navigation = deferredSnapshot();
    const full = deferredSnapshot();
    const state = readyState(
      "analysis-a",
      "2026-09-24T02:00:00.000Z"
    );
    const getSnapshot = vi
      .fn<GitNestBridge["codeAnalysis"]["getSnapshot"]>()
      .mockImplementationOnce(() => navigation.promise)
      .mockImplementationOnce(() => full.promise);
    installBridge({
      getState: vi.fn(async () => ({
        ok: true as const,
        value: state
      })),
      getSnapshot,
      onStateChanged: vi.fn(() => vi.fn())
    });

    await act(async () => {
      root.render(<Harness onChange={(value) => (controller = value)} />);
      await flushAsyncWork();
    });

    let fullLoad: Promise<boolean> | undefined;
    await act(async () => {
      fullLoad = controller?.loadFullSnapshot();
      await flushAsyncWork();
    });
    await act(async () => {
      full.resolve({
        ok: true as const,
        value: {
          ...snapshotFor(state),
          detailLevel: "full"
        }
      });
      await fullLoad;
      await flushAsyncWork();
    });
    expect(controller?.snapshotDetail).toBe("full");

    await act(async () => {
      navigation.resolve({
        ok: true as const,
        value: {
          ...snapshotFor(state),
          detailLevel: "navigation"
        }
      });
      await flushAsyncWork();
    });

    expect(controller?.snapshotDetail).toBe("full");
  });

  it("invalidates an in-flight snapshot when the workspace state clears it", async () => {
    const pending = deferredSnapshot();
    const initialState = readyState(
      "analysis-a",
      "2026-09-19T01:00:00.000Z"
    );
    let listener:
      | ((state: CodeAnalysisStateDto) => void)
      | undefined;
    installBridge({
      getState: vi.fn(async () => ({
        ok: true as const,
        value: initialState
      })),
      getSnapshot: vi.fn(() => pending.promise),
      onStateChanged: vi.fn((nextListener) => {
        listener = nextListener;
        return vi.fn();
      })
    });

    await act(async () => {
      root.render(<Harness onChange={(value) => (controller = value)} />);
      await flushAsyncWork();
    });

    await act(async () => {
      listener?.({
        state: "idle",
        snapshotAvailable: false,
        workspaceId: "workspace-b"
      });
      pending.resolve({
        ok: true as const,
        value: snapshotFor(initialState)
      });
      await flushAsyncWork();
    });

    expect(controller?.snapshot).toBeNull();
    expect(controller?.state.workspaceId).toBe("workspace-b");
  });

  it("rejects a snapshot whose ready identity does not match state", async () => {
    const state = readyState(
      "analysis-a",
      "2026-09-19T01:00:00.000Z"
    );
    const mismatched = {
      ...snapshotFor(state),
      generatedAt: "2026-09-19T00:59:59.000Z"
    };
    installBridge({
      getState: vi.fn(async () => ({
        ok: true as const,
        value: state
      })),
      getSnapshot: vi.fn(async () => ({
        ok: true as const,
        value: mismatched
      })),
      onStateChanged: vi.fn(() => vi.fn())
    });

    await act(async () => {
      root.render(<Harness onChange={(value) => (controller = value)} />);
      await flushAsyncWork();
    });

    expect(controller?.snapshot).toBeNull();
    expect(controller?.error?.message).toContain(
      "快照与当前 Workspace 状态不匹配"
    );
  });

  it("distinguishes a failed scope restore from a cache miss", async () => {
    installBridge({
      getState: vi.fn(async () => ({
        ok: true as const, value: { state: "idle" as const, snapshotAvailable: false }
      })),
      getSnapshot: vi.fn(),
      restoreSnapshot: vi.fn(async () => ({
        ok: false as const,
        error: { code: "COMMAND_FAILED" as const, message: "restore unavailable", details: {} }
      })),
      onStateChanged: vi.fn(() => vi.fn())
    });
    await act(async () => {
      root.render(<Harness onChange={(value) => (controller = value)} />);
      await flushAsyncWork();
    });
    let restored: boolean | null | undefined;
    await act(async () => { restored = await controller?.restoreSnapshot("changed"); });
    expect(restored).toBeNull();
    expect(controller?.error?.message).toBe("restore unavailable");
    expect(controller?.loading).toBe(false);
    expect(controller?.action).toBeNull();
  });

  it("ignores an earlier restore failure while a newer scope is still restoring", async () => {
    const first = deferred<Awaited<ReturnType<GitNestBridge["codeAnalysis"]["restoreSnapshot"]>>>();
    const second = deferred<Awaited<ReturnType<GitNestBridge["codeAnalysis"]["restoreSnapshot"]>>>();
    const idle = { state: "idle" as const, snapshotAvailable: false, workspaceId: "workspace" };
    let listener: ((state: CodeAnalysisStateDto) => void) | undefined;
    installBridge({
      getState: vi.fn(async () => ({ ok: true as const, value: idle })),
      getSnapshot: vi.fn(),
      restoreSnapshot: vi.fn<GitNestBridge["codeAnalysis"]["restoreSnapshot"]>()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise),
      onStateChanged: vi.fn((nextListener) => { listener = nextListener; return vi.fn(); })
    });
    await act(async () => {
      root.render(<Harness onChange={(value) => (controller = value)} />);
      await flushAsyncWork();
    });
    let firstRestore!: Promise<boolean | null>;
    let secondRestore!: Promise<boolean | null>;
    await act(async () => {
      firstRestore = controller!.restoreSnapshot("changed");
      listener?.(idle);
      await flushAsyncWork();
    });
    await act(async () => {
      secondRestore = controller!.restoreSnapshot("workspace");
      first.resolve({
        ok: false, error: { code: "COMMAND_FAILED", message: "obsolete restore failure", details: {} }
      });
      await firstRestore;
    });
    expect(controller?.loading).toBe(true);
    expect(controller?.action).toBe("restoring");
    expect(controller?.error).toBeNull();
    await act(async () => {
      second.resolve({ ok: true, value: false });
      await secondRestore;
    });
    expect(await firstRestore).toBeNull();
    expect(await secondRestore).toBe(false);
    expect(controller?.loading).toBe(false);
  });

  it("ignores a restore result after the Workspace changes", async () => {
    const pending = deferred<Awaited<ReturnType<GitNestBridge["codeAnalysis"]["restoreSnapshot"]>>>();
    let listener: ((state: CodeAnalysisStateDto) => void) | undefined;
    installBridge({
      getState: vi.fn(async () => ({
        ok: true as const, value: { state: "idle" as const, snapshotAvailable: false, workspaceId: "workspace-a" }
      })),
      getSnapshot: vi.fn(),
      restoreSnapshot: vi.fn(() => pending.promise),
      onStateChanged: vi.fn((nextListener) => { listener = nextListener; return vi.fn(); })
    });
    await act(async () => {
      root.render(<Harness onChange={(value) => (controller = value)} />);
      await flushAsyncWork();
    });
    let restoring!: Promise<boolean | null>;
    await act(async () => {
      restoring = controller!.restoreSnapshot("changed");
      listener?.({ state: "idle", snapshotAvailable: false, workspaceId: "workspace-b" });
      pending.resolve({
        ok: false, error: { code: "COMMAND_CANCELLED", message: "old workspace cancelled", details: {} }
      });
      await restoring;
    });
    expect(controller?.state.workspaceId).toBe("workspace-b");
    expect(controller?.error).toBeNull();
    expect(controller?.loading).toBe(false);
    expect(await restoring).toBeNull();
  });

  it.each(["failure", "rejection"] as const)(
    "ignores a stale start %s after switching workspaces and starting again",
    async (outcome) => {
      const pending = deferred<Awaited<ReturnType<GitNestBridge["codeAnalysis"]["start"]>>>();
      const next = deferred<Awaited<ReturnType<GitNestBridge["codeAnalysis"]["start"]>>>();
      let listener: ((state: CodeAnalysisStateDto) => void) | undefined;
      installBridge({
        getState: vi.fn(async () => ({
          ok: true as const,
          value: { state: "idle" as const, snapshotAvailable: false, workspaceId: "workspace-a" }
        })),
        getSnapshot: vi.fn(),
        onStateChanged: vi.fn((nextListener) => { listener = nextListener; return vi.fn(); })
      });
      window.gitnest.codeAnalysis.start = vi.fn()
        .mockImplementationOnce(() => pending.promise.then((result) => {
          if (outcome === "rejection") throw new Error("old start transport failure");
          return result;
        }))
        .mockReturnValueOnce(next.promise);
      await act(async () => root.render(
        <Harness onChange={(value) => (controller = value)} />
      ));
      let firstStart!: Promise<boolean>;
      let secondStart!: Promise<boolean>;
      act(() => { firstStart = controller!.start("workspace"); });
      act(() => listener?.({
        state: "idle", snapshotAvailable: false, workspaceId: "workspace-b"
      }));
      act(() => { secondStart = controller!.start("changed"); });
      await act(async () => {
        pending.resolve({
          ok: false,
          error: { code: "COMMAND_FAILED", message: "old workspace start failed", details: {} }
        });
        await firstStart;
      });
      expect(controller?.state.workspaceId).toBe("workspace-b");
      expect(controller?.error).toBeNull();
      expect(controller?.action).toBe("starting");
      await act(async () => {
        next.resolve({
          ok: false,
          error: { code: "COMMAND_FAILED", message: "current start failed", details: {} }
        });
        await secondStart;
      });
      expect(controller?.error?.message).toBe("current start failed");
      expect(controller?.action).toBeNull();
    }
  );

  it("clears the previous workspace start error when another workspace becomes idle", async () => {
    let listener: ((state: CodeAnalysisStateDto) => void) | undefined;
    installBridge({
      getState: vi.fn(async () => ({
        ok: true as const,
        value: { state: "idle" as const, snapshotAvailable: false, workspaceId: "workspace-a" }
      })),
      getSnapshot: vi.fn(),
      onStateChanged: vi.fn((nextListener) => { listener = nextListener; return vi.fn(); })
    });
    window.gitnest.codeAnalysis.start = vi.fn().mockResolvedValue({
      ok: false, error: { code: "COMMAND_FAILED", message: "workspace A failed", details: {} }
    });
    await act(async () => root.render(<Harness onChange={(value) => (controller = value)} />));
    await act(async () => { await controller!.start("changed"); });
    expect(controller?.error?.message).toBe("workspace A failed");
    act(() => listener?.({ state: "idle", snapshotAvailable: false, workspaceId: "workspace-b" }));
    expect(controller?.error).toBeNull();
  });

  it("ends a superseded restore when reload fails and ignores the restore response", async () => {
    const pending = deferred<Awaited<ReturnType<GitNestBridge["codeAnalysis"]["restoreSnapshot"]>>>();
    installBridge({
      getState: vi.fn<GitNestBridge["codeAnalysis"]["getState"]>()
        .mockResolvedValueOnce({ ok: true, value: { state: "idle", snapshotAvailable: false } })
        .mockResolvedValueOnce({
          ok: false, error: { code: "COMMAND_FAILED", message: "reload unavailable", details: {} }
        }),
      getSnapshot: vi.fn(),
      restoreSnapshot: vi.fn(() => pending.promise),
      onStateChanged: vi.fn(() => vi.fn())
    });
    await act(async () => {
      root.render(<Harness onChange={(value) => (controller = value)} />);
      await flushAsyncWork();
    });
    let restoring!: Promise<boolean | null>;
    await act(async () => {
      restoring = controller!.restoreSnapshot("changed");
      await controller?.reload();
    });
    expect(controller?.loading).toBe(false);
    expect(controller?.action).toBeNull();
    await act(async () => {
      pending.resolve({ ok: true, value: false });
      await restoring;
    });
    expect(await restoring).toBeNull();
    expect(controller?.error?.message).toBe("reload unavailable");
  });

  it("reports a scoped snapshot cache miss without leaving an action pending", async () => {
    const restoreSnapshot = vi.fn(async () => ({
      ok: true as const,
      value: false
    }));
    installBridge({
      getState: vi.fn(async () => ({
        ok: true as const,
        value: {
          state: "idle" as const,
          snapshotAvailable: false
        }
      })),
      getSnapshot: vi.fn(async () => ({
        ok: true as const,
        value: null
      })),
      restoreSnapshot,
      onStateChanged: vi.fn(() => vi.fn())
    });

    await act(async () => {
      root.render(<Harness onChange={(value) => (controller = value)} />);
      await flushAsyncWork();
    });

    let restored = true;
    await act(async () => {
      restored =
        (await controller?.restoreSnapshot("changed")) ??
        true;
      await flushAsyncWork();
    });

    expect(restored).toBe(false);
    expect(restoreSnapshot).toHaveBeenCalledWith({
      scope: "changed"
    });
    expect(controller?.action).toBeNull();
  });

  it("ignores a late cancel failure after a newer state event completes analysis", async () => {
    const cancelResponse = deferred<
      Awaited<
        ReturnType<GitNestBridge["codeAnalysis"]["cancel"]>
      >
    >();
    const runningState: CodeAnalysisStateDto = {
      state: "running",
      snapshotAvailable: false,
      analysisId: "analysis-a",
      workspaceId: "workspace",
      scope: "workspace",
      startedAt: "2026-10-03T01:00:00.000Z",
      progress: {
        stage: "linking",
        completed: 9,
        total: 10,
        message: "正在完成代码分析"
      }
    };
    const completedState = readyState(
      "analysis-a",
      "2026-10-03T01:01:00.000Z"
    );
    let listener:
      | ((state: CodeAnalysisStateDto) => void)
      | undefined;
    installBridge({
      getState: vi.fn(async () => ({
        ok: true as const,
        value: runningState
      })),
      getSnapshot: vi.fn(async () => ({
        ok: true as const,
        value: snapshotFor(completedState)
      })),
      cancel: vi.fn(() => cancelResponse.promise),
      onStateChanged: vi.fn((nextListener) => {
        listener = nextListener;
        return vi.fn();
      })
    });

    await act(async () => {
      root.render(
        <Harness onChange={(value) => (controller = value)} />
      );
      await flushAsyncWork();
    });

    let cancellation: Promise<boolean> | undefined;
    await act(async () => {
      cancellation = controller?.cancel();
      await flushAsyncWork();
    });
    expect(controller?.action).toBe("cancelling");

    await act(async () => {
      listener?.(completedState);
      await flushAsyncWork();
    });
    expect(controller?.state.state).toBe("ready");
    expect(controller?.action).toBeNull();
    expect(controller?.error).toBeNull();

    await act(async () => {
      cancelResponse.resolve({
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "The analysis is no longer running.",
          details: {}
        }
      });
      await cancellation;
      await flushAsyncWork();
    });

    expect(controller?.state.state).toBe("ready");
    expect(controller?.error).toBeNull();
  });
});

function Harness({
  onChange
}: {
  onChange(controller: CodeAnalysisController): void;
}) {
  onChange(useCodeAnalysis());
  return null;
}

function readyState(
  analysisId: string,
  generatedAt: string,
  scope: "changed" | "workspace" = "workspace"
): CodeAnalysisStateDto {
  return {
    state: "ready",
    snapshotAvailable: true,
    analysisId,
    workspaceId: "workspace",
    scope,
    generatedAt
  };
}

function snapshotFor(
  state: CodeAnalysisStateDto
): CodeAnalysisSnapshotDto {
  return {
    schemaVersion: 1,
    analysisId: state.analysisId ?? "",
    workspaceId: state.workspaceId ?? "",
    scope: state.scope ?? "workspace",
    generatedAt: state.generatedAt ?? "",
    roots: [],
    nodes: [],
    edges: [],
    requestChains: [],
    languageServers: [],
    warnings: [],
    stats: {
      discoveredFiles: 0,
      analyzedFiles: 0,
      cachedFiles: 0,
      skippedFiles: 0,
      symbolCount: 0,
      edgeCount: 0,
      requestChainCount: 0,
      truncated: false,
      durationMs: 0
    }
  };
}

function deferredSnapshot() {
  let resolve!: (
    value: Awaited<
      ReturnType<
        GitNestBridge["codeAnalysis"]["getSnapshot"]
      >
    >
  ) => void;
  const promise = new Promise<
    Awaited<
      ReturnType<
        GitNestBridge["codeAnalysis"]["getSnapshot"]
      >
    >
  >((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function installBridge(
  codeAnalysis: Pick<
    GitNestBridge["codeAnalysis"],
    "getState" | "getSnapshot" | "onStateChanged"
  > &
    Partial<
      Pick<
        GitNestBridge["codeAnalysis"],
        "cancel" | "restoreSnapshot"
      >
    >
) {
  Object.defineProperty(window, "gitnest", {
    configurable: true,
    value: {
      codeAnalysis: {
        ...codeAnalysis,
        start: vi.fn(),
        restoreSnapshot:
          codeAnalysis.restoreSnapshot ?? vi.fn(),
        cancel: codeAnalysis.cancel ?? vi.fn(),
        installLanguageServer: vi.fn()
      }
    } as unknown as GitNestBridge
  });
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
