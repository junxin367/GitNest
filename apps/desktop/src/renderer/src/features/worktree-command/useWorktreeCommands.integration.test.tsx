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

  it("keeps automatic execution busy until submission resolves and rejects a second request", async () => {
    const command: WorktreeCommandDto = {
      type: "lock",
      worktreeId: "worktree-linked"
    };
    let resolveExecution!: (value: {
      ok: true;
      value: { operationId: string };
    }) => void;
    const preflightCommand = vi.fn(async () => ({
      ok: true as const,
      value: createPreflight(command, false)
    }));
    const executeCommand = vi.fn(
      () =>
        new Promise<{
          ok: true;
          value: { operationId: string };
        }>((resolve) => {
          resolveExecution = resolve;
        })
    );
    installBridge({ preflightCommand, executeCommand });
    await renderHarness([]);

    let pending: Promise<boolean> | undefined;
    await act(async () => {
      pending = controller?.request(command);
      await Promise.resolve();
    });

    expect(controller?.active).toBe("lock");
    expect(controller?.busy).toBe(true);
    await act(async () => {
      expect(await controller?.request(command)).toBe(false);
    });
    expect(preflightCommand).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveExecution({
        ok: true,
        value: { operationId: "operation-pending" }
      });
      expect(await pending).toBe(true);
    });
    expect(controller?.active).toBeNull();
    expect(controller?.busy).toBe(true);
    expect(controller?.notice).toContain("已加入操作中心");
  });

  it("reports automatic execution rejection as feedback and permits retry", async () => {
    const command: WorktreeCommandDto = {
      type: "unlock",
      worktreeId: "worktree-linked"
    };
    const executeCommand = vi.fn()
      .mockRejectedValueOnce(new Error("IPC submission failed"))
      .mockResolvedValueOnce({
        ok: true,
        value: { operationId: "operation-retry" }
      });
    installBridge({
      preflightCommand: vi.fn(async () => ({
        ok: true as const,
        value: createPreflight(command, false)
      })),
      executeCommand
    });
    await renderHarness([]);

    await act(async () => {
      await expect(controller?.request(command)).resolves.toBe(false);
    });
    expect(controller?.error).toMatchObject({
      code: "COMMAND_FAILED",
      message: "IPC submission failed"
    });
    expect(controller?.active).toBeNull();
    expect(controller?.busy).toBe(false);

    await act(async () => {
      expect(await controller?.request(command)).toBe(true);
    });
    expect(controller?.error).toBeNull();
    expect(executeCommand).toHaveBeenCalledTimes(2);
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

  it.each(["single", "workspace"] as const)(
    "invalidates an expired %s confirmation and allows a fresh retry",
    async (kind) => {
      const command: WorktreeCommandDto = { type: "remove", worktreeId: "worktree-linked" };
      let preflightNumber = 0;
      const executeCommand = vi.fn()
        .mockResolvedValueOnce({
          ok: false, error: { code: "PREFLIGHT_EXPIRED", message: "Confirmation expired.", details: {} }
        })
        .mockResolvedValueOnce({ ok: true, value: { operationId: "fresh-confirmation" } });
      installBridge({
        preflightCommand: vi.fn(async () => ({
          ok: true as const,
          value: { ...createPreflight(command, true), preflightId: `preflight-${++preflightNumber}` }
        })),
        executeCommand
      });
      if (kind === "single") {
        await renderHarness([]);
      } else {
        await renderWorkspaceCommandHarness([]);
      }
      const request = () => kind === "single"
        ? controller!.request(command)
        : workspaceCommandController!.request([command]);
      const current = () => kind === "single" ? controller! : workspaceCommandController!;
      await act(async () => { expect(await request()).toBe(true); });
      const expiredConfirm = current().confirm;
      await act(async () => {
        expect(await Promise.all([expiredConfirm(), expiredConfirm()])).toEqual([false, false]);
      });
      expect(executeCommand).toHaveBeenCalledTimes(1);
      expect(current().busy).toBe(false);
      expect(current().error?.message).toContain("请重新预检");
      await act(async () => {
        expect(await expiredConfirm()).toBe(false);
        expect(await request()).toBe(true);
      });
      await act(async () => {
        expect(await expiredConfirm()).toBe(false);
        expect(await current().confirm()).toBe(true);
      });
      expect(executeCommand).toHaveBeenCalledTimes(2);
      expect(executeCommand).toHaveBeenLastCalledWith({
        command, preflightId: "preflight-2", confirmed: true
      });
      expect(current().error).toBeNull();
    }
  );

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

  it.each([
    ["failed", "succeeded"],
    ["interrupted", "cancelled"],
    ["cancelled", "succeeded"]
  ] as const)("retains Workspace batch %s through a later %s result and permits retry", async (firstState, lastState) => {
    const commands = ["repository-1", "repository-2"].map((repositoryId) => ({
      type: "prune" as const, repositoryId
    }));
    const executeCommand = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { operationId: "first" } })
      .mockResolvedValueOnce({ ok: true, value: { operationId: "last" } })
      .mockResolvedValueOnce({ ok: true, value: { operationId: "retry-first" } })
      .mockResolvedValueOnce({ ok: true, value: { operationId: "retry-last" } });
    installBridge({
      preflightCommand: vi.fn(async ({ command }) => {
        if (command.type !== "prune") {
          throw new Error("Expected prune.");
        }
        return { ok: true as const, value: createPrunePreflight(command, 1) };
      }),
      executeCommand
    });
    await renderWorkspaceCommandHarness([]);
    await act(async () => {
      expect(await workspaceCommandController!.request(commands)).toBe(true);
    });
    await act(async () => {
      expect(await workspaceCommandController!.confirm()).toBe(true);
    });
    const first = {
      ...createPruneOperation("first", firstState, "repository-1"),
      message: "第一个 Worktree 未完成"
    };
    const last = createPruneOperation("last", "running", "repository-2");
    await renderWorkspaceCommandHarness([first, last]);
    expect(workspaceCommandController!.busy).toBe(true);
    await renderWorkspaceCommandHarness([{ ...last, state: lastState, message: "第二个 Worktree 已结束" }]);
    expect(workspaceCommandController!.busy).toBe(false);
    expect(workspaceCommandsSettled).toHaveBeenCalledTimes(1);
    if (firstState === "cancelled") {
      expect(workspaceCommandController!.notice).toBe(first.message);
    } else {
      expect(workspaceCommandController!.error?.message).toBe(first.message);
      expect(workspaceCommandController!.notice).toBeNull();
    }
    await act(async () => {
      expect(await workspaceCommandController!.request(commands)).toBe(true);
    });
    await act(async () => {
      expect(await workspaceCommandController!.confirm()).toBe(true);
    });
    expect(workspaceCommandController!.error).toBeNull();
    await renderWorkspaceCommandHarness([
      createPruneOperation("retry-first", "succeeded", "repository-1"),
      createPruneOperation("retry-last", "succeeded", "repository-2")
    ]);
    expect(workspaceCommandController!.error).toBeNull();
    expect(workspaceCommandController!.busy).toBe(false);
    expect(workspaceCommandController!.notice).toContain("已完成");
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

  it("rejects a captured Worktree confirmation after a repository switch", async () => {
    const command: WorktreeCommandDto = { type: "remove", worktreeId: "worktree-linked" };
    const executeCommand = vi.fn(async () => ({ ok: true as const, value: { operationId: "old" } }));
    installBridge({
      preflightCommand: vi.fn(async () => ({ ok: true as const, value: createPreflight(command, true) })),
      executeCommand
    });
    await renderHarness([]);
    await act(async () => { await controller!.request(command); });
    const confirm = controller!.confirm;
    await renderHarness([], "repository-2");
    await act(async () => { expect(await confirm()).toBe(false); });
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it("does not return a directory selected for a previous repository", async () => {
    const selection = deferred<Awaited<ReturnType<GitNestBridge["worktree"]["selectDirectory"]>>>();
    installBridge({ selectDirectory: vi.fn(() => selection.promise) });
    await renderHarness([]);
    let pending!: Promise<string | null>;
    act(() => { pending = controller!.chooseDirectory(); });
    await renderHarness([], "repository-2");
    await act(async () => {
      selection.resolve({ ok: true, value: { cancelled: false, path: "D:\\old" } });
      expect(await pending).toBeNull();
    });
    expect(controller!.error).toBeNull();
  });

  it("ignores old cancellation failures after switching repositories", async () => {
    const cancellation = deferred<Awaited<ReturnType<GitNestBridge["repository"]["cancelOperation"]>>>();
    installBridge({}, { cancelOperation: vi.fn(() => cancellation.promise) });
    await renderHarness([]);
    let pending!: Promise<boolean>;
    act(() => { pending = controller!.cancelOperation("old"); });
    await renderHarness([], "repository-2");
    await act(async () => {
      cancellation.resolve({ ok: false, error: { code: "COMMAND_FAILED", message: "old cancellation failed", details: {} } });
      expect(await pending).toBe(false);
    });
    expect(controller!.error).toBeNull();
    expect(controller!.notice).toBeNull();
  });

  it("blocks repeat Worktree submissions after acceptance until completion", async () => {
    const command: WorktreeCommandDto = { type: "lock", worktreeId: "worktree-linked" };
    const preflightCommand = vi.fn(async () => ({ ok: true as const, value: createPreflight(command, false) }));
    installBridge({
      preflightCommand,
      executeCommand: vi.fn(async () => ({ ok: true as const, value: { operationId: "operation-1" } }))
    });
    await renderHarness([]);
    const request = controller!.request;
    await act(async () => {
      expect(await request(command)).toBe(true);
      expect(await request(command)).toBe(false);
    });
    expect(preflightCommand).toHaveBeenCalledTimes(1);
    await renderHarness([createOperation("operation-1", "failed")]);
    await act(async () => { expect(await controller!.request(command)).toBe(true); });
  });

  it("blocks Worktree requests when an operation is already running", async () => {
    const preflightCommand = vi.fn(async () => ({ ok: false as const, error: { code: "COMMAND_FAILED" as const, message: "must not be called", details: {} } }));
    installBridge({ preflightCommand });
    await renderHarness([createOperation("external-operation", "running")]);
    await act(async () => {
      expect(await controller!.request({ type: "lock", worktreeId: "worktree-linked" })).toBe(false);
    });
    expect(preflightCommand).not.toHaveBeenCalled();
  });

  it.each(["single", "workspace"] as const)(
    "does not settle old %s operations arriving in the scope-switch render",
    async (kind) => {
      const command: WorktreeCommandDto = { type: "remove", worktreeId: "worktree-linked" };
      installBridge({
        preflightCommand: vi.fn(async () => ({
          ok: true as const, value: createPreflight(command, true)
        })),
        executeCommand: vi.fn(async () => ({ ok: true as const, value: { operationId: "old" } }))
      });
      if (kind === "single") {
        await renderHarness([]);
        await act(async () => { await controller!.request(command); });
        await act(async () => { await controller!.confirm(); });
        await renderHarness([
          { ...createOperation("old", "failed"), message: "旧 Worktree 失败" }
        ], "repository-2");
        expect(controller!.completionVersion).toBe(0);
      } else {
        await renderWorkspaceCommandHarness([]);
        await act(async () => { await workspaceCommandController!.request([command]); });
        await act(async () => { await workspaceCommandController!.confirm(); });
        await renderWorkspaceCommandHarness([
          { ...createOperation("old", "failed"), message: "旧 Worktree 失败" }
        ], undefined, "workspace-2");
        expect(workspaceCommandsSettled).not.toHaveBeenCalled();
      }
      const current = kind === "single" ? controller! : workspaceCommandController!;
      expect(current.error).toBeNull();
      expect(current.notice).toBeNull();
      expect(current.busy).toBe(false);
    }
  );
  it("rejects captured Workspace requests and confirmations after changing scope", async () => {
    const command = { type: "prune" as const, repositoryId: REPOSITORY_ID };
    const preflightCommand = vi.fn(async () => ({ ok: true as const, value: createPrunePreflight(command, 1) }));
    const executeCommand = vi.fn(async () => ({ ok: true as const, value: { operationId: "old" } }));
    installBridge({ preflightCommand, executeCommand });
    await renderWorkspaceCommandHarness([]);
    const request = workspaceCommandController!.request;
    await act(async () => { await request([command]); });
    const confirm = workspaceCommandController!.confirm;
    await renderWorkspaceCommandHarness([], undefined, "workspace-2");
    await act(async () => { expect(await confirm()).toBe(false); });
    await act(async () => { expect(await request([command])).toBe(false); });
    expect(executeCommand).not.toHaveBeenCalled();
    expect(preflightCommand).toHaveBeenCalledTimes(1);
  });

  it("rejects dismissed Workspace confirmations and duplicate requests from the same render", async () => {
    const command = { type: "prune" as const, repositoryId: REPOSITORY_ID };
    const preflightCommand = vi.fn(async () => ({ ok: true as const, value: createPrunePreflight(command, 1) }));
    const executeCommand = vi.fn(async () => ({ ok: true as const, value: { operationId: "old" } }));
    installBridge({ preflightCommand, executeCommand });
    await renderWorkspaceCommandHarness([]);
    const request = workspaceCommandController!.request;
    await act(async () => {
      expect(await request([command])).toBe(true);
      expect(await request([command])).toBe(false);
    });
    const confirm = workspaceCommandController!.confirm;
    act(() => { workspaceCommandController!.dismissPreflight(); });
    await act(async () => { expect(await confirm()).toBe(false); });
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it("does not execute an automatic Worktree preflight after unmount", async () => {
    const result = deferred<Awaited<ReturnType<GitNestBridge["worktree"]["preflightCommand"]>>>();
    const executeCommand = vi.fn();
    installBridge({ preflightCommand: vi.fn(() => result.promise), executeCommand });
    await renderHarness([]);
    const command: WorktreeCommandDto = { type: "lock", worktreeId: "worktree-linked" };
    const request = controller!.request;
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

  it("does not replace or replay a dismissed Worktree confirmation", async () => {
    const command: WorktreeCommandDto = { type: "remove", worktreeId: "worktree-linked" };
    const preflightCommand = vi.fn(async () => ({ ok: true as const, value: createPreflight(command, true) }));
    const executeCommand = vi.fn();
    installBridge({ preflightCommand, executeCommand });
    await renderHarness([]);
    await act(async () => { expect(await controller!.request(command)).toBe(true); });
    const confirm = controller!.confirm;
    await act(async () => { expect(await controller!.request(command)).toBe(false); });
    act(() => { controller!.dismissPreflight(); });
    await act(async () => { expect(await confirm()).toBe(false); });
    expect(preflightCommand).toHaveBeenCalledTimes(1);
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it("ignores directory errors and old callbacks after returning to the same repository", async () => {
    const selection = deferred<Awaited<ReturnType<GitNestBridge["worktree"]["selectDirectory"]>>>();
    const selectDirectory = vi.fn(() => selection.promise);
    const preflightCommand = vi.fn();
    const cancelOperation = vi.fn();
    installBridge({ selectDirectory, preflightCommand }, { cancelOperation });
    await renderHarness([]);
    const old = controller!;
    let pending!: Promise<string | null>;
    act(() => { pending = old.chooseDirectory(); });
    await renderHarness([], "repository-2");
    await renderHarness([]);
    await act(async () => {
      selection.resolve({ ok: false, error: { code: "DIRECTORY_UNAVAILABLE", message: "old directory failed", details: {} } });
      expect(await pending).toBeNull();
      expect(await old.chooseDirectory()).toBeNull();
      expect(await old.request({ type: "lock", worktreeId: "old" })).toBe(false);
      expect(await old.cancelOperation("old")).toBe(false);
    });
    expect(controller!.error).toBeNull();
    expect(selectDirectory).toHaveBeenCalledTimes(1);
    expect(preflightCommand).not.toHaveBeenCalled();
    expect(cancelOperation).not.toHaveBeenCalled();
  });

  it("stops a partially submitted Workspace batch when the controller unmounts", async () => {
    const execution = deferred<Awaited<ReturnType<GitNestBridge["worktree"]["executeCommand"]>>>();
    const executeCommand = vi.fn(() => execution.promise);
    installBridge({
      preflightCommand: vi.fn(async ({ command }) => ({ ok: true as const, value: createPreflight(command, true) })),
      executeCommand
    });
    await renderWorkspaceCommandHarness([]);
    await act(async () => {
      await workspaceCommandController!.request([
        { type: "prune", repositoryId: "repository-1" },
        { type: "prune", repositoryId: "repository-2" }
      ]);
    });
    const confirm = workspaceCommandController!.confirm;
    let pending!: Promise<boolean>;
    act(() => { pending = confirm(); });
    act(() => { root.render(null); });
    await act(async () => {
      execution.resolve({ ok: true, value: { operationId: "first" } });
      expect(await pending).toBe(false);
      expect(await confirm()).toBe(false);
    });
    expect(executeCommand).toHaveBeenCalledTimes(1);
    expect(workspaceCommandsSettled).not.toHaveBeenCalled();
  });

  it("permits Workspace retry after rejected submission without replaying its confirmation", async () => {
    const command = { type: "prune" as const, repositoryId: REPOSITORY_ID };
    const executeCommand = vi.fn()
      .mockRejectedValueOnce(new Error("IPC failed"))
      .mockResolvedValueOnce({ ok: true, value: { operationId: "retry" } });
    installBridge({
      preflightCommand: vi.fn(async () => ({ ok: true as const, value: createPrunePreflight(command, 1) })),
      executeCommand
    });
    await renderWorkspaceCommandHarness([]);
    await act(async () => { await workspaceCommandController!.request([command]); });
    const oldConfirm = workspaceCommandController!.confirm;
    await act(async () => { expect(await oldConfirm()).toBe(false); });
    expect(workspaceCommandController!.busy).toBe(false);
    expect(workspaceCommandController!.error?.message).toBe("IPC failed");
    await act(async () => { expect(await oldConfirm()).toBe(false); });
    await act(async () => { expect(await workspaceCommandController!.request([command])).toBe(true); });
    await act(async () => { expect(await workspaceCommandController!.confirm()).toBe(true); });
    expect(executeCommand).toHaveBeenCalledTimes(2);
  });

  async function renderHarness(
    operations: WorkspaceOperationDto[],
    repositoryId = REPOSITORY_ID
  ): Promise<void> {
    await act(async () => {
      root.render(
        <Harness
          onController={(value) => {
            controller = value;
          }}
          operations={operations}
          repositoryId={repositoryId}
        />
      );
    });
  }

  async function renderWorkspaceCommandHarness(
    operations: WorkspaceOperationDto[],
    repositoryId?: string,
    scopeKey = "workspace-1"
  ): Promise<void> {
    await act(async () => {
      root.render(
        <WorkspaceCommandHarness
          onController={(value) => {
            workspaceCommandController = value;
          }}
          onSettled={workspaceCommandsSettled}
          operations={operations}
          scopeKey={scopeKey}
          {...(repositoryId ? { repositoryId } : {})}
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
  operations,
  repositoryId,
  onController
}: {
  operations: WorkspaceOperationDto[];
  repositoryId: string;
  onController(value: WorktreeCommandController): void;
}) {
  onController(
    useWorktreeCommands(repositoryId, operations)
  );
  return null;
}

function WorkspaceCommandHarness({
  operations,
  onController,
  onSettled,
  repositoryId,
  scopeKey
}: {
  operations: WorkspaceOperationDto[];
  onController(
    value: WorkspaceWorktreeCommandController
  ): void;
  onSettled(): Promise<void>;
  repositoryId?: string;
  scopeKey: string;
}) {
  onController(
    useWorkspaceWorktreeCommands(
      scopeKey,
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
