import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  RepositoryChangesDto,
  RepositoryStatusSnapshotDto,
  RepositoryTargetDto,
  WorkspaceDetailsDto
} from "@gitnest/contracts";

import { repositoryTargetsMatch } from "../../entities/repository/changeSelection";
import {
  getSnapshotContentRevision,
  getSnapshotChangeCount,
  listWorkspaceTargets
} from "../../entities/workspace/model";

interface CachedTargetChanges {
  revision: string;
  value: RepositoryChangesDto | null;
}

interface TargetLoadPlan {
  key: string;
  revision: string;
  skipRead: boolean;
  target: RepositoryTargetDto;
}

export interface WorkspaceChangedFilesIndex {
  changes: RepositoryChangesDto[];
  failedTargetCount: number;
  loaded: boolean;
  loading: boolean;
}

const MAX_CONCURRENT_CHANGE_READS = 4;
const CHANGE_PUBLISH_DELAY_MS = 16;
const DISABLED_CHANGED_FILES_INDEX: WorkspaceChangedFilesIndex = {
  changes: [],
  failedTargetCount: 0,
  loaded: false,
  loading: false
};

export function useWorkspaceChangedFiles(
  workspace: WorkspaceDetailsDto | null,
  snapshots: RepositoryStatusSnapshotDto[],
  enabled: boolean
): WorkspaceChangedFilesIndex {
  const [state, setState] =
    useState<WorkspaceChangedFilesIndex & { scopeKey: string }>({
      scopeKey: "",
      changes: [],
      failedTargetCount: 0,
      loaded: false,
      loading: false
    });
  const cacheRef = useRef(
    new Map<string, CachedTargetChanges>()
  );
  const cacheWorkspaceIdRef = useRef("");
  const activeQueriesRef = useRef(new Set<string>());
  const generationRef = useRef(0);
  const sequenceRef = useRef(0);

  const plans = useMemo<TargetLoadPlan[]>(() => {
    if (!enabled || !workspace) {
      return [];
    }

    const snapshotsByRepository = new Map<
      string,
      Map<string, RepositoryStatusSnapshotDto>
    >();
    const repositoriesById = indexFirstByKey(
      workspace.repositories,
      (repository) => repository.id
    );
    const worktreesById = indexFirstByKey(
      workspace.worktrees,
      (worktree) => worktree.id
    );
    for (const snapshot of snapshots) {
      let snapshotsByWorktree = snapshotsByRepository.get(
        snapshot.repositoryId
      );
      if (!snapshotsByWorktree) {
        snapshotsByWorktree = new Map();
        snapshotsByRepository.set(
          snapshot.repositoryId,
          snapshotsByWorktree
        );
      }
      if (!snapshotsByWorktree.has(snapshot.worktreeId)) {
        snapshotsByWorktree.set(snapshot.worktreeId, snapshot);
      }
    }

    return listWorkspaceTargets(workspace).map((target) => {
      const snapshot = snapshotsByRepository
        .get(target.repositoryId)
        ?.get(target.worktreeId);
      const freshAndClean = Boolean(
        snapshot &&
          !snapshot.error &&
          !snapshot.stale &&
          getSnapshotChangeCount(snapshot) === 0
      );

      return {
        key: targetCacheKey(
          workspace,
          target,
          repositoriesById,
          worktreesById
        ),
        revision: getSnapshotContentRevision(snapshot),
        skipRead: freshAndClean,
        target
      };
    });
  }, [enabled, snapshots, workspace]);

  const planSignature = useMemo(
    () =>
      plans
        .map(
          (plan) =>
            `${plan.key}\u0000${plan.revision}\u0000${plan.skipRead}`
        )
        .join("\u0001"),
    [plans]
  );
  const scopeKey =
    enabled && workspace
      ? JSON.stringify([workspace.id, planSignature])
      : "";

  useEffect(() => {
    const generation = ++generationRef.current;
    let active = true;
    let publishTimeoutId: number | undefined;
    let pendingFailedTargetCount = 0;
    const workspaceId = workspace?.id ?? "";

    cancelActiveQueries(activeQueriesRef.current);

    if (cacheWorkspaceIdRef.current !== workspaceId) {
      cacheWorkspaceIdRef.current = workspaceId;
      cacheRef.current.clear();
    }

    const clearScheduledPublish = () => {
      if (publishTimeoutId !== undefined) {
        window.clearTimeout(publishTimeoutId);
        publishTimeoutId = undefined;
      }
    };
    const cleanup = () => {
      active = false;
      clearScheduledPublish();
      cancelActiveQueries(activeQueriesRef.current);
    };

    if (!enabled || !workspace) {
      return cleanup;
    }

    const desiredKeys = new Set(plans.map((plan) => plan.key));
    for (const key of cacheRef.current.keys()) {
      if (!desiredKeys.has(key)) {
        cacheRef.current.delete(key);
      }
    }

    for (const plan of plans) {
      if (plan.skipRead) {
        cacheRef.current.set(plan.key, {
          revision: plan.revision,
          value: null
        });
      }
    }

    const pendingPlans = plans.filter((plan) => {
      if (plan.skipRead) {
        return false;
      }
      const cached = cacheRef.current.get(plan.key);
      return (
        cached?.revision !== plan.revision ||
        cached.value === null
      );
    });
    const publish = (
      loading: boolean,
      failedTargetCount: number
    ) => {
      if (
        !active ||
        generationRef.current !== generation
      ) {
        return;
      }
      setState({
        scopeKey,
        changes: plans.flatMap((plan) => {
          const cached = cacheRef.current.get(plan.key);
          return cached?.value
            ? [cached.value]
            : [];
        }),
        failedTargetCount,
        loaded: plans.every((plan) => cacheRef.current.has(plan.key)),
        loading
      });
    };
    const schedulePartialPublish = (
      failedTargetCount: number
    ) => {
      pendingFailedTargetCount = failedTargetCount;
      if (publishTimeoutId !== undefined) {
        return;
      }
      publishTimeoutId = window.setTimeout(() => {
        publishTimeoutId = undefined;
        publish(true, pendingFailedTargetCount);
      }, CHANGE_PUBLISH_DELAY_MS);
    };

    if (pendingPlans.length === 0) {
      publish(false, 0);
      return cleanup;
    }

    let cursor = 0;
    let failedTargetCount = 0;
    publish(true, 0);

    const worker = async () => {
      while (
        active &&
        generationRef.current === generation
      ) {
        const plan = pendingPlans[cursor];
        cursor += 1;
        if (!plan) {
          return;
        }

        const queryId = `global_changes_${Date.now()}_${++sequenceRef.current}`;
        activeQueriesRef.current.add(queryId);

        try {
          const result =
            await window.gitnest.repository.getChanges({
              queryId,
              target: plan.target,
              includeChangeStats: false
            });

          if (
            !active ||
            generationRef.current !== generation
          ) {
            return;
          }

          if (
            result.ok &&
            repositoryTargetsMatch(
              result.value.target,
              plan.target
            )
          ) {
            cacheRef.current.set(plan.key, {
              revision: plan.revision,
              value: result.value
            });
          } else if (
            !result.ok &&
            result.error.code === "COMMAND_CANCELLED"
          ) {
            continue;
          } else {
            failedTargetCount += 1;
          }
          schedulePartialPublish(failedTargetCount);
        } catch {
          if (
            active &&
            generationRef.current === generation
          ) {
            failedTargetCount += 1;
            schedulePartialPublish(failedTargetCount);
          }
        } finally {
          activeQueriesRef.current.delete(queryId);
        }
      }
    };

    void Promise.all(
      Array.from(
        {
          length: Math.min(
            MAX_CONCURRENT_CHANGE_READS,
            pendingPlans.length
          )
        },
        () => worker()
      )
    ).then(() => {
      clearScheduledPublish();
      publish(false, failedTargetCount);
    });

    return cleanup;
  }, [enabled, planSignature, workspace?.id]);

  if (!enabled || !workspace) {
    return DISABLED_CHANGED_FILES_INDEX;
  }

  return state.scopeKey === scopeKey
    ? state
    : {
        changes: cacheWorkspaceIdRef.current === (workspace?.id ?? "")
          ? plans.flatMap((plan) => {
              const cached = cacheRef.current.get(plan.key);
              return !plan.skipRead && cached?.value ? [cached.value] : [];
            })
          : [],
        failedTargetCount: 0,
        loaded: cacheWorkspaceIdRef.current === (workspace?.id ?? "") &&
          plans.every((plan) => plan.skipRead || cacheRef.current.has(plan.key)),
        loading: true
      };
}

