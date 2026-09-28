import { access, unlink } from "node:fs/promises";
import { join } from "node:path";

import type {
  WorkspaceOperation,
  WorkspaceOperationStore
} from "@gitnest/application";
import {
  WorkspaceError,
  type RepositorySnapshotStore,
  type RepositoryStatusSnapshot
} from "@gitnest/workspace-core";

import { JsonRepositorySnapshotStore } from "./repository-snapshot.repository";
import { JsonWorkspaceOperationStore } from "./workspace-operation.repository";

interface WorkspaceScopedStoreOptions {
  directoryPath: string;
  legacyFilePath?: string;
  legacyWorkspaceId?: string;
  clock?: () => string;
}

export class JsonWorkspaceSnapshotCollectionStore
  implements RepositorySnapshotStore
{
  readonly #options: WorkspaceScopedStoreOptions;
  readonly #stores = new Map<
    string,
    JsonRepositorySnapshotStore
  >();

  constructor(options: WorkspaceScopedStoreOptions) {
    this.#options = options;
  }

  async load(
    workspaceId: string
  ): Promise<RepositoryStatusSnapshot[]> {
    assertWorkspaceId(workspaceId);
    const path = this.#path(workspaceId);
    if (await fileExists(path)) {
      return this.#store(workspaceId).load(workspaceId);
    }

    if (
      this.#options.legacyFilePath &&
      workspaceId ===
        (this.#options.legacyWorkspaceId ?? "default") &&
      (await fileExists(this.#options.legacyFilePath))
    ) {
      const snapshots = await new JsonRepositorySnapshotStore(
        this.#options.legacyFilePath,
        this.#options.clock
      ).load(workspaceId);
      await this.#store(workspaceId).save(
        workspaceId,
        snapshots
      );
      return snapshots;
    }

    return [];
  }

  save(
    workspaceId: string,
    snapshots: RepositoryStatusSnapshot[]
  ): Promise<void> {
    assertWorkspaceId(workspaceId);
    return this.#store(workspaceId).save(
      workspaceId,
      snapshots
    );
  }

  async delete(workspaceId: string): Promise<void> {
    assertWorkspaceId(workspaceId);
    this.#stores.delete(workspaceId);
    await deleteFile(this.#path(workspaceId), workspaceId);
    if (
      this.#options.legacyFilePath &&
      workspaceId ===
        (this.#options.legacyWorkspaceId ?? "default")
    ) {
      await deleteFile(
        this.#options.legacyFilePath,
        workspaceId
      );
    }
  }

  #store(workspaceId: string): JsonRepositorySnapshotStore {
    const existing = this.#stores.get(workspaceId);
    if (existing) {
      return existing;
    }
    const store = new JsonRepositorySnapshotStore(
      this.#path(workspaceId),
      this.#options.clock
    );
    this.#stores.set(workspaceId, store);
    return store;
  }

  #path(workspaceId: string): string {
    return join(
      this.#options.directoryPath,
      `${workspaceId}.snapshots.json`
    );
  }
}

export class JsonWorkspaceOperationCollectionStore
  implements WorkspaceOperationStore
{
  readonly #options: WorkspaceScopedStoreOptions;
  readonly #stores = new Map<
    string,
    JsonWorkspaceOperationStore
  >();

  constructor(options: WorkspaceScopedStoreOptions) {
    this.#options = options;
  }

  async load(
    workspaceId: string
  ): Promise<WorkspaceOperation[]> {
    assertWorkspaceId(workspaceId);
    const path = this.#path(workspaceId);
    if (await fileExists(path)) {
      return this.#store(workspaceId).load(workspaceId);
    }

    if (
      this.#options.legacyFilePath &&
      workspaceId ===
        (this.#options.legacyWorkspaceId ?? "default") &&
      (await fileExists(this.#options.legacyFilePath))
    ) {
      const operations = await new JsonWorkspaceOperationStore(
        this.#options.legacyFilePath,
        this.#options.clock
      ).load(workspaceId);
      await this.#store(workspaceId).save(
        workspaceId,
        operations
      );
      return operations;
    }

    return [];
  }

  save(
    workspaceId: string,
    operations: WorkspaceOperation[]
  ): Promise<void> {
    assertWorkspaceId(workspaceId);
    return this.#store(workspaceId).save(
      workspaceId,
      operations
    );
  }

  async delete(workspaceId: string): Promise<void> {
    assertWorkspaceId(workspaceId);
    this.#stores.delete(workspaceId);
    await deleteFile(this.#path(workspaceId), workspaceId);
    if (
      this.#options.legacyFilePath &&
      workspaceId ===
        (this.#options.legacyWorkspaceId ?? "default")
    ) {
      await deleteFile(
        this.#options.legacyFilePath,
        workspaceId
      );
    }
  }

  #store(
    workspaceId: string
  ): JsonWorkspaceOperationStore {
    const existing = this.#stores.get(workspaceId);
    if (existing) {
      return existing;
    }
    const store = new JsonWorkspaceOperationStore(
      this.#path(workspaceId),
      this.#options.clock
    );
    this.#stores.set(workspaceId, store);
    return store;
  }

  #path(workspaceId: string): string {
    return join(
      this.#options.directoryPath,
      `${workspaceId}.operations.json`
    );
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return false;
    }
    throw new WorkspaceError(
      "PERSISTENCE_FAILED",
      "Unable to inspect persisted Workspace runtime data.",
      { cause: getErrorMessage(error) }
    );
  }
}

async function deleteFile(
  path: string,
  workspaceId: string
): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return;
    }
    throw new WorkspaceError(
      "PERSISTENCE_FAILED",
      "Unable to delete persisted Workspace runtime data.",
      { cause: getErrorMessage(error), workspaceId }
    );
  }
}

function assertWorkspaceId(workspaceId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(workspaceId)) {
    throw new WorkspaceError(
      "INVALID_PERSISTED_DATA",
      "The Workspace id cannot be used for persisted storage.",
      { workspaceId }
    );
  }
}

function getErrorCode(error: unknown): string | undefined {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}
