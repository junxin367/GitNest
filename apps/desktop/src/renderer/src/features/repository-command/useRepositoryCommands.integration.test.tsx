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

  async function renderHarness(
    target: RepositoryTargetDto,
    operations: WorkspaceOperationDto[]
  ): Promise<void> {
    await act(async () => {
      root.render(
        <Harness
          onController={(value) => {
            controller = value;
          }}
          operations={operations}
          target={target}
        />
      );
    });
  }
});

function Harness({
  target,
  operations,
  onController
}: {
  target: RepositoryTargetDto;
  operations: WorkspaceOperationDto[];
  onController(value: RepositoryCommandController): void;
}) {
  onController(useRepositoryCommands(target, operations));
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
