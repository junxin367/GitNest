import type {
  CommitDetails,
  CommitFileStat
} from "../domain/repository-queries";
import { GitError } from "../errors/git-errors";

type CommitMetadata = Omit<
  CommitDetails,
  "files" | "additions" | "deletions"
>;

export function parseCommitMetadata(output: string): CommitMetadata {
  const fields = output.split("\0");

  if (fields.length < 11) {
    throw new GitError(
      "INVALID_GIT_OUTPUT",
      "Commit metadata is missing required fields."
    );
  }

  const [
    hash = "",
    shortHash = "",
    authorName = "",
    authorEmail = "",
    authoredAt = "",
    committerName = "",
    committerEmail = "",
    committedAt = "",
    parents = "",
    decorations = "",
    ...bodyParts
  ] = fields;

  return {
    hash,
    shortHash,
    authorName,
    authorEmail,
    authoredAt,
    committerName,
    committerEmail,
    committedAt,
    subject: firstLine(bodyParts.join("\0")),
    body: bodyParts.join("\0").replace(/[\r\n]+$/, ""),
    parentHashes: parents ? parents.split(" ") : [],
    refs: decorations
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  };
}

export function parseCommitNumstat(output: string): {
  files: CommitFileStat[];
  additions: number;
  deletions: number;
} {
  const files: CommitFileStat[] = [];
  let additions = 0;
  let deletions = 0;

  for (const record of output.split("\0").filter(Boolean)) {
    const firstTab = record.indexOf("\t");
    const secondTab =
      firstTab < 0 ? -1 : record.indexOf("\t", firstTab + 1);

    if (firstTab < 0 || secondTab < 0) {
      throw new GitError(
        "INVALID_GIT_OUTPUT",
        "Commit numstat contains a malformed record."
      );
    }

    const additionsValue = record.slice(0, firstTab);
    const deletionsValue = record.slice(
      firstTab + 1,
      secondTab
    );
    const path = record.slice(secondTab + 1);
    const binary =
      additionsValue === "-" || deletionsValue === "-";
    const fileAdditions = binary
      ? undefined
      : Number.parseInt(additionsValue, 10);
    const fileDeletions = binary
      ? undefined
      : Number.parseInt(deletionsValue, 10);

    if (
      !path ||
      (!binary &&
        (!Number.isFinite(fileAdditions) ||
          !Number.isFinite(fileDeletions)))
    ) {
      throw new GitError(
        "INVALID_GIT_OUTPUT",
        "Commit numstat contains invalid values."
      );
    }

    files.push({
      path,
      ...(fileAdditions === undefined
        ? {}
        : { additions: fileAdditions }),
      ...(fileDeletions === undefined
        ? {}
        : { deletions: fileDeletions }),
      binary
    });
    additions += fileAdditions ?? 0;
    deletions += fileDeletions ?? 0;
  }

  return { files, additions, deletions };
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0] ?? "";
}
