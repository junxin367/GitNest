import type {
  RepositoryStatusSnapshotDto,
  RepositoryTargetDto,
  WorkspaceDetailsDto,
  WorkspaceEntryDto,
  WorkspaceErrorDto
} from "@gitnest/contracts";

export const WORKSPACE_ENTRY_LABELS = {
  "workspace-meta-repository": "Workspace 元仓库",
  "workspace-directory": "Workspace 目录",
  "standalone-repository": "普通仓库"
} as const;

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

export function getEntryRepositoryCount(
  entry: WorkspaceEntryDto
): number {
  const targets = [
    ...entry.groups.flatMap((group) => group.targets),
    ...(entry.kind === "workspace-meta-repository"
      ? [entry.rootTarget]
      : entry.kind === "standalone-repository"
        ? [entry.target]
        : [])
  ];

  return new Set(
    targets.map((target) => target.repositoryId)
  ).size;
}

export function getWorkspaceTargetCount(
  workspace: WorkspaceDetailsDto
): number {
  return listWorkspaceTargets(workspace).length;
}

export function listWorkspaceTargets(
  workspace: WorkspaceDetailsDto
): RepositoryTargetDto[] {
  const targets = workspace.entries.flatMap((entry) => [
    ...entry.groups.flatMap((group) => group.targets),
    ...(entry.kind === "workspace-meta-repository"
      ? [entry.rootTarget]
      : entry.kind === "standalone-repository"
        ? [entry.target]
        : [])
  ]);

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
