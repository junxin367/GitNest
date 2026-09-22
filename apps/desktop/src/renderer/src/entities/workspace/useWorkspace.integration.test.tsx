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
  WorkspaceRuntimeStateDto
} from "@gitnest/contracts";

import {
  useWorkspace,
  type WorkspaceController
} from "./useWorkspace";

describe("useWorkspace target selection", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: WorkspaceController | undefined;

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
    installBridge(selectTarget);

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

  it("reasserts the current target when another selection is pending", async () => {
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
    installBridge(selectTarget);

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

  it("creates a scanned Workspace from the selected directory", async () => {
    const {
      selectedEntryId: _selectedEntryId,
      selectedTarget: _selectedTarget,
      ...workspaceBase
    } = workspaceWithTarget(TARGET_A);
    const secondWorkspace = {
      ...workspaceBase,
      id: "workspace_second",
      name: "Second Workspace",
      entries: [],
      repositories: [],
      worktrees: [],
      updatedAt: "2026-09-20T12:00:00.000Z"
    } satisfies WorkspaceDetailsDto;
    const scannedWorkspace = {
      ...workspaceWithTarget(TARGET_A),
      id: "workspace_second",
      name: "Second Workspace",
      updatedAt: "2026-09-20T12:01:00.000Z"
    } satisfies WorkspaceDetailsDto;
    const selectDirectory = vi.fn(async () => ({
      ok: true as const,
      value: {
        cancelled: false as const,
        path: "C:\\projects\\Second Workspace"
      }
    }));
    const create = vi.fn(async () => ({
      ok: true as const,
      value: {
        workspace: secondWorkspace,
        workspaces: [
          {
            id: "workspace",
            name: "Workspace",
            updatedAt: "2026-09-16T12:00:00.000Z"
          },
          {
            id: "workspace_second",
            name: "Second Workspace",
            updatedAt: "2026-09-20T12:00:00.000Z"
          }
        ],
        snapshots: [],
        operations: [],
        monitor: {
          mode: "inactive" as const,
          watchedTargets: 0,
          message: "当前没有可监听的仓库。"
        }
      }
    }));
    const addEntry = vi.fn(async () => ({
      ok: true as const,
      value: {
        workspace: scannedWorkspace,
        focusedEntryId: "entry",
        duplicate: false
      }
    }));
    installBridge(
      vi.fn(async () => ({
        ok: true as const,
        value: workspaceWithTarget(TARGET_A)
      })),
      { addEntry, create, selectDirectory }
    );
    await renderHarness();

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
      name: "Second Workspace"
    });
    expect(addEntry).toHaveBeenCalledWith({
      path: "C:\\projects\\Second Workspace",
      source: "picker"
    });
    expect(controller?.workspace?.id).toBe(
      "workspace_second"
    );
    expect(controller?.workspace?.entries).toHaveLength(1);
    expect(controller?.workspaces).toHaveLength(2);
    expect(controller?.notice).toBe(
      "Workspace“Second Workspace”已创建并完成目录扫描。"
    );
  });

  it("deletes the previous empty Workspace after creating the first scanned Workspace", async () => {
    const {
      selectedEntryId: _selectedEntryId,
      selectedTarget: _selectedTarget,
      ...workspaceBase
    } = workspaceWithTarget(TARGET_A);
    const emptyWorkspace = {
      ...workspaceBase,
      entries: [],
      repositories: [],
      worktrees: []
    } satisfies WorkspaceDetailsDto;
    const createdWorkspace = {
      ...emptyWorkspace,
      id: "workspace_second",
      name: "Second Workspace",
      updatedAt: "2026-09-20T12:00:00.000Z"
    } satisfies WorkspaceDetailsDto;
    const scannedWorkspace = {
      ...workspaceWithTarget(TARGET_A),
      id: "workspace_second",
      name: "Second Workspace",
      updatedAt: "2026-09-20T12:01:00.000Z"
    } satisfies WorkspaceDetailsDto;
    const initialState: WorkspaceRuntimeStateDto = {
      ...createRuntimeState(),
      workspace: emptyWorkspace
    };
    const createdState: WorkspaceRuntimeStateDto = {
      ...initialState,
      workspace: createdWorkspace,
      workspaces: [
        ...initialState.workspaces,
        {
          id: createdWorkspace.id,
          name: createdWorkspace.name,
          updatedAt: createdWorkspace.updatedAt
        }
      ]
    };
    const finalState: WorkspaceRuntimeStateDto = {
      ...createdState,
      workspace: scannedWorkspace,
      workspaces: [
        {
          id: scannedWorkspace.id,
          name: scannedWorkspace.name,
          updatedAt: scannedWorkspace.updatedAt
        }
      ]
    };
    const deleteWorkspace = vi.fn(async () => ({
      ok: true as const,
      value: finalState
    }));
    installBridge(
      vi.fn(async () => ({
        ok: true as const,
        value: scannedWorkspace
      })),
      {
        getState: vi.fn(async () => ({
          ok: true as const,
          value: initialState
        })),
        selectDirectory: vi.fn(async () => ({
          ok: true as const,
          value: {
            cancelled: false as const,
            path: "C:\\projects\\Second Workspace"
          }
        })),
        create: vi.fn(async () => ({
          ok: true as const,
          value: createdState
        })),
        addEntry: vi.fn(async () => ({
          ok: true as const,
          value: {
            workspace: scannedWorkspace,
            focusedEntryId: "entry",
            duplicate: false
          }
        })),
        delete: deleteWorkspace
      }
    );
    await renderHarness();

    let created!: Promise<boolean>;
    act(() => {
      created = controller!.createWorkspace();
    });
    await act(async () => {
      await created;
      await flushAsyncWork();
    });

    await expect(created).resolves.toBe(true);
    expect(deleteWorkspace).toHaveBeenCalledWith({
      workspaceId: "workspace"
    });
    expect(controller?.workspace?.id).toBe("workspace_second");
    expect(controller?.workspaces).toHaveLength(1);
  });

  it("removes an empty Workspace and restores the previous one when scanning fails", async () => {
    const {
      selectedEntryId: _selectedEntryId,
      selectedTarget: _selectedTarget,
      ...workspaceBase
    } = workspaceWithTarget(TARGET_A);
    const secondWorkspace = {
      ...workspaceBase,
      id: "workspace_second",
      name: "Empty",
      entries: [],
      repositories: [],
      worktrees: [],
      updatedAt: "2026-09-20T12:00:00.000Z"
    } satisfies WorkspaceDetailsDto;
    const createdState: WorkspaceRuntimeStateDto = {
      ...createRuntimeState(),
      workspace: secondWorkspace,
      workspaces: [
        ...createRuntimeState().workspaces,
        {
          id: secondWorkspace.id,
          name: secondWorkspace.name,
          updatedAt: secondWorkspace.updatedAt
        }
      ]
    };
    const removeWorkspace = vi.fn(async () => ({
      ok: true as const,
      value: createRuntimeState()
    }));
    installBridge(
      vi.fn(async () => ({
        ok: true as const,
        value: workspaceWithTarget(TARGET_A)
      })),
      {
        selectDirectory: vi.fn(async () => ({
          ok: true as const,
          value: {
            cancelled: false as const,
            path: "C:\\projects\\Empty"
          }
        })),
        create: vi.fn(async () => ({
          ok: true as const,
          value: createdState
        })),
        addEntry: vi.fn(async () => ({
          ok: false as const,
          error: {
            code: "NO_REPOSITORIES_FOUND" as const,
            message:
              "No Git repositories were found in the selected directory.",
            details: {}
          }
        })),
        delete: removeWorkspace
      }
    );
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
    expect(removeWorkspace).toHaveBeenCalledWith({
      workspaceId: "workspace_second"
    });
    expect(controller?.workspace?.id).toBe("workspace");
    expect(controller?.workspaces).toHaveLength(1);
    expect(controller?.error?.code).toBe(
      "NO_REPOSITORIES_FOUND"
    );
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
  selectTarget: GitNestBridge["workspace"]["selectTarget"],
  overrides: Partial<GitNestBridge["workspace"]> = {}
) {
  Object.defineProperty(window, "gitnest", {
    configurable: true,
    value: {
      workspace: {
        getState: vi.fn(async () => ({
          ok: true as const,
          value: createRuntimeState()
        })),
        onStateChanged: vi.fn(() => vi.fn()),
        selectTarget,
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

function createRuntimeState(): WorkspaceRuntimeStateDto {
  return {
    workspace: workspaceWithTarget(TARGET_A),
    workspaces: [
      {
        id: "workspace",
        name: "Workspace",
        updatedAt: "2026-09-16T12:00:00.000Z"
      }
    ],
    snapshots: [],
    operations: [],
    monitor: {
      mode: "inactive",
      watchedTargets: 0,
      message: "Workspace 监听未启用。"
    }
  };
}

function workspaceWithTarget(
  selectedTarget: RepositoryTargetDto
): WorkspaceDetailsDto {
  return {
    schemaVersion: 1,
    id: "workspace",
    name: "Workspace",
    entries: [
      {
        id: "entry",
        kind: "workspace-directory",
        displayName: "Workspace",
        path: "C:\\workspace",
        canonicalPath: "c:\\workspace",
        excludes: [],
        order: 0,
        groups: [
          {
            id: "group",
            name: "Group",
            collapsed: false,
            targets: [TARGET_A, TARGET_B, TARGET_C]
          }
        ],
        scanIssues: [],
        lastScannedAt: "2026-09-16T12:00:00.000Z"
      }
    ],
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
    selectedEntryId: "entry",
    selectedTarget,
    updatedAt: "2026-09-16T12:00:00.000Z"
  };
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
