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

export interface DiffHunkContextRange {
  beforeLines: number;
  afterLines: number;
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

export function buildLocalizedDiffContent(
  compactContent: string,
  sourceContent: string,
  contextRanges: Readonly<
    Record<number, DiffHunkContextRange>
  >
): string {
  const requestedHunks = Object.keys(contextRanges);
  if (
    requestedHunks.length === 0 ||
    !compactContent ||
    !sourceContent ||
    compactContent === sourceContent
  ) {
    return compactContent || sourceContent;
  }

  const compact = parseExpandableDiffDocument(compactContent);
  const source = parseExpandableDiffDocument(sourceContent);
  if (compact.hunks.length === 0 || source.hunks.length === 0) {
    return compactContent;
  }

  const sourceRecords = source.hunks.flatMap((hunk) =>
    hunk.records.map((record) => ({
      ...record,
      sourceHunkIndex: hunk.index
    }))
  );
  const sourceRecordIndexes = new Map<string, number>();
  sourceRecords.forEach((record, index) => {
    const identity = expandableRecordIdentity(record);
    if (identity) {
      sourceRecordIndexes.set(identity, index);
    }
  });

  const mappedHunks = compact.hunks.map((hunk) => {
    const numberedRecords = hunk.records.filter(
      (record) => expandableRecordIdentity(record) !== undefined
    );
    const changedRecords = hunk.records.filter(
      (record) =>
        record.kind === "added" || record.kind === "removed"
    );
    const compactStartIndex = sourceRecordIndex(
      numberedRecords[0],
      sourceRecordIndexes
    );
    const compactEndIndex = sourceRecordIndex(
      numberedRecords.at(-1),
      sourceRecordIndexes
    );
    const firstChangedIndex = sourceRecordIndex(
      changedRecords[0],
      sourceRecordIndexes
    );
    const lastChangedIndex = sourceRecordIndex(
      changedRecords.at(-1),
      sourceRecordIndexes
    );

    return {
      hunk,
      compactStartIndex,
      compactEndIndex,
      firstChangedIndex,
      lastChangedIndex
    };
  });

  if (
    mappedHunks.some(
      ({
        compactStartIndex,
        compactEndIndex,
        firstChangedIndex,
        lastChangedIndex
      }) =>
        compactStartIndex === undefined ||
        compactEndIndex === undefined ||
        firstChangedIndex === undefined ||
        lastChangedIndex === undefined
    )
  ) {
    return compactContent;
  }

  const selectedRanges = mappedHunks.map((mapped, hunkIndex) => {
    const request = contextRanges[hunkIndex];
    if (!request) {
      return {
        start: mapped.compactStartIndex!,
        end: mapped.compactEndIndex!,
        expanded: false
      };
    }

    const sourceHunkIndex =
      sourceRecords[mapped.firstChangedIndex!]?.sourceHunkIndex;
    let start = expandContextStart(
      sourceRecords,
      mapped.firstChangedIndex!,
      sourceHunkIndex,
      request.beforeLines
    );
    let end = expandContextEnd(
      sourceRecords,
      mapped.lastChangedIndex!,
      sourceHunkIndex,
      request.afterLines
    );
    const previousCompactEnd =
      mappedHunks[hunkIndex - 1]?.compactEndIndex;
    const nextCompactStart =
      mappedHunks[hunkIndex + 1]?.compactStartIndex;
    if (previousCompactEnd !== undefined) {
      start = Math.max(start, previousCompactEnd + 1);
    }
    if (nextCompactStart !== undefined) {
      end = Math.min(end, nextCompactStart - 1);
    }

    return { start, end, expanded: true };
  });

  for (
    let hunkIndex = 1;
    hunkIndex < selectedRanges.length;
    hunkIndex += 1
  ) {
    const previous = selectedRanges[hunkIndex - 1]!;
    const current = selectedRanges[hunkIndex]!;
    if (current.start <= previous.end) {
      current.start = Math.min(
        current.end,
        previous.end + 1
      );
    }
  }

  const renderedHunks = mappedHunks.map(
    ({ hunk }, hunkIndex) => {
      const selected = selectedRanges[hunkIndex]!;
      if (!selected.expanded) {
        return renderExpandableHunk(hunk);
      }

      const records = sourceRecords
        .slice(selected.start, selected.end + 1)
        .map(({ sourceHunkIndex: _sourceHunkIndex, ...record }) => record);
      return renderExpandableHunk({
        ...hunk,
        records
      });
    }
  );

  return [...compact.prefixLines, ...renderedHunks]
    .filter((part) => part.length > 0)
    .join("\n");
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
      oldLineCount: number;
      newLineCount: number;
      suffix: string;
    }
  | undefined {
  const match = line.match(
    /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/
  );
  if (!match) {
    return undefined;
  }

  return {
    oldLineNumber: Number(match[1]),
    oldLineCount: match[2] === undefined ? 1 : Number(match[2]),
    newLineNumber: Number(match[3]),
    newLineCount: match[4] === undefined ? 1 : Number(match[4]),
    suffix: match[5] ?? ""
  };
}

type ExpandableDiffRecordKind =
  | "context"
  | "added"
  | "removed"
  | "meta";

interface ExpandableDiffRecord {
  kind: ExpandableDiffRecordKind;
  raw: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

interface ExpandableDiffHunk {
  index: number;
  oldLineNumber: number;
  newLineNumber: number;
  suffix: string;
  records: ExpandableDiffRecord[];
}

interface ExpandableDiffDocument {
  prefixLines: string[];
  hunks: ExpandableDiffHunk[];
}

function parseExpandableDiffDocument(
  content: string
): ExpandableDiffDocument {
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }

