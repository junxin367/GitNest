export type GitErrorCode =
  | "GIT_NOT_FOUND"
  | "GIT_VERSION_UNSUPPORTED"
  | "NOT_A_REPOSITORY"
  | "DIRECTORY_UNAVAILABLE"
  | "COMMAND_CANCELLED"
  | "COMMAND_TIMEOUT"
  | "COMMAND_FAILED"
  | "OUTPUT_LIMIT_EXCEEDED"
  | "INVALID_GIT_OUTPUT"
  | "INVALID_REQUEST"
  | "PREFLIGHT_EXPIRED"
  | "PREFLIGHT_CHANGED"
  | "CONFIRMATION_REQUIRED"
  | "NON_FAST_FORWARD"
  | "AUTHENTICATION_FAILED";

export class GitError extends Error {
  readonly code: GitErrorCode;
  readonly details: Readonly<Record<string, string | number | boolean>>;

  constructor(
    code: GitErrorCode,
    message: string,
    details: Readonly<Record<string, string | number | boolean>> = {}
  ) {
    super(message);
    this.name = "GitError";
    this.code = code;
    this.details = details;
  }
}

/** Preserve the original failure while recording successful earlier batches. */
export function withCompletedMutationPaths(error: unknown, completedPathCount: number): unknown {
  if (completedPathCount <= 0) return error;
  const failure = error instanceof GitError
    ? error
    : new GitError("COMMAND_FAILED", error instanceof Error ? error.message : "Git 操作未完成。");
  const previous = failure.details.completedPathCount;
  return new GitError(failure.code, failure.message, {
    ...failure.details,
    completedPathCount: completedPathCount +
      (typeof previous === "number" && Number.isSafeInteger(previous) && previous > 0 ? previous : 0)
  });
}
