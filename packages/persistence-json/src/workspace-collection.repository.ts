import { unlink } from "node:fs/promises";
import { join } from "node:path";

import {
  WORKSPACE_CATALOG_SCHEMA_VERSION,
  WorkspaceError,
  summarizeWorkspace,
  type Workspace,
  type WorkspaceCatalog,
  type WorkspaceCollectionStore,
  type WorkspaceSummary
} from "@gitnest/workspace-core";

import { AtomicJsonStore } from "./atomic-json-store";
import { migrateWorkspaceDocumentSet } from "./migrations/workspace-document";
import { JsonWorkspaceStore } from "./workspace.repository";

const MAX_WORKSPACE_CATALOG_BYTES = 4 * 1_024 * 1_024;
const LEGACY_WORKSPACE_CATALOG_SCHEMA_VERSIONS = [1, 2] as const;

interface LegacyWorkspaceCatalog {
  schemaVersion:
    (typeof LEGACY_WORKSPACE_CATALOG_SCHEMA_VERSIONS)[number];
  activeWorkspaceId: string;
  workspaces: WorkspaceSummary[];
  updatedAt: string;
}

interface WorkspaceMigrationPlan {
  sourceWorkspaceId: string;
  workspaces: Workspace[];
}

interface RawWorkspaceDocument {
  value: unknown;
  store: JsonWorkspaceStore;
}

export interface JsonWorkspaceCollectionStoreOptions {
  catalogFilePath: string;
  workspaceDirectory: string;
  legacyWorkspaceFilePath?: string;
  clock?: () => string;
}

