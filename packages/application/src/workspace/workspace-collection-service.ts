import { randomUUID } from "node:crypto";

import type { GitClient } from "@gitnest/git-core";
import {
  WORKSPACE_CATALOG_SCHEMA_VERSION,
  WorkspaceError,
  createEmptyWorkspace,
  summarizeWorkspace,
  type RepositoryTarget,
  type Workspace,
  type WorkspaceCatalog,
  type WorkspaceCollectionStore,
  type WorkspaceFileSystem,
  type WorkspaceStore,
  type WorkspaceSummary
} from "@gitnest/workspace-core";

import {
  WorkspaceService,
  type AddWorkspaceEntryInput,
  type RemoveWorkspaceEntryInput,
  type SetWorkspaceGroupCollapsedInput,
  type UpdateWorkspaceEntryInput,
  type WorkspaceMutationResult
} from "./workspace-service";

export interface CreateWorkspaceInput {
  name: string;
}

export interface RenameWorkspaceInput {
  workspaceId: string;
  name: string;
}

export interface WorkspaceCollectionServiceOptions {
  clock?: () => string;
  idFactory?: () => string;
}

export class WorkspaceCollectionService {
  readonly #gitClient: GitClient;
  readonly #fileSystem: WorkspaceFileSystem;
  readonly #store: WorkspaceCollectionStore;
  readonly #clock: () => string;
  readonly #idFactory: () => string;
  #catalog: WorkspaceCatalog | undefined;
  #activeService: WorkspaceService | undefined;
  #queue: Promise<void> = Promise.resolve();

  constructor(
    gitClient: GitClient,
    fileSystem: WorkspaceFileSystem,
    store: WorkspaceCollectionStore,
    options: WorkspaceCollectionServiceOptions = {}
  ) {
    this.#gitClient = gitClient;
    this.#fileSystem = fileSystem;
    this.#store = store;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#idFactory =
      options.idFactory ?? (() => `workspace_${randomUUID()}`);
  }

