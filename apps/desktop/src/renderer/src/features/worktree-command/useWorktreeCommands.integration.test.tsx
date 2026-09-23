/** @vitest-environment jsdom */

import React, { act } from "react";
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
import {
  useWorkspaceWorktreeCommands,
  type WorkspaceWorktreeCommandController
} from "./useWorkspaceWorktreeCommands";

const REPOSITORY_ID = "repository-1";

describe("useWorktreeCommands", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: WorktreeCommandController | undefined;
  let workspaceCommandController:
    | WorkspaceWorktreeCommandController
    | undefined;
  let workspaceCommandsSettled: () => Promise<void>;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    workspaceCommandsSettled = vi.fn(async () => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it("preflights and confirms Workspace prune commands across repositories", async () => {
    let releaseTopologySync: () => void = () => undefined;
    workspaceCommandsSettled = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseTopologySync = resolve;
        })
    );
    const repositoryIds = ["repository-1", "repository-2"];
    const preflightCommand = vi.fn(
      async ({
        command
      }: {
        command: WorktreeCommandDto;
      }) => {
        if (command.type !== "prune") {
          throw new Error("Expected a prune command.");
        }
        return {
          ok: true as const,
          value: createPrunePreflight(
            command,
            repositoryIds.indexOf(command.repositoryId) + 1
          )
        };
      }
    );
    const executeCommand = vi.fn(
      async ({
        command
      }: {
        command: WorktreeCommandDto;
      }) => {
        if (command.type !== "prune") {
          throw new Error("Expected a prune command.");
        }
        return {
          ok: true as const,
          value: {
            operationId: `operation-${command.repositoryId}`
          }
        };
      }
    );
    installBridge({ preflightCommand, executeCommand });
    await renderWorkspaceCommandHarness([]);

    await act(async () => {
      await workspaceCommandController?.request([
        {
          type: "prune",
          repositoryId: "repository-1"
        },
        {
          type: "prune",
          repositoryId: "repository-2"
        },
        {
          type: "prune",
          repositoryId: "repository-1"
        }
      ]);
    });

    expect(preflightCommand).toHaveBeenCalledTimes(2);
    expect(
      workspaceCommandController?.preflights.map(
        (preflight) =>
          preflight.command.type === "prune"
            ? preflight.command.repositoryId
            : ""
      )
    ).toEqual(repositoryIds);

    await act(async () => {
      await workspaceCommandController?.confirm();
    });

    expect(executeCommand).toHaveBeenCalledTimes(2);
    expect(workspaceCommandController?.preflights).toEqual([]);
    expect(workspaceCommandController?.notice).toContain(
      "2 个仓库"
    );

    await renderWorkspaceCommandHarness([
      createPruneOperation(
        "operation-repository-1",
        "succeeded",
        "repository-1"
      ),
      createPruneOperation(
        "operation-repository-2",
        "running",
        "repository-2"
      )
    ]);
    expect(workspaceCommandsSettled).not.toHaveBeenCalled();
    expect(workspaceCommandController?.busy).toBe(true);

    await renderWorkspaceCommandHarness([
      createPruneOperation(
        "operation-repository-1",
        "succeeded",
        "repository-1"
      ),
      createPruneOperation(
        "operation-repository-2",
        "succeeded",
        "repository-2"
      )
    ]);
    expect(workspaceCommandsSettled).toHaveBeenCalledTimes(1);
    expect(workspaceCommandController?.busy).toBe(true);

    await act(async () => {
      releaseTopologySync();
      await Promise.resolve();
    });

    expect(workspaceCommandController?.busy).toBe(false);
    expect(workspaceCommandController?.notice).toContain(
      "清除"
    );
  });

  it("preflights and confirms Workspace remove commands", async () => {
    const command: WorktreeCommandDto = {
      type: "remove",
      worktreeId: "worktree-linked"
    };
    const preflight = createPreflight(command, true);
    const executeCommand = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "operation-remove" }
    }));
    installBridge({
      preflightCommand: vi.fn(async () => ({
        ok: true as const,
        value: preflight
      })),
      executeCommand
    });
    await renderWorkspaceCommandHarness([]);

    await act(async () => {
      await workspaceCommandController?.request([command]);
    });
    expect(workspaceCommandController?.preflights).toEqual([
      preflight
    ]);

    await act(async () => {
      await workspaceCommandController?.confirm();
    });

    expect(executeCommand).toHaveBeenCalledWith({
      command,
      preflightId: "worktree_preflight_1",
      confirmed: true
    });
    expect(workspaceCommandController?.notice).toContain(
      "1 个 Worktree"
    );
  });

  it("does not let another repository's operation block a repository-scoped controller", async () => {
    installBridge({
      preflightCommand: vi.fn(),
      executeCommand: vi.fn()
    });

    await renderWorkspaceCommandHarness(
      [
        createPruneOperation(
          "operation-repository-2",
          "running",
          "repository-2"
        )
      ],
      REPOSITORY_ID
    );
    expect(workspaceCommandController?.busy).toBe(false);

    await renderWorkspaceCommandHarness([
      createPruneOperation(
        "operation-repository-2",
        "running",
        "repository-2"
      )
    ]);
    expect(workspaceCommandController?.busy).toBe(true);
  });

  it("settles after completed operation records are later trimmed", async () => {
    const repositoryIds = ["repository-1", "repository-2"];
    installBridge({
      preflightCommand: vi.fn(async ({ command }) => {
        if (command.type !== "prune") {
          throw new Error("Expected prune.");
        }
        return {
          ok: true as const,
          value: createPrunePreflight(
            command,
            repositoryIds.indexOf(command.repositoryId) + 1
          )
        };
      }),
      executeCommand: vi.fn(async ({ command }) => {
        if (command.type !== "prune") {
          throw new Error("Expected prune.");
        }
        return {
          ok: true as const,
          value: {
            operationId: `operation-${command.repositoryId}`
          }
        };
      })
    });
    await renderWorkspaceCommandHarness([]);

    await act(async () => {
      await workspaceCommandController?.request(
        repositoryIds.map((repositoryId) => ({
          type: "prune" as const,
          repositoryId
        }))
      );
    });
    await act(async () => {
      await workspaceCommandController?.confirm();
    });

    await renderWorkspaceCommandHarness([
      createPruneOperation(
        "operation-repository-1",
        "succeeded",
        "repository-1"
      ),
      createPruneOperation(
        "operation-repository-2",
        "running",
        "repository-2"
      )
    ]);
    expect(workspaceCommandController?.busy).toBe(true);

    await renderWorkspaceCommandHarness([
      createPruneOperation(
        "operation-repository-2",
        "succeeded",
        "repository-2"
      )
    ]);

    expect(workspaceCommandsSettled).toHaveBeenCalledTimes(1);
    expect(workspaceCommandController?.busy).toBe(false);
  });

  it("rejects a batch that could overflow runtime operation history", async () => {
    const preflightCommand = vi.fn();
    installBridge({
      preflightCommand,
      executeCommand: vi.fn()
    });
    await renderWorkspaceCommandHarness([]);

    await act(async () => {
      await workspaceCommandController?.request(
        Array.from({ length: 21 }, (_, index) => ({
          type: "remove" as const,
          worktreeId: `worktree-${index}`
        }))
      );
    });

    expect(preflightCommand).not.toHaveBeenCalled();
    expect(workspaceCommandController?.error?.message).toContain(
      "一次最多处理 20 个"
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

  async function renderWorkspaceCommandHarness(
    operations: WorkspaceOperationDto[],
    repositoryId?: string
  ): Promise<void> {
    await act(async () => {
      root.render(
        <WorkspaceCommandHarness
          onController={(value) => {
            workspaceCommandController = value;
          }}
          onSettled={workspaceCommandsSettled}
          operations={operations}
          {...(repositoryId ? { repositoryId } : {})}
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

function WorkspaceCommandHarness({
  operations,
  onController,
  onSettled,
  repositoryId
}: {
  operations: WorkspaceOperationDto[];
  onController(
    value: WorkspaceWorktreeCommandController
  ): void;
  onSettled(): Promise<void>;
  repositoryId?: string;
}) {
  onController(
    useWorkspaceWorktreeCommands(
      "workspace-1",
      operations,
      onSettled,
      repositoryId
    )
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

function createPrunePreflight(
  command: Extract<WorktreeCommandDto, { type: "prune" }>,
  index: number
): WorktreeCommandPreflightDto {
  return {
    preflightId: `worktree_prune_preflight_${index}`,
    expiresAt: "2026-09-04T12:01:00.000Z",
    command,
    targetSummary: `仓库 ${command.repositoryId}`,
    impacts: [
      {
        kind: "worktree-registration",
        target: {
          repositoryId: command.repositoryId,
          worktreeId: `prunable-${index}`
        },
        summary: "清除失效 Worktree 登记",
        detail: `C:\\workspace\\prunable-${index}`
      }
    ],
    warnings: [
      {
        code: "PRUNE_REGISTRATION",
        severity: "warning",
        message: "只会移除失效 Git 登记。"
      }
    ],
    confirmationRequired: true
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

function createPruneOperation(
  id: string,
  state: WorkspaceOperationDto["state"],
  repositoryId: string
): WorkspaceOperationDto {
  return {
    id,
    kind: "worktree-prune",
    scope: "repository",
    targetIds: [`${repositoryId}:worktree-prunable`],
    state,
    progress: state === "running" ? 0.5 : 1,
    succeeded: state === "succeeded" ? 1 : 0,
    failed: state === "failed" ? 1 : 0,
    message:
      state === "succeeded"
        ? "清除失效 Worktree 登记已完成。"
        : "正在清除失效 Worktree 登记。"
  };
}