export class JsonWorkspaceCollectionStore
  implements WorkspaceCollectionStore
{
  readonly #catalogStore: AtomicJsonStore;
  readonly #workspaceDirectory: string;
  readonly #legacyWorkspaceFilePath: string | undefined;
  readonly #legacyStore: JsonWorkspaceStore | undefined;
  readonly #clock: () => string;
  readonly #workspaceStores = new Map<
    string,
    JsonWorkspaceStore
  >();

  constructor(options: JsonWorkspaceCollectionStoreOptions) {
    this.#catalogStore = new AtomicJsonStore(
      options.catalogFilePath,
      { maxBytes: MAX_WORKSPACE_CATALOG_BYTES }
    );
    this.#workspaceDirectory = options.workspaceDirectory;
    this.#legacyWorkspaceFilePath =
      options.legacyWorkspaceFilePath;
    this.#legacyStore = options.legacyWorkspaceFilePath
      ? new JsonWorkspaceStore(options.legacyWorkspaceFilePath)
      : undefined;
    this.#clock =
      options.clock ?? (() => new Date().toISOString());
  }

  async loadCatalog(): Promise<WorkspaceCatalog | null> {
    const value = await this.#catalogStore.read();
    if (value !== null) {
      if (isWorkspaceCatalog(value)) {
        return structuredClone(value);
      }
      if (!isLegacyWorkspaceCatalog(value)) {
        this.#catalogStore.blockWrites(
          "Workspace catalog schema validation failed."
        );
        throw invalidCatalog();
      }
      return this.#migrateLegacyCatalog(value);
    }

    const legacyValue = await this.#legacyStore?.readRaw();
    if (legacyValue === null || legacyValue === undefined) {
      return null;
    }

    const sourceWorkspaceId = readWorkspaceId(legacyValue);
    assertWorkspaceId(sourceWorkspaceId);
    const workspaces = this.#migrateWorkspaceDocument(
      {
        value: legacyValue,
        store: this.#legacyStore as JsonWorkspaceStore
      },
      new Set()
    );
    const primary = workspaces.find(
      (workspace) => workspace.id === sourceWorkspaceId
    );
    if (!primary) {
      throw invalidWorkspaceDocument(sourceWorkspaceId);
    }
    const catalog: WorkspaceCatalog = {
      schemaVersion: WORKSPACE_CATALOG_SCHEMA_VERSION,
      activeWorkspaceId: sourceWorkspaceId,
      workspaces: workspaces.map(summarizeWorkspace),
      updatedAt: this.#clock()
    };
    assertCurrentCatalog(catalog);

    await this.#persistMigrationPlans(
      [{ sourceWorkspaceId, workspaces }],
      catalog
    );
    return catalog;
  }

  saveCatalog(catalog: WorkspaceCatalog): Promise<void> {
    assertCurrentCatalog(catalog);
    return this.#catalogStore.write(
      structuredClone(catalog)
    );
  }

  async loadWorkspace(
    workspaceId: string
  ): Promise<Workspace | null> {
    assertWorkspaceId(workspaceId);
    const workspace = await this.#workspaceStore(
      workspaceId
    ).load();
    if (workspace) {
      if (workspace.id !== workspaceId) {
        throw invalidWorkspaceDocument(workspaceId);
      }
      return workspace;
    }

    const legacyValue = await this.#legacyStore?.readRaw();
    if (
      legacyValue === null ||
      legacyValue === undefined ||
      readWorkspaceId(legacyValue) !== workspaceId
    ) {
      return null;
    }
    const workspaces = this.#migrateWorkspaceDocument(
      {
        value: legacyValue,
        store: this.#legacyStore as JsonWorkspaceStore
      },
      new Set()
    );
    const legacy = workspaces.find(
      (candidate) => candidate.id === workspaceId
    );
    if (!legacy) {
      throw invalidWorkspaceDocument(workspaceId);
    }
    await this.saveWorkspace(legacy);
    return legacy;
  }

  saveWorkspace(workspace: Workspace): Promise<void> {
    assertWorkspaceId(workspace.id);
    return this.#workspaceStore(workspace.id).save(workspace);
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    assertWorkspaceId(workspaceId);
    await deleteWorkspaceFile(
      this.#workspacePath(workspaceId),
      workspaceId
    );
    this.#workspaceStores.delete(workspaceId);
    if (
      workspaceId === "default" &&
      this.#legacyWorkspaceFilePath
    ) {
      await deleteWorkspaceFile(
        this.#legacyWorkspaceFilePath,
        workspaceId
      );
    }
  }

  #workspaceStore(workspaceId: string): JsonWorkspaceStore {
    const existing = this.#workspaceStores.get(workspaceId);
    if (existing) {
      return existing;
    }
    const store = new JsonWorkspaceStore(
      this.#workspacePath(workspaceId)
    );
    this.#workspaceStores.set(workspaceId, store);
    return store;
  }

  #workspacePath(workspaceId: string): string {
    return join(
      this.#workspaceDirectory,
      `${workspaceId}.workspace.json`
    );
  }

  async #migrateLegacyCatalog(
    catalog: LegacyWorkspaceCatalog
  ): Promise<WorkspaceCatalog> {
    const usedIds = new Set(
      catalog.workspaces.map((workspace) => workspace.id)
    );
    const plans: WorkspaceMigrationPlan[] = [];
    const summaries: WorkspaceSummary[] = [];

    for (const summary of catalog.workspaces) {
      const document =
        await this.#readWorkspaceDocument(summary.id);
      if (!document) {
        this.#catalogStore.blockWrites(
          "The Workspace catalog references a missing Workspace document."
        );
        throw invalidWorkspaceDocument(summary.id);
      }
      if (readWorkspaceId(document.value) !== summary.id) {
        this.#catalogStore.blockWrites(
          "A Workspace document id does not match its catalog entry."
        );
        throw invalidWorkspaceDocument(summary.id);
      }

      const workspaces = this.#migrateWorkspaceDocument(
        document,
        usedIds
      );
      if (
        !workspaces.some(
          (workspace) => workspace.id === summary.id
        )
      ) {
        throw invalidWorkspaceDocument(summary.id);
      }
      for (const workspace of workspaces) {
        usedIds.add(workspace.id);
        summaries.push(summarizeWorkspace(workspace));
      }
      plans.push({
        sourceWorkspaceId: summary.id,
        workspaces
      });
    }

    const upgraded: WorkspaceCatalog = {
      schemaVersion: WORKSPACE_CATALOG_SCHEMA_VERSION,
      activeWorkspaceId: catalog.activeWorkspaceId,
      workspaces: summaries,
      updatedAt: this.#clock()
    };
    assertCurrentCatalog(upgraded);
    await this.#persistMigrationPlans(plans, upgraded);
    return upgraded;
  }

  async #readWorkspaceDocument(
    workspaceId: string
  ): Promise<RawWorkspaceDocument | null> {
    const store = this.#workspaceStore(workspaceId);
    const value = await store.readRaw();
    if (value !== null) {
      return { value, store };
    }

    const legacyValue = await this.#legacyStore?.readRaw();
    return legacyValue !== null &&
      legacyValue !== undefined &&
      readWorkspaceId(legacyValue) === workspaceId
      ? {
          value: legacyValue,
          store: this.#legacyStore as JsonWorkspaceStore
        }
      : null;
  }

  #migrateWorkspaceDocument(
    document: RawWorkspaceDocument,
    reservedIds: ReadonlySet<string>
  ): Workspace[] {
    try {
      return migrateWorkspaceDocumentSet(
        document.value,
        reservedIds
      );
    } catch (error) {
      document.store.blockWrites(
        "Workspace schema validation or migration failed."
      );
      this.#catalogStore.blockWrites(
        "A Workspace document could not be migrated."
      );
      throw error;
    }
  }

  async #persistMigrationPlans(
    plans: WorkspaceMigrationPlan[],
    catalog: WorkspaceCatalog
  ): Promise<void> {
    for (const plan of plans) {
      for (const workspace of plan.workspaces) {
        if (workspace.id !== plan.sourceWorkspaceId) {
          await this.saveWorkspace(workspace);
        }
      }
    }

    await this.saveCatalog(catalog);

    for (const plan of plans) {
      const primary = plan.workspaces.find(
        (workspace) =>
          workspace.id === plan.sourceWorkspaceId
      );
      if (!primary) {
        throw invalidWorkspaceDocument(
          plan.sourceWorkspaceId
        );
      }
      await this.saveWorkspace(primary);
    }
  }
}

