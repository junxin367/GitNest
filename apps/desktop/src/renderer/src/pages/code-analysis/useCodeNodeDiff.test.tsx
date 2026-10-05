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
  CodeGraphNodeDto,
  GitNestBridge,
  RepositoryChangesDto,
  RepositoryDiffDto
} from "@gitnest/contracts";

import {
  useCodeNodeDiff,
  type CodeNodeDiffState
} from "./useCodeNodeDiff";
import {
  useCodeNodeSource,
  type CodeNodeSourceState
} from "./useCodeNodeSource";

const TARGET = {
  repositoryId: "repository-a",
  worktreeId: "worktree-a"
} as const;

describe("useCodeNodeDiff", () => {
  let container: HTMLDivElement;
  let root: Root;
  let state: CodeNodeDiffState | undefined;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    state = undefined;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("reports the initial file read as loading on the first render", async () => {
    installBridge({
      getChanges: vi.fn<GitNestBridge["repository"]["getChanges"]>(() => new Promise(() => {})),
      getDiff: vi.fn()
    });
    const observed: CodeNodeDiffState[] = [];
    await act(async () => {
      root.render(
        <Harness node={createNode("src/pending.ts", "pending")}
          onState={(value) => observed.push(value)} />
      );
      await flushAsyncWork();
    });
    expect(observed[0]).toMatchObject({ loading: true, documents: [], error: null });
  });

  it("never publishes the previous file diff during a file switch or deselection", async () => {
    installBridge({
      getChanges: vi.fn<GitNestBridge["repository"]["getChanges"]>()
        .mockResolvedValueOnce({
          ok: true,
          value: createChanges([{
            path: "src/first.ts", indexStatus: ".", worktreeStatus: "M", kind: "ordinary"
          }])
        })
        .mockImplementationOnce(() => new Promise(() => {})),
      getDiff: vi.fn(async () => ({
        ok: true as const, value: createDiff("src/first.ts", "unstaged", "first content")
      }))
    });
    await renderNode(createNode("src/first.ts", "first"));
    const switched: CodeNodeDiffState[] = [];
    await act(async () => {
      root.render(<Harness node={createNode("src/second.ts", "second")}
        onState={(value) => switched.push(value)} />);
      await flushAsyncWork();
    });
    expect(switched.every((value) => value.documents.length === 0)).toBe(true);
    expect(switched[0]?.loading).toBe(true);
    const deselected: CodeNodeDiffState[] = [];
    await act(async () => {
      root.render(<Harness node={null} onState={(value) => deselected.push(value)} />);
    });
    expect(deselected[0]).toEqual({ documents: [], loading: false, error: null });
  });

  it("loads every current diff mode even when the analysis node is not marked changed", async () => {
    const change = {
      path: "src/mixed.ts",
      indexStatus: "M",
      worktreeStatus: "M",
      kind: "ordinary"
    } as const;
    const getChanges = vi.fn(async () => ({
      ok: true as const,
      value: createChanges([change])
    }));
    const getDiff = vi.fn(
      async (
        request: Parameters<
          GitNestBridge["repository"]["getDiff"]
        >[0]
      ) => ({
        ok: true as const,
        value: createDiff(
          request.path,
          request.mode,
          `${request.mode} content`
        )
      })
    );
    installBridge({ getChanges, getDiff });

    await renderNode(createNode(change.path, "first", false));

    expect(getChanges).toHaveBeenCalledOnce();
    expect(getDiff).toHaveBeenCalledTimes(2);
    expect(
      getDiff.mock.calls.map(([request]) => ({
        path: request.path,
        mode: request.mode
      }))
    ).toEqual([
      {
        path: change.path,
        mode: "staged"
      },
      {
        path: change.path,
        mode: "unstaged"
      }
    ]);
    expect(state).toMatchObject({
      loading: false,
      error: null,
      documents: [
        {
          mode: "staged",
          diff: {
            content: "staged content"
          }
        },
        {
          mode: "unstaged",
          diff: {
            content: "unstaged content"
          }
        }
      ]
    });
  });

  it("matches a renamed node by originalPath and requests the current path", async () => {
    const change = {
      path: "src/new-name.ts",
      originalPath: "src/old-name.ts",
      indexStatus: ".",
      worktreeStatus: "R",
      kind: "renamed"
    } as const;
    const getChanges = vi.fn(async () => ({
      ok: true as const,
      value: createChanges([change])
    }));
    const getDiff = vi.fn(
      async (
        request: Parameters<
          GitNestBridge["repository"]["getDiff"]
        >[0]
      ) => ({
        ok: true as const,
        value: createDiff(
          request.path,
          request.mode,
          "renamed content"
        )
      })
    );
    installBridge({ getChanges, getDiff });

    await renderNode(
      createNode(change.originalPath, "renamed")
    );

    expect(getDiff).toHaveBeenCalledWith(
      expect.objectContaining({
        path: change.path,
        mode: "unstaged"
      })
    );
    expect(state?.documents[0]?.diff.path).toBe(change.path);
  });

  it("loads an untracked file with untracked diff mode", async () => {
    const change = {
      path: "src/new-file.ts",
      indexStatus: "?",
      worktreeStatus: "?",
      kind: "untracked"
    } as const;
    const getChanges = vi.fn(async () => ({
      ok: true as const,
      value: createChanges([change])
    }));
    const getDiff = vi.fn(
      async (
        request: Parameters<
          GitNestBridge["repository"]["getDiff"]
        >[0]
      ) => ({
        ok: true as const,
        value: createDiff(
          request.path,
          request.mode,
          "new file content"
        )
      })
    );
    installBridge({ getChanges, getDiff });

    await renderNode(createNode(change.path, "untracked"));

    expect(getDiff).toHaveBeenCalledOnce();
    expect(getDiff).toHaveBeenCalledWith(
      expect.objectContaining({
        path: change.path,
        mode: "untracked"
      })
    );
    expect(state?.documents[0]?.mode).toBe("untracked");
  });

  it("does not reload when selecting another node in the same file", async () => {
    const change = {
      path: "src/shared.ts",
      indexStatus: ".",
      worktreeStatus: "M",
      kind: "ordinary"
    } as const;
    const getChanges = vi.fn(async () => ({
      ok: true as const,
      value: createChanges([change])
    }));
    const getDiff = vi.fn(async () => ({
      ok: true as const,
      value: createDiff(
        change.path,
        "unstaged",
        "shared content"
      )
    }));
    installBridge({ getChanges, getDiff });

    await renderNode(createNode(change.path, "first"));
    getChanges.mockClear();
    getDiff.mockClear();

    await renderNode(createNode(change.path, "second"));

    expect(getChanges).not.toHaveBeenCalled();
    expect(getDiff).not.toHaveBeenCalled();
    expect(state?.documents[0]?.diff.content).toBe(
      "shared content"
    );
  });

  it("cancels old queries and ignores their results after switching files", async () => {
    const firstPath = "src/first.ts";
    const secondPath = "src/second.ts";
    let resolveFirstDiff!: (
      result: Awaited<
        ReturnType<GitNestBridge["repository"]["getDiff"]>
      >
    ) => void;
    const getChanges = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: createChanges([
          {
            path: firstPath,
            indexStatus: ".",
            worktreeStatus: "M",
            kind: "ordinary"
          }
        ])
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: createChanges([
          {
            path: secondPath,
            indexStatus: ".",
            worktreeStatus: "M",
            kind: "ordinary"
          }
        ])
      });
    const getDiff = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstDiff = resolve;
          })
      )
      .mockImplementationOnce(
        async (
          request: Parameters<
            GitNestBridge["repository"]["getDiff"]
          >[0]
        ) => ({
          ok: true as const,
          value: createDiff(
            request.path,
            request.mode,
            "second content"
          )
        })
      );
    const cancelQuery = vi.fn(async () => ({
      ok: true as const,
      value: undefined
    }));
    installBridge({
      getChanges,
      getDiff,
      cancelQuery
    });

    await act(async () => {
      root.render(
        <Harness
          node={createNode(firstPath, "first")}
          onState={(value) => {
            state = value;
          }}
        />
      );
      await flushAsyncWork();
    });
    const firstDiffQueryId =
      getDiff.mock.calls[0]?.[0].queryId;
    expect(firstDiffQueryId).toBeTruthy();

    await renderNode(createNode(secondPath, "second"));

    expect(cancelQuery).toHaveBeenCalledWith({
      queryId: firstDiffQueryId
    });
    expect(state?.documents[0]?.diff).toMatchObject({
      path: secondPath,
      content: "second content"
    });

    await act(async () => {
      resolveFirstDiff({
        ok: true,
        value: createDiff(
          firstPath,
          "unstaged",
          "stale first content"
        )
      });
      await flushAsyncWork();
    });

    expect(state?.documents[0]?.diff).toMatchObject({
      path: secondPath,
      content: "second content"
    });
  });

  it("returns an empty document list when the file has no current changes", async () => {
    const getChanges = vi.fn(async () => ({
      ok: true as const,
      value: createChanges([])
    }));
    const getDiff = vi.fn();
    installBridge({ getChanges, getDiff });

    await renderNode(createNode("src/clean.ts", "clean"));

    expect(getDiff).not.toHaveBeenCalled();
    expect(state).toEqual({
      documents: [],
      loading: false,
      error: null
    });
  });

  async function renderNode(
    node: CodeGraphNodeDto | null
  ): Promise<void> {
    await act(async () => {
      root.render(
        <Harness
          node={node}
          onState={(value) => {
            state = value;
          }}
        />
      );
      await flushAsyncWork();
      await flushAsyncWork();
    });
  }
});

