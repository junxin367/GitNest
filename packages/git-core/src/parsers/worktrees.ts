import type { Worktree } from "../domain/repository";
import { GitError } from "../errors/git-errors";

interface MutableWorktree {
  path?: string;
  head?: string;
  branch?: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  lockReason?: string;
  prunable: boolean;
  pruneReason?: string;
}

export function parseWorktrees(output: string): Worktree[] {
  const tokens = output.includes("\0")
    ? output.split("\0")
    : output.split(/\r?\n/);
  const worktrees: Worktree[] = [];
  let current = createMutableWorktree();

  const pushCurrent = () => {
    if (!current.path) {
      current = createMutableWorktree();
      return;
    }

    if (!current.head) {
      throw new GitError(
        "INVALID_GIT_OUTPUT",
        `Worktree ${current.path} is missing its HEAD.`
      );
    }

    worktrees.push({
      path: current.path,
      head: current.head,
      ...(current.branch ? { branch: current.branch } : {}),
      bare: current.bare,
      detached: current.detached,
      locked: current.locked,
      ...(current.lockReason
        ? { lockReason: current.lockReason }
        : {}),
      prunable: current.prunable,
      ...(current.pruneReason
        ? { pruneReason: current.pruneReason }
        : {}),
      primary: worktrees.length === 0
    });
    current = createMutableWorktree();
  };

  for (const token of tokens) {
    if (!token) {
      pushCurrent();
      continue;
    }

    const separator = token.indexOf(" ");
    const key = separator < 0 ? token : token.slice(0, separator);
    const value = separator < 0 ? "" : token.slice(separator + 1);

    switch (key) {
      case "worktree":
        if (current.path) {
          pushCurrent();
        }
        current.path = value;
        break;
      case "HEAD":
        current.head = value;
        break;
      case "branch":
        current.branch = value.startsWith("refs/heads/")
          ? value.slice("refs/heads/".length)
          : value;
        break;
      case "bare":
        current.bare = true;
        break;
      case "detached":
        current.detached = true;
        break;
      case "locked":
        current.locked = true;
        if (value) {
          current.lockReason = value;
        }
        break;
      case "prunable":
        current.prunable = true;
        if (value) {
          current.pruneReason = value;
        }
        break;
    }
  }

  pushCurrent();

  return worktrees;
}

function createMutableWorktree(): MutableWorktree {
  return {
    bare: false,
    detached: false,
    locked: false,
    prunable: false
  };
}
