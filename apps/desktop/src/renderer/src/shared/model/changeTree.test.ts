import { describe, expect, it } from "vitest";

import {
  buildChangeTree,
  changeTreeDirectoryPaths,
  compactChangeTreeNodes
} from "./changeTree";

describe("changeTree", () => {
  it("sorts directories first and compacts single-directory chains", () => {
    const tree = compactChangeTreeNodes(
      buildChangeTree([
        change("README.md"),
        change("src/feature10/App.ts"),
        change("src/feature2/Button.ts"),
        change("docs/guide/start.md")
      ])
    );

    expect(tree.map((node) => node.name)).toEqual([
      "docs \\ guide",
      "src",
      "README.md"
    ]);
    expect(tree[1]?.children.map((node) => node.name)).toEqual([
      "feature2",
      "feature10"
    ]);
  });

  it("returns every directory path for collapse state", () => {
    expect(
      changeTreeDirectoryPaths(
        "src/main/java/com/example/App.java"
      )
    ).toEqual([
      "src",
      "src/main",
      "src/main/java",
      "src/main/java/com",
      "src/main/java/com/example"
    ]);
  });
});

function change(path: string) {
  return {
    path,
    indexStatus: ".",
    worktreeStatus: "M",
    kind: "ordinary" as const
  };
}
