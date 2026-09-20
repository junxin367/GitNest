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

  it("replaces the complete runtime state after creating a Workspace", async () => {
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
    installBridge(
      vi.fn(async () => ({
        ok: true as const,
        value: workspaceWithTarget(TARGET_A)
      })),
      { create }
    );
    await renderHarness();

    let created!: Promise<boolean>;
    act(() => {
      created = controller!.createWorkspace(
        "Second Workspace"
      );
    });
    await act(async () => {
      await created;
      await flushAsyncWork();
    });

    await expect(created).resolves.toBe(true);
    expect(create).toHaveBeenCalledWith({
      name: "Second Workspace"
    });
    expect(controller?.workspace?.id).toBe(
      "workspace_second"
    );
    expect(controller?.workspaces).toHaveLength(2);
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