function targetCacheKey(
  workspace: WorkspaceDetailsDto,
  target: RepositoryTargetDto,
  repositoriesById: ReadonlyMap<
    string,
    WorkspaceDetailsDto["repositories"][number]
  >,
  worktreesById: ReadonlyMap<
    string,
    WorkspaceDetailsDto["worktrees"][number]
  >
): string {
  const repository = repositoriesById.get(target.repositoryId);
  const worktree = worktreesById.get(target.worktreeId);
  return JSON.stringify([
    workspace.id,
    workspace.canonicalPath ?? workspace.path,
    target.repositoryId,
    target.worktreeId,
    repository?.canonicalCommonDir ?? repository?.commonDir ?? "",
    worktree?.canonicalPath ?? worktree?.path ?? ""
  ]);
}

function indexFirstByKey<Value>(
  values: readonly Value[],
  getKey: (value: Value) => string
): Map<string, Value> {
  const indexed = new Map<string, Value>();
  for (const value of values) {
    const key = getKey(value);
    if (!indexed.has(key)) {
      indexed.set(key, value);
    }
  }
  return indexed;
}

function cancelActiveQueries(queryIds: Set<string>) {
  for (const queryId of queryIds) {
    void window.gitnest.repository.cancelQuery({ queryId });
  }
  queryIds.clear();
}
