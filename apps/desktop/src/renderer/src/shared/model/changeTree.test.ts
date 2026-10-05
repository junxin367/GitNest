import { describe, expect, it, vi } from "vitest";

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

  it("indexes sibling insertion instead of scanning accumulated children", () => {
    const find = vi.spyOn(Array.prototype, "find");
    const changes = Array.from(
      { length: 2_000 },
      (_, index) => change(`src/file-${index}.ts`)
    );

    try {
      const tree = buildChangeTree(changes);

      expect(tree[0]?.children).toHaveLength(2_000);
      expect(find).not.toHaveBeenCalled();
    } finally {
      find.mockRestore();
    }
  });

  it("keeps same-name file and directory nodes separate and preserves duplicate semantics", () => {
    const first = change("src\\entry");
    const replacement = {
      ...change("src/entry"),
      worktreeStatus: "D"
    };
    const tree = buildChangeTree([
      first,
      change("src/entry/child.ts"),
      replacement
    ]);
    const sameNameNodes = tree[0]?.children.filter(
      (node) => node.name === "entry"
    );

    expect(
      sameNameNodes?.map((node) => node.directory)
    ).toEqual([true, false]);
    expect(sameNameNodes?.[1]).toMatchObject({
      path: first.path,
      change: replacement
    });
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
