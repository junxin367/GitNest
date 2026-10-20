import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject
} from "react";

import type { ChangeTreeNode } from "../../shared/model/changeTree";
import type { DiffViewerFile, DiffViewerMode } from "../../shared/model/diffViewModel";

export const VIRTUAL_DIFF_FILE_THRESHOLD = 500;
const OVERSCAN_ROWS = 8;
const DEFAULT_VIEWPORT_HEIGHT = 600;

export interface DiffSelectionReveal {
  fileKey: string;
  requestKey: string;
}

interface DirectoryState {
  getSnapshot(): ReadonlySet<string>;
  subscribe(listener: () => void): () => void;
}

type VisibleRow =
  | { kind: "file"; key: string; fileKey: string; depth: number }
  | { kind: "directory"; key: string; node: ChangeTreeNode; depth: number };

export function VirtualDiffSection({
  files,
  nodes,
  mode,
  directoryState,
  scrollContainer,
  layoutKey,
  selectionReveal,
  onSelectionRevealed,
  renderFile,
  renderDirectory
}: {
  files: readonly DiffViewerFile[];
  nodes: readonly ChangeTreeNode[] | undefined;
  mode: DiffViewerMode;
  directoryState: DirectoryState;
  scrollContainer: RefObject<HTMLDivElement | null>;
  layoutKey: string;
  selectionReveal: DiffSelectionReveal | null;
  onSelectionRevealed(requestKey: string): void;
  renderFile(file: DiffViewerFile, depth: number): ReactNode;
  renderDirectory(node: ChangeTreeNode, depth: number): ReactNode;
}) {
  const collapsed = useSyncExternalStore(directoryState.subscribe, directoryState.getSnapshot);
  const host = useRef<HTMLDivElement>(null);
  const sectionOffset = useRef(0);
  const heights = useRef(new Map<string, number>());
  const observer = useRef<ResizeObserver | null>(null);
  const [measurementVersion, setMeasurementVersion] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: DEFAULT_VIEWPORT_HEIGHT });
  const structureKey = useMemo(() => files.map((file) => file.key).join("\0"), [files]);
  const filesByKey = useMemo(() => new Map(files.map((file) => [file.key, file])), [files]);
  const rows = useMemo<VisibleRow[]>(() => {
    if (!nodes) {
      return files.map((file) => ({
        kind: "file", key: `file:${file.key}`, fileKey: file.key, depth: 0
      }));
    }
    const filesByPath = new Map(files.map((file) => [file.path, file]));
    const result: VisibleRow[] = [];
    const visit = (children: readonly ChangeTreeNode[], depth: number) => {
      for (const node of children) {
        if (node.directory) {
          result.push({ kind: "directory", key: `directory:${node.path}`, node, depth });
          if (!collapsed.has(`${mode}:${node.path}`)) visit(node.children, depth + 1);
        } else {
          const file = filesByPath.get(node.path);
          if (file) result.push({
            kind: "file", key: `file:${file.key}`, fileKey: file.key, depth
          });
        }
      }
    };
    visit(nodes, 0);
    return result;
    // File contents and line counts do not change the visible tree structure.
  }, [structureKey, nodes, collapsed, mode]);
  const fileIndexes = useMemo(() => {
    const indexes = new Map<string, number>();
    rows.forEach((row, index) => {
      if (row.kind === "file") indexes.set(row.fileKey, index);
    });
    return indexes;
  }, [rows]);
  const offsets = useMemo(() => {
    const values = [0];
    for (const row of rows) {
      values.push(values[values.length - 1]! +
        (heights.current.get(row.key) ?? (row.kind === "file" ? 44 : 32)));
    }
    return values;
  }, [rows, measurementVersion]);
  const totalHeight = offsets[offsets.length - 1]!;
  const { start, end } = useMemo(() => {
    if (viewport.top >= totalHeight || viewport.top + viewport.height <= 0) {
      return { start: 0, end: 0 };
    }
    const indexAt = (position: number) => {
      let low = 0;
      let high = rows.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (offsets[middle + 1]! <= position) low = middle + 1;
        else high = middle;
      }
      return low;
    };
    return {
      start: Math.max(0, indexAt(Math.max(0, viewport.top)) - OVERSCAN_ROWS),
      end: Math.min(rows.length, indexAt(viewport.top + viewport.height) + OVERSCAN_ROWS + 1)
    };
  }, [offsets, rows.length, totalHeight, viewport]);

  const readViewport = useCallback((measurePosition = false) => {
    const scroller = scrollContainer.current;
    const element = host.current;
    if (!scroller || !element) return;
    if (measurePosition) {
      sectionOffset.current = element.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top + scroller.scrollTop - scroller.clientTop;
    }
    const top = scroller.scrollTop - sectionOffset.current;
    const height = scroller.clientHeight || DEFAULT_VIEWPORT_HEIGHT;
    setViewport((current) => current.top === top && current.height === height
      ? current : { top, height });
  }, [scrollContainer]);
  const measureRows = useCallback(() => {
    let changed = false;
    let adjustment = 0;
    const scroller = scrollContainer.current;
    const viewportTop = scroller?.getBoundingClientRect().top ?? 0;
    for (const element of host.current?.children ?? []) {
      if (!(element instanceof HTMLElement)) continue;
      const key = element.dataset.virtualRowKey;
      const bounds = element.getBoundingClientRect();
      const height = bounds.height;
      if (key && height > 0 && Math.abs((heights.current.get(key) ?? 0) - height) > 0.5) {
        const previousHeight = heights.current.get(key) ??
          (key.startsWith("file:") ? 44 : 32);
        if (bounds.bottom <= viewportTop) adjustment += height - previousHeight;
        heights.current.set(key, height);
        changed = true;
      }
    }
    if (changed) {
      if (scroller && adjustment) {
        scroller.scrollTop += adjustment;
        readViewport();
      }
      setMeasurementVersion((version) => version + 1);
    }
  }, [readViewport, scrollContainer]);

  useLayoutEffect(() => {
    const validKeys = new Set(rows.map((row) => row.key));
    for (const key of heights.current.keys()) {
      if (!validKeys.has(key)) heights.current.delete(key);
    }
    const scroller = scrollContainer.current;
    if (scroller && scroller.scrollHeight > 0) {
      scroller.scrollTop = Math.min(
        scroller.scrollTop,
        Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      );
    }
    readViewport(true);
  }, [rows, layoutKey, readViewport]);

  useEffect(() => {
    const scroller = scrollContainer.current;
    if (!scroller) return;
    let frame: number | null = null;
    const onScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        readViewport(true);
      });
    };
    const onResize = () => {
      measureRows();
      readViewport(true);
    };
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null : new ResizeObserver(onResize);
    observer.current = resizeObserver;
    resizeObserver?.observe(scroller);
    if (host.current) {
      resizeObserver?.observe(host.current);
      for (const element of host.current.children) resizeObserver?.observe(element);
    }
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    onResize();
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (frame !== null) cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      observer.current = null;
    };
  }, [measureRows, readViewport, scrollContainer]);

  useLayoutEffect(() => {
    const elements = Array.from(host.current?.children ?? []);
    for (const element of elements) observer.current?.observe(element);
    measureRows();
    return () => {
      for (const element of elements) observer.current?.unobserve(element);
    };
  }, [start, end, files, measureRows]);

  useLayoutEffect(() => {
    if (!selectionReveal) return;
    const index = fileIndexes.get(selectionReveal.fileKey);
    const scroller = scrollContainer.current;
    if (index === undefined || !scroller) return;
    const top = sectionOffset.current + offsets[index]!;
    const bottom = sectionOffset.current + offsets[index + 1]!;
    const height = scroller.clientHeight || DEFAULT_VIEWPORT_HEIGHT;
    if (top < scroller.scrollTop || bottom > scroller.scrollTop + height) {
      scroller.scrollTop = top < scroller.scrollTop ? top : Math.max(0, bottom - height);
      readViewport();
    }
    const row = Array.from(host.current?.querySelectorAll<HTMLElement>("[data-diff-file-key]") ?? [])
      .find((element) => element.dataset.diffFileKey === selectionReveal.fileKey);
    if (row) {
      row.querySelector<HTMLButtonElement>(".diff-workspace-file-select")
        ?.focus({ preventScroll: true });
      onSelectionRevealed(selectionReveal.requestKey);
    }
  }, [
    selectionReveal, fileIndexes, offsets, start, end,
    onSelectionRevealed, readViewport, scrollContainer
  ]);

  return (
    <div className="diff-workspace-virtual-list" ref={host} style={{ height: totalHeight }}>
      {rows.slice(start, end).map((row, index) => (
        <div
          className="diff-workspace-virtual-row"
          data-virtual-row-key={row.key}
          key={row.key}
          style={{ transform: `translateY(${offsets[start + index]}px)` }}
        >
          {row.kind === "directory"
            ? renderDirectory(row.node, row.depth)
            : renderFile(filesByKey.get(row.fileKey)!, row.depth)}
        </div>
      ))}
    </div>
  );
}
