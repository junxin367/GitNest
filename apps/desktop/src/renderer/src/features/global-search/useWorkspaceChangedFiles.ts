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
  findTargetSnapshot,
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
  loading: boolean;
}

const MAX_CONCURRENT_CHANGE_READS = 4;

export function useWorkspaceChangedFiles(
  workspace: WorkspaceDetailsDto | null,
  snapshots: RepositoryStatusSnapshotDto[],
  enabled: boolean
): WorkspaceChangedFilesIndex {
  const [state, setState] =
    useState<WorkspaceChangedFilesIndex>({
      changes: [],
      failedTargetCount: 0,
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
    if (!workspace) {
      return [];
    }

    return listWorkspaceTargets(workspace).map((target) => {
      const snapshot = findTargetSnapshot(snapshots, target);
      const freshAndClean = Boolean(
        snapshot &&
          !snapshot.error &&
          !snapshot.refreshPending &&
          !snapshot.stale &&
          getSnapshotChangeCount(snapshot) === 0
      );

      return {
        key: targetKey(target),
        revision: statusRevision(snapshot),
        skipRead: freshAndClean,
        target
      };
    });
  }, [snapshots, workspace]);

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

  useEffect(() => {
    const generation = ++generationRef.current;
    let active = true;
    const workspaceId = workspace?.id ?? "";

    cancelActiveQueries(activeQueriesRef.current);

    if (cacheWorkspaceIdRef.current !== workspaceId) {
      cacheWorkspaceIdRef.current = workspaceId;
      cacheRef.current.clear();
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
      return (
        cacheRef.current.get(plan.key)?.revision !==
        plan.revision
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
        changes: plans.flatMap((plan) => {
          const cached = cacheRef.current.get(plan.key);
          return cached?.revision === plan.revision &&
            cached.value
            ? [cached.value]
            : [];
        }),
        failedTargetCount,
        loading
      });
    };

    if (!enabled || !workspace || pendingPlans.length === 0) {
      publish(false, 0);
      return () => {
        active = false;
        cancelActiveQueries(activeQueriesRef.current);
      };
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
              target: plan.target
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
          publish(true, failedTargetCount);
        } catch {
          if (
            active &&
            generationRef.current === generation
          ) {
            failedTargetCount += 1;
            publish(true, failedTargetCount);
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
    ).then(() => publish(false, failedTargetCount));

    return () => {
      active = false;
      cancelActiveQueries(activeQueriesRef.current);
    };
  }, [enabled, planSignature, plans, workspace?.id]);

  return state;
}

function targetKey(target: RepositoryTargetDto): string {
  return `${target.repositoryId}:${target.worktreeId}`;
}

function statusRevision(
  snapshot: RepositoryStatusSnapshotDto | undefined
): string {
  if (!snapshot) {
    return "missing";
  }

  return [
    snapshot.refreshedAt,
    snapshot.head,
    snapshot.branch ?? "",
    snapshot.staged,
    snapshot.unstaged,
    snapshot.untracked,
    snapshot.conflicted,
    snapshot.refreshPending,
    snapshot.stale,
    snapshot.error?.code ?? "",
    snapshot.error?.message ?? ""
  ].join("|");
}

function cancelActiveQueries(queryIds: Set<string>) {
  for (const queryId of queryIds) {
    void window.gitnest.repository.cancelQuery({ queryId });
  }
  queryIds.clear();
}
