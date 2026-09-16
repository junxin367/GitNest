import { describe, expect, it } from "vitest";

import {
  createCommitArguments,
  removeUntrackedArguments,
  restoreWorktreeArguments,
  stageAllArguments,
  stageArguments,
  stashMutationArguments,
  unstageArguments
} from "./write-repository";

describe("repository write commands", () => {
  it("stages every working-tree change without a path limit", () => {
    expect(stageAllArguments()).toEqual(["add", "--all"]);
  });

  it("uses literal pathspecs and an explicit boundary for stage", () => {
    expect(
      stageArguments(["-leading.txt", "src/入口.ts"])
    ).toEqual([
      "--literal-pathspecs",
      "add",
      "--",
      "-leading.txt",
      "src/入口.ts"
    ]);
  });

  it("uses restore for normal repositories and cached rm for unborn repositories", () => {
    expect(unstageArguments(["file.txt"], true)).toEqual([
      "--literal-pathspecs",
      "restore",
      "--staged",
      "--",
      "file.txt"
    ]);
    expect(unstageArguments(["file.txt"], false)).toEqual([
      "--literal-pathspecs",
      "rm",
      "--cached",
      "--ignore-unmatch",
      "--",
      "file.txt"
    ]);
  });

  it("passes commit messages as values and keeps hooks enabled", () => {
    const args = createCommitArguments(
      "-safe subject",
      "Body line"
    );

    expect(args).toEqual([
      "commit",
      "--message",
      "-safe subject",
      "--message",
      "Body line"
    ]);
    expect(args).not.toContain("--no-verify");
  });

  it("restores tracked worktree paths and removes untracked paths literally", () => {
    expect(restoreWorktreeArguments(["src/入口.ts"])).toEqual([
      "--literal-pathspecs",
      "restore",
      "--worktree",
      "--",
      "src/入口.ts"
    ]);
    expect(removeUntrackedArguments(["new.txt"])).toEqual([
      "--literal-pathspecs",
      "clean",
      "-f",
      "--",
      "new.txt"
    ]);
  });

  it("applies immutable stash hashes and drops or pops exact stash refs", () => {
    const hash = "a".repeat(40);

    expect(
      stashMutationArguments(
        "apply",
        "stash@{2}",
        hash
      )
    ).toEqual(["stash", "apply", hash]);
    expect(
      stashMutationArguments(
        "drop",
        "stash@{2}",
        hash
      )
    ).toEqual(["stash", "drop", "stash@{2}"]);
    expect(
      stashMutationArguments(
        "pop",
        "stash@{2}",
        hash
      )
    ).toEqual(["stash", "pop", "stash@{2}"]);
  });
});
