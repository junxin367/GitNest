/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
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
  RepositoryTargetDto,
  WorkspaceDetailsDto,
  WorkspaceRuntimeStateDto,
  WorkspaceSummaryDto
} from "@gitnest/contracts";

import {
  useWorkspace,
  type WorkspaceController
} from "./useWorkspace";

describe("useWorkspace integration", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: WorkspaceController | undefined;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    controller = undefined;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("keeps only the latest asynchronous target selection", async () => {
    const targetB = deferred<
      Awaited<
        ReturnType<GitNestBridge["workspace"]["selectTarget"]>
      >
    >();
    const targetC = deferred<
      Awaited<
        ReturnType<GitNestBridge["workspace"]["selectTarget"]>
      >
    >();
    const selectTarget = vi.fn(
      ({ target }: { target: RepositoryTargetDto }) =>
        target.repositoryId === TARGET_B.repositoryId
          ? targetB.promise
          : targetC.promise
    );
    installBridge({ selectTarget });

    await renderHarness();

    let firstSelection!: Promise<boolean>;
    let latestSelection!: Promise<boolean>;
    act(() => {
      firstSelection = controller!.selectTarget(TARGET_B);
      latestSelection = controller!.selectTarget(TARGET_C);
    });

    await act(async () => {
      targetC.resolve({
        ok: true,
        value: workspaceWithTarget(TARGET_C)
      });
      await latestSelection;
      await flushAsyncWork();
    });
    await act(async () => {
      targetB.resolve({
        ok: true,
        value: workspaceWithTarget(TARGET_B)
      });
      await firstSelection;
      await flushAsyncWork();
    });

    await expect(latestSelection).resolves.toBe(true);
    await expect(firstSelection).resolves.toBe(false);
    expect(controller?.workspace?.selectedTarget).toEqual(
      TARGET_C
    );
  });

  it("reasserts the current target while another selection is pending", async () => {
    const targetB = deferred<
      Awaited<
        ReturnType<GitNestBridge["workspace"]["selectTarget"]>
      >
    >();
    const targetA = deferred<
      Awaited<
        ReturnType<GitNestBridge["workspace"]["selectTarget"]>
      >
    >();
    const selectTarget = vi.fn(
      ({ target }: { target: RepositoryTargetDto }) =>
        target.repositoryId === TARGET_B.repositoryId
          ? targetB.promise
          : targetA.promise
    );
    installBridge({ selectTarget });

    await renderHarness();

    let firstSelection!: Promise<boolean>;
    let latestSelection!: Promise<boolean>;
    act(() => {
      firstSelection = controller!.selectTarget(TARGET_B);
      latestSelection = controller!.selectTarget(TARGET_A);
    });
    expect(selectTarget).toHaveBeenCalledTimes(2);

    await act(async () => {
      targetB.resolve({
        ok: true,
        value: workspaceWithTarget(TARGET_B)
      });
      await firstSelection;
      targetA.resolve({
        ok: true,
        value: workspaceWithTarget(TARGET_A)
      });
      await latestSelection;
      await flushAsyncWork();
    });

    await expect(firstSelection).resolves.toBe(false);
    await expect(latestSelection).resolves.toBe(true);
    expect(controller?.workspace?.selectedTarget).toEqual(
      TARGET_A
    );
  });

  it("configures the first empty placeholder Workspace in place", async () => {
    const placeholder = createEmptyWorkspace();
    const initialState = createRuntimeState(placeholder);
    const scannedWorkspace = {
      ...workspaceWithTarget(TARGET_A),
      id: placeholder.id,
      name: "Second Workspace",
      path: "C:\\projects\\Second Workspace",
      canonicalPath: "c:\\projects\\second workspace",
      updatedAt: "2026-09-20T12:01:00.000Z"
    } satisfies WorkspaceDetailsDto;
    const createdState = createRuntimeState(scannedWorkspace);
    const selectDirectory = vi.fn(async () => ({
      ok: true as const,
      value: {
        cancelled: false as const,
        path: "C:\\projects\\Second Workspace"
      }
    }));
    const create = vi.fn(async () => ({
      ok: true as const,
      value: createdState
    }));
    const deleteWorkspace = vi.fn(async () => ({
      ok: true as const,
      value: createdState
    }));
    installBridge({
      create,
      delete: deleteWorkspace,
      getState: vi.fn(async () => ({
        ok: true as const,
        value: initialState
      })),
      selectDirectory
    });
    await renderHarness();

    expect(controller?.workspace?.id).toBe("workspace");
    expect(controller?.workspace?.path).toBeUndefined();

    let created!: Promise<boolean>;
    act(() => {
      created = controller!.createWorkspace();
    });
    await act(async () => {
      await created;
      await flushAsyncWork();
    });

    await expect(created).resolves.toBe(true);
    expect(selectDirectory).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({
      name: "Second Workspace",
      path: "C:\\projects\\Second Workspace"
    });
    expect(deleteWorkspace).not.toHaveBeenCalled();
    expect(controller?.workspace?.id).toBe(placeholder.id);
    expect(controller?.workspace?.path).toBe(
      "C:\\projects\\Second Workspace"
    );
    expect(controller?.workspaces).toEqual([
      {
        id: placeholder.id,
        name: "Second Workspace",
        updatedAt: scannedWorkspace.updatedAt
      }
    ]);
    expect(controller?.notice).toBe(
      "Workspace“Second Workspace”已创建并完成目录扫描。"
    );
  });

  it("keeps the empty placeholder when Workspace creation fails", async () => {
    const placeholder = createEmptyWorkspace();
    const initialState = createRuntimeState(placeholder);
    installBridge({
      create: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: "NO_REPOSITORIES_FOUND" as const,
          message:
            "No Git repositories were found in the selected directory.",
          details: {}
        }
      })),
      getState: vi.fn(async () => ({
        ok: true as const,
        value: initialState
      })),
      selectDirectory: vi.fn(async () => ({
        ok: true as const,
        value: {
          cancelled: false as const,
          path: "C:\\projects\\Empty"
        }
      }))
    });
    await renderHarness();

    let created!: Promise<boolean>;
    act(() => {
      created = controller!.createWorkspace();
    });
    await act(async () => {
      await created;
      await flushAsyncWork();
    });

    await expect(created).resolves.toBe(false);
    expect(controller?.workspace).toEqual(placeholder);
    expect(controller?.workspaces).toHaveLength(1);
    expect(controller?.error?.code).toBe(
      "NO_REPOSITORIES_FOUND"
    );
    expect(controller?.busy).toBe(false);
  });

  it("adds a selected directory to the current Workspace", async () => {
    const initial = workspaceWithTarget(TARGET_A);
    const added: WorkspaceDetailsDto = {
      ...initial,
      additionalRoots: [
        {
          path: "D:\\shared\\tools",
          canonicalPath: "d:\\shared\\tools",
          excludes: []
        }
      ],
      updatedAt: "2026-09-23T12:00:00.000Z"
    };
    const selectDirectory = vi.fn(async () => ({
      ok: true as const,
      value: {
        cancelled: false as const,
        path: "D:\\shared\\tools"
      }
    }));
    const addDirectory = vi.fn(async () => ({
      ok: true as const,
      value: {
        workspace: added,
        duplicate: false
      }
    }));
    installBridge({
      addDirectory,
      getState: vi.fn(async () => ({
        ok: true as const,
        value: createRuntimeState(initial)
      })),
      selectDirectory
    });
    await renderHarness();

    let result!: Promise<boolean>;
    act(() => {
      result = controller!.chooseDirectory();
    });
    await act(async () => {
      await result;
      await flushAsyncWork();
    });

    await expect(result).resolves.toBe(true);
    expect(selectDirectory).toHaveBeenCalledOnce();
    expect(addDirectory).toHaveBeenCalledWith({
      path: "D:\\shared\\tools"
    });
    expect(controller?.workspace?.additionalRoots).toEqual(
      added.additionalRoots
    );
    expect(controller?.notice).toBe(
      "目录已添加到当前 Workspace。"
    );
  });

  it("keeps the latest switch when returning to the visible Workspace", async () => {
    const first = deferred<
      Awaited<ReturnType<GitNestBridge["workspace"]["switch"]>>
    >();
    const second = deferred<
      Awaited<ReturnType<GitNestBridge["workspace"]["switch"]>>
    >();
    const switchWorkspace = vi.fn(
      ({ workspaceId }: { workspaceId: string }) =>
        workspaceId === "workspace-second"
          ? first.promise
          : second.promise
    );
    installBridge({ switch: switchWorkspace });
    await renderHarness();

    let firstRequest!: Promise<boolean>;
    let latestRequest!: Promise<boolean>;
    act(() => {
      firstRequest =
        controller!.switchWorkspace("workspace-second");
      latestRequest = controller!.switchWorkspace("workspace");
    });
    expect(switchWorkspace).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve({
        ok: true,
        value: createRuntimeState()
      });
      await latestRequest;
      first.resolve({
        ok: true,
        value: createRuntimeState(
          workspaceWithIdentity(
            "workspace-second",
            "Second Workspace"
          )
        )
      });
      await firstRequest;
    });

    await expect(firstRequest).resolves.toBe(false);
    await expect(latestRequest).resolves.toBe(true);
    expect(controller?.workspace?.id).toBe("workspace");
    expect(controller?.busy).toBe(false);
  });

  it("renames the active Workspace and updates its summary", async () => {
    const renamedWorkspace = {
      ...workspaceWithTarget(TARGET_A),
      name: "Renamed Workspace",
      updatedAt: "2026-09-21T08:00:00.000Z"
    } satisfies WorkspaceDetailsDto;
    const renamedState = createRuntimeState(renamedWorkspace);
    const rename = vi.fn(async () => ({
      ok: true as const,
      value: renamedState
    }));
    installBridge({ rename });
    await renderHarness();

    let renamed!: Promise<boolean>;
    act(() => {
      renamed = controller!.renameWorkspace(
        "workspace",
        "Renamed Workspace"
      );
    });
    await act(async () => {
      await renamed;
      await flushAsyncWork();
    });

    await expect(renamed).resolves.toBe(true);
    expect(rename).toHaveBeenCalledWith({
      workspaceId: "workspace",
      name: "Renamed Workspace"
    });
    expect(controller?.workspace?.name).toBe(
      "Renamed Workspace"
    );
    expect(controller?.workspaces[0]?.name).toBe(
      "Renamed Workspace"
    );
    expect(controller?.notice).toBe("Workspace 名称已更新。");
  });

  it("deletes a Workspace and reports cleanup warnings", async () => {
    const nextWorkspace = workspaceWithIdentity(
      "workspace-second",
      "Second Workspace"
    );
    const nextState = {
      ...createRuntimeState(nextWorkspace),
      cleanupWarning: "Workspace 配置文件未能清理。"
    } satisfies WorkspaceRuntimeStateDto;
    const deleteWorkspace = vi.fn(async () => ({
      ok: true as const,
      value: nextState
    }));
    installBridge({ delete: deleteWorkspace });
    await renderHarness();

    let deleted!: Promise<boolean>;
    act(() => {
      deleted = controller!.deleteWorkspace("workspace");
    });
    await act(async () => {
      await deleted;
      await flushAsyncWork();
    });

    await expect(deleted).resolves.toBe(true);
    expect(deleteWorkspace).toHaveBeenCalledWith({
      workspaceId: "workspace"
    });
    expect(controller?.workspace?.id).toBe("workspace-second");
    expect(controller?.notice).toContain(
      "磁盘上的仓库文件未被删除"
    );
    expect(controller?.notice).toContain("配置文件未能清理");
    expect(controller?.cleanupWarning).toBe(
      nextState.cleanupWarning
    );
  });

  it("removes a repository from the active Workspace", async () => {
    const nextWorkspace = workspaceWithoutTarget(
      workspaceWithTarget(TARGET_A),
      TARGET_A
    );
    const removeRepository = vi.fn(async () => ({
      ok: true as const,
      value: nextWorkspace
    }));
    installBridge({ removeRepository });
    await renderHarness();

    let removed!: Promise<boolean>;
    act(() => {
      removed = controller!.removeRepository(TARGET_A);
    });
    await act(async () => {
      await removed;
      await flushAsyncWork();
    });

    await expect(removed).resolves.toBe(true);
    expect(removeRepository).toHaveBeenCalledWith({
      target: TARGET_A
    });
    expect(
      controller?.workspace?.repositories.map(
        (repository) => repository.id
      )
    ).toEqual(["repository-b", "repository-c"]);
    expect(controller?.workspace?.excludes).toEqual([
      "repository-a"
    ]);
    expect(controller?.notice).toBe(
      "已移出 Workspace；磁盘上的仓库文件未被删除。"
    );
  });

  it("persists the collapsed state of a Workspace group", async () => {
    const nextWorkspace = {
      ...workspaceWithTarget(TARGET_A),
      groups: [
        {
          ...workspaceWithTarget(TARGET_A).groups[0]!,
          collapsed: true
        }
      ]
    } satisfies WorkspaceDetailsDto;
    const setGroupCollapsed = vi.fn(async () => ({
      ok: true as const,
      value: nextWorkspace
    }));
    installBridge({ setGroupCollapsed });
    await renderHarness();

    await act(async () => {
      await controller!.setGroupCollapsed("group", true);
      await flushAsyncWork();
    });

    expect(setGroupCollapsed).toHaveBeenCalledWith({
      groupId: "group",
      collapsed: true
    });
    expect(controller?.workspace?.groups[0]?.collapsed).toBe(
      true
    );
  });

  it("ignores a late repository removal after switching Workspace", async () => {
    const removal = deferred<
      Awaited<
        ReturnType<
          GitNestBridge["workspace"]["removeRepository"]
        >
      >
    >();
    const nextState = createRuntimeState(
      workspaceWithIdentity(
        "workspace-second",
        "Second Workspace"
      )
    );
    installBridge({
      removeRepository: vi.fn(() => removal.promise),
      switch: vi.fn(async () => ({
        ok: true as const,
        value: nextState
      }))
    });
    await renderHarness();

    let removing!: Promise<boolean>;
    act(() => {
      removing = controller!.removeRepository(TARGET_A);
    });
    await act(async () => {
      await controller!.switchWorkspace("workspace-second");
    });
    await act(async () => {
      removal.resolve({
        ok: true,
        value: workspaceWithoutTarget(
          workspaceWithTarget(TARGET_A),
          TARGET_A
        )
      });
      await removing;
      await flushAsyncWork();
    });

    await expect(removing).resolves.toBe(false);
    expect(controller?.workspace?.id).toBe("workspace-second");
    expect(controller?.notice).toBeNull();
  });

  it("does not let a late scan clear a pending switch or publish old feedback", async () => {
    const scan = deferred<
      Awaited<ReturnType<GitNestBridge["workspace"]["rescan"]>>
    >();
    const switching = deferred<
      Awaited<ReturnType<GitNestBridge["workspace"]["switch"]>>
    >();
    installBridge({
      rescan: vi.fn(() => scan.promise),
      switch: vi.fn(() => switching.promise)
    });
    await renderHarness();

    let scanning!: Promise<boolean>;
    let transition!: Promise<boolean>;
    act(() => {
      scanning = controller!.rescan();
      transition =
        controller!.switchWorkspace("workspace-second");
    });
    await act(async () => {
      scan.resolve({
        ok: true,
        value: workspaceWithTarget(TARGET_B)
      });
      await scanning;
    });

    expect(controller?.operation).toBe("switching");
    expect(controller?.notice).toBeNull();
    expect(controller?.workspace?.selectedTarget).toEqual(
      TARGET_A
    );

    await act(async () => {
      switching.resolve({
        ok: true,
        value: createRuntimeState(
          workspaceWithIdentity(
            "workspace-second",
            "Second Workspace"
          )
        )
      });
      await transition;
    });
  });

  it("does not let the initial state response overwrite a completed switch", async () => {
    const initial = deferred<
      Awaited<ReturnType<GitNestBridge["workspace"]["getState"]>>
    >();
    const nextState = createRuntimeState(
      workspaceWithIdentity(
        "workspace-second",
        "Second Workspace"
      )
    );
    installBridge({
      getState: vi.fn(() => initial.promise),
      switch: vi.fn(async () => ({
        ok: true as const,
        value: nextState
      }))
    });
    await renderHarness();

    await act(async () => {
      await controller!.switchWorkspace("workspace-second");
      initial.resolve({
        ok: true,
        value: createRuntimeState()
      });
      await flushAsyncWork();
    });

    expect(controller?.workspace?.id).toBe("workspace-second");
  });

  it("synchronizes the current Workspace topology after an asynchronous Worktree operation", async () => {
    const updatedWorkspace = {
      ...workspaceWithTarget(TARGET_A),
      worktrees: workspaceWithTarget(TARGET_A).worktrees.slice(0, 1),
      updatedAt: "2026-09-23T10:00:00.000Z"
    } satisfies WorkspaceDetailsDto;
    const getCurrent = vi.fn(async () => ({
      ok: true as const,
      value: updatedWorkspace
    }));
    installBridge({ getCurrent });
    await renderHarness();

    await act(async () => {
      await controller!.syncCurrentWorkspace();
    });

    expect(getCurrent).toHaveBeenCalledTimes(1);
    expect(controller?.workspace?.updatedAt).toBe(
      "2026-09-23T10:00:00.000Z"
    );
    expect(controller?.workspace?.worktrees).toHaveLength(1);
  });

  async function renderHarness() {
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
  }
});

