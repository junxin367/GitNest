import type {
  RepositoryStatusSnapshotDto,
  WorktreeCommandDto,
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

export type WorktreeDeleteCommand = Extract<
  WorktreeCommandDto,
  { type: "prune" | "remove" }
>;

export interface WorktreeDeletePlan {
  mode: WorktreeDeleteCommand["type"] | null;
  commands: WorktreeDeleteCommand[];
  eligibleCount: number;
  blocked: {
    bare: number;
    dirty: number;
    locked: number;
    primary: number;
    unavailable: number;
  };
}

export type WorktreeStatusTone =
  | "green"
  | "neutral"
  | "red"
  | "yellow";

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
  return worktreeStatusLabel(worktree);
}

export function worktreeStatusLabel(
  worktree: WorkspaceWorktreeDto
): string {
  if (worktree.isPrunable) {
    return "可清理登记";
  }
  if (worktree.isBare) {
    return "裸仓库";
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

export function worktreeStatusTone(
  worktree: WorkspaceWorktreeDto
): WorktreeStatusTone {
  if (worktree.isPrunable) {
    return "red";
  }
  if (worktree.isBare) {
    return "neutral";
  }
  if (worktree.isPrimary) {
    return "green";
  }
  if (worktree.isLocked || worktree.isDetached || !worktree.branch) {
    return "yellow";
  }
  return "neutral";
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

export function isWorktreeSnapshotReadyForDelete(
  snapshot: RepositoryStatusSnapshotDto | undefined
): snapshot is RepositoryStatusSnapshotDto {
  return Boolean(
    snapshot &&
      !snapshot.stale &&
      !snapshot.refreshPending &&
      !snapshot.error &&
      !snapshot.operationState
  );
}

export function buildWorktreeDeletePlan(
  worktrees: readonly WorkspaceWorktreeDto[],
  snapshotFor: (
    worktree: WorkspaceWorktreeDto
  ) => RepositoryStatusSnapshotDto | undefined,
  facet: WorktreeFacet | null
): WorktreeDeletePlan {
  const blocked = {
    bare: 0,
    dirty: 0,
    locked: 0,
    primary: 0,
    unavailable: 0
  };

  if (!facet) {
    return {
      mode: null,
      commands: [],
      eligibleCount: 0,
      blocked
    };
  }

  if (facet === "prunable") {
    const repositoryIds = new Set<string>();
    let eligibleCount = 0;

    for (const worktree of worktrees) {
      if (worktree.isBare) {
        blocked.bare += 1;
        continue;
      }
      if (worktree.isPrimary) {
        blocked.primary += 1;
        continue;
      }
      if (worktree.isLocked) {
        blocked.locked += 1;
        continue;
      }
      if (!worktree.isPrunable) {
        blocked.unavailable += 1;
        continue;
      }
      eligibleCount += 1;
      repositoryIds.add(worktree.repositoryId);
    }

    return {
      mode: "prune",
      commands: [...repositoryIds].map((repositoryId) => ({
        type: "prune",
        repositoryId
      })),
      eligibleCount,
      blocked
    };
  }

  const commands: WorktreeDeleteCommand[] = [];
  for (const worktree of worktrees) {
    if (worktree.isBare) {
      blocked.bare += 1;
      continue;
    }
    if (worktree.isPrimary) {
      blocked.primary += 1;
      continue;
    }
    const snapshot = snapshotFor(worktree);
    if (!isWorktreeSnapshotReadyForDelete(snapshot)) {
      blocked.unavailable += 1;
      continue;
    }
    if (isWorktreeSnapshotDirty(snapshot)) {
      blocked.dirty += 1;
      continue;
    }
    if (worktree.isLocked) {
      blocked.locked += 1;
      continue;
    }
    if (worktree.isPrunable) {
      blocked.unavailable += 1;
      continue;
    }
    commands.push({
      type: "remove",
      worktreeId: worktree.id
    });
  }

  return {
    mode: "remove",
    commands,
    eligibleCount: commands.length,
    blocked
  };
}

export function worktreeDeleteActionTitle(
  plan: WorktreeDeletePlan,
  facet: WorktreeFacet | null,
  busy: boolean
): string {
  if (busy) {
    return "已有 Worktree 操作正在处理";
  }
  if (!facet) {
    return "选择 Worktree 类型后可删除";
  }
  if (facet === "primary") {
    if (plan.blocked.bare > 0 && plan.blocked.primary > 0) {
      return "主工作目录和裸仓库不能删除";
    }
    if (plan.blocked.bare > 0) {
      return "裸仓库没有可删除的 Worktree 工作目录";
    }
    return "主工作目录不能删除";
  }
  if (plan.mode === "prune") {
    if (plan.commands.length === 0) {
      return plan.blocked.locked > 0
        ? "锁定的失效登记需先解锁后才能清除"
        : "当前范围没有可安全清除的失效登记";
    }
    return `当前筛选命中 ${plan.eligibleCount} 条失效登记；清除将按 ${plan.commands.length} 个仓库执行，并以预检范围为准；不会删除目录`;
  }
  if (plan.commands.length > 0) {
    const blockedCount =
      plan.blocked.bare +
      plan.blocked.dirty +
      plan.blocked.locked +
      plan.blocked.primary +
      plan.blocked.unavailable;
    return `将先预检，再删除当前筛选中的 ${plan.eligibleCount} 个干净 Worktree 目录与 Git 登记${
      blockedCount > 0 ? "；不符合安全条件的项会保留" : ""
    }`;
  }
  if (plan.blocked.dirty > 0) {
    return "有变更的 Worktree 不能删除";
  }
  if (plan.blocked.bare > 0) {
    return "裸仓库没有可删除的 Worktree 工作目录";
  }
  if (plan.blocked.locked > 0) {
    return "锁定 Worktree 需先解锁后才能删除";
  }
  if (plan.blocked.primary > 0) {
    return "主工作目录不能删除";
  }
  if (plan.blocked.unavailable > 0) {
    return "Worktree 状态未就绪、正在刷新或登记已失效，暂不能删除";
  }
  return "当前筛选没有可删除的 Worktree";
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
