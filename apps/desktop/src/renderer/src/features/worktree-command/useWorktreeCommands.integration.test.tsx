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
  WorkspaceOperationDto,
  WorktreeCommandDto,
  WorktreeCommandPreflightDto
} from "@gitnest/contracts";

import {
  useWorktreeCommands,
  type WorktreeCommandController
} from "./useWorktreeCommands";

const REPOSITORY_ID = "repository-1";

describe("useWorktreeCommands", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: WorktreeCommandController | undefined;

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

  it("automatically executes lock commands that do not require confirmation", async () => {
    const command: WorktreeCommandDto = {
      type: "lock",
      worktreeId: "worktree-linked",
      reason: "release validation"
    };
    const preflightCommand = vi.fn(async () => ({
      ok: true as const,
      value: createPreflight(command, false)
    }));
    const executeCommand = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "operation-1" }
    }));
    installBridge({ preflightCommand, executeCommand });
    await renderHarness([]);

    await act(async () => {
      await controller?.request(command);
    });

    expect(controller?.preflight).toBeNull();
    expect(executeCommand).toHaveBeenCalledWith({
      command,
      preflightId: "worktree_preflight_1",
      confirmed: false
    });
    expect(controller?.notice).toContain(
      "已加入操作中心"
    );

    await renderHarness([
      createOperation("operation-1", "succeeded")
    ]);
    expect(controller?.completionVersion).toBe(1);
    expect(controller?.notice).toBe(
      "锁定 Worktree 已完成。"
    );
  });

  it("holds remove behind an explicit danger confirmation", async () => {
    const command: WorktreeCommandDto = {
      type: "remove",
      worktreeId: "worktree-linked"
    };
    const preflight = createPreflight(command, true);
    const executeCommand = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "operation-2" }
    }));
    installBridge({
      preflightCommand: vi.fn(async () => ({
        ok: true as const,
        value: preflight
      })),
      executeCommand
    });
    await renderHarness([]);

    await act(async () => {
      await controller?.request(command);
    });
    expect(controller?.preflight).toEqual(preflight);
    expect(executeCommand).not.toHaveBeenCalled();

    await act(async () => {
      await controller?.confirm();
    });
    expect(executeCommand).toHaveBeenCalledWith({
      command,
      preflightId: "worktree_preflight_1",
      confirmed: true
    });
  });

  it("returns a Main-authorized directory selection and formats stale preflight errors", async () => {
    const selectDirectory = vi.fn(async () => ({
      ok: true as const,
      value: {
        cancelled: false as const,
        path: "D:\\selected"
      }
    }));
    installBridge({
      selectDirectory,
      preflightCommand: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: "PREFLIGHT_CHANGED" as const,
          message: "Path changed.",
          details: {}
        }
      })),
      executeCommand: vi.fn()
    });
    await renderHarness([]);

    let selected: string | null = null;
    await act(async () => {
      selected =
        (await controller?.chooseDirectory()) ?? null;
    });
    expect(selected).toBe("D:\\selected");

    await act(async () => {
      await controller?.request({
        type: "repair",
        worktreeId: "worktree-linked"
      });
    });
    expect(controller?.error).toMatchObject({
      code: "PREFLIGHT_CHANGED",
      message: expect.stringContaining("请重新预检")
    });
  });

  it("delegates cancellation through the shared operation channel", async () => {
    const cancelOperation = vi.fn(async () => ({
      ok: true as const,
      value: undefined
    }));
    installBridge(
      {
        preflightCommand: vi.fn(),
        executeCommand: vi.fn()
      },
      { cancelOperation }
    );
    await renderHarness([]);

    await act(async () => {
      await controller?.cancelOperation("operation-3");
    });
    expect(cancelOperation).toHaveBeenCalledWith({
      operationId: "operation-3"
    });
    expect(controller?.notice).toBe(
      "正在取消 Worktree 操作…"
    );
  });

  async function renderHarness(
    operations: WorkspaceOperationDto[]
  ): Promise<void> {
    await act(async () => {
      root.render(
        <Harness
          onController={(value) => {
            controller = value;
          }}
          operations={operations}
        />
      );
    });
  }
});

function Harness({
  operations,
  onController
}: {
  operations: WorkspaceOperationDto[];
  onController(value: WorktreeCommandController): void;
}) {
  onController(
    useWorktreeCommands(REPOSITORY_ID, operations)
  );
  return null;
}

function installBridge(
  worktree: Partial<GitNestBridge["worktree"]>,
  repository: Partial<GitNestBridge["repository"]> = {}
): void {
  Object.defineProperty(window, "gitnest", {
    configurable: true,
    value: {
      worktree,
      repository
    } as unknown as GitNestBridge
  });
}

function createPreflight(
  command: WorktreeCommandDto,
  confirmationRequired: boolean
): WorktreeCommandPreflightDto {
  return {
    preflightId: "worktree_preflight_1",
    expiresAt: "2026-09-04T12:01:00.000Z",
    command,
    targetSummary: "Worktree C:\\workspace\\linked",
    impacts: [
      {
        kind:
          command.type === "lock"
            ? "worktree-lock"
            : "worktree-directory",
        target: {
          repositoryId: REPOSITORY_ID,
          worktreeId: "worktree-linked"
        },
        summary: "Exact Worktree impact",
        detail: "C:\\workspace\\linked"
      }
    ],
    warnings:
      command.type === "remove"
        ? [
            {
              code: "REMOVE_DIRECTORY",
              severity: "danger",
              message: "Directory will be removed."
            }
          ]
        : [],
    confirmationRequired
  };
}

function createOperation(
  id: string,
  state: WorkspaceOperationDto["state"]
): WorkspaceOperationDto {
  return {
    id,
    kind: "worktree-lock",
    scope: "repository",
    targetIds: [
      `${REPOSITORY_ID}:worktree-linked`
    ],
    state,
    progress: 1,
    succeeded: state === "succeeded" ? 1 : 0,
    failed: state === "failed" ? 1 : 0,
    message:
      state === "succeeded"
        ? "锁定 Worktree 已完成。"
        : "锁定 Worktree 状态已更新。"
  };
}
