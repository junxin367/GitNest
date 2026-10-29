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
  RepositoryHistoryScopeDto,
  RepositoryHistoryFilterDto,
  RepositoryHistoryTraversalDto,
  RepositoryTargetDto
} from "@gitnest/contracts";

import type { RepositoryTab } from "../../app/navigation";
import { RepositoryChangesCache } from "./repositoryChangesCache";
import {
  changeSupportsMode,
  findRequestedRepositoryChange,
  repositoryTargetsMatch,
  type RepositoryChangeSelectionRequest
} from "./changeSelection";

type LoadingKey =
  | "changes"
  | "diff"
  | "history"
  | "commit"
  | "branches";

interface SelectChangeOptions {
  preserveDiff?: boolean;
  contextLines?: number;
}

interface SelectCommitOptions {
  openHistoryDetail?: boolean;
}

export interface RepositoryDetailsController {
  changes: RepositoryChangesDto | null;
  diff: RepositoryDiffDto | null;
  diffNotice: "change-removed" | "metadata-only" | null;
  history: RepositoryHistoryPageDto | null;
  historyScope: RepositoryHistoryScopeDto | null;
  historySearch: RepositoryHistoryFilterDto | null;
  historyLoadMoreError?: GitReadErrorDto | null;
  commit: RepositoryCommitDto | null;
  branches: RepositoryBranchesDto | null;
  selectedChange: {
    path: string;
    mode: "unstaged" | "staged" | "untracked";
    contextLines: number;
  } | null;
  changeSelectionRequestId: number | null;
  selectedCommitHash: string | null;
  historyDetailOpen: boolean;
  loading: Readonly<Record<LoadingKey, boolean>>;
  error: GitReadErrorDto | null;
  selectChange(
    change: ChangedPathDto,
    mode?: "unstaged" | "staged" | "untracked",
    options?: SelectChangeOptions
  ): Promise<void>;
  selectCommit(
    commitHash: string,
    options?: SelectCommitOptions
  ): Promise<void>;
  selectHistoryScope(
    scope: RepositoryHistoryScopeDto | null
  ): Promise<void>;
  searchHistory(search: RepositoryHistoryFilterDto | null): Promise<void>;
  loadMoreHistory(): Promise<void>;
  reload(
    tab: RepositoryTab,
    options?: { preserveSelection?: boolean; reuseChanges?: boolean }
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
const DEFAULT_DIFF_CONTEXT_LINES = 3;

export function useRepositoryDetails(
  target: RepositoryTargetDto | undefined,
  tab: RepositoryTab,
  statusRevision = "",
  requestedChange: RepositoryChangeSelectionRequest | null = null,
  onRequestedChangeHandled?: (requestId: number) => void
): RepositoryDetailsController {
  const targetKey = target
    ? `${target.repositoryId}:${target.worktreeId}`
    : "";
  const [dataTargetKey, setDataTargetKey] = useState(targetKey);
  const [loadingTab, setLoadingTab] = useState(tab);
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
  const [historyScope, setHistoryScope] =
    useState<RepositoryHistoryScopeDto | null>(null);
  const [historySearch, setHistorySearch] =
    useState<RepositoryHistoryFilterDto | null>(null);
  const [historyLoadMoreError, setHistoryLoadMoreError] =
    useState<GitReadErrorDto | null>(null);
  const historyNextOffsetRef = useRef<number | undefined>(undefined);
  const historyTraversalRef = useRef<RepositoryHistoryTraversalDto | undefined>(undefined);
  const historyRowsRef = useRef<RepositoryHistoryPageDto["page"]["commits"]>([]);
  const historyDepthRef = useRef(0);
  const [commit, setCommit] =
    useState<RepositoryCommitDto | null>(null);
  const [branches, setBranches] =
    useState<RepositoryBranchesDto | null>(null);
  const [selectedChange, setSelectedChange] =
    useState<RepositoryDetailsController["selectedChange"]>(null);
  const [
    changeSelectionRequestId,
    setChangeSelectionRequestId
  ] = useState<number | null>(null);
  const [selectedCommitHash, setSelectedCommitHash] =
    useState<string | null>(null);
  const [historyDetailOpen, setHistoryDetailOpen] =
    useState(false);
  const [loading, setLoading] =
    useState<Record<LoadingKey, boolean>>(() =>
      initialTabLoading(Boolean(target), tab)
    );
  const [error, setError] =
    useState<GitReadErrorDto | null>(null);
  const selectedChangeRef = useRef<
    RepositoryDetailsController["selectedChange"]
  >(null);
  const selectedCommitHashRef = useRef<string | null>(null);
  const requestedChangeRef =
    useRef<RepositoryChangeSelectionRequest | null>(
      requestedChange
    );
  requestedChangeRef.current = requestedChange;
  const onRequestedChangeHandledRef = useRef(
    onRequestedChangeHandled
  );
  onRequestedChangeHandledRef.current =
    onRequestedChangeHandled;
  const handledChangeRequestIdsRef = useRef(new Set<number>());
  const activeChangesRequestIdRef = useRef<number | null>(null);
  const historyDetailOpenRef = useRef(false);
  const historyScopeRef =
    useRef<RepositoryHistoryScopeDto | null>(null);
  const historySearchRef =
    useRef<RepositoryHistoryFilterDto | null>(null);
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
  const changesProgressSubscription = useRef<(() => void) | null>(null);
  const sequence = useRef(0);
  const generation = useRef(0);
  const [changesCache] = useState(
    () => new RepositoryChangesCache(window.gitnest.repository)
  );
  const currentStatusRevisionRef = useRef(statusRevision);
  currentStatusRevisionRef.current = statusRevision;

  const cancelAll = useCallback(() => {
    changesProgressSubscription.current?.();
    changesProgressSubscription.current = null;
    for (const [key, queryId] of activeQueries.current) {
      if (key !== "changes") {
        void window.gitnest.repository.cancelQuery({ queryId });
      }
    }
    activeQueries.current.clear();
    activeChangesRequestIdRef.current = null;
  }, []);

  const cancelQuery = useCallback((key: LoadingKey) => {
    const queryId = activeQueries.current.get(key);

    if (queryId) {
      if (key !== "changes") {
        void window.gitnest.repository.cancelQuery({ queryId });
      }
      activeQueries.current.delete(key);
    }
    if (key === "changes") {
      changesProgressSubscription.current?.();
      changesProgressSubscription.current = null;
      activeChangesRequestIdRef.current = null;
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
  const markRequestedChangeHandled = useCallback(
    (request: RepositoryChangeSelectionRequest) => {
      if (
        handledChangeRequestIdsRef.current.has(request.id)
      ) {
        return;
      }
      handledChangeRequestIdsRef.current.add(request.id);
      onRequestedChangeHandledRef.current?.(request.id);
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
      const previousSelection = selectedChangeRef.current;
      const sameSelection =
        previousSelection?.path === change.path &&
        previousSelection.mode === mode;
      const contextLines =
        options.contextLines ??
        (sameSelection
          ? previousSelection.contextLines
          : DEFAULT_DIFF_CONTEXT_LINES);
      const queryId = createQuery("diff");
      const requestGeneration = generation.current;
      const nextSelection = {
        path: change.path,
        mode,
        contextLines
      };
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
      const reportLoading =
        !background || options.contextLines !== undefined;
      selectedChangeRef.current = nextSelection;
      setSelectedChange(nextSelection);
      if (!preserveExistingDiff) {
        diffRef.current = null;
        setDiff(null);
        setDiffNotice(null);
      }
      if (reportLoading) {
        setLoadingKey("diff", true);
      }
      setError(null);

      try {
        const result = await window.gitnest.repository.getDiff({
          queryId,
          target: stableTarget,
          path: change.path,
          mode,
          contextLines
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
      stableTarget,
      targetKey
    ]
  );

  const loadChanges = useCallback(
    async (preserveSelection = false, reuseChanges = false) => {
      if (!stableTarget) {
        return;
      }

      const navigationRequest = requestedChangeRef.current;
      const queryId = createQuery("changes");
      activeChangesRequestIdRef.current =
        navigationRequest &&
        repositoryTargetsMatch(
          navigationRequest.target,
          stableTarget
        )
          ? navigationRequest.id
          : null;
      const requestGeneration = generation.current;
      setLoadingKey("changes", true);
      setError(null);

      let receivedSnapshot = false;
      const acceptChanges = (value: RepositoryChangesDto, preserveLoadedSelection = false) => {
        setChanges(value);
        const currentRequest = requestedChangeRef.current;
        const requestMatchesTarget = Boolean(
          currentRequest &&
            repositoryTargetsMatch(
              currentRequest.target,
              stableTarget
            ) &&
            repositoryTargetsMatch(
              currentRequest.target,
              value.target
            )
        );
        const requestedSelection =
          requestMatchesTarget && currentRequest
            ? resolveRequestedChangeSelection(
                value,
                currentRequest
              )
            : null;
        const previousSelection = preserveSelection || preserveLoadedSelection
          ? selectedChangeRef.current
          : null;
        const preserved = previousSelection
          ? value.snapshot.changes.find(
              (change) =>
                change.path === previousSelection.path
            )
          : undefined;
        const nextChange =
          requestedSelection?.change ??
          preserved ??
          value.snapshot.changes[0];

        if (nextChange) {
          if (requestedSelection && currentRequest) {
            setChangeSelectionRequestId(currentRequest.id);
          }
          const nextMode =
            requestedSelection?.mode ??
            (preserved
              ? preferredPreservedDiffMode(
                  nextChange,
                  previousSelection?.mode
                )
              : preferredDiffMode(nextChange));
          const preserveExistingDiff =
            !requestedSelection &&
            Boolean(preserved && previousSelection) &&
            nextMode === previousSelection?.mode;
          const diffAlreadyLoading =
            activeQueries.current.has("diff");
          if (
            !(
              preserveExistingDiff &&
              (diffAlreadyLoading || preserveLoadedSelection)
            )
          ) {
            void selectChange(nextChange, nextMode, {
              preserveDiff: preserveExistingDiff,
              ...(previousSelection
                ? {
                    contextLines:
                      previousSelection.contextLines
                  }
                : {})
            });
          }
        } else {
          cancelQuery("diff");
          setLoadingKey("diff", false);
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
        if (requestMatchesTarget && currentRequest) {
          markRequestedChangeHandled(currentRequest);
        }
      };
      const entry = changesCache.read(
        stableTarget, currentStatusRevisionRef.current, queryId, reuseChanges
      );
      const receiveChanges = (value: RepositoryChangesDto, snapshot: boolean) => {
        if (!isCurrentQuery("changes", queryId, requestGeneration)) return;
        if (snapshot) {
          const preserveLoadedSelection = receivedSnapshot;
          receivedSnapshot = true;
          acceptChanges(value, preserveLoadedSelection);
          setLoadingKey("changes", false);
        } else {
          setChanges(value);
        }
      };
      const unsubscribe = entry.subscribe(receiveChanges);
      changesProgressSubscription.current = unsubscribe;
      if (reuseChanges && entry.value) receiveChanges(entry.value, true);

      try {
        const result = await entry.result;
        if (!isCurrentQuery("changes", queryId, requestGeneration)) return;
        if (result.ok) {
          if (!receivedSnapshot) acceptChanges(result.value);
          else if (!entry.progressComplete) acceptChanges(result.value, true);
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
        unsubscribe();
        if (changesProgressSubscription.current === unsubscribe) {
          changesProgressSubscription.current = null;
        }
        if (finishQuery("changes", queryId)) {
          activeChangesRequestIdRef.current = null;
          if (requestGeneration === generation.current) {
            setLoadingKey("changes", false);
            setChanges((current) =>
              current?.statsProgress ? { ...current, statsProgress: undefined } : current
            );
          }
        }
      }
    },
    [
      cancelQuery,
      changesCache,
      createQuery,
      finishQuery,
      isCurrentQuery,
      markRequestedChangeHandled,
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
      const historyEntry = historyRowsRef.current.find(item => item.hash === commitHash);
      const requestGeneration = generation.current;
      const openHistoryDetail =
        options.openHistoryDetail ?? tab === "history";
      selectedCommitHashRef.current = commitHash;
      historyDetailOpenRef.current = openHistoryDetail;
      setSelectedCommitHash(commitHash);
      setHistoryDetailOpen(openHistoryDetail);
      setCommit((current) =>
        current?.commit.hash === commitHash &&
        repositoryTargetsMatch(current.target, stableTarget)
          ? current
          : null
      );
      setLoadingKey("commit", true);
      setError(null);

      try {
        let result = await window.gitnest.repository.getCommit({
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

        if (result.ok && historyEntry?.stashRef) {
          // Read by immutable hash: stash@{n} can move while the row is open.
          const files = await window.gitnest.repository.getStashFiles({
            queryId,
            target: stableTarget,
            stashRef: commitHash
          });
          if (!isCurrentQuery("commit", queryId, requestGeneration)) return;
          result = files.ok
            ? {
                ok: true,
                value: {
                  ...result.value,
                  commit: {
                    ...result.value.commit,
                    stashRef: historyEntry.stashRef,
                    files: files.value.stash.files,
                    additions: files.value.stash.additions,
                    deletions: files.value.stash.deletions
                  }
                }
              }
            : files;
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
    async (
      offset = 0,
      scope = historyScopeRef.current,
      search = tab === "history" ? historySearchRef.current : null,
      preserveDepth = false
    ) => {
      if (!stableTarget) {
        return;
      }

      const queryId = createQuery("history");
      const requestGeneration = generation.current;
      setLoadingKey("history", true);
      setError(null);
      setHistoryLoadMoreError(null);

      try {
        const depth = offset === 0 && preserveDepth ? Math.max(50, historyDepthRef.current) : 50;
        let traversal = offset > 0 ? historyTraversalRef.current : undefined;
        const readPage = (pageOffset: number, limit: number) => window.gitnest.repository.getHistory({
          queryId,
          target: stableTarget,
          limit,
          offset: pageOffset,
          ...(scope ? { scope } : {}),
          ...(search ? { search } : {}),
          ...(traversal ? { traversal } : {})
        });
        let result = await readPage(offset, Math.min(100, depth));
        if (result.ok) traversal = result.value.page.traversal;
        // Refresh the loaded prefix without discarding the pages being read.
        // Stash rows do not count toward the underlying Git log offset.
        while (
          preserveDepth && depth > 100
          && isCurrentQuery("history", queryId, requestGeneration)
          && result.ok && result.value.page.nextOffset !== undefined
          && result.value.page.nextOffset < offset + depth
        ) {
          const nextOffset = result.value.page.nextOffset;
          const next = await readPage(nextOffset, Math.min(100, offset + depth - nextOffset));
          if (!next.ok) {
            result = next;
            break;
          }
          const seen = new Set(result.value.page.commits.map((item) => item.hash));
          result = {
            ...next,
            value: {
              ...next.value,
              page: {
                ...next.value.page,
                commits: [...result.value.page.commits, ...next.value.page.commits.filter((item) => !seen.has(item.hash))]
              }
            }
          };
        }

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
          const value = tab === "overview"
            ? {
                ...result.value,
                page: {
                  ...result.value.page,
                  commits: result.value.page.commits.filter((item) => !item.stashRef)
                }
              }
            : result.value;
          historyNextOffsetRef.current = value.page.nextOffset;
          historyTraversalRef.current = value.page.traversal;
          historyDepthRef.current = value.page.nextOffset
            ?? offset + value.page.commits.filter((item) => !item.stashRef).length;
          const seen = new Set(historyRowsRef.current.map(item => item.hash));
          const commits = offset === 0
            ? value.page.commits
            : [...historyRowsRef.current, ...value.page.commits.filter(item => !seen.has(item.hash))];
          historyRowsRef.current = commits;
          setHistory({
            ...value,
            page: { ...value.page, commits }
          });
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
          if (offset > 0) setHistoryLoadMoreError(result.error);
        }
      } catch (reason) {
        if (
          isCurrentQuery(
            "history",
            queryId,
            requestGeneration
          )
        ) {
          const failure = unexpectedError(reason);
          setError(failure);
          if (offset > 0) setHistoryLoadMoreError(failure);
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

  const selectHistoryScope = useCallback(
    async (scope: RepositoryHistoryScopeDto | null) => {
      if (sameHistoryScope(historyScopeRef.current, scope)) {
        return;
      }

      cancelQuery("commit");
      setLoadingKey("commit", false);
      selectedCommitHashRef.current = null;
      historyDetailOpenRef.current = false;
      setSelectedCommitHash(null);
      setHistoryDetailOpen(false);
      setCommit(null);
      setHistory(null);
      historyNextOffsetRef.current = undefined;
      historyTraversalRef.current = undefined;
      historyRowsRef.current = [];
      historyDepthRef.current = 0;
      setHistoryLoadMoreError(null);
      setError(null);
      historyScopeRef.current = scope;
      setHistoryScope(scope);
      await loadHistory(0, scope);
    },
    [cancelQuery, loadHistory, setLoadingKey]
  );

  const searchHistory = useCallback(
    async (search: RepositoryHistoryFilterDto | null) => {
      cancelQuery("history");
      cancelQuery("commit");
      setLoadingKey("commit", false);
      selectedCommitHashRef.current = null;
      historyDetailOpenRef.current = false;
      setSelectedCommitHash(null);
      setHistoryDetailOpen(false);
      setCommit(null);
      setHistory(null);
      historyNextOffsetRef.current = undefined;
      historyTraversalRef.current = undefined;
      historyRowsRef.current = [];
      historyDepthRef.current = 0;
      setHistoryLoadMoreError(null);
      historySearchRef.current = search;
      setHistorySearch(search);
      await loadHistory(0, historyScopeRef.current, search);
    },
    [cancelQuery, loadHistory, setLoadingKey]
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
      const offset = historyNextOffsetRef.current;
      if (offset !== undefined && !activeQueries.current.has("history")) {
        await loadHistory(offset, historyScopeRef.current);
      }
    },
    [loadHistory]
  );

  const reload = useCallback(
    async (
      requestedTab: RepositoryTab,
      options: { preserveSelection?: boolean; reuseChanges?: boolean } = {}
    ) => {
      if (requestedTab === "overview") {
        await loadHistory(0, null, null);
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
        await loadChanges(options.preserveSelection, options.reuseChanges);
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
        await Promise.all([
          loadHistory(0, historyScopeRef.current, historySearchRef.current, true),
          loadBranches()
        ]);
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
    changesCache.invalidate(targetKey);
    setLoading(EMPTY_LOADING);
    setError(null);
    setDiffNotice(null);
  }, [cancelAll, changesCache, targetKey]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  useEffect(() => {
    generation.current += 1;
    cancelAll();
    setDataTargetKey(targetKey);
    selectedChangeRef.current = null;
    emptyDiffRefreshesRef.current.clear();
    setChanges(changesCache.peek(targetKey, currentStatusRevisionRef.current));
    diffRef.current = null;
    setDiff(null);
    setDiffNotice(null);
    setHistory(null);
    historyNextOffsetRef.current = undefined;
    historyTraversalRef.current = undefined;
    historyRowsRef.current = [];
    historyDepthRef.current = 0;
    setHistoryLoadMoreError(null);
    historyScopeRef.current = null;
    setHistoryScope(null);
    historySearchRef.current = null;
    setHistorySearch(null);
    setCommit(null);
    setBranches(null);
    setSelectedChange(null);
    setChangeSelectionRequestId(null);
    selectedCommitHashRef.current = null;
    historyDetailOpenRef.current = false;
    setSelectedCommitHash(null);
    setHistoryDetailOpen(false);
    setLoading(EMPTY_LOADING);
    setError(null);
  }, [cancelAll, changesCache, targetKey]);

  useEffect(() => {
    const enteringHistory =
      tab === "history" &&
      previousTabRef.current !== "history";
    previousTabRef.current = tab;
    setLoadingTab(tab);
    if (tab !== "history" || enteringHistory) {
      historyDetailOpenRef.current = false;
      setHistoryDetailOpen(false);
    }
    generation.current += 1;
    cancelAll();
    setLoading(EMPTY_LOADING);
    statusRevisionRef.current = {
      targetKey,
      revision: statusRevision
    };
    void reload(tab, { reuseChanges: true });
  }, [cancelAll, reload, tab, targetKey]);

  useEffect(() => {
    if (!targetKey) {
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
    void reload(tab, { preserveSelection: true });
  }, [reload, statusRevision, tab, targetKey]);

  useEffect(() => {
    if (
      !requestedChange ||
      tab !== "changes" ||
      !stableTarget ||
      handledChangeRequestIdsRef.current.has(
        requestedChange.id
      ) ||
      !repositoryTargetsMatch(
        requestedChange.target,
        stableTarget
      )
    ) {
      return;
    }

    if (
      activeQueries.current.has("changes") &&
      activeChangesRequestIdRef.current === requestedChange.id
    ) {
      return;
    }

    void reload("changes", {
      preserveSelection: true
    });
  }, [
    reload,
    requestedChange,
    stableTarget,
    tab
  ]);

  useEffect(
    () => () => {
      generation.current += 1;
      cancelAll();
      changesCache.dispose();
    },
    [cancelAll, changesCache]
  );

  const currentTarget = dataTargetKey === targetKey;
  const currentLoadingScope = currentTarget && loadingTab === tab;
  // Effects still reset selection and validate the revision, but a cached
  // target can paint its own rows immediately during the navigation render.
  const cachedChanges = !currentTarget ? changesCache.peek(targetKey) : null;
  const visibleLoading = currentLoadingScope
    ? loading
    : initialTabLoading(Boolean(target), tab);
  return {
    changes: currentTarget ? changes : cachedChanges,
    diff: currentTarget ? diff : null,
    diffNotice: currentTarget ? diffNotice : null,
    history: currentTarget ? history : null,
    historyScope: currentTarget ? historyScope : null,
    historySearch: currentTarget ? historySearch : null,
    historyLoadMoreError: currentTarget ? historyLoadMoreError : null,
    commit: currentTarget ? commit : null,
    branches: currentTarget ? branches : null,
    selectedChange: currentTarget ? selectedChange : null,
    changeSelectionRequestId: currentTarget ? changeSelectionRequestId : null,
    selectedCommitHash: currentTarget ? selectedCommitHash : null,
    historyDetailOpen: currentTarget && historyDetailOpen,
    loading: cachedChanges ? { ...visibleLoading, changes: false } : visibleLoading,
    error: currentLoadingScope ? error : null,
    selectChange,
    selectCommit,
    selectHistoryScope,
    searchHistory,
    loadMoreHistory,
    reload,
    invalidate,
    clearError
  };
}

function initialTabLoading(
  hasTarget: boolean,
  tab: RepositoryTab
): Record<LoadingKey, boolean> {
  return {
    ...EMPTY_LOADING,
    changes: hasTarget && tab === "changes",
    history: hasTarget && (tab === "overview" || tab === "history"),
    branches: hasTarget && (tab === "branches" || tab === "history")
  };
}

export function resolveRequestedChangeSelection(
  changes: RepositoryChangesDto,
  request: RepositoryChangeSelectionRequest
): {
  change: ChangedPathDto;
  mode: RepositoryChangeSelectionRequest["mode"];
} | null {
  const change = findRequestedRepositoryChange(
    changes,
    request
  );
  if (!change) {
    return null;
  }

  return {
    change,
    mode: changeSupportsMode(change, request.mode)
      ? request.mode
      : preferredDiffMode(change)
  };
}

function sameHistoryScope(
  left: RepositoryHistoryScopeDto | null,
  right: RepositoryHistoryScopeDto | null
): boolean {
  if (!left || !right) {
    return left === right;
  }
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "all" && right.kind === "all") {
    return true;
  }
  if (left.kind === "ref" && right.kind === "ref") {
    return left.ref === right.ref;
  }
  if (left.kind === "refs" && right.kind === "refs") {
    const leftRefs = [...left.refs].sort();
    const rightRefs = [...right.refs].sort();
    return leftRefs.length === rightRefs.length
      && leftRefs.every((ref, index) => ref === rightRefs[index]);
  }
  return false;
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
