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
  let cancelQuery: ReturnType<typeof vi.fn>;

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
    cancelQuery = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "gitnest", {
      configurable: true,
      value: {
        repository: {
          cancelQuery,
          getChanges
        }
      } as unknown as typeof window.gitnest
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reports loading on the first enabled render instead of publishing the disabled empty state", async () => {
    const snapshots = [
      createSnapshot(TARGET_A, { unstaged: 1 }),
      createSnapshot(TARGET_B)
    ];
    await act(async () => {
      root.render(<Harness enabled={false} snapshots={snapshots} onChange={() => {}} />);
      await flushPromises();
    });
    getChanges.mockImplementation(() => new Promise(() => {}));
    const observed: WorkspaceChangedFilesIndex[] = [];
    await act(async () => {
      root.render(<Harness enabled snapshots={snapshots} onChange={(value) => observed.push(value)} />);
      await flushPromises();
    });

    expect(observed[0]?.loaded).toBe(false);
    expect(observed[0]?.loading).toBe(true);
    expect(observed.every((value) => value.loading)).toBe(true);
  });

  it("does not inspect snapshots or publish another state while indexing is disabled", async () => {
    let snapshotReads = 0;
    const observed: WorkspaceChangedFilesIndex[] = [];
    const snapshots = countIndexedReads(
      [
        createSnapshot(TARGET_A, { unstaged: 1 }),
        createSnapshot(TARGET_B)
      ],
      () => snapshotReads += 1
    );
    const onChange = (value: WorkspaceChangedFilesIndex) => {
      observed.push(value);
    };

    await act(async () => {
      root.render(
        <Harness
          enabled={false}
          snapshots={snapshots}
          onChange={onChange}
        />
      );
      await flushPromises();
    });
    await act(async () => {
      root.render(
        <Harness
          enabled={false}
          snapshots={countIndexedReads(
            [
              createSnapshot(TARGET_A, {
                unstaged: 1,
                refreshedAt: "2026-10-05T00:00:01.000Z",
              }),
              createSnapshot(TARGET_B, {
                refreshedAt: "2026-10-05T00:00:01.000Z",
              }),
            ],
            () => snapshotReads += 1
          )}
          onChange={onChange}
        />
      );
      await flushPromises();
    });

    expect(snapshotReads).toBe(0);
    expect(observed).toHaveLength(2);
    expect(observed.every((value) =>
      !value.loading &&
      !value.loaded &&
      value.changes.length === 0
    )).toBe(true);
    expect(getChanges).not.toHaveBeenCalled();
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
    expect(getChanges).toHaveBeenCalledWith(
      expect.objectContaining({
        target: TARGET_A,
        includeChangeStats: false
      })
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

  it("invalidates cached changes when a target path is replaced without a status revision change", async () => {
    getChanges
      .mockResolvedValueOnce({
        ok: true,
        value: createChanges(TARGET_A, "src/old-worktree.ts")
      })
      .mockResolvedValueOnce({
        ok: true,
        value: createChanges(TARGET_A, "src/replacement-worktree.ts")
      });
    const snapshots = [
      createSnapshot(TARGET_A, {
        contentVersion: 1,
        unstaged: 1
      }),
      createSnapshot(TARGET_B)
    ];
    let workspace = WORKSPACE;
    let latest: WorkspaceChangedFilesIndex | undefined;
    const render = () =>
      root.render(
        <Harness
          enabled
          workspace={workspace}
          snapshots={snapshots}
          onChange={(value) => {
            latest = value;
          }}
        />
      );

    await act(async () => {
      render();
      await flushPromises();
    });
    expect(getChanges).toHaveBeenCalledOnce();
    expect(
      latest?.changes[0]?.snapshot.changes[0]?.path
    ).toBe("src/old-worktree.ts");

    workspace = {
      ...workspace,
      worktrees: workspace.worktrees.map((worktree) =>
        worktree.id === TARGET_A.worktreeId
          ? {
              ...worktree,
              path: "C:\\workspace\\replacement-a",
              canonicalPath: "c:\\workspace\\replacement-a"
            }
          : worktree
      )
    };
    await act(async () => {
      render();
      await flushPromises();
    });

    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(
      latest?.changes[0]?.snapshot.changes[0]?.path
    ).toBe("src/replacement-worktree.ts");
  });

  it("refreshes a status revision that changes while indexing is disabled", async () => {
    getChanges
      .mockResolvedValueOnce({
        ok: true,
        value: createChanges(TARGET_A, "src/before-close.ts")
      })
      .mockResolvedValueOnce({
        ok: true,
        value: createChanges(TARGET_A, "src/after-reopen.ts")
      });
    let snapshots = [
      createSnapshot(TARGET_A, {
        contentVersion: 1,
        unstaged: 1
      }),
      createSnapshot(TARGET_B)
    ];
    let latest: WorkspaceChangedFilesIndex | undefined;
    const render = (enabled: boolean) =>
      root.render(
        <Harness
          enabled={enabled}
          snapshots={snapshots}
          onChange={(value) => {
            latest = value;
          }}
        />
      );

    await act(async () => {
      render(true);
      await flushPromises();
    });
    await act(async () => {
      render(false);
      await flushPromises();
    });
    snapshots = snapshots.map((snapshot, index) =>
      index === 0
        ? { ...snapshot, contentVersion: 2 }
        : snapshot
    );
    await act(async () => {
      render(false);
      await flushPromises();
    });
    await act(async () => {
      render(true);
      await flushPromises();
    });

    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(
      latest?.changes[0]?.snapshot.changes[0]?.path
    ).toBe("src/after-reopen.ts");
  });

  it("indexes each snapshot once when building plans for many targets", async () => {
    const targets = Array.from({ length: 100 }, (_, index) => ({
      repositoryId: `repository-${index}`,
      worktreeId: `worktree-${index}`
    }));
    const workspace: WorkspaceDetailsDto = {
      ...WORKSPACE,
      groups: [
        {
          ...WORKSPACE.groups[0]!,
          targets
        }
      ],
      repositories: [],
      worktrees: []
    };
    let snapshotReads = 0;
    const snapshotValues = [...targets]
      .reverse()
      .map((target) => createSnapshot(target));
    const snapshots = new Proxy(snapshotValues, {
      get(target, property, receiver) {
        if (
          typeof property === "string" &&
          /^\d+$/.test(property)
        ) {
          snapshotReads += 1;
        }
        return Reflect.get(target, property, receiver);
      }
    });

    await act(async () => {
      root.render(
        <Harness
          enabled
          workspace={workspace}
          snapshots={snapshots}
          onChange={() => {}}
        />
      );
      await flushPromises();
    });

    expect(getChanges).not.toHaveBeenCalled();
    expect(snapshotReads).toBe(snapshotValues.length);
  });

  it("uses the first matching snapshot when a target appears more than once", async () => {
    await act(async () => {
      root.render(
        <Harness
          enabled
          snapshots={[
            createSnapshot(TARGET_A),
            createSnapshot(TARGET_A, {
              stale: true,
              unstaged: 1
            }),
            createSnapshot(TARGET_B)
          ]}
          onChange={() => {}}
        />
      );
      await flushPromises();
    });

    expect(getChanges).not.toHaveBeenCalled();
  });

  it("keeps first target order, removes duplicate targets, and reads missing snapshots", async () => {
    const targetC: RepositoryTargetDto = {
      repositoryId: "repository-c",
      worktreeId: "worktree-c"
    };
    const workspace: WorkspaceDetailsDto = {
      ...WORKSPACE,
      groups: [
        {
          ...WORKSPACE.groups[0]!,
          targets: [TARGET_B, TARGET_A, TARGET_B, targetC]
        }
      ]
    };
    getChanges.mockImplementation(
      ({
        target
      }: {
        target: RepositoryTargetDto;
      }) =>
        Promise.resolve({
          ok: true,
          value: createChanges(
            target,
            `${target.repositoryId}.ts`
          )
        })
    );
    let latest: WorkspaceChangedFilesIndex | undefined;

    await act(async () => {
      root.render(
        <Harness
          enabled
          workspace={workspace}
          snapshots={[
            createSnapshot(TARGET_A, { unstaged: 1 }),
            createSnapshot(TARGET_B, { unstaged: 1 })
          ]}
          onChange={(value) => {
            latest = value;
          }}
        />
      );
      await flushPromises();
    });

    expect(
      getChanges.mock.calls.map((call) => call[0].target)
    ).toEqual([TARGET_B, TARGET_A, targetC]);
    expect(
      latest?.changes.map((change) => change.target)
    ).toEqual([TARGET_B, TARGET_A, targetC]);
  });

  it("does not cache a cancelled read and retries it when indexing is enabled again", async () => {
    let resolveFirst!: (value: unknown) => void;
    getChanges
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce({
        ok: true,
        value: createChanges(TARGET_A, "src/retried.ts")
      });
    const snapshots = [
      createSnapshot(TARGET_A, { unstaged: 1 }),
      createSnapshot(TARGET_B)
    ];
    let latest: WorkspaceChangedFilesIndex | undefined;
    const onChange = (value: WorkspaceChangedFilesIndex) => {
      latest = value;
    };

    await act(async () => {
      root.render(
        <Harness
          enabled
          snapshots={snapshots}
          onChange={onChange}
        />
      );
      await flushPromises();
    });
    const firstQueryId =
      getChanges.mock.calls[0]?.[0].queryId;

    await act(async () => {
      root.render(
        <Harness
          enabled={false}
          snapshots={snapshots}
          onChange={onChange}
        />
      );
      await flushPromises();
    });

    expect(cancelQuery).toHaveBeenCalledWith({
      queryId: firstQueryId
    });
    expect(latest?.changes).toHaveLength(0);

    await act(async () => {
      resolveFirst({
        ok: true,
        value: createChanges(TARGET_A, "src/cancelled.ts")
      });
      await flushPromises();
      root.render(
        <Harness
          enabled
          snapshots={snapshots}
          onChange={onChange}
        />
      );
      await flushPromises();
    });

    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(
      latest?.changes[0]?.snapshot.changes[0]?.path
    ).toBe("src/retried.ts");
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

  it("retains current target results while a newer status revision is read", async () => {
    getChanges.mockResolvedValueOnce({
      ok: true,
      value: createChanges(TARGET_A, "src/previous.ts")
    });
    let latest: WorkspaceChangedFilesIndex | undefined;
    const onChange = (value: WorkspaceChangedFilesIndex) => { latest = value; };
    await act(async () => {
      root.render(
        <Harness enabled snapshots={[
          createSnapshot(TARGET_A, { contentVersion: 1, unstaged: 1 }),
          createSnapshot(TARGET_B)
        ]} onChange={onChange} />
      );
      await flushPromises();
    });
    let resolveRefresh!: (value: unknown) => void;
    getChanges.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    await act(async () => {
      root.render(
        <Harness enabled snapshots={[
          createSnapshot(TARGET_A, { contentVersion: 2, unstaged: 1 }),
          createSnapshot(TARGET_B)
        ]} onChange={onChange} />
      );
      await flushPromises();
    });
    expect(latest?.loading).toBe(true);
    expect(latest?.loaded).toBe(true);
    expect(latest?.changes[0]?.snapshot.changes[0]?.path).toBe("src/previous.ts");
    await act(async () => {
      resolveRefresh({ ok: true, value: createChanges(TARGET_A, "src/current.ts") });
      await flushPromises();
    });
    expect(latest?.loading).toBe(false);
    expect(latest?.changes[0]?.snapshot.changes[0]?.path).toBe("src/current.ts");
  });

  it("preserves indexed results and reports a failed background refresh", async () => {
    getChanges
      .mockResolvedValueOnce({ ok: true, value: createChanges(TARGET_A, "src/available.ts") })
      .mockRejectedValueOnce(new Error("temporary read failure"));
    let latest: WorkspaceChangedFilesIndex | undefined;
    const onChange = (value: WorkspaceChangedFilesIndex) => { latest = value; };
    await act(async () => {
      root.render(
        <Harness enabled snapshots={[
          createSnapshot(TARGET_A, { contentVersion: 1, unstaged: 1 }),
          createSnapshot(TARGET_B)
        ]} onChange={onChange} />
      );
      await flushPromises();
    });
    await act(async () => {
      root.render(
        <Harness enabled snapshots={[
          createSnapshot(TARGET_A, { contentVersion: 2, unstaged: 1 }),
          createSnapshot(TARGET_B)
        ]} onChange={onChange} />
      );
      await flushPromises();
    });
    expect(latest?.changes[0]?.snapshot.changes[0]?.path).toBe("src/available.ts");
    expect(latest?.loaded).toBe(true);
    expect(latest?.loading).toBe(false);
    expect(latest?.failedTargetCount).toBe(1);
  });

  it("retains a known empty index while a stale target is refreshed", async () => {
    let latest: WorkspaceChangedFilesIndex | undefined;
    const onChange = (value: WorkspaceChangedFilesIndex) => { latest = value; };
    await act(async () => {
      root.render(
        <Harness enabled snapshots={[createSnapshot(TARGET_A), createSnapshot(TARGET_B)]}
          onChange={onChange} />
      );
      await flushPromises();
    });
    getChanges.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => {
      root.render(
        <Harness enabled snapshots={[createSnapshot(TARGET_A, { stale: true }), createSnapshot(TARGET_B)]}
          onChange={onChange} />
      );
      await flushPromises();
    });
    expect(latest?.loading).toBe(true);
    expect(latest?.loaded).toBe(true);
    expect(latest?.changes).toEqual([]);
  });

  it("reads a repository when a previously clean snapshot becomes stale", async () => {
    getChanges.mockResolvedValue({
      ok: true,
      value: createChanges(TARGET_A, "src/appeared.ts")
    });
    let latest: WorkspaceChangedFilesIndex | undefined;
    const cleanSnapshots = [
      createSnapshot(TARGET_A),
      createSnapshot(TARGET_B)
    ];

    await act(async () => {
      root.render(
        <Harness
          enabled
          snapshots={cleanSnapshots}
          onChange={(value) => {
            latest = value;
          }}
        />
      );
      await flushPromises();
    });

    expect(getChanges).not.toHaveBeenCalled();
    expect(latest?.changes).toHaveLength(0);

    await act(async () => {
      root.render(
        <Harness
          enabled
          snapshots={[
            createSnapshot(TARGET_A, { stale: true }),
            cleanSnapshots[1]!
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
    expect(
      latest?.changes[0]?.snapshot.changes[0]?.path
    ).toBe("src/appeared.ts");
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

  it("batches nearby repository completions while preserving failures and the final state", async () => {
    vi.useFakeTimers();
    const targetC: RepositoryTargetDto = {
      repositoryId: "repository-c",
      worktreeId: "worktree-c"
    };
    const workspace: WorkspaceDetailsDto = {
      ...WORKSPACE,
      groups: [
        {
          ...WORKSPACE.groups[0]!,
          targets: [TARGET_A, TARGET_B, targetC]
        }
      ]
    };
    const first = deferred<Awaited<ReturnType<
      typeof window.gitnest.repository.getChanges
    >>>();
    const second = deferred<Awaited<ReturnType<
      typeof window.gitnest.repository.getChanges
    >>>();
    const third = deferred<Awaited<ReturnType<
      typeof window.gitnest.repository.getChanges
    >>>();
    getChanges
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    const observed: WorkspaceChangedFilesIndex[] = [];

    await act(async () => {
      root.render(
        <Harness
          enabled
          workspace={workspace}
          snapshots={[
            createSnapshot(TARGET_A, { unstaged: 1 }),
            createSnapshot(TARGET_B, { unstaged: 1 }),
            createSnapshot(targetC, { unstaged: 1 })
          ]}
          onChange={(value) => observed.push(value)}
        />
      );
      await flushPromises();
    });
    await act(async () => {
      first.resolve({
        ok: true,
        value: createChanges(TARGET_A, "src/first.ts")
      });
      second.resolve({
        ok: false,
        error: {
          code: "COMMAND_FAILED",
          message: "failed",
          details: {}
        }
      });
      await flushPromises();
    });

    expect(vi.getTimerCount()).toBe(1);
    expect(observed.at(-1)?.changes).toHaveLength(0);
    act(() => vi.advanceTimersByTime(16));
    expect(observed.at(-1)).toMatchObject({
      changes: [
        expect.objectContaining({
          target: TARGET_A
        })
      ],
      failedTargetCount: 1,
      loading: true
    });

    await act(async () => {
      third.resolve({
        ok: true,
        value: createChanges(targetC, "src/third.ts")
      });
      await flushPromises();
    });
    expect(observed.at(-1)).toMatchObject({
      failedTargetCount: 1,
      loading: false
    });
    expect(
      observed.at(-1)?.changes.map((change) => change.target)
    ).toEqual([TARGET_A, targetC]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears a scheduled partial publication when the Workspace generation changes", async () => {
    vi.useFakeTimers();
    const first = deferred<Awaited<ReturnType<
      typeof window.gitnest.repository.getChanges
    >>>();
    const oldPending = deferred<Awaited<ReturnType<
      typeof window.gitnest.repository.getChanges
    >>>();
    const newPending = deferred<Awaited<ReturnType<
      typeof window.gitnest.repository.getChanges
    >>>();
    getChanges
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(oldPending.promise)
      .mockReturnValueOnce(newPending.promise);
    const snapshots = [
      createSnapshot(TARGET_A, { unstaged: 1 }),
      createSnapshot(TARGET_B, { unstaged: 1 })
    ];
    const observed: WorkspaceChangedFilesIndex[] = [];
    const onChange = (value: WorkspaceChangedFilesIndex) => {
      observed.push(value);
    };

    await act(async () => {
      root.render(
        <Harness
          enabled
          snapshots={snapshots}
          onChange={onChange}
        />
      );
      await flushPromises();
    });
    await act(async () => {
      first.resolve({
        ok: true,
        value: createChanges(TARGET_A, "old-partial.ts")
      });
      await flushPromises();
    });
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      root.render(
        <Harness
          enabled
          workspace={{
            ...WORKSPACE,
            id: "workspace-next",
            groups: [
              {
                ...WORKSPACE.groups[0]!,
                targets: [TARGET_A]
              }
            ]
          }}
          snapshots={[snapshots[0]!]}
          onChange={onChange}
        />
      );
      await flushPromises();
    });
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(16));
    expect(
      observed
        .slice(-2)
        .every((value) => value.changes.length === 0)
    ).toBe(true);

    await act(async () => {
      oldPending.resolve({
        ok: true,
        value: createChanges(TARGET_B, "old-late.ts")
      });
      await flushPromises();
    });
    expect(
      observed.at(-1)?.changes.some((change) =>
        change.snapshot.changes.some((item) =>
          item.path.startsWith("old-")
        )
      )
    ).toBe(false);

    await act(async () => {
      newPending.resolve({
        ok: true,
        value: createChanges(TARGET_A, "new-current.ts")
      });
      await flushPromises();
    });
    expect(observed.at(-1)?.changes[0]?.snapshot.changes[0]?.path)
      .toBe("new-current.ts");
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

function countIndexedReads<Value>(
  values: Value[],
  onRead: () => void
): Value[] {
  return new Proxy(values, {
    get(target, property, receiver) {
      if (
        typeof property === "string" &&
        /^\d+$/.test(property)
      ) {
        onRead();
      }
      return Reflect.get(target, property, receiver);
    }
  });
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    promise,
    resolve,
    reject
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}
