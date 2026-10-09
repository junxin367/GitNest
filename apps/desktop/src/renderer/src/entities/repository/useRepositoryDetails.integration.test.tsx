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
  BranchDto,
  CommitSummaryDto,
  GitNestBridge,
  RepositoryChangesDto,
  RepositoryCommitDto,
  RepositoryDiffDto,
  RepositoryHistoryPageDto,
  RepositoryTargetDto
} from "@gitnest/contracts";

import type { RepositoryTab } from "../../app/navigation";
import type { RepositoryChangeSelectionRequest } from "./changeSelection";
import {
  useRepositoryDetails,
  type RepositoryDetailsController
} from "./useRepositoryDetails";

const TARGET: RepositoryTargetDto = {
  repositoryId: "repository-a",
  worktreeId: "worktree-a"
};
const CHANGE = {
  path: "MixedLineEndings.java",
  indexStatus: ".",
  worktreeStatus: "M",
  kind: "ordinary"
} as const;
const SECOND_CHANGE = {
  ...CHANGE,
  path: "RealContentChange.java"
} as const;

describe("useRepositoryDetails", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: RepositoryDetailsController | undefined;

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

  it.each(["overview", "history", "branches"] as const)(
    "refreshes visible %s after a status revision from another operation",
    async (tab) => {
      const firstCommit = createCommitSummary();
      const secondCommit = { ...firstCommit, hash: "new-head", subject: "New commit" };
      const getHistory = vi.fn()
        .mockResolvedValueOnce({ ok: true, value: { target: TARGET, page: { commits: [firstCommit] } } })
        .mockResolvedValue({ ok: true, value: { target: TARGET, page: { commits: [secondCommit] } } });
      const getBranches = vi.fn()
        .mockResolvedValueOnce({ ok: true, value: { target: TARGET, branches: createBranches() } })
        .mockResolvedValue({ ok: true, value: { target: TARGET, branches: [] } });
      installBridge({ getHistory, getBranches });
      await act(async () => {
        root.render(<Harness tab={tab} revision="before-operation" onController={(value) => { controller = value; }} />);
        await flushAsyncWork();
      });
      await act(async () => {
        root.render(<Harness tab={tab} revision="after-operation" onController={(value) => { controller = value; }} />);
        await flushAsyncWork();
      });
      if (tab !== "branches") {
        expect(getHistory).toHaveBeenCalledTimes(2);
        expect(controller!.history?.page.commits[0]?.hash).toBe("new-head");
      }
      if (tab !== "overview") {
        expect(getBranches).toHaveBeenCalledTimes(2);
        expect(controller!.branches?.branches).toEqual([]);
      }
      await act(async () => {
        root.render(<Harness tab={tab} revision="after-operation" onController={(value) => { controller = value; }} />);
        await flushAsyncWork();
      });
      expect(tab === "branches" ? getBranches : getHistory).toHaveBeenCalledTimes(2);
    }
  );

  it.each(["overview", "history", "branches"] as const)(
    "keeps visible %s data when operation-triggered refresh fails",
    async (tab) => {
      const history = { target: TARGET, page: { commits: [createCommitSummary()] } };
      const branches = { target: TARGET, branches: createBranches() };
      const failure = {
        ok: false,
        error: { code: "COMMAND_FAILED", message: "Refresh unavailable.", details: {} }
      };
      installBridge({
        getHistory: vi.fn().mockResolvedValueOnce({ ok: true, value: history }).mockResolvedValue(failure),
        getBranches: vi.fn().mockResolvedValueOnce({ ok: true, value: branches }).mockResolvedValue(failure)
      });
      await act(async () => {
        root.render(<Harness tab={tab} revision="before" onController={(value) => { controller = value; }} />);
        await flushAsyncWork();
      });
      await act(async () => {
        root.render(<Harness tab={tab} revision="after" onController={(value) => { controller = value; }} />);
        await flushAsyncWork();
      });
      expect(controller!.error?.message).toBe("Refresh unavailable.");
      if (tab !== "branches") {
        expect(controller!.history).toEqual(history);
      }
      if (tab !== "overview") {
        expect(controller!.branches).toEqual(branches);
      }
      expect(controller!.loading.history).toBe(false);
      expect(controller!.loading.branches).toBe(false);
    }
  );

  it("does not duplicate queries when the tab and status revision change together", async () => {
    const getHistory = vi.fn(async () => ({
      ok: true as const, value: { target: TARGET, page: { commits: [createCommitSummary()] } }
    }));
    const getBranches = vi.fn(async () => ({
      ok: true as const, value: { target: TARGET, branches: createBranches() }
    }));
    installBridge({ getHistory, getBranches });
    await act(async () => {
      root.render(<Harness tab="overview" revision="before" onController={(value) => { controller = value; }} />);
      await flushAsyncWork();
    });
    await act(async () => {
      root.render(<Harness tab="history" revision="after" onController={(value) => { controller = value; }} />);
      await flushAsyncWork();
    });
    expect(getHistory).toHaveBeenCalledTimes(2);
    expect(getBranches).toHaveBeenCalledTimes(1);
  });

  it.each(["overview", "history", "branches", "changes"] as const)(
    "reports the scheduled %s query on its first render and after changing targets",
    (tab) => {
      const pending = vi.fn(() => new Promise<never>(() => undefined));
      installBridge({ getHistory: pending, getBranches: pending, getChanges: pending });
      const renders: RepositoryDetailsController[] = [];
      act(() => {
        root.render(<Harness tab={tab} onController={(value) => { renders.push(value); }} />);
      });
      const loadingKey = tab === "overview" ? "history" : tab;
      expect(renders[0]?.loading[loadingKey]).toBe(true);
      renders.length = 0;
      act(() => {
        root.render(
          <Harness tab={tab} target={{ repositoryId: "first-render-b", worktreeId: "main" }}
            onController={(value) => { renders.push(value); }} />
        );
      });
      expect(renders[0]?.loading[loadingKey]).toBe(true);
    }
  );

  it("reports a new tab's scheduled query immediately and stops reporting loading without a target", () => {
    const pending = vi.fn(() => new Promise<never>(() => undefined));
    installBridge({ getHistory: pending, getBranches: pending });
    const renders: RepositoryDetailsController[] = [];
    function ScopeHarness({ target, tab }: { target?: RepositoryTargetDto; tab: RepositoryTab }) {
      renders.push(useRepositoryDetails(target, tab));
      return null;
    }
    act(() => { root.render(<ScopeHarness target={TARGET} tab="overview" />); });
    renders.length = 0;
    act(() => { root.render(<ScopeHarness target={TARGET} tab="branches" />); });
    expect(renders[0]?.loading.branches).toBe(true);
    expect(renders[0]?.loading.history).toBe(false);
    renders.length = 0;
    act(() => { root.render(<ScopeHarness tab="history" />); });
    expect(Object.values(renders[0]!.loading).some(Boolean)).toBe(false);
  });

  it("cancels an obsolete file diff when a status refresh removes every change", async () => {
    let resolveDiff!: (result: Awaited<ReturnType<GitNestBridge["repository"]["getDiff"]>>) => void;
    const cancelQuery = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const getDiff = vi.fn(
      (_request: Parameters<GitNestBridge["repository"]["getDiff"]>[0]) =>
        new Promise<Awaited<ReturnType<GitNestBridge["repository"]["getDiff"]>>>(
          (resolve) => { resolveDiff = resolve; }
        )
    );
    installBridge({
      cancelQuery,
      getChanges: vi.fn().mockResolvedValueOnce({ ok: true, value: createChanges([CHANGE]) })
        .mockResolvedValueOnce({ ok: true, value: createChanges([]) }),
      getDiff
    });
    await act(async () => {
      root.render(<Harness onController={(value) => { controller = value; }} />);
      await flushAsyncWork();
    });
    expect(controller?.loading.diff).toBe(true);
    const diffQueryId = getDiff.mock.calls[0]![0].queryId;
    await act(async () => {
      await controller?.reload("changes", { preserveSelection: true });
    });
    expect(controller?.selectedChange).toBeNull();
    expect(controller?.loading.diff).toBe(false);
    expect(cancelQuery).toHaveBeenCalledWith({ queryId: diffQueryId });
    await act(async () => {
      resolveDiff({ ok: false, error: { code: "COMMAND_FAILED", message: "旧文件已删除", details: {} } });
    });
    expect(controller?.error).toBeNull();
    expect(controller?.diff).toBeNull();
  });

  it("hides previous repository data on the first render of a new target", async () => {
    const nextTarget = { repositoryId: "repository-b", worktreeId: "worktree-b" };
    installBridge({
      getHistory: vi.fn().mockResolvedValueOnce({
        ok: true,
        value: { target: TARGET, page: { commits: [createCommitSummary()] } }
      }).mockImplementation(() => new Promise(() => undefined))
    });
    await act(async () => {
      root.render(<Harness tab="overview" onController={(value) => { controller = value; }} />);
      await flushAsyncWork();
    });
    expect(controller?.history).not.toBeNull();
    const renders: RepositoryDetailsController[] = [];
    act(() => {
      root.render(<Harness target={nextTarget} tab="overview" onController={(value) => { renders.push(value); }} />);
    });
    expect(renders[0]?.history).toBeNull();
    expect(renders[0]?.selectedCommitHash).toBeNull();
  });

  it("preserves loaded details while refreshing the same commit", async () => {
    const summary = createCommitSummary();
    const value: RepositoryCommitDto = {
      target: TARGET,
      commit: {
        ...summary, committerName: summary.authorName, committerEmail: summary.authorEmail,
        committedAt: summary.authoredAt, body: "", refs: [], files: [], additions: 0, deletions: 0
      }
    };
    let resolveRefresh!: (result: { ok: true; value: RepositoryCommitDto }) => void;
    installBridge({
      getHistory: vi.fn(async () => ({ ok: true as const, value: { target: TARGET, page: { commits: [] } } })),
      getCommit: vi.fn().mockResolvedValueOnce({ ok: true, value }).mockImplementationOnce(
        () => new Promise((resolve) => { resolveRefresh = resolve; })
      )
    });
    await act(async () => {
      root.render(<Harness tab="overview" onController={(next) => { controller = next; }} />);
      await flushAsyncWork();
    });
    await act(async () => { await controller?.selectCommit(summary.hash); });
    let refreshing: Promise<void> | undefined;
    act(() => { refreshing = controller?.selectCommit(summary.hash); });
    expect(controller?.loading.commit).toBe(true);
    expect(controller?.commit).toEqual(value);
    await act(async () => {
      resolveRefresh({ ok: true, value });
      await refreshing;
    });
  });

  it("refreshes status once when an unstaged diff is empty", async () => {
    const getChanges = vi.fn(async () => ({
      ok: true as const,
      value: createChanges([CHANGE])
    }));
    const getDiff = vi.fn(async () => ({
      ok: true as const,
      value: createEmptyDiff()
    }));
    installBridge({ getChanges, getDiff });

    await act(async () => {
      root.render(
        <Harness
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });
    await act(flushAsyncWork);

    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(getDiff).toHaveBeenCalledTimes(2);
    expect(controller?.diff?.diff.content).toBe("");
    expect(controller?.diffNotice).toBe("metadata-only");
  });

  it("opens the requested changed file before loading the default diff", async () => {
    const getChanges = vi.fn(async () => ({
      ok: true as const,
      value: createChanges([CHANGE, SECOND_CHANGE])
    }));
    const getDiff = vi.fn(
      async (
        request: Parameters<
          GitNestBridge["repository"]["getDiff"]
        >[0]
      ) => ({
      ok: true as const,
      value: createDiff(
        `diff for ${request.path}`,
        request.path,
        request.mode
      )
      })
    );
    const onRequestHandled = vi.fn();
    installBridge({ getChanges, getDiff });

    await act(async () => {
      root.render(
        <Harness
          request={{
            id: 7,
            target: TARGET,
            path: SECOND_CHANGE.path,
            mode: "unstaged"
          }}
          onRequestHandled={onRequestHandled}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });

    expect(getDiff).toHaveBeenCalledOnce();
    expect(getDiff.mock.calls[0]?.[0]).toMatchObject({
      path: SECOND_CHANGE.path,
      mode: "unstaged"
    });
    expect(controller?.selectedChange).toMatchObject({
      path: SECOND_CHANGE.path,
      mode: "unstaged"
    });
    expect(controller?.changeSelectionRequestId).toBe(7);
    expect(onRequestHandled).toHaveBeenCalledOnce();
    expect(onRequestHandled).toHaveBeenCalledWith(7);
  });

  it("keeps the requested mode for a file with staged and unstaged changes", async () => {
    const dualChange = {
      ...CHANGE,
      path: "DualState.ts",
      indexStatus: "M"
    } as const;
    const getChanges = vi.fn(async () => ({
      ok: true as const,
      value: createChanges([dualChange])
    }));
    const getDiff = vi.fn(
      async (
        request: Parameters<
          GitNestBridge["repository"]["getDiff"]
        >[0]
      ) => ({
      ok: true as const,
      value: createDiff(
        "staged diff",
        request.path,
        request.mode
      )
      })
    );
    installBridge({ getChanges, getDiff });

    await act(async () => {
      root.render(
        <Harness
          request={{
            id: 8,
            target: TARGET,
            path: dualChange.path,
            mode: "staged"
          }}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });

    expect(controller?.selectedChange).toMatchObject({
      path: dualChange.path,
      mode: "staged"
    });
    expect(getDiff.mock.calls[0]?.[0]).toMatchObject({
      path: dualChange.path,
      mode: "staged"
    });
  });

  it("refreshes loaded changes before consuming a later file request", async () => {
    const getChanges = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: createChanges([CHANGE])
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: createChanges([CHANGE, SECOND_CHANGE])
      });
    const getDiff = vi.fn(
      async (
        request: Parameters<
          GitNestBridge["repository"]["getDiff"]
        >[0]
      ) => ({
        ok: true as const,
        value: createDiff(
          `diff for ${request.path}`,
          request.path,
          request.mode
        )
      })
    );
    const onRequestHandled = vi.fn();
    installBridge({ getChanges, getDiff });

    await act(async () => {
      root.render(
        <Harness
          onRequestHandled={onRequestHandled}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });
    expect(controller?.selectedChange?.path).toBe(CHANGE.path);

    await act(async () => {
      root.render(
        <Harness
          request={{
            id: 9,
            target: TARGET,
            path: SECOND_CHANGE.path,
            mode: "unstaged"
          }}
          onRequestHandled={onRequestHandled}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });

    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(controller?.selectedChange).toMatchObject({
      path: SECOND_CHANGE.path,
      mode: "unstaged"
    });
    expect(getDiff).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: SECOND_CHANGE.path,
        mode: "unstaged"
      })
    );
    expect(onRequestHandled).toHaveBeenCalledOnce();
    expect(onRequestHandled).toHaveBeenCalledWith(9);
  });

  it("restarts an older in-flight changes read for a later file request", async () => {
    let resolveOlderRefresh!: (
      result: Awaited<
        ReturnType<GitNestBridge["repository"]["getChanges"]>
      >
    ) => void;
    const getChanges = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: createChanges([CHANGE])
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOlderRefresh = resolve;
          })
      )
      .mockResolvedValueOnce({
        ok: true as const,
        value: createChanges([CHANGE, SECOND_CHANGE])
      });
    const getDiff = vi.fn(
      async (
        request: Parameters<
          GitNestBridge["repository"]["getDiff"]
        >[0]
      ) => ({
        ok: true as const,
        value: createDiff(
          `diff for ${request.path}`,
          request.path,
          request.mode
        )
      })
    );
    const onRequestHandled = vi.fn();
    installBridge({ getChanges, getDiff });

    await act(async () => {
      root.render(
        <Harness
          revision="revision-1"
          onRequestHandled={onRequestHandled}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });

    await act(async () => {
      root.render(
        <Harness
          revision="revision-2"
          onRequestHandled={onRequestHandled}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });
    expect(getChanges).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.render(
        <Harness
          revision="revision-2"
          request={{
            id: 10,
            target: TARGET,
            path: SECOND_CHANGE.path,
            mode: "unstaged"
          }}
          onRequestHandled={onRequestHandled}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });

    expect(getChanges).toHaveBeenCalledTimes(3);
    expect(controller?.selectedChange?.path).toBe(
      SECOND_CHANGE.path
    );
    expect(onRequestHandled).toHaveBeenCalledWith(10);

    await act(async () => {
      resolveOlderRefresh({
        ok: true,
        value: createChanges([CHANGE])
      });
      await flushAsyncWork();
    });

    expect(controller?.selectedChange?.path).toBe(
      SECOND_CHANGE.path
    );
    expect(onRequestHandled).toHaveBeenCalledOnce();
  });

  it("reports when the empty-diff change disappears after refresh", async () => {
    const getChanges = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: createChanges([CHANGE])
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: createChanges([])
      });
    const getDiff = vi.fn(async () => ({
      ok: true as const,
      value: createEmptyDiff()
    }));
    installBridge({ getChanges, getDiff });

    await act(async () => {
      root.render(
        <Harness
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });
    await act(flushAsyncWork);

    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(getDiff).toHaveBeenCalledTimes(1);
    expect(controller?.selectedChange).toBeNull();
    expect(controller?.diff).toBeNull();
    expect(controller?.diffNotice).toBe("change-removed");
  });

  it("keeps the current diff visible during a background status refresh", async () => {
    let resolveRefreshedDiff!: (
      result: Awaited<
        ReturnType<GitNestBridge["repository"]["getDiff"]>
      >
    ) => void;
    const getChanges = vi.fn(async () => ({
      ok: true as const,
      value: createChanges([CHANGE])
    }));
    const getDiff = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: createDiff("old diff")
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefreshedDiff = resolve;
          })
      );
    installBridge({ getChanges, getDiff });

    await act(async () => {
      root.render(
        <Harness
          revision="revision-1"
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });
    expect(controller?.diff?.diff.content).toBe("old diff");

    await act(async () => {
      root.render(
        <Harness
          revision="revision-2"
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });

    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(getDiff).toHaveBeenCalledTimes(2);
    expect(controller?.diff?.diff.content).toBe("old diff");

    await act(async () => {
      resolveRefreshedDiff({
        ok: true,
        value: createDiff("new diff")
      });
      await flushAsyncWork();
    });
    expect(controller?.diff?.diff.content).toBe("new diff");
  });

  it("retains current changes and diff when a same-target status revision refresh fails", async () => {
    const initialChanges = createChanges([CHANGE]);
    const loadedDiff = createDiff("current revision content");
    const getDiff = vi.fn(async () => ({ ok: true as const, value: loadedDiff }));
    installBridge({
      getChanges: vi.fn()
        .mockResolvedValueOnce({ ok: true, value: initialChanges })
        .mockResolvedValueOnce({ ok: false, error: { code: "COMMAND_FAILED", message: "状态刷新失败", details: {} } }),
      getDiff
    });
    await act(async () => {
      root.render(<Harness revision="before" onController={(value) => { controller = value; }} />);
      await flushAsyncWork();
    });
    await act(async () => {
      root.render(<Harness revision="after" onController={(value) => { controller = value; }} />);
      await flushAsyncWork();
    });
    expect(controller?.changes).toEqual(initialChanges);
    expect(controller?.diff).toEqual(loadedDiff);
    expect(controller?.selectedChange?.path).toBe(CHANGE.path);
    expect(controller?.loading.changes).toBe(false);
    expect(controller?.error?.message).toBe("状态刷新失败");
    expect(getDiff).toHaveBeenCalledOnce();
  });

  it("does not let a background refresh restore a stale selection", async () => {
    let resolveBackgroundChanges!: (
      result: Awaited<
        ReturnType<GitNestBridge["repository"]["getChanges"]>
      >
    ) => void;
    const getChanges = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: createChanges([CHANGE, SECOND_CHANGE])
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveBackgroundChanges = resolve;
          })
      );
    const getDiff = vi.fn(
      async (
        request: Parameters<
          GitNestBridge["repository"]["getDiff"]
        >[0]
      ) => ({
        ok: true as const,
        value: createDiff(
          `${request.path} diff`,
          request.path
        )
      })
    );
    installBridge({ getChanges, getDiff });

    await act(async () => {
      root.render(
        <Harness
          revision="revision-1"
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });
    expect(controller?.selectedChange?.path).toBe(CHANGE.path);

    await act(async () => {
      root.render(
        <Harness
          revision="revision-2"
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });

    await act(async () => {
      await controller?.selectChange(SECOND_CHANGE);
    });
    expect(controller?.selectedChange?.path).toBe(
      SECOND_CHANGE.path
    );
    expect(controller?.diff?.diff.path).toBe(
      SECOND_CHANGE.path
    );

    await act(async () => {
      resolveBackgroundChanges({
        ok: true,
        value: createChanges([CHANGE, SECOND_CHANGE])
      });
      await flushAsyncWork();
    });

    expect(controller?.selectedChange?.path).toBe(
      SECOND_CHANGE.path
    );
    expect(controller?.diff?.diff.path).toBe(
      SECOND_CHANGE.path
    );
  });

  it("keeps an already loaded diff visible when the same file is selected again", async () => {
    let resolveRepeatedDiff!: (
      result: Awaited<
        ReturnType<GitNestBridge["repository"]["getDiff"]>
      >
    ) => void;
    const getChanges = vi.fn(async () => ({
      ok: true as const,
      value: createChanges([CHANGE])
    }));
    const getDiff = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: createDiff("loaded diff")
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRepeatedDiff = resolve;
          })
      );
    installBridge({ getChanges, getDiff });

    await act(async () => {
      root.render(
        <Harness
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });

    act(() => {
      void controller?.selectChange(CHANGE);
    });

    expect(controller?.diff?.diff.content).toBe("loaded diff");
    expect(controller?.loading.diff).toBe(false);

    await act(async () => {
      resolveRepeatedDiff({
        ok: true,
        value: createDiff("updated diff")
      });
      await flushAsyncWork();
    });
    expect(controller?.diff?.diff.content).toBe("updated diff");
  });

  it("keeps the loaded diff visible while expanding its context", async () => {
    let resolveExpandedDiff!: (
      result: Awaited<
        ReturnType<GitNestBridge["repository"]["getDiff"]>
      >
    ) => void;
    const getChanges = vi.fn(async () => ({
      ok: true as const,
      value: createChanges([CHANGE])
    }));
    const getDiff = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: createDiff("compact diff")
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveExpandedDiff = resolve;
          })
      );
    installBridge({ getChanges, getDiff });

    await act(async () => {
      root.render(
        <Harness
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });

    expect(getDiff).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contextLines: 3
      })
    );

    act(() => {
      void controller?.selectChange(CHANGE, "unstaged", {
        contextLines: 13,
        preserveDiff: true
      });
    });

    expect(getDiff).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contextLines: 13
      })
    );
    expect(controller?.selectedChange?.contextLines).toBe(13);
    expect(controller?.diff?.diff.content).toBe("compact diff");
    expect(controller?.loading.diff).toBe(true);

    await act(async () => {
      resolveExpandedDiff({
        ok: true,
        value: createDiff("expanded diff")
      });
      await flushAsyncWork();
    });

    expect(controller?.diff?.diff.content).toBe("expanded diff");
    expect(controller?.loading.diff).toBe(false);
  });

  it.each(["old-first", "new-first"] as const)(
    "releases context loading after reselecting the same file (%s)",
    async (completionOrder) => {
      let resolveExpandedDiff!: (
        result: { ok: true; value: RepositoryDiffDto }
      ) => void;
      let resolveRepeatedDiff!: (
        result: { ok: true; value: RepositoryDiffDto }
      ) => void;
      const getDiff = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          value: createDiff("compact diff")
        })
        .mockImplementationOnce(
          () => new Promise((resolve) => {
            resolveExpandedDiff = resolve;
          })
        )
        .mockImplementationOnce(
          () => new Promise((resolve) => {
            resolveRepeatedDiff = resolve;
          })
        );
      installBridge({
        getChanges: vi.fn(async () => ({
          ok: true as const,
          value: createChanges([CHANGE])
        })),
        getDiff
      });
      await act(async () => {
        root.render(
          <Harness onController={(value) => {
            controller = value;
          }} />
        );
        await flushAsyncWork();
      });
      expect(controller?.diff?.diff.content).toBe("compact diff");

      let expanding: Promise<void> | undefined;
      act(() => {
        expanding = controller?.selectChange(CHANGE, "unstaged", {
          contextLines: 13,
          preserveDiff: true
        });
      });
      expect(controller?.loading.diff).toBe(true);

      let reselecting: Promise<void> | undefined;
      act(() => {
        reselecting = controller?.selectChange(CHANGE);
      });
      expect(getDiff).toHaveBeenCalledTimes(3);
      expect(controller?.diff?.diff.content).toBe("compact diff");

      if (completionOrder === "old-first") {
        await act(async () => {
          resolveExpandedDiff({
            ok: true,
            value: createDiff("obsolete expanded diff")
          });
          await expanding;
        });
        expect(controller?.diff?.diff.content).toBe("compact diff");
      }

      await act(async () => {
        resolveRepeatedDiff({
          ok: true,
          value: createDiff("current expanded diff")
        });
        await reselecting;
      });
      if (completionOrder === "new-first") {
        await act(async () => {
          resolveExpandedDiff({
            ok: true,
            value: createDiff("obsolete expanded diff")
          });
          await expanding;
        });
      }

      expect(controller?.diff?.diff.content).toBe("current expanded diff");
      expect(controller?.selectedChange?.contextLines).toBe(13);
      expect(controller?.loading.diff).toBe(false);
    }
  );

  it("cancels obsolete history searches and restarts pagination with the active query", async () => {
    type HistoryResult = Awaited<ReturnType<GitNestBridge["repository"]["getHistory"]>>;
    let resolveObsolete!: (value: HistoryResult) => void;
    const first = createCommitSummary();
    const matching = { ...first, hash: "matching", subject: "Matching" };
    const next = { ...first, hash: "next", subject: "Next match" };
    const getHistory = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { target: TARGET, page: { commits: [first], nextOffset: 50 } } })
      .mockImplementationOnce(() => new Promise<HistoryResult>((resolve) => { resolveObsolete = resolve; }))
      .mockResolvedValueOnce({ ok: true, value: { target: TARGET, page: { commits: [matching], nextOffset: 50 } } })
      .mockResolvedValueOnce({ ok: true, value: { target: TARGET, page: { commits: [next] } } })
      .mockResolvedValue({ ok: true, value: { target: TARGET, page: { commits: [] } } });
    const cancelQuery = vi.fn(async () => ({ ok: true as const, value: undefined }));
    installBridge({
      getHistory, cancelQuery,
      getBranches: vi.fn(async () => ({ ok: true as const, value: { target: TARGET, branches: [] } })),
      getCommit: vi.fn(async () => ({
        ok: false as const, error: { code: "COMMAND_CANCELLED" as const, message: "", details: {} }
      }))
    });
    await act(async () => {
      root.render(<Harness tab="history" onController={(value) => { controller = value; }} />);
      await flushAsyncWork();
    });
    let obsolete: Promise<void> | undefined;
    act(() => { obsolete = controller?.searchHistory({ keyword: "obsolete" }); });
    const obsoleteRequest = getHistory.mock.calls[1]![0];
    await act(async () => { await controller?.searchHistory({ keyword: "matching", path: "src" }); });
    expect(cancelQuery).toHaveBeenCalledWith({ queryId: obsoleteRequest.queryId });
    expect(getHistory.mock.calls[2]![0]).toMatchObject({
      offset: 0, search: { keyword: "matching", path: "src" }
    });
    await act(async () => {
      resolveObsolete({ ok: true, value: { target: TARGET, page: { commits: [first] } } });
      await obsolete;
    });
    expect(controller?.history?.page.commits).toEqual([matching]);
    await act(async () => { await controller?.loadMoreHistory(); });
    expect(getHistory.mock.calls[3]![0]).toMatchObject({
      offset: 50, search: { keyword: "matching", path: "src" }
    });
    expect(controller?.history?.page.commits).toEqual([matching, next]);
    await act(async () => { await controller?.selectHistoryScope({ kind: "ref", ref: "refs/heads/topic" }); });
    expect(getHistory.mock.calls[4]![0]).toMatchObject({
      offset: 0, scope: { kind: "ref", ref: "refs/heads/topic" },
      search: { keyword: "matching", path: "src" }
    });
    expect(controller?.history?.page.commits).toEqual([]);
    await act(async () => { await controller?.searchHistory(null); });
    expect(getHistory.mock.calls[5]![0]).not.toHaveProperty("search");
    expect(controller?.historySearch).toBeNull();
    expect(controller?.selectedCommitHash).toBeNull();
  });

  it("keeps history details collapsed while loading the inspector commit", async () => {
    const summary = createCommitSummary();
    const getHistory = vi.fn(
      async (): Promise<{
        ok: true;
        value: RepositoryHistoryPageDto;
      }> => ({
        ok: true,
        value: {
          target: TARGET,
          page: {
            commits: [summary]
          }
        }
      })
    );
    const getCommit = vi.fn(
      async (): Promise<{
        ok: true;
        value: RepositoryCommitDto;
      }> => ({
        ok: true,
        value: {
          target: TARGET,
          commit: {
            ...summary,
            committerName: summary.authorName,
            committerEmail: summary.authorEmail,
            committedAt: summary.authoredAt,
            body: `${summary.subject}\n\nBody`,
            refs: ["HEAD -> main"],
            files: [],
            additions: 0,
            deletions: 0
          }
        }
      })
    );
    installBridge({ getHistory, getCommit });

    await act(async () => {
      root.render(
        <Harness
          onController={(value) => {
            controller = value;
          }}
          tab="history"
        />
      );
      await flushAsyncWork();
    });
    await act(flushAsyncWork);

    expect(controller?.historyDetailOpen).toBe(false);
    expect(controller?.commit?.commit.hash).toBe(summary.hash);

    await act(async () => {
      await controller?.selectCommit(summary.hash);
      await flushAsyncWork();
    });
    expect(controller?.historyDetailOpen).toBe(true);

    await act(async () => {
      await controller?.selectCommit(summary.hash);
      await flushAsyncWork();
    });
    expect(controller?.historyDetailOpen).toBe(false);
    expect(controller?.commit?.commit.hash).toBe(summary.hash);
  });

  it("keeps the latest commit loading when an older selection fails", async () => {
    const firstSummary = createCommitSummary();
    const nextSummary = { ...firstSummary, hash: "b".repeat(40), shortHash: "bbbbbbb", subject: "Latest selection" };
    let resolveFirst!: (result: Awaited<ReturnType<GitNestBridge["repository"]["getCommit"]>>) => void;
    let resolveNext!: (result: Awaited<ReturnType<GitNestBridge["repository"]["getCommit"]>>) => void;
    installBridge({
      getHistory: vi.fn(async () => ({
        ok: true as const, value: { target: TARGET, page: { commits: [firstSummary, nextSummary] } }
      })),
      getBranches: vi.fn(async () => ({ ok: true as const, value: { target: TARGET, branches: [] } })),
      getCommit: vi.fn()
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
        .mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve; }))
    });
    await act(async () => {
      root.render(<Harness tab="history" onController={(value) => { controller = value; }} />);
      await flushAsyncWork();
    });
    let selecting: Promise<void> | undefined;
    act(() => { selecting = controller?.selectCommit(nextSummary.hash); });
    await act(async () => {
      resolveFirst({ ok: false, error: { code: "COMMAND_FAILED", message: "旧提交读取失败", details: {} } });
    });
    expect(controller?.selectedCommitHash).toBe(nextSummary.hash);
    expect(controller?.commit).toBeNull();
    expect(controller?.loading.commit).toBe(true);
    expect(controller?.error).toBeNull();
    await act(async () => {
      resolveNext({ ok: true, value: {
        target: TARGET, commit: {
          ...nextSummary, committerName: "June", committerEmail: "june@example.com",
          committedAt: nextSummary.authoredAt, body: "", refs: [], files: [], additions: 0, deletions: 0
        }
      } });
      await selecting;
    });
    expect(controller?.commit?.commit.hash).toBe(nextSummary.hash);
    expect(controller?.loading.commit).toBe(false);
    expect(controller?.historyDetailOpen).toBe(true);
  });

  it.each(["pagination-failure", "switch-comparison"] as const)(
    "keeps history data scoped during %s",
    async (scenario) => {
      const summary = createCommitSummary();
      let resolvePage!: (result: Awaited<ReturnType<GitNestBridge["repository"]["getHistory"]>>) => void;
      const initialHistory: RepositoryHistoryPageDto = {
        target: TARGET, page: { commits: [summary], nextOffset: 50 }
      };
      const comparison = {
        leftRef: "refs/heads/main", rightRef: "refs/heads/develop",
        leftOnly: 0, rightOnly: 0, mergeBase: summary.hash
      };
      installBridge({
        getHistory: vi.fn()
          .mockResolvedValueOnce({ ok: true, value: initialHistory })
          .mockImplementationOnce(() => new Promise((resolve) => { resolvePage = resolve; }))
          .mockResolvedValueOnce({ ok: true, value: { target: TARGET, page: { commits: [], comparison } } }),
        getBranches: vi.fn(async () => ({ ok: true as const, value: { target: TARGET, branches: [] } })),
        getCommit: vi.fn(async () => ({ ok: true as const, value: {
          target: TARGET, commit: {
            ...summary, committerName: "June", committerEmail: "june@example.com",
            committedAt: summary.authoredAt, body: "", refs: [], files: [], additions: 0, deletions: 0
          }
        } }))
      });
      await act(async () => {
        root.render(<Harness tab="history" onController={(value) => { controller = value; }} />);
        await flushAsyncWork();
      });
      let paginating: Promise<void> | undefined;
      act(() => { paginating = controller?.loadMoreHistory(); });
      expect(controller?.history).toEqual(initialHistory);
      expect(controller?.loading.history).toBe(true);
      if (scenario === "switch-comparison") {
        await act(async () => {
          await controller?.selectHistoryScope({
            kind: "compare", leftRef: comparison.leftRef, rightRef: comparison.rightRef
          });
        });
        await act(async () => {
          resolvePage({ ok: true, value: { target: TARGET, page: { commits: [{ ...summary, hash: "obsolete-page" }] } } });
          await paginating;
        });
        expect(controller?.history?.page.commits).toEqual([]);
        expect(controller?.history?.page.comparison).toEqual(comparison);
        expect(controller?.commit).toBeNull();
        expect(controller?.error).toBeNull();
      } else {
        await act(async () => {
          resolvePage({ ok: false, error: { code: "COMMAND_FAILED", message: "分页读取失败", details: {} } });
          await paginating;
        });
        expect(controller?.history).toEqual(initialHistory);
        expect(controller?.error?.message).toBe("分页读取失败");
      }
      expect(controller?.loading.history).toBe(false);
    }
  );

  it("loads branches and keeps the selected history scope across pagination", async () => {
    const mainCommit = createCommitSummary();
    const developCommit = {
      ...mainCommit,
      hash: "develop1234567890",
      shortHash: "develop",
      subject: "Develop commit",
      refs: ["develop"]
    };
    const getHistory = vi.fn(
      async (request: {
        offset?: number;
        scope?: {
          kind: string;
        };
      }): Promise<{
        ok: true;
        value: RepositoryHistoryPageDto;
      }> => ({
        ok: true,
        value: {
          target: TARGET,
          page: {
            commits:
              request.scope?.kind === "ref"
                ? [developCommit]
                : [mainCommit],
            ...(request.offset === 0
              ? { nextOffset: 50 }
              : {})
          }
        }
      })
    );
    const getBranches = vi.fn(async () => ({
      ok: true as const,
      value: {
        target: TARGET,
        branches: createBranches()
      }
    }));
    installBridge({ getHistory, getBranches });

    await act(async () => {
      root.render(
        <Harness
          onController={(value) => {
            controller = value;
          }}
          tab="history"
        />
      );
      await flushAsyncWork();
    });
    await act(flushAsyncWork);

    expect(getBranches).toHaveBeenCalledTimes(1);
    expect(controller?.historyScope).toBeNull();

    await act(async () => {
      await controller?.selectHistoryScope({
        kind: "ref",
        ref: "refs/heads/develop"
      });
      await flushAsyncWork();
    });

    expect(getHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({
        offset: 0,
        scope: {
          kind: "ref",
          ref: "refs/heads/develop"
        }
      })
    );
    expect(controller?.history?.page.commits[0]?.subject).toBe(
      "Develop commit"
    );

    await act(async () => {
      await controller?.loadMoreHistory();
      await flushAsyncWork();
    });

    expect(getHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({
        offset: 50,
        scope: {
          kind: "ref",
          ref: "refs/heads/develop"
        }
      })
    );
  });

  it("keeps branch comparison metadata on the loaded history page", async () => {
    const summary = createCommitSummary();
    const comparison = {
      leftRef: "refs/remotes/origin/pre-production",
      rightRef: "refs/heads/pre-production",
      leftOnly: 4,
      rightOnly: 3,
      mergeBase: "e3d9000123456789"
    };
    const getHistory = vi.fn(
      async (request: {
        scope?: {
          kind: string;
        };
      }): Promise<{
        ok: true;
        value: RepositoryHistoryPageDto;
      }> => ({
        ok: true,
        value: {
          target: TARGET,
          page: {
            commits: [
              {
                ...summary,
                ...(request.scope?.kind === "compare"
                  ? { comparisonSide: "left" as const }
                  : {})
              }
            ],
            ...(request.scope?.kind === "compare"
              ? { comparison }
              : {})
          }
        }
      })
    );
    installBridge({
      getHistory,
      getBranches: vi.fn(async () => ({
        ok: true as const,
        value: {
          target: TARGET,
          branches: createBranches()
        }
      }))
    });

    await act(async () => {
      root.render(
        <Harness
          onController={(value) => {
            controller = value;
          }}
          tab="history"
        />
      );
      await flushAsyncWork();
    });
    await act(flushAsyncWork);

    await act(async () => {
      await controller?.selectHistoryScope({
        kind: "compare",
        leftRef: comparison.leftRef,
        rightRef: comparison.rightRef
      });
      await flushAsyncWork();
    });

    expect(getHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: {
          kind: "compare",
          leftRef: comparison.leftRef,
          rightRef: comparison.rightRef
        }
      })
    );
    expect(controller?.history?.page.comparison).toEqual(
      comparison
    );
    expect(
      controller?.history?.page.commits[0]?.comparisonSide
    ).toBe("left");
  });
});