function Harness({
  onController
}: {
  onController(value: WorkspaceController): void;
}) {
  onController(useWorkspace());
  return null;
}

function installBridge(
  overrides: Partial<GitNestBridge["workspace"]> = {}
) {
  const state = createRuntimeState();
  Object.defineProperty(window, "gitnest", {
    configurable: true,
    value: {
      workspace: {
        getCurrent: vi.fn(async () => ({
          ok: true as const,
          value: state.workspace
        })),
        getState: vi.fn(async () => ({
          ok: true as const,
          value: state
        })),
        create: vi.fn(async () => ({
          ok: true as const,
          value: state
        })),
        switch: vi.fn(async () => ({
          ok: true as const,
          value: state
        })),
        rename: vi.fn(async () => ({
          ok: true as const,
          value: state
        })),
        delete: vi.fn(async () => ({
          ok: true as const,
          value: state
        })),
        selectDirectory: vi.fn(async () => ({
          ok: true as const,
          value: {
            cancelled: true as const
          }
        })),
        addDirectory: vi.fn(async () => ({
          ok: true as const,
          value: {
            workspace: state.workspace,
            duplicate: true
          }
        })),
        rescan: vi.fn(async () => ({
          ok: true as const,
          value: state.workspace
        })),
        removeRepository: vi.fn(async () => ({
          ok: true as const,
          value: state.workspace
        })),
        setGroupCollapsed: vi.fn(async () => ({
          ok: true as const,
          value: state.workspace
        })),
        selectTarget: vi.fn(
          async ({
            target
          }: {
            target: RepositoryTargetDto;
          }) => ({
            ok: true as const,
            value: workspaceWithTarget(target)
          })
        ),
        refresh: vi.fn(async () => ({
          ok: true as const,
          value: {
            operationId: "operation"
          }
        })),
        onStateChanged: vi.fn(() => vi.fn()),
        ...overrides
      }
    } as unknown as GitNestBridge
  });
}

