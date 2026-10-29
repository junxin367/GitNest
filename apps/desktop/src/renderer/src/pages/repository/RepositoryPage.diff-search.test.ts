import { describe, expect, it, vi } from "vitest";

import { copyTextToClipboard } from "../../shared/lib/copyTextToClipboard";
import {
  collectDiffViewerSearchHits,
  parseDiffViewModel
} from "../../shared/model/diffViewModel";
import {
  buildHistoryRefLabels,
  groupHistoryRefBranches,
  historyRefOptionClassName,
  resolveHistoryLoadingRegion,
  shouldShowRepositoryChangesSkeleton
} from "./RepositoryPage";
import { buildHistoryGraph } from "./historyGraph";
import {
  createHistoryGraphColors,
  historyBranchTipColors
} from "./historyGraphColors";

describe("shared Diff search model", () => {
  it("finds every case-insensitive match in the unified document", () => {
    const model = parseDiffViewModel(
      [
        "@@ -1,2 +1,2 @@",
        " const needle = 1;",
        "-needle();",
        "+needle(); needle();"
      ].join("\n")
    );

    expect(
      collectDiffViewerSearchHits(model, "unified", "NEEDLE")
    ).toHaveLength(4);
  });

  it("does not search an empty query", () => {
    const model = parseDiffViewModel(
      "@@ -1 +1 @@\n const value = 1;"
    );
    expect(
      collectDiffViewerSearchHits(model, "unified", "  ")
    ).toEqual([]);
  });
});

describe("Diff path clipboard helper", () => {
  it("writes the full path through the browser clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    await copyTextToClipboard(
      "src/main/java/com/example/CoreApplicationConfig.java"
    );

    expect(writeText).toHaveBeenCalledWith(
      "src/main/java/com/example/CoreApplicationConfig.java"
    );
  });
});

describe("history branch picker grouping", () => {
  const branches = [
    {
      current: true,
      fullName: "refs/heads/test",
      name: "test",
      remote: false,
      upstream: "origin/test"
    },
    {
      current: false,
      fullName: "refs/heads/main",
      name: "main",
      remote: false,
      upstream: "origin/main"
    },
    {
      current: false,
      fullName: "refs/remotes/origin/test",
      merged: true,
      name: "origin/test",
      remote: true
    },
    {
      current: false,
      fullName: "refs/remotes/origin/feature",
      merged: false,
      name: "origin/feature",
      remote: true
    }
  ];

  it("shows only the active branch group without a query", () => {
    expect(
      groupHistoryRefBranches(branches, "", "local")
    ).toEqual({
      localBranchCount: 2,
      localBranches: branches.slice(0, 2),
      mergedRemoteCount: 1,
      remoteBranchCount: 2,
      remoteBranches: [],
      searching: false
    });
    expect(
      groupHistoryRefBranches(branches, "", "remote")
    ).toEqual({
      localBranchCount: 2,
      localBranches: [],
      mergedRemoteCount: 1,
      remoteBranchCount: 2,
      remoteBranches: [branches[3]],
      searching: false
    });
  });

  it("searches local and remote branches regardless of the active group", () => {
    const expected = {
      localBranchCount: 2,
      localBranches: [branches[0]],
      mergedRemoteCount: 1,
      remoteBranchCount: 2,
      remoteBranches: [branches[2]],
      searching: true
    };

    expect(
      groupHistoryRefBranches(branches, "test", "local")
    ).toEqual(expected);
    expect(
      groupHistoryRefBranches(branches, "test", "remote")
    ).toEqual(expected);
  });

  it("can reveal merged remote branches and always keeps the selected ref visible", () => {
    expect(
      groupHistoryRefBranches(
        branches,
        "",
        "remote",
        {
          selectedRef: "",
          showMergedRemote: true
        }
      ).remoteBranches
    ).toEqual(branches.slice(2));
    expect(
      groupHistoryRefBranches(
        branches,
        "",
        "remote",
        {
          selectedRefs: [branches[2]!.fullName, branches[3]!.fullName],
          showMergedRemote: false
        }
      ).remoteBranches
    ).toEqual(branches.slice(2));
  });

  it("uses the shared selected menu state instead of a trailing checkmark", () => {
    expect(historyRefOptionClassName(true)).toBe(
      "history-ref-option is-selected"
    );
    expect(historyRefOptionClassName(false)).toBe(
      "history-ref-option"
    );
  });
});

