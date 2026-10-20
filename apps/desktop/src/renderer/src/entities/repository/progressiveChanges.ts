import type {
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
    return { target: progress.target, snapshot: progress.snapshot, statsProgress };
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
