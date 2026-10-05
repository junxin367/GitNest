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
  WorkspaceDetailsDto
} from "@gitnest/contracts";

import type { RepositoryChangeLocation } from "../../entities/repository/changeSelection";
import { GlobalSearchDialog } from "./GlobalSearchDialog";

describe("GlobalSearchDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true, value: scrollIntoView
    });
    vi.stubGlobal("React", React);
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
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  });

  it("keeps the keyboard-selected result visible without moving focus from the query", () => {
    renderDialog({ changes: [] });
    const input = document.querySelector<HTMLInputElement>("#global-search-input")!;
    scrollIntoView.mockClear();
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowUp", bubbles: true, cancelable: true
    })));
    const selected = document.querySelector('.global-search-result[aria-selected="true"]');
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(selected);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest", inline: "nearest" });
    expect(document.activeElement).toBe(input);
  });

  it("closes from a backdrop click but keeps search input and dialog content clicks inside", () => {
    const onClose = vi.fn();
    renderDialog({ changes: [], onClose });
    act(() => {
      document.querySelector<HTMLElement>("#global-search-dialog")?.click();
      document.querySelector<HTMLElement>("#global-search-input")?.click();
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => document.querySelector<HTMLElement>(".global-search-backdrop")?.click());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([true, false])("keeps the search query when a pointer gesture crosses its boundary (starts inside: %s)", (startsInside) => {
    const onClose = vi.fn();
    renderDialog({ changes: [], onClose });
    const input = document.querySelector<HTMLInputElement>("#global-search-input")!;
    const backdrop = document.querySelector<HTMLElement>(".global-search-backdrop")!;
    act(() => {
      setInputValue(input, "repository");
      (startsInside ? input : backdrop).dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      (startsInside ? backdrop : input).dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
      backdrop.click();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(input.value).toBe("repository");
    act(() => {
      backdrop.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      backdrop.click();
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps a preserved selection visible when late file results move it down the list", () => {
    renderDialog({ changes: [] });
    const input = document.querySelector<HTMLInputElement>("#global-search-input")!;
    act(() => setInputValue(input, "repository-a"));
    scrollIntoView.mockClear();
    renderDialog({ changes: [CHANGES] });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(findRepositoryResult());
    expect(document.activeElement).toBe(input);
  });

  it("searches changed files and opens the exact repository, path, and mode", () => {
    const onOpenChange = vi.fn();
    renderDialog({
      changes: [CHANGES],
      onOpenChange
    });

    const input = document.querySelector<HTMLInputElement>(
      "#global-search-input"
    );
    expect(input?.placeholder).toContain("变更文件");

    act(() => setInputValue(input, "src/changed.ts"));

    expect(document.body.textContent).toContain("变更文件");
    const results = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".global-search-result"
      )
    );
    expect(results).toHaveLength(2);
    expect(
      results.map((result) => result.textContent)
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("已暂存"),
        expect.stringContaining("未暂存")
      ])
    );

    const unstaged = results.find((result) =>
      result.textContent?.includes("未暂存")
    );
    act(() => unstaged?.click());

    expect(onOpenChange).toHaveBeenCalledWith({
      target: TARGET,
      path: "src/changed.ts",
      mode: "unstaged"
    });
  });

  it("matches changed paths entered with Windows separators", () => {
    renderDialog({ changes: [CHANGES] });
    const input = document.querySelector<HTMLInputElement>(
      "#global-search-input"
    );

    act(() => setInputValue(input, "src\\changed.ts"));

    const results = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".global-search-result"
      )
    );
    expect(results).toHaveLength(2);
    expect(
      results.every((result) =>
        result.textContent?.includes("src/changed.ts")
      )
    ).toBe(true);
  });

  it.each([
    { key: "Enter", isComposing: true },
    { key: "Escape", isComposing: true },
    { key: "ArrowDown", isComposing: true },
    { key: "Enter", keyCode: 229 }
  ])("leaves IME candidate keys to the input method (%j)", (keyEvent) => {
    const onOpenChange = vi.fn();
    const onClose = vi.fn();
    renderDialog({ changes: [CHANGES], onOpenChange, onClose });
    const input = document.querySelector<HTMLInputElement>(
      "#global-search-input"
    )!;
    act(() => setInputValue(input, "src/changed.ts"));
    const selected = input.getAttribute("aria-activedescendant");
    const composingKey = new KeyboardEvent("keydown", {
      ...keyEvent,
      bubbles: true,
      cancelable: true
    });

    act(() => input.dispatchEvent(composingKey));

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-activedescendant")).toBe(selected);
    expect(composingKey.defaultPrevented).toBe(false);

    act(() => input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", bubbles: true, cancelable: true
    })));
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the selected repository stable when file results arrive", () => {
    renderDialog({ changes: [] });
    const input = document.querySelector<HTMLInputElement>(
      "#global-search-input"
    );

    act(() => setInputValue(input, "repository-a"));
    const selectedBefore = findRepositoryResult();
    expect(selectedBefore?.getAttribute("aria-selected")).toBe(
      "true"
    );

    renderDialog({ changes: [CHANGES] });

    expect(
      document.querySelector(".global-search-group-label")
        ?.textContent
    ).toBe("变更文件");
    expect(
      findRepositoryResult()?.getAttribute("aria-selected")
    ).toBe("true");
  });

  it("reports partial indexing failures when no result matches", () => {
    renderDialog({
      changes: [],
      failedChangeTargetCount: 2
    });
    const input = document.querySelector<HTMLInputElement>(
      "#global-search-input"
    );

    act(() => setInputValue(input, "not-found"));

    expect(document.body.textContent).toContain(
      "2 个仓库的变更文件未能读取"
    );
  });

  it("shows a layout skeleton while matching changed files are still loading", () => {
    renderDialog({
      changes: [],
      changesLoading: true
    });
    const input = document.querySelector<HTMLInputElement>(
      "#global-search-input"
    );

    act(() => setInputValue(input, "src/pending.ts"));

    const skeleton = document.querySelector(
      '.global-search-results-skeleton[aria-label="正在读取有变更仓库的文件"]'
    );
    expect(skeleton).not.toBeNull();
    expect(
      skeleton?.querySelectorAll(
        ".global-search-result-skeleton"
      )
    ).toHaveLength(4);
    expect(document.body.textContent).not.toContain(
      "当前 Workspace 暂无可搜索内容"
    );
  });

  it("keeps a completed empty search visible while its index refreshes", () => {
    renderDialog({ changes: [], changesLoading: true, changesLoaded: true });
    act(() => setInputValue(
      document.querySelector<HTMLInputElement>("#global-search-input"),
      "src/missing.ts"
    ));
    expect(document.querySelector(".global-search-results-skeleton")).toBeNull();
    expect(document.body.textContent).toContain("没有匹配的仓库、变更文件或命令");
    expect(document.body.textContent).toContain("正在继续读取其他有变更仓库");
  });

  it("stops normalizing changed-file candidates after filling the visible result limit", () => {
    let laterCandidateReads = 0;
    const manyChanges: RepositoryChangesDto = {
      ...CHANGES,
      snapshot: {
        ...CHANGES.snapshot,
        staged: 0,
        unstaged: 0,
        untracked: 200,
        changes: Array.from({ length: 200 }, (_, index) => {
          const path = `src/file-${String(index).padStart(3, "0")}.ts`;
          return {
            path:
              index < 20
                ? path
                : ({
                    localeCompare(value: unknown) {
                      return path.localeCompare(
                        String(value),
                        "zh-CN"
                      );
                    },
                    toString() {
                      laterCandidateReads += 1;
                      return path;
                    }
                  } as unknown as string),
            indexStatus: ".",
            worktreeStatus: "?",
            kind: "untracked" as const
          };
        })
      }
    };
    renderDialog({ changes: [manyChanges] });
    laterCandidateReads = 0;
    const input = document.querySelector<HTMLInputElement>(
      "#global-search-input"
    );

    act(() => setInputValue(input, "src/file-"));

    expect(
      document.querySelectorAll(".global-search-result")
    ).toHaveLength(20);
    expect(laterCandidateReads).toBe(0);
  });

  function renderDialog({
    changes,
    changesLoading = false,
    changesLoaded = false,
    failedChangeTargetCount = 0,
    onOpenChange = () => undefined,
    onClose = vi.fn()
  }: {
    changes: RepositoryChangesDto[];
    changesLoading?: boolean;
    changesLoaded?: boolean;
    failedChangeTargetCount?: number;
    onOpenChange?: (
      location: RepositoryChangeLocation
    ) => void;
    onClose?: () => void;
  }) {
    act(() => {
      root.render(
        <GlobalSearchDialog
          changes={changes}
          changesLoading={changesLoading}
          changesLoaded={changesLoaded}
          failedChangeTargetCount={failedChangeTargetCount}
          snapshots={[SNAPSHOT]}
          workspace={WORKSPACE}
          onClose={onClose}
          onFetchAll={vi.fn()}
          onNavigate={vi.fn()}
          onOpenChange={onOpenChange}
          onOpenTarget={vi.fn()}
          onRefresh={vi.fn()}
          onToggleTheme={vi.fn()}
        />
      );
    });
  }
});

