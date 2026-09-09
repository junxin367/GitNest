import type {
  ChangedPathDto,
  RepositoryDiffRequest
} from "@gitnest/contracts";

export type DiffViewerMode = RepositoryDiffRequest["mode"];
export type DiffViewerLayout = "split" | "unified";
export type DiffLineKind =
  | "header"
  | "hunk"
  | "context"
  | "added"
  | "removed"
  | "meta";

export interface DiffViewerFile {
  key: string;
  path: string;
  mode: DiffViewerMode;
  status: string;
  kind: ChangedPathDto["kind"];
  change: ChangedPathDto;
  additions?: number;
  deletions?: number;
}

export interface UnifiedDiffLine {
  key: string;
  kind: DiffLineKind;
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
  hunkIndex?: number;
}

export interface SplitDiffCell {
  kind: "context" | "added" | "removed";
  lineNumber: number;
  text: string;
}

export interface SplitDiffRow {
  key: string;
  kind: "header" | "hunk" | "content" | "meta";
  text?: string;
  oldCell?: SplitDiffCell;
  newCell?: SplitDiffCell;
  hunkIndex?: number;
}

export interface DiffViewModel {
  unifiedLines: UnifiedDiffLine[];
  splitRows: SplitDiffRow[];
  hunkCount: number;
}

export interface DiffSearchHit {
  index: number;
  segmentKey: string;
  start: number;
  end: number;
}

export function buildDiffViewerFiles(
  changes: readonly ChangedPathDto[]
): DiffViewerFile[] {
  const staged: DiffViewerFile[] = [];
  const unstaged: DiffViewerFile[] = [];
  const untracked: DiffViewerFile[] = [];

  for (const change of changes) {
    if (
      change.kind !== "untracked" &&
      change.indexStatus !== "."
    ) {
      staged.push(toViewerFile(change, "staged"));
    }
    if (
      change.kind !== "untracked" &&
      change.worktreeStatus !== "."
    ) {
      unstaged.push(toViewerFile(change, "unstaged"));
    }
    if (change.kind === "untracked") {
      untracked.push(toViewerFile(change, "untracked"));
    }
  }

  return [...staged, ...unstaged, ...untracked];
}

export function matchesDiffViewerFileFilter(
  file: DiffViewerFile,
  query: string
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [
    file.path,
    file.change.originalPath ?? "",
    file.kind,
    file.status,
    modeLabel(file.mode)
  ].some((value) =>
    value.toLocaleLowerCase().includes(normalizedQuery)
  );
}

export function parseDiffViewModel(
  content: string
): DiffViewModel {
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }

  const unifiedLines: UnifiedDiffLine[] = [];
  const splitRows: SplitDiffRow[] = [];
  let oldLineNumber: number | undefined;
  let newLineNumber: number | undefined;
  let hunkIndex = -1;
  let removedCells: SplitDiffCell[] = [];
  let addedCells: SplitDiffCell[] = [];

  const flushChangedBlock = () => {
    const rowCount = Math.max(
      removedCells.length,
      addedCells.length
    );
    for (let index = 0; index < rowCount; index += 1) {
      splitRows.push({
        key: `split:${splitRows.length}`,
        kind: "content",
        ...(removedCells[index]
          ? { oldCell: removedCells[index] }
          : {}),
        ...(addedCells[index]
          ? { newCell: addedCells[index] }
          : {})
      });
    }
    removedCells = [];
    addedCells = [];
  };

  for (const line of lines) {
    const hunk = parseHunkHeader(line);
    if (hunk) {
      flushChangedBlock();
      hunkIndex += 1;
      oldLineNumber = hunk.oldLineNumber;
      newLineNumber = hunk.newLineNumber;
      unifiedLines.push({
        key: `unified:${unifiedLines.length}`,
        kind: "hunk",
        text: line,
        hunkIndex
      });
      splitRows.push({
        key: `split:${splitRows.length}`,
        kind: "hunk",
        text: line,
        hunkIndex
      });
      continue;
    }

    if (
      oldLineNumber === undefined ||
      newLineNumber === undefined
    ) {
      flushChangedBlock();
      if (isBoilerplateFileHeader(line)) {
        continue;
      }
      unifiedLines.push({
        key: `unified:${unifiedLines.length}`,
        kind: headerKind(line),
        text: line
      });
      splitRows.push({
        key: `split:${splitRows.length}`,
        kind: headerKind(line) === "meta" ? "meta" : "header",
        text: line
      });
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      if (addedCells.length > 0) {
        flushChangedBlock();
      }
      const cell: SplitDiffCell = {
        kind: "removed",
        lineNumber: oldLineNumber,
        text: line.slice(1)
      };
      unifiedLines.push({
        key: `unified:${unifiedLines.length}`,
        kind: "removed",
        text: line.slice(1),
        oldLineNumber
      });
      removedCells.push(cell);
      oldLineNumber += 1;
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      const cell: SplitDiffCell = {
        kind: "added",
        lineNumber: newLineNumber,
        text: line.slice(1)
      };
      unifiedLines.push({
        key: `unified:${unifiedLines.length}`,
        kind: "added",
        text: line.slice(1),
        newLineNumber
      });
      addedCells.push(cell);
      newLineNumber += 1;
      continue;
    }

    flushChangedBlock();
    if (line.startsWith(" ")) {
      const text = line.slice(1);
      unifiedLines.push({
        key: `unified:${unifiedLines.length}`,
        kind: "context",
        text,
        oldLineNumber,
        newLineNumber
      });
      splitRows.push({
        key: `split:${splitRows.length}`,
        kind: "content",
        oldCell: {
          kind: "context",
          lineNumber: oldLineNumber,
          text
        },
        newCell: {
          kind: "context",
          lineNumber: newLineNumber,
          text
        }
      });
      oldLineNumber += 1;
      newLineNumber += 1;
      continue;
    }

    unifiedLines.push({
      key: `unified:${unifiedLines.length}`,
      kind: "meta",
      text: line
    });
    splitRows.push({
      key: `split:${splitRows.length}`,
      kind: "meta",
      text: line
    });
  }

  flushChangedBlock();
  return {
    unifiedLines,
    splitRows,
    hunkCount: hunkIndex + 1
  };
}

