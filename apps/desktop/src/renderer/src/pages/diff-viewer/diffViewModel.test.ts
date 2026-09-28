import { describe, expect, it } from "vitest";

import {
  buildLocalizedDiffContent,
  buildDiffViewerFiles,
  collectDiffViewerSearchHits,
  matchesDiffViewerFileFilter,
  parseDiffViewModel
} from "../../shared/model/diffViewModel";

describe("Diff viewer model", () => {
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
