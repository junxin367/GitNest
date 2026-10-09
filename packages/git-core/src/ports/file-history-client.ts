import type { GitReadOptions } from "./git-client";

export interface FileHistoryEntry {
  hash: string;
  authorName: string;
  authoredAt: string;
  subject: string;
  path: string;
  previousPath?: string;
  status: string;
}
export interface FileHistoryResult {
  revision: string | null;
  path: string;
  entries: FileHistoryEntry[];
  nextOffset: number | null;
  status: "ok" | "empty" | "too-large";
  message?: string;
}
export interface FileHistoryDiffResult {
  commitHash: string;
  path: string;
  patch: string;
  status: "ok" | "empty" | "too-large";
  message?: string;
}
export interface FileHistoryQuery {
  path: string;
  originalPath?: string;
  revision?: string;
  offset?: number;
  limit?: number;
}
export interface FileHistoryClient {
  history(repositoryPath: string, query: FileHistoryQuery, options?: GitReadOptions): Promise<FileHistoryResult>;
  diff(repositoryPath: string, query: { path: string; previousPath?: string; commitHash: string }, options?: GitReadOptions): Promise<FileHistoryDiffResult>;
}
