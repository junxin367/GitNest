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

import type { WorkspaceDetailsDto } from "@gitnest/contracts";

import { WorkspaceCollectionPage } from "./WorkspaceCollectionPage";
import { WorkspaceOverviewPage } from "./WorkspaceOverviewPage";
import {
  filterSnapshotsToTargets,
  isWorkspaceDataBlocked,
  listWorkspaceTargets
} from "../../entities/workspace/model";

describe("Workspace overview state", () => {
  it("replaces unknown Workspace data with a blocking error state", () => {
    expect(
      isWorkspaceDataBlocked(
        null,
        {
          code: "INVALID_PERSISTED_DATA",
          message: "Workspace document is invalid.",
          details: {}
        },
        null
      )
    ).toBe(true);
  });

  it("includes every group target in the current Workspace and excludes foreign snapshots", () => {
    const workspace = createWorkspace();

    expect(listWorkspaceTargets(workspace)).toEqual([
      {
        repositoryId: "repository-a",
        worktreeId: "worktree-a"
      },
      {
        repositoryId: "repository-b",
        worktreeId: "worktree-b"
      }
    ]);
    expect(
      filterSnapshotsToTargets(
        [
          createSnapshot("repository-a", "worktree-a"),
          createSnapshot("repository-b", "worktree-b"),
          createSnapshot("foreign-repository", "foreign-worktree")
        ],
        listWorkspaceTargets(workspace)
      ).map((snapshot) => snapshot.repositoryId)
    ).toEqual(["repository-a", "repository-b"]);
  });

  it("deduplicates targets repeated across Workspace groups", () => {
    const workspace = createWorkspace();
    workspace.groups.push({
      id: "group-duplicate",
      name: "Duplicate",
      collapsed: false,
      targets: [
        {
          repositoryId: "repository-a",
          worktreeId: "worktree-a"
        }
      ]
    });

    expect(listWorkspaceTargets(workspace)).toHaveLength(2);
  });
});

