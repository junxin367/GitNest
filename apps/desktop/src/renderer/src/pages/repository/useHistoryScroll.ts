import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { HISTORY_GRAPH_ROW_HEIGHT } from "./historyGraph";

interface HistoryScrollOptions {
  resetKey: string;
  commits: readonly { hash: string }[];
  nextOffset: number | undefined;
  loading: boolean;
  failed: boolean;
  selectedHash?: string | null;
  loadMore(): Promise<void>;
}

export function historyVisibleWindow(count: number, scrollTop: number, height: number) {
  if (height <= 0) return { start: 0, end: 0 };
  const buffer = Math.ceil(height / HISTORY_GRAPH_ROW_HEIGHT);
  const first = Math.max(0, Math.floor(scrollTop / HISTORY_GRAPH_ROW_HEIGHT));
  return {
    start: Math.max(0, first - buffer),
    end: Math.min(count, first + buffer * 2 + 1)
  };
}

export function useHistoryScroll(options: HistoryScrollOptions) {
  const listRef = useRef<HTMLDivElement>(null);
  const latest = useRef(options);
  latest.current = options;
  const requested = useRef<string | null>(null);
  const anchor = useRef<{ hash: string; offset: number } | null>(null);
  const focusedHash = useRef<string | null>(null);
  const ownsFocus = useRef(false);
  const measuredLayout = useRef({ height: 0, selectedHash: options.selectedHash });
  const [window, setWindow] = useState({ start: 0, end: 0 });

  useLayoutEffect(() => {
    requested.current = null;
    anchor.current = null;
    focusedHash.current = null;
    ownsFocus.current = false;
    const list = listRef.current;
    if (!list) {
      setWindow({ start: 0, end: 0 });
      return;
    }
    list.scrollTop = 0;
    setWindow(historyVisibleWindow(latest.current.commits.length, 0, list.clientHeight));
  }, [options.resetKey]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const previous = anchor.current;
    if (previous) {
      const index = options.commits.findIndex((commit) => commit.hash === previous.hash);
      if (index >= 0) {
        list.scrollTop = index * HISTORY_GRAPH_ROW_HEIGHT + previous.offset;
      }
    }
  }, [options.commits]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (
      !list || !ownsFocus.current
      || (document.activeElement !== list && document.activeElement !== document.body)
    ) return;
    const row = focusedHash.current
      ? list.querySelector<HTMLElement>(`[data-history-hash="${focusedHash.current}"]`)
      : null;
    (row ?? list).focus({ preventScroll: true });
  }, [window, options.commits]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let frame: number | undefined;
    const measure = () => {
      frame = undefined;
      const { commits, resetKey, nextOffset, loading, failed, loadMore } = latest.current;
      const height = list.clientHeight;
      const previousLayout = measuredLayout.current;
      const keepSelectionVisible = previousLayout.selectedHash !== latest.current.selectedHash
        || (height > 0 && height < previousLayout.height);
      measuredLayout.current = { height, selectedHash: latest.current.selectedHash };
      // Opening the detail panel reduces the viewport; keep its selected row visible.
      if (height > 0 && keepSelectionVisible && latest.current.selectedHash) {
        const selectedIndex = commits.findIndex(commit => commit.hash === latest.current.selectedHash);
        if (selectedIndex >= 0) {
          const headerHeight = list.querySelector<HTMLElement>(".history-table-header")?.offsetHeight ?? 0;
          const top = headerHeight + selectedIndex * HISTORY_GRAPH_ROW_HEIGHT;
          if (top < list.scrollTop + headerHeight) list.scrollTop = top - headerHeight;
          else if (top + HISTORY_GRAPH_ROW_HEIGHT > list.scrollTop + height) {
            list.scrollTop = top + HISTORY_GRAPH_ROW_HEIGHT - height;
          }
        }
      }
      const range = historyVisibleWindow(commits.length, list.scrollTop, height);
      const active = document.activeElement;
      const row = active instanceof HTMLElement ? active.closest<HTMLElement>("[data-history-hash]") : null;
      if (row && list.contains(row)) {
        focusedHash.current = row.dataset.historyHash ?? null;
        const focusedIndex = commits.findIndex(commit => commit.hash === focusedHash.current);
        if (focusedIndex < range.start || focusedIndex >= range.end) {
          // Move focus before React unmounts the row, so it cannot fall onto body.
          list.focus({ preventScroll: true });
        }
      }
      setWindow((current) => current.start === range.start && current.end === range.end ? current : range);
      const index = Math.max(0, Math.floor(list.scrollTop / HISTORY_GRAPH_ROW_HEIGHT));
      const commit = commits[index];
      anchor.current = commit ? {
        hash: commit.hash,
        offset: list.scrollTop - index * HISTORY_GRAPH_ROW_HEIGHT
      } : null;
      const requestKey = `${resetKey}:${nextOffset}`;
      if (
        height > 0 && nextOffset !== undefined && !loading && !failed
        && requested.current !== requestKey
        && list.scrollHeight - list.scrollTop - height <= height
      ) {
        requested.current = requestKey;
        void loadMore().finally(() => {
          if (requested.current === requestKey) requested.current = null;
        });
      }
    };
    const schedule = () => {
      if (document.hidden) {
        measure();
        return;
      }
      if (frame === undefined) frame = requestAnimationFrame(measure);
    };
    const rememberFocus = (event: FocusEvent) => {
      const target = event.target;
      const row = target instanceof HTMLElement ? target.closest<HTMLElement>("[data-history-hash]") : null;
      ownsFocus.current = target === list || Boolean(row && list.contains(row));
      if (row && ownsFocus.current) focusedHash.current = row.dataset.historyHash ?? null;
      if (ownsFocus.current) schedule();
    };
    const releaseFocus = (event: PointerEvent) => {
      if (event.target instanceof Node && !list.contains(event.target)) ownsFocus.current = false;
    };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resize?.observe(list);
    list.addEventListener("scroll", schedule, { passive: true });
    // Capture the owner synchronously, before a refresh can remove its DOM row.
    document.addEventListener("focusin", rememberFocus);
    document.addEventListener("pointerdown", releaseFocus);
    measure();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      resize?.disconnect();
      list.removeEventListener("scroll", schedule);
      document.removeEventListener("focusin", rememberFocus);
      document.removeEventListener("pointerdown", releaseFocus);
    };
  }, [options.resetKey, options.commits, options.nextOffset, options.loading, options.failed, options.selectedHash]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = listRef.current;
    if (!list || event.target !== list || !["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return;
    const first = Math.max(0, Math.floor(list.scrollTop / HISTORY_GRAPH_ROW_HEIGHT));
    const index = event.key === "ArrowUp"
      ? Math.min(options.commits.length - 1, first + Math.max(0, Math.floor(list.clientHeight / HISTORY_GRAPH_ROW_HEIGHT) - 2))
      : first;
    const hash = options.commits[index]?.hash;
    if (!hash) return;
    const row = list.querySelector<HTMLElement>(`[data-history-hash="${hash}"]`);
    if (!row) return;
    event.preventDefault();
    focusedHash.current = hash;
    row.focus({ preventScroll: true });
  };

  return {
    listRef,
    onKeyDown,
    start: Math.min(window.start, options.commits.length),
    end: Math.min(window.end, options.commits.length)
  };
}
