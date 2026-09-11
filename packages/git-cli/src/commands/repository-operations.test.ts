import { describe, expect, it } from "vitest";

import {
  createBranchArguments,
  deleteBranchArguments,
  fetchRemoteArguments,
  pullBranchArguments,
  pullFastForwardArguments,
  pushBranchArguments,
  readRemoteUrlArguments,
  renameBranchArguments,
  resolveRevisionArguments,
  switchBranchArguments
} from "./repository-operations";

describe("repository operation commands", () => {
  it("pins pull to ff-only and binds explicit remote refs", () => {
    expect(
      pullFastForwardArguments("origin", "main")
    ).toEqual([
      "pull",
      "--ff-only",
      "--no-rebase",
      "--",
      "origin",
      "refs/heads/main"
    ]);
  });

  it("builds configured rebase and merge pull arguments", () => {
    expect(
      pullBranchArguments("origin", "main", "rebase")
    ).toEqual([
      "pull",
      "--rebase",
      "--",
      "origin",
      "refs/heads/main"
    ]);
    expect(
      pullBranchArguments("origin", "main", "merge")
    ).toEqual([
      "pull",
      "--no-rebase",
      "--",
      "origin",
      "refs/heads/main"
    ]);
  });

  it("constructs explicit normal and force-with-lease pushes", () => {
    expect(
      pushBranchArguments({
        remote: "origin",
        localBranch: "main",
        remoteBranch: "main",
        setUpstream: false
      })
    ).toEqual([
      "push",
      "--",
      "origin",
      "refs/heads/main:refs/heads/main"
    ]);
    expect(
      pushBranchArguments({
        remote: "origin",
        localBranch: "feature/test",
        remoteBranch: "feature/test",
        setUpstream: true,
        forceWithLeaseExpected: "a".repeat(40)
      })
    ).toEqual([
      "push",
      "--set-upstream",
      `--force-with-lease=refs/heads/feature/test:${"a".repeat(40)}`,
      "--",
      "origin",
      "refs/heads/feature/test:refs/heads/feature/test"
    ]);
  });

  it("keeps branch operations in fixed argument positions", () => {
    expect(createBranchArguments("feature/test", "abcdef")).toEqual([
      "branch",
      "--",
      "feature/test",
      "abcdef"
    ]);
    expect(switchBranchArguments("feature/test")).toEqual([
      "switch",
      "--no-guess",
      "--",
      "feature/test"
    ]);
    expect(
      renameBranchArguments("feature/test", "feature/renamed")
    ).toEqual([
      "branch",
      "--move",
      "feature/test",
      "feature/renamed"
    ]);
    expect(deleteBranchArguments("feature/renamed")).toEqual([
      "branch",
      "--delete",
      "--",
      "feature/renamed"
    ]);
  });

  it("uses end-of-options for revision resolution and an explicit fetch remote", () => {
    expect(resolveRevisionArguments("-unsafe")).toContain(
      "--end-of-options"
    );
    expect(fetchRemoteArguments("origin", true)).toEqual([
      "fetch",
      "--prune",
      "--",
      "origin"
    ]);
    expect(readRemoteUrlArguments("origin")).toEqual([
      "remote",
      "get-url",
      "--",
      "origin"
    ]);
  });
});
