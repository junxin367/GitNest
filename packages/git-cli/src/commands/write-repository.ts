export function stageAllArguments(): string[] {
  return ["add", "--all"];
}

export function stageArguments(
  paths: readonly string[],
  trackedOnly = false,
  fromStdin = false
): string[] {
  return [
    "--literal-pathspecs",
    "add",
    ...(trackedOnly ? ["--update"] : []),
    ...pathspecArguments(paths, fromStdin)
  ];
}

export function unstageArguments(
  paths: readonly string[],
  hasHead: boolean,
  fromStdin = false
): string[] {
  return hasHead
    ? [
        "--literal-pathspecs",
        "restore",
        "--staged",
        ...pathspecArguments(paths, fromStdin)
      ]
    : [
        "--literal-pathspecs",
        "rm",
        "--cached",
        "--force",
        "--ignore-unmatch",
        ...pathspecArguments(paths, fromStdin)
      ];
}

export function restoreWorktreeArguments(
  paths: readonly string[],
  fromStdin = false
): string[] {
  return [
    "--literal-pathspecs",
    "restore",
    "--worktree",
    "--no-recurse-submodules",
    ...pathspecArguments(paths, fromStdin)
  ];
}

function pathspecArguments(paths: readonly string[], fromStdin: boolean): string[] {
  return fromStdin
    ? ["--pathspec-from-file=-", "--pathspec-file-nul"]
    : ["--", ...paths];
}

/** Keep read commands and git clean below the Windows command-line limit. */
export function splitPathspecBatches(paths: readonly string[]): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let length = 0;
  for (const path of paths) {
    const cost = path.length * 2 + 3;
    if (batch.length && (batch.length >= 200 || length + cost > 20_000)) {
      batches.push(batch);
      batch = [];
      length = 0;
    }
    batch.push(path);
    length += cost;
  }
  if (batch.length) batches.push(batch);
  return batches;
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
