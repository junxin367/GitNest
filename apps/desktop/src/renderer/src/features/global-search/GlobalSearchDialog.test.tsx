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
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
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

  function renderDialog({
    changes,
    failedChangeTargetCount = 0,
    onOpenChange = () => undefined
  }: {
    changes: RepositoryChangesDto[];
    failedChangeTargetCount?: number;
    onOpenChange?: (
      location: RepositoryChangeLocation
    ) => void;
  }) {
    act(() => {
      root.render(
        <GlobalSearchDialog
          changes={changes}
          changesLoading={false}
          failedChangeTargetCount={failedChangeTargetCount}
          snapshots={[SNAPSHOT]}
          workspace={WORKSPACE}
          onClose={vi.fn()}
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
          targets: [TARGET]
        }
      ],
      scanIssues: [],
      lastScannedAt: "2026-09-16T12:00:00.000Z"
    }
  ],
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
