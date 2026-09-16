import type { StashSummary } from "../domain/repository-queries";
import { GitError } from "../errors/git-errors";

type StashMetadata = Omit<
  StashSummary,
  "files" | "additions" | "deletions"
>;

export function parseStashList(output: string): StashMetadata[] {
  return output
    .split("\0\0")
    .map((record) => record.replace(/^[\r\n]+/, ""))
    .filter(Boolean)
    .map((record) => {
      const fields = record.split("\0");
      if (fields.length !== 7) {
        throw new GitError(
          "INVALID_GIT_OUTPUT",
          "Stash metadata contains a malformed record."
        );
      }

      const [
        ref = "",
        hash = "",
        authorName = "",
        authorEmail = "",
        authoredAt = "",
        subject = "",
        parents = ""
      ] = fields;
      const parentHashes = parents
        .trim()
        .split(/\s+/)
        .filter(Boolean);

      if (
        !/^stash@\{\d+\}$/.test(ref) ||
        !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(hash)
      ) {
        throw new GitError(
          "INVALID_GIT_OUTPUT",
          "Stash metadata contains an invalid reference or object id."
        );
      }

      return {
        ref,
        hash,
        authorName,
        authorEmail,
        authoredAt,
        subject,
        parentHashes,
        ...(parentHashes[0]
          ? { baseHash: parentHashes[0] }
          : {})
      };
    });
}
