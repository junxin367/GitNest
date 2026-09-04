import { describe, expect, it } from "vitest";

import {
  commitMetadataArguments,
  commitNumstatArguments,
  diffArguments,
  historyPageArguments
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
    expect(commitMetadataArguments("abcdef")).toContain("abcdef");
    expect(commitNumstatArguments("abcdef")).toEqual(
      expect.arrayContaining(["--numstat", "-z", "abcdef"])
    );
  });
});
