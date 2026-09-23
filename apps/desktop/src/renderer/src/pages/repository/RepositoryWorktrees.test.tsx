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
  RepositoryStatusSnapshotDto,
  WorkspaceDetailsDto
} from "@gitnest/contracts";

import type { WorktreeCommandController } from "../../features/worktree-command/useWorktreeCommands";
import type { WorkspaceWorktreeCommandController } from "../../features/worktree-command/useWorkspaceWorktreeCommands";
import {
  RepositoryWorktrees as RepositoryWorktreesView
} from "./RepositoryWorktrees";

function RepositoryWorktrees(
  props: Omit<
    React.ComponentProps<typeof RepositoryWorktreesView>,
    "batchCommands"
  >
) {
  return (
    <RepositoryWorktreesView
      {...props}
      batchCommands={batchCommands}
    />
  );
}

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

  it("keeps the toolbar clear action disabled until the prunable type is selected", () => {
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

    const toolbar = container.querySelector(".worktree-toolbar");
    const toolbarButtons = [
      ...(toolbar?.querySelectorAll<HTMLButtonElement>("button") ?? [])
    ];
    const clearButton =
      toolbar?.querySelector<HTMLButtonElement>(
        ".worktree-delete-action"
      );
    const filterButton = toolbarButtons.find(
      (button) => button.textContent?.trim() === "筛选"
    );

    expect(clearButton?.disabled).toBe(true);
    expect(toolbarButtons.indexOf(clearButton as HTMLButtonElement)).toBe(
      toolbarButtons.indexOf(filterButton as HTMLButtonElement) - 1
    );

    const prunableChip = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".worktree-filter-chip"
      )
    ].find(
      (button) => button.textContent?.trim() === "可清理登记1"
    );
    act(() => prunableChip?.click());

    expect(clearButton?.disabled).toBe(false);
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

  it("runs the repository prune preflight from the toolbar and removes card actions", () => {
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
    expect(
      prunableCard?.querySelector(".worktree-clear-action")
    ).toBeNull();

    const clearButton = container.querySelector<HTMLButtonElement>(
      ".worktree-delete-action"
    );
    expect(clearButton?.disabled).toBe(true);

    const prunableChip = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".worktree-filter-chip"
      )
    ].find(
      (button) => button.textContent?.trim() === "可清理登记1"
    );
    act(() => prunableChip?.click());

    expect(clearButton?.textContent).toContain("清除");
    expect(clearButton?.disabled).toBe(false);
    expect(clearButton?.title).toContain("1 个仓库");

    act(() => clearButton?.click());
    expect(batchCommands.request).toHaveBeenCalledWith([
      {
        type: "prune",
        repositoryId: "repository"
      }
    ]);
    expect(onOpenDirectory).not.toHaveBeenCalled();
  });

  it("removes clean linked Worktrees from the selected type", () => {
    act(() => {
      root.render(
        <RepositoryWorktrees
          commands={commands}
          directoryOpening={false}
          onOpenDirectory={vi.fn()}
          repositoryId="repository"
          snapshots={[createSnapshot("linked")]}
          worktreeId="worktree"
          workspace={workspaceWithTwoWorktrees}
        />
      );
    });

    const linkedChip = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".worktree-filter-chip"
      )
    ].find(
      (button) => button.textContent?.trim() === "已登记1"
    );
    act(() => linkedChip?.click());

    const deleteButton =
      container.querySelector<HTMLButtonElement>(
        '[aria-label="删除筛选中的 Worktree"]'
      );
    expect(deleteButton?.disabled).toBe(false);
    expect(deleteButton?.title).toContain("1 个干净 Worktree");

    act(() => deleteButton?.click());
    expect(batchCommands.request).toHaveBeenCalledWith([
      {
        type: "remove",
        worktreeId: "linked"
      }
    ]);
  });

  it("keeps delete disabled for primary and dirty Worktrees", () => {
    act(() => {
      root.render(
        <RepositoryWorktrees
          commands={commands}
          directoryOpening={false}
          onOpenDirectory={vi.fn()}
          repositoryId="repository"
          snapshots={[
            createSnapshot("worktree"),
            createSnapshot("linked", { unstaged: 1 })
          ]}
          worktreeId="worktree"
          workspace={workspaceWithTwoWorktrees}
        />
      );
    });

    const chips = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".worktree-filter-chip"
      )
    ];
    const primaryChip = chips.find(
      (button) => button.textContent?.trim() === "主工作目录1"
    );
    const linkedChip = chips.find(
      (button) => button.textContent?.trim() === "已登记1"
    );
    const deleteButton =
      container.querySelector<HTMLButtonElement>(
        '[aria-label="删除筛选中的 Worktree"]'
      );

    act(() => primaryChip?.click());
    expect(deleteButton?.disabled).toBe(true);
    expect(deleteButton?.title).toContain("主工作目录不能删除");

    act(() => linkedChip?.click());
    expect(deleteButton?.disabled).toBe(true);
    expect(deleteButton?.title).toContain("有变更");
    act(() => deleteButton?.click());
    expect(batchCommands.request).not.toHaveBeenCalled();
  });

  it("keeps delete disabled until the status snapshot is current", () => {
    act(() => {
      root.render(
        <RepositoryWorktrees
          commands={commands}
          directoryOpening={false}
          onOpenDirectory={vi.fn()}
          repositoryId="repository"
          snapshots={[
            createSnapshot("linked", {
              stale: true
            })
          ]}
          worktreeId="worktree"
          workspace={workspaceWithTwoWorktrees}
        />
      );
    });

    const linkedChip = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".worktree-filter-chip"
      )
    ].find(
      (button) => button.textContent?.trim() === "已登记1"
    );
    act(() => linkedChip?.click());

    const deleteButton =
      container.querySelector<HTMLButtonElement>(
        '[aria-label="删除筛选中的 Worktree"]'
      );
    expect(deleteButton?.disabled).toBe(true);
    expect(deleteButton?.title).toContain("状态未就绪");
    expect(container.textContent).toContain("状态未就绪");
    expect(
      container.querySelector(".worktree-summary-card")
        ?.getAttribute("aria-label")
    ).toContain("状态未就绪");
  });

  it("keeps toolbar clear disabled for locked prunable registrations", () => {
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

    const prunableChip = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".worktree-filter-chip"
      )
    ].find(
      (button) => button.textContent?.trim() === "可清理登记1"
    );
    act(() => prunableChip?.click());

    const clearButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="清除失效 Worktree 登记"]'
    );
    expect(clearButton?.disabled).toBe(true);
    expect(clearButton?.title).toContain("需先解锁");
    expect(container.querySelector(".worktree-clear-action")).toBeNull();
    act(() => clearButton?.click());
    expect(batchCommands.request).not.toHaveBeenCalled();
  });

  it("shows bare repositories as non-interactive and non-deletable", () => {
    const onOpenDirectory = vi.fn();
    const bareWorkspace: WorkspaceDetailsDto = {
      ...workspace,
      worktrees: workspace.worktrees.map((worktree) => ({
        ...worktree,
        isBare: true
      }))
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
          workspace={bareWorkspace}
        />
      );
    });

    const card = container.querySelector<HTMLElement>(
      ".worktree-summary-card.bare"
    );
    expect(card?.getAttribute("role")).toBeNull();
    expect(card?.textContent).toContain("裸仓库");

    const primaryChip = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".worktree-filter-chip"
      )
    ].find(
      (button) => button.textContent?.trim() === "主工作目录1"
    );
    act(() => primaryChip?.click());

    expect(
      container.querySelector(".worktree-delete-status")
        ?.textContent
    ).toContain("裸仓库");
    act(() => card?.click());
    expect(onOpenDirectory).not.toHaveBeenCalled();
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

  it("returns focus to the filter trigger when Escape closes search", () => {
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
      ...container.querySelectorAll<HTMLButtonElement>("button")
    ].find((button) => button.textContent?.trim() === "筛选");
    act(() => filterButton?.click());
    const input = container.querySelector<HTMLInputElement>(
      ".worktree-filter-input"
    );

    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Escape"
        })
      );
    });

    expect(
      container.querySelector(".worktree-filter-input")
    ).toBeNull();
    expect(document.activeElement).toBe(filterButton);
  });

  it("shows locked status ahead of detached status", () => {
    const lockedWorkspace: WorkspaceDetailsDto = {
      ...workspaceWithTwoWorktrees,
      worktrees: workspaceWithTwoWorktrees.worktrees.map(
        (worktree) =>
          worktree.id === "linked"
            ? {
                ...worktree,
                branch: "",
                isDetached: true,
                isLocked: true
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
          workspace={lockedWorkspace}
        />
      );
    });

    const cards = [
      ...container.querySelectorAll<HTMLElement>(
        ".worktree-summary-card"
      )
    ];
    expect(
      cards[1]?.querySelector(".worktree-card-status")
        ?.textContent
    ).toBe("已锁定");
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
    const filterTrigger = [
      ...container.querySelectorAll<HTMLButtonElement>("button")
    ].find((button) => button.textContent?.trim() === "筛选");
    expect(clearButton?.textContent?.trim()).toBe("清除筛选（1）");
    act(() => clearButton?.click());
    expect(container.textContent).not.toContain("已筛出");
    expect(document.activeElement).toBe(filterTrigger);
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

const batchCommands: WorkspaceWorktreeCommandController = {
  active: null,
  busy: false,
  preflights: [],
  error: null,
  notice: null,
  request: vi.fn(async () => false),
  confirm: vi.fn(async () => false),
  dismissPreflight: vi.fn(),
  clearFeedback: vi.fn()
};

const workspace: WorkspaceDetailsDto = {
  schemaVersion: 2,
  id: "workspace",
  name: "Workspace",
  path: "C:\\repo",
  canonicalPath: "c:\\repo",
  excludes: [],
  groups: [
    {
      id: "group",
      name: "原/根仓库",
      targets: [
        {
          repositoryId: "repository",
          worktreeId: "worktree"
        }
      ],
      collapsed: false
    }
  ],
  scanIssues: [],
  lastScannedAt: "2026-09-10T00:00:00.000Z",
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
  id: "workspace",
  name: "Workspace",
  schemaVersion: 2,
  groups: [
    {
      id: "group",
      name: "原/根仓库",
      targets: [
        {
          repositoryId: "repository",
          worktreeId: "worktree"
        },
        {
          repositoryId: "repository",
          worktreeId: "linked"
        }
      ],
      collapsed: false
    }
  ],
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

function createSnapshot(
  worktreeId: string,
  overrides: Partial<RepositoryStatusSnapshotDto> = {}
): RepositoryStatusSnapshotDto {
  return {
    repositoryId: "repository",
    worktreeId,
    branch:
      worktreeId === "worktree"
        ? "main"
        : "feature/worktree",
    head: "abcdef1234567890",
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    refreshPending: false,
    stale: false,
    refreshedAt: "2026-09-23T00:00:00.000Z",
    ...overrides
  };
}