const TARGET_A: RepositoryTargetDto = {
  repositoryId: "repository-a",
  worktreeId: "worktree-a"
};
const TARGET_B: RepositoryTargetDto = {
  repositoryId: "repository-b",
  worktreeId: "worktree-b"
};
const TARGET_C: RepositoryTargetDto = {
  repositoryId: "repository-c",
  worktreeId: "worktree-c"
};

function createEmptyWorkspace(): WorkspaceDetailsDto {
  return {
    schemaVersion: 2,
    id: "workspace",
    name: "Workspace",
    excludes: [],
    groups: [],
    scanIssues: [],
    repositories: [],
    worktrees: [],
    updatedAt: "2026-09-16T12:00:00.000Z"
  };
}

function createRuntimeState(
  workspace: WorkspaceDetailsDto = workspaceWithTarget(
    TARGET_A
  ),
  workspaces: WorkspaceSummaryDto[] = [
    {
      id: workspace.id,
      name: workspace.name,
      updatedAt: workspace.updatedAt
    }
  ]
): WorkspaceRuntimeStateDto {
  return {
    workspace,
    workspaces,
    snapshots: [],
    operations: [],
    monitor: {
      mode: "inactive",
      watchedTargets: 0,
      message: "Workspace 监听未启用。"
    }
  };
}

