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

import type { WorkspaceDetailsDto } from "@gitnest/contracts";

import type { WorktreeCommandController } from "../../features/worktree-command/useWorktreeCommands";
import { RepositoryWorktrees } from "./RepositoryWorktrees";

describe("RepositoryWorktrees summary card", () => {
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

  it("opens the directory from click, Enter, and Space on the whole card", () => {
    const onOpenDirectory = vi.fn();

    act(() => {
      root.render(
        <RepositoryWorktrees
          commands={commands}
          directoryOpening={false}
          onOpenDirectory={onOpenDirectory}
          repositoryId="repository"
          snapshots={[]}
          worktreeId="worktree"
          workspace={workspace}
        />
      );
    });

    const card = container.querySelector<HTMLElement>(
      ".worktree-summary-card"
    );

    expect(card?.getAttribute("role")).toBe("button");
    expect(card?.tabIndex).toBe(0);
    expect(
      card?.querySelector(".worktree-foot-action")?.textContent
    ).toContain("打开");
    expect(card?.querySelector("button")).toBeNull();

    act(() => card?.click());
    act(() => {
      card?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter"
        })
      );
    });
    act(() => {
      card?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: " "
        })
      );
    });

    expect(onOpenDirectory).toHaveBeenCalledTimes(3);
    expect(onOpenDirectory).toHaveBeenNthCalledWith(
      1,
      "worktree"
    );
  });

  it("blocks activation while the directory is opening", () => {
    const onOpenDirectory = vi.fn();

    act(() => {
      root.render(
        <RepositoryWorktrees
          commands={commands}
          directoryOpening
          onOpenDirectory={onOpenDirectory}
          repositoryId="repository"
          snapshots={[]}
          worktreeId="worktree"
          workspace={workspace}
        />
      );
    });

    const card = container.querySelector<HTMLElement>(
      ".worktree-summary-card"
    );

      expect(card?.getAttribute("aria-disabled")).toBe("true");
      act(() => card?.click());
      expect(onOpenDirectory).not.toHaveBeenCalled();
    });

  it("renders worktree status labels in Chinese", () => {
    act(() => {
      root.render(
        <RepositoryWorktrees
          commands={commands}
          directoryOpening={false}
          onOpenDirectory={vi.fn()}
          repositoryId="repository"
          snapshots={[]}
          worktreeId="worktree"
          workspace={workspace}
        />
      );
    });

    const labels = [
      ...container.querySelectorAll(".metric-card .metric-label span")
    ]
      .map((element) => element.textContent?.trim())
      .filter(Boolean);

    expect(labels).toEqual([
      "已登记",
      "目录存在",
      "可清理",
      "游离 HEAD"
    ]);
    expect(container.textContent).not.toContain("Detached");
  });

  it("filters the registered worktrees and reports the match count", () => {
    act(() => {
      root.render(
        <RepositoryWorktrees
          commands={commands}
          directoryOpening={false}
          onOpenDirectory={vi.fn()}
          repositoryId="repository"
          snapshots={[]}
          worktreeId="worktree"
          workspace={workspaceWithTwoWorktrees}
        />
      );
    });

    const filterButton = [
      ...container.querySelectorAll("button")
    ].find((button) => button.textContent?.trim() === "筛选");
    expect(filterButton).toBeTruthy();
    expect(container.querySelector(".worktree-filter-input")).toBeNull();

    act(() => filterButton?.click());
    const input = container.querySelector<HTMLInputElement>(
      ".worktree-filter-input"
    );
    expect(input).toBeTruthy();

    act(() => {
      if (!input) {
        return;
      }
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      setter?.call(input, "feature");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain("已筛出 1/2 个目录");
    expect(
      container.querySelectorAll(".worktree-management-card").length
    ).toBe(1);

    act(() => {
      if (!input) {
        return;
      }
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      setter?.call(input, "zzz-no-match");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.querySelector(".worktree-filter-empty")).toBeTruthy();
  });

  it("filters worktrees by status facet with counts", () => {
    act(() => {
      root.render(
        <RepositoryWorktrees
          commands={commands}
          directoryOpening={false}
          onOpenDirectory={vi.fn()}
          repositoryId="repository"
          snapshots={[]}
          worktreeId="worktree"
          workspace={workspaceWithTwoWorktrees}
        />
      );
    });

    const chips = [
      ...container.querySelectorAll(".worktree-filter-chip")
    ];
    expect(chips.map((chip) => chip.textContent?.trim())).toEqual([
      "主工作目录1",
      "已登记1",
      "游离 HEAD0",
      "已锁定0",
      "可清理登记0",
      "仅看有变更0"
    ]);

    const primaryChip = container.querySelector<HTMLButtonElement>(
      ".worktree-filter-chip[aria-pressed=\"false\"]"
    );
    expect(primaryChip?.textContent?.trim()).toBe("主工作目录1");

    act(() => primaryChip?.click());

    expect(primaryChip?.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("已筛出 1/2 个目录");
    expect(
      container.querySelectorAll(".worktree-management-card").length
    ).toBe(1);

    const clearButton = [
      ...container.querySelectorAll("button")
    ].find((button) => button.textContent?.includes("清除筛选"));
    expect(clearButton?.textContent?.trim()).toBe("清除筛选（1）");
    act(() => clearButton?.click());
    expect(container.textContent).not.toContain("已筛出");
    expect(
      container.querySelectorAll(".worktree-management-card").length
    ).toBe(2);
  });
});

const commands: WorktreeCommandController = {
  active: null,
  busy: false,
  preflight: null,
  error: null,
  notice: null,
  completionVersion: 0,
  request: vi.fn(async () => false),
  confirm: vi.fn(async () => false),
  dismissPreflight: vi.fn(),
  chooseDirectory: vi.fn(async () => null),
  cancelOperation: vi.fn(async () => false),
  clearFeedback: vi.fn()
};

const workspace: WorkspaceDetailsDto = {
  schemaVersion: 1,
  id: "workspace",
  name: "Workspace",
  entries: [],
  repositories: [
    {
      id: "repository",
      name: "core",
      commonDir: "C:\\repo\\.git",
      canonicalCommonDir: "c:\\repo\\.git",
      primaryWorktreeId: "worktree",
      worktreeIds: ["worktree"]
    }
  ],
  worktrees: [
    {
      id: "worktree",
      repositoryId: "repository",
      name: "core",
      path: "C:\\repo",
      canonicalPath: "c:\\repo",
      head: "1234567890abcdef",
      branch: "main",
      isPrimary: true,
      isBare: false,
      isDetached: false,
      isLocked: false,
      isPrunable: false
    }
  ],
  selectedTarget: {
    repositoryId: "repository",
    worktreeId: "worktree"
  },
  updatedAt: "2026-09-10T00:00:00.000Z"
};

const workspaceWithTwoWorktrees: WorkspaceDetailsDto = {
  ...workspace,
  entries: [],
  id: "workspace",
  name: "Workspace",
  schemaVersion: 1,
  selectedTarget: {
    repositoryId: "repository",
    worktreeId: "worktree"
  },
  updatedAt: "2026-09-10T00:00:00.000Z",
  repositories: [
    {
      id: "repository",
      name: "core",
      commonDir: "C:\\repo\\.git",
      canonicalCommonDir: "c:\\repo\\.git",
      primaryWorktreeId: "worktree",
      worktreeIds: ["worktree", "linked"]
    }
  ],
  worktrees: [
    {
      id: "worktree",
      repositoryId: "repository",
      name: "core",
      path: "C:\\repo",
      canonicalPath: "c:\\repo",
      head: "1234567890abcdef",
      branch: "main",
      isPrimary: true,
      isBare: false,
      isDetached: false,
      isLocked: false,
      isPrunable: false
    },
    {
      id: "linked",
      repositoryId: "repository",
      name: "feature-worktree",
      path: "C:\\repo-feature",
      canonicalPath: "c:\\repo-feature",
      head: "abcdef1234567890",
      branch: "feature/worktree",
      isPrimary: false,
      isBare: false,
      isDetached: false,
      isLocked: false,
      isPrunable: false
    }
  ]
};
