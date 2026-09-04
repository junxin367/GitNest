import { describe, expect, it } from "vitest";

import {
  parseGitLfsVersion,
  parseGitVersion
} from "./version";

describe("Git version parsers", () => {
  it("preserves the complete Git for Windows version", () => {
    expect(
      parseGitVersion("git version 2.53.0.windows.3\n")
    ).toBe("2.53.0.windows.3");
  });

  it("extracts a Git LFS version when available", () => {
    expect(
      parseGitLfsVersion(
        "git-lfs/3.7.0 (GitHub; windows amd64; go 1.24.0)"
      )
    ).toBe("3.7.0");
    expect(parseGitLfsVersion("git: 'lfs' is not a git command")).toBe(
      undefined
    );
  });
});
