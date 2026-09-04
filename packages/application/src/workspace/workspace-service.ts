import type { GitClient } from "@gitnest/git-core";
import {
  WorkspaceAssembler,
  WorkspaceError,
  WorkspaceScanner,
  createEmptyWorkspace,
  createPathIdentity,
  findTargetEntry,
  getEntryDefaultTarget,
  listWorkspaceTargets,
  repositoryTargetKey,
  repositoryTargetsEqual,
  type RepositoryTarget,
  type Workspace,
  type WorkspaceEntry,
  type WorkspaceFileSystem,
  type WorkspaceRootDefinition,
  type WorkspaceRootScan,
  type WorkspaceStore
} from "@gitnest/workspace-core";

import { GitRepositoryProbe } from "./git-repository-probe";

export type AddWorkspaceEntrySource =
  | "picker"
  | "manual"
  | "drop";

export interface AddWorkspaceEntryInput {
  path: string;
  source: AddWorkspaceEntrySource;
}

export interface UpdateWorkspaceEntryInput {
  entryId: string;
  displayName?: string;
  order?: number;
}

export interface SetWorkspaceGroupCollapsedInput {
  entryId: string;
  groupId: string;
  collapsed: boolean;
}

export interface WorkspaceMutationResult {
  workspace: Workspace;
  focusedEntryId: string;
  duplicate: boolean;
}

interface WorkspaceServiceOptions {
  clock?: () => string;
}

export class WorkspaceService {
  readonly #fileSystem: WorkspaceFileSystem;
  readonly #store: WorkspaceStore;
  readonly #scanner: WorkspaceScanner;
  readonly #assembler: WorkspaceAssembler;
  readonly #clock: () => string;
  #workspace: Workspace | undefined;
  #queue: Promise<void> = Promise.resolve();

  constructor(
    gitClient: GitClient,
    fileSystem: WorkspaceFileSystem,
    store: WorkspaceStore,
    options: WorkspaceServiceOptions = {}
  ) {
    this.#fileSystem = fileSystem;
    this.#store = store;
    this.#scanner = new WorkspaceScanner(
      fileSystem,
      new GitRepositoryProbe(gitClient)
    );
    this.#assembler = new WorkspaceAssembler(fileSystem);
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  getCurrent(): Promise<Workspace> {
    return this.#runExclusive(() => this.#loadWorkspace());
  }

