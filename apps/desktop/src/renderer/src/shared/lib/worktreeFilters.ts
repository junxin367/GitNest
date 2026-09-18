import type {
  RepositoryStatusSnapshotDto,
  WorkspaceWorktreeDto
} from "@gitnest/contracts";

export type WorktreeFacet =
  | "primary"
  | "linked"
  | "detached"
  | "locked"
  | "prunable";

export interface WorktreeFilterState {
  facet: WorktreeFacet | null;
  onlyDirty: boolean;
  query: string;
  repositoryId: string;
}

export const WORKTREE_FACET_OPTIONS: ReadonlyArray<{
  id: WorktreeFacet;
  label: string;
}> = [
  { id: "primary", label: "主工作目录" },
  { id: "linked", label: "已登记" },
  { id: "detached", label: "游离 HEAD" },
  { id: "locked", label: "已锁定" },
  { id: "prunable", label: "可清理登记" }
];

export function createWorktreeFilterState(): WorktreeFilterState {
  return {
    facet: null,
    onlyDirty: false,
    query: "",
    repositoryId: ""
  };
}

function worktreeKindLabel(
  worktree: WorkspaceWorktreeDto
): string {
  if (worktree.isPrunable) {
    return "可清理登记";
  }
  if (worktree.isPrimary) {
    return "主工作目录";
  }
  if (worktree.isLocked) {
    return "已锁定";
  }
  if (worktree.isDetached || !worktree.branch) {
    return "游离 HEAD";
  }
  return "已登记";
}

export function worktreeFacetIds(
  worktree: WorkspaceWorktreeDto
): WorktreeFacet[] {
  const facets: WorktreeFacet[] = [];

  if (worktree.isPrimary) {
    facets.push("primary");
  } else if (!worktree.isPrunable) {
    facets.push("linked");
  }
  if (worktree.isDetached || !worktree.branch) {
    facets.push("detached");
  }
  if (worktree.isLocked) {
    facets.push("locked");
  }
  if (worktree.isPrunable) {
    facets.push("prunable");
  }

  return facets;
}

export function isWorktreeSnapshotDirty(
  snapshot: RepositoryStatusSnapshotDto | undefined
): boolean {
  return Boolean(
    snapshot &&
      (snapshot.staged > 0 ||
        snapshot.unstaged > 0 ||
        snapshot.untracked > 0 ||
        snapshot.conflicted > 0)
  );
}

function worktreeSearchValues(
  worktree: WorkspaceWorktreeDto
): string[] {
  return [
    worktree.name,
    worktree.branch ?? "游离 HEAD",
    worktree.path,
    worktree.head,
    worktreeKindLabel(worktree),
    worktree.isPrunable ? "目录不存在 可清理 失效" : "目录存在",
    worktree.lockReason ?? "",
    worktree.pruneReason ?? ""
  ];
}

export function matchesWorktreeFilters(
  worktree: WorkspaceWorktreeDto,
  snapshot: RepositoryStatusSnapshotDto | undefined,
  filters: WorktreeFilterState
): boolean {
  if (
    filters.repositoryId &&
    worktree.repositoryId !== filters.repositoryId
  ) {
    return false;
  }

  if (
    filters.facet &&
    !worktreeFacetIds(worktree).includes(filters.facet)
  ) {
    return false;
  }

  if (filters.onlyDirty && !isWorktreeSnapshotDirty(snapshot)) {
    return false;
  }

  const query = filters.query.trim().toLocaleLowerCase();
  if (!query) {
    return true;
  }

  return worktreeSearchValues(worktree).some((value) =>
    value.toLocaleLowerCase().includes(query)
  );
}

export function activeWorktreeFilterCount(
  filters: WorktreeFilterState
): number {
  return (
    (filters.facet ? 1 : 0) +
    (filters.onlyDirty ? 1 : 0) +
    (filters.repositoryId ? 1 : 0) +
    (filters.query.trim() ? 1 : 0)
  );
}

export function toggleWorktreeFacet(
  selectedFacet: WorktreeFacet | null,
  facet: WorktreeFacet
): WorktreeFacet | null {
  return selectedFacet === facet ? null : facet;
}
