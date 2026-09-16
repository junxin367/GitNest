import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  GitReadErrorDto,
  RepositoryStashFilesDto,
  RepositoryStashMutationAction,
  RepositoryStashesDto,
  RepositoryTargetDto,
  StashSummaryDto
} from "@gitnest/contracts";

import { formatLocalMutationErrorMessage } from "./useRepositoryMutations";

type LoadingKey = "stashes" | "files";
export type { RepositoryStashMutationAction };

interface RepositoryStashMutationHooks {
  afterMutation(): Promise<void>;
}

export interface RepositoryStashesController {
  stashes: RepositoryStashesDto | null;
  stashFiles: RepositoryStashFilesDto | null;
  selectedStashRef: string | null;
  loading: Readonly<Record<LoadingKey, boolean>>;
  error: GitReadErrorDto | null;
  mutationError: GitReadErrorDto | null;
  notice: string | null;
  active: RepositoryStashMutationAction | null;
  load(): Promise<void>;
  reload(): Promise<void>;
  selectStash(stashRef: string): Promise<void>;
  mutateStash(
    action: RepositoryStashMutationAction,
    stash: StashSummaryDto
  ): Promise<boolean>;
  clearError(): void;
  clearMutationFeedback(): void;
}

export interface RepositoryStashViewController {
  active: boolean;
  setActive(active: boolean): void;
  toggle(): boolean;
}

const EMPTY_LOADING: Record<LoadingKey, boolean> = {
  stashes: false,
  files: false
};
const selectedStashByScope = new Map<
  string,
  { ref: string; hash: string }
>();
const stashViewActiveByScope = new Map<string, boolean>();

export function useRepositoryStashView(
  scopeKey: string
): RepositoryStashViewController {
  const [state, setState] = useState(() => ({
    scopeKey,
    active: stashViewActiveByScope.get(scopeKey) ?? false
  }));
  const active =
    state.scopeKey === scopeKey
      ? state.active
      : (stashViewActiveByScope.get(scopeKey) ?? false);
  const setActive = useCallback(
    (nextActive: boolean) => {
      stashViewActiveByScope.set(scopeKey, nextActive);
      setState({
        scopeKey,
        active: nextActive
      });
    },
    [scopeKey]
  );
  const toggle = useCallback(() => {
    const nextActive = !(
      state.scopeKey === scopeKey
        ? state.active
        : (stashViewActiveByScope.get(scopeKey) ?? false)
    );
    stashViewActiveByScope.set(scopeKey, nextActive);
    setState({
      scopeKey,
      active: nextActive
    });
    return nextActive;
  }, [scopeKey, state.active, state.scopeKey]);

  return {
    active,
    setActive,
    toggle
  };
}

