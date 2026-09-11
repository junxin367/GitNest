import { describe, expect, it } from "vitest";

import type { WorkspaceDetailsDto } from "@gitnest/contracts";

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
