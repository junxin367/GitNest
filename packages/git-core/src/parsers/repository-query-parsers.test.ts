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

  it("counts hunk content that resembles unified diff file headers", () => {
    const diff = parseRepositoryDiff(
      "header-like.txt",
      "unstaged",
      [
        "diff --git a/header-like.txt b/header-like.txt",
        "--- a/header-like.txt",
        "+++ b/header-like.txt",
        "@@ -1 +1 @@",
        "---- old",
        "++++ new",
        ""
      ].join("\n")
    );

    expect(diff).toMatchObject({
      additions: 1,
      deletions: 1
    });
  });

  it("resets hunk parsing when a pathspec produces multiple file patches", () => {
    const diff = parseRepositoryDiff(
      "foo",
      "staged",
      [
        "diff --git a/foo b/foo",
        "deleted file mode 100644",
        "--- a/foo",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-old",
        "diff --git a/foo/bar b/foo/bar",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/foo/bar",
        "@@ -0,0 +1 @@",
        "+new",
        ""
      ].join("\n")
    );

    expect(diff).toMatchObject({
      additions: 1,
      deletions: 1
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
        "HEAD -> main, tag: release,one",
        "Subject line\n\nBody line\n"
      ].join("\0")
    );

    expect(metadata).toMatchObject({
      hash: "abcdef",
      subject: "Subject line",
      body: "Subject line\n\nBody line",
      parentHashes: ["parent1", "parent2"],
      refs: ["HEAD -> main", "tag: release,one"]
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
