import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  ChangedPathDto,
  GitReadErrorDto,
  RepositoryBranchesDto,
  RepositoryChangesDto,
  RepositoryCommitDto,
  RepositoryDiffDto,
  RepositoryHistoryPageDto,
  RepositoryTargetDto
} from "@gitnest/contracts";

import type { RepositoryTab } from "../../app/navigation";

type LoadingKey =
  | "changes"
  | "diff"
  | "history"
  | "commit"
  | "branches";

export interface RepositoryDetailsController {
  changes: RepositoryChangesDto | null;
  diff: RepositoryDiffDto | null;
  history: RepositoryHistoryPageDto | null;
  commit: RepositoryCommitDto | null;
  branches: RepositoryBranchesDto | null;
  selectedChange: {
    path: string;
    mode: "unstaged" | "staged" | "untracked";
  } | null;
  selectedCommitHash: string | null;
  loading: Readonly<Record<LoadingKey, boolean>>;
  error: GitReadErrorDto | null;
  selectChange(
    change: ChangedPathDto,
    mode?: "unstaged" | "staged" | "untracked"
  ): Promise<void>;
  selectCommit(commitHash: string): Promise<void>;
  loadMoreHistory(): Promise<void>;
  reload(tab: RepositoryTab): Promise<void>;
  invalidate(): void;
}

const EMPTY_LOADING: Record<LoadingKey, boolean> = {
  changes: false,
  diff: false,
  history: false,
  commit: false,
  branches: false
};

