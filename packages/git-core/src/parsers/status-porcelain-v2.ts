import type {
  ChangedPath,
  RepositorySnapshot
} from "../domain/repository";
import { GitError } from "../errors/git-errors";

interface ParsedPrefix {
  fields: string[];
  remainder: string;
}

export function parseStatusPorcelainV2(
  output: string,
  refreshedAt = new Date().toISOString()
): RepositorySnapshot {
  const records = output.includes("\0")
    ? output.split("\0")
    : output.split(/\r?\n/);
  const changes: ChangedPath[] = [];
  let branch: string | undefined;
  let head = "";
  let upstream: string | undefined;
  let ahead = 0;
  let behind = 0;
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let conflicted = 0;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];

    if (!record) {
      continue;
    }

    if (record.startsWith("# ")) {
      const header = record.slice(2);

      if (header.startsWith("branch.oid ")) {
        const oid = header.slice("branch.oid ".length);
        head = oid === "(initial)" ? "" : oid;
      } else if (header.startsWith("branch.head ")) {
        const value = header.slice("branch.head ".length);
        branch = value === "(detached)" ? undefined : value;
      } else if (header.startsWith("branch.upstream ")) {
        upstream = header.slice("branch.upstream ".length);
      } else if (header.startsWith("branch.ab ")) {
        const match = /^branch\.ab \+(\d+) -(\d+)$/.exec(header);

        if (match) {
          ahead = Number.parseInt(match[1] ?? "0", 10);
          behind = Number.parseInt(match[2] ?? "0", 10);
        }
      }

      continue;
    }

    if (record.startsWith("1 ")) {
      const { fields, remainder } = parsePrefix(record, 8);
      const [indexStatus = ".", worktreeStatus = "."] =
        fields[1] ?? "..";

      changes.push({
        path: remainder,
        indexStatus,
        worktreeStatus,
        kind: "ordinary"
      });
      staged += Number(indexStatus !== ".");
      unstaged += Number(worktreeStatus !== ".");
      continue;
    }

    if (record.startsWith("2 ")) {
      const { fields, remainder } = parsePrefix(record, 9);
      const originalPath = records[index + 1];

      if (originalPath === undefined || originalPath === "") {
        throw new GitError(
          "INVALID_GIT_OUTPUT",
          "A renamed status entry is missing its original path."
        );
      }

      index += 1;
      const [indexStatus = ".", worktreeStatus = "."] =
        fields[1] ?? "..";

      changes.push({
        path: remainder,
        originalPath,
        indexStatus,
        worktreeStatus,
        kind: "renamed"
      });
      staged += Number(indexStatus !== ".");
      unstaged += Number(worktreeStatus !== ".");
      continue;
    }

    if (record.startsWith("u ")) {
      const { fields, remainder } = parsePrefix(record, 10);
      const [indexStatus = "U", worktreeStatus = "U"] =
        fields[1] ?? "UU";

      changes.push({
        path: remainder,
        indexStatus,
        worktreeStatus,
        kind: "unmerged"
      });
      conflicted += 1;
      continue;
    }

    if (record.startsWith("? ")) {
      changes.push({
        path: record.slice(2),
        indexStatus: "?",
        worktreeStatus: "?",
        kind: "untracked"
      });
      untracked += 1;
    }
  }

  return {
    ...(branch ? { branch } : {}),
    head,
    ...(upstream ? { upstream } : {}),
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
    conflicted,
    changes,
    refreshedAt
  };
}

function parsePrefix(record: string, fieldCount: number): ParsedPrefix {
  const fields: string[] = [];
  let cursor = 0;

  for (let index = 0; index < fieldCount; index += 1) {
    const separator = record.indexOf(" ", cursor);

    if (separator < 0) {
      throw new GitError(
        "INVALID_GIT_OUTPUT",
        `Malformed status record: ${record.slice(0, 64)}`
      );
    }

    fields.push(record.slice(cursor, separator));
    cursor = separator + 1;
  }

  const remainder = record.slice(cursor);

  if (!remainder) {
    throw new GitError(
      "INVALID_GIT_OUTPUT",
      "A status entry is missing its path."
    );
  }

  return { fields, remainder };
}
