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

describe("RepositoryWorktrees registered cards", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
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
    ).toContain("登记路径");
    expect(card?.querySelector("button")).toBeNull();
    expect(container.querySelector(".worktree-card-manage-action")).toBeNull();

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
    expect(
      container.querySelector(".metric-card.tone-red")
    ).toBeTruthy();
    expect(container.textContent).not.toContain("Detached");
  });

  it("removes the header prune shortcut while keeping the safety action", () => {
    const workspaceWithPrunableWorktree: WorkspaceDetailsDto = {
      ...workspaceWithTwoWorktrees,
      worktrees: workspaceWithTwoWorktrees.worktrees.map(
        (worktree, index) =>
          index === 1
            ? {
                ...worktree,
                isPrunable: true,
                pruneReason: "登记路径已失效"
              }
            : worktree
      )
    };

    act(() => {
      root.render(
        <RepositoryWorktrees
          commands={commands}
          directoryOpening={false}
          onOpenDirectory={vi.fn()}
          repositoryId="repository"
          snapshots={[]}
          worktreeId="worktree"
          workspace={workspaceWithPrunableWorktree}
        />
      );
    });

    const headingActions = container.querySelector(
      ".worktree-page-heading .page-actions"
    );

    expect(headingActions?.textContent).not.toContain("Prune 预览");
    expect(headingActions?.textContent).toContain("新建 Worktree");

    const createButton =
      headingActions?.querySelector<HTMLButtonElement>("button");
    act(() => createButton?.click());

    expect(container.textContent).toContain("预检清除 (1)");
  });

  it("matches the prototype hierarchy without duplicating the current worktree", () => {
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
          workspace={workspaceWithTwoWorktrees}
        />
      );
    });

    expect(container.querySelector(".worktree-toolbar")).toBeTruthy();
    expect(
      container.querySelector("details.worktree-inventory-disclosure")
    ).toBeNull();
    expect(
      container.querySelectorAll(".worktree-summary-card").length
    ).toBe(2);
    expect(container.querySelector(".worktree-management-panel")).toBeNull();
    expect(container.querySelector(".worktree-card-actions")).toBeNull();
    expect(container.textContent).toContain("共 2 个");

    const cards = [
      ...container.querySelectorAll<HTMLElement>(
        ".worktree-summary-card"
      )
    ];
    act(() => cards[1]?.click());

    expect(onOpenDirectory).toHaveBeenCalledOnce();
    expect(onOpenDirectory).toHaveBeenCalledWith("linked");
  });

  it("runs the repository prune preflight from a prunable card", () => {
    const onOpenDirectory = vi.fn();
    const workspaceWithPrunableWorktree: WorkspaceDetailsDto = {
      ...workspaceWithTwoWorktrees,
      worktrees: workspaceWithTwoWorktrees.worktrees.map(
        (worktree, index) =>
          index === 1
            ? {
                ...worktree,
                isPrunable: true,
                pruneReason: "登记路径已失效"
              }
            : worktree
      )
    };

    act(() => {
      root.render(
        <RepositoryWorktrees
          commands={commands}
          directoryOpening={false}
          onOpenDirectory={onOpenDirectory}
          repositoryId="repository"
          snapshots={[]}
          worktreeId="worktree"
          workspace={workspaceWithPrunableWorktree}
        />
      );
    });

    const prunableCard = [
      ...container.querySelectorAll<HTMLElement>(
        ".worktree-summary-card"
      )
    ][1];

    expect(container.querySelector(".worktree-card-manage-action")).toBeNull();
    expect(container.querySelector(".worktree-management-panel")).toBeNull();
    expect(prunableCard?.getAttribute("role")).toBeNull();
    expect(prunableCard?.tabIndex).toBe(-1);
    expect(
      prunableCard?.querySelector(".worktree-foot-action")
    ).toBeNull();
    const clearButton =
      prunableCard?.querySelector<HTMLButtonElement>(
        ".worktree-clear-action"
      );
    expect(clearButton?.textContent).toContain("清除");
    expect(clearButton?.disabled).toBe(false);
    expect(clearButton?.title).toContain(
      "core 仓库中的 1 条失效登记"
    );

    act(() => clearButton?.click());
    expect(commands.request).toHaveBeenCalledWith({
      type: "prune",
      repositoryId: "repository"
    });
    expect(onOpenDirectory).not.toHaveBeenCalled();
  });

  it("disables clear for a locked prunable registration", () => {
    const workspaceWithLockedPrunableWorktree: WorkspaceDetailsDto = {
      ...workspaceWithTwoWorktrees,
      worktrees: workspaceWithTwoWorktrees.worktrees.map(
        (worktree, index) =>
          index === 1
            ? {
                ...worktree,
                isLocked: true,
                isPrunable: true,
                lockReason: "保留登记",
                pruneReason: "登记路径已失效"
              }
            : worktree
      )
    };

    act(() => {
      root.render(
        <RepositoryWorktrees
          commands={commands}
          directoryOpening={false}
          onOpenDirectory={vi.fn()}
          repositoryId="repository"
          snapshots={[]}
          worktreeId="worktree"
          workspace={workspaceWithLockedPrunableWorktree}
        />
      );
    });

    const clearButton =
      container.querySelector<HTMLButtonElement>(
        ".worktree-clear-action"
      );
    expect(clearButton?.disabled).toBe(true);
    expect(clearButton?.title).toContain("需先解锁");
    act(() => clearButton?.click());
    expect(commands.request).not.toHaveBeenCalled();
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

    expect(container.textContent).toContain("共 2 个 · 已筛出 1 个");
    expect(
      container.querySelectorAll(".worktree-summary-card").length
    ).toBe(1);

    const clearQueryButton =
      container.querySelector<HTMLButtonElement>(
        '[aria-label="清除 Worktree 筛选"]'
      );
    expect(clearQueryButton).toBeTruthy();

    act(() => clearQueryButton?.click());

    expect(input?.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(container.textContent).toContain("共 2 个");
    expect(
      container.querySelectorAll(".worktree-summary-card").length
    ).toBe(2);

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

  it("filters worktrees by one type at a time with counts", () => {
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

    const typeGroup = container.querySelector(
      '[aria-label="按类型筛选 Worktree"]'
    );
    expect(typeGroup?.querySelector(".worktree-filter-bar-label")?.textContent)
      .toBe("类型");

    const primaryChip = [...chips].find(
      (chip) => chip.textContent?.trim() === "主工作目录1"
    ) as HTMLButtonElement | undefined;
    const linkedChip = [...chips].find(
      (chip) => chip.textContent?.trim() === "已登记1"
    ) as HTMLButtonElement | undefined;
    expect(primaryChip?.textContent?.trim()).toBe("主工作目录1");

    act(() => primaryChip?.click());

    expect(primaryChip?.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("共 2 个 · 已筛出 1 个");
    expect(
      container.querySelectorAll(".worktree-summary-card").length
    ).toBe(1);

    act(() => linkedChip?.click());

    expect(primaryChip?.getAttribute("aria-pressed")).toBe("false");
    expect(linkedChip?.getAttribute("aria-pressed")).toBe("true");
    expect(
      container.querySelector(".worktree-title")?.textContent
    ).toBe("feature/worktree");

    const clearButton = [
      ...container.querySelectorAll("button")
    ].find((button) => button.textContent?.includes("清除筛选"));
    expect(clearButton?.textContent?.trim()).toBe("清除筛选（1）");
    act(() => clearButton?.click());
    expect(container.textContent).not.toContain("已筛出");
    expect(
      container.querySelectorAll(".worktree-summary-card").length
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
