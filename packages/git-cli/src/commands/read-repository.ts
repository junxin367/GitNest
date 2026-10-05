export const STATUS_ARGUMENTS = [
  "-c",
  "core.fsmonitor=false",
  "status",
  "--porcelain=v2",
  "--branch",
  "-z",
  "--untracked-files=all"
] as const;

export const UNSTAGED_DIFF_PATH_ARGUMENTS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "diff.autoRefreshIndex=false",
  "--literal-pathspecs",
  "diff",
  "--no-ext-diff",
  "--no-textconv",
  "--numstat",
  "--find-renames",
  "-z",
  "--"
] as const;

export const STAGED_DIFF_STAT_ARGUMENTS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "diff.autoRefreshIndex=false",
  "--literal-pathspecs",
  "diff",
  "--cached",
  "--no-ext-diff",
  "--no-textconv",
  "--numstat",
  "--find-renames",
  "-z",
  "--"
] as const;

export const BRANCH_ARGUMENTS = [
  "for-each-ref",
  "--format=%(refname)%1f%(refname:lstrip=2)%1f%(objectname)%1f%(upstream:lstrip=2)%1f%(HEAD)%1f%(worktreepath)%1f%(authordate:iso-strict)%1f%(symref)%1e",
  "refs/heads",
  "refs/remotes"
] as const;

export const MERGED_REMOTE_BRANCH_ARGUMENTS = [
  "for-each-ref",
  "--merged=HEAD",
  "--format=%(refname)",
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
    "--decorate=short",
    "--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%s%x00%P%x00%D%x00"
  ];
}

export function historyPageArguments(
  limit: number,
  offset: number,
  ref?: string
): string[] {
  return [
    "log",
    `--max-count=${limit}`,
    `--skip=${offset}`,
    "--date=iso-strict",
    "--decorate=short",
    "--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%s%x00%P%x00%D%x00",
    ...(ref ? [ref] : [])
  ];
}

export function compareHistoryPageArguments(
  limit: number,
  offset: number,
  leftRef: string,
  rightRef: string
): string[] {
  return [
    "log",
    `--max-count=${limit}`,
    `--skip=${offset}`,
    "--left-right",
    "--boundary",
    "--topo-order",
    "--date=iso-strict",
    "--decorate=short",
    "--format=%m%x00%H%x00%h%x00%an%x00%ae%x00%aI%x00%s%x00%P%x00%D%x00",
    `${leftRef}...${rightRef}`
  ];
}

export function compareHistoryCountArguments(
  leftRef: string,
  rightRef: string
): string[] {
  return [
    "rev-list",
    "--left-right",
    "--count",
    `${leftRef}...${rightRef}`
  ];
}

export function compareHistoryMergeBaseArguments(
  leftRef: string,
  rightRef: string
): string[] {
  return ["merge-base", leftRef, rightRef];
}

export function diffArguments(
  path: string,
  mode: "unstaged" | "staged" | "untracked",
  contextLines: number
): string[] {
  const base = [
    "-c",
    "core.fsmonitor=false",
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

export function stagedFileSizeArguments(path: string): string[] {
  return ["cat-file", "-s", `:${path}`];
}

export function stagedFileContentArguments(path: string): string[] {
  return ["show", `:${path}`];
}

export function revisionFileSizeArguments(
  revision: string,
  path: string
): string[] {
  return ["cat-file", "-s", `${revision}:${path}`];
}

export function revisionFileContentArguments(
  revision: string,
  path: string
): string[] {
  return ["show", `${revision}:${path}`];
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
  commitHash: string,
  firstParentHash?: string
): string[] {
  return [
    "diff-tree",
    "--root",
    "--no-commit-id",
    "--no-renames",
    "--numstat",
    "-r",
    "-z",
    ...(firstParentHash ? [firstParentHash] : []),
    commitHash
  ];
}

export function commitDiffArguments(
  commitHash: string,
  firstParentHash: string | undefined,
  path: string,
  contextLines: number
): string[] {
  const options = [
    "--literal-pathspecs",
    firstParentHash ? "diff" : "diff-tree",
    ...(firstParentHash
      ? []
      : ["--root", "--no-commit-id", "-p", "-r"]),
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    `--unified=${contextLines}`
  ];

  return [
    ...options,
    ...(firstParentHash
      ? [firstParentHash, commitHash]
      : [commitHash]),
    "--",
    path
  ];
}

export function commitParentsArguments(
  commitHash: string
): string[] {
  return [
    "rev-list",
    "--parents",
    "--max-count=1",
    "--end-of-options",
    commitHash
  ];
}

export function stashListArguments(limit: number): string[] {
  return [
    "stash",
    "list",
    `--max-count=${limit}`,
    "--format=%gd%x00%H%x00%an%x00%ae%x00%aI%x00%s%x00%P%x00%x00"
  ];
}

export function stashFilesArguments(stashRef: string): string[] {
  return [
    "--literal-pathspecs",
    "stash",
    "show",
    "--include-untracked",
    "--numstat",
    "--format=",
    "-z",
    stashRef
  ];
}

export function stashDiffArguments(
  stashRef: string,
  path: string,
  contextLines: number
): string[] {
  return [
    "--literal-pathspecs",
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    `--unified=${contextLines}`,
    `${stashRef}^1`,
    stashRef,
    "--",
    path
  ];
}

export function stashUntrackedDiffArguments(
  stashCommit: string,
  path: string,
  contextLines: number
): string[] {
  return [
    "--literal-pathspecs",
    "diff-tree",
    "--root",
    "--no-commit-id",
    "-p",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    `--unified=${contextLines}`,
    `${stashCommit}^3`,
    "--",
    path
  ];
}

export function resolveStashArguments(stashRef: string): string[] {
  return [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${stashRef}^{commit}`
  ];
}
