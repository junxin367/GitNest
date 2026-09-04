export const STATUS_ARGUMENTS = [
  "status",
  "--porcelain=v2",
  "--branch",
  "-z",
  "--untracked-files=all"
] as const;

export const BRANCH_ARGUMENTS = [
  "for-each-ref",
  "--format=%(refname)%1f%(refname:short)%1f%(objectname)%1f%(upstream:short)%1f%(HEAD)%1f%(worktreepath)%1e",
  "refs/heads",
  "refs/remotes"
] as const;

export const WORKTREE_ARGUMENTS = [
  "worktree",
  "list",
  "--porcelain",
  "-z"
] as const;

export function historyArguments(limit: number): string[] {
  return [
    "log",
    `--max-count=${limit}`,
    "--date=iso-strict",
    "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%P%x1e"
  ];
}

export function historyPageArguments(
  limit: number,
  offset: number
): string[] {
  return [
    "log",
    `--max-count=${limit}`,
    `--skip=${offset}`,
    "--date=iso-strict",
    "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%P%x1e"
  ];
}

export function diffArguments(
  path: string,
  mode: "unstaged" | "staged" | "untracked",
  contextLines: number
): string[] {
  const base = [
    "--literal-pathspecs",
    "diff",
    "--no-ext-diff",
    "--no-color",
    `--unified=${contextLines}`
  ];

  if (mode === "staged") {
    return [...base, "--cached", "--", path];
  }

  if (mode === "untracked") {
    return [
      ...base,
      "--no-index",
      "--",
      "/dev/null",
      path
    ];
  }

  return [...base, "--", path];
}

export function commitMetadataArguments(
  commitHash: string
): string[] {
  return [
    "show",
    "-s",
    "--no-color",
    "--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%P%x00%D%x00%B",
    commitHash
  ];
}

export function commitNumstatArguments(
  commitHash: string
): string[] {
  return [
    "diff-tree",
    "--root",
    "--no-commit-id",
    "--no-renames",
    "--numstat",
    "-r",
    "-z",
    commitHash
  ];
}