  const prefixLines: string[] = [];
  const hunks: ExpandableDiffHunk[] = [];
  let currentHunk: ExpandableDiffHunk | undefined;
  let oldLineNumber = 0;
  let newLineNumber = 0;

  for (const line of lines) {
    const header = parseHunkHeader(line);
    if (header) {
      currentHunk = {
        index: hunks.length,
        oldLineNumber: header.oldLineNumber,
        newLineNumber: header.newLineNumber,
        suffix: header.suffix,
        records: []
      };
      hunks.push(currentHunk);
      oldLineNumber = header.oldLineNumber;
      newLineNumber = header.newLineNumber;
      continue;
    }

    if (!currentHunk) {
      prefixLines.push(line);
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      currentHunk.records.push({
        kind: "removed",
        raw: line,
        oldLineNumber
      });
      oldLineNumber += 1;
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentHunk.records.push({
        kind: "added",
        raw: line,
        newLineNumber
      });
      newLineNumber += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      currentHunk.records.push({
        kind: "context",
        raw: line,
        oldLineNumber,
        newLineNumber
      });
      oldLineNumber += 1;
      newLineNumber += 1;
      continue;
    }

    currentHunk.records.push({
      kind: "meta",
      raw: line
    });
  }

  return { prefixLines, hunks };
}

function expandableRecordIdentity(
  record: ExpandableDiffRecord | undefined
): string | undefined {
  if (!record || record.kind === "meta") {
    return undefined;
  }
  return [
    record.kind,
    record.oldLineNumber ?? "",
    record.newLineNumber ?? ""
  ].join(":");
}

function sourceRecordIndex(
  record: ExpandableDiffRecord | undefined,
  indexes: ReadonlyMap<string, number>
): number | undefined {
  const identity = expandableRecordIdentity(record);
  return identity === undefined ? undefined : indexes.get(identity);
}

function expandContextStart(
  records: readonly (ExpandableDiffRecord & {
    sourceHunkIndex: number;
  })[],
  firstChangedIndex: number,
  sourceHunkIndex: number | undefined,
  beforeLines: number
): number {
  let index = firstChangedIndex;
  let remaining = Math.max(0, beforeLines);
  while (index > 0 && remaining > 0) {
    const previous = records[index - 1];
    if (
      !previous ||
      previous.sourceHunkIndex !== sourceHunkIndex ||
      previous.kind !== "context"
    ) {
      break;
    }
    index -= 1;
    remaining -= 1;
  }
  return index;
}

function expandContextEnd(
  records: readonly (ExpandableDiffRecord & {
    sourceHunkIndex: number;
  })[],
  lastChangedIndex: number,
  sourceHunkIndex: number | undefined,
  afterLines: number
): number {
  let index = lastChangedIndex;
  let remaining = Math.max(0, afterLines);
  while (index + 1 < records.length) {
    const next = records[index + 1];
    if (!next || next.sourceHunkIndex !== sourceHunkIndex) {
      break;
    }
    if (next.kind === "meta") {
      index += 1;
      continue;
    }
    if (remaining <= 0 || next.kind !== "context") {
      break;
    }
    index += 1;
    remaining -= 1;
  }
  return index;
}

function renderExpandableHunk(
  hunk: ExpandableDiffHunk
): string {
  const oldLineCount = hunk.records.reduce(
    (count, record) =>
      count +
      (record.kind === "context" ||
      record.kind === "removed"
        ? 1
        : 0),
    0
  );
  const newLineCount = hunk.records.reduce(
    (count, record) =>
      count +
      (record.kind === "context" || record.kind === "added"
        ? 1
        : 0),
    0
  );
  const firstOldLine = hunk.records.find(
    (record) => record.oldLineNumber !== undefined
  )?.oldLineNumber;
  const firstNewLine = hunk.records.find(
    (record) => record.newLineNumber !== undefined
  )?.newLineNumber;
  const oldStart =
    firstOldLine ??
    (oldLineCount === 0
      ? Math.max(0, hunk.oldLineNumber)
      : hunk.oldLineNumber);
  const newStart =
    firstNewLine ??
    (newLineCount === 0
      ? Math.max(0, hunk.newLineNumber)
      : hunk.newLineNumber);
  const header = `@@ -${formatHunkRange(
    oldStart,
    oldLineCount
  )} +${formatHunkRange(
    newStart,
    newLineCount
  )} @@${hunk.suffix}`;

  return [header, ...hunk.records.map((record) => record.raw)].join(
    "\n"
  );
}

function formatHunkRange(
  start: number,
  count: number
): string {
  return count === 1 ? String(start) : `${start},${count}`;
}
