import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FileHistoryBridge, FileHistoryDiffResultDto,
  FileHistoryEntryDto, FileHistoryResultDto, RepositoryTargetDto
} from "@gitnest/contracts";
import { DetailCache } from "./detailCache";

export interface FileHistoryScope {
  bridge: FileHistoryBridge;
  target: RepositoryTargetDto;
  path: string;
  originalPath?: string;
  revision?: string;
}
interface QueryState<T> { key: string; value?: T; error?: string; loading: boolean }
const PAGE_SIZE = 50;
let querySequence = 0;

/** The dialog remounts this hook for each target/path/revision scope. */
export function useFileHistory({ bridge, target, path, originalPath, revision }: FileHistoryScope) {
  const [history, setHistory] = useState<FileHistoryResultDto | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [selected, setSelected] = useState<FileHistoryEntryDto | null>(null);
  const [retry, setRetry] = useState(0);
  const [detailRetry, setDetailRetry] = useState(0);
  const [diff, setDiff] = useState<QueryState<FileHistoryDiffResultDto>>({ key: "", loading: false });
  const alive = useRef(true);
  const pending = useRef(new Set<string>());
  const paging = useRef(false);
  const [diffCache] = useState(() => new DetailCache<FileHistoryDiffResultDto>(12, 4 * 1024 * 1024));
  const newQuery = () => {
    const id = `file-history-${Date.now()}-${++querySequence}`;
    pending.current.add(id);
    return id;
  };
  const cancelQuery = useCallback((queryId: string) => {
    if (!pending.current.delete(queryId)) return;
    void bridge.cancel({ queryId }).catch(() => undefined);
  }, [bridge]);
  const cancel = useCallback(() => {
    alive.current = false;
    [...pending.current].forEach(cancelQuery);
    diffCache.clear();
  }, [cancelQuery, diffCache]);
  useEffect(() => {
    alive.current = true;
    return cancel;
  }, [cancel]);

  useEffect(() => {
    let current = true;
    const queryId = newQuery();
    setHistoryLoading(true); setHistoryError("");
    void bridge.history({
      queryId, target, path, limit: PAGE_SIZE,
      ...(originalPath ? { originalPath } : {}),
      ...(revision ? { revision } : {})
    }).then(result => {
      if (!current || !alive.current) return;
      if (result.ok) {
        setHistory(result.value);
        setSelected(result.value.entries[0] ?? null);
      } else setHistoryError(result.error.message);
    }, (error: unknown) => {
      if (current && alive.current) setHistoryError(String(error));
    }).finally(() => {
      pending.current.delete(queryId);
      if (current && alive.current) setHistoryLoading(false);
    });
    return () => { current = false; cancelQuery(queryId); };
  }, [bridge, retry, cancelQuery]);

  const loadMore = useCallback(async () => {
    if (!history?.revision || history.nextOffset === null || paging.current) return;
    paging.current = true; setHistoryLoading(true); setHistoryError("");
    const queryId = newQuery();
    try {
      const result = await bridge.history({
        queryId, target, path: history.path, revision: history.revision,
        offset: history.nextOffset, limit: PAGE_SIZE
      });
      if (!alive.current) return;
      if (result.ok) setHistory(previous => {
        if (!previous) return previous;
        const seen = new Set(previous.entries.map(entry => JSON.stringify([entry.hash, entry.path])));
        const added = result.value.entries.filter(entry => {
          const key = JSON.stringify([entry.hash, entry.path]);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return { ...result.value, entries: [...previous.entries, ...added] };
      });
      else setHistoryError(result.error.message);
    } catch (error) {
      if (alive.current) setHistoryError(String(error));
    } finally {
      pending.current.delete(queryId); paging.current = false;
      if (alive.current) setHistoryLoading(false);
    }
  }, [bridge, history, target, path]);

  const selectionKey = selected ? JSON.stringify([selected.hash, selected.path, selected.previousPath]) : "";
  useEffect(() => {
    if (!selected || !alive.current) return;
    // Only full object IDs are immutable. Short refs must always be resolved by Git.
    const cacheable = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(selected.hash);
    if (cacheable) {
      const cachedDiff = diffCache.get(selectionKey);
      if (cachedDiff) { setDiff({ key: selectionKey, loading: false, value: cachedDiff }); return; }
    }
    let current = true;
    const queryId = newQuery();
    setDiff({ key: selectionKey, loading: true });
    void bridge.diff({
      queryId, target, path: selected.path, commitHash: selected.hash,
      ...(selected.previousPath ? { previousPath: selected.previousPath } : {})
    }).then(result => {
      if (!current || !alive.current) return;
      if (result.ok && cacheable) {
        diffCache.set(selectionKey, result.value,
          512 + 2 * (result.value.patch.length + result.value.path.length + (result.value.message?.length ?? 0)));
      }
      setDiff(result.ok
        ? { key: selectionKey, loading: false, value: result.value }
        : { key: selectionKey, loading: false, error: result.error.message });
    }, (error: unknown) => {
      if (current && alive.current) setDiff({ key: selectionKey, loading: false, error: String(error) });
    }).finally(() => pending.current.delete(queryId));
    return () => { current = false; cancelQuery(queryId); };
  }, [bridge, selectionKey, detailRetry, cancelQuery, diffCache]);

  return {
    history, historyError, historyLoading, selected, setSelected, loadMore, cancel,
    retry: () => setRetry(value => value + 1),
    retryDetail: () => setDetailRetry(value => value + 1),
    diff: diff.key === selectionKey ? diff : { key: selectionKey, loading: Boolean(selected) }
  };
}
