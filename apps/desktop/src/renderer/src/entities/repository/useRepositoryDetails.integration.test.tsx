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
  BranchDto,
  CommitSummaryDto,
  GitNestBridge,
  RepositoryChangesDto,
  RepositoryCommitDto,
  RepositoryDiffDto,
  RepositoryHistoryPageDto,
  RepositoryTargetDto
} from "@gitnest/contracts";

import type { RepositoryTab } from "../../app/navigation";
import {
  useRepositoryDetails,
  type RepositoryDetailsController
} from "./useRepositoryDetails";

const TARGET: RepositoryTargetDto = {
  repositoryId: "repository-a",
  worktreeId: "worktree-a"
};
const CHANGE = {
  path: "MixedLineEndings.java",
  indexStatus: ".",
  worktreeStatus: "M",
  kind: "ordinary"
} as const;
const SECOND_CHANGE = {
  ...CHANGE,
  path: "RealContentChange.java"
} as const;

describe("useRepositoryDetails", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: RepositoryDetailsController | undefined;

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

  it("refreshes status once when an unstaged diff is empty", async () => {
    const getChanges = vi.fn(async () => ({
      ok: true as const,
      value: createChanges([CHANGE])
    }));
    const getDiff = vi.fn(async () => ({
      ok: true as const,
      value: createEmptyDiff()
    }));
    installBridge({ getChanges, getDiff });

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
    await act(flushAsyncWork);

    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(getDiff).toHaveBeenCalledTimes(2);
    expect(controller?.diff?.diff.content).toBe("");
    expect(controller?.diffNotice).toBe("metadata-only");
  });

  it("reports when the empty-diff change disappears after refresh", async () => {
    const getChanges = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: createChanges([CHANGE])
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: createChanges([])
      });
    const getDiff = vi.fn(async () => ({
      ok: true as const,
      value: createEmptyDiff()
    }));
    installBridge({ getChanges, getDiff });

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
    await act(flushAsyncWork);

    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(getDiff).toHaveBeenCalledTimes(1);
    expect(controller?.selectedChange).toBeNull();
    expect(controller?.diff).toBeNull();
    expect(controller?.diffNotice).toBe("change-removed");
  });

  it("keeps the current diff visible during a background status refresh", async () => {
    let resolveRefreshedDiff!: (
      result: Awaited<
        ReturnType<GitNestBridge["repository"]["getDiff"]>
      >
    ) => void;
    const getChanges = vi.fn(async () => ({
      ok: true as const,
      value: createChanges([CHANGE])
    }));
    const getDiff = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: createDiff("old diff")
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefreshedDiff = resolve;
          })
      );
    installBridge({ getChanges, getDiff });

    await act(async () => {
      root.render(
        <Harness
          revision="revision-1"
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });
    expect(controller?.diff?.diff.content).toBe("old diff");

    await act(async () => {
      root.render(
        <Harness
          revision="revision-2"
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });

    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(getDiff).toHaveBeenCalledTimes(2);
    expect(controller?.diff?.diff.content).toBe("old diff");

    await act(async () => {
      resolveRefreshedDiff({
        ok: true,
        value: createDiff("new diff")
      });
      await flushAsyncWork();
    });
    expect(controller?.diff?.diff.content).toBe("new diff");
  });

  it("does not let a background refresh restore a stale selection", async () => {
    let resolveBackgroundChanges!: (
      result: Awaited<
        ReturnType<GitNestBridge["repository"]["getChanges"]>
      >
    ) => void;
    const getChanges = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: createChanges([CHANGE, SECOND_CHANGE])
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveBackgroundChanges = resolve;
          })
      );
    const getDiff = vi.fn(
      async (
        request: Parameters<
          GitNestBridge["repository"]["getDiff"]
        >[0]
      ) => ({
        ok: true as const,
        value: createDiff(
          `${request.path} diff`,
          request.path
        )
      })
    );
    installBridge({ getChanges, getDiff });

    await act(async () => {
      root.render(
        <Harness
          revision="revision-1"
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });
    expect(controller?.selectedChange?.path).toBe(CHANGE.path);

    await act(async () => {
      root.render(
        <Harness
          revision="revision-2"
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await flushAsyncWork();
    });

    await act(async () => {
      await controller?.selectChange(SECOND_CHANGE);
    });
    expect(controller?.selectedChange?.path).toBe(
      SECOND_CHANGE.path
    );
    expect(controller?.diff?.diff.path).toBe(
      SECOND_CHANGE.path
    );

    await act(async () => {
      resolveBackgroundChanges({
        ok: true,
        value: createChanges([CHANGE, SECOND_CHANGE])
      });
      await flushAsyncWork();
    });

    expect(controller?.selectedChange?.path).toBe(
      SECOND_CHANGE.path
    );
    expect(controller?.diff?.diff.path).toBe(
      SECOND_CHANGE.path
    );
  });

  it("keeps an already loaded diff visible when the same file is selected again", async () => {
    let resolveRepeatedDiff!: (
      result: Awaited<
        ReturnType<GitNestBridge["repository"]["getDiff"]>
      >
    ) => void;
    const getChanges = vi.fn(async () => ({
      ok: true as const,
      value: createChanges([CHANGE])
    }));
    const getDiff = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: createDiff("loaded diff")
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRepeatedDiff = resolve;
          })
      );
    installBridge({ getChanges, getDiff });

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

    act(() => {
      void controller?.selectChange(CHANGE);
    });

    expect(controller?.diff?.diff.content).toBe("loaded diff");
    expect(controller?.loading.diff).toBe(false);

    await act(async () => {
      resolveRepeatedDiff({
        ok: true,
        value: createDiff("updated diff")
      });
      await flushAsyncWork();
    });
    expect(controller?.diff?.diff.content).toBe("updated diff");
  });

  it("keeps the loaded diff visible while expanding its context", async () => {
    let resolveExpandedDiff!: (
      result: Awaited<
        ReturnType<GitNestBridge["repository"]["getDiff"]>
      >
    ) => void;
    const getChanges = vi.fn(async () => ({
      ok: true as const,
      value: createChanges([CHANGE])
    }));
    const getDiff = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: createDiff("compact diff")
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveExpandedDiff = resolve;
          })
      );
    installBridge({ getChanges, getDiff });

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

    expect(getDiff).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contextLines: 3
      })
    );

    act(() => {
      void controller?.selectChange(CHANGE, "unstaged", {
        contextLines: 13,
        preserveDiff: true
      });
    });

    expect(getDiff).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contextLines: 13
      })
    );
    expect(controller?.selectedChange?.contextLines).toBe(13);
    expect(controller?.diff?.diff.content).toBe("compact diff");
    expect(controller?.loading.diff).toBe(true);

    await act(async () => {
      resolveExpandedDiff({
        ok: true,
        value: createDiff("expanded diff")
      });
      await flushAsyncWork();
    });

    expect(controller?.diff?.diff.content).toBe("expanded diff");
    expect(controller?.loading.diff).toBe(false);
  });

  it("keeps history details collapsed while loading the inspector commit", async () => {
    const summary = createCommitSummary();
    const getHistory = vi.fn(
      async (): Promise<{
        ok: true;
        value: RepositoryHistoryPageDto;
      }> => ({
        ok: true,
        value: {
          target: TARGET,
          page: {
            commits: [summary]
          }
        }
      })
    );
    const getCommit = vi.fn(
      async (): Promise<{
        ok: true;
        value: RepositoryCommitDto;
      }> => ({
        ok: true,
        value: {
          target: TARGET,
          commit: {
            ...summary,
            committerName: summary.authorName,
            committerEmail: summary.authorEmail,
            committedAt: summary.authoredAt,
            body: `${summary.subject}\n\nBody`,
            refs: ["HEAD -> main"],
            files: [],
            additions: 0,
            deletions: 0
          }
        }
      })
    );
    installBridge({ getHistory, getCommit });

    await act(async () => {
      root.render(
        <Harness
          onController={(value) => {
            controller = value;
          }}
          tab="history"
        />
      );
      await flushAsyncWork();
    });
    await act(flushAsyncWork);

    expect(controller?.historyDetailOpen).toBe(false);
    expect(controller?.commit?.commit.hash).toBe(summary.hash);

    await act(async () => {
      await controller?.selectCommit(summary.hash);
      await flushAsyncWork();
    });
    expect(controller?.historyDetailOpen).toBe(true);

    await act(async () => {
      await controller?.selectCommit(summary.hash);
      await flushAsyncWork();
    });
    expect(controller?.historyDetailOpen).toBe(false);
    expect(controller?.commit?.commit.hash).toBe(summary.hash);
  });

  it("loads branches and keeps the selected history scope across pagination", async () => {
    const mainCommit = createCommitSummary();
    const developCommit = {
      ...mainCommit,
      hash: "develop1234567890",
      shortHash: "develop",
      subject: "Develop commit",
      refs: ["develop"]
    };
    const getHistory = vi.fn(
      async (request: {
        offset?: number;
        scope?: {
          kind: string;
        };
      }): Promise<{
        ok: true;
        value: RepositoryHistoryPageDto;
      }> => ({
        ok: true,
        value: {
          target: TARGET,
          page: {
            commits:
              request.scope?.kind === "ref"
                ? [developCommit]
                : [mainCommit],
            ...(request.offset === 0
              ? { nextOffset: 50 }
              : {})
          }
        }
      })
    );
    const getBranches = vi.fn(async () => ({
      ok: true as const,
      value: {
        target: TARGET,
        branches: createBranches()
      }
    }));
    installBridge({ getHistory, getBranches });

    await act(async () => {
      root.render(
        <Harness
          onController={(value) => {
            controller = value;
          }}
          tab="history"
        />
      );
      await flushAsyncWork();
    });
    await act(flushAsyncWork);

    expect(getBranches).toHaveBeenCalledTimes(1);
    expect(controller?.historyScope).toBeNull();

    await act(async () => {
      await controller?.selectHistoryScope({
        kind: "ref",
        ref: "refs/heads/develop"
      });
      await flushAsyncWork();
    });

    expect(getHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({
        offset: 0,
        scope: {
          kind: "ref",
          ref: "refs/heads/develop"
        }
      })
    );
    expect(controller?.history?.page.commits[0]?.subject).toBe(
      "Develop commit"
    );

    await act(async () => {
      await controller?.loadMoreHistory();
      await flushAsyncWork();
    });

    expect(getHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({
        offset: 50,
        scope: {
          kind: "ref",
          ref: "refs/heads/develop"
        }
      })
    );
  });

  it("keeps branch comparison metadata on the loaded history page", async () => {
    const summary = createCommitSummary();
    const comparison = {
      leftRef: "refs/remotes/origin/pre-production",
      rightRef: "refs/heads/pre-production",
      leftOnly: 4,
      rightOnly: 3,
      mergeBase: "e3d9000123456789"
    };
    const getHistory = vi.fn(
      async (request: {
        scope?: {
          kind: string;
        };
      }): Promise<{
        ok: true;
        value: RepositoryHistoryPageDto;
      }> => ({
        ok: true,
        value: {
          target: TARGET,
          page: {
            commits: [
              {
                ...summary,
                ...(request.scope?.kind === "compare"
                  ? { comparisonSide: "left" as const }
                  : {})
              }
            ],
            ...(request.scope?.kind === "compare"
              ? { comparison }
              : {})
          }
        }
      })
    );
    installBridge({
      getHistory,
      getBranches: vi.fn(async () => ({
        ok: true as const,
        value: {
          target: TARGET,
          branches: createBranches()
        }
      }))
    });

    await act(async () => {
      root.render(
        <Harness
          onController={(value) => {
            controller = value;
          }}
          tab="history"
        />
      );
      await flushAsyncWork();
    });
    await act(flushAsyncWork);

    await act(async () => {
      await controller?.selectHistoryScope({
        kind: "compare",
        leftRef: comparison.leftRef,
        rightRef: comparison.rightRef
      });
      await flushAsyncWork();
    });

    expect(getHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: {
          kind: "compare",
          leftRef: comparison.leftRef,
          rightRef: comparison.rightRef
        }
      })
    );
    expect(controller?.history?.page.comparison).toEqual(
      comparison
    );
    expect(
      controller?.history?.page.commits[0]?.comparisonSide
    ).toBe("left");
  });
});

