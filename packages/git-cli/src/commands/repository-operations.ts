export const READ_REMOTES_ARGUMENTS = ["remote"] as const;

export function readRemoteUrlArguments(
  remote: string
): string[] {
  return ["remote", "get-url", "--", remote];
}

export function readRemoteBranchesArguments(
  remote: string
): string[] {
  return [
    "ls-remote",
    "--heads",
    "--",
    remote
  ];
}

export function checkBranchNameArguments(
  branch: string
): string[] {
  return [
    "check-ref-format",
    "--branch",
    branch
  ];
}

export function resolveRevisionArguments(
  revision: string
): string[] {
  return [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${revision}^{commit}`
  ];
}

export function fetchRemoteArguments(
  remote: string,
  prune: boolean
): string[] {
  return [
    "fetch",
    ...(prune ? ["--prune"] : []),
    "--",
    remote
  ];
}

export function pullFastForwardArguments(
  remote: string,
  remoteBranch: string
): string[] {
  return [
    "pull",
    "--ff-only",
    "--no-rebase",
    "--",
    remote,
    `refs/heads/${remoteBranch}`
  ];
}

export function pushBranchArguments(input: {
  remote: string;
  localBranch: string;
  remoteBranch: string;
  setUpstream: boolean;
  forceWithLeaseExpected?: string;
}): string[] {
  return [
    "push",
    ...(input.setUpstream ? ["--set-upstream"] : []),
    ...(input.forceWithLeaseExpected
      ? [
          `--force-with-lease=refs/heads/${input.remoteBranch}:${input.forceWithLeaseExpected}`
        ]
      : []),
    "--",
    input.remote,
    `refs/heads/${input.localBranch}:refs/heads/${input.remoteBranch}`
  ];
}

export function createBranchArguments(
  branch: string,
  startPoint: string
): string[] {
  return [
    "branch",
    "--",
    branch,
    startPoint
  ];
}

export function switchBranchArguments(
  branch: string
): string[] {
  return [
    "switch",
    "--no-guess",
    "--",
    branch
  ];
}

export function renameBranchArguments(
  branch: string,
  newName: string
): string[] {
  return [
    "branch",
    "--move",
    branch,
    newName
  ];
}

export function deleteBranchArguments(
  branch: string
): string[] {
  return [
    "branch",
    "--delete",
    "--",
    branch
  ];
}
