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
  getActiveWorkspaceEntry,
  isWorkspaceDataBlocked,
  listActiveWorkspaceTargets
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

  it("limits overview targets to the currently selected Workspace entry", () => {
    const workspace = createWorkspace();

    expect(getActiveWorkspaceEntry(workspace)?.id).toBe("entry-a");
    expect(listActiveWorkspaceTargets(workspace)).toEqual([
      {
        repositoryId: "repository-a",
        worktreeId: "worktree-a"
      }
    ]);
    expect(
      filterSnapshotsToTargets(
        [
          createSnapshot("repository-a", "worktree-a"),
          createSnapshot("repository-b", "worktree-b")
        ],
        listActiveWorkspaceTargets(workspace)
      ).map((snapshot) => snapshot.repositoryId)
    ).toEqual(["repository-a"]);
  });

  it("falls back to the first Workspace entry when no entry is selected", () => {
    const workspace = createWorkspace();
    delete workspace.selectedEntryId;

    expect(getActiveWorkspaceEntry(workspace)?.id).toBe("entry-a");
    expect(listActiveWorkspaceTargets(workspace)).toEqual([
      {
        repositoryId: "repository-a",
        worktreeId: "worktree-a"
      }
    ]);
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
          onAddDirectory={() => undefined}
          onAddManualPath={async () => false}
          onClearFeedback={() => undefined}
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
          onAddDirectory={() => undefined}
          onAddManualPath={async () => false}
          onClearFeedback={() => undefined}
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

  it("limits collection pages and counts to the selected Workspace entry", () => {
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
            onAddDirectory={() => undefined}
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
    ).toHaveLength(1);
    expect(
      container.querySelector(".panel-caption")?.textContent
    ).toContain("1 个仓库 · 1 个 Worktree");
    expect(container.textContent).toContain("Repository A");
    expect(container.textContent).not.toContain("Repository B");

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
    ).toHaveLength(1);
    expect(
      container.querySelector(".panel-caption")?.textContent
    ).toContain("1 条");
    expect(container.textContent).toContain("Repository A");
    expect(container.textContent).not.toContain("Repository B");

    renderCollection("worktrees");

    expect(
      container.querySelectorAll(".worktree-summary-card")
    ).toHaveLength(1);
    expect(
      container.querySelector(".page-heading p")?.textContent
    ).toContain("实际登记 1 个 Worktree");
    expect(
      container.querySelector(".worktree-toolbar-count")?.textContent
    ).toContain("共 1 个");
    expect(container.textContent).toContain("Repository A");
    expect(container.textContent).not.toContain("Repository B");
  });

  it("keeps the repository menu open for internal scrolling and closes it for page scrolling", () => {
    act(() => {
      root.render(
        <WorkspaceCollectionPage
          busy={false}
          loading={false}
          onAddDirectory={() => undefined}
          onSelectTarget={() => undefined}
          snapshots={[]}
          tab="worktrees"
          workspace={createMultiRepositoryEntryWorkspace()}
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
});

function createWorkspace(): WorkspaceDetailsDto {
  return {
    schemaVersion: 1,
    id: "workspace",
    name: "Test Workspace",
    entries: [
      {
        id: "entry-a",
        displayName: "Workspace A",
        path: "C:\\workspace-a",
        canonicalPath: "c:\\workspace-a",
        excludes: [],
        order: 0,
        groups: [],
        scanIssues: [],
        lastScannedAt: "2026-09-11T00:00:00.000Z",
        kind: "standalone-repository",
        target: {
          repositoryId: "repository-a",
          worktreeId: "worktree-a"
        }
      },
      {
        id: "entry-b",
        displayName: "Workspace B",
        path: "C:\\workspace-b",
        canonicalPath: "c:\\workspace-b",
        excludes: [],
        order: 1,
        groups: [],
        scanIssues: [],
        lastScannedAt: "2026-09-11T00:00:00.000Z",
        kind: "standalone-repository",
        target: {
          repositoryId: "repository-b",
          worktreeId: "worktree-b"
        }
      }
    ],
    repositories: [],
    worktrees: [],
    selectedEntryId: "entry-a",
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

function createMultiRepositoryEntryWorkspace(): WorkspaceDetailsDto {
  return {
    ...createWorktreeWorkspace(),
    entries: [
      {
        id: "entry-all",
        displayName: "Workspace All",
        path: "C:\\workspace-all",
        canonicalPath: "c:\\workspace-all",
        excludes: [],
        order: 0,
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
        kind: "workspace-directory"
      }
    ],
    selectedEntryId: "entry-all"
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
