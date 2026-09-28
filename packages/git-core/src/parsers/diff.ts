import type {
  RepositoryDiff,
  RepositoryDiffMode
} from "../domain/repository-queries";

export function parseRepositoryDiff(
  path: string,
  mode: RepositoryDiffMode,
  output: string,
  truncated = false
): RepositoryDiff {
  let additions = 0;
  let deletions = 0;

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
    } else if (
      line.startsWith("-") &&
      !line.startsWith("---")
    ) {
      deletions += 1;
    }
  }

  return {
    path,
    mode,
    content: output,
    binary:
      /^Binary files .* differ$/m.test(output) ||
      /^GIT binary patch$/m.test(output),
    truncated,
    additions,
    deletions
  };
}
