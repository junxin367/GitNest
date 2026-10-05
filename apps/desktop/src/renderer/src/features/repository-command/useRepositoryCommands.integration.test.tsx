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
  RepositoryCommandDto,
  RepositoryCommandPreflightDto,
  RepositoryTargetDto,
  WorkspaceOperationDto
} from "@gitnest/contracts";

import {
  useRepositoryCommands,
  type RepositoryCommandController
} from "./useRepositoryCommands";

const TARGET_A: RepositoryTargetDto = {
  repositoryId: "repository-a",
  worktreeId: "worktree-a"
};
const TARGET_B: RepositoryTargetDto = {
  repositoryId: "repository-b",
  worktreeId: "worktree-b"
};

describe("useRepositoryCommands", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: RepositoryCommandController | undefined;

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

  it("automatically executes Fetch and observes its queued terminal state", async () => {
    const preflightCommand = vi.fn(async () => ({
      ok: true as const,
      value: createPreflight({
        type: "fetch",
        targets: [TARGET_A],
        prune: false
      }, false)
    }));
    const executeCommand = vi.fn(async () => ({
      ok: true as const,
      value: {
        operationIds: ["operation_1"]
      }
    }));
    installBridge({ preflightCommand, executeCommand });
    await renderHarness(TARGET_A, []);

    let accepted = false;
    await act(async () => {
      accepted =
        (await controller?.request({
          type: "fetch",
          targets: [TARGET_A]
        })) ?? false;
    });

    expect(accepted).toBe(true);
    expect(controller?.preflight).toBeNull();
    expect(executeCommand).toHaveBeenCalledWith({
      command: {
        type: "fetch",
        targets: [TARGET_A],
        prune: false
      },
      preflightId: "preflight_1",
      confirmed: false
    });
    expect(controller?.notice).toContain("已加入操作中心");

    await renderHarness(TARGET_A, [
      createOperation("operation_1", "succeeded")
    ]);
    expect(controller?.completionVersion).toBe(1);
    expect(controller?.notice).toBe("Fetch 已完成。");
  });

  it("holds Pull behind explicit confirmation", async () => {
    const command: RepositoryCommandDto = {
      type: "pull",
      targets: [TARGET_A],
      strategy: "ff-only"
    };
    const preflight = createPreflight(command, true);
    const preflightCommand = vi.fn(async () => ({
      ok: true as const,
      value: preflight
    }));
    const executeCommand = vi.fn(async () => ({
      ok: true as const,
      value: {
        operationIds: ["operation_2"]
      }
    }));
    installBridge({ preflightCommand, executeCommand });
    await renderHarness(TARGET_A, []);

    await act(async () => {
      await controller?.request(command);
    });
    expect(controller?.preflight).toEqual(preflight);
    expect(executeCommand).not.toHaveBeenCalled();

    let confirmed = false;
    await act(async () => {
      confirmed = (await controller?.confirm()) ?? false;
    });
    expect(confirmed).toBe(true);
    expect(executeCommand).toHaveBeenCalledWith({
      command,
      preflightId: "preflight_1",
      confirmed: true
    });
    expect(controller?.preflight).toBeNull();
  });

  it.each([
    ["failed", "succeeded", false],
    ["failed", "cancelled", false],
    ["interrupted", "succeeded", false],
    ["cancelled", "succeeded", false],
    ["failed", "succeeded", true]
  ] as const)("retains earlier %s feedback when the rest of the batch is %s (dismissed: %s)", async (firstState, lastState, dismissFeedback) => {
    const command: RepositoryCommandDto = { type: "fetch", targets: [TARGET_A, TARGET_B] };
    const executeCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { operationIds: ["first", "last"] } })
      .mockResolvedValueOnce({ ok: true, value: { operationIds: ["retry"] } });
    installBridge({
      preflightCommand: vi.fn(async () => ({ ok: true as const, value: createPreflight(command, false) })),
      executeCommand,
      cancelOperation: vi.fn(async () => ({ ok: true as const, value: undefined }))
    });
    await renderHarness(TARGET_A, []);
    await act(async () => {
      expect(await controller!.request(command)).toBe(true);
    });
    const first = { ...createOperation("first", firstState), message: "第一个仓库未完成" };
    const last = {
      ...createOperation("last", "running"),
      targetIds: [`${TARGET_B.repositoryId}:${TARGET_B.worktreeId}`]
    };
    await renderHarness(TARGET_A, [first, last]);
    expect(controller!.busy).toBe(true);
    if (lastState === "cancelled") {
      await act(async () => { expect(await controller!.cancelOperation("last")).toBe(true); });
      expect(controller!.error?.message).toBe("第一个仓库未完成");
      expect(controller!.notice).toBeNull();
    }
    if (dismissFeedback) {
      act(() => { controller!.clearFeedback(); });
      expect(controller!.error).toBeNull();
    }
    // The history may trim the first terminal record before the other target finishes.
    await renderHarness(TARGET_A, [{ ...last, state: lastState, message: "第二个仓库已结束" }]);
    expect(controller!.busy).toBe(false);
    expect(controller!.completionVersion).toBe(2);
    if (firstState === "cancelled") {
      expect(controller!.notice).toBe("第一个仓库未完成");
    } else {
      expect(controller!.error?.message).toBe("第一个仓库未完成");
      expect(controller!.notice).toBeNull();
    }
    await act(async () => {
      expect(await controller!.request(command)).toBe(true);
    });
    expect(controller!.error).toBeNull();
    await renderHarness(TARGET_A, [createOperation("retry", "succeeded")]);
    expect(controller!.error).toBeNull();
    expect(controller!.notice).toBe("Fetch 已完成。");
  });

  it("ignores a late preflight after the selected target changes", async () => {
    let resolvePreflight!: (
      result: Awaited<
        ReturnType<
          GitNestBridge["repository"]["preflightCommand"]
        >
      >
    ) => void;
    const preflightCommand = vi.fn(
      () =>
        new Promise<
          Awaited<
            ReturnType<
              GitNestBridge["repository"]["preflightCommand"]
            >
          >
        >((resolve) => {
          resolvePreflight = resolve;
        })
    );
    const executeCommand = vi.fn();
    installBridge({ preflightCommand, executeCommand });
    await renderHarness(TARGET_A, []);

    let pending!: Promise<boolean>;
    act(() => {
      pending = controller?.request({
        type: "pull",
        targets: [TARGET_A],
        strategy: "ff-only"
      }) as Promise<boolean>;
    });
    await renderHarness(TARGET_B, []);

    let accepted = true;
    await act(async () => {
      resolvePreflight({
        ok: true,
        value: createPreflight(
          {
            type: "pull",
            targets: [TARGET_A],
            strategy: "ff-only"
          },
          true
        )
      });
      accepted = await pending;
    });

    expect(accepted).toBe(false);
    expect(controller?.preflight).toBeNull();
    expect(controller?.error).toBeNull();
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it("turns stale preflight failures into actionable feedback", async () => {
    const preflightCommand = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: "PREFLIGHT_CHANGED" as const,
        message: "Remote refs changed.",
        details: {}
      }
    }));
    installBridge({
      preflightCommand,
      executeCommand: vi.fn()
    });
    await renderHarness(TARGET_A, []);

    await act(async () => {
      await controller?.request({
        type: "fetch",
        targets: [TARGET_A]
      });
    });
    expect(controller?.error).toMatchObject({
      code: "PREFLIGHT_CHANGED",
      message: expect.stringContaining("请重新预检")
    });
  });

  it("clears a pending confirmation when switching Workspaces with the same repository", async () => {
    const command: RepositoryCommandDto = {
      type: "pull",
      targets: [TARGET_A],
      strategy: "ff-only"
    };
    const executeCommand = vi.fn();
    installBridge({
      preflightCommand: vi.fn(async () => ({
        ok: true as const,
        value: createPreflight(command, true)
      })),
      executeCommand
    });
    await renderHarness(TARGET_A, [], "workspace-a");
    await act(async () => {
      await controller!.request(command);
    });
    expect(controller?.preflight).not.toBeNull();

    await renderHarness(TARGET_A, [], "workspace-b");
    expect(controller?.preflight).toBeNull();
    expect(await controller!.confirm()).toBe(false);
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it("does not submit the next batch through a request captured in another Workspace", async () => {
    const preflightCommand = vi.fn();
    installBridge({ preflightCommand, executeCommand: vi.fn() });
    await renderHarness(TARGET_A, [], "workspace-a");
    const oldRequest = controller!.request;
    await renderHarness(TARGET_A, [], "workspace-b");
    expect(await oldRequest({
      type: "fetch",
      targets: [TARGET_A]
    })).toBe(false);
    expect(preflightCommand).not.toHaveBeenCalled();
  });

  it("delegates operation cancellation and reports the cancelling state", async () => {
    const cancelOperation = vi.fn(async () => ({
      ok: true as const,
      value: undefined
    }));
    installBridge({
      preflightCommand: vi.fn(),
      executeCommand: vi.fn(),
      cancelOperation
    });
    await renderHarness(TARGET_A, []);

    let cancelled = false;
    await act(async () => {
      cancelled =
        (await controller?.cancelOperation("operation_3")) ??
        false;
    });
    expect(cancelled).toBe(true);
    expect(cancelOperation).toHaveBeenCalledWith({
      operationId: "operation_3"
    });
    expect(controller?.notice).toBe("正在取消仓库操作…");
  });

  it("rejects a captured confirmation after its Workspace is replaced", async () => {
    const command: RepositoryCommandDto = { type: "pull", targets: [TARGET_A], strategy: "ff-only" };
    const executeCommand = vi.fn(async () => ({ ok: true as const, value: { operationIds: ["old"] } }));
    installBridge({
      preflightCommand: vi.fn(async () => ({ ok: true as const, value: createPreflight(command, true) })),
      executeCommand
    });
    await renderHarness(TARGET_A, [], "workspace-a");
    await act(async () => { await controller!.request(command); });
    const confirm = controller!.confirm;
    await renderHarness(TARGET_A, [], "workspace-b");
    await act(async () => { expect(await confirm()).toBe(false); });
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it("does not replay a dismissed confirmation or replace a pending confirmation", async () => {
    const command: RepositoryCommandDto = { type: "pull", targets: [TARGET_A], strategy: "ff-only" };
    const preflightCommand = vi.fn(async () => ({ ok: true as const, value: createPreflight(command, true) }));
    const executeCommand = vi.fn(async () => ({ ok: true as const, value: { operationIds: ["old"] } }));
    installBridge({ preflightCommand, executeCommand });
    await renderHarness(TARGET_A, []);
    await act(async () => { await controller!.request(command); });
    const confirm = controller!.confirm;
    await act(async () => { expect(await controller!.request(command)).toBe(false); });
    expect(preflightCommand).toHaveBeenCalledTimes(1);
    act(() => { controller!.dismissPreflight(); });
    await act(async () => { expect(await confirm()).toBe(false); });
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it("ignores cancellation feedback after a Workspace switch", async () => {
    const result = deferred<Awaited<ReturnType<GitNestBridge["repository"]["cancelOperation"]>>>();
    installBridge({ cancelOperation: vi.fn(() => result.promise) });
    await renderHarness(TARGET_A, [], "workspace-a");
    let pending!: Promise<boolean>;
    act(() => { pending = controller!.cancelOperation("old"); });
    await renderHarness(TARGET_A, [], "workspace-b");
    await act(async () => {
      result.resolve({ ok: true, value: undefined });
      expect(await pending).toBe(false);
    });
    expect(controller!.notice).toBeNull();
    expect(controller!.error).toBeNull();
  });

  it("rejects duplicate target submissions while permitting disjoint Fetch batches and failure retry", async () => {
    const preflightCommand = vi.fn(async ({ command }: { command: RepositoryCommandDto }) => ({
      ok: true as const, value: createPreflight(command, false)
    }));
    const executeCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { operationIds: ["operation-a"] } })
      .mockResolvedValueOnce({ ok: true, value: { operationIds: ["operation-b"] } })
      .mockRejectedValueOnce(new Error("submission failed"))
      .mockResolvedValueOnce({ ok: true, value: { operationIds: ["operation-retry"] } });
    installBridge({ preflightCommand, executeCommand });
    await renderHarness(TARGET_A, []);
    const request = controller!.request;
    await act(async () => {
      expect(await request({ type: "fetch", targets: [TARGET_A] })).toBe(true);
      expect(await request({ type: "fetch", targets: [TARGET_A] })).toBe(false);
      expect(await request({ type: "fetch", targets: [TARGET_B] })).toBe(true);
    });
    await renderHarness(TARGET_A, [createOperation("operation-a", "failed")]);
    await act(async () => {
      expect(await controller!.request({ type: "fetch", targets: [TARGET_A] })).toBe(false);
    });
    expect(controller!.error?.message).toContain("submission failed");
    expect(controller!.error?.message).toContain("Fetch 状态已更新。");
    await act(async () => {
      expect(await controller!.request({ type: "fetch", targets: [TARGET_A] })).toBe(true);
    });
    expect(executeCommand).toHaveBeenCalledTimes(4);
  });

  it("does not execute an automatic preflight returned after unmount", async () => {
    const result = deferred<Awaited<ReturnType<GitNestBridge["repository"]["preflightCommand"]>>>();
    const executeCommand = vi.fn();
    installBridge({ preflightCommand: vi.fn(() => result.promise), executeCommand });
    await renderHarness(TARGET_A, []);
    const request = controller!.request;
    const command: RepositoryCommandDto = { type: "fetch", targets: [TARGET_A] };
    let pending!: Promise<boolean>;
    act(() => { pending = request(command); });
    act(() => { root.render(null); });
    await act(async () => {
      result.resolve({ ok: true, value: createPreflight(command, false) });
      expect(await pending).toBe(false);
      expect(await request(command)).toBe(false);
    });
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it.each(["accepted", "partially-accepted"] as const)(
    "keeps earlier partial-submission errors when a disjoint chunk is %s",
    async (nextResult) => {
      const firstError = { code: "INVALID_REQUEST" as const, message: "第一批部分目标已删除", details: {} };
      const secondError = { code: "INVALID_REQUEST" as const, message: "第二批部分目标不可用", details: {} };
      installBridge({
        preflightCommand: vi.fn(async ({ command }) => ({
          ok: true as const, value: createPreflight(command, false)
        })),
        executeCommand: vi.fn()
          .mockResolvedValueOnce({ ok: true, value: { operationIds: ["first"], submissionError: firstError } })
          .mockResolvedValueOnce({
            ok: true,
            value: {
              operationIds: ["second"],
              ...(nextResult === "partially-accepted" ? { submissionError: secondError } : {})
            }
          })
      });
      await renderHarness(TARGET_A, []);
      await act(async () => {
        expect(await controller!.request({ type: "fetch", targets: [TARGET_A] })).toBe(false);
      });
      await act(async () => {
        expect(await controller!.request({ type: "fetch", targets: [TARGET_B] })).toBe(nextResult === "accepted");
      });
      expect(controller!.error?.message).toContain(firstError.message);
      if (nextResult === "partially-accepted") {
        expect(controller!.error?.message).toContain(secondError.message);
      }
      expect(controller!.notice).toBeNull();
      await renderHarness(TARGET_A, [
        createOperation("first", "succeeded"),
        { ...createOperation("second", "succeeded"), targetIds: ["repository-b:worktree-b"] }
      ]);
      expect(controller!.error?.message).toContain(firstError.message);
      if (nextResult === "partially-accepted") {
        expect(controller!.error?.message).toContain(secondError.message);
      }
      expect(controller!.notice).toBeNull();
    }
  );

  it.each(["failed", "cancelled"] as const)(
    "keeps an earlier %s outcome when another disjoint batch is submitted",
    async (firstState) => {
      const targetC = { repositoryId: "repository-c", worktreeId: "worktree-c" };
      installBridge({
        preflightCommand: vi.fn(async ({ command }) => ({
          ok: true as const, value: createPreflight(command, false)
        })),
        executeCommand: vi.fn()
          .mockResolvedValueOnce({ ok: true, value: { operationIds: ["first", "remaining"] } })
          .mockResolvedValueOnce({ ok: true, value: { operationIds: ["new"] } })
      });
      await renderHarness(TARGET_A, []);
      await act(async () => { await controller!.request({ type: "fetch", targets: [TARGET_A, TARGET_B] }); });
      const remaining = {
        ...createOperation("remaining", "running"), targetIds: ["repository-b:worktree-b"]
      };
      await renderHarness(TARGET_A, [
        { ...createOperation("first", firstState), message: "前批次已有目标未完成" }, remaining
      ]);
      await act(async () => {
        expect(await controller!.request({ type: "fetch", targets: [targetC] })).toBe(true);
      });
      expect(controller!.error?.message ?? controller!.notice).toBe("前批次已有目标未完成");
      await renderHarness(TARGET_A, [
        { ...remaining, state: "succeeded" },
        { ...createOperation("new", "succeeded"), targetIds: ["repository-c:worktree-c"] }
      ]);
      expect(controller!.error?.message ?? controller!.notice).toBe("前批次已有目标未完成");
    }
  );

  it.each(["preflight", "execute", "rejection"] as const)(
    "does not replace a new %s failure with an older operation's success",
    async (failureStage) => {
      const failure = { code: "COMMAND_FAILED" as const, message: "新批次未能入队", details: {} };
      const preflightCommand = vi.fn<GitNestBridge["repository"]["preflightCommand"]>(async ({ command }) => ({
        ok: true as const, value: createPreflight(command, false)
      }));
      const executeCommand = vi.fn()
        .mockResolvedValueOnce({ ok: true, value: { operationIds: ["old"] } })
        .mockResolvedValue({ ok: false, error: failure });
      installBridge({ preflightCommand, executeCommand });
      await renderHarness(TARGET_A, []);
      await act(async () => { await controller!.request({ type: "fetch", targets: [TARGET_A] }); });
      if (failureStage === "preflight") {
        preflightCommand.mockResolvedValueOnce({ ok: false, error: failure });
      } else if (failureStage === "rejection") {
        executeCommand.mockRejectedValueOnce(new Error(failure.message));
      }
      await act(async () => {
        expect(await controller!.request({ type: "fetch", targets: [TARGET_B] })).toBe(false);
      });
      expect(controller!.error?.message).toBe(failure.message);
      await renderHarness(TARGET_A, [createOperation("old", "succeeded")]);
      expect(controller!.error?.message).toBe(failure.message);
      expect(controller!.notice).toBeNull();
    }
  );

  it("does not reuse callbacks after leaving and returning to the same Workspace", async () => {
    const preflightCommand = vi.fn();
    const cancelOperation = vi.fn();
    installBridge({ preflightCommand, cancelOperation });
    await renderHarness(TARGET_A, [], "workspace-a");
    const old = controller!;
    await renderHarness(TARGET_A, [], "workspace-b");
    await renderHarness(TARGET_A, [], "workspace-a");
    await act(async () => {
      expect(await old.request({ type: "fetch", targets: [TARGET_A] })).toBe(false);
      expect(await old.cancelOperation("old")).toBe(false);
    });
    expect(preflightCommand).not.toHaveBeenCalled();
    expect(cancelOperation).not.toHaveBeenCalled();
  });

  it("does not publish an old completion delivered in the same render as a scope switch", async () => {
    installBridge({
      preflightCommand: vi.fn(async ({ command }) => ({
        ok: true as const, value: createPreflight(command, false)
      })),
      executeCommand: vi.fn(async () => ({ ok: true as const, value: { operationIds: ["old"] } }))
    });
    await renderHarness(TARGET_A, []);
    await act(async () => { await controller!.request({ type: "fetch", targets: [TARGET_A] }); });
    const previousCompletionVersion = controller!.completionVersion;
    await renderHarness(TARGET_B, [
      { ...createOperation("old", "failed"), message: "旧仓库失败" }
    ]);
    expect(controller!.error).toBeNull();
    expect(controller!.notice).toBeNull();
    expect(controller!.busy).toBe(false);
    expect(controller!.completionVersion).toBe(previousCompletionVersion);
  });
  it("blocks requests for a running target without blocking another target", async () => {
    const preflightCommand = vi.fn(async ({ command }: { command: RepositoryCommandDto }) => ({
      ok: true as const, value: createPreflight(command, false)
    }));
    installBridge({
      preflightCommand,
      executeCommand: vi.fn(async () => ({ ok: true as const, value: { operationIds: ["new"] } }))
    });
    await renderHarness(TARGET_A, [createOperation("existing", "running")]);
    await act(async () => {
      expect(await controller!.request({ type: "fetch", targets: [TARGET_A] })).toBe(false);
      expect(await controller!.request({ type: "fetch", targets: [TARGET_B] })).toBe(true);
    });
    expect(preflightCommand).toHaveBeenCalledTimes(1);
  });

  it.each(["succeeded", "failed"] as const)(
    "tracks accepted operations and retains partial submission feedback after %s",
    async (state) => {
      const command: RepositoryCommandDto = {
        type: "fetch",
        targets: [TARGET_A, TARGET_B]
      };
      const executeCommand = vi.fn<GitNestBridge["repository"]["executeCommand"]>(async () => ({
        ok: true as const,
        value: {
          operationIds: ["accepted"],
          submissionError: {
            code: "INVALID_REQUEST" as const,
            message: "Second target was removed.",
            details: {}
          }
        }
      }));
      installBridge({
        preflightCommand: vi.fn(async () => ({
          ok: true as const, value: createPreflight(command, false)
        })),
        executeCommand
      });
      await renderHarness(TARGET_A, []);
      await act(async () => {
        expect(await controller!.request(command)).toBe(false);
      });
      expect(controller!.busy).toBe(true);
      expect(controller!.notice).toBeNull();
      expect(controller!.error?.message).toContain("已有 1 个仓库操作入队");
      expect(controller!.error?.message).toContain("Second target was removed.");
      await act(async () => {
        expect(await controller!.request(command)).toBe(false);
      });
      expect(executeCommand).toHaveBeenCalledTimes(1);

      act(() => { controller!.clearFeedback(); });
      expect(controller!.error).toBeNull();
      await renderHarness(TARGET_A, [createOperation("accepted", state)]);
      expect(controller!.busy).toBe(false);
      expect(controller!.notice).toBeNull();
      expect(controller!.error?.message).toContain("Second target was removed.");
      expect(controller!.completionVersion).toBe(1);
      executeCommand.mockResolvedValueOnce({
        ok: true,
        value: { operationIds: ["retry"] }
      });
      await act(async () => {
        expect(await controller!.request(command)).toBe(true);
      });
      expect(controller!.error).toBeNull();
      await renderHarness(TARGET_B, [], "another-workspace");
      expect(controller!.error).toBeNull();
    }
  );

  async function renderHarness(
    target: RepositoryTargetDto,
    operations: WorkspaceOperationDto[],
    workspaceId = "workspace"
  ): Promise<void> {
    await act(async () => {
      root.render(
        <Harness
          onController={(value) => {
            controller = value;
          }}
          operations={operations}
          target={target}
          workspaceId={workspaceId}
        />
      );
    });
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function Harness({
  target,
  operations,
  workspaceId,
  onController
}: {
  target: RepositoryTargetDto;
  operations: WorkspaceOperationDto[];
  workspaceId: string;
  onController(value: RepositoryCommandController): void;
}) {
  onController(useRepositoryCommands(target, operations, workspaceId));
  return null;
}

function installBridge(
  repository: Partial<GitNestBridge["repository"]>
): void {
  Object.defineProperty(window, "gitnest", {
    configurable: true,
    value: {
      repository
    } as unknown as GitNestBridge
  });
}

function createPreflight(
  command: RepositoryCommandDto,
  confirmationRequired: boolean
): RepositoryCommandPreflightDto {
  return {
    preflightId: "preflight_1",
    expiresAt: "2026-09-04T12:01:00.000Z",
    command,
    targetSummary: "1 个仓库目标",
    impacts: [
      {
        kind:
          command.type === "fetch"
            ? "remote-refs"
            : "worktree-update",
        target: TARGET_A,
        summary:
          command.type === "fetch"
            ? "Fetch origin"
            : "Pull origin/main",
        detail: "Exact impact."
      }
    ],
    warnings: [],
    confirmationRequired
  };
}

function createOperation(
  id: string,
  state: WorkspaceOperationDto["state"]
): WorkspaceOperationDto {
  return {
    id,
    kind: "fetch",
    scope: "repository",
    targetIds: [
      `${TARGET_A.repositoryId}:${TARGET_A.worktreeId}`
    ],
    state,
    progress: 1,
    succeeded: state === "succeeded" ? 1 : 0,
    failed: state === "failed" ? 1 : 0,
    message:
      state === "succeeded"
        ? "Fetch 已完成。"
        : "Fetch 状态已更新。"
  };
}
