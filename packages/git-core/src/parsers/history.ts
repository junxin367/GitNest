import type { CommitSummary } from "../domain/repository";
import { GitError } from "../errors/git-errors";

const FIELD_SEPARATOR = "\0";
const COMMIT_FIELD_COUNT = 8;

export function parseCommitHistory(output: string): CommitSummary[] {
  return parseRecords(output, COMMIT_FIELD_COUNT).map((fields) =>
    parseCommitFields(fields)
  );
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