function Harness({
  target = TARGET,
  revision = "",
  tab = "changes",
  request = null,
  onRequestHandled,
  onController
}: {
  target?: RepositoryTargetDto;
  revision?: string;
  tab?: RepositoryTab;
  request?: RepositoryChangeSelectionRequest | null;
  onRequestHandled?(requestId: number): void;
  onController(value: RepositoryDetailsController): void;
}) {
  onController(
    useRepositoryDetails(
      target,
      tab,
      revision,
      request,
      onRequestHandled
    )
  );
  return null;
}

function installBridge(
  repository: Partial<GitNestBridge["repository"]>
): void {
  Object.defineProperty(window, "gitnest", {
    configurable: true,
    value: {
      repository: {
        cancelQuery: vi.fn(async () => ({
          ok: true as const,
          value: undefined
        })),
        ...repository
      }
    } as unknown as GitNestBridge
  });
}

function createChanges(
  changes: RepositoryChangesDto["snapshot"]["changes"]
): RepositoryChangesDto {
  return {
    target: TARGET,
    snapshot: {
      branch: "main",
      head: "abcdef123456",
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: changes.length,
      untracked: 0,
      conflicted: 0,
      changes,
      refreshedAt: "2026-09-08T00:00:00.000Z"
    }
  };
}

