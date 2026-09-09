import { describe, expect, it } from "vitest";

import { findNewDiffTreeDirectoryKeys } from "../../widgets/diff-workspace/DiffFileNavigator";

describe("findNewDiffTreeDirectoryKeys", () => {
  it("does not re-collapse a directory the user already expanded", () => {
    const known = new Set([
      "unstaged:fai-entity-sc",
      "unstaged:fai-entity-sc/src",
      "unstaged:fai-entity-sc/src/main"
    ]);

    expect(
      findNewDiffTreeDirectoryKeys(known, [...known])
    ).toEqual([]);
  });

  it("returns only newly introduced directories to collapse", () => {
    const known = new Set([
      "unstaged:fai-entity-sc",
      "unstaged:fai-entity-sc/src"
    ]);

    expect(
      findNewDiffTreeDirectoryKeys(known, [
        "unstaged:fai-entity-sc",
        "unstaged:fai-entity-sc/src",
        "unstaged:fai-entity-sc/src/main"
      ])
    ).toEqual(["unstaged:fai-entity-sc/src/main"]);
  });
});