function isWorkspaceCatalog(
  value: unknown
): value is WorkspaceCatalog {
  return isWorkspaceCatalogShape(
    value,
    WORKSPACE_CATALOG_SCHEMA_VERSION
  );
}

function isLegacyWorkspaceCatalog(
  value: unknown
): value is LegacyWorkspaceCatalog {
  return (
    isRecord(value) &&
    LEGACY_WORKSPACE_CATALOG_SCHEMA_VERSIONS.includes(
      value.schemaVersion as 1 | 2
    ) &&
    isWorkspaceCatalogShape(value, value.schemaVersion as 1 | 2)
  );
}

function assertCurrentCatalog(
  value: WorkspaceCatalog
): void {
  if (!isWorkspaceCatalog(value)) {
    throw invalidCatalog();
  }
}

function isWorkspaceCatalogShape(
  value: unknown,
  schemaVersion: number
): boolean {
  if (
    !isRecord(value) ||
    value.schemaVersion !== schemaVersion ||
    typeof value.activeWorkspaceId !== "string" ||
    typeof value.updatedAt !== "string" ||
    !Array.isArray(value.workspaces) ||
    value.workspaces.length === 0 ||
    value.workspaces.length > 1_000
  ) {
    return false;
  }

  const ids = new Set<string>();
  for (const workspace of value.workspaces) {
    if (
      !isRecord(workspace) ||
      typeof workspace.id !== "string" ||
      !isWorkspaceId(workspace.id) ||
      typeof workspace.name !== "string" ||
      workspace.name.trim().length === 0 ||
      workspace.name.length > 120 ||
      typeof workspace.updatedAt !== "string" ||
      ids.has(workspace.id)
    ) {
      return false;
    }
    ids.add(workspace.id);
  }
  return ids.has(value.activeWorkspaceId);
}

function readWorkspaceId(value: unknown): string {
  if (
    !isRecord(value) ||
    typeof value.id !== "string"
  ) {
    throw invalidWorkspaceDocument("unknown");
  }
  return value.id;
}

function assertWorkspaceId(workspaceId: string): void {
  if (!isWorkspaceId(workspaceId)) {
    throw new WorkspaceError(
      "INVALID_PERSISTED_DATA",
      "The Workspace id cannot be used for persisted storage.",
      { workspaceId }
    );
  }
}

function isWorkspaceId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,160}$/.test(value);
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function invalidCatalog(): WorkspaceError {
  return new WorkspaceError(
    "INVALID_PERSISTED_DATA",
    "The persisted Workspace catalog is invalid."
  );
}

function invalidWorkspaceDocument(
  workspaceId: string
): WorkspaceError {
  return new WorkspaceError(
    "INVALID_PERSISTED_DATA",
    "The persisted Workspace document id does not match its catalog entry.",
    { workspaceId }
  );
}

async function deleteWorkspaceFile(
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
      "Unable to delete the persisted Workspace document.",
      { cause: getErrorMessage(error), workspaceId }
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
