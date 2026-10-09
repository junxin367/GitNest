import { GitError } from "../errors/git-errors";

/** Dates are inclusive local calendar days, applied to Git committer dates. */
export interface CommitHistoryFilter {
  keyword?: string;
  author?: string;
  since?: string;
  until?: string;
  path?: string;
}

export function normalizeCommitHistorySearch(
  value: unknown
): CommitHistoryFilter | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GitError("INVALID_REQUEST", "History search must be an object.");
  }
  const result: CommitHistoryFilter = {};
  for (const key of ["keyword", "author", "since", "until", "path"] as const) {
    if (!(key in value)) continue;
    const raw = (value as Record<string, unknown>)[key];
    if (raw === undefined) continue;
    if (typeof raw !== "string" || /[\x00-\x1f\x7f]/.test(raw) || raw.length > 4096) {
      throw new GitError("INVALID_REQUEST", `Invalid history search ${key}.`);
    }
    const text = key === "path" ? raw : raw.trim();
    if (!text) continue;
    if (key === "since" || key === "until") {
      const date = new Date(`${text}T00:00:00Z`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== text
      ) {
        throw new GitError("INVALID_REQUEST", "History dates must be valid YYYY-MM-DD dates.");
      }
    }
    if (key === "path" && (
      /^[\\/]/.test(text) ||
      /^[a-z]:/i.test(text) ||
      text.split(/[\\/]/).includes("..")
    )) {
      throw new GitError("INVALID_REQUEST", "History paths must be relative to the repository.");
    }
    result[key] = text;
  }
  if (result.since && result.until && result.since > result.until) {
    throw new GitError("INVALID_REQUEST", "History start date must not follow the end date.");
  }
  return Object.keys(result).length ? result : undefined;
}
