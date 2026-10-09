import type { RepositoryTargetDto } from "./workspace.contracts";

export interface FileHistoryRequest {
  queryId: string;
  target: RepositoryTargetDto;
  path: string;
  /** Original tracked path for a pending rename. */
  originalPath?: string;
  /** Omit on first page; use the returned full revision for subsequent pages. */
  revision?: string;
  offset?: number;
  limit?: number;
}
export interface FileHistoryEntryDto {
  hash: string;
  authorName: string;
  authoredAt: string;
  subject: string;
  path: string;
  previousPath?: string;
  status: string;
}
export interface FileHistoryResultDto {
  revision: string | null;
  path: string;
  entries: FileHistoryEntryDto[];
  nextOffset: number | null;
  status: "ok" | "empty" | "too-large";
  message?: string;
}
export interface FileHistoryDiffRequest {
  queryId: string;
  target: RepositoryTargetDto;
  path: string;
  previousPath?: string;
  commitHash: string;
}
export interface FileHistoryDiffResultDto {
  commitHash: string;
  path: string;
  patch: string;
  status: "ok" | "empty" | "too-large";
  message?: string;
}
export interface FileHistoryCancelRequest { queryId: string }

export interface FileHistoryBridge {
  history(request: FileHistoryRequest): Promise<import("./git.contracts").GitReadResult<FileHistoryResultDto>>;
  diff(request: FileHistoryDiffRequest): Promise<import("./git.contracts").GitReadResult<FileHistoryDiffResultDto>>;
  cancel(request: FileHistoryCancelRequest): Promise<import("./git.contracts").GitReadResult<boolean>>;
}
