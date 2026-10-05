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
  hasLoaded: boolean;
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
  const [dataTargetKey, setDataTargetKey] = useState(targetKey);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [requestTargetKey, setRequestTargetKey] = useState("");
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
        setHasLoaded(true);
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
    setDataTargetKey(targetKey);
    setBranches([]);
    setHasLoaded(false);
    setError(null);
  }, [targetKey]);

  useEffect(() => {
    generation.current += 1;
    cancel();
    setRequestTargetKey(enabled ? targetKey : "");
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

  const currentTarget = dataTargetKey === targetKey;
  return {
    branches: currentTarget ? branches : [],
    hasLoaded: currentTarget && hasLoaded,
    loading: Boolean(enabled && stableTarget) &&
      (requestTargetKey !== targetKey || !currentTarget || loading),
    error: currentTarget ? error : null,
    reload
  };
}
