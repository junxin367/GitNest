export type WorkspaceErrorCode =
  | "INVALID_REQUEST"
  | "DIRECTORY_UNAVAILABLE"
  | "NO_REPOSITORIES_FOUND"
  | "ENTRY_NOT_FOUND"
  | "GROUP_NOT_FOUND"
  | "SCAN_CANCELLED"
  | "SCAN_FAILED"
  | "PERSISTENCE_FAILED"
  | "INVALID_PERSISTED_DATA";

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;
  readonly details: Readonly<
    Record<string, string | number | boolean>
  >;

  constructor(
    code: WorkspaceErrorCode,
    message: string,
    details: Readonly<
      Record<string, string | number | boolean>
    > = {}
  ) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
    this.details = details;
  }
}
