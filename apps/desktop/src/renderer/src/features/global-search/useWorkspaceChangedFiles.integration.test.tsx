/** @vitest-environment jsdom */

import React, { act } from "react";
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
  RepositoryChangesDto,
  RepositoryStatusSnapshotDto,
  RepositoryTargetDto,
  WorkspaceDetailsDto
} from "@gitnest/contracts";

import {
  useWorkspaceChangedFiles,
  type WorkspaceChangedFilesIndex
} from "./useWorkspaceChangedFiles";

describe("useWorkspaceChangedFiles", () => {
  let container: HTMLDivElement;
  let root: Root;
  let getChanges: ReturnType<typeof vi.fn>;

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
    getChanges = vi.fn();
    Object.defineProperty(window, "gitnest", {
      configurable: true,
      value: {
        repository: {
          cancelQuery: vi.fn().mockResolvedValue(undefined),
          getChanges
        }
      } as unknown as typeof window.gitnest
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("loads only repositories that may contain changes and reuses the revision cache", async () => {
    getChanges.mockResolvedValue({
      ok: true,
      value: createChanges(TARGET_A, "src/changed.ts")
    });
    let latest: WorkspaceChangedFilesIndex | undefined;

    await act(async () => {
      root.render(
        <Harness
          enabled
          snapshots={[
            createSnapshot(TARGET_A, {
              unstaged: 1
            }),
            createSnapshot(TARGET_B)
          ]}
          onChange={(value) => {
            latest = value;
          }}
        />
      );
      await flushPromises();
    });

    expect(getChanges).toHaveBeenCalledOnce();
    expect(getChanges.mock.calls[0]?.[0].target).toEqual(
      TARGET_A
    );
    expect(latest).toMatchObject({
      failedTargetCount: 0,
      loading: false
    });
    expect(
      latest?.changes[0]?.snapshot.changes[0]?.path
    ).toBe("src/changed.ts");

    await act(async () => {
      root.render(
        <Harness
          enabled={false}
          snapshots={[
            createSnapshot(TARGET_A, {
              unstaged: 1
            }),
            createSnapshot(TARGET_B)
          ]}
          onChange={(value) => {
            latest = value;
          }}
        />
      );
      await flushPromises();
      root.render(
        <Harness
          enabled
          snapshots={[
            createSnapshot(TARGET_A, {
              unstaged: 1
            }),
            createSnapshot(TARGET_B)
          ]}
          onChange={(value) => {
            latest = value;
          }}
        />
      );
      await flushPromises();
    });

    expect(getChanges).toHaveBeenCalledOnce();
    expect(latest?.changes).toHaveLength(1);
  });

  it("invalidates one target when its status revision changes and keeps partial results", async () => {
    getChanges
      .mockResolvedValueOnce({
        ok: true,
        value: createChanges(TARGET_A, "src/first.ts")
      })
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "COMMAND_FAILED",
          message: "read failed",
          details: {}
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        value: createChanges(TARGET_A, "src/second.ts")
      });
    let latest: WorkspaceChangedFilesIndex | undefined;

    await act(async () => {
      root.render(
        <Harness
          enabled
          snapshots={[
            createSnapshot(TARGET_A, {
              contentVersion: 1,
              unstaged: 1
            }),
            createSnapshot(TARGET_B, {
              contentVersion: 1,
              untracked: 1
            })
          ]}
          onChange={(value) => {
            latest = value;
          }}
        />
      );
      await flushPromises();
    });

    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(latest?.changes).toHaveLength(1);
    expect(latest?.failedTargetCount).toBe(1);

    await act(async () => {
      root.render(
        <Harness
          enabled
          snapshots={[
            createSnapshot(TARGET_A, {
              contentVersion: 1,
              refreshedAt: "2026-09-16T12:01:00.000Z",
              unstaged: 1
            }),
            createSnapshot(TARGET_B, {
              contentVersion: 2
            })
          ]}
          onChange={(value) => {
            latest = value;
          }}
        />
      );
      await flushPromises();
    });

    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(
      latest?.changes[0]?.snapshot.changes[0]?.path
    ).toBe("src/first.ts");
    expect(latest?.failedTargetCount).toBe(0);

    await act(async () => {
      root.render(
        <Harness
          enabled
          snapshots={[
            createSnapshot(TARGET_A, {
              contentVersion: 2,
              refreshedAt: "2026-09-16T12:01:00.000Z",
              unstaged: 1
            }),
            createSnapshot(TARGET_B, {
              contentVersion: 2
            })
          ]}
          onChange={(value) => {
            latest = value;
          }}
        />
      );
      await flushPromises();
    });

    expect(getChanges).toHaveBeenCalledTimes(3);
    expect(
      latest?.changes[0]?.snapshot.changes[0]?.path
    ).toBe("src/second.ts");
    expect(latest?.failedTargetCount).toBe(0);
  });

  it("never publishes the previous Workspace cache during a switch, even for a shared target", async () => {
    getChanges.mockResolvedValueOnce({
      ok: true,
      value: createChanges(TARGET_A, "old-workspace.ts")
    });
    const snapshots = [
      createSnapshot(TARGET_A, { unstaged: 1 }),
      createSnapshot(TARGET_B)
    ];
    await act(async () => {
      root.render(
        <Harness enabled snapshots={snapshots} onChange={() => {}} />
      );
      await flushPromises();
    });
    let resolveNew!: (value: unknown) => void;
    getChanges.mockImplementationOnce(() => new Promise((resolve) => {
      resolveNew = resolve;
    }));
    const observed: WorkspaceChangedFilesIndex[] = [];
    await act(async () => {
      root.render(
        <Harness
          enabled
          workspace={{ ...WORKSPACE, id: "workspace-second" }}
          snapshots={snapshots}
          onChange={(value) => observed.push(value)}
        />
      );
      await flushPromises();
    });
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every((value) => value.changes.length === 0)).toBe(true);
    await act(async () => {
      resolveNew({
        ok: true,
        value: createChanges(TARGET_A, "new-workspace.ts")
      });
      await flushPromises();
    });
    expect(observed.at(-1)?.changes[0]?.snapshot.changes[0]?.path)
      .toBe("new-workspace.ts");
  });
});

