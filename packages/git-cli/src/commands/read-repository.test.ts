import { describe, expect, it } from "vitest";

import {
  commitDiffArguments,
  commitMetadataArguments,
  commitNumstatArguments,
  commitParentsArguments,
  compareHistoryCountArguments,
  compareHistoryMergeBaseArguments,
  compareHistoryPageArguments,
  diffArguments,
  historyPageArguments,
  MERGED_REMOTE_BRANCH_ARGUMENTS,
  resolveStashArguments,
  stashDiffArguments,
  stashFilesArguments,
  stashListArguments,
  stashUntrackedDiffArguments,
  stagedFileContentArguments,
  stagedFileSizeArguments,
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

  it("reads staged media from the exact index path", () => {
    expect(stagedFileSizeArguments("assets/预览.webp")).toEqual([
      "cat-file",
      "-s",
      ":assets/预览.webp"
    ]);
    expect(
      stagedFileContentArguments("assets/预览.webp")
    ).toEqual(["show", ":assets/预览.webp"]);
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
    expect(
      historyPageArguments(
        51,
        50,
        "refs/remotes/origin/main"
      )
    ).toContain("refs/remotes/origin/main");
    expect(
      compareHistoryPageArguments(
        51,
        50,
        "refs/heads/main",
        "refs/heads/develop"
      )
    ).toEqual(
      expect.arrayContaining([
        "--left-right",
        "--boundary",
        "--topo-order",
        "--format=%m%x1f%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%P%x1f%D%x1e",
        "refs/heads/main...refs/heads/develop"
      ])
    );
    expect(
      compareHistoryCountArguments(
        "refs/heads/main",
        "refs/heads/develop"
      )
    ).toEqual([
      "rev-list",
      "--left-right",
      "--count",
      "refs/heads/main...refs/heads/develop"
    ]);
    expect(
      compareHistoryMergeBaseArguments(
        "refs/heads/main",
        "refs/heads/develop"
      )
    ).toEqual([
      "merge-base",
      "refs/heads/main",
      "refs/heads/develop"
    ]);
    expect(commitMetadataArguments("abcdef")).toContain("abcdef");
    expect(commitNumstatArguments("abcdef")).toEqual(
      expect.arrayContaining(["--numstat", "-z", "abcdef"])
    );
  });

  it("constructs a literal-path commit diff against the first parent with root support", () => {
    expect(
      commitDiffArguments(
        "abcdef",
        "123456",
        "-leading-dash.ts",
        13
      )
    ).toEqual([
      "--literal-pathspecs",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--unified=13",
      "123456",
      "abcdef",
      "--",
      "-leading-dash.ts"
    ]);
    expect(
      commitDiffArguments("abcdef", undefined, "root.ts", 3)
    ).toEqual(
      expect.arrayContaining([
        "diff-tree",
        "--root",
        "--no-commit-id",
        "-p",
        "-r",
        "abcdef",
        "--",
        "root.ts"
      ])
    );
    expect(commitParentsArguments("abcdef")).toEqual([
      "rev-list",
      "--parents",
      "--max-count=1",
      "--end-of-options",
      "abcdef"
    ]);
  });

  it("reads remote branches merged into the current HEAD", () => {
    expect(MERGED_REMOTE_BRANCH_ARGUMENTS).toEqual([
      "for-each-ref",
      "--merged=HEAD",
      "--format=%(refname)",
      "refs/remotes"
    ]);
  });

  it("constructs bounded and literal-path stash queries", () => {
    expect(stashListArguments(50)).toEqual(
      expect.arrayContaining([
        "stash",
        "list",
        "--max-count=50",
        "--format=%gd%x00%H%x00%an%x00%ae%x00%aI%x00%s%x00%P%x00%x00"
      ])
    );
    expect(stashFilesArguments("stash@{0}")).toEqual(
      expect.arrayContaining([
        "--literal-pathspecs",
        "--include-untracked",
        "--numstat",
        "stash@{0}"
      ])
    );
    expect(
      stashDiffArguments("stash@{2}", "-leading-dash.ts", 13)
    ).toEqual(
      expect.arrayContaining([
        "--literal-pathspecs",
        "--unified=13",
        "stash@{2}^1",
        "stash@{2}",
        "--",
        "-leading-dash.ts"
      ])
    );
    expect(
      stashUntrackedDiffArguments(
        "stash@{2}",
        "new.ts",
        3
      )
    ).toEqual(
      expect.arrayContaining([
        "diff-tree",
        "--root",
        "--no-commit-id",
        "-p",
        "stash@{2}^3",
        "--",
        "new.ts"
      ])
    );
    expect(
      stashUntrackedDiffArguments(
        "stash@{2}",
        "new.ts",
        3
      )
    ).not.toContain("stash@{2}^1");
    expect(resolveStashArguments("stash@{1}")).toEqual([
      "rev-parse",
      "--verify",
      "--end-of-options",
      "stash@{1}^{commit}"
    ]);
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
