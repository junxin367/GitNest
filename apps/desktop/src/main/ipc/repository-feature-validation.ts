import { GitError } from "@gitnest/git-core";
import type {
  RepositoryCreationRequest,
  RepositoryManagementCommandDto,
  RepositoryTargetDto,
  RepositoryWorkflowCommandDto
} from "@gitnest/contracts";

function invalid(): never {
  throw new GitError("INVALID_REQUEST", "The repository operation request is invalid.");
}

export function featureRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

export function featureString(value: unknown, limit = 4096): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit || value.includes("\0")) invalid();
  return value;
}

export function featureBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}

export function featureTarget(value: unknown): RepositoryTargetDto {
  const target = featureRecord(value);
  const repositoryId = featureString(target.repositoryId, 200);
  const worktreeId = featureString(target.worktreeId, 200);
  if (/[\r\n]/.test(repositoryId + worktreeId)) invalid();
  return { repositoryId, worktreeId };
}

function paths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) invalid();
  return [...new Set(value.map((item) => {
    const path = featureString(item);
    if (/^(?:[a-z]:|[\\/])/i.test(path) || /[\r\n]/.test(path) ||
        path.split(/[\\/]/).some((part) => part === ".." || part === ".git")) invalid();
    return path;
  }))];
}

export function featureHash(value: unknown): string {
  const hash = featureString(value, 64);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(hash)) invalid();
  return hash;
}

export function validateWorkflowCommand(value: unknown): RepositoryWorkflowCommandDto {
  const request = featureRecord(value);
  const target = featureTarget(request.target);
  switch (request.type) {
    case "create-stash":
      return {
        target, type: request.type,
        ...(request.message === undefined || request.message === "" ? {} : { message: featureString(request.message, 2000) }),
        ...(request.includeUntracked === undefined ? {} : { includeUntracked: featureBoolean(request.includeUntracked) }),
        ...(request.paths === undefined ? {} : { paths: paths(request.paths) })
      };
    case "amend":
      return { target, type: request.type, message: featureString(request.message, 100000) };
    case "undo-commit":
      if (request.mode !== "soft" && request.mode !== "mixed") invalid();
      return { target, type: request.type, mode: request.mode };
    case "cherry-pick":
    case "revert":
      return { target, type: request.type, commitHash: featureHash(request.commitHash) };
    case "mark-resolved":
      return { target, type: request.type, paths: paths(request.paths) };
    case "continue":
    case "skip":
    case "keep-empty":
    case "abort":
      return { target, type: request.type };
    default: return invalid();
  }
}

export function validateManagementCommand(value: unknown): RepositoryManagementCommandDto {
  const request = featureRecord(value);
  const target = featureTarget(request.target);
  const action = featureRecord(request.action);
  const name = featureString(action.name, 255);
  switch (action.type) {
    case "remote-add":
    case "remote-set-url":
      return { target, action: { type: action.type, name, url: featureString(action.url) } };
    case "remote-remove":
    case "tag-delete":
      return { target, action: { type: action.type, name } };
    case "tag-create":
      return { target, action: { type: action.type, name, revision: featureString(action.revision, 255),
        ...(action.message === undefined || action.message === "" ? {} : { message: featureString(action.message, 10000) }) } };
    case "tag-push":
      return { target, action: { type: action.type, name, remote: featureString(action.remote, 255) } };
    default: return invalid();
  }
}

export function validateRepositoryCreation(value: unknown): RepositoryCreationRequest {
  const request = featureRecord(value);
  if (request.kind !== "clone" && request.kind !== "init") invalid();
  return {
    kind: request.kind,
    destination: featureString(request.destination),
    ...(request.kind === "clone" ? { url: featureString(request.url) } : {}),
    ...(request.initialBranch === undefined || request.initialBranch === "" ? {} : { initialBranch: featureString(request.initialBranch, 255) })
  };
}
