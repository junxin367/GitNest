import {
  WorkspaceError,
  type RepositorySnapshotStore,
  type RepositoryStatusSnapshot
} from "@gitnest/workspace-core";

import { AtomicJsonStore } from "./atomic-json-store";

const MAX_REPOSITORY_SNAPSHOT_DOCUMENT_BYTES =
  128 * 1_024 * 1_024;
const REPOSITORY_SNAPSHOT_SCHEMA_VERSION = 1;

interface RepositorySnapshotDocument {
  schemaVersion: 1;
  workspaceId: string;
  snapshots: RepositoryStatusSnapshot[];
  updatedAt: string;
}

export class JsonRepositorySnapshotStore
  implements RepositorySnapshotStore
{
  readonly #store: AtomicJsonStore;
  readonly #clock: () => string;

  constructor(
    filePath: string,
    clock: () => string = () => new Date().toISOString()
  ) {
    this.#store = new AtomicJsonStore(filePath, {
      maxBytes: MAX_REPOSITORY_SNAPSHOT_DOCUMENT_BYTES
    });
    this.#clock = clock;
  }

  async load(
    workspaceId: string
  ): Promise<RepositoryStatusSnapshot[]> {
    const value = await this.#store.read();

    if (value === null) {
      return [];
    }

    const migrated = migrateSnapshotDocument(value);
    if (!isSnapshotDocument(migrated, workspaceId)) {
      this.#store.blockWrites(
        "Repository snapshot schema validation or migration failed."
      );
      throw new WorkspaceError(
        "INVALID_PERSISTED_DATA",
        "The persisted repository snapshot cache is invalid."
      );
    }

    const snapshots = migrated.snapshots.map(rebuildSnapshot);
    if (readSchemaVersion(value) !== migrated.schemaVersion) {
      await this.#store.write({
        schemaVersion: REPOSITORY_SNAPSHOT_SCHEMA_VERSION,
        workspaceId: migrated.workspaceId,
        snapshots,
        updatedAt: migrated.updatedAt
      });
    }
    return snapshots;
  }

  save(
    workspaceId: string,
    snapshots: RepositoryStatusSnapshot[]
  ): Promise<void> {
    const document: RepositorySnapshotDocument = {
      schemaVersion: REPOSITORY_SNAPSHOT_SCHEMA_VERSION,
      workspaceId,
      snapshots: structuredClone(snapshots),
      updatedAt: this.#clock()
    };
    return this.#store.write(document);
  }
}

function migrateSnapshotDocument(value: unknown): unknown {
  if (!isRecord(value) || value.schemaVersion !== 0) {
    return value;
  }
  if (!Array.isArray(value.snapshots)) {
    return value;
  }
  return {
    ...value,
    schemaVersion: REPOSITORY_SNAPSHOT_SCHEMA_VERSION,
    snapshots: value.snapshots.map((snapshot) =>
      isRecord(snapshot)
        ? {
            ...snapshot,
            refreshPending:
              typeof snapshot.refreshPending === "boolean"
                ? snapshot.refreshPending
                : false,
            stale:
              typeof snapshot.stale === "boolean"
                ? snapshot.stale
                : true
          }
        : snapshot
    )
  };
}

function rebuildSnapshot(
  value: RepositoryStatusSnapshot
): RepositoryStatusSnapshot {
  return {
    repositoryId: value.repositoryId,
    worktreeId: value.worktreeId,
    ...(value.branch ? { branch: value.branch } : {}),
    head: value.head,
    ...(value.upstream
      ? { upstream: value.upstream }
      : {}),
    ahead: value.ahead,
    behind: value.behind,
    staged: value.staged,
    unstaged: value.unstaged,
    untracked: value.untracked,
    conflicted: value.conflicted,
    ...(value.operationState
      ? { operationState: value.operationState }
      : {}),
    ...(value.contentVersion !== undefined
      ? { contentVersion: value.contentVersion }
      : {}),
    refreshPending: value.refreshPending,
    stale: value.stale,
    refreshedAt: value.refreshedAt,
    ...(value.error
      ? {
          error: {
            code: value.error.code,
            message: value.error.message
          }
        }
      : {})
  };
}

function isSnapshotDocument(
  value: unknown,
  workspaceId: string
): value is RepositorySnapshotDocument {
  return (
    isRecord(value) &&
    value.schemaVersion === REPOSITORY_SNAPSHOT_SCHEMA_VERSION &&
    value.workspaceId === workspaceId &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.snapshots) &&
    value.snapshots.every(isSnapshot)
  );
}

function isSnapshot(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.repositoryId === "string" &&
    typeof value.worktreeId === "string" &&
    typeof value.head === "string" &&
    typeof value.ahead === "number" &&
    typeof value.behind === "number" &&
    typeof value.staged === "number" &&
    typeof value.unstaged === "number" &&
    typeof value.untracked === "number" &&
    typeof value.conflicted === "number" &&
    typeof value.refreshPending === "boolean" &&
    typeof value.stale === "boolean" &&
    typeof value.refreshedAt === "string" &&
    (value.branch === undefined || typeof value.branch === "string") &&
    (value.upstream === undefined ||
      typeof value.upstream === "string") &&
    (value.operationState === undefined ||
      [
        "merge",
        "rebase",
        "cherry-pick",
        "revert",
        "bisect"
      ].includes(String(value.operationState))) &&
    (value.contentVersion === undefined ||
      (typeof value.contentVersion === "number" &&
        Number.isSafeInteger(value.contentVersion) &&
        value.contentVersion >= 0)) &&
    (value.error === undefined ||
      (isRecord(value.error) &&
        typeof value.error.code === "string" &&
        typeof value.error.message === "string"))
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