function createCommitSummary(): CommitSummaryDto {
  return {
    hash: "abcdef1234567890",
    shortHash: "abcdef1",
    authorName: "June",
    authorEmail: "june@example.com",
    authoredAt: "2026-09-04T10:00:00+08:00",
    subject: "Initial commit",
    parentHashes: [],
    refs: ["HEAD -> main", "origin/main"]
  };
}

function createBranches(): BranchDto[] {
  return [
    {
      fullName: "refs/heads/main",
      name: "main",
      head: "abcdef1234567890",
      upstream: "origin/main",
      current: true,
      remote: false
    },
    {
      fullName: "refs/heads/develop",
      name: "develop",
      head: "develop1234567890",
      current: false,
      remote: false
    },
    {
      fullName: "refs/remotes/origin/main",
      name: "origin/main",
      head: "abcdef1234567890",
      current: false,
      remote: true
    }
  ];
}

function createEmptyDiff(): RepositoryDiffDto {
  return createDiff("");
}

function createDiff(
  content: string,
  path: string = CHANGE.path,
  mode: RepositoryDiffDto["diff"]["mode"] = "unstaged"
): RepositoryDiffDto {
  return {
    target: TARGET,
    diff: {
      path,
      mode,
      content,
      binary: false,
      truncated: false,
      additions: 0,
      deletions: 0
    }
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