describe("history ref decorations and graph colours", () => {
  it("prioritizes HEAD, merges matching remote labels, and keeps tags separate", () => {
    const labels = buildHistoryRefLabels(
      [
        "refs/heads/main",
        "HEAD -> main",
        "refs/remotes/origin/main",
        "refs/remotes/upstream/main",
        "tag: v1.0.0"
      ],
      new Set(["refs/remotes/origin/main", "refs/remotes/upstream/main"])
    );

    expect(labels).toEqual([
      expect.objectContaining({
        kind: "head",
        name: "main",
        active: true,
        remotes: ["origin", "upstream"]
      }),
      expect.objectContaining({
        kind: "tag",
        name: "v1.0.0"
      })
    ]);
  });

  it("does not let an off-page branch tip consume a graph colour", () => {
    const colors = createHistoryGraphColors();
    colors.refs.set("refs/heads/main", 0);
    const commits = [{
      hash: "visible",
      shortHash: "visible",
      authorName: "Alice",
      authorEmail: "alice@example.com",
      authoredAt: "2026-01-01T00:00:00.000Z",
      subject: "Visible",
      parentHashes: [],
      refs: []
    }];
    const branches = [
      {
        fullName: "refs/heads/main",
        name: "main",
        head: "visible",
        current: true,
        remote: false
      },
      {
        fullName: "refs/heads/hidden",
        name: "hidden",
        head: "outside-page",
        current: false,
        remote: false
      }
    ];

    expect(
      historyBranchTipColors(commits, branches, colors)
    ).toEqual(new Map([["visible", "var(--blue)"]]));
    expect(colors.refs.has("refs/heads/hidden")).toBe(false);
  });

  it("keeps merge parents on separate lanes until they reconnect", () => {
    const commits = [
      {
        hash: "merge",
        shortHash: "merge",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        authoredAt: "2026-01-03T00:00:00.000Z",
        subject: "Merge",
        parentHashes: ["main", "feature"],
        refs: []
      },
      {
        hash: "main",
        shortHash: "main",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        authoredAt: "2026-01-02T00:00:00.000Z",
        subject: "Main",
        parentHashes: ["root"],
        refs: []
      },
      {
        hash: "feature",
        shortHash: "feature",
        authorName: "Bob",
        authorEmail: "bob@example.com",
        authoredAt: "2026-01-02T00:00:00.000Z",
        subject: "Feature",
        parentHashes: ["root"],
        refs: []
      },
      {
        hash: "root",
        shortHash: "root",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        authoredAt: "2026-01-01T00:00:00.000Z",
        subject: "Root",
        parentHashes: [],
        refs: []
      }
    ];

    const graph = buildHistoryGraph(commits);
    expect(graph.rows[0]!.paths).toHaveLength(2);
    expect(graph.rows[1]!.lane).toBe(0);
    expect(graph.rows[2]!.lane).toBeGreaterThan(0);
    expect(graph.rows[3]!.lane).toBe(0);
    expect(graph.width).toBeGreaterThanOrEqual(64);
  });
});

describe("history loading presentation", () => {
  it("uses the page skeleton only before history has loaded once", () => {
    expect(
      resolveHistoryLoadingRegion({
        hasCurrentHistory: false,
        hasLoadedHistory: false,
        loading: true
      })
    ).toBe("page");
  });

  it("limits branch-switch loading to the history content region", () => {
    expect(
      resolveHistoryLoadingRegion({
        hasCurrentHistory: false,
        hasLoadedHistory: true,
        loading: true
      })
    ).toBe("content");
  });

  it("keeps existing history visible during background refreshes", () => {
    expect(
      resolveHistoryLoadingRegion({
        hasCurrentHistory: true,
        hasLoadedHistory: true,
        loading: true
      })
    ).toBe("ready");
  });
});

describe("repository changes loading presentation", () => {
  it("shows the skeleton before the first changes response", () => {
    expect(
      shouldShowRepositoryChangesSkeleton({
        hasCurrentChanges: false,
        loading: true
      })
    ).toBe(true);
  });

  it("keeps current data visible while reloading", () => {
    expect(
      shouldShowRepositoryChangesSkeleton({
        hasCurrentChanges: true,
        loading: true
      })
    ).toBe(false);
  });

  it("does not retain the skeleton after loading stops", () => {
    expect(
      shouldShowRepositoryChangesSkeleton({
        hasCurrentChanges: true,
        loading: false
      })
    ).toBe(false);
    expect(
      shouldShowRepositoryChangesSkeleton({
        hasCurrentChanges: false,
        loading: false
      })
    ).toBe(false);
  });
});
