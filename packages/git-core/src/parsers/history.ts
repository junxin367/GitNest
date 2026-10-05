import type { CommitSummary } from "../domain/repository";
import type {
  CommitHistoryComparisonSide,
  CommitHistoryEntry
} from "../domain/repository-queries";
import { GitError } from "../errors/git-errors";

const FIELD_SEPARATOR = "\0";
const COMMIT_FIELD_COUNT = 8;
const COMPARED_COMMIT_FIELD_COUNT = 9;

export function parseCommitHistory(output: string): CommitSummary[] {
  return parseRecords(output, COMMIT_FIELD_COUNT).map((fields) =>
    parseCommitFields(fields)
  );
}

export function parseComparedCommitHistory(
  output: string
): CommitHistoryEntry[] {
  return parseRecords(
    output,
    COMPARED_COMMIT_FIELD_COUNT
  ).map((fields) => {
    const [marker = "", ...commitFields] = fields;
    return {
      ...parseCommitFields(commitFields),
      comparisonSide: comparisonSide(marker)
    };
  });
}

function parseRecords(
  output: string,
  fieldCount: number
): string[][] {
  const fields = output.split(FIELD_SEPARATOR);
  const records: string[][] = [];

  for (let index = 0; index < fields.length; index += fieldCount) {
    const record = fields.slice(index, index + fieldCount);
    const firstField = record[0]?.replace(/^[\r\n]+/, "") ?? "";

    if (
      record.length === 1 &&
      !firstField &&
      /^[\r\n]*$/.test(record[0] ?? "")
    ) {
      break;
    }
    if (record.length !== fieldCount || !firstField) {
      throw new GitError(
        "INVALID_GIT_OUTPUT",
        "A commit record does not contain all required fields."
      );
    }

    record[0] = firstField;
    records.push(record);
  }

  return records;
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
      .split(", ")
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
