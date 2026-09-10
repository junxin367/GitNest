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
