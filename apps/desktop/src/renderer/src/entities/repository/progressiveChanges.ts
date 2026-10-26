import type {
  ChangedPathDto,
  RepositoryChangesDto,
  RepositoryChangesProgressDto
} from "@gitnest/contracts";

import { repositoryTargetsMatch } from "./changeSelection";

export function applyRepositoryChangesProgress(
  current: RepositoryChangesDto | null,
  progress: RepositoryChangesProgressDto
): RepositoryChangesDto | null {
  const statsProgress = progress.completed < progress.total
    ? { completed: progress.completed, total: progress.total }
    : undefined;
  if (progress.kind === "snapshot") {
    const previous = statsProgress && current
      && repositoryTargetsMatch(current.target, progress.target)
      ? new Map(current.snapshot.changes.map((change) => [change.path, change]))
      : null;
    const snapshot = previous
      ? {
          ...progress.snapshot,
          changes: progress.snapshot.changes.map((change) =>
            retainPendingChangeStats(previous.get(change.path), change)
          )
        }
      : progress.snapshot;
    return { target: progress.target, snapshot, statsProgress };
  }
  if (!current || !repositoryTargetsMatch(current.target, progress.target)) {
    return current;
  }
  const updates = new Map(progress.changes.map((change) => [change.path, change]));
  return {
    ...current,
    statsProgress,
    snapshot: {
      ...current.snapshot,
      changes: current.snapshot.changes.map((change) =>
        updates.get(change.path) ?? change
      )
    }
  };
}

function retainPendingChangeStats(
  previous: ChangedPathDto | undefined,
  change: ChangedPathDto
): ChangedPathDto {
  if (
    !previous || previous.kind !== change.kind
    || previous.originalPath !== change.originalPath
  ) return change;
  // Status arrives before the replacement statistics. Keep the last visible
  // values only for modes that still describe the same changed file.
  return {
    ...change,
    ...(change.stagedStats === undefined && previous.stagedStats
      && change.indexStatus !== "." && change.indexStatus === previous.indexStatus
      ? { stagedStats: previous.stagedStats } : {}),
    ...(change.unstagedStats === undefined && previous.unstagedStats
      && change.worktreeStatus !== "." && change.worktreeStatus === previous.worktreeStatus
      ? { unstagedStats: previous.unstagedStats } : {}),
    ...(change.untrackedStats === undefined && previous.untrackedStats
      && change.kind === "untracked" && change.worktreeStatus === previous.worktreeStatus
      ? { untrackedStats: previous.untrackedStats } : {})
  };
}