describe("Workspace overview interactions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }
    );
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document
      .querySelectorAll(".menu-surface")
      .forEach((element) => element.remove());
    vi.unstubAllGlobals();
  });

  it("collapses repository status and recent commit lists from their headers", () => {
    act(() => {
      root.render(
        <WorkspaceOverviewPage
          busy={false}
          error={null}
          notice={null}
          onClearFeedback={() => undefined}
          onCreateWorkspace={async () => false}
          onSelectTarget={() => undefined}
          operation={null}
          snapshots={[]}
          workspace={createWorkspace()}
        />
      );
    });

    const repositoryHeader = container.querySelector<HTMLButtonElement>(
      '[aria-controls="workspace-overview-repository-status"]'
    );
    const recentHeader = container.querySelector<HTMLButtonElement>(
      '[aria-controls="workspace-overview-recent-commits"]'
    );
    expect(repositoryHeader).not.toBeNull();
    expect(recentHeader).not.toBeNull();

    const repositoryBody = container.querySelector(
      "#workspace-overview-repository-status"
    );
    const recentBody = container.querySelector(
      "#workspace-overview-recent-commits"
    );
    expect(repositoryHeader?.getAttribute("aria-expanded")).toBe("true");
    expect(recentHeader?.getAttribute("aria-expanded")).toBe("true");
    expect(repositoryBody?.hasAttribute("hidden")).toBe(false);
    expect(recentBody?.hasAttribute("hidden")).toBe(false);

    act(() => {
      repositoryHeader?.click();
      recentHeader?.click();
    });

    expect(repositoryHeader?.getAttribute("aria-expanded")).toBe("false");
    expect(recentHeader?.getAttribute("aria-expanded")).toBe("false");
    expect(repositoryBody?.hasAttribute("hidden")).toBe(true);
    expect(recentBody?.hasAttribute("hidden")).toBe(true);
  });

  it("uses shared layout skeletons while Workspace data is initially loading", () => {
    act(() => {
      root.render(
        <WorkspaceOverviewPage
          busy
          error={null}
          notice={null}
          onClearFeedback={() => undefined}
          onCreateWorkspace={async () => false}
          onSelectTarget={() => undefined}
          operation="loading"
          snapshots={[]}
          workspace={null}
        />
      );
    });

    expect(
      container.querySelector(
        '.gn-skeleton-surface[aria-label="正在读取 Workspace 概览"]'
      )
    ).not.toBeNull();
    expect(
      container.querySelectorAll(".gn-skeleton").length
    ).toBeGreaterThan(4);
    expect(container.textContent).not.toContain("正在恢复 Workspace");
  });

  it("creates a Workspace from the empty state instead of adding another directory", () => {
    const onCreateWorkspace = vi.fn(async () => true);

    act(() => {
      root.render(
        <WorkspaceCollectionPage
          busy={false}
          loading={false}
          onCreateWorkspace={onCreateWorkspace}
          onSelectTarget={() => undefined}
          snapshots={[]}
          tab="repositories"
          workspace={null}
        />
      );
    });

    const createButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("创建 Workspace")
    );
    expect(createButton).toBeDefined();
    expect(container.textContent).not.toContain("添加目录");

    act(() => {
      createButton?.click();
    });

    expect(onCreateWorkspace).toHaveBeenCalledTimes(1);
  });

  it("shows the Workspace root path and root-level scan counts", () => {
    const workspace = createWorktreeWorkspace();
    workspace.scanIssues = [
      {
        path: "C:\\workspace\\unavailable",
        code: "DIRECTORY_UNAVAILABLE",
        message: "Unavailable"
      }
    ];

    act(() => {
      root.render(
        <WorkspaceOverviewPage
          busy={false}
          error={null}
          notice={null}
          onClearFeedback={() => undefined}
          onCreateWorkspace={async () => false}
          onSelectTarget={() => undefined}
          operation={null}
          snapshots={[]}
          workspace={workspace}
        />
      );
    });

    expect(container.textContent).toContain(
      "根目录：C:\\workspace"
    );
    expect(container.textContent).toContain("扫描问题");
  });

  it("includes all current Workspace repositories in collection pages and counts", () => {
    const workspace = createWorktreeWorkspace();
    const snapshots = [
      createSnapshot("repository-a", "worktree-a"),
      createSnapshot("repository-b", "worktree-b")
    ];
    const onSelectTarget = vi.fn();
    const renderCollection = (
      tab: "repositories" | "activity" | "worktrees"
    ) => {
      act(() => {
        root.render(
          <WorkspaceCollectionPage
            busy={false}
            loading={false}
            onCreateWorkspace={async () => false}
            onSelectTarget={onSelectTarget}
            snapshots={snapshots}
            tab={tab}
            workspace={workspace}
          />
        );
      });
    };

    renderCollection("repositories");

    expect(
      container.querySelectorAll(
        '[aria-label="Workspace 全部仓库"] [role="listitem"]'
      )
    ).toHaveLength(2);
    expect(
      container.querySelector(".panel-caption")?.textContent
    ).toContain("2 个仓库 · 2 个 Worktree");
    expect(container.textContent).toContain("Repository A");
    expect(container.textContent).toContain("Repository B");

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          ".repository-status-item button"
        )
        ?.click();
    });
    expect(onSelectTarget).toHaveBeenLastCalledWith({
      repositoryId: "repository-a",
      worktreeId: "worktree-a"
    });

    renderCollection("activity");

    expect(
      container.querySelectorAll(".workspace-activity-row")
    ).toHaveLength(2);
    expect(
      container.querySelector(".panel-caption")?.textContent
    ).toContain("2 条");
    expect(container.textContent).toContain("Repository A");
    expect(container.textContent).toContain("Repository B");

    renderCollection("worktrees");

    expect(
      container.querySelectorAll(".worktree-summary-card")
    ).toHaveLength(2);
    expect(
      container.querySelector(".page-heading p")?.textContent
    ).toContain("实际登记 2 个 Worktree");
    expect(
      container.querySelector(".worktree-toolbar-count")?.textContent
    ).toContain("共 2 个");
    expect(container.textContent).toContain("Repository A");
    expect(container.textContent).toContain("Repository B");
  });

  it("keeps the repository menu open for internal scrolling and closes it for page scrolling", () => {
    act(() => {
      root.render(
        <WorkspaceCollectionPage
          busy={false}
          loading={false}
          onCreateWorkspace={async () => false}
          onSelectTarget={() => undefined}
          snapshots={[]}
          tab="worktrees"
          workspace={createMultiRepositoryWorkspace()}
        />
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="按仓库筛选 Worktree"]'
    );
    expect(trigger).not.toBeNull();

    act(() => {
      trigger?.click();
    });

    const menu = document.querySelector<HTMLDivElement>(
      ".worktree-repo-menu-surface"
    );
    expect(menu).not.toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");

    act(() => {
      menu?.dispatchEvent(new Event("scroll"));
    });

    expect(
      document.querySelector(".worktree-repo-menu-surface")
    ).toBe(menu);
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");

    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    expect(
      document.querySelector(".worktree-repo-menu-surface")
    ).toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });

  it("clears the cross-repository Worktree query and restores input focus", () => {
    act(() => {
      root.render(
        <WorkspaceCollectionPage
          busy={false}
          loading={false}
          onCreateWorkspace={async () => false}
          onSelectTarget={() => undefined}
          snapshots={[]}
          tab="worktrees"
          workspace={createMultiRepositoryWorkspace()}
        />
      );
    });

    const filterButton = [
      ...container.querySelectorAll("button")
    ].find((button) => button.textContent?.trim() === "筛选");
    act(() => filterButton?.click());

    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="筛选跨仓 Worktree"]'
    );
    expect(input).not.toBeNull();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      setter?.call(input, "Repository A");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(
      container.querySelectorAll(".worktree-summary-card")
    ).toHaveLength(1);

    const clearButton =
      container.querySelector<HTMLButtonElement>(
        '[aria-label="清除跨仓 Worktree 筛选"]'
      );
    expect(clearButton).not.toBeNull();

    act(() => clearButton?.click());

    expect(input?.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(
      container.querySelectorAll(".worktree-summary-card")
    ).toHaveLength(2);
  });
});

