import { describe, expect, it } from "vitest";

import type {
  RepositoryStatusSnapshotDto
} from "@gitnest/contracts";

import { getSnapshotChangesRevision, getSnapshotContentRevision } from "./model";

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

describe("getSnapshotChangesRevision", () => {
  it("ignores remote tracking updates and forced status versions", () => {
    const snapshot = createSnapshot({
      changesRevision: "local-content",
      contentVersion: 4,
      upstream: "origin/main"
    });
    const fetched = {
      ...snapshot, contentVersion: 5, ahead: 2, behind: 3,
      refreshedAt: "2026-11-05T00:05:00.000Z"
    };
    delete fetched.upstream;
    expect(getSnapshotChangesRevision(fetched)).toBe(getSnapshotChangesRevision(snapshot));
  });

  it.each([
    { changesRevision: "edited-content" },
    { head: "b".repeat(40) },
    { branch: "feature/example" },
    { staged: 1 },
    { unstaged: 2 },
    { untracked: 1 },
    { conflicted: 1 },
    { operationState: "merge" as const },
    { error: { code: "COMMAND_FAILED", message: "读取失败" } }
  ])("detects local changes: %j", (change) => {
    const snapshot = createSnapshot({ changesRevision: "local-content", contentVersion: 4 });
    expect(getSnapshotChangesRevision({ ...snapshot, ...change }))
      .not.toBe(getSnapshotChangesRevision(snapshot));
  });

  it("uses the content version or refresh time for older snapshots", () => {
    const snapshot = createSnapshot({ contentVersion: 4 });
    expect(getSnapshotChangesRevision({ ...snapshot, contentVersion: 5 }))
      .not.toBe(getSnapshotChangesRevision(snapshot));
    const legacy = createSnapshot({});
    expect(getSnapshotChangesRevision({ ...legacy, refreshedAt: "2026-11-05T00:05:00.000Z" }))
      .not.toBe(getSnapshotChangesRevision(legacy));
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
