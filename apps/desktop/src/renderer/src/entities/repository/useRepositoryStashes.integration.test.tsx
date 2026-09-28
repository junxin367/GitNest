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
  RepositoryStashFilesDto,
  RepositoryStashesDto,
  RepositoryTargetDto
} from "@gitnest/contracts";

import {
  useRepositoryStashes,
  type RepositoryStashesController
} from "./useRepositoryStashes";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const TARGET_A: RepositoryTargetDto = {
  repositoryId: "repository-stash-a",
  worktreeId: "worktree-a"
};
const TARGET_B: RepositoryTargetDto = {
  repositoryId: "repository-stash-b",
  worktreeId: "worktree-b"
};

describe("useRepositoryStashes", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: RepositoryStashesController | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("loads on demand and reads files for the selected stash", async () => {
    const getStashes = vi.fn(async () => ({
      ok: true as const,
      value: createStashes(TARGET_A, [
        "stash@{0}",
        "stash@{1}"
      ])
    }));
    const getStashFiles = vi.fn(
      async (
        request: Parameters<
          GitNestBridge["repository"]["getStashFiles"]
        >[0]
      ) => ({
        ok: true as const,
        value: createFiles(TARGET_A, request.stashRef)
      })
    );
    installBridge({ getStashes, getStashFiles });

    await act(async () => {
      root.render(
        <Harness
          scopeKey="workspace-a:repository-a"
          target={TARGET_A}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });

    expect(getStashes).not.toHaveBeenCalled();

    await act(async () => {
      await controller?.load();
      await flushAsyncWork();
    });

    expect(getStashes).toHaveBeenCalledTimes(1);
    expect(getStashFiles).toHaveBeenCalledWith(
      expect.objectContaining({ stashRef: "stash@{0}" })
    );
    expect(controller?.selectedStashRef).toBe("stash@{0}");
    expect(controller?.stashFiles?.stash.ref).toBe(
      "stash@{0}"
    );

    await act(async () => {
      await controller?.selectStash("stash@{1}");
      await flushAsyncWork();
    });

    expect(getStashFiles).toHaveBeenLastCalledWith(
      expect.objectContaining({ stashRef: "stash@{1}" })
    );
    expect(controller?.selectedStashRef).toBe("stash@{1}");
    expect(controller?.stashFiles?.stash.ref).toBe(
      "stash@{1}"
    );
  });

  it("ignores an old repository response after the target changes", async () => {
    let resolveTargetA!: (
      result: Awaited<
        ReturnType<
          GitNestBridge["repository"]["getStashes"]
        >
      >
    ) => void;
    const cancelQuery = vi.fn(async () => ({
      ok: true as const,
      value: undefined
    }));
    const getStashes = vi.fn(
      (
        request: Parameters<
          GitNestBridge["repository"]["getStashes"]
        >[0]
      ): ReturnType<
        GitNestBridge["repository"]["getStashes"]
      > => {
        if (request.target.repositoryId === TARGET_A.repositoryId) {
          return new Promise<
            Awaited<
              ReturnType<
                GitNestBridge["repository"]["getStashes"]
              >
            >
          >((resolve) => {
            resolveTargetA = resolve;
          });
        }
        return Promise.resolve({
          ok: true as const,
          value: createStashes(TARGET_B, ["stash@{0}"])
        });
      }
    );
    const getStashFiles = vi.fn(
      async (
        request: Parameters<
          GitNestBridge["repository"]["getStashFiles"]
        >[0]
      ) => ({
        ok: true as const,
        value: createFiles(request.target, request.stashRef)
      })
    );
    installBridge({
      cancelQuery,
      getStashes,
      getStashFiles
    });

    await act(async () => {
      root.render(
        <Harness
          scopeKey="workspace-stale:a"
          target={TARGET_A}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });

    let oldLoad: Promise<void> | undefined;
    await act(async () => {
      oldLoad = controller?.load();
      await flushAsyncWork();
    });

    await act(async () => {
      root.render(
        <Harness
          scopeKey="workspace-stale:b"
          target={TARGET_B}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });
    await act(async () => {
      await controller?.load();
      await flushAsyncWork();
    });

    expect(controller?.stashes?.target).toEqual(TARGET_B);
    expect(cancelQuery).toHaveBeenCalled();

    await act(async () => {
      resolveTargetA({
        ok: true,
        value: createStashes(TARGET_A, ["stash@{9}"])
      });
      await oldLoad;
      await flushAsyncWork();
    });

    expect(controller?.stashes?.target).toEqual(TARGET_B);
    expect(controller?.selectedStashRef).toBe("stash@{0}");
  });

  it("keeps the same stash selected when reflog positions change", async () => {
    const firstList = createStashes(TARGET_A, [
      "stash@{0}",
      "stash@{1}"
    ]);
    const selectedHash = firstList.stashes[1]!.hash;
    const secondList: RepositoryStashesDto = {
      target: TARGET_A,
      stashes: [
        createStash("stash@{0}", "3".repeat(40), 3),
        createStash(
          "stash@{1}",
          firstList.stashes[0]!.hash,
          1
        ),
        createStash("stash@{2}", selectedHash, 2)
      ]
    };
    const getStashes = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: firstList
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: secondList
      });
    const getStashFiles = vi.fn(
      async (
        request: Parameters<
          GitNestBridge["repository"]["getStashFiles"]
        >[0]
      ) => {
        const source =
          getStashes.mock.calls.length > 1
            ? secondList
            : firstList;
        const hash =
          source.stashes.find(
            (stash) => stash.ref === request.stashRef
          )?.hash ?? "";
        return {
          ok: true as const,
          value: createFiles(
            request.target,
            request.stashRef,
            hash
          )
        };
      }
    );
    installBridge({ getStashes, getStashFiles });

    await act(async () => {
      root.render(
        <Harness
          scopeKey="workspace-reordered"
          target={TARGET_A}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });
    await act(async () => {
      await controller?.load();
      await controller?.selectStash("stash@{1}");
      await controller?.reload();
      await flushAsyncWork();
    });

    expect(controller?.selectedStashRef).toBe("stash@{2}");
    expect(controller?.stashFiles?.stash.hash).toBe(selectedHash);
    expect(getStashFiles).toHaveBeenLastCalledWith(
      expect.objectContaining({ stashRef: "stash@{2}" })
    );
  });

  it("ignores an old stash-files response after the target changes", async () => {
    let resolveTargetAFiles!: (
      result: Awaited<
        ReturnType<
          GitNestBridge["repository"]["getStashFiles"]
        >
      >
    ) => void;
    const getStashes = vi.fn(
      async (
        request: Parameters<
          GitNestBridge["repository"]["getStashes"]
        >[0]
      ) => ({
        ok: true as const,
        value: createStashes(request.target, ["stash@{0}"])
      })
    );
    const getStashFiles = vi.fn(
      (
        request: Parameters<
          GitNestBridge["repository"]["getStashFiles"]
        >[0]
      ): ReturnType<
        GitNestBridge["repository"]["getStashFiles"]
      > => {
        if (request.target.repositoryId === TARGET_A.repositoryId) {
          return new Promise<
            Awaited<
              ReturnType<
                GitNestBridge["repository"]["getStashFiles"]
              >
            >
          >((resolve) => {
            resolveTargetAFiles = resolve;
          });
        }
        return Promise.resolve({
          ok: true as const,
          value: createFiles(
            request.target,
            request.stashRef
          )
        });
      }
    );
    installBridge({ getStashes, getStashFiles });

    await act(async () => {
      root.render(
        <Harness
          scopeKey="workspace-files-stale:a"
          target={TARGET_A}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });

    let oldLoad: Promise<void> | undefined;
    await act(async () => {
      oldLoad = controller?.load();
      await flushAsyncWork();
    });

    await act(async () => {
      root.render(
        <Harness
          scopeKey="workspace-files-stale:b"
          target={TARGET_B}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });
    await act(async () => {
      await controller?.load();
      await flushAsyncWork();
    });

    await act(async () => {
      resolveTargetAFiles({
        ok: true,
        value: createFiles(TARGET_A, "stash@{0}")
      });
      await oldLoad;
      await flushAsyncWork();
    });

    expect(controller?.stashes?.target).toEqual(TARGET_B);
    expect(controller?.stashFiles?.target).toEqual(TARGET_B);
  });

  it("does not display files when a stash ref resolves to a different object", async () => {
    const getStashes = vi.fn(async () => ({
      ok: true as const,
      value: createStashes(TARGET_A, ["stash@{0}"])
    }));
    const getStashFiles = vi.fn(async () => ({
      ok: true as const,
      value: createFiles(
        TARGET_A,
        "stash@{0}",
        "9".repeat(40)
      )
    }));
    installBridge({ getStashes, getStashFiles });

    await act(async () => {
      root.render(
        <Harness
          scopeKey="workspace-mismatched-stash"
          target={TARGET_A}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });
    await act(async () => {
      await controller?.load();
      await flushAsyncWork();
    });

    expect(controller?.stashFiles).toBeNull();
    expect(controller?.error?.message).toContain(
      "储藏列表已在外部发生变化"
    );
  });

  it("forwards the full stash identity, reloads the list, refreshes changes, and selects the next stash after drop", async () => {
    const firstList = createStashes(TARGET_A, [
      "stash@{0}",
      "stash@{1}"
    ]);
    const retainedStash = firstList.stashes[1]!;
    const secondList: RepositoryStashesDto = {
      target: TARGET_A,
      stashes: [
        {
          ...retainedStash,
          ref: "stash@{0}"
        }
      ]
    };
    const getStashes = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: firstList
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: secondList
      });
    const getStashFiles = vi.fn(
      async (
        request: Parameters<
          GitNestBridge["repository"]["getStashFiles"]
        >[0]
      ) => {
        const list =
          getStashes.mock.calls.length > 1
            ? secondList
            : firstList;
        const hash =
          list.stashes.find(
            (stash) => stash.ref === request.stashRef
          )?.hash ?? "";
        return {
          ok: true as const,
          value: createFiles(
            request.target,
            request.stashRef,
            hash
          )
        };
      }
    );
    const mutateStash = vi.fn(async () => ({
      ok: true as const,
      value: {
        target: TARGET_A,
        operationId: "operation-stash-drop",
        action: "drop" as const,
        stashRef: firstList.stashes[0]!.ref,
        stashHash: firstList.stashes[0]!.hash
      }
    }));
    const afterMutation = vi.fn(async () => undefined);
    installBridge({
      getStashes,
      getStashFiles,
      mutateStash
    });

    await act(async () => {
      root.render(
        <Harness
          afterMutation={afterMutation}
          scopeKey="workspace-mutate-success"
          target={TARGET_A}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });
    await act(async () => {
      await controller?.load();
      await flushAsyncWork();
    });

    const removedStash = controller?.stashes?.stashes[0];
    expect(removedStash).toBeDefined();

    let succeeded = false;
    await act(async () => {
      succeeded =
        (await controller?.mutateStash(
          "drop",
          removedStash!
        )) ?? false;
      await flushAsyncWork();
    });

    expect(succeeded).toBe(true);
    expect(mutateStash).toHaveBeenCalledWith({
      target: TARGET_A,
      action: "drop",
      stashRef: removedStash?.ref,
      stashHash: removedStash?.hash
    });
    expect(getStashes).toHaveBeenCalledTimes(2);
    expect(afterMutation).toHaveBeenCalledTimes(1);
    expect(controller?.selectedStashRef).toBe("stash@{0}");
    expect(controller?.stashFiles?.stash.hash).toBe(
      retainedStash.hash
    );
    expect(controller?.notice).toContain("已删除");
    expect(controller?.mutationError).toBeNull();
    expect(controller?.active).toBeNull();
  });

  it("refreshes changes after a failed pop, keeps the list, and explains conflict safety", async () => {
    const list = createStashes(TARGET_A, ["stash@{0}"]);
    const getStashes = vi.fn(async () => ({
      ok: true as const,
      value: list
    }));
    const getStashFiles = vi.fn(
      async (
        request: Parameters<
          GitNestBridge["repository"]["getStashFiles"]
        >[0]
      ) => ({
        ok: true as const,
        value: createFiles(
          request.target,
          request.stashRef,
          list.stashes[0]!.hash
        )
      })
    );
    const mutateStash = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false as const,
        error: {
          code: "COMMAND_FAILED" as const,
          message: "Git stash pop failed.",
          details: {
            stderr: "CONFLICT (content): Merge conflict"
          }
        }
      })
      .mockResolvedValueOnce({
        ok: false as const,
        error: {
          code: "INVALID_REQUEST" as const,
          message:
            "The selected stash changed before the operation could run. Refresh the stash list and try again.",
          details: {
            expectedHash: "1".repeat(40),
            currentHash: "2".repeat(40)
          }
        }
      });
    const afterMutation = vi.fn(async () => undefined);
    installBridge({
      getStashes,
      getStashFiles,
      mutateStash
    });

    await act(async () => {
      root.render(
        <Harness
          afterMutation={afterMutation}
          scopeKey="workspace-mutate-failure"
          target={TARGET_A}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });
    await act(async () => {
      await controller?.load();
      await flushAsyncWork();
    });

    const stash = controller?.stashes?.stashes[0];
    let succeeded = true;
    await act(async () => {
      succeeded =
        (await controller?.mutateStash("pop", stash!)) ??
        false;
      await flushAsyncWork();
    });

    expect(succeeded).toBe(false);
    expect(afterMutation).toHaveBeenCalledTimes(1);
    expect(getStashes).toHaveBeenCalledTimes(1);
    expect(controller?.stashes).toEqual(list);
    expect(controller?.selectedStashRef).toBe("stash@{0}");
    expect(controller?.mutationError?.message).toContain(
      "工作区可能已产生变更或冲突"
    );
    expect(controller?.mutationError?.message).toContain(
      "储藏记录仍保留"
    );
    expect(controller?.notice).toBeNull();

    await act(async () => {
      await controller?.mutateStash("apply", stash!);
      await flushAsyncWork();
    });
    expect(afterMutation).toHaveBeenCalledTimes(2);
    expect(getStashes).toHaveBeenCalledTimes(1);
    expect(controller?.mutationError?.message).toContain(
      "储藏列表已变化，请重新读取后再试"
    );
    expect(controller?.mutationError?.message).toContain(
      "已重新读取工作区状态"
    );
  });

  it("ignores a late stash mutation result after the target changes", async () => {
    let resolveMutation!: (
      result: Awaited<
        ReturnType<
          GitNestBridge["repository"]["mutateStash"]
        >
      >
    ) => void;
    const getStashes = vi.fn(
      async (
        request: Parameters<
          GitNestBridge["repository"]["getStashes"]
        >[0]
      ) => ({
        ok: true as const,
        value: createStashes(request.target, ["stash@{0}"])
      })
    );
    const getStashFiles = vi.fn(
      async (
        request: Parameters<
          GitNestBridge["repository"]["getStashFiles"]
        >[0]
      ) => ({
        ok: true as const,
        value: createFiles(request.target, request.stashRef)
      })
    );
    const mutateStash = vi.fn(
      () =>
        new Promise<
          Awaited<
            ReturnType<
              GitNestBridge["repository"]["mutateStash"]
            >
          >
        >((resolve) => {
          resolveMutation = resolve;
        })
    );
    const afterMutation = vi.fn(async () => undefined);
    installBridge({
      getStashes,
      getStashFiles,
      mutateStash
    });

    await act(async () => {
      root.render(
        <Harness
          afterMutation={afterMutation}
          scopeKey="workspace-mutation-stale:a"
          target={TARGET_A}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });
    await act(async () => {
      await controller?.load();
      await flushAsyncWork();
    });

    const oldStash = controller?.stashes?.stashes[0];
    let oldMutation: Promise<boolean> | undefined;
    await act(async () => {
      oldMutation = controller?.mutateStash(
        "apply",
        oldStash!
      );
      await flushAsyncWork();
    });
    expect(controller?.active).toBe("apply");

    await act(async () => {
      root.render(
        <Harness
          afterMutation={afterMutation}
          scopeKey="workspace-mutation-stale:b"
          target={TARGET_B}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });
    expect(controller?.active).toBeNull();

    await act(async () => {
      resolveMutation({
        ok: true,
        value: {
          target: TARGET_A,
          operationId: "operation-stale",
          action: "apply",
          stashRef: oldStash!.ref,
          stashHash: oldStash!.hash
        }
      });
      await oldMutation;
      await flushAsyncWork();
    });

    expect(controller?.notice).toBeNull();
    expect(controller?.mutationError).toBeNull();
    expect(controller?.active).toBeNull();
    expect(afterMutation).not.toHaveBeenCalled();
  });
});

function Harness({
  afterMutation,
  scopeKey,
  target,
  onController
}: {
  afterMutation?: () => Promise<void>;
  scopeKey: string;
  target: RepositoryTargetDto;
  onController(value: RepositoryStashesController): void;
}) {
  onController(
    useRepositoryStashes(
      target,
      scopeKey,
      afterMutation ? { afterMutation } : undefined
    )
  );
  return null;
}

function installBridge(
  repository: Partial<GitNestBridge["repository"]>
): void {
  Object.defineProperty(window, "gitnest", {
    configurable: true,
    value: {
      repository: {
        cancelQuery: vi.fn(async () => ({
          ok: true as const,
          value: undefined
        })),
        ...repository
      }
    } as unknown as GitNestBridge
  });
}

function createStashes(
  target: RepositoryTargetDto,
  refs: string[]
): RepositoryStashesDto {
  return {
    target,
    stashes: refs.map((ref, index) =>
      createStash(ref, `${index + 1}`.repeat(40), index + 1)
    )
  };
}

function createFiles(
  target: RepositoryTargetDto,
  stashRef: string,
  requestedHash?: string
): RepositoryStashFilesDto {
  const stashIndex = Number.parseInt(
    stashRef.match(/\{(\d+)\}/)?.[1] ?? "0",
    10
  );
  return {
    target,
    stash: {
      ref: stashRef,
      hash:
        requestedHash ?? `${stashIndex + 1}`.repeat(40),
      files: [
        {
          path: `${stashRef.replaceAll(/[{}@]/g, "")}.ts`,
          additions: 1,
          deletions: 0,
          binary: false
        }
      ],
      additions: 1,
      deletions: 0
    }
  };
}

function createStash(
  ref: string,
  hash: string,
  index: number
): RepositoryStashesDto["stashes"][number] {
  return {
    ref,
    hash,
    subject: `Stash ${index}`,
    authorName: "June",
    authorEmail: "june@example.com",
    authoredAt: "2026-09-16T08:00:00.000Z",
    parentHashes: ["a".repeat(40)],
    baseHash: "a".repeat(40),
    files: 1,
    additions: index,
    deletions: 0
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
