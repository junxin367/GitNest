import { describe, expect, it } from "vitest";

import {
  canStageChange,
  canUnstageChange,
  formatLocalMutationErrorMessage,
  mutationPathsForChange
} from "./useRepositoryMutations";

describe("repository mutation selection", () => {
  it("keeps both sides of a rename in one exact mutation", () => {
    const change = {
      path: "new name.txt",
      originalPath: "old name.txt",
      indexStatus: ".",
      worktreeStatus: "R",
      kind: "renamed"
    } as const;

    expect(mutationPathsForChange(change)).toEqual([
      "new name.txt",
      "old name.txt"
    ]);
    expect(canStageChange(change)).toBe(true);
    expect(canUnstageChange(change)).toBe(false);
  });

  it("separates staged, unstaged, untracked, and conflict actions", () => {
    expect(
      canUnstageChange({
        path: "staged.txt",
        indexStatus: "M",
        worktreeStatus: ".",
        kind: "ordinary"
      })
    ).toBe(true);
    expect(
      canStageChange({
        path: "unstaged.txt",
        indexStatus: ".",
        worktreeStatus: "M",
        kind: "ordinary"
      })
    ).toBe(true);
    expect(
      canStageChange({
        path: "new.txt",
        indexStatus: "?",
        worktreeStatus: "?",
        kind: "untracked"
      })
    ).toBe(true);
    expect(
      canUnstageChange({
        path: "conflict.txt",
        indexStatus: "U",
        worktreeStatus: "U",
        kind: "unmerged"
      })
    ).toBe(true);
  });

  it("shows bounded local hook diagnostics without terminal control characters", () => {
    expect(
      formatLocalMutationErrorMessage({
        code: "COMMAND_FAILED",
        message: "Git exited with code 1.",
        details: {
          stderr:
            "\u001B[31mHook rejected the message\u001B[0m\u0007\n"
        }
      })
    ).toBe(
      "Git exited with code 1. Hook rejected the message"
    );
  });
});
