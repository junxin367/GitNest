import { describe, expect, it } from "vitest";

import { parseStatusPorcelainV2 } from "./status-porcelain-v2";

describe("parseStatusPorcelainV2", () => {
  it("parses branch metadata and all change classes", () => {
    const output = [
      "# branch.oid abcdef123456",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
      "1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb src/app.ts",
      "1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb README.md",
      "? new file.txt",
      "2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 new name.ts",
      "old name.ts",
      "u UU N... 100644 100644 100644 100644 aaaaaaa bbbbbbb ccccccc conflict.txt",
      ""
    ].join("\0");

    const snapshot = parseStatusPorcelainV2(
      output,
      "2026-09-04T00:00:00.000Z"
    );

    expect(snapshot).toMatchObject({
      branch: "main",
      head: "abcdef123456",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
      staged: 2,
      unstaged: 1,
      untracked: 1,
      conflicted: 1,
      refreshedAt: "2026-09-04T00:00:00.000Z"
    });
    expect(snapshot.changes).toHaveLength(5);
    expect(snapshot.changes[3]).toMatchObject({
      kind: "renamed",
      path: "new name.ts",
      originalPath: "old name.ts"
    });
  });

  it("handles an unborn and detached branch", () => {
    const snapshot = parseStatusPorcelainV2(
      [
        "# branch.oid (initial)",
        "# branch.head (detached)",
        ""
      ].join("\0")
    );

    expect(snapshot.head).toBe("");
    expect(snapshot.branch).toBeUndefined();
  });
});
