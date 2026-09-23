import type {
  RepositoryStatusSnapshotDto,
  WorkspaceWorktreeDto
} from "@gitnest/contracts";
import { describe, expect, it } from "vitest";

import {
  activeWorktreeFilterCount,
  buildWorktreeDeletePlan,
  createWorktreeFilterState,
  isWorktreeSnapshotDirty,
  isWorktreeSnapshotReadyForDelete,
  matchesWorktreeFilters,
  toggleWorktreeFacet,
  worktreeFacetIds,
  worktreeStatusLabel,
  worktreeStatusTone,
  type WorktreeFilterState
} from "./worktreeFilters";

describe("worktree filters", () => {
  it("derives facet ids from worktree flags", () => {
    expect(worktreeFacetIds(worktree({ isPrimary: true }))).toEqual([
      "primary"
    ]);
    expect(worktreeFacetIds(worktree({}))).toEqual(["linked"]);
    expect(
      worktreeFacetIds(
        worktree({ isDetached: true, branch: "" })
      )
    ).toEqual(["linked", "detached"]);
    expect(worktreeFacetIds(worktree({ isLocked: true }))).toEqual([
      "linked",
      "locked"
    ]);
    expect(worktreeFacetIds(worktree({ isPrunable: true }))).toEqual([
      "prunable"
    ]);
  });

  it("combines facet, repository, dirty and query filters", () => {
    const filters: WorktreeFilterState = {
      ...createWorktreeFilterState(),
      facet: "detached"
    };
    const detached = worktree({
      isDetached: true,
      branch: "",
      id: "detached"
    });
    const linked = worktree({ id: "linked" });

    expect(
      matchesWorktreeFilters(detached, undefined, filters)
    ).toBe(true);
    expect(
      matchesWorktreeFilters(linked, undefined, filters)
    ).toBe(false);

    const dirtyFilters = {
      ...createWorktreeFilterState(),
      onlyDirty: true
    };
    expect(
      matchesWorktreeFilters(detached, snapshot({ staged: 2 }), dirtyFilters)
    ).toBe(true);
    expect(
      matchesWorktreeFilters(detached, snapshot({}), dirtyFilters)
    ).toBe(false);

    const repositoryFilters = {
      ...createWorktreeFilterState(),
      repositoryId: "other"
    };
    expect(
      matchesWorktreeFilters(detached, undefined, repositoryFilters)
    ).toBe(false);

    const queryFilters = {
      ...createWorktreeFilterState(),
      query: "feature"
    };
    expect(
      matchesWorktreeFilters(
        worktree({ branch: "feature/worktree" }),
        undefined,
        queryFilters
      )
    ).toBe(true);
    expect(
      matchesWorktreeFilters(detached, undefined, queryFilters)
    ).toBe(false);
  });

  it("counts active filters and keeps the selected type single", () => {
    const filters: WorktreeFilterState = {
      facet: "detached",
      onlyDirty: true,
      query: "core",
      repositoryId: "repo"
    };
    expect(activeWorktreeFilterCount(filters)).toBe(4);

    expect(toggleWorktreeFacet("detached", "locked")).toBe("locked");
    expect(toggleWorktreeFacet("detached", "detached")).toBeNull();
  });

  it("treats only dirty worktree snapshots as dirty", () => {
    expect(isWorktreeSnapshotDirty(undefined)).toBe(false);
    expect(isWorktreeSnapshotDirty(snapshot({}))).toBe(false);
    expect(isWorktreeSnapshotDirty(snapshot({ untracked: 1 }))).toBe(true);
    expect(isWorktreeSnapshotDirty(snapshot({ conflicted: 1 }))).toBe(true);
  });

  it("requires a current successful snapshot before delete", () => {
    expect(isWorktreeSnapshotReadyForDelete(undefined)).toBe(false);
    expect(
      isWorktreeSnapshotReadyForDelete(snapshot({}))
    ).toBe(true);
    expect(
      isWorktreeSnapshotReadyForDelete(
        snapshot({ stale: true })
      )
    ).toBe(false);
    expect(
      isWorktreeSnapshotReadyForDelete(
        snapshot({ refreshPending: true })
      )
    ).toBe(false);
    expect(
      isWorktreeSnapshotReadyForDelete(
        snapshot({
          error: {
            code: "COMMAND_FAILED",
            message: "read failed"
          }
        })
      )
    ).toBe(false);
    expect(
      isWorktreeSnapshotReadyForDelete(
        snapshot({ operationState: "rebase" })
      )
    ).toBe(false);
  });

  it("shows locked status ahead of detached status", () => {
    const lockedDetached = worktree({
      branch: "",
      isDetached: true,
      isLocked: true
    });

    expect(worktreeStatusLabel(lockedDetached)).toBe("已锁定");
    expect(worktreeStatusTone(lockedDetached)).toBe("yellow");
  });

  it("builds delete commands only for clean mutable Worktrees", () => {
    const primary = worktree({
      id: "primary",
      isPrimary: true
    });
    const clean = worktree({ id: "clean" });
    const dirty = worktree({ id: "dirty" });
    const locked = worktree({
      id: "locked",
      isLocked: true
    });
    const unknown = worktree({ id: "unknown" });
    const snapshots = new Map([
      ["primary", snapshot({ worktreeId: "primary" })],
      ["clean", snapshot({ worktreeId: "clean" })],
      [
        "dirty",
        snapshot({
          worktreeId: "dirty",
          unstaged: 1
        })
      ],
      ["locked", snapshot({ worktreeId: "locked" })]
    ]);

    const plan = buildWorktreeDeletePlan(
      [primary, clean, dirty, locked, unknown],
      (candidate) => snapshots.get(candidate.id),
      "linked"
    );

    expect(plan.mode).toBe("remove");
    expect(plan.commands).toEqual([
      {
        type: "remove",
        worktreeId: "clean"
      }
    ]);
    expect(plan.blocked).toEqual({
      bare: 0,
      dirty: 1,
      locked: 1,
      primary: 1,
      unavailable: 1
    });
  });

  it("blocks stale, pending, failed and in-progress snapshots", () => {
    const candidates = [
      worktree({ id: "stale" }),
      worktree({ id: "pending" }),
      worktree({ id: "failed" }),
      worktree({ id: "rebasing" })
    ];
    const snapshots = new Map([
      [
        "stale",
        snapshot({ worktreeId: "stale", stale: true })
      ],
      [
        "pending",
        snapshot({
          worktreeId: "pending",
          refreshPending: true
        })
      ],
      [
        "failed",
        snapshot({
          worktreeId: "failed",
          error: {
            code: "COMMAND_FAILED",
            message: "read failed"
          }
        })
      ],
      [
        "rebasing",
        snapshot({
          worktreeId: "rebasing",
          operationState: "rebase"
        })
      ]
    ]);

    const plan = buildWorktreeDeletePlan(
      candidates,
      (candidate) => snapshots.get(candidate.id),
      "linked"
    );

    expect(plan.commands).toEqual([]);
    expect(plan.blocked.unavailable).toBe(4);
  });

  it("labels and blocks bare repositories separately", () => {
    const bare = worktree({
      isBare: true,
      isPrimary: true
    });
    const plan = buildWorktreeDeletePlan(
      [bare],
      () => undefined,
      "primary"
    );

    expect(worktreeStatusLabel(bare)).toBe("裸仓库");
    expect(plan.commands).toEqual([]);
    expect(plan.blocked.bare).toBe(1);
  });

  it("deduplicates prune commands by repository", () => {
    const plan = buildWorktreeDeletePlan(
      [
        worktree({
          id: "stale-a",
          isPrunable: true
        }),
        worktree({
          id: "stale-b",
          isPrunable: true
        }),
        worktree({
          id: "stale-c",
          isPrunable: true,
          repositoryId: "repository-2"
        })
      ],
      () => undefined,
      "prunable"
    );

    expect(plan.mode).toBe("prune");
    expect(plan.eligibleCount).toBe(3);
    expect(plan.commands).toEqual([
      {
        type: "prune",
        repositoryId: "repository"
      },
      {
        type: "prune",
        repositoryId: "repository-2"
      }
    ]);
  });
});

function worktree(
  overrides: Partial<WorkspaceWorktreeDto>
): WorkspaceWorktreeDto {
  return {
    id: "worktree",
    repositoryId: "repository",
    name: "core",
    path: "C:\\repo",
    canonicalPath: "c:\\repo",
    head: "abcdef1234567890",
    branch: "main",
    isPrimary: false,
    isBare: false,
    isDetached: false,
    isLocked: false,
    isPrunable: false,
    ...overrides
  };
}

function snapshot(
  overrides: Partial<RepositoryStatusSnapshotDto>
): RepositoryStatusSnapshotDto {
  return {
    repositoryId: "repository",
    worktreeId: "worktree",
    branch: "main",
    head: "abcdef1234567890",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    stale: false,
    refreshPending: false,
    refreshedAt: "2026-09-14T00:00:00.000Z",
    ...overrides
  };
}
