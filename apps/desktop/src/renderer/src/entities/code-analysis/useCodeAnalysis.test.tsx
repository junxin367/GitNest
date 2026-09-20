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
        workspaceId: "workspace-b",
        entryId: "entry-b",
        entryName: "Entry B"
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
  generatedAt: string
): CodeAnalysisStateDto {
  return {
    state: "ready",
    snapshotAvailable: true,
    analysisId,
    workspaceId: "workspace",
    entryId: "entry",
    entryName: "Entry",
    scope: "workspace",
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
    entryId: state.entryId ?? "",
    entryName: state.entryName ?? "",
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

function installBridge(
  codeAnalysis: Pick<
    GitNestBridge["codeAnalysis"],
    "getState" | "getSnapshot" | "onStateChanged"
  >
) {
  Object.defineProperty(window, "gitnest", {
    configurable: true,
    value: {
      codeAnalysis: {
        ...codeAnalysis,
        start: vi.fn(),
        cancel: vi.fn(),
        installLanguageServer: vi.fn()
      }
    } as unknown as GitNestBridge
  });
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