  addEntry(
    input: AddWorkspaceEntryInput
  ): Promise<WorkspaceMutationResult> {
    return this.#runExclusive(async () => {
      validateAddSource(input.source);
      const current = await this.#loadWorkspace();
      const normalized = this.#fileSystem.normalizePath(input.path);
      const duplicate = current.entries.find(
        (entry) =>
          entry.canonicalPath === normalized.canonicalPath
      );

      if (duplicate) {
        const workspace =
          current.selectedEntryId === duplicate.id
            ? current
            : {
                ...current,
                selectedEntryId: duplicate.id,
                updatedAt: this.#clock()
              };

        if (workspace !== current) {
          await this.#save(workspace);
        }

        return {
          workspace,
          focusedEntryId: duplicate.id,
          duplicate: true
        };
      }

      const now = this.#clock();
      const root: WorkspaceRootDefinition = {
        id: createPathIdentity("entry", normalized.canonicalPath),
        displayName:
          this.#fileSystem.basename(normalized.path) ||
          normalized.path,
        path: normalized.path,
        canonicalPath: normalized.canonicalPath,
        excludes: [],
        order: current.entries.length
      };
      const roots = [
        ...current.entries.map(toRootDefinition),
        root
      ];
      const scans = await this.#scanRoots(roots, now);
      const newRootScan = scans.find(
        (scan) => scan.root.id === root.id
      );

      if (!newRootScan || newRootScan.repositories.length === 0) {
        const rootIssue = newRootScan?.issues[0];

        if (rootIssue) {
          throw new WorkspaceError(
            "DIRECTORY_UNAVAILABLE",
            rootIssue.message,
            {
              path: root.path,
              issueCount: newRootScan?.issues.length ?? 1
            }
          );
        }

        throw new WorkspaceError(
          "NO_REPOSITORIES_FOUND",
          "No Git repositories were found in the selected directory.",
          { path: root.path }
        );
      }

      const assembled = this.#assembler.assemble({
        current,
        roots,
        scans,
        updatedAt: now
      });
      const selectedTarget = getEntryDefaultTarget(
        assembled.entries.find((entry) => entry.id === root.id)
      );
      const workspace: Workspace = {
        ...assembled,
        selectedEntryId: root.id,
        ...(selectedTarget ? { selectedTarget } : {})
      };

      await this.#save(workspace);
      return {
        workspace,
        focusedEntryId: root.id,
        duplicate: false
      };
    });
  }

  rescan(): Promise<Workspace> {
    return this.#runExclusive(async () => {
      const current = await this.#loadWorkspace();

      if (current.entries.length === 0) {
        return current;
      }

      const now = this.#clock();
      const roots = current.entries.map(toRootDefinition);
      const scans = await this.#scanRoots(roots, now);
      const workspace = this.#assembler.assemble({
        current,
        roots,
        scans,
        updatedAt: now
      });

      await this.#save(workspace);
      return workspace;
    });
  }

  updateEntry(
    input: UpdateWorkspaceEntryInput
  ): Promise<Workspace> {
    return this.#runExclusive(async () => {
      const current = await this.#loadWorkspace();
      const index = current.entries.findIndex(
        (entry) => entry.id === input.entryId
      );

      if (index < 0) {
        throw new WorkspaceError(
          "ENTRY_NOT_FOUND",
          "The Workspace entry no longer exists."
        );
      }

      if (
        input.displayName === undefined &&
        input.order === undefined
      ) {
        throw new WorkspaceError(
          "INVALID_REQUEST",
          "A display name or order is required."
        );
      }

      const entries = [...current.entries];
      const existing = entries[index] as WorkspaceEntry;
      const displayName =
        input.displayName === undefined
          ? existing.displayName
          : validateDisplayName(input.displayName);
      entries[index] = {
        ...existing,
        displayName
      };

      if (input.order !== undefined) {
        if (!Number.isInteger(input.order)) {
          throw new WorkspaceError(
            "INVALID_REQUEST",
            "Workspace entry order must be an integer."
          );
        }

        const [entry] = entries.splice(index, 1);
        const targetIndex = Math.min(
          Math.max(input.order, 0),
          entries.length
        );
        entries.splice(targetIndex, 0, entry as WorkspaceEntry);
      }

      const workspace: Workspace = {
        ...current,
        entries: entries.map((entry, order) => ({
          ...entry,
          order
        })),
        updatedAt: this.#clock()
      };

      await this.#save(workspace);
      return workspace;
    });
  }

  setGroupCollapsed(
    input: SetWorkspaceGroupCollapsedInput
  ): Promise<Workspace> {
    return this.#runExclusive(async () => {
      const current = await this.#loadWorkspace();
      let groupFound = false;
      const entries = current.entries.map((entry) => {
        if (entry.id !== input.entryId) {
          return entry;
        }

        const groups = entry.groups.map((group) => {
          if (group.id !== input.groupId) {
            return group;
          }

          groupFound = true;
          return {
            ...group,
            collapsed: input.collapsed
          };
        });

        return { ...entry, groups };
      });

      if (!current.entries.some((entry) => entry.id === input.entryId)) {
        throw new WorkspaceError(
          "ENTRY_NOT_FOUND",
          "The Workspace entry no longer exists."
        );
      }

      if (!groupFound) {
        throw new WorkspaceError(
          "GROUP_NOT_FOUND",
          "The repository group no longer exists."
        );
      }

      const workspace: Workspace = {
        ...current,
        entries,
        updatedAt: this.#clock()
      };
      await this.#save(workspace);
      return workspace;
    });
  }

  selectEntry(entryId: string): Promise<Workspace> {
    return this.#runExclusive(async () => {
      const current = await this.#loadWorkspace();

      if (!current.entries.some((entry) => entry.id === entryId)) {
        throw new WorkspaceError(
          "ENTRY_NOT_FOUND",
          "The Workspace entry no longer exists."
        );
      }

      if (current.selectedEntryId === entryId) {
        return current;
      }

      const entry = current.entries.find(
        (candidate) => candidate.id === entryId
      );
      const target = getEntryDefaultTarget(entry);
      const workspace: Workspace = {
        ...current,
        selectedEntryId: entryId,
        ...(target ? { selectedTarget: target } : {}),
        updatedAt: this.#clock()
      };
      await this.#save(workspace);
      return workspace;
    });
  }

  selectTarget(target: RepositoryTarget): Promise<Workspace> {
    return this.#runExclusive(async () => {
      const current = await this.#loadWorkspace();
      const key = repositoryTargetKey(target);

      if (
        !listWorkspaceTargets(current).some(
          (candidate) => repositoryTargetKey(candidate) === key
        )
      ) {
        throw new WorkspaceError(
          "INVALID_REQUEST",
          "The selected repository target is not part of this Workspace."
        );
      }

      if (repositoryTargetsEqual(current.selectedTarget, target)) {
        return current;
      }

      const owner = findTargetEntry(current, target);
      const workspace: Workspace = {
        ...current,
        ...(owner ? { selectedEntryId: owner.id } : {}),
        selectedTarget: target,
        updatedAt: this.#clock()
      };
      await this.#save(workspace);
      return workspace;
    });
  }

  async #loadWorkspace(): Promise<Workspace> {
    if (!this.#workspace) {
      this.#workspace =
        (await this.#store.load()) ??
        createEmptyWorkspace(this.#clock());
    }

    return this.#workspace;
  }

  async #save(workspace: Workspace): Promise<void> {
    await this.#store.save(workspace);
    this.#workspace = workspace;
  }

  async #scanRoots(
    roots: WorkspaceRootDefinition[],
    scannedAt: string
  ): Promise<WorkspaceRootScan[]> {
    const scans: WorkspaceRootScan[] = [];

    for (const root of roots) {
      scans.push(
        await this.#scanner.scanRoot(root, { scannedAt })
      );
    }

    return scans;
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

function toRootDefinition(
  entry: WorkspaceEntry
): WorkspaceRootDefinition {
  return {
    id: entry.id,
    displayName: entry.displayName,
    path: entry.path,
    canonicalPath: entry.canonicalPath,
    excludes: [...entry.excludes],
    order: entry.order
  };
}

function validateAddSource(source: string): void {
  if (!["picker", "manual", "drop"].includes(source)) {
    throw new WorkspaceError(
      "INVALID_REQUEST",
      "Unknown Workspace entry source."
    );
  }
}

function validateDisplayName(value: string): string {
  const normalized = value.trim();

  if (!normalized || normalized.length > 120) {
    throw new WorkspaceError(
      "INVALID_REQUEST",
      "Display name must contain 1 to 120 characters."
    );
  }

  return normalized;
}
