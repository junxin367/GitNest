import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type { RepositoryTargetDto } from "@gitnest/contracts";

import {
  createDiffContentSearchIndex,
  findIndexedDiffContentMatch,
  type DiffContentSearchIndex,
  type DiffViewerContentMatch,
  type DiffViewerFile
} from "../../shared/model/diffViewModel";

const MINIMUM_DIFF_SEARCH_QUERY_LENGTH = 2;
const MAX_INDEXED_DIFF_FILES = 200;
const MAX_INDEXED_DIFF_CHARACTERS = 24 * 1024 * 1024;
const DIFF_SEARCH_CONCURRENCY = 3;
const DIFF_SEARCH_CONTEXT_LINES = 3;
const DIFF_SEARCH_PUBLISH_INTERVAL_MS = 50;

let diffSearchQuerySequence = 0;

interface DiffSearchIndexCache {
  scopeKey: string;
  entries: Map<string, DiffContentSearchIndex | null>;
  totalCharacters: number;
  incomplete: boolean;
  failedFileCount: number;
}

interface DiffSearchIndexState {
  scopeKey: string;
  version: number;
  loading: boolean;
  incomplete: boolean;
  failedFileCount: number;
}

interface DiffSearchIndexPlan {
  scopeKey: string;
  target: RepositoryTargetDto | null;
  files: readonly DiffViewerFile[];
  omittedFileCount: number;
}

export interface ChangedDiffSearchResult {
  matches: readonly DiffViewerContentMatch[];
  loading: boolean;
  incomplete: boolean;
  failedFileCount: number;
  minimumQueryLength: number;
}

