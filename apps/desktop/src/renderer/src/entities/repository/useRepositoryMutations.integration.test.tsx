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
  GitNestBridge,
  RepositoryTargetDto
} from "@gitnest/contracts";

import {
  useRepositoryMutations,
  type RepositoryMutationController
} from "./useRepositoryMutations";

const TARGET_A: RepositoryTargetDto = {
  repositoryId: "repository-a",
  worktreeId: "worktree-a"
};
const TARGET_B: RepositoryTargetDto = {
  repositoryId: "repository-b",
  worktreeId: "worktree-b"
};
const CHANGE = {
  path: "file.txt",
  indexStatus: ".",
  worktreeStatus: "M",
  kind: "ordinary"
} as const;

describe("useRepositoryMutations", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: RepositoryMutationController | undefined;

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

  it("keeps a created commit successful when the following refresh rejects", async () => {
    const createCommit = vi.fn(async () => ({
      ok: true,
      value: {
        operationId: "commit-refresh-failure",
        target: TARGET_A,
        commit: { shortHash: "abc1234" }
      }
    }));
    Object.defineProperty(window, "gitnest", {
      configurable: true,
      value: { repository: { createCommit } } as unknown as GitNestBridge
    });
    const afterMutation = vi.fn(async () => {
      throw new Error("读取仓库状态失败");
    });
    await act(async () => {
      root.render(
        <Harness
          hooks={{ beforeMutation() {}, afterMutation }}
          target={TARGET_A}
          onController={(value) => { controller = value; }}
        />
      );
    });

    let committed: boolean | undefined;
    await act(async () => {
      committed = await controller?.createCommit("修复提交");
    });

    expect(committed).toBe(true);
    expect(createCommit).toHaveBeenCalledTimes(1);
    expect(controller?.error).toBeNull();
    expect(controller?.notice).toContain("提交 abc1234 已创建");
    expect(controller?.notice).toContain("状态刷新失败");
    expect(controller?.active).toBeNull();
  });

  it.each(["switch", "roundtrip", "unmount"] as const)(
    "rejects mutation entry points retained before %s",
    async (navigation) => {
      const invoke = vi.fn(async () => ({
        ok: true,
        value: { operationId: "obsolete", target: TARGET_A, commit: { shortHash: "abcdef0" } }
      }));
      Object.defineProperty(window, "gitnest", {
        configurable: true,
        value: {
          repository: { stage: invoke, unstage: invoke, discard: invoke, createCommit: invoke }
        } as unknown as GitNestBridge
      });
      const hooks = { beforeMutation: vi.fn(), afterMutation: vi.fn(async () => undefined) };
      const renderTarget = (target: RepositoryTargetDto) => act(() => {
        root.render(<Harness target={target} hooks={hooks} onController={(value) => { controller = value; }} />);
      });
      renderTarget(TARGET_A);
      const previous = controller!;
      if (navigation === "unmount") {
        act(() => { root.render(null); });
      } else {
        renderTarget(TARGET_B);
        if (navigation === "roundtrip") {
          renderTarget(TARGET_A);
        }
      }
      const results: boolean[] = [];
      await act(async () => {
        results.push(await previous.stageChange(CHANGE));
        results.push(await previous.unstageChange(CHANGE));
        results.push(await previous.discardChange(CHANGE));
        results.push(await previous.stageChanges([CHANGE]));
        results.push(await previous.unstageChanges([CHANGE]));
        results.push(await previous.discardChanges([CHANGE]));
        results.push(await previous.createCommit("obsolete commit"));
      });
      expect(invoke).not.toHaveBeenCalled();
      expect(hooks.beforeMutation).not.toHaveBeenCalled();
      expect(results).toEqual(Array(7).fill(false));
      if (navigation !== "unmount") {
        await act(async () => {
          expect(await controller!.stageChange(CHANGE)).toBe(true);
        });
        act(() => { previous.clearFeedback(); });
        expect(controller!.notice).toBe("所选文件已暂存。");
      }
    }
  );

  it("blocks duplicate writes while refreshing and permits retry after a failed write", async () => {
    const refresh = deferred<void>();
    const stage = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "COMMAND_FAILED", message: "索引已锁定", details: {} }
      })
      .mockResolvedValue({
        ok: true,
        value: { operationId: "stage-retry", target: TARGET_A }
      });
    Object.defineProperty(window, "gitnest", {
      configurable: true,
      value: { repository: { stage } } as unknown as GitNestBridge
    });
    await act(async () => {
      root.render(
        <Harness
          hooks={{ beforeMutation() {}, afterMutation: () => refresh.promise }}
          target={TARGET_A}
          onController={(value) => { controller = value; }}
        />
      );
    });
    await act(async () => {
      expect(await controller?.stageChange(CHANGE)).toBe(false);
    });
    expect(controller?.active).toBeNull();

    let retry: Promise<boolean> | undefined;
    await act(async () => {
      retry = controller?.stageChange(CHANGE);
      expect(await controller?.stageChange(CHANGE)).toBe(false);
    });
    expect(controller?.active).toBe("stage");
    expect(stage).toHaveBeenCalledTimes(2);
    await act(async () => {
      expect(await controller?.stageChange(CHANGE)).toBe(false);
      refresh.resolve();
      expect(await retry).toBe(true);
    });
    expect(stage).toHaveBeenCalledTimes(2);
    expect(controller?.error).toBeNull();
    expect(controller?.active).toBeNull();
  });

  for (const operation of ["stage", "discard", "unstage"] as const) {
    for (const batch of [false, true]) {
      it(`sends the ${operation} paths for a staged rename${batch ? " from the batch entry" : ""}`, async () => {
          const invoke = vi.fn(async () => ({
            ok: true,
            value: { operationId: "rename-fixture", target: TARGET_A }
          }));
          Object.defineProperty(window, "gitnest", {
            configurable: true,
            value: {
              repository: { [operation]: invoke }
            } as unknown as GitNestBridge
          });
          await act(async () => {
            root.render(
              <Harness
                hooks={{
                  beforeMutation() {},
                  async afterMutation() {}
                }}
                target={TARGET_A}
                onController={(value) => { controller = value; }}
              />
            );
          });
          const change = {
            path: "after.txt",
            kind: "renamed",
            indexStatus: "R",
            worktreeStatus: "M",
            originalPath: "before.txt"
          } as const;
          let completed: boolean | undefined;
          await act(async () => {
            completed = batch
              ? await controller![`${operation}Changes`]([change])
              : await controller![`${operation}Change`](change);
          });
          expect(controller?.error).toBeNull();
          expect(completed).toBe(true);
          expect(invoke).toHaveBeenCalledWith({
            target: TARGET_A,
            paths: operation === "unstage"
              ? ["after.txt", "before.txt"]
              : ["after.txt"],
            ...(operation === "discard" ? { expectedUntrackedPaths: [] } : {})
          });
      });
    }
  }

  it.each([false, true])("forwards the confirmed deletion paths for untracked discard (batch: %s)", async (batch) => {
    const discard = vi.fn(async () => ({
      ok: true, value: { operationId: "discard-untracked", target: TARGET_A }
    }));
    Object.defineProperty(window, "gitnest", {
      configurable: true,
      value: { repository: { discard } } as unknown as GitNestBridge
    });
    await act(async () => {
      root.render(<Harness
        hooks={{ beforeMutation() {}, async afterMutation() {} }}
        target={TARGET_A}
        onController={(value) => { controller = value; }}
      />);
    });
    const untracked = {
      path: "new.txt", kind: "untracked", indexStatus: "?", worktreeStatus: "?"
    } as const;
    await act(async () => {
      if (batch) {
        await controller?.discardChanges([CHANGE, untracked]);
      } else {
        await controller?.discardChange(untracked);
      }
    });
    expect(discard).toHaveBeenCalledWith({
      target: TARGET_A,
      paths: batch ? ["file.txt", "new.txt"] : ["new.txt"],
      expectedUntrackedPaths: ["new.txt"]
    });
  });

  it("releases the old mutation lock when the selected target changes", async () => {
    const targetAStage = deferred<
      Awaited<
        ReturnType<GitNestBridge["repository"]["stage"]>
      >
    >();
    const targetBStage = deferred<
      Awaited<
        ReturnType<GitNestBridge["repository"]["stage"]>
      >
    >();
    const stage = vi.fn(
      (
        request: Parameters<
          GitNestBridge["repository"]["stage"]
        >[0]
      ) =>
        request.target.repositoryId === TARGET_A.repositoryId
          ? targetAStage.promise
          : targetBStage.promise
    );
    Object.defineProperty(window, "gitnest", {
      configurable: true,
      value: {
        repository: { stage }
      } as unknown as GitNestBridge
    });
    const beforeMutation = vi.fn();
    const afterMutation = vi.fn(async () => undefined);
    const hooks = { beforeMutation, afterMutation };

    await act(async () => {
      root.render(
        <Harness
          hooks={hooks}
          target={TARGET_A}
          onController={(value) => {
            controller = value;
          }}
        />
      );
    });

    let mutation!: Promise<boolean>;
    act(() => {
      mutation = controller?.stageChange(
        CHANGE
      ) as Promise<boolean>;
    });
    expect(stage).toHaveBeenCalledWith({
      target: TARGET_A,
      paths: ["file.txt"]
    });

    await act(async () => {
      root.render(
        <Harness
          hooks={hooks}
          target={TARGET_B}
          onController={(value) => {
            controller = value;
          }}
        />
      );
    });
    expect(controller?.active).toBeNull();

    let nextMutation!: Promise<boolean>;
    act(() => {
      nextMutation = controller?.stageChange(
        CHANGE
      ) as Promise<boolean>;
    });
    expect(stage).toHaveBeenLastCalledWith({
      target: TARGET_B,
      paths: ["file.txt"]
    });
    expect(controller?.active).toBe("stage");

    let oldCompleted: boolean | undefined;
    await act(async () => {
      targetAStage.resolve({
        ok: true,
        value: {
          target: TARGET_A,
          operationId: "operation-stage"
        }
      });
      oldCompleted = await mutation;
    });

    expect(oldCompleted).toBe(false);
    expect(controller?.active).toBe("stage");

    let nextCompleted: boolean | undefined;
    await act(async () => {
      targetBStage.resolve({
        ok: true,
        value: {
          target: TARGET_B,
          operationId: "operation-stage-b"
        }
      });
      nextCompleted = await nextMutation;
    });

    expect(nextCompleted).toBe(true);
    expect(beforeMutation).toHaveBeenCalledTimes(2);
    expect(afterMutation).toHaveBeenCalledTimes(1);
    expect(controller?.notice).toBe("所选文件已暂存。");
    expect(controller?.active).toBeNull();
    expect(controller?.error).toBeNull();
  });

  it("does not apply a late mutation result after the selected target changes", async () => {
    const targetAStage = deferred<
      Awaited<
        ReturnType<GitNestBridge["repository"]["stage"]>
      >
    >();
    const stage = vi.fn(() => targetAStage.promise);
    Object.defineProperty(window, "gitnest", {
      configurable: true,
      value: {
        repository: { stage }
      } as unknown as GitNestBridge
    });
    const beforeMutation = vi.fn();
    const afterMutation = vi.fn(async () => undefined);
    const hooks = { beforeMutation, afterMutation };

    await act(async () => {
      root.render(
        <Harness
          hooks={hooks}
          target={TARGET_A}
          onController={(value) => {
            controller = value;
          }}
        />
      );
    });

    let mutation!: Promise<boolean>;
    act(() => {
      mutation = controller?.stageChange(
        CHANGE
      ) as Promise<boolean>;
    });

    await act(async () => {
      root.render(
        <Harness
          hooks={hooks}
          target={TARGET_B}
          onController={(value) => {
            controller = value;
          }}
        />
      );
    });

    let completed: boolean | undefined;
    await act(async () => {
      targetAStage.resolve({
        ok: true,
        value: {
          target: TARGET_A,
          operationId: "operation-stage"
        }
      });
      completed = await mutation;
    });

    expect(completed).toBe(false);
    expect(beforeMutation).toHaveBeenCalledTimes(1);
    expect(afterMutation).not.toHaveBeenCalled();
    expect(controller?.notice).toBeNull();
    expect(controller?.error).toBeNull();
  });
});

function Harness({
  target,
  hooks,
  onController
}: {
  target: RepositoryTargetDto;
  hooks: {
    beforeMutation(): void;
    afterMutation(): Promise<void>;
  };
  onController(value: RepositoryMutationController): void;
}) {
  onController(useRepositoryMutations(target, hooks));
  return null;
}

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve(value: Value): void;
} {
  let resolvePromise!: (value: Value) => void;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: resolvePromise
  };
}