export function useRepositoryDetails(
  target: RepositoryTargetDto | undefined,
  tab: RepositoryTab
): RepositoryDetailsController {
  const targetKey = target
    ? `${target.repositoryId}:${target.worktreeId}`
    : "";
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
  const [changes, setChanges] =
    useState<RepositoryChangesDto | null>(null);
  const [diff, setDiff] =
    useState<RepositoryDiffDto | null>(null);
  const [history, setHistory] =
    useState<RepositoryHistoryPageDto | null>(null);
  const [commit, setCommit] =
    useState<RepositoryCommitDto | null>(null);
  const [branches, setBranches] =
    useState<RepositoryBranchesDto | null>(null);
  const [selectedChange, setSelectedChange] =
    useState<RepositoryDetailsController["selectedChange"]>(null);
  const [selectedCommitHash, setSelectedCommitHash] =
    useState<string | null>(null);
  const [loading, setLoading] =
    useState<Record<LoadingKey, boolean>>(EMPTY_LOADING);
  const [error, setError] =
    useState<GitReadErrorDto | null>(null);
  const activeQueries = useRef(new Map<LoadingKey, string>());
  const sequence = useRef(0);
  const generation = useRef(0);

  const cancelAll = useCallback(() => {
    for (const queryId of activeQueries.current.values()) {
      void window.gitnest.repository.cancelQuery({ queryId });
    }
    activeQueries.current.clear();
  }, []);

  const cancelQuery = useCallback((key: LoadingKey) => {
    const queryId = activeQueries.current.get(key);

    if (queryId) {
      void window.gitnest.repository.cancelQuery({ queryId });
      activeQueries.current.delete(key);
    }
  }, []);

  const createQuery = useCallback(
    (key: LoadingKey) => {
      cancelQuery(key);
      const queryId = `${key}_${Date.now()}_${++sequence.current}`;
      activeQueries.current.set(key, queryId);
      return queryId;
    },
    [cancelQuery]
  );

  const isCurrentQuery = useCallback(
    (
      key: LoadingKey,
      queryId: string,
      requestGeneration: number
    ) =>
      requestGeneration === generation.current &&
      activeQueries.current.get(key) === queryId,
    []
  );

  const finishQuery = useCallback(
    (key: LoadingKey, queryId: string): boolean => {
      if (activeQueries.current.get(key) !== queryId) {
        return false;
      }

      activeQueries.current.delete(key);
      return true;
    },
    []
  );

  const setLoadingKey = useCallback(
    (key: LoadingKey, value: boolean) => {
      setLoading((current) => ({
        ...current,
        [key]: value
      }));
    },
    []
  );

  const selectChange = useCallback(
    async (
      change: ChangedPathDto,
      requestedMode?: "unstaged" | "staged" | "untracked"
    ) => {
      if (!stableTarget) {
        return;
      }

      const mode = requestedMode ?? preferredDiffMode(change);
      const queryId = createQuery("diff");
      const requestGeneration = generation.current;
      setSelectedChange({ path: change.path, mode });
      setDiff(null);
      setLoadingKey("diff", true);
      setError(null);

      try {
        const result = await window.gitnest.repository.getDiff({
          queryId,
          target: stableTarget,
          path: change.path,
          mode
        });

        if (
          !isCurrentQuery(
            "diff",
            queryId,
            requestGeneration
          )
        ) {
          return;
        }

        if (result.ok) {
          setDiff(result.value);
        } else if (result.error.code !== "COMMAND_CANCELLED") {
          setError(result.error);
        }
      } catch (reason) {
        if (
          isCurrentQuery(
            "diff",
            queryId,
            requestGeneration
          )
        ) {
          setError(unexpectedError(reason));
        }
      } finally {
        if (
          finishQuery("diff", queryId) &&
          requestGeneration === generation.current
        ) {
          setLoadingKey("diff", false);
        }
      }
    },
    [
      createQuery,
      finishQuery,
      isCurrentQuery,
      setLoadingKey,
      stableTarget
    ]
  );

  const loadChanges = useCallback(async () => {
    if (!stableTarget) {
      return;
    }

    const queryId = createQuery("changes");
    const requestGeneration = generation.current;
    setLoadingKey("changes", true);
    setError(null);

    try {
      const result = await window.gitnest.repository.getChanges({
        queryId,
        target: stableTarget
      });

      if (
        !isCurrentQuery(
          "changes",
          queryId,
          requestGeneration
        )
      ) {
        return;
      }

      if (result.ok) {
        setChanges(result.value);
        const first = result.value.snapshot.changes[0];
        if (first) {
          void selectChange(first);
        } else {
          setSelectedChange(null);
          setDiff(null);
        }
      } else if (result.error.code !== "COMMAND_CANCELLED") {
        setError(result.error);
      }
    } catch (reason) {
      if (
        isCurrentQuery(
          "changes",
          queryId,
          requestGeneration
        )
      ) {
        setError(unexpectedError(reason));
      }
    } finally {
      if (
        finishQuery("changes", queryId) &&
        requestGeneration === generation.current
      ) {
        setLoadingKey("changes", false);
      }
    }
  }, [
    createQuery,
    finishQuery,
    isCurrentQuery,
    selectChange,
    setLoadingKey,
    stableTarget
  ]);

  const selectCommit = useCallback(
    async (commitHash: string) => {
      if (!stableTarget) {
        return;
      }

      const queryId = createQuery("commit");
      const requestGeneration = generation.current;
      setSelectedCommitHash(commitHash);
      setCommit(null);
      setLoadingKey("commit", true);
      setError(null);

      try {
        const result = await window.gitnest.repository.getCommit({
          queryId,
          target: stableTarget,
          commitHash
        });

        if (
          !isCurrentQuery(
            "commit",
            queryId,
            requestGeneration
          )
        ) {
          return;
        }

        if (result.ok) {
          setCommit(result.value);
        } else if (result.error.code !== "COMMAND_CANCELLED") {
          setError(result.error);
        }
      } catch (reason) {
        if (
          isCurrentQuery(
            "commit",
            queryId,
            requestGeneration
          )
        ) {
          setError(unexpectedError(reason));
        }
      } finally {
        if (
          finishQuery("commit", queryId) &&
          requestGeneration === generation.current
        ) {
          setLoadingKey("commit", false);
        }
      }
    },
    [
      createQuery,
      finishQuery,
      isCurrentQuery,
      setLoadingKey,
      stableTarget
    ]
  );

  const loadHistory = useCallback(
    async (offset = 0) => {
      if (!stableTarget) {
        return;
      }

      const queryId = createQuery("history");
      const requestGeneration = generation.current;
      setLoadingKey("history", true);
      setError(null);

      try {
        const result = await window.gitnest.repository.getHistory({
          queryId,
          target: stableTarget,
          limit: 50,
          offset
        });

        if (
          !isCurrentQuery(
            "history",
            queryId,
            requestGeneration
          )
        ) {
          return;
        }

        if (result.ok) {
          setHistory((current) =>
            offset > 0 && current
              ? {
                  ...result.value,
                  page: {
                    ...result.value.page,
                    commits: [
                      ...current.page.commits,
                      ...result.value.page.commits
                    ]
                  }
                }
              : result.value
          );
          const first = result.value.page.commits[0];
          if (offset === 0 && first) {
            void selectCommit(first.hash);
          }
        } else if (result.error.code !== "COMMAND_CANCELLED") {
          setError(result.error);
        }
      } catch (reason) {
        if (
          isCurrentQuery(
            "history",
            queryId,
            requestGeneration
          )
        ) {
          setError(unexpectedError(reason));
        }
      } finally {
        if (
          finishQuery("history", queryId) &&
          requestGeneration === generation.current
        ) {
          setLoadingKey("history", false);
        }
      }
    },
    [
      createQuery,
      finishQuery,
      isCurrentQuery,
      selectCommit,
      setLoadingKey,
      stableTarget
    ]
  );

  const loadBranches = useCallback(async () => {
    if (!stableTarget) {
      return;
    }

    const queryId = createQuery("branches");
    const requestGeneration = generation.current;
    setLoadingKey("branches", true);
    setError(null);

    try {
      const result = await window.gitnest.repository.getBranches({
        queryId,
        target: stableTarget
      });

      if (
        !isCurrentQuery(
          "branches",
          queryId,
          requestGeneration
        )
      ) {
        return;
      }

      if (result.ok) {
        setBranches(result.value);
      } else if (result.error.code !== "COMMAND_CANCELLED") {
        setError(result.error);
      }
    } catch (reason) {
      if (
        isCurrentQuery(
          "branches",
          queryId,
          requestGeneration
        )
      ) {
        setError(unexpectedError(reason));
      }
    } finally {
      if (
        finishQuery("branches", queryId) &&
        requestGeneration === generation.current
      ) {
        setLoadingKey("branches", false);
      }
    }
  }, [
    createQuery,
    finishQuery,
    isCurrentQuery,
    setLoadingKey,
    stableTarget
  ]);

  const loadMoreHistory = useCallback(
    async () => {
      const offset = history?.page.nextOffset;
      if (offset !== undefined) {
        await loadHistory(offset);
      }
    },
    [history?.page.nextOffset, loadHistory]
  );

  const reload = useCallback(
    async (requestedTab: RepositoryTab) => {
      if (requestedTab === "changes") {
        cancelQuery("diff");
        setLoadingKey("diff", false);
        setSelectedChange(null);
        setDiff(null);
        await loadChanges();
      } else if (requestedTab === "history") {
        cancelQuery("commit");
        setLoadingKey("commit", false);
        setSelectedCommitHash(null);
        setCommit(null);
        await loadHistory(0);
      } else if (requestedTab === "branches") {
        await loadBranches();
      }
    },
    [
      cancelQuery,
      loadBranches,
      loadChanges,
      loadHistory,
      setLoadingKey
    ]
  );

  const invalidate = useCallback(() => {
    generation.current += 1;
    cancelAll();
    setLoading(EMPTY_LOADING);
    setError(null);
  }, [cancelAll]);

  useEffect(() => {
    generation.current += 1;
    cancelAll();
    setChanges(null);
    setDiff(null);
    setHistory(null);
    setCommit(null);
    setBranches(null);
    setSelectedChange(null);
    setSelectedCommitHash(null);
    setLoading(EMPTY_LOADING);
    setError(null);
  }, [cancelAll, targetKey]);

  useEffect(() => {
    generation.current += 1;
    cancelAll();
    setLoading(EMPTY_LOADING);
    void reload(tab);
  }, [cancelAll, reload, tab, targetKey]);

  useEffect(
    () => () => {
      generation.current += 1;
      cancelAll();
    },
    [cancelAll]
  );

  return {
    changes,
    diff,
    history,
    commit,
    branches,
    selectedChange,
    selectedCommitHash,
    loading,
    error,
    selectChange,
    selectCommit,
    loadMoreHistory,
    reload,
    invalidate
  };
}

function preferredDiffMode(
  change: ChangedPathDto
): "unstaged" | "staged" | "untracked" {
  if (change.kind === "untracked") {
    return "untracked";
  }
  if (change.worktreeStatus !== ".") {
    return "unstaged";
  }
  return "staged";
}

function unexpectedError(reason: unknown): GitReadErrorDto {
  return {
    code: "COMMAND_FAILED",
    message:
      reason instanceof Error
        ? reason.message
        : "仓库查询失败。",
    details: {}
  };
}