export function useChangedDiffSearch({
  enabled = true,
  files,
  query,
  revision,
  target
}: {
  enabled?: boolean;
  files: readonly DiffViewerFile[];
  query: string;
  revision: string;
  target: RepositoryTargetDto | undefined;
}): ChangedDiffSearchResult {
  const trimmedQuery = query.trim();
  const fileSignature = useMemo(
    () =>
      files
        .map(
          (file) =>
            `${file.key}\u0000${file.status}\u0000${file.change.indexStatus}\u0000${file.change.worktreeStatus}`
        )
        .join("\u0001"),
    [files]
  );
  const scopeKey = target
    ? `${target.repositoryId}\u0000${target.worktreeId}\u0000${revision}\u0000${fileSignature}`
    : "";
  const indexPlan = useMemo<DiffSearchIndexPlan>(
    () => ({
      scopeKey,
      target: target
        ? {
            repositoryId: target.repositoryId,
            worktreeId: target.worktreeId
          }
        : null,
      files: files.slice(0, MAX_INDEXED_DIFF_FILES),
      omittedFileCount: Math.max(
        files.length - MAX_INDEXED_DIFF_FILES,
        0
      )
    }),
    [scopeKey]
  );
  const shouldSearch =
    enabled &&
    Boolean(indexPlan.target) &&
    indexPlan.files.length > 0 &&
    trimmedQuery.length >= MINIMUM_DIFF_SEARCH_QUERY_LENGTH;
  const cacheRef = useRef<DiffSearchIndexCache>({
    scopeKey: "",
    entries: new Map(),
    totalCharacters: 0,
    incomplete: false,
    failedFileCount: 0
  });
  const activeQueryIdsRef = useRef(new Set<string>());
  const generationRef = useRef(0);
  const publishVersionRef = useRef(0);
  const [indexState, setIndexState] =
    useState<DiffSearchIndexState>({
      scopeKey: "",
      version: 0,
      loading: false,
      incomplete: false,
      failedFileCount: 0
    });

  useEffect(() => {
    const generation = ++generationRef.current;
    let active = true;
    let publishTimer:
      | ReturnType<typeof setTimeout>
      | undefined;

    cancelActiveQueries(activeQueryIdsRef.current);

    if (cacheRef.current.scopeKey !== indexPlan.scopeKey) {
      cacheRef.current = {
        scopeKey: indexPlan.scopeKey,
        entries: new Map(),
        totalCharacters: 0,
        incomplete: indexPlan.omittedFileCount > 0,
        failedFileCount: 0
      };
    }

    const publish = (loading: boolean) => {
      if (
        !active ||
        generationRef.current !== generation
      ) {
        return;
      }
      const cache = cacheRef.current;
      setIndexState({
        scopeKey: indexPlan.scopeKey,
        version: ++publishVersionRef.current,
        loading,
        incomplete: cache.incomplete,
        failedFileCount: cache.failedFileCount
      });
    };
    const clearScheduledPublish = () => {
      if (publishTimer === undefined) {
        return;
      }
      clearTimeout(publishTimer);
      publishTimer = undefined;
    };
    const schedulePublish = () => {
      if (publishTimer !== undefined) {
        return;
      }
      publishTimer = setTimeout(() => {
        publishTimer = undefined;
        publish(true);
      }, DIFF_SEARCH_PUBLISH_INTERVAL_MS);
    };
    const cleanup = () => {
      active = false;
      clearScheduledPublish();
      cancelActiveQueries(activeQueryIdsRef.current);
    };

    const searchTarget = indexPlan.target;
    if (!shouldSearch || !searchTarget) {
      publish(false);
      return cleanup;
    }

    const pendingFiles = indexPlan.files.filter(
      (file) => !cacheRef.current.entries.has(file.key)
    );
    if (pendingFiles.length === 0) {
      publish(false);
      return cleanup;
    }

    let cursor = 0;
    publish(true);

    const worker = async () => {
      while (
        active &&
        generationRef.current === generation
      ) {
        const file = pendingFiles[cursor];
        if (!file) {
          return;
        }
        if (
          cacheRef.current.totalCharacters >=
          MAX_INDEXED_DIFF_CHARACTERS
        ) {
          cacheRef.current.incomplete = true;
          return;
        }
        cursor += 1;

        const queryId =
          `diff_search_${Date.now()}_${++diffSearchQuerySequence}`;
        activeQueryIdsRef.current.add(queryId);

        try {
          const result =
            await window.gitnest.repository.getDiff({
              queryId,
              target: searchTarget,
              path: file.path,
              mode: file.mode,
              contextLines: DIFF_SEARCH_CONTEXT_LINES,
              intent: "search"
            });

          if (
            !active ||
            generationRef.current !== generation
          ) {
            return;
          }

          if (
            result.ok &&
            result.value.target.repositoryId ===
              searchTarget.repositoryId &&
            result.value.target.worktreeId ===
              searchTarget.worktreeId &&
            result.value.diff.path === file.path &&
            result.value.diff.mode === file.mode
          ) {
            const diff = result.value.diff;
            const remainingCharacters = Math.max(
              MAX_INDEXED_DIFF_CHARACTERS -
                cacheRef.current.totalCharacters,
              0
            );
            if (diff.binary || diff.content.length === 0) {
              cacheRef.current.entries.set(
                file.key,
                createDiffContentSearchIndex("")
              );
              if (diff.truncated) {
                cacheRef.current.incomplete = true;
              }
            } else if (remainingCharacters === 0) {
              cacheRef.current.incomplete = true;
            } else {
              const content = diff.content.slice(
                0,
                remainingCharacters
              );
              cacheRef.current.entries.set(
                file.key,
                createDiffContentSearchIndex(content)
              );
              cacheRef.current.totalCharacters +=
                content.length;
              if (
                diff.truncated ||
                content.length < diff.content.length
              ) {
                cacheRef.current.incomplete = true;
              }
            }
          } else if (
            result.ok ||
            result.error.code !== "COMMAND_CANCELLED"
          ) {
            cacheRef.current.entries.set(file.key, null);
            cacheRef.current.incomplete = true;
            cacheRef.current.failedFileCount += 1;
          }
        } catch {
          if (
            active &&
            generationRef.current === generation
          ) {
            cacheRef.current.entries.set(file.key, null);
            cacheRef.current.incomplete = true;
            cacheRef.current.failedFileCount += 1;
          }
        } finally {
          activeQueryIdsRef.current.delete(queryId);
        }

        schedulePublish();
      }
    };

    void Promise.all(
      Array.from(
        {
          length: Math.min(
            DIFF_SEARCH_CONCURRENCY,
            pendingFiles.length
          )
        },
        () => worker()
      )
    ).then(() => {
      clearScheduledPublish();
      publish(false);
    });

    return cleanup;
  }, [indexPlan, shouldSearch]);

  const matches = useMemo<DiffViewerContentMatch[]>(() => {
    if (
      !shouldSearch ||
      indexState.scopeKey !== scopeKey ||
      cacheRef.current.scopeKey !== scopeKey
    ) {
      return [];
    }

    return indexPlan.files.flatMap((file) => {
      const searchIndex =
        cacheRef.current.entries.get(file.key);
      if (!searchIndex) {
        return [];
      }
      const match = findIndexedDiffContentMatch(
        searchIndex,
        trimmedQuery
      );
      return match
        ? [
            {
              fileKey: file.key,
              preview: match.preview,
              query: trimmedQuery
            }
          ]
        : [];
    });
  }, [
    indexPlan.files,
    indexState.scopeKey,
    indexState.version,
    scopeKey,
    shouldSearch,
    trimmedQuery
  ]);

  return {
    matches,
    loading:
      shouldSearch &&
      (indexState.scopeKey !== scopeKey ||
        indexState.loading),
    incomplete:
      indexState.scopeKey === scopeKey
        ? indexState.incomplete
        : indexPlan.omittedFileCount > 0,
    failedFileCount:
      indexState.scopeKey === scopeKey
        ? indexState.failedFileCount
        : 0,
    minimumQueryLength: MINIMUM_DIFF_SEARCH_QUERY_LENGTH
  };
}

function cancelActiveQueries(queryIds: Set<string>) {
  for (const queryId of queryIds) {
    void window.gitnest.repository.cancelQuery({ queryId });
  }
  queryIds.clear();
}