describe("useCodeNodeSource request scope", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("reports the source read as loading from the first render", async () => {
    Object.defineProperty(window, "gitnest", {
      configurable: true,
      value: { codeAnalysis: { readFile: vi.fn(() => new Promise(() => {})) } }
    });
    const observed: CodeNodeSourceState[] = [];
    await act(async () => {
      root.render(<SourceHarness node={createNode("src/first.ts", "first")}
        onState={(value) => observed.push(value)} />);
      await flushAsyncWork();
    });
    expect(observed[0]).toEqual({ file: null, loading: true, error: null });
  });

  it("hides source from a previous node immediately and ignores a late response", async () => {
    let resolveSecond!: (value: Awaited<ReturnType<GitNestBridge["codeAnalysis"]["readFile"]>>) => void;
    const file = {
      nodeId: "first", path: "src/first.ts", language: "typescript" as const,
      content: "first content", startLine: 1, endLine: 1, totalLines: 1, truncated: false
    };
    const readFile = vi.fn<GitNestBridge["codeAnalysis"]["readFile"]>()
      .mockResolvedValueOnce({ ok: true, value: file })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }))
      .mockResolvedValueOnce({ ok: true, value: { ...file, nodeId: "third", path: "src/third.ts", content: "third content" } });
    Object.defineProperty(window, "gitnest", {
      configurable: true, value: { codeAnalysis: { readFile } }
    });
    await act(async () => {
      root.render(<SourceHarness node={createNode("src/first.ts", "first")} onState={() => {}} />);
      await flushAsyncWork();
    });
    const switched: CodeNodeSourceState[] = [];
    await act(async () => {
      root.render(<SourceHarness node={createNode("src/second.ts", "second")}
        onState={(value) => switched.push(value)} />);
      await flushAsyncWork();
    });
    expect(switched[0]).toEqual({ file: null, loading: true, error: null });
    let current: CodeNodeSourceState | undefined;
    await act(async () => {
      root.render(<SourceHarness node={createNode("src/third.ts", "third")}
        onState={(value) => { current = value; }} />);
      await flushAsyncWork();
      resolveSecond({ ok: true, value: { ...file, nodeId: "second", content: "late second content" } });
      await flushAsyncWork();
    });
    expect(current?.file?.content).toBe("third content");
  });

  it("reloads a reused node id when its Worktree changes", async () => {
    const node = createNode("src/shared.ts", "shared");
    const readFile = vi.fn<GitNestBridge["codeAnalysis"]["readFile"]>()
      .mockResolvedValueOnce({
        ok: true,
        value: { nodeId: "shared", path: node.location.path, language: "typescript",
          content: "old worktree", startLine: 1, endLine: 1, totalLines: 1, truncated: false }
      })
      .mockImplementationOnce(() => new Promise(() => {}));
    Object.defineProperty(window, "gitnest", {
      configurable: true, value: { codeAnalysis: { readFile } }
    });
    await act(async () => {
      root.render(<SourceHarness node={node} onState={() => {}} />);
      await flushAsyncWork();
    });
    const observed: CodeNodeSourceState[] = [];
    await act(async () => {
      root.render(<SourceHarness node={{ ...node, location: { ...node.location, worktreeId: "other-worktree" } }}
        onState={(value) => observed.push(value)} />);
      await flushAsyncWork();
    });
    expect(observed.every((value) => value.file === null)).toBe(true);
    expect(observed[0]?.loading).toBe(true);
    expect(readFile).toHaveBeenCalledTimes(2);
  });
});

