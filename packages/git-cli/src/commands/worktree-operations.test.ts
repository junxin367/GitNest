import { describe, expect, it } from "vitest";

import {
  createWorktreeArguments,
  lockWorktreeArguments,
  moveWorktreeArguments,
  PREVIEW_PRUNE_WORKTREES_ARGUMENTS,
  PRUNE_WORKTREES_ARGUMENTS,
  removeWorktreeArguments,
  repairWorktreesArguments,
  unlockWorktreeArguments
} from "./worktree-operations";

describe("worktree operation commands", () => {
  it("builds explicit existing, new, and detached create modes", () => {
    expect(
      createWorktreeArguments({
        destination: "D:\\worktrees\\feature",
        startPoint: "a".repeat(40),
        branch: "feature/existing",
        createBranch: false,
        detached: false
      })
    ).toEqual([
      "worktree",
      "add",
      "D:\\worktrees\\feature",
      "feature/existing"
    ]);
    expect(
      createWorktreeArguments({
        destination: "D:\\worktrees\\new",
        startPoint: "a".repeat(40),
        branch: "feature/new",
        createBranch: true,
        detached: false
      })
    ).toEqual([
      "worktree",
      "add",
      "-b",
      "feature/new",
      "D:\\worktrees\\new",
      "a".repeat(40)
    ]);
    expect(
      createWorktreeArguments({
        destination: "D:\\worktrees\\detached",
        startPoint: "a".repeat(40),
        createBranch: false,
        detached: true
      })
    ).toEqual([
      "worktree",
      "add",
      "--detach",
      "D:\\worktrees\\detached",
      "a".repeat(40)
    ]);
  });

  it("keeps lock, move, repair, prune, and remove arguments fixed", () => {
    expect(
      lockWorktreeArguments(
        "D:\\worktrees\\feature",
        "release validation"
      )
    ).toEqual([
      "worktree",
      "lock",
      "--reason",
      "release validation",
      "D:\\worktrees\\feature"
    ]);
    expect(
      unlockWorktreeArguments("D:\\worktrees\\feature")
    ).toEqual([
      "worktree",
      "unlock",
      "D:\\worktrees\\feature"
    ]);
    expect(
      moveWorktreeArguments(
        "D:\\worktrees\\feature",
        "E:\\worktrees\\feature"
      )
    ).toEqual([
      "worktree",
      "move",
      "D:\\worktrees\\feature",
      "E:\\worktrees\\feature"
    ]);
    expect(
      repairWorktreesArguments([
        "D:\\worktrees\\feature",
        "E:\\worktrees\\other"
      ])
    ).toEqual([
      "worktree",
      "repair",
      "D:\\worktrees\\feature",
      "E:\\worktrees\\other"
    ]);
    expect(PRUNE_WORKTREES_ARGUMENTS).toEqual([
      "worktree",
      "prune",
      "--verbose",
      "--expire=now"
    ]);
    expect(PREVIEW_PRUNE_WORKTREES_ARGUMENTS).toEqual([
      "worktree",
      "prune",
      "--dry-run",
      "--verbose",
      "--expire=now"
    ]);
    expect(
      removeWorktreeArguments("D:\\worktrees\\feature")
    ).toEqual([
      "worktree",
      "remove",
      "D:\\worktrees\\feature"
    ]);
  });
});
