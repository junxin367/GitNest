import { describe, expect, it } from "vitest";

import {
  buildLocalizedDiffContent,
  buildDiffViewerFiles,
  collectDiffViewerSearchHits,
  createDiffContentSnapshot,
  matchesDiffViewerFileFilter,
  parseDiffViewModel
} from "../../shared/model/diffViewModel";

describe("Diff viewer model", () => {
  it("keeps repeated sign prefixes inside hunks as numbered content", () => {
    const model = parseDiffViewModel(
      "@@ -1,2 +1,2 @@\n---old\n+++new\n tail"
    );
    expect(model.unifiedLines).toMatchObject([
      { kind: "hunk" },
      { kind: "removed", text: "--old", oldLineNumber: 1 },
      { kind: "added", text: "++new", newLineNumber: 1 },
      {
        kind: "context",
        text: "tail",
        oldLineNumber: 2,
        newLineNumber: 2
      }
    ]);
    expect(model.splitRows[1]).toMatchObject({
      kind: "content",
      oldCell: { kind: "removed", text: "--old", lineNumber: 1 },
      newCell: { kind: "added", text: "++new", lineNumber: 1 }
    });
    expect(collectDiffViewerSearchHits(model, "unified", "++new"))
      .toMatchObject([{ segmentKey: "unified:2", start: 0, end: 5 }]);
  });

  it("resets hunk parsing at the next file header", () => {
    const model = parseDiffViewModel([
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1 @@",
      "--- old source",
      "+++ new source",
      "diff --git a/b.txt b/b.txt",
      "index 123..456 100644",
      "--- a/b.txt",
      "+++ b/b.txt",
      "@@ -10 +20 @@",
      "-before",
      "+after"
    ].join("\n"));
    expect(model.hunkCount).toBe(2);
    expect(model.unifiedLines.map((line) => line.text)).toEqual([
      "@@ -1 +1 @@",
      "-- old source",
      "++ new source",
      "@@ -10 +20 @@",
      "before",
      "after"
    ]);
    expect(model.splitRows[3]).toMatchObject({
      oldCell: { lineNumber: 10, text: "before" },
      newCell: { lineNumber: 20, text: "after" }
    });
  });

  it("expands repeated-sign changes without losing context line numbers", () => {
    const compact = "@@ -2,3 +2,3 @@\n before\n---old\n+++new\n after";
    const expanded = "@@ -1,5 +1,5 @@\n zero\n before\n---old\n+++new\n after\n five";
    expect(buildLocalizedDiffContent(compact, expanded, {
      0: { beforeLines: 2, afterLines: 2 }
    })).toBe(expanded);
  });

  it("preserves multi-file input instead of mapping equal line numbers across files", () => {
    const first = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+b";
    const second = "diff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1 +1 @@\n-c\n+d";
    const compact = `${first}\n${second}`;
    expect(buildLocalizedDiffContent(compact, `${compact}\n tail`, {
      0: { beforeLines: 10, afterLines: 10 }
    })).toBe(compact);
  });

  it("identifies real changes independently of surrounding context", () => {
    const compact = "@@ -4,7 +4,7 @@\n 4\n 5\n 6\n---old\n+++new\n 8\n 9\n 10";
    const expanded = "@@ -1,13 +1,13 @@\n 1\n 2\n 3\n 4\n 5\n 6\n---old\n+++new\n 8\n 9\n 10\n 11\n 12\n 13";
    const snapshot = createDiffContentSnapshot(compact, 3);
    expect(createDiffContentSnapshot(expanded, 3)).toEqual(snapshot);
    expect(
      createDiffContentSnapshot(expanded.replace("+++new", "+++latest"), 3)
        .changeIdentity
    ).not.toBe(snapshot.changeIdentity);
    expect(
      createDiffContentSnapshot(expanded.replace("-1,13 +1,13", "-2,13 +2,13"), 3)
        .changeIdentity
    ).not.toBe(snapshot.changeIdentity);
  });

  it.each([
    "@@ -0,0 +1,2 @@\n+first\n+last\n\\ No newline at end of file",
    "@@ -1,2 +0,0 @@\n-first\n-last\n\\ No newline at end of file"
  ])("preserves one-sided changes and their EOF marker", (content) => {
    expect(createDiffContentSnapshot(content, 3).compactContent).toBe(content);
  });

  it("keeps nearby changes in one compact hunk", () => {
    const content = "@@ -1,5 +1,5 @@\n-a\n+b\n middle\n-c\n+d\n tail\n end";
    expect(createDiffContentSnapshot(content, 3).compactContent).toBe(content);
  });

  it("keeps staged and unstaged versions of the same path distinct", () => {
    expect(
      buildDiffViewerFiles([
        {
          path: "src/App.tsx",
          indexStatus: "M",
          worktreeStatus: "M",
          kind: "ordinary",
          stagedStats: {
            additions: 3,
            deletions: 1
          },
          unstagedStats: {
            additions: 2,
            deletions: 4
          }
        },
        {
          path: "README.md",
          indexStatus: ".",
          worktreeStatus: "?",
          kind: "untracked",
          untrackedStats: {
            additions: 5,
            deletions: 0
          }
        }
      ])
    ).toMatchObject([
      {
        path: "src/App.tsx",
        mode: "staged",
        status: "M",
        additions: 3,
        deletions: 1
      },
      {
        path: "src/App.tsx",
        mode: "unstaged",
        status: "M",
        additions: 2,
        deletions: 4
      },
      {
        path: "README.md",
        mode: "untracked",
        status: "?",
        additions: 5,
        deletions: 0
      }
    ]);
  });

  it("aligns replacement blocks in split mode and numbers both sides", () => {
    const model = parseDiffViewModel(
      [
        "diff --git a/src/App.tsx b/src/App.tsx",
        "--- a/src/App.tsx",
        "+++ b/src/App.tsx",
        "@@ -10,3 +10,4 @@",
        " const first = true;",
        "-const oldName = 1;",
        "+const newName = 1;",
        "+const extra = 2;",
        " return first;"
      ].join("\n")
    );

    expect(model.hunkCount).toBe(1);
    expect(model.splitRows).toMatchObject([
      { kind: "hunk", hunkIndex: 0 },
      {
        kind: "content",
        oldCell: { kind: "context", lineNumber: 10 },
        newCell: { kind: "context", lineNumber: 10 }
      },
      {
        kind: "content",
        oldCell: {
          kind: "removed",
          lineNumber: 11,
          text: "const oldName = 1;"
        },
        newCell: {
          kind: "added",
          lineNumber: 11,
          text: "const newName = 1;"
        }
      },
      {
        kind: "content",
        newCell: {
          kind: "added",
          lineNumber: 12,
          text: "const extra = 2;"
        }
      },
      {
        kind: "content",
        oldCell: { kind: "context", lineNumber: 12 },
        newCell: { kind: "context", lineNumber: 13 }
      }
    ]);
    expect(model.unifiedLines.some((line) => line.kind === "header")).toBe(
      false
    );
  });

  it("keeps meaningful file metadata while hiding boilerplate headers", () => {
    const model = parseDiffViewModel(
      [
        "diff --git a/src/Old.ts b/src/New.ts",
        "similarity index 98%",
        "rename from src/Old.ts",
        "rename to src/New.ts",
        "old mode 100644",
        "new mode 100755",
        "index 1111111..2222222 100755",
        "--- a/src/Old.ts",
        "+++ b/src/New.ts"
      ].join("\n")
    );

    expect(model.unifiedLines.map((line) => line.text)).toEqual([
      "similarity index 98%",
      "rename from src/Old.ts",
      "rename to src/New.ts",
      "old mode 100644",
      "new mode 100755"
    ]);
    expect(model.splitRows.map((row) => row.text)).toEqual([
      "similarity index 98%",
      "rename from src/Old.ts",
      "rename to src/New.ts",
      "old mode 100644",
      "new mode 100755"
    ]);
  });

  it("searches only the currently rendered layout", () => {
    const model = parseDiffViewModel(
      [
        "@@ -1 +1 @@",
        "-const color = 'blue';",
        "+const color = 'green';"
      ].join("\n")
    );

    expect(
      collectDiffViewerSearchHits(model, "split", "color")
    ).toHaveLength(2);
    expect(
      collectDiffViewerSearchHits(model, "unified", "COLOR")
    ).toHaveLength(2);
    expect(
      collectDiffViewerSearchHits(model, "split", "missing")
    ).toEqual([]);
  });

  it("expands context for only the requested hunk", () => {
    const compactContent = [
      "@@ -4,7 +4,7 @@",
      " line 4",
      " line 5",
      " line 6",
      "-old line 7",
      "+new line 7",
      " line 8",
      " line 9",
      " line 10",
      "@@ -20,7 +20,7 @@",
      " line 20",
      " line 21",
      " line 22",
      "-old line 23",
      "+new line 23",
      " line 24",
      " line 25",
      " line 26"
    ].join("\n");
    const expandedSource = [
      "@@ -1,29 +1,29 @@",
      " line 1",
      " line 2",
      " line 3",
      " line 4",
      " line 5",
      " line 6",
      "-old line 7",
      "+new line 7",
      " line 8",
      " line 9",
      " line 10",
      " line 11",
      " line 12",
      " line 13",
      " line 14",
      " line 15",
      " line 16",
      " line 17",
      " line 18",
      " line 19",
      " line 20",
      " line 21",
      " line 22",
      "-old line 23",
      "+new line 23",
      " line 24",
      " line 25",
      " line 26",
      " line 27",
      " line 28",
      " line 29"
    ].join("\n");

    const localized = buildLocalizedDiffContent(
      compactContent,
      expandedSource,
      {
        1: {
          beforeLines: 13,
          afterLines: 3
        }
      }
    );
    const [firstHunk, secondHunk] = localized.split(
      /(?=^@@ )/m
    );

    expect(firstHunk).toBe(
      compactContent.split(/(?=^@@ )/m)[0]
    );
    expect(secondHunk).toContain(" line 15");
    expect(secondHunk).toContain("-old line 23");
    expect(localized.match(/^ line 20$/gm)).toHaveLength(1);
    expect(createDiffContentSnapshot(expandedSource, 3)).toEqual(
      createDiffContentSnapshot(compactContent, 3)
    );
    expect(
      createDiffContentSnapshot(expandedSource, 3).compactContent
    ).toBe(compactContent);
  });

  it("filters files by path, status, and localized group label", () => {
    const [file] = buildDiffViewerFiles([
      {
        path: "src/components/DiffPanel.tsx",
        indexStatus: ".",
        worktreeStatus: "M",
        kind: "ordinary"
      }
    ]);

    expect(file).toBeDefined();
    expect(
      matchesDiffViewerFileFilter(file!, "components")
    ).toBe(true);
    expect(
      matchesDiffViewerFileFilter(file!, "未暂存")
    ).toBe(true);
    expect(matchesDiffViewerFileFilter(file!, "deleted")).toBe(
      false
    );
  });
});