function SourceHarness({ node, onState }: {
  node: CodeGraphNodeDto | null;
  onState(state: CodeNodeSourceState): void;
}) {
  onState(useCodeNodeSource(node));
  return null;
}

function Harness({
  node,
  onState
}: {
  node: CodeGraphNodeDto | null;
  onState(state: CodeNodeDiffState): void;
}) {
  onState(useCodeNodeDiff(node));
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

function createNode(
  path: string,
  id: string,
  changed = true
): CodeGraphNodeDto {
  return {
    id,
    kind: "function",
    name: id,
    qualifiedName: id,
    language: "typescript",
    location: {
      ...TARGET,
      path,
      line: id === "second" ? 20 : 10,
      column: 1
    },
    changed,
    source: "builtin",
    confidence: "probable",
    metadata: {}
  };
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
      staged: changes.filter(
        (change) =>
          change.kind !== "untracked" &&
          change.indexStatus !== "."
      ).length,
      unstaged: changes.filter(
        (change) =>
          change.kind !== "untracked" &&
          change.worktreeStatus !== "."
      ).length,
      untracked: changes.filter(
        (change) => change.kind === "untracked"
      ).length,
      conflicted: 0,
      changes,
      refreshedAt: "2026-09-17T00:00:00.000Z"
    }
  };
}

function createDiff(
  path: string,
  mode: RepositoryDiffDto["diff"]["mode"],
  content: string
): RepositoryDiffDto {
  return {
    target: TARGET,
    diff: {
      path,
      mode,
      content,
      binary: false,
      truncated: false,
      additions: 1,
      deletions: 0
    }
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
