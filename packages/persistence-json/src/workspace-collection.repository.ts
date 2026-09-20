import { createHash } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";

import {
  WORKSPACE_CATALOG_SCHEMA_VERSION,
  WorkspaceError,
  getEntryDefaultTarget,
  listEntryTargets,
  repositoryTargetKey,
  summarizeWorkspace,
  type Workspace,
  type WorkspaceCatalog,
  type WorkspaceCollectionStore,
  type WorkspaceEntry,
  type WorkspaceSummary
} from "@gitnest/workspace-core";

import { AtomicJsonStore } from "./atomic-json-store";
import { JsonWorkspaceStore } from "./workspace.repository";

const MAX_WORKSPACE_CATALOG_BYTES = 4 * 1_024 * 1_024;
const LEGACY_WORKSPACE_CATALOG_SCHEMA_VERSION = 1;

interface LegacyWorkspaceCatalog {
  schemaVersion: typeof LEGACY_WORKSPACE_CATALOG_SCHEMA_VERSION;
  activeWorkspaceId: string;
  workspaces: WorkspaceSummary[];
  updatedAt: string;
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

    const legacy = await this.#legacyStore?.load();
    if (!legacy) {
      return null;
    }
    assertWorkspaceId(legacy.id);
    const migrated =
      await this.#workspaceStore(legacy.id).load();
    if (migrated && migrated.id !== legacy.id) {
      throw invalidWorkspaceDocument(legacy.id);
    }
    const workspace = migrated ?? legacy;
    const workspaces = splitLegacyWorkspace(
      workspace,
      new Set()
    );
    const catalog: WorkspaceCatalog = {
      schemaVersion: WORKSPACE_CATALOG_SCHEMA_VERSION,
      activeWorkspaceId: workspace.id,
      workspaces: workspaces.map(summarizeWorkspace),
      updatedAt: this.#clock()
    };
    for (const promotedWorkspace of workspaces) {
      await this.saveWorkspace(promotedWorkspace);
    }
    await this.saveCatalog(catalog);
    return catalog;
  }

  saveCatalog(catalog: WorkspaceCatalog): Promise<void> {
    if (!isWorkspaceCatalog(catalog)) {
      throw invalidCatalog();
    }
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

    const legacy =
      workspaceId === "default"
        ? await this.#legacyStore?.load()
        : null;
    if (!legacy || legacy.id !== workspaceId) {
      return null;
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
    const legacy = await this.#legacyStore?.load();
    const legacyIndex = legacy
      ? catalog.workspaces.findIndex(
          (workspace) => workspace.id === legacy.id
        )
      : -1;

    if (!legacy || legacyIndex < 0) {
      const upgraded: WorkspaceCatalog = {
        ...catalog,
        schemaVersion: WORKSPACE_CATALOG_SCHEMA_VERSION
      };
      await this.saveCatalog(upgraded);
      return upgraded;
    }

    assertWorkspaceId(legacy.id);
    const migrated =
      await this.#workspaceStore(legacy.id).load();
    if (migrated && migrated.id !== legacy.id) {
      throw invalidWorkspaceDocument(legacy.id);
    }
    const source = migrated ?? legacy;
    const reservedIds = new Set(
      catalog.workspaces
        .filter((workspace) => workspace.id !== source.id)
        .map((workspace) => workspace.id)
    );
    const promotedWorkspaces = splitLegacyWorkspace(
      source,
      reservedIds
    );
    const workspaces = catalog.workspaces.flatMap(
      (workspace, index) =>
        index === legacyIndex
          ? promotedWorkspaces.map(summarizeWorkspace)
          : [workspace]
    );
    const upgraded: WorkspaceCatalog = {
      schemaVersion: WORKSPACE_CATALOG_SCHEMA_VERSION,
      activeWorkspaceId: catalog.activeWorkspaceId,
      workspaces,
      updatedAt: this.#clock()
    };

    for (const promotedWorkspace of promotedWorkspaces) {
      await this.saveWorkspace(promotedWorkspace);
    }
    await this.saveCatalog(upgraded);
    return upgraded;
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
  return isWorkspaceCatalogShape(
    value,
    LEGACY_WORKSPACE_CATALOG_SCHEMA_VERSION
  );
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

function splitLegacyWorkspace(
  workspace: Workspace,
  reservedIds: ReadonlySet<string>
): Workspace[] {
  if (workspace.entries.length === 0) {
    return [structuredClone(workspace)];
  }

  const selectedEntry =
    workspace.entries.find(
      (entry) => entry.id === workspace.selectedEntryId
    ) ?? workspace.entries[0];
  if (!selectedEntry) {
    return [structuredClone(workspace)];
  }

  const usedIds = new Set(reservedIds);
  usedIds.add(workspace.id);
  return workspace.entries.map((entry) => {
    const workspaceId =
      entry.id === selectedEntry.id
        ? workspace.id
        : createPromotedWorkspaceId(
            workspace.id,
            entry.id,
            usedIds
          );
    usedIds.add(workspaceId);
    return createPromotedWorkspace(
      workspace,
      entry,
      workspaceId
    );
  });
}

function createPromotedWorkspace(
  source: Workspace,
  entry: WorkspaceEntry,
  workspaceId: string
): Workspace {
  const targetKeys = new Set(
    listEntryTargets(entry).map(repositoryTargetKey)
  );
  const worktrees = source.worktrees
    .filter((worktree) =>
      targetKeys.has(
        repositoryTargetKey({
          repositoryId: worktree.repositoryId,
          worktreeId: worktree.id
        })
      )
    )
    .map((worktree) => structuredClone(worktree));
  const repositories = source.repositories.flatMap(
    (repository) => {
      const worktreeIds = repository.worktreeIds.filter(
        (worktreeId) =>
          targetKeys.has(
            repositoryTargetKey({
              repositoryId: repository.id,
              worktreeId
            })
          )
      );
      if (worktreeIds.length === 0) {
        return [];
      }
      const primaryWorktreeId =
        repository.primaryWorktreeId &&
        worktreeIds.includes(repository.primaryWorktreeId)
          ? repository.primaryWorktreeId
          : undefined;
      return [
        {
          id: repository.id,
          name: repository.name,
          commonDir: repository.commonDir,
          canonicalCommonDir:
            repository.canonicalCommonDir,
          ...(primaryWorktreeId
            ? { primaryWorktreeId }
            : {}),
          worktreeIds
        }
      ];
    }
  );
  const selectedTarget =
    source.selectedTarget &&
    targetKeys.has(repositoryTargetKey(source.selectedTarget))
      ? source.selectedTarget
      : getEntryDefaultTarget(entry);

  return {
    schemaVersion: source.schemaVersion,
    id: workspaceId,
    name: createWorkspaceName(entry.displayName),
    entries: [
      {
        ...structuredClone(entry),
        order: 0
      }
    ],
    repositories,
    worktrees,
    selectedEntryId: entry.id,
    ...(selectedTarget
      ? {
          selectedTarget: {
            repositoryId: selectedTarget.repositoryId,
            worktreeId: selectedTarget.worktreeId
          }
        }
      : {}),
    updatedAt: source.updatedAt
  };
}

function createPromotedWorkspaceId(
  legacyWorkspaceId: string,
  entryId: string,
  usedIds: ReadonlySet<string>
): string {
  for (let attempt = 0; ; attempt += 1) {
    const digest = createHash("sha256")
      .update(
        `${legacyWorkspaceId}\0${entryId}\0${attempt}`
      )
      .digest("hex")
      .slice(0, 32);
    const workspaceId = `workspace_${digest}`;
    if (!usedIds.has(workspaceId)) {
      return workspaceId;
    }
  }
}

function createWorkspaceName(displayName: string): string {
  const trimmed = displayName.trim();
  return (trimmed || "Workspace").slice(0, 120);
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
