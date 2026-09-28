import { GitError } from "../errors/git-errors";

export function parseGitVersion(output: string): string {
  const match = /^git version (.+)$/m.exec(output.trim());

  if (!match?.[1]) {
    throw new GitError(
      "INVALID_GIT_OUTPUT",
      "Git returned an unrecognized version string."
    );
  }

  return match[1];
}

export function parseGitLfsVersion(output: string): string | undefined {
  const match = /^git-lfs\/([^\s]+)/m.exec(output.trim());
  return match?.[1];
}
