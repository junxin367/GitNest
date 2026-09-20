import {
  type WorkspaceOperation,
  type WorkspaceOperationStore
} from "@gitnest/application";
import { WorkspaceError } from "@gitnest/workspace-core";

import { AtomicJsonStore } from "./atomic-json-store";

export const WORKSPACE_OPERATION_SCHEMA_VERSION = 1;
const MAX_WORKSPACE_OPERATION_DOCUMENT_BYTES =
  16 * 1_024 * 1_024;

interface WorkspaceOperationDocument {
  schemaVersion: typeof WORKSPACE_OPERATION_SCHEMA_VERSION;
  workspaceId: string;
  operations: WorkspaceOperation[];
  updatedAt: string;
}

const OPERATION_KINDS = new Set<
  WorkspaceOperation["kind"]
>([
  "scan",
  "status",
  "stage",
  "unstage",
  "discard",
  "commit",
  "stash-apply",
  "stash-drop",
  "stash-pop",
  "fetch",
  "pull",
  "push",
  "switch-branch",
  "create-branch",
  "rename-branch",
  "delete-branch",
  "worktree-create",
  "worktree-lock",
  "worktree-unlock",
  "worktree-move",
  "worktree-repair",
  "worktree-prune",
  "worktree-remove"
]);
const OPERATION_STATES = new Set<
  WorkspaceOperation["state"]
>([
  "queued",
  "running",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted"
]);
const OPERATION_SCOPES = new Set<
  WorkspaceOperation["scope"]
>(["workspace", "repository", "worktree"]);

export class JsonWorkspaceOperationStore
  implements WorkspaceOperationStore
{
  readonly #store: AtomicJsonStore;
  readonly #clock: () => string;

  constructor(
    filePath: string,
    clock: () => string = () => new Date().toISOString()
  ) {
    this.#store = new AtomicJsonStore(filePath, {
      maxBytes: MAX_WORKSPACE_OPERATION_DOCUMENT_BYTES
    });
    this.#clock = clock;
  }

  async load(workspaceId: string): Promise<WorkspaceOperation[]> {
    const value = await this.#store.read();
    if (value === null) {
      return [];
    }
    const migrated = migrateOperationDocument(value);
    if (
      !isOperationDocument(migrated) ||
      migrated.workspaceId !== workspaceId
    ) {
      this.#store.blockWrites(
        "Workspace operation schema validation or migration failed."
      );
      throw invalidDocument();
    }
    const operations = migrated.operations.map(
      rebuildOperation
    );
    if (
      readSchemaVersion(value) !== migrated.schemaVersion
    ) {
      await this.#store.write({
        schemaVersion: WORKSPACE_OPERATION_SCHEMA_VERSION,
        workspaceId: migrated.workspaceId,
        operations,
        updatedAt: migrated.updatedAt
      });
    }
    return operations;
  }

  save(
    workspaceId: string,
    operations: WorkspaceOperation[]
  ): Promise<void> {
    const document: WorkspaceOperationDocument = {
      schemaVersion: WORKSPACE_OPERATION_SCHEMA_VERSION,
      workspaceId,
      operations: operations.map(rebuildOperation),
      updatedAt: this.#clock()
    };
    return this.#store.write(document);
  }
}

function migrateOperationDocument(
  value: unknown
): unknown {
  if (!isRecord(value) || value.schemaVersion !== 0) {
    return value;
  }
  if (!Array.isArray(value.operations)) {
    return value;
  }
  return {
    ...value,
    schemaVersion: WORKSPACE_OPERATION_SCHEMA_VERSION,
    operations: value.operations.map((operation) =>
      isRecord(operation)
        ? {
            ...operation,
            scope:
              typeof operation.scope === "string"
                ? operation.scope
                : "workspace",
            targetIds: Array.isArray(operation.targetIds)
              ? operation.targetIds
              : [],
            progress:
              typeof operation.progress === "number"
                ? operation.progress
                : 0,
            succeeded:
              typeof operation.succeeded === "number"
                ? operation.succeeded
                : 0,
            failed:
              typeof operation.failed === "number"
                ? operation.failed
                : 0
          }
        : operation
    )
  };
}

function isOperationDocument(
  value: unknown
): value is WorkspaceOperationDocument {
  return (
    isRecord(value) &&
    value.schemaVersion ===
      WORKSPACE_OPERATION_SCHEMA_VERSION &&
    typeof value.workspaceId === "string" &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.operations) &&
    value.operations.every(isOperation)
  );
}

function isOperation(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    OPERATION_KINDS.has(
      value.kind as WorkspaceOperation["kind"]
    ) &&
    typeof value.scope === "string" &&
    OPERATION_SCOPES.has(
      value.scope as WorkspaceOperation["scope"]
    ) &&
    Array.isArray(value.targetIds) &&
    value.targetIds.every(
      (targetId) => typeof targetId === "string"
    ) &&
    typeof value.state === "string" &&
    OPERATION_STATES.has(
      value.state as WorkspaceOperation["state"]
    ) &&
    typeof value.progress === "number" &&
    Number.isFinite(value.progress) &&
    value.progress >= 0 &&
    value.progress <= 1 &&
    isNonNegativeInteger(value.succeeded) &&
    isNonNegativeInteger(value.failed) &&
    typeof value.message === "string" &&
    (value.startedAt === undefined ||
      typeof value.startedAt === "string") &&
    (value.finishedAt === undefined ||
      typeof value.finishedAt === "string")
  );
}

function rebuildOperation(
  operation: WorkspaceOperation
): WorkspaceOperation {
  return {
    id: operation.id,
    kind: operation.kind,
    scope: operation.scope,
    targetIds: [...operation.targetIds],
    state: operation.state,
    progress: operation.progress,
    succeeded: operation.succeeded,
    failed: operation.failed,
    message: operation.message,
    ...(operation.startedAt
      ? { startedAt: operation.startedAt }
      : {}),
    ...(operation.finishedAt
      ? { finishedAt: operation.finishedAt }
      : {})
  };
}

function isNonNegativeInteger(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
  );
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readSchemaVersion(value: unknown): unknown {
  return isRecord(value) ? value.schemaVersion : undefined;
}

function invalidDocument(): WorkspaceError {
  return new WorkspaceError(
    "INVALID_PERSISTED_DATA",
    "The persisted Workspace operation document is invalid."
  );
}
