import { GitError } from "@gitnest/git-core";
import type {
  FileHistoryCancelRequest,
  FileHistoryDiffRequest,
  FileHistoryRequest,
  RepositoryIgnoreExecuteRequest,
  RepositoryIgnorePreflightRequest
} from "@gitnest/contracts";
import { featureBoolean, featureHash, featureRecord, featureString, featureTarget } from "./repository-feature-validation";

function invalid(): never {
  throw new GitError("INVALID_REQUEST", "文件操作参数无效。");
}

function filePath(value: unknown): string {
  const path = featureString(value);
  if (/[\x00-\x1f\\]/.test(path) || path.startsWith("/") || /^[a-z]:/i.test(path) ||
      path.split("/").some(part => !part || part === "." || part === ".." || /^\.git$/i.test(part))) invalid();
  return path;
}

function queryId(value: unknown): string {
  const id = featureString(value, 160);
  if (!/^[a-zA-Z0-9._:-]+$/.test(id)) invalid();
  return id;
}

function boundedInteger(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}

export function validateIgnorePreflight(value: unknown): RepositoryIgnorePreflightRequest {
  const request = featureRecord(value);
  if (request.scope !== "file" && request.scope !== "directory" && request.scope !== "extension") invalid();
  return { target: featureTarget(request.target), path: filePath(request.path), scope: request.scope };
}

export function validateIgnoreExecute(value: unknown): RepositoryIgnoreExecuteRequest {
  const request = featureRecord(value);
  return { preflightId: featureString(request.preflightId, 200), confirmed: featureBoolean(request.confirmed) };
}

export function validateFileHistory(value: unknown): FileHistoryRequest {
  const request = featureRecord(value);
  const offset = request.offset === undefined ? undefined : boundedInteger(request.offset, 0, 100_000);
  if (offset && request.revision === undefined) invalid();
  return {
    queryId: queryId(request.queryId), target: featureTarget(request.target), path: filePath(request.path),
    ...(request.originalPath === undefined ? {} : { originalPath: filePath(request.originalPath) }),
    ...(request.revision === undefined ? {} : { revision: featureHash(request.revision) }),
    ...(offset === undefined ? {} : { offset }),
    ...(request.limit === undefined ? {} : { limit: boundedInteger(request.limit, 1, 100) })
  };
}

export function validateFileHistoryDiff(value: unknown): FileHistoryDiffRequest {
  const request = featureRecord(value);
  return {
    queryId: queryId(request.queryId), target: featureTarget(request.target),
    path: filePath(request.path), commitHash: featureHash(request.commitHash),
    ...(request.previousPath === undefined ? {} : { previousPath: filePath(request.previousPath) })
  };
}

export function validateFileHistoryCancel(value: unknown): FileHistoryCancelRequest {
  return { queryId: queryId(featureRecord(value).queryId) };
}
