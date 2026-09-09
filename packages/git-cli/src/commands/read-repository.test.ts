import { describe, expect, it } from "vitest";

import {
  commitMetadataArguments,
  commitNumstatArguments,
  diffArguments,
  historyPageArguments,
  STAGED_DIFF_STAT_ARGUMENTS,
  UNSTAGED_DIFF_PATH_ARGUMENTS
} from "./read-repository";

describe("repository read commands", () => {
  it("uses an explicit pathspec boundary for every diff mode", () => {
    expect(
      diffArguments("-leading-dash.ts", "unstaged", 3)
    ).toEqual(
      expect.arrayContaining(["--", "-leading-dash.ts"])
    );
    expect(diffArguments("staged.ts", "staged", 5)).toEqual(
      expect.arrayContaining(["--cached", "--", "staged.ts"])
    );
    expect(diffArguments("新文件.ts", "untracked", 3)).toEqual(
      expect.arrayContaining([
        "--no-index",
        "--",
        "/dev/null",
        "新文件.ts"
      ])
    );
  });

  it("constructs bounded history and commit detail commands", () => {
    expect(historyPageArguments(51, 50)).toEqual(
      expect.arrayContaining(["--max-count=51", "--skip=50"])
    );
    expect(historyPageArguments(51, 50)).toContain(
      "--decorate=short"
    );
    expect(historyPageArguments(51, 50)).toContain(
      "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%P%x1f%D%x1e"
    );
    expect(commitMetadataArguments("abcdef")).toContain("abcdef");
    expect(commitNumstatArguments("abcdef")).toEqual(
      expect.arrayContaining(["--numstat", "-z", "abcdef"])
    );
  });

  it("reads all meaningful unstaged paths in one non-mutating command", () => {
    expect(UNSTAGED_DIFF_PATH_ARGUMENTS).toEqual([
      "-c",
      "diff.autoRefreshIndex=false",
      "--literal-pathspecs",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--numstat",
      "--find-renames",
      "-z",
      "--"
    ]);
    expect(STAGED_DIFF_STAT_ARGUMENTS).toEqual([
      "-c",
      "diff.autoRefreshIndex=false",
      "--literal-pathspecs",
      "diff",
      "--cached",
      "--no-ext-diff",
      "--no-textconv",
      "--numstat",
      "--find-renames",
      "-z",
      "--"
    ]);
  });
});
