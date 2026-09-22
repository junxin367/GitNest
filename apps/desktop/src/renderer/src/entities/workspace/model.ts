import type {
  RepositoryStatusSnapshotDto,
  RepositoryTargetDto,
  WorkspaceDetailsDto,
  WorkspaceErrorDto
} from "@gitnest/contracts";

export function resolveWorkspaceTarget(
  workspace: WorkspaceDetailsDto,
  target: RepositoryTargetDto
) {
  return {
    repository: workspace.repositories.find(
      (repository) => repository.id === target.repositoryId
    ),
    worktree: workspace.worktrees.find(
      (worktree) => worktree.id === target.worktreeId
    )
  };
}

export function findTargetSnapshot(
  snapshots: RepositoryStatusSnapshotDto[],
  target: RepositoryTargetDto | undefined
): RepositoryStatusSnapshotDto | undefined {
  return target
    ? snapshots.find(
        (snapshot) =>
          snapshot.repositoryId === target.repositoryId &&
          snapshot.worktreeId === target.worktreeId
      )
    : undefined;
}

export function filterSnapshotsToTargets(
  snapshots: RepositoryStatusSnapshotDto[],
  targets: RepositoryTargetDto[]
): RepositoryStatusSnapshotDto[] {
  const targetKeys = new Set(
    targets.map(
      (target) => `${target.repositoryId}:${target.worktreeId}`
    )
  );

  return snapshots.filter((snapshot) =>
    targetKeys.has(
      `${snapshot.repositoryId}:${snapshot.worktreeId}`
    )
  );
}

export function repositoryTargetSelected(
  selected: RepositoryTargetDto | undefined,
  target: RepositoryTargetDto
): boolean {
  return Boolean(
    selected &&
      selected.repositoryId === target.repositoryId &&
      selected.worktreeId === target.worktreeId
  );
}

export function getSnapshotChangeCount(
  snapshot: RepositoryStatusSnapshotDto | undefined
): number {
  return snapshot
    ? snapshot.staged +
        snapshot.unstaged +
        snapshot.untracked +
        snapshot.conflicted
    : 0;
}

export function getSnapshotContentRevision(
  snapshot: RepositoryStatusSnapshotDto | undefined
): string {
  if (!snapshot) {
    return "missing";
  }

  return [
    snapshot.contentVersion ?? snapshot.refreshedAt,
    snapshot.head,
    snapshot.branch ?? "",
    snapshot.upstream ?? "",
    snapshot.ahead,
    snapshot.behind,
    snapshot.staged,
    snapshot.unstaged,
    snapshot.untracked,
    snapshot.conflicted,
    snapshot.operationState ?? "",
    snapshot.error?.code ?? "",
    snapshot.error?.message ?? ""
  ].join("|");
}

export function listWorkspaceTargets(
  workspace: WorkspaceDetailsDto | null
): RepositoryTargetDto[] {
  if (!workspace) {
    return [];
  }
  const targets = workspace.groups.flatMap(
    (group) => group.targets
  );

  return [
    ...new Map(
      targets.map((target) => [
        `${target.repositoryId}:${target.worktreeId}`,
        target
      ])
    ).values()
  ];
}

export function isWorkspaceDataBlocked(
  workspace: WorkspaceDetailsDto | null,
  error: WorkspaceErrorDto | null,
  operation: string | null
): boolean {
  return !workspace && Boolean(error) && operation !== "loading";
}
