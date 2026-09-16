import type {
  ChangedPathDto,
  RepositoryChangesDto,
  RepositoryDiffRequest,
  RepositoryTargetDto
} from "@gitnest/contracts";

export type RepositoryChangeMode =
  RepositoryDiffRequest["mode"];

export interface RepositoryChangeLocation {
  target: RepositoryTargetDto;
  path: string;
  mode: RepositoryChangeMode;
}

export interface RepositoryChangeSelectionRequest
  extends RepositoryChangeLocation {
  id: number;
}

export function repositoryTargetsMatch(
  left: RepositoryTargetDto | undefined,
  right: RepositoryTargetDto | undefined
): boolean {
  return Boolean(
    left &&
      right &&
      left.repositoryId === right.repositoryId &&
      left.worktreeId === right.worktreeId
  );
}

export function findRequestedRepositoryChange(
  changes: RepositoryChangesDto,
  request: RepositoryChangeSelectionRequest
): ChangedPathDto | undefined {
  if (!repositoryTargetsMatch(changes.target, request.target)) {
    return undefined;
  }

  return changes.snapshot.changes.find(
    (change) => change.path === request.path
  );
}

export function changeSupportsMode(
  change: ChangedPathDto,
  mode: RepositoryChangeMode
): boolean {
  if (mode === "untracked") {
    return change.kind === "untracked";
  }
  if (change.kind === "untracked") {
    return false;
  }
  return mode === "staged"
    ? change.indexStatus !== "."
    : change.worktreeStatus !== ".";
}
