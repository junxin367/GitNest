import { describe, expect, it } from "vitest";

import { findNewDiffTreeDirectoryKeys } from "../../widgets/diff-workspace/DiffFileNavigator";

describe("findNewDiffTreeDirectoryKeys", () => {
  it("does not re-collapse a directory the user already expanded", () => {
    const known = new Set([
      "unstaged:sample-entity",
      "unstaged:sample-entity/src",
      "unstaged:sample-entity/src/main"
    ]);

    expect(
      findNewDiffTreeDirectoryKeys(known, [...known])
    ).toEqual([]);
  });

  it("returns only newly introduced directories to collapse", () => {
    const known = new Set([
      "unstaged:sample-entity",
      "unstaged:sample-entity/src"
    ]);

    expect(
      findNewDiffTreeDirectoryKeys(known, [
        "unstaged:sample-entity",
        "unstaged:sample-entity/src",
        "unstaged:sample-entity/src/main"
      ])
    ).toEqual(["unstaged:sample-entity/src/main"]);
  });
});
