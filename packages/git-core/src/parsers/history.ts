import type { CommitSummary } from "../domain/repository";
import type {
  CommitHistoryComparisonSide,
  CommitHistoryEntry
} from "../domain/repository-queries";
import { GitError } from "../errors/git-errors";

const RECORD_SEPARATOR = "\x1e";
const FIELD_SEPARATOR = "\x1f";

export function parseCommitHistory(output: string): CommitSummary[] {
  return parseRecords(output).map((fields) =>
    parseCommitFields(fields)
  );
}

export function parseComparedCommitHistory(
  output: string
): CommitHistoryEntry[] {
  return parseRecords(output).map((fields) => {
    const [marker = "", ...commitFields] = fields;
    return {
      ...parseCommitFields(commitFields),
      comparisonSide: comparisonSide(marker)
    };
  });
}

function parseRecords(output: string): string[][] {
  return output
    .split(RECORD_SEPARATOR)
    .map((record) =>
      record.replace(/^[\r\n]+|[\r\n]+$/g, "")
    )
    .filter(Boolean)
    .map((record) => record.split(FIELD_SEPARATOR));
}

function parseCommitFields(fields: string[]): CommitSummary {
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
}

function comparisonSide(
  marker: string
): CommitHistoryComparisonSide {
  if (marker === "<") {
    return "left";
  }
  if (marker === ">") {
    return "right";
  }
  if (marker === "-") {
    return "base";
  }
  throw new GitError(
    "INVALID_GIT_OUTPUT",
    `Unsupported history comparison marker: ${marker || "(empty)"}`
  );
}