export function collectDiffViewerSearchHits(
  model: DiffViewModel,
  layout: DiffViewerLayout,
  query: string
): DiffSearchHit[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const segments =
    layout === "unified"
      ? model.unifiedLines.map((line) => ({
          key: line.key,
          text: line.text
        }))
      : model.splitRows.flatMap((row) => {
          if (row.kind !== "content") {
            return [
              {
                key: `${row.key}:full`,
                text: row.text ?? ""
              }
            ];
          }
          return [
            {
              key: `${row.key}:old`,
              text: row.oldCell?.text ?? ""
            },
            {
              key: `${row.key}:new`,
              text: row.newCell?.text ?? ""
            }
          ];
        });
  const hits: DiffSearchHit[] = [];

  for (const segment of segments) {
    const normalizedText = segment.text.toLocaleLowerCase();
    let offset = 0;
    while (offset < normalizedText.length) {
      const start = normalizedText.indexOf(
        normalizedQuery,
        offset
      );
      if (start < 0) {
        break;
      }
      hits.push({
        index: hits.length,
        segmentKey: segment.key,
        start,
        end: start + normalizedQuery.length
      });
      offset = start + normalizedQuery.length;
    }
  }

  return hits;
}

function toViewerFile(
  change: ChangedPathDto,
  mode: DiffViewerMode
): DiffViewerFile {
  const stats =
    mode === "staged"
      ? change.stagedStats
      : mode === "unstaged"
        ? change.unstagedStats
        : change.untrackedStats;

  return {
    key: `${mode}\u0001${change.path}`,
    path: change.path,
    mode,
    status:
      mode === "untracked"
        ? "?"
        : mode === "staged"
          ? change.indexStatus
          : change.worktreeStatus,
    kind: change.kind,
    change,
    ...(stats
      ? {
          additions: stats.additions,
          deletions: stats.deletions
        }
      : {})
  };
}

function modeLabel(mode: DiffViewerMode): string {
  if (mode === "staged") {
    return "已暂存 staged";
  }
  if (mode === "untracked") {
    return "未跟踪 untracked";
  }
  return "未暂存 unstaged";
}

function headerKind(line: string): "header" | "meta" {
  return line.startsWith("\\") ? "meta" : "header";
}

function isBoilerplateFileHeader(line: string): boolean {
  return (
    line.startsWith("diff --git ") ||
    line.startsWith("diff --cc ") ||
    line.startsWith("diff --combined ") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ")
  );
}

function parseHunkHeader(
  line: string
):
  | {
      oldLineNumber: number;
      newLineNumber: number;
    }
  | undefined {
  const match = line.match(
    /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/
  );
  if (!match) {
    return undefined;
  }

  return {
    oldLineNumber: Number(match[1]),
    newLineNumber: Number(match[2])
  };
}