function Harness({
  enabled,
  workspace = WORKSPACE,
  snapshots,
  onChange
}: {
  enabled: boolean;
  workspace?: WorkspaceDetailsDto;
  snapshots: RepositoryStatusSnapshotDto[];
  onChange(value: WorkspaceChangedFilesIndex): void;
}) {
  const value = useWorkspaceChangedFiles(
    workspace,
    snapshots,
    enabled
  );
  onChange(value);
  return null;
}

const TARGET_A: RepositoryTargetDto = {
  repositoryId: "repository-a",
  worktreeId: "worktree-a"
};
const TARGET_B: RepositoryTargetDto = {
  repositoryId: "repository-b",
  worktreeId: "worktree-b"
};

const WORKSPACE: WorkspaceDetailsDto = {
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
      targets: [TARGET_A, TARGET_B]
    }
  ],
  scanIssues: [],
  lastScannedAt: "2026-09-16T12:00:00.000Z",
  repositories: [
    {
      id: TARGET_A.repositoryId,
      name: "repository-a",
      commonDir: "C:\\workspace\\a\\.git",
      canonicalCommonDir: "c:\\workspace\\a\\.git",
      primaryWorktreeId: TARGET_A.worktreeId,
      worktreeIds: [TARGET_A.worktreeId]
    },
    {
      id: TARGET_B.repositoryId,
      name: "repository-b",
      commonDir: "C:\\workspace\\b\\.git",
      canonicalCommonDir: "c:\\workspace\\b\\.git",
      primaryWorktreeId: TARGET_B.worktreeId,
      worktreeIds: [TARGET_B.worktreeId]
    }
  ],
  worktrees: [
    {
      id: TARGET_A.worktreeId,
      repositoryId: TARGET_A.repositoryId,
      name: "repository-a",
      path: "C:\\workspace\\a",
      canonicalPath: "c:\\workspace\\a",
      head: "a".repeat(40),
      branch: "main",
      isPrimary: true,
      isBare: false,
      isDetached: false,
      isLocked: false,
      isPrunable: false
    },
    {
      id: TARGET_B.worktreeId,
      repositoryId: TARGET_B.repositoryId,
      name: "repository-b",
      path: "C:\\workspace\\b",
      canonicalPath: "c:\\workspace\\b",
      head: "b".repeat(40),
      branch: "main",
      isPrimary: true,
      isBare: false,
      isDetached: false,
      isLocked: false,
      isPrunable: false
    }
  ],
  updatedAt: "2026-09-16T12:00:00.000Z"
};

function createSnapshot(
  target: RepositoryTargetDto,
  overrides: Partial<RepositoryStatusSnapshotDto> = {}
): RepositoryStatusSnapshotDto {
  return {
    ...target,
    branch: "main",
    head: "a".repeat(40),
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    refreshPending: false,
    stale: false,
    refreshedAt: "2026-09-16T12:00:00.000Z",
    ...overrides
  };
}

function createChanges(
  target: RepositoryTargetDto,
  path: string
): RepositoryChangesDto {
  return {
    target,
    snapshot: {
      branch: "main",
      head: "a".repeat(40),
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 1,
      untracked: 0,
      conflicted: 0,
      refreshedAt: "2026-09-16T12:00:00.000Z",
      changes: [
        {
          path,
          indexStatus: ".",
          worktreeStatus: "M",
          kind: "ordinary"
        }
      ]
    }
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}
