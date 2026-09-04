import type {
  RepositoryTarget,
  Workspace,
  WorkspaceEntry
} from "../domain/workspace";

export function repositoryTargetKey(
  target: RepositoryTarget
): string {
  return `${target.repositoryId}:${target.worktreeId}`;
}

export function repositoryTargetsEqual(
  left: RepositoryTarget | undefined,
  right: RepositoryTarget | undefined
): boolean {
  return Boolean(
    left &&
      right &&
      left.repositoryId === right.repositoryId &&
      left.worktreeId === right.worktreeId
  );
}

export function listEntryTargets(
  entry: WorkspaceEntry
): RepositoryTarget[] {
  return [
    ...(entry.kind === "workspace-meta-repository"
      ? [entry.rootTarget]
      : entry.kind === "standalone-repository"
        ? [entry.target]
        : []),
    ...entry.groups.flatMap((group) => group.targets)
  ];
}

export function listWorkspaceTargets(
  workspace: Workspace
): RepositoryTarget[] {
  const targets = new Map<string, RepositoryTarget>();

  for (const entry of workspace.entries) {
    for (const target of listEntryTargets(entry)) {
      targets.set(repositoryTargetKey(target), target);
    }
  }

  return [...targets.values()];
}

export function getEntryDefaultTarget(
  entry: WorkspaceEntry | undefined
): RepositoryTarget | undefined {
  return entry ? listEntryTargets(entry)[0] : undefined;
}

export function findTargetEntry(
  workspace: Workspace,
  target: RepositoryTarget
): WorkspaceEntry | undefined {
  const key = repositoryTargetKey(target);
  return workspace.entries.find((entry) =>
    listEntryTargets(entry).some(
      (candidate) => repositoryTargetKey(candidate) === key
    )
  );
}
