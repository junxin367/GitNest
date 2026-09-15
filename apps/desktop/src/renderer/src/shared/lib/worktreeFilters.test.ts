import type {
  RepositoryStatusSnapshotDto,
  WorkspaceWorktreeDto
} from "@gitnest/contracts";
import { describe, expect, it } from "vitest";

import {
  activeWorktreeFilterCount,
  createWorktreeFilterState,
  isWorktreeSnapshotDirty,
  matchesWorktreeFilters,
  toggleWorktreeFacet,
  worktreeFacetIds,
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
    const filters = {
      ...createWorktreeFilterState(),
      facets: ["detached"] as const
    };
    const detached = worktree({
      isDetached: true,
      branch: "",
      id: "detached"
    });
    const linked = worktree({ id: "linked" });

    expect(
      matchesWorktreeFilters(
        detached,
        undefined,
        { ...filters, facets: [...filters.facets] }
      )
    ).toBe(true);
    expect(
      matchesWorktreeFilters(linked, undefined, {
        ...filters,
        facets: [...filters.facets]
      })
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

  it("counts active filters and toggles facets", () => {
    const filters: WorktreeFilterState = {
      facets: ["detached"],
      onlyDirty: true,
      query: "core",
      repositoryId: "repo"
    };
    expect(activeWorktreeFilterCount(filters)).toBe(4);

    expect(toggleWorktreeFacet(["detached"], "locked")).toEqual([
      "detached",
      "locked"
    ]);
    expect(toggleWorktreeFacet(["detached", "locked"], "detached")).toEqual(
      ["locked"]
    );
  });

  it("treats only dirty worktree snapshots as dirty", () => {
    expect(isWorktreeSnapshotDirty(undefined)).toBe(false);
    expect(isWorktreeSnapshotDirty(snapshot({}))).toBe(false);
    expect(isWorktreeSnapshotDirty(snapshot({ untracked: 1 }))).toBe(true);
    expect(isWorktreeSnapshotDirty(snapshot({ conflicted: 1 }))).toBe(true);
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
