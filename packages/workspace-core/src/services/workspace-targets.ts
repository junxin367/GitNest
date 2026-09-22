import type {
  RepositoryTarget,
  Workspace
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

export function listWorkspaceTargets(
  workspace: Workspace
): RepositoryTarget[] {
  const targets = workspace.groups.flatMap(
    (group) => group.targets
  );
  const uniqueTargets = new Map<string, RepositoryTarget>();

  for (const target of targets) {
    const key = repositoryTargetKey(target);
    if (!uniqueTargets.has(key)) {
      uniqueTargets.set(key, target);
    }
  }

  return [...uniqueTargets.values()];
}

export function getWorkspaceDefaultTarget(
  workspace: Workspace
): RepositoryTarget | undefined {
  return listWorkspaceTargets(workspace)[0];
}