function workspaceWithIdentity(
  id: string,
  name: string
): WorkspaceDetailsDto {
  return {
    ...workspaceWithTarget(TARGET_A),
    id,
    name,
    updatedAt: "2026-09-21T12:00:00.000Z"
  };
}

function workspaceWithTarget(
  selectedTarget: RepositoryTargetDto
): WorkspaceDetailsDto {
  return {
    schemaVersion: 2,
    id: "workspace",
    name: "Workspace",
    path: "C:\\workspace",
    canonicalPath: "c:\\workspace",
    excludes: [],
    groups: [
      {
        id: "group",
        name: "Group",
        collapsed: false,
        targets: [TARGET_A, TARGET_B, TARGET_C]
      }
    ],
    scanIssues: [],
    lastScannedAt: "2026-09-16T12:00:00.000Z",
    repositories: [TARGET_A, TARGET_B, TARGET_C].map(
      (target) => ({
        id: target.repositoryId,
        name: target.repositoryId,
        commonDir: `C:\\workspace\\${target.repositoryId}\\.git`,
        canonicalCommonDir: `c:\\workspace\\${target.repositoryId}\\.git`,
        primaryWorktreeId: target.worktreeId,
        worktreeIds: [target.worktreeId]
      })
    ),
    worktrees: [TARGET_A, TARGET_B, TARGET_C].map(
      (target) => ({
        id: target.worktreeId,
        repositoryId: target.repositoryId,
        name: target.repositoryId,
        path: `C:\\workspace\\${target.repositoryId}`,
        canonicalPath: `c:\\workspace\\${target.repositoryId}`,
        head: "a".repeat(40),
        branch: "main",
        isPrimary: true,
        isBare: false,
        isDetached: false,
        isLocked: false,
        isPrunable: false
      })
    ),
    selectedTarget,
    updatedAt: "2026-09-16T12:00:00.000Z"
  };
}

function workspaceWithoutTarget(
  workspace: WorkspaceDetailsDto,
  target: RepositoryTargetDto
): WorkspaceDetailsDto {
  return {
    ...workspace,
    excludes: ["repository-a"],
    groups: workspace.groups.map((group) => ({
      ...group,
      targets: group.targets.filter(
        (candidate) => !targetsEqual(candidate, target)
      )
    })),
    repositories: workspace.repositories.filter(
      (repository) => repository.id !== target.repositoryId
    ),
    worktrees: workspace.worktrees.filter(
      (worktree) =>
        worktree.id !== target.worktreeId ||
        worktree.repositoryId !== target.repositoryId
    ),
    selectedTarget: TARGET_B,
    updatedAt: "2026-09-21T09:00:00.000Z"
  };
}

function targetsEqual(
  left: RepositoryTargetDto,
  right: RepositoryTargetDto
): boolean {
  return (
    left.repositoryId === right.repositoryId &&
    left.worktreeId === right.worktreeId
  );
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolver) => {
    resolve = resolver;
  });
  return {
    promise,
    resolve
  };
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
