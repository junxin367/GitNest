import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  GitReadErrorDto,
  RepositoryCommitDiffDto,
  RepositoryTargetDto
} from "@gitnest/contracts";

const DEFAULT_CONTEXT_LINES = 3;

interface CommitDiffSelection {
  path: string;
  contextLines: number;
}

interface CommitDiffState {
  scopeKey: string;
  diff: RepositoryCommitDiffDto | null;
  selected: CommitDiffSelection | null;
  loading: boolean;
  error: GitReadErrorDto | null;
}

interface SelectCommitFileOptions {
  contextLines?: number;
  preserveDiff?: boolean;
}

export interface RepositoryCommitDiffController {
  diff: RepositoryCommitDiffDto | null;
  selected: CommitDiffSelection | null;
  loading: boolean;
  error: GitReadErrorDto | null;
  selectFile(
    path: string,
    options?: SelectCommitFileOptions
  ): Promise<void>;
  clearError(): void;
}

export function useRepositoryCommitDiff(
  target: RepositoryTargetDto | undefined,
  commitHash: string | undefined
): RepositoryCommitDiffController {
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
  const scopeKey =
    stableTarget && commitHash
      ? `${stableTarget.repositoryId}:${stableTarget.worktreeId}:${commitHash}`
      : "";
  const [state, setState] = useState<CommitDiffState>(() =>
    createEmptyState(scopeKey)
  );
  const stateRef = useRef(state);
  const activeQueryRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const sequenceRef = useRef(0);

  const cancelActiveQuery = useCallback(() => {
    const queryId = activeQueryRef.current;
    if (!queryId) {
      return;
    }
    activeQueryRef.current = null;
    void window.gitnest.repository.cancelQuery({ queryId });
  }, []);

  const setScopedState = useCallback(
    (
      updater: (
        current: CommitDiffState
      ) => CommitDiffState
    ) => {
      setState((current) => {
        if (current.scopeKey !== scopeKey) {
          return current;
        }
        const next = updater(current);
        stateRef.current = next;
        return next;
      });
    },
    [scopeKey]
  );

  const selectFile = useCallback(
    async (
      path: string,
      options: SelectCommitFileOptions = {}
    ) => {
      if (!stableTarget || !commitHash || !path) {
        return;
      }

      const contextLines =
        options.contextLines ?? DEFAULT_CONTEXT_LINES;
      const current =
        stateRef.current.scopeKey === scopeKey
          ? stateRef.current
          : createEmptyState(scopeKey);
      const currentMatches =
        current.diff?.commit.hash === commitHash &&
        current.diff.diff.path === path;
      if (
        currentMatches &&
        current.selected?.path === path &&
        current.selected.contextLines >= contextLines &&
        !current.loading &&
        !current.error
      ) {
        return;
      }

      cancelActiveQuery();
      const queryId = `commit_diff_${Date.now()}_${++sequenceRef.current}`;
      const requestGeneration = generationRef.current;
      activeQueryRef.current = queryId;
      const nextState: CommitDiffState = {
        scopeKey,
        diff:
          options.preserveDiff && currentMatches
            ? current.diff
            : null,
        selected: {
          path,
          contextLines
        },
        loading: true,
        error: null
      };
      stateRef.current = nextState;
      setState(nextState);

      try {
        const result =
          await window.gitnest.repository.getCommitDiff({
            queryId,
            target: stableTarget,
            commitHash,
            path,
            contextLines
          });
        if (
          requestGeneration !== generationRef.current ||
          activeQueryRef.current !== queryId
        ) {
          return;
        }

        if (result.ok) {
          const responseMatches =
            targetsMatch(result.value.target, stableTarget) &&
            result.value.commit.hash === commitHash &&
            result.value.diff.path === path;
          if (!responseMatches) {
            setScopedState((latest) => ({
              ...latest,
              diff: null,
              error: {
                code: "COMMAND_FAILED",
                message:
                  "提交文件 Diff 已过期，请重新选择该文件。",
                details: {}
              }
            }));
          } else {
            setScopedState((latest) => ({
              ...latest,
              diff: result.value,
              error: null
            }));
          }
        } else if (result.error.code !== "COMMAND_CANCELLED") {
          setScopedState((latest) => ({
            ...latest,
            error: result.error
          }));
        }
      } catch (reason) {
        if (
          requestGeneration === generationRef.current &&
          activeQueryRef.current === queryId
        ) {
          setScopedState((latest) => ({
            ...latest,
            error: unexpectedError(reason)
          }));
        }
      } finally {
        if (
          requestGeneration === generationRef.current &&
          activeQueryRef.current === queryId
        ) {
          activeQueryRef.current = null;
          setScopedState((latest) => ({
            ...latest,
            loading: false
          }));
        }
      }
    },
    [
      cancelActiveQuery,
      commitHash,
      scopeKey,
      setScopedState,
      stableTarget
    ]
  );

  const clearError = useCallback(() => {
    setScopedState((current) => ({
      ...current,
      error: null
    }));
  }, [setScopedState]);

  useEffect(() => {
    generationRef.current += 1;
    cancelActiveQuery();
    const next = createEmptyState(scopeKey);
    stateRef.current = next;
    setState(next);
  }, [cancelActiveQuery, scopeKey]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      cancelActiveQuery();
    },
    [cancelActiveQuery]
  );

  const visibleState =
    state.scopeKey === scopeKey
      ? state
      : createEmptyState(scopeKey);
  return {
    diff: visibleState.diff,
    selected: visibleState.selected,
    loading: visibleState.loading,
    error: visibleState.error,
    selectFile,
    clearError
  };
}

function createEmptyState(scopeKey: string): CommitDiffState {
  return {
    scopeKey,
    diff: null,
    selected: null,
    loading: false,
    error: null
  };
}

function targetsMatch(
  left: RepositoryTargetDto,
  right: RepositoryTargetDto
): boolean {
  return (
    left.repositoryId === right.repositoryId &&
    left.worktreeId === right.worktreeId
  );
}

function unexpectedError(reason: unknown): GitReadErrorDto {
  return {
    code: "COMMAND_FAILED",
    message:
      reason instanceof Error
        ? reason.message
        : "提交文件 Diff 读取失败。",
    details: {}
  };
}
