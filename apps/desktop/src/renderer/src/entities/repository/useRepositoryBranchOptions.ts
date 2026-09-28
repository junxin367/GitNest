import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  BranchDto,
  GitReadErrorDto,
  RepositoryTargetDto
} from "@gitnest/contracts";

export interface RepositoryBranchOptionsController {
  branches: BranchDto[];
  loading: boolean;
  error: GitReadErrorDto | null;
  reload(): Promise<void>;
}

export function useRepositoryBranchOptions(
  target: RepositoryTargetDto | undefined,
  enabled: boolean
): RepositoryBranchOptionsController {
  const stableTarget = useMemo(
    () =>
      target
        ? {
            repositoryId: target.repositoryId,
            worktreeId: target.worktreeId
          }
        : undefined,
    [target?.repositoryId, target?.worktreeId]
  );
  const targetKey = stableTarget
    ? `${stableTarget.repositoryId}:${stableTarget.worktreeId}`
    : "";
  const [branches, setBranches] = useState<BranchDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] =
    useState<GitReadErrorDto | null>(null);
  const activeQuery = useRef<string | null>(null);
  const sequence = useRef(0);
  const generation = useRef(0);

  const cancel = useCallback(() => {
    if (activeQuery.current) {
      void window.gitnest.repository.cancelQuery({
        queryId: activeQuery.current
      });
      activeQuery.current = null;
    }
  }, []);

  const reload = useCallback(async () => {
    if (!enabled || !stableTarget) {
      return;
    }

    cancel();
    const queryId = `header_branches_${Date.now()}_${++sequence.current}`;
    const requestGeneration = generation.current;
    activeQuery.current = queryId;
    setLoading(true);
    setError(null);

    try {
      const result = await window.gitnest.repository.getBranches({
        queryId,
        target: stableTarget
      });
      if (
        requestGeneration !== generation.current ||
        activeQuery.current !== queryId
      ) {
        return;
      }
      if (result.ok) {
        setBranches(
          result.value.branches.filter(
            (branch) => !branch.remote
          )
        );
      } else if (result.error.code !== "COMMAND_CANCELLED") {
        setError(result.error);
      }
    } catch (reason) {
      if (
        requestGeneration === generation.current &&
        activeQuery.current === queryId
      ) {
        setError({
          code: "COMMAND_FAILED",
          message:
            reason instanceof Error
              ? reason.message
              : "分支列表读取失败。",
          details: {}
        });
      }
    } finally {
      if (
        requestGeneration === generation.current &&
        activeQuery.current === queryId
      ) {
        activeQuery.current = null;
        setLoading(false);
      }
    }
  }, [cancel, enabled, stableTarget]);

  useEffect(() => {
    generation.current += 1;
    cancel();
    setBranches([]);
    setError(null);
    setLoading(false);
    if (enabled && stableTarget) {
      void reload();
    }

    return () => {
      generation.current += 1;
      cancel();
    };
  }, [cancel, enabled, reload, targetKey]);

  return {
    branches,
    loading,
    error,
    reload
  };
}
