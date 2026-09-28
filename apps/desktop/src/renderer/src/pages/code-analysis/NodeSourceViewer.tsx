import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

import type {
  CodeGraphNodeDto
} from "@gitnest/contracts";

import { Button } from "../../shared/ui/Button";
import { DiffSearchPopover } from "../../shared/ui/DiffSearchPopover";
import { Icon } from "../../shared/ui/Icon";
import {
  tokenizeSourceLines,
  type SourceSyntaxToken
} from "./sourceSyntax";
import { useCodeNodeSource } from "./useCodeNodeSource";

interface SourceSearchHit {
  index: number;
  lineIndex: number;
  start: number;
  end: number;
}

export function NodeSourceViewer({
  node,
  onClose
}: {
  node: CodeGraphNodeDto;
  onClose(): void;
}) {
  const source = useCodeNodeSource(node);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchHit, setActiveSearchHit] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const targetLineRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(
    () => source.file?.content.split("\n") ?? [],
    [source.file?.content]
  );
  const syntaxTokens = useMemo(
    () =>
      tokenizeSourceLines(
        lines,
        source.file?.language ?? node.language,
        source.file?.path ?? node.location.path
      ),
    [
      lines,
      node.language,
      node.location.path,
      source.file?.language,
      source.file?.path
    ]
  );
  const searchHits = useMemo(
    () => collectSourceSearchHits(lines, searchQuery),
    [lines, searchQuery]
  );
  const hitsByLine = useMemo(
    () => groupSourceSearchHits(searchHits),
    [searchHits]
  );
  const normalizedActiveSearchHit =
    searchHits.length === 0
      ? 0
      : Math.min(activeSearchHit, searchHits.length - 1);
  const canSearch = Boolean(
    source.file && lines.length > 0
  );
  const targetLine = source.file
    ? Math.min(
        source.file.endLine,
        Math.max(source.file.startLine, node.location.line)
      )
    : node.location.line;

  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setActiveSearchHit(0);
  }, [node.id]);

  const openSearch = useCallback(() => {
    if (!canSearch) {
      return;
    }
    setSearchOpen(true);
    if (searchOpen) {
      searchInputRef.current?.focus({
        preventScroll: true
      });
      searchInputRef.current?.select();
    }
  }, [canSearch, searchOpen]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    window.requestAnimationFrame(() => {
      viewportRef.current?.focus({
        preventScroll: true
      });
    });
  }, []);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus({
        preventScroll: true
      });
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchOpen]);

  useEffect(() => {
    const handleFindShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLocaleLowerCase() !== "f" ||
        !canSearch
      ) {
        return;
      }
      event.preventDefault();
      openSearch();
    };

    window.addEventListener("keydown", handleFindShortcut);
    return () =>
      window.removeEventListener(
        "keydown",
        handleFindShortcut
      );
  }, [canSearch, openSearch]);

  useLayoutEffect(() => {
    if (!source.file) {
      return;
    }
    targetLineRef.current?.scrollIntoView({
      block: "center"
    });
  }, [source.file, targetLine]);

  useLayoutEffect(() => {
    if (!searchOpen || searchHits.length === 0) {
      return;
    }
    viewportRef.current
      ?.querySelector<HTMLElement>(
        `[data-source-search-hit="${normalizedActiveSearchHit}"]`
      )
      ?.scrollIntoView({
        block: "center"
      });
  }, [
    normalizedActiveSearchHit,
    searchHits.length,
    searchOpen
  ]);

  const moveSearchHit = (direction: -1 | 1) => {
    if (searchHits.length === 0) {
      return;
    }
    setActiveSearchHit(
      (current) =>
        (current + direction + searchHits.length) %
        searchHits.length
    );
  };
  const endLine =
    typeof node.metadata.endLine === "number"
      ? node.metadata.endLine
      : node.location.line;

  return (
    <section
      aria-label="节点代码"
      className="panel analysis-node-diff-drawer analysis-node-source-drawer"
      id="analysis-node-diff-drawer"
    >
      <header className="analysis-panel-heading">
        <div>
          <strong>节点所在代码</strong>
          <span>
            {node.location.path} · L{node.location.line}
            {endLine > node.location.line
              ? `–L${endLine}`
              : ""}
          </span>
        </div>
        <div className="analysis-panel-heading-actions">
          {source.file?.truncated && (
            <span className="analysis-node-source-range">
              L{source.file.startLine}–L{source.file.endLine} /
              {" "}
              {source.file.totalLines}
            </span>
          )}
          <Button
            aria-label="搜索节点代码"
            disabled={!canSearch}
            icon={<Icon name="search" size={14} />}
            onClick={openSearch}
            size="small"
            title="搜索代码"
            variant="icon"
          />
          <Button
            aria-label="关闭节点代码"
            icon={<Icon name="close" size={14} />}
            onClick={onClose}
            size="small"
            title="关闭代码"
            variant="icon"
          />
        </div>
      </header>
      <div className="analysis-node-diff-content">
        <div className="analysis-node-source-panel">
          <div className="analysis-node-source-file-header">
            <Icon name="fileCode" size={14} />
            <span title={source.file?.path ?? node.location.path}>
              {source.file?.path ?? node.location.path}
            </span>
          </div>
          <DiffSearchPopover
            className="analysis-node-source-search"
            countLabel={sourceSearchCountLabel(
              searchQuery,
              searchHits.length,
              normalizedActiveSearchHit
            )}
            hasMatches={searchHits.length > 0}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setActiveSearchHit(0);
            }}
            onClose={closeSearch}
            onNext={() => moveSearchHit(1)}
            onPrevious={() => moveSearchHit(-1)}
            open={searchOpen && Boolean(source.file)}
            placeholder="在当前代码中搜索"
            ref={searchInputRef}
            searchLabel="在代码中搜索"
            value={searchQuery}
          />
          <div
            aria-busy={source.loading}
            aria-label="文件代码"
            className="analysis-node-source-code"
            ref={viewportRef}
            role="region"
            tabIndex={0}
          >
            {source.loading ? (
              <SourceState
                busy
                icon="refresh"
                message="正在从节点所属 Worktree 读取当前文件。"
                title="正在读取节点代码"
              />
            ) : source.error ? (
              <SourceState
                icon="warning"
                message={source.error.message}
                title="无法读取节点代码"
              />
            ) : source.file ? (
              <>
                {source.file.truncated && (
                  <div className="analysis-node-source-truncated">
                    文件较长，仅显示节点附近 L
                    {source.file.startLine}–L
                    {source.file.endLine}。
                  </div>
                )}
                <div className="analysis-node-source-lines">
                  {lines.map((line, index) => {
                    const lineNumber =
                      source.file!.startLine + index;
                    const focused = lineNumber === targetLine;
                    return (
                      <div
                        aria-current={
                          focused ? "location" : undefined
                        }
                        className={`analysis-node-source-line${
                          focused ? " focus-target" : ""
                        }`}
                        data-source-line={lineNumber}
                        key={lineNumber}
                        ref={
                          focused ? targetLineRef : undefined
                        }
                      >
                        <span>{lineNumber}</span>
                        <code>
                          {highlightSourceLine(
                            line,
                            syntaxTokens[index] ?? [],
                            hitsByLine.get(index) ?? [],
                            normalizedActiveSearchHit
                          )}
                        </code>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <SourceState
                icon="fileCode"
                message="该节点对应的文件没有可显示的文本内容。"
                title="代码内容为空"
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function SourceState({
  icon,
  title,
  message,
  busy = false
}: {
  icon: "fileCode" | "refresh" | "warning";
  title: string;
  message: string;
  busy?: boolean;
}) {
  return (
    <div
      aria-live="polite"
      className="analysis-node-source-state"
      role="status"
    >
      <Icon
        className={busy ? "is-spinning" : undefined}
        name={icon}
        size={22}
      />
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}

function collectSourceSearchHits(
  lines: readonly string[],
  query: string
): SourceSearchHit[] {
  const normalizedQuery = query.toLocaleLowerCase();
  if (!normalizedQuery) {
    return [];
  }
  const hits: SourceSearchHit[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const normalizedLine = line.toLocaleLowerCase();
    let start = 0;
    while (start <= normalizedLine.length) {
      const match = normalizedLine.indexOf(
        normalizedQuery,
        start
      );
      if (match < 0) {
        break;
      }
      hits.push({
        index: hits.length,
        lineIndex,
        start: match,
        end: match + normalizedQuery.length
      });
      start = match + Math.max(1, normalizedQuery.length);
    }
  }
  return hits;
}

function groupSourceSearchHits(
  hits: readonly SourceSearchHit[]
): ReadonlyMap<number, SourceSearchHit[]> {
  const grouped = new Map<number, SourceSearchHit[]>();
  for (const hit of hits) {
    const lineHits = grouped.get(hit.lineIndex);
    if (lineHits) {
      lineHits.push(hit);
    } else {
      grouped.set(hit.lineIndex, [hit]);
    }
  }
  return grouped;
}

function highlightSourceLine(
  text: string,
  tokens: readonly SourceSyntaxToken[],
  hits: readonly SourceSearchHit[],
  activeSearchHit: number
): ReactNode {
  if (!text) {
    return " ";
  }
  if (hits.length === 0) {
    return renderSyntaxRange(
      text,
      0,
      text.length,
      tokens,
      "line"
    );
  }
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const hit of hits) {
    if (hit.start > offset) {
      parts.push(
        ...renderSyntaxRange(
          text,
          offset,
          hit.start,
          tokens,
          `before-${hit.index}`
        )
      );
    }
    parts.push(
      <mark
        className={`diff-viewer-search-hit${
          hit.index === activeSearchHit ? " current" : ""
        }`}
        data-source-search-hit={hit.index}
        key={`${hit.index}:${hit.start}`}
      >
        {renderSyntaxRange(
          text,
          hit.start,
          hit.end,
          tokens,
          `hit-${hit.index}`
        )}
      </mark>
    );
    offset = hit.end;
  }
  if (offset < text.length) {
    parts.push(
      ...renderSyntaxRange(
        text,
        offset,
        text.length,
        tokens,
        "after"
      )
    );
  }
  return parts;
}

function renderSyntaxRange(
  text: string,
  start: number,
  end: number,
  tokens: readonly SourceSyntaxToken[],
  keyPrefix: string
): ReactNode[] {
  const parts: ReactNode[] = [];
  let offset = start;

  for (const token of tokens) {
    if (token.end <= start) {
      continue;
    }
    if (token.start >= end) {
      break;
    }
    const tokenStart = Math.max(start, token.start);
    const tokenEnd = Math.min(end, token.end);
    if (tokenStart > offset) {
      parts.push(text.slice(offset, tokenStart));
    }
    if (tokenEnd > tokenStart) {
      parts.push(
        <span
          className={`analysis-source-token is-${token.kind}`}
          key={`${keyPrefix}:${token.start}:${token.end}:${token.kind}`}
        >
          {text.slice(tokenStart, tokenEnd)}
        </span>
      );
      offset = tokenEnd;
    }
  }

  if (offset < end) {
    parts.push(text.slice(offset, end));
  }
  return parts;
}

function sourceSearchCountLabel(
  query: string,
  hitCount: number,
  activeSearchHit: number
): string {
  if (!query) {
    return "0/0";
  }
  return hitCount > 0
    ? `${activeSearchHit + 1}/${hitCount}`
    : "0/0";
}
