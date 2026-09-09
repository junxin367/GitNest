import type { CommitSummary } from "../domain/repository";
import { GitError } from "../errors/git-errors";

const RECORD_SEPARATOR = "\x1e";
const FIELD_SEPARATOR = "\x1f";

export function parseCommitHistory(output: string): CommitSummary[] {
  return output
    .split(RECORD_SEPARATOR)
    .map((record) => record.replace(/^[\r\n]+|[\r\n]+$/g, ""))
    .filter(Boolean)
    .map((record) => {
      const fields = record.split(FIELD_SEPARATOR);

      if (fields.length < 7) {
        throw new GitError(
          "INVALID_GIT_OUTPUT",
          "A commit record does not contain all required fields."
        );
      }

      const [
        hash = "",
        shortHash = "",
        authorName = "",
        authorEmail = "",
        authoredAt = "",
        subject = "",
        parents = "",
        decorations = ""
      ] = fields;

      return {
        hash,
        shortHash,
        authorName,
        authorEmail,
        authoredAt,
        subject,
        parentHashes: parents ? parents.split(" ") : [],
        refs: decorations
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      };
    });
}