const TARGET = {
  repositoryId: "repository-a",
  worktreeId: "worktree-a"
} as const;

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
      targets: [TARGET]
    }
  ],
  scanIssues: [],
  lastScannedAt: "2026-09-16T12:00:00.000Z",
  repositories: [
    {
      id: TARGET.repositoryId,
      name: "repository-a",
      commonDir: "C:\\workspace\\repository-a\\.git",
      canonicalCommonDir:
        "c:\\workspace\\repository-a\\.git",
      primaryWorktreeId: TARGET.worktreeId,
      worktreeIds: [TARGET.worktreeId]
    }
  ],
  worktrees: [
    {
      id: TARGET.worktreeId,
      repositoryId: TARGET.repositoryId,
      name: "repository-a",
      path: "C:\\workspace\\repository-a",
      canonicalPath: "c:\\workspace\\repository-a",
      head: "a".repeat(40),
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

const SNAPSHOT: RepositoryStatusSnapshotDto = {
  ...TARGET,
  branch: "main",
  head: "a".repeat(40),
  ahead: 0,
  behind: 0,
  staged: 1,
  unstaged: 1,
  untracked: 0,
  conflicted: 0,
  refreshPending: false,
  stale: false,
  refreshedAt: "2026-09-16T12:00:00.000Z"
};

const CHANGES: RepositoryChangesDto = {
  target: TARGET,
  snapshot: {
    branch: "main",
    head: "a".repeat(40),
    ahead: 0,
    behind: 0,
    staged: 1,
    unstaged: 1,
    untracked: 0,
    conflicted: 0,
    refreshedAt: "2026-09-16T12:00:00.000Z",
    changes: [
      {
        path: "src/changed.ts",
        originalPath: "src/old-name.ts",
        indexStatus: "M",
        worktreeStatus: "M",
        kind: "ordinary",
        stagedStats: {
          additions: 2,
          deletions: 1
        },
        unstagedStats: {
          additions: 3,
          deletions: 2
        }
      }
    ]
  }
};

function findRepositoryResult() {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      ".global-search-result"
    )
  ).find(
    (result) =>
      result.querySelector("strong")?.textContent ===
      "repository-a"
  );
}

function setInputValue(
  input: HTMLInputElement | null,
  value: string
) {
  if (!input) {
    throw new Error("Global search input was not rendered.");
  }
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(
    new Event("input", {
      bubbles: true
    })
  );
}