  getCurrent(): Promise<Workspace> {
    return this.#runExclusive(async () => {
      const service = await this.#getActiveService();
      const workspace = await service.getCurrent();
      await this.#syncSummary(workspace);
      return workspace;
    });
  }

  listWorkspaces(): Promise<WorkspaceSummary[]> {
    return this.#runExclusive(async () => {
      const catalog = await this.#loadCatalog();
      return structuredClone(catalog.workspaces);
    });
  }

  createWorkspace(
    input: CreateWorkspaceInput
  ): Promise<Workspace> {
    return this.#runExclusive(async () => {
      const catalog = await this.#loadCatalog();
      const now = this.#clock();
      const workspace: Workspace = {
        ...createEmptyWorkspace(now),
        id: await this.#createWorkspaceId(catalog),
        name: validateWorkspaceName(input.name),
        updatedAt: now
      };
      const nextCatalog: WorkspaceCatalog = {
        ...catalog,
        activeWorkspaceId: workspace.id,
        workspaces: [
          ...catalog.workspaces,
          summarizeWorkspace(workspace)
        ],
        updatedAt: now
      };

      await this.#store.saveWorkspace(workspace);
      await this.#store.saveCatalog(nextCatalog);
      this.#catalog = nextCatalog;
      this.#activeService = this.#createService(workspace.id);
      return workspace;
    });
  }

  switchWorkspace(workspaceId: string): Promise<Workspace> {
    return this.#runExclusive(async () => {
      const catalog = await this.#loadCatalog();
      const summary = catalog.workspaces.find(
        (candidate) => candidate.id === workspaceId
      );
      if (!summary) {
        throw workspaceNotFound(workspaceId);
      }

      const workspace =
        await this.#store.loadWorkspace(workspaceId);
      if (!workspace) {
        throw invalidWorkspaceCatalog(workspaceId);
      }

      if (catalog.activeWorkspaceId !== workspaceId) {
        const nextCatalog: WorkspaceCatalog = {
          ...catalog,
          activeWorkspaceId: workspaceId,
          updatedAt: this.#clock()
        };
        await this.#store.saveCatalog(nextCatalog);
        this.#catalog = nextCatalog;
      }
      this.#activeService = this.#createService(workspaceId);
      await this.#syncSummary(workspace);
      return workspace;
    });
  }

  renameWorkspace(
    input: RenameWorkspaceInput
  ): Promise<Workspace> {
    return this.#runExclusive(async () => {
      const catalog = await this.#loadCatalog();
      if (
        !catalog.workspaces.some(
          (candidate) => candidate.id === input.workspaceId
        )
      ) {
        throw workspaceNotFound(input.workspaceId);
      }

      const current =
        await this.#store.loadWorkspace(input.workspaceId);
      if (!current) {
        throw invalidWorkspaceCatalog(input.workspaceId);
      }

      const name = validateWorkspaceName(input.name);
      const workspace =
        current.name === name
          ? current
          : {
              ...current,
              name,
              updatedAt: this.#clock()
            };
      if (workspace !== current) {
        await this.#store.saveWorkspace(workspace);
      }
      await this.#syncSummary(workspace);

      if (catalog.activeWorkspaceId === input.workspaceId) {
        this.#activeService = this.#createService(
          input.workspaceId
        );
        return workspace;
      }

      return (await this.#getActiveService()).getCurrent();
    });
  }

  deleteWorkspace(workspaceId: string): Promise<Workspace> {
    return this.#runExclusive(async () => {
      const catalog = await this.#loadCatalog();
      const index = catalog.workspaces.findIndex(
        (candidate) => candidate.id === workspaceId
      );
      if (index < 0) {
        throw workspaceNotFound(workspaceId);
      }
      if (catalog.workspaces.length === 1) {
        throw new WorkspaceError(
          "INVALID_REQUEST",
          "At least one Workspace must remain."
        );
      }

      const remaining = catalog.workspaces.filter(
        (candidate) => candidate.id !== workspaceId
      );
      const nextActiveWorkspaceId =
        catalog.activeWorkspaceId === workspaceId
          ? (
              remaining[Math.min(index, remaining.length - 1)] as
                | WorkspaceSummary
                | undefined
            )?.id
          : catalog.activeWorkspaceId;
      if (!nextActiveWorkspaceId) {
        throw new WorkspaceError(
          "INVALID_PERSISTED_DATA",
          "The Workspace catalog has no valid active Workspace."
        );
      }
      const nextWorkspace =
        await this.#store.loadWorkspace(nextActiveWorkspaceId);
      if (!nextWorkspace) {
        throw invalidWorkspaceCatalog(nextActiveWorkspaceId);
      }

      const nextCatalog: WorkspaceCatalog = {
        ...catalog,
        activeWorkspaceId: nextActiveWorkspaceId,
        workspaces: remaining,
        updatedAt: this.#clock()
      };
      await this.#store.saveCatalog(nextCatalog);
      await this.#store
        .deleteWorkspace(workspaceId)
        .catch(() => undefined);
      this.#catalog = nextCatalog;
      this.#activeService = this.#createService(
        nextActiveWorkspaceId
      );
      return nextWorkspace;
    });
  }

  addEntry(
    input: AddWorkspaceEntryInput
  ): Promise<WorkspaceMutationResult> {
    return this.#runExclusive(async () => {
      const result = await (
        await this.#getActiveService()
      ).addEntry(input);
      await this.#syncSummary(result.workspace);
      return result;
    });
  }

  rescan(signal?: AbortSignal): Promise<Workspace> {
    return this.#runExclusive(async () => {
      const workspace = await (
        await this.#getActiveService()
      ).rescan(signal);
      await this.#syncSummary(workspace);
      return workspace;
    });
  }

  updateEntry(
    input: UpdateWorkspaceEntryInput
  ): Promise<Workspace> {
    return this.#runExclusive(async () => {
      const workspace = await (
        await this.#getActiveService()
      ).updateEntry(input);
      await this.#syncSummary(workspace);
      return workspace;
    });
  }

  removeEntry(
    input: RemoveWorkspaceEntryInput
  ): Promise<Workspace> {
    return this.#runExclusive(async () => {
      const workspace = await (
        await this.#getActiveService()
      ).removeEntry(input);
      await this.#syncSummary(workspace);
      return workspace;
    });
  }

  setGroupCollapsed(
    input: SetWorkspaceGroupCollapsedInput
  ): Promise<Workspace> {
    return this.#runExclusive(async () => {
      const workspace = await (
        await this.#getActiveService()
      ).setGroupCollapsed(input);
      await this.#syncSummary(workspace);
      return workspace;
    });
  }

  selectEntry(entryId: string): Promise<Workspace> {
    return this.#runExclusive(async () => {
      const workspace = await (
        await this.#getActiveService()
      ).selectEntry(entryId);
      await this.#syncSummary(workspace);
      return workspace;
    });
  }

  selectTarget(target: RepositoryTarget): Promise<Workspace> {
    return this.#runExclusive(async () => {
      const workspace = await (
        await this.#getActiveService()
      ).selectTarget(target);
      await this.#syncSummary(workspace);
      return workspace;
    });
  }

  async #loadCatalog(): Promise<WorkspaceCatalog> {
    if (this.#catalog) {
      return this.#catalog;
    }

    const persisted = await this.#store.loadCatalog();
    if (persisted) {
      this.#catalog = persisted;
      return persisted;
    }

    const now = this.#clock();
    const workspace = createEmptyWorkspace(now);
    const catalog: WorkspaceCatalog = {
      schemaVersion: WORKSPACE_CATALOG_SCHEMA_VERSION,
      activeWorkspaceId: workspace.id,
      workspaces: [summarizeWorkspace(workspace)],
      updatedAt: now
    };
    await this.#store.saveWorkspace(workspace);
    await this.#store.saveCatalog(catalog);
    this.#catalog = catalog;
    return catalog;
  }

  async #getActiveService(): Promise<WorkspaceService> {
    const catalog = await this.#loadCatalog();
    if (!this.#activeService) {
      const workspace = await this.#store.loadWorkspace(
        catalog.activeWorkspaceId
      );
      if (!workspace) {
        throw invalidWorkspaceCatalog(
          catalog.activeWorkspaceId
        );
      }
      this.#activeService = this.#createService(workspace.id);
    }
    return this.#activeService;
  }

  #createService(workspaceId: string): WorkspaceService {
    return new WorkspaceService(
      this.#gitClient,
      this.#fileSystem,
      new CollectionWorkspaceStore(this.#store, workspaceId),
      { clock: this.#clock }
    );
  }

  async #syncSummary(workspace: Workspace): Promise<void> {
    const catalog = await this.#loadCatalog();
    const summary = summarizeWorkspace(workspace);
    const index = catalog.workspaces.findIndex(
      (candidate) => candidate.id === workspace.id
    );
    if (index < 0) {
      throw invalidWorkspaceCatalog(workspace.id);
    }
    const current = catalog.workspaces[index] as WorkspaceSummary;
    if (
      current.name === summary.name &&
      current.updatedAt === summary.updatedAt
    ) {
      return;
    }

    const workspaces = [...catalog.workspaces];
    workspaces[index] = summary;
    const nextCatalog: WorkspaceCatalog = {
      ...catalog,
      workspaces,
      updatedAt: this.#clock()
    };
    await this.#store.saveCatalog(nextCatalog);
    this.#catalog = nextCatalog;
  }

  async #createWorkspaceId(
    catalog: WorkspaceCatalog
  ): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = this.#idFactory().trim();
      if (
        isWorkspaceId(id) &&
        !catalog.workspaces.some(
          (workspace) => workspace.id === id
        ) &&
        !(await this.#store.loadWorkspace(id))
      ) {
        return id;
      }
    }

    throw new WorkspaceError(
      "PERSISTENCE_FAILED",
      "Unable to allocate a unique Workspace id."
    );
  }

  #runExclusive<Result>(
    operation: () => Promise<Result>
  ): Promise<Result> {
    const result = this.#queue.then(operation, operation);
    this.#queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

class CollectionWorkspaceStore implements WorkspaceStore {
  readonly #store: WorkspaceCollectionStore;
  readonly #workspaceId: string;

  constructor(
    store: WorkspaceCollectionStore,
    workspaceId: string
  ) {
    this.#store = store;
    this.#workspaceId = workspaceId;
  }

  load(): Promise<Workspace | null> {
    return this.#store.loadWorkspace(this.#workspaceId);
  }

  save(workspace: Workspace): Promise<void> {
    if (workspace.id !== this.#workspaceId) {
      throw new WorkspaceError(
        "PERSISTENCE_FAILED",
        "Refusing to save a Workspace under a different id."
      );
    }
    return this.#store.saveWorkspace(workspace);
  }
}

function validateWorkspaceName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 120) {
    throw new WorkspaceError(
      "INVALID_REQUEST",
      "Workspace name must contain 1 to 120 characters."
    );
  }
  return name;
}

function isWorkspaceId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,160}$/.test(value);
}

function workspaceNotFound(workspaceId: string): WorkspaceError {
  return new WorkspaceError(
    "INVALID_REQUEST",
    "The requested Workspace does not exist.",
    { workspaceId }
  );
}

function invalidWorkspaceCatalog(
  workspaceId: string
): WorkspaceError {
  return new WorkspaceError(
    "INVALID_PERSISTED_DATA",
    "The Workspace catalog references a missing Workspace document.",
    { workspaceId }
  );
}