function Harness({
  revision = "",
  tab = "changes",
  onController
}: {
  revision?: string;
  tab?: RepositoryTab;
  onController(value: RepositoryDetailsController): void;
}) {
  onController(
    useRepositoryDetails(TARGET, tab, revision)
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

function createChanges(
  changes: RepositoryChangesDto["snapshot"]["changes"]
): RepositoryChangesDto {
  return {
    target: TARGET,
    snapshot: {
      branch: "main",
      head: "abcdef123456",
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: changes.length,
      untracked: 0,
      conflicted: 0,
      changes,
      refreshedAt: "2026-09-08T00:00:00.000Z"
    }
  };
}

function createCommitSummary(): CommitSummaryDto {
  return {
    hash: "abcdef1234567890",
    shortHash: "abcdef1",
    authorName: "June",
    authorEmail: "june@example.com",
    authoredAt: "2026-09-04T10:00:00+08:00",
    subject: "Initial commit",
    parentHashes: [],
    refs: ["HEAD -> main", "origin/main"]
  };
}

function createBranches(): BranchDto[] {
  return [
    {
      fullName: "refs/heads/main",
      name: "main",
      head: "abcdef1234567890",
      upstream: "origin/main",
      current: true,
      remote: false
    },
    {
      fullName: "refs/heads/develop",
      name: "develop",
      head: "develop1234567890",
      current: false,
      remote: false
    },
    {
      fullName: "refs/remotes/origin/main",
      name: "origin/main",
      head: "abcdef1234567890",
      current: false,
      remote: true
    }
  ];
}

function createEmptyDiff(): RepositoryDiffDto {
  return createDiff("");
}

function createDiff(
  content: string,
  path: string = CHANGE.path
): RepositoryDiffDto {
  return {
    target: TARGET,
    diff: {
      path,
      mode: "unstaged",
      content,
      binary: false,
      truncated: false,
      additions: 0,
      deletions: 0
    }
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
