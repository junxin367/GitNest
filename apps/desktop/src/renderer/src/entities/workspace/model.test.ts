import { describe, expect, it } from "vitest";

import type {
  RepositoryStatusSnapshotDto
} from "@gitnest/contracts";

import { getSnapshotContentRevision } from "./model";

describe("getSnapshotContentRevision", () => {
  it("keeps a no-op refresh stable when a content version is available", () => {
    const snapshot = createSnapshot({
      contentVersion: 4,
      refreshedAt: "2026-09-17T10:00:00.000Z"
    });

    expect(
      getSnapshotContentRevision({
        ...snapshot,
        refreshedAt: "2026-09-17T10:00:15.000Z"
      })
    ).toBe(getSnapshotContentRevision(snapshot));
    expect(
      getSnapshotContentRevision({
        ...snapshot,
        contentVersion: 5,
        refreshedAt: "2026-09-17T10:00:15.000Z"
      })
    ).not.toBe(getSnapshotContentRevision(snapshot));
  });

  it("falls back to refresh time for legacy snapshots", () => {
    const snapshot = createSnapshot({
      refreshedAt: "2026-09-17T10:00:00.000Z"
    });

    expect(
      getSnapshotContentRevision({
        ...snapshot,
        refreshedAt: "2026-09-17T10:00:15.000Z"
      })
    ).not.toBe(getSnapshotContentRevision(snapshot));
  });
});

function createSnapshot(
  overrides: Partial<RepositoryStatusSnapshotDto>
): RepositoryStatusSnapshotDto {
  return {
    repositoryId: "repository",
    worktreeId: "worktree",
    branch: "main",
    head: "a".repeat(40),
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 1,
    untracked: 0,
    conflicted: 0,
    refreshPending: false,
    stale: false,
    refreshedAt: "2026-09-17T10:00:00.000Z",
    ...overrides
  };
}
