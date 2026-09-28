import { describe, expect, it, vi } from "vitest";

import { copyTextToClipboard } from "../../shared/lib/copyTextToClipboard";
import {
  collectDiffViewerSearchHits,
  parseDiffViewModel
} from "../../shared/model/diffViewModel";
import {
  groupHistoryRefBranches,
  historyRefOptionClassName,
  resolveHistoryLoadingRegion,
  shouldShowRepositoryChangesSkeleton
} from "./RepositoryPage";

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
          selectedRef: branches[2]!.fullName,
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
        hasError: false,
        scopeChanged: false
      })
    ).toBe(true);
  });

  it("shows the skeleton immediately when switching repositories", () => {
    expect(
      shouldShowRepositoryChangesSkeleton({
        hasCurrentChanges: true,
        hasError: false,
        scopeChanged: true
      })
    ).toBe(true);
  });

  it("reveals inputs only after current data or an error is ready", () => {
    expect(
      shouldShowRepositoryChangesSkeleton({
        hasCurrentChanges: true,
        hasError: false,
        scopeChanged: false
      })
    ).toBe(false);
    expect(
      shouldShowRepositoryChangesSkeleton({
        hasCurrentChanges: false,
        hasError: true,
        scopeChanged: false
      })
    ).toBe(false);
  });
});
