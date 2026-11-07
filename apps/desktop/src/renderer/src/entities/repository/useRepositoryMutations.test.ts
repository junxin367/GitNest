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

    expect(mutationPathsForChange(change, "stage")).toEqual([
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
  it("explains partial completion while retaining the original failure and diagnostics", () => {
    const message = formatLocalMutationErrorMessage({
      code: "COMMAND_FAILED", message: "后续批次失败。",
      details: { completedPathCount: 201, stderr: "\u001B[31mpermission denied\u001B[0m" }
    });
    expect(message).toContain("此前已处理 201 个路径");
    expect(message).toContain("请检查刷新后的变更列表");
    expect(message).toContain("后续批次失败。 permission denied");
    expect(message).not.toContain("\u001B");
  });
});
