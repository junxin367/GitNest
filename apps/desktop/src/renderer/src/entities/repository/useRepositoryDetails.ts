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

interface SelectChangeOptions {
  preserveDiff?: boolean;
}

interface SelectCommitOptions {
  openHistoryDetail?: boolean;
}

export interface RepositoryDetailsController {
  changes: RepositoryChangesDto | null;
  diff: RepositoryDiffDto | null;
  diffNotice: "change-removed" | "metadata-only" | null;
  history: RepositoryHistoryPageDto | null;
  commit: RepositoryCommitDto | null;
  branches: RepositoryBranchesDto | null;
  selectedChange: {
    path: string;
    mode: "unstaged" | "staged" | "untracked";
  } | null;
  selectedCommitHash: string | null;
  historyDetailOpen: boolean;
  loading: Readonly<Record<LoadingKey, boolean>>;
  error: GitReadErrorDto | null;
  selectChange(
    change: ChangedPathDto,
    mode?: "unstaged" | "staged" | "untracked"
  ): Promise<void>;
  selectCommit(
    commitHash: string,
    options?: SelectCommitOptions
  ): Promise<void>;
  loadMoreHistory(): Promise<void>;
  reload(
    tab: RepositoryTab,
    options?: { preserveSelection?: boolean }
  ): Promise<void>;
  invalidate(): void;
  clearError(): void;
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
  tab: RepositoryTab,
  statusRevision = ""
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
  const [diffNotice, setDiffNotice] = useState<
    RepositoryDetailsController["diffNotice"]
  >(null);
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
  const [historyDetailOpen, setHistoryDetailOpen] =
    useState(false);
  const [loading, setLoading] =
    useState<Record<LoadingKey, boolean>>(EMPTY_LOADING);
  const [error, setError] =
    useState<GitReadErrorDto | null>(null);
  const selectedChangeRef = useRef<
    RepositoryDetailsController["selectedChange"]
  >(null);
  const selectedCommitHashRef = useRef<string | null>(null);
  const historyDetailOpenRef = useRef(false);
  const previousTabRef = useRef<RepositoryTab | null>(null);
  const diffRef = useRef<RepositoryDiffDto | null>(null);
  const reloadChangesRef = useRef<
    (preserveSelection?: boolean) => Promise<void>
  >(async () => undefined);
  const emptyDiffRefreshesRef = useRef(new Set<string>());
  const statusRevisionRef = useRef({
    targetKey,
    revision: statusRevision
  });
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
      requestedMode?: "unstaged" | "staged" | "untracked",
      options: SelectChangeOptions = {}
    ) => {
      if (!stableTarget) {
        return;
      }

      const mode = requestedMode ?? preferredDiffMode(change);
      const queryId = createQuery("diff");
      const requestGeneration = generation.current;
      const nextSelection = { path: change.path, mode };
      const refreshKey = emptyDiffRefreshKey(
        targetKey,
        nextSelection
      );
      const matchingDiffLoaded =
        diffRef.current?.diff.path === nextSelection.path &&
        diffRef.current.diff.mode === nextSelection.mode;
      const preserveExistingDiff =
        selectedChangeRef.current?.path ===
          nextSelection.path &&
        selectedChangeRef.current.mode === nextSelection.mode &&
        (options.preserveDiff === true ||
          matchingDiffLoaded);
      const background =
        preserveExistingDiff && matchingDiffLoaded;
      selectedChangeRef.current = nextSelection;
      setSelectedChange(nextSelection);
      if (!preserveExistingDiff) {
        diffRef.current = null;
        setDiff(null);
        setDiffNotice(null);
      }
      if (!background) {
        setLoadingKey("diff", true);
      }
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
          diffRef.current = result.value;
          setDiff(result.value);
          if (isEmptyUnstagedDiff(result.value)) {
            if (
              !emptyDiffRefreshesRef.current.has(refreshKey)
            ) {
              emptyDiffRefreshesRef.current.add(refreshKey);
              void reloadChangesRef.current(true);
            } else {
              setDiffNotice("metadata-only");
            }
          } else {
            emptyDiffRefreshesRef.current.delete(refreshKey);
          }
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
          requestGeneration === generation.current &&
          !background
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
      stableTarget,
      targetKey
    ]
  );

  const loadChanges = useCallback(
    async (preserveSelection = false) => {
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
          const previousSelection = preserveSelection
            ? selectedChangeRef.current
            : null;
          const preserved = previousSelection
            ? result.value.snapshot.changes.find(
                (change) =>
                  change.path === previousSelection.path
              )
            : undefined;
          const nextChange =
            preserved ?? result.value.snapshot.changes[0];

          if (nextChange) {
            const nextMode = preserved
              ? preferredPreservedDiffMode(
                  nextChange,
                  previousSelection?.mode
                )
              : preferredDiffMode(nextChange);
            const preserveExistingDiff =
              Boolean(preserved && previousSelection) &&
              nextMode === previousSelection?.mode;
            const diffAlreadyLoading =
              activeQueries.current.has("diff");

            if (
              !(
                preserveExistingDiff &&
                diffAlreadyLoading
              )
            ) {
              void selectChange(nextChange, nextMode, {
                preserveDiff: preserveExistingDiff
              });
            }
          } else {
            const removedAfterEmptyDiffRefresh =
              previousSelection
                ? emptyDiffRefreshesRef.current.delete(
                    emptyDiffRefreshKey(
                      targetKey,
                      previousSelection
                    )
                  )
                : false;
            selectedChangeRef.current = null;
            setSelectedChange(null);
            diffRef.current = null;
            setDiff(null);
            setDiffNotice(
              removedAfterEmptyDiffRefresh
                ? "change-removed"
                : null
            );
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
    },
    [
      createQuery,
      finishQuery,
      isCurrentQuery,
      selectChange,
      setLoadingKey,
      stableTarget,
      targetKey
    ]
  );

  useEffect(() => {
    reloadChangesRef.current = loadChanges;
  }, [loadChanges]);

  const selectCommit = useCallback(
    async (
      commitHash: string,
      options: SelectCommitOptions = {}
    ) => {
      if (!stableTarget) {
        return;
      }

      const togglingSelectedHistoryCommit =
        tab === "history" &&
        historyDetailOpenRef.current &&
        selectedCommitHashRef.current === commitHash;
      if (togglingSelectedHistoryCommit) {
        cancelQuery("commit");
        setLoadingKey("commit", false);
        historyDetailOpenRef.current = false;
        setHistoryDetailOpen(false);
        setError(null);
        return;
      }

      const queryId = createQuery("commit");
      const requestGeneration = generation.current;
      const openHistoryDetail =
        options.openHistoryDetail ?? tab === "history";
      selectedCommitHashRef.current = commitHash;
      historyDetailOpenRef.current = openHistoryDetail;
      setSelectedCommitHash(commitHash);
      setHistoryDetailOpen(openHistoryDetail);
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
      cancelQuery,
      createQuery,
      finishQuery,
      isCurrentQuery,
      setLoadingKey,
      stableTarget,
      tab
    ]
  );

  const selectCommitRef = useRef<
    (
      commitHash: string,
      options?: SelectCommitOptions
    ) => Promise<void>
  >(async () => undefined);

  useEffect(() => {
    selectCommitRef.current = selectCommit;
  }, [selectCommit]);

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
          if (
            tab === "history" &&
            offset === 0 &&
            first &&
            !historyDetailOpenRef.current &&
            !activeQueries.current.has("commit")
          ) {
            void selectCommitRef.current(
              selectedCommitHashRef.current ?? first.hash,
              { openHistoryDetail: false }
            );
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
      setLoadingKey,
      stableTarget,
      tab
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
    async (
      requestedTab: RepositoryTab,
      options: { preserveSelection?: boolean } = {}
    ) => {
      if (requestedTab === "overview") {
        await loadHistory(0);
      } else if (requestedTab === "changes") {
        if (!options.preserveSelection) {
          cancelQuery("diff");
          setLoadingKey("diff", false);
          selectedChangeRef.current = null;
          setSelectedChange(null);
          setDiffNotice(null);
          diffRef.current = null;
          setDiff(null);
        }
        await loadChanges(options.preserveSelection);
      } else if (requestedTab === "history") {
        const preserveSelection = Boolean(
          selectedCommitHashRef.current
        );
        if (!preserveSelection) {
          cancelQuery("commit");
          setLoadingKey("commit", false);
          selectedCommitHashRef.current = null;
          historyDetailOpenRef.current = false;
          setSelectedCommitHash(null);
          setHistoryDetailOpen(false);
          setCommit(null);
        }
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
    setDiffNotice(null);
  }, [cancelAll]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  useEffect(() => {
    generation.current += 1;
    cancelAll();
    selectedChangeRef.current = null;
    emptyDiffRefreshesRef.current.clear();
    setChanges(null);
    diffRef.current = null;
    setDiff(null);
    setDiffNotice(null);
    setHistory(null);
    setCommit(null);
    setBranches(null);
    setSelectedChange(null);
    selectedCommitHashRef.current = null;
    historyDetailOpenRef.current = false;
    setSelectedCommitHash(null);
    setHistoryDetailOpen(false);
    setLoading(EMPTY_LOADING);
    setError(null);
  }, [cancelAll, targetKey]);

  useEffect(() => {
    if (
      statusRevisionRef.current.targetKey !== targetKey ||
      tab !== "changes"
    ) {
      statusRevisionRef.current = {
        targetKey,
        revision: statusRevision
      };
    }
  }, [statusRevision, targetKey]);

  useEffect(() => {
    const enteringHistory =
      tab === "history" &&
      previousTabRef.current !== "history";
    previousTabRef.current = tab;
    if (tab !== "history" || enteringHistory) {
      historyDetailOpenRef.current = false;
      setHistoryDetailOpen(false);
    }
    generation.current += 1;
    cancelAll();
    setLoading(EMPTY_LOADING);
    void reload(tab);
  }, [cancelAll, reload, tab, targetKey]);

  useEffect(() => {
    if (!targetKey || tab !== "changes") {
      return;
    }

    const current = statusRevisionRef.current;
    if (
      current.targetKey !== targetKey ||
      current.revision === statusRevision
    ) {
      return;
    }

    statusRevisionRef.current = {
      targetKey,
      revision: statusRevision
    };
    void reload("changes", { preserveSelection: true });
  }, [reload, statusRevision, tab, targetKey]);

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
    diffNotice,
    history,
    commit,
    branches,
    selectedChange,
    selectedCommitHash,
    historyDetailOpen,
    loading,
    error,
    selectChange,
    selectCommit,
    loadMoreHistory,
    reload,
    invalidate,
    clearError
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

function emptyDiffRefreshKey(
  targetKey: string,
  selection: {
    path: string;
    mode: "unstaged" | "staged" | "untracked";
  }
): string {
  return `${targetKey}\0${selection.mode}\0${selection.path}`;
}

function isEmptyUnstagedDiff(
  result: RepositoryDiffDto
): boolean {
  return (
    result.diff.mode === "unstaged" &&
    !result.diff.binary &&
    result.diff.content.length === 0
  );
}

function preferredPreservedDiffMode(
  change: ChangedPathDto,
  previousMode:
    | "unstaged"
    | "staged"
    | "untracked"
    | undefined
): "unstaged" | "staged" | "untracked" {
  if (
    previousMode === "untracked" &&
    change.kind === "untracked"
  ) {
    return "untracked";
  }
  if (
    previousMode === "staged" &&
    change.kind !== "untracked" &&
    change.indexStatus !== "."
  ) {
    return "staged";
  }
  if (
    previousMode === "unstaged" &&
    change.kind !== "untracked" &&
    change.worktreeStatus !== "."
  ) {
    return "unstaged";
  }
  return preferredDiffMode(change);
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
