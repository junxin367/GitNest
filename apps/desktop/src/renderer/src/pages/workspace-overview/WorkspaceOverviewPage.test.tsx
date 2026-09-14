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

describe("Workspace overview collapsible panels", () => {
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
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
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
