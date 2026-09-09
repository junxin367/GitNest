import { describe, expect, it } from "vitest";

import {
  parseCommitMetadata,
  parseCommitNumstat
} from "./commit-details";
import { parseRepositoryDiff } from "./diff";

describe("repository query parsers", () => {
  it("parses bounded unified diffs and ignores file headers in line counts", () => {
    const diff = parseRepositoryDiff(
      "src/app.ts",
      "unstaged",
      [
        "diff --git a/src/app.ts b/src/app.ts",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1,2 +1,3 @@",
        "-old",
        "+new",
        "+added",
        ""
      ].join("\n"),
      true
    );

    expect(diff).toMatchObject({
      path: "src/app.ts",
      mode: "unstaged",
      additions: 2,
      deletions: 1,
      binary: false,
      truncated: true
    });
  });

  it("recognizes binary diff output without inventing line counts", () => {
    const diff = parseRepositoryDiff(
      "assets/logo.png",
      "untracked",
      "Binary files /dev/null and b/assets/logo.png differ\n"
    );

    expect(diff).toMatchObject({
      binary: true,
      additions: 0,
      deletions: 0,
      truncated: false
    });
  });

  it("parses commit metadata including merge parents, refs, and a multiline body", () => {
    const metadata = parseCommitMetadata(
      [
        "abcdef",
        "abcdef1",
        "June",
        "june@example.com",
        "2026-09-04T10:00:00+08:00",
        "Committer",
        "committer@example.com",
        "2026-09-04T10:01:00+08:00",
        "parent1 parent2",
        "HEAD -> main, tag: v1.0",
        "Subject line\n\nBody line\n"
      ].join("\0")
    );

    expect(metadata).toMatchObject({
      hash: "abcdef",
      subject: "Subject line",
      body: "Subject line\n\nBody line",
      parentHashes: ["parent1", "parent2"],
      refs: ["HEAD -> main", "tag: v1.0"]
    });
  });

  it("parses text and binary numstat records with non-ASCII paths", () => {
    const stats = parseCommitNumstat(
      "3\t1\tsrc/入口.ts\0-\t-\tassets/logo.png\0"
    );

    expect(stats).toEqual({
      files: [
        {
          path: "src/入口.ts",
          additions: 3,
          deletions: 1,
          binary: false
        },
        {
          path: "assets/logo.png",
          binary: true
        }
      ],
      additions: 3,
      deletions: 1
    });
  });

  it("uses the destination path from a NUL-delimited rename record", () => {
    const stats = parseCommitNumstat(
      "1\t0\t\0before name.txt\0after name.txt\0"
    );

    expect(stats).toEqual({
      files: [
        {
          path: "after name.txt",
          additions: 1,
          deletions: 0,
          binary: false
        }
      ],
      additions: 1,
      deletions: 0
    });
  });
});
