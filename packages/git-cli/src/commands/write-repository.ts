export function stageAllArguments(): string[] {
  return ["add", "--all"];
}

export function stageArguments(
  paths: readonly string[]
): string[] {
  return [
    "--literal-pathspecs",
    "add",
    "--",
    ...paths
  ];
}

export function unstageArguments(
  paths: readonly string[],
  hasHead: boolean
): string[] {
  return hasHead
    ? [
        "--literal-pathspecs",
        "restore",
        "--staged",
        "--",
        ...paths
      ]
    : [
        "--literal-pathspecs",
        "rm",
        "--cached",
        "--ignore-unmatch",
        "--",
        ...paths
      ];
}

export function restoreWorktreeArguments(
  paths: readonly string[]
): string[] {
  return [
    "--literal-pathspecs",
    "restore",
    "--worktree",
    "--",
    ...paths
  ];
}

export function removeUntrackedArguments(
  paths: readonly string[]
): string[] {
  return [
    "--literal-pathspecs",
    "clean",
    "-f",
    "--",
    ...paths
  ];
}

export function stashMutationArguments(
  action: "apply" | "drop" | "pop",
  stashRef: string,
  stashHash: string
): string[] {
  return [
    "stash",
    action,
    action === "apply" ? stashHash : stashRef
  ];
}

export function createCommitArguments(
  subject: string,
  body?: string
): string[] {
  return [
    "commit",
    "--message",
    subject,
    ...(body ? ["--message", body] : [])
  ];
}