export function useRepositoryStashes(
  target: RepositoryTargetDto | undefined,
  scopeKey?: string,
  mutationHooks?: RepositoryStashMutationHooks
): RepositoryStashesController {
  const targetKey = target
    ? `${target.repositoryId}:${target.worktreeId}`
    : "";
  const selectionScopeKey = scopeKey ?? targetKey;
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
  const [stashes, setStashes] =
    useState<RepositoryStashesDto | null>(null);
  const [stashFiles, setStashFiles] =
    useState<RepositoryStashFilesDto | null>(null);
  const [selectedStashRef, setSelectedStashRef] = useState<
    string | null
  >(
    () =>
      selectedStashByScope.get(selectionScopeKey)?.ref ?? null
  );
  const [loading, setLoading] =
    useState<Record<LoadingKey, boolean>>(EMPTY_LOADING);
  const [error, setError] =
    useState<GitReadErrorDto | null>(null);
  const [mutationError, setMutationError] =
    useState<GitReadErrorDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [active, setActive] =
    useState<RepositoryStashMutationAction | null>(null);
  const stashesRef =
    useRef<RepositoryStashesDto | null>(null);
  const selectedStashRefRef = useRef<string | null>(
    selectedStashRef
  );
  const selectedStashHashRef = useRef<string | null>(
    selectedStashByScope.get(selectionScopeKey)?.hash ?? null
  );
  const activeQueries = useRef(new Map<LoadingKey, string>());
  const sequence = useRef(0);
  const generation = useRef(0);
  const activeMutation = useRef<symbol | null>(null);
  const afterMutationRef = useRef(
    mutationHooks?.afterMutation
  );
  afterMutationRef.current = mutationHooks?.afterMutation;

  const cancelAll = useCallback(() => {
    for (const queryId of activeQueries.current.values()) {
      void window.gitnest.repository.cancelQuery({ queryId });
    }
    activeQueries.current.clear();
  }, []);

  const cancelQuery = useCallback((key: LoadingKey) => {
    const queryId = activeQueries.current.get(key);
    if (!queryId) {
      return;
    }

    void window.gitnest.repository.cancelQuery({ queryId });
    activeQueries.current.delete(key);
  }, []);

  const createQuery = useCallback(
    (key: LoadingKey) => {
      cancelQuery(key);
      const queryId = `stash_${key}_${Date.now()}_${++sequence.current}`;
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
    (key: LoadingKey, queryId: string) => {
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

  const selectStash = useCallback(
    async (stashRef: string) => {
      if (!stableTarget) {
        return;
      }

      const expectedHash =
        stashesRef.current?.stashes.find(
          (stash) => stash.ref === stashRef
        )?.hash ?? null;
      selectedStashRefRef.current = stashRef;
      selectedStashHashRef.current = expectedHash;
      if (expectedHash) {
        selectedStashByScope.set(selectionScopeKey, {
          ref: stashRef,
          hash: expectedHash
        });
      }
      setSelectedStashRef(stashRef);
      setStashFiles(null);
      setError(null);

      const queryId = createQuery("files");
      const requestGeneration = generation.current;
      setLoadingKey("files", true);

      try {
        const result =
          await window.gitnest.repository.getStashFiles({
            queryId,
            target: stableTarget,
            stashRef
          });

        if (
          !isCurrentQuery(
            "files",
            queryId,
            requestGeneration
          )
        ) {
          return;
        }

        if (result.ok) {
          if (
            expectedHash &&
            result.value.stash.hash !== expectedHash
          ) {
            setError({
              code: "COMMAND_FAILED",
              message:
                "储藏列表已在外部发生变化，请重新读取后再试。",
              details: {}
            });
            setStashFiles(null);
          } else {
            setStashFiles(result.value);
          }
        } else if (result.error.code !== "COMMAND_CANCELLED") {
          setError(result.error);
        }
      } catch (reason) {
        if (
          isCurrentQuery(
            "files",
            queryId,
            requestGeneration
          )
        ) {
          setError(unexpectedError(reason));
        }
      } finally {
        if (
          finishQuery("files", queryId) &&
          requestGeneration === generation.current
        ) {
          setLoadingKey("files", false);
        }
      }
    },
    [
      createQuery,
      finishQuery,
      isCurrentQuery,
      selectionScopeKey,
      setLoadingKey,
      stableTarget
    ]
  );

  const reload = useCallback(async () => {
    if (!stableTarget) {
      return;
    }

    const queryId = createQuery("stashes");
    const requestGeneration = generation.current;
    setLoadingKey("stashes", true);
    setError(null);

    try {
      const result =
        await window.gitnest.repository.getStashes({
          queryId,
          target: stableTarget,
          limit: 50
        });

      if (
        !isCurrentQuery(
          "stashes",
          queryId,
          requestGeneration
        )
      ) {
        return;
      }

      if (result.ok) {
        stashesRef.current = result.value;
        setStashes(result.value);
        const preservedRef = selectedStashRefRef.current;
        const preservedHash = selectedStashHashRef.current;
        const nextStash =
          result.value.stashes.find(
            (stash) => stash.hash === preservedHash
          ) ??
          (!preservedHash
            ? result.value.stashes.find(
                (stash) => stash.ref === preservedRef
              )
            : undefined) ??
          result.value.stashes[0];

        if (nextStash) {
          await selectStash(nextStash.ref);
        } else {
          selectedStashRefRef.current = null;
          selectedStashHashRef.current = null;
          selectedStashByScope.delete(selectionScopeKey);
          setSelectedStashRef(null);
          setStashFiles(null);
          cancelQuery("files");
          setLoadingKey("files", false);
        }
      } else if (result.error.code !== "COMMAND_CANCELLED") {
        setError(result.error);
      }
    } catch (reason) {
      if (
        isCurrentQuery(
          "stashes",
          queryId,
          requestGeneration
        )
      ) {
        setError(unexpectedError(reason));
      }
    } finally {
      if (
        finishQuery("stashes", queryId) &&
        requestGeneration === generation.current
      ) {
        setLoadingKey("stashes", false);
      }
    }
  }, [
    cancelQuery,
    createQuery,
    finishQuery,
    isCurrentQuery,
    selectStash,
    selectionScopeKey,
    setLoadingKey,
    stableTarget
  ]);

  const load = useCallback(async () => {
    if (stashesRef.current) {
      return;
    }
    await reload();
  }, [reload]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const clearMutationFeedback = useCallback(() => {
    setMutationError(null);
    setNotice(null);
  }, []);

  const mutateStash = useCallback(
    async (
      action: RepositoryStashMutationAction,
      stash: StashSummaryDto
    ): Promise<boolean> => {
      if (!stableTarget || activeMutation.current) {
        return false;
      }

      const mutationToken = Symbol("stash-mutation");
      const requestGeneration = generation.current;
      activeMutation.current = mutationToken;
      setActive(action);
      setMutationError(null);
      setNotice(null);

      try {
        const result =
          await window.gitnest.repository.mutateStash({
            target: stableTarget,
            stashRef: stash.ref,
            stashHash: stash.hash,
            action
          });

        if (requestGeneration !== generation.current) {
          return false;
        }

        if (!result.ok) {
          setMutationError(
            formatStashMutationError(action, result.error)
          );
          return false;
        }

        if (action === "drop" || action === "pop") {
          preserveNextSelectionAfterRemoval(
            stashesRef.current,
            stash,
            selectionScopeKey,
            selectedStashRefRef,
            selectedStashHashRef
          );
        }
        setNotice(stashMutationNotice(action, stash.ref));
        await reload();
        return true;
      } catch (reason) {
        if (requestGeneration === generation.current) {
          setMutationError(
            formatStashMutationError(
              action,
              unexpectedMutationError(reason)
            )
          );
        }
        return false;
      } finally {
        if (requestGeneration === generation.current) {
          try {
            await afterMutationRef.current?.();
          } catch {
            // Repository refresh reports its own read error.
          }
        }
        if (activeMutation.current === mutationToken) {
          activeMutation.current = null;
          if (requestGeneration === generation.current) {
            setActive(null);
          }
        }
      }
    },
    [reload, selectionScopeKey, stableTarget]
  );

  useEffect(() => {
    generation.current += 1;
    activeMutation.current = null;
    cancelAll();
    const restoredSelection =
      selectedStashByScope.get(selectionScopeKey);
    selectedStashRefRef.current =
      restoredSelection?.ref ?? null;
    selectedStashHashRef.current =
      restoredSelection?.hash ?? null;
    setSelectedStashRef(restoredSelection?.ref ?? null);
    stashesRef.current = null;
    setStashes(null);
    setStashFiles(null);
    setLoading(EMPTY_LOADING);
    setError(null);
    setMutationError(null);
    setNotice(null);
    setActive(null);
  }, [cancelAll, selectionScopeKey, targetKey]);

  useEffect(
    () => () => {
      generation.current += 1;
      cancelAll();
    },
    [cancelAll]
  );

  return {
    stashes,
    stashFiles,
    selectedStashRef,
    loading,
    error,
    mutationError,
    notice,
    active,
    load,
    reload,
    selectStash,
    mutateStash,
    clearError,
    clearMutationFeedback
  };
}

function unexpectedError(reason: unknown): GitReadErrorDto {
  return {
    code: "COMMAND_FAILED",
    message:
      reason instanceof Error
        ? reason.message
        : "储藏查询失败。",
    details: {}
  };
}

function unexpectedMutationError(
  reason: unknown
): GitReadErrorDto {
  return {
    code: "COMMAND_FAILED",
    message:
      reason instanceof Error
        ? reason.message
        : "储藏操作失败。",
    details: {}
  };
}

function formatStashMutationError(
  action: RepositoryStashMutationAction,
  error: GitReadErrorDto
): GitReadErrorDto {
  const staleStash =
    error.message.includes("selected stash changed") ||
    (typeof error.details.expectedHash === "string" &&
      typeof error.details.currentHash === "string");
  const diagnosticMessage =
    formatLocalMutationErrorMessage(error);
  const message = staleStash
    ? "储藏列表已变化，请重新读取后再试。"
    : diagnosticMessage;

  if (staleStash) {
    return {
      ...error,
      message: `${message} 已重新读取工作区状态；未执行储藏写操作，储藏记录仍保留。`
    };
  }

  if (action === "apply") {
    return {
      ...error,
      message: `${message} 工作区可能已产生变更或冲突，已重新读取工作区状态；储藏记录仍保留。`
    };
  }
  if (action === "pop") {
    return {
      ...error,
      message: `${message} 工作区可能已产生变更或冲突，已重新读取工作区状态；储藏记录仍保留。`
    };
  }
  return {
    ...error,
    message
  };
}

function stashMutationNotice(
  action: RepositoryStashMutationAction,
  stashRef: string
): string {
  if (action === "apply") {
    return `${stashRef} 已恢复到工作区，储藏记录仍然保留。`;
  }
  if (action === "drop") {
    return `${stashRef} 已删除。`;
  }
  return `${stashRef} 已恢复到工作区并从储藏列表删除。`;
}

function preserveNextSelectionAfterRemoval(
  stashes: RepositoryStashesDto | null,
  removedStash: StashSummaryDto,
  selectionScopeKey: string,
  selectedStashRefRef: {
    current: string | null;
  },
  selectedStashHashRef: {
    current: string | null;
  }
): void {
  const currentIndex =
    stashes?.stashes.findIndex(
      (stash) => stash.hash === removedStash.hash
    ) ?? -1;
  const nextStash =
    currentIndex >= 0
      ? (stashes?.stashes[currentIndex + 1] ??
        stashes?.stashes[currentIndex - 1])
      : undefined;

  selectedStashRefRef.current = nextStash?.ref ?? null;
  selectedStashHashRef.current = nextStash?.hash ?? null;
  if (nextStash) {
    selectedStashByScope.set(selectionScopeKey, {
      ref: nextStash.ref,
      hash: nextStash.hash
    });
  } else {
    selectedStashByScope.delete(selectionScopeKey);
  }
}