function createWorkspace(): WorkspaceDetailsDto {
  return {
    schemaVersion: 2,
    id: "workspace",
    name: "Test Workspace",
    path: "C:\\workspace",
    canonicalPath: "c:\\workspace",
    excludes: [],
    groups: [
      {
        id: "group-all",
        name: "All",
        collapsed: false,
        targets: [
          {
            repositoryId: "repository-a",
            worktreeId: "worktree-a"
          },
          {
            repositoryId: "repository-b",
            worktreeId: "worktree-b"
          }
        ]
      }
    ],
    scanIssues: [],
    lastScannedAt: "2026-09-11T00:00:00.000Z",
    repositories: [],
    worktrees: [],
    updatedAt: "2026-09-11T00:00:00.000Z"
  };
}

function createWorktreeWorkspace(): WorkspaceDetailsDto {
  return {
    ...createWorkspace(),
    repositories: [
      {
        id: "repository-a",
        name: "Repository A",
        commonDir: "C:\\repository-a\\.git",
        canonicalCommonDir: "c:\\repository-a\\.git",
        primaryWorktreeId: "worktree-a",
        worktreeIds: ["worktree-a"]
      },
      {
        id: "repository-b",
        name: "Repository B",
        commonDir: "C:\\repository-b\\.git",
        canonicalCommonDir: "c:\\repository-b\\.git",
        primaryWorktreeId: "worktree-b",
        worktreeIds: ["worktree-b"]
      }
    ],
    worktrees: [
      {
        id: "worktree-a",
        repositoryId: "repository-a",
        name: "Repository A",
        path: "C:\\repository-a",
        canonicalPath: "c:\\repository-a",
        head: "aaaaaaaaaaaaaaaa",
        branch: "main",
        isPrimary: true,
        isBare: false,
        isDetached: false,
        isLocked: false,
        isPrunable: false
      },
      {
        id: "worktree-b",
        repositoryId: "repository-b",
        name: "Repository B",
        path: "C:\\repository-b",
        canonicalPath: "c:\\repository-b",
        head: "bbbbbbbbbbbbbbbb",
        branch: "main",
        isPrimary: true,
        isBare: false,
        isDetached: false,
        isLocked: false,
        isPrunable: false
      }
    ]
  };
}

function createMultiRepositoryWorkspace(): WorkspaceDetailsDto {
  return {
    ...createWorktreeWorkspace(),
    groups: [
      {
        id: "group-all",
        name: "All",
        collapsed: false,
        targets: [
          {
            repositoryId: "repository-a",
            worktreeId: "worktree-a"
          },
          {
            repositoryId: "repository-b",
            worktreeId: "worktree-b"
          }
        ]
      }
    ]
  };
}

function createSnapshot(
  repositoryId: string,
  worktreeId: string
) {
  return {
    repositoryId,
    worktreeId,
    head: `${repositoryId}-head`,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    refreshPending: false,
    stale: false,
    refreshedAt: "2026-09-11T00:00:00.000Z"
  };
}
