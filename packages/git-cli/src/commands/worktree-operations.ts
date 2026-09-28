export function createWorktreeArguments(input: {
  destination: string;
  startPoint: string;
  branch?: string;
  createBranch: boolean;
  detached: boolean;
}): string[] {
  if (input.detached) {
    return [
      "worktree",
      "add",
      "--detach",
      input.destination,
      input.startPoint
    ];
  }
  if (input.createBranch) {
    return [
      "worktree",
      "add",
      "-b",
      input.branch as string,
      input.destination,
      input.startPoint
    ];
  }
  return [
    "worktree",
    "add",
    input.destination,
    input.branch as string
  ];
}

export function lockWorktreeArguments(
  worktreePath: string,
  reason?: string
): string[] {
  return [
    "worktree",
    "lock",
    ...(reason ? ["--reason", reason] : []),
    worktreePath
  ];
}

export function unlockWorktreeArguments(
  worktreePath: string
): string[] {
  return ["worktree", "unlock", worktreePath];
}

export function moveWorktreeArguments(
  worktreePath: string,
  destination: string
): string[] {
  return [
    "worktree",
    "move",
    worktreePath,
    destination
  ];
}

export function repairWorktreesArguments(
  worktreePaths: readonly string[]
): string[] {
  return ["worktree", "repair", ...worktreePaths];
}

export const PRUNE_WORKTREES_ARGUMENTS = [
  "worktree",
  "prune",
  "--verbose",
  "--expire=now"
] as const;

export const PREVIEW_PRUNE_WORKTREES_ARGUMENTS = [
  "worktree",
  "prune",
  "--dry-run",
  "--verbose",
  "--expire=now"
] as const;

export function removeWorktreeArguments(
  worktreePath: string
): string[] {
  return ["worktree", "remove", worktreePath];
}
