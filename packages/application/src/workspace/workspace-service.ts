import type { GitClient } from "@gitnest/git-core";
import {
  WorkspaceAssembler,
  WorkspaceError,
  WorkspaceScanner,
  createEmptyWorkspace,
  listWorkspaceTargets,
  repositoryTargetKey,
  repositoryTargetsEqual,
  type RepositoryTarget,
  type Workspace,
  type WorkspaceFileSystem,
  type WorkspaceRoot,
  type WorkspaceStore
} from "@gitnest/workspace-core";

import { GitRepositoryProbe } from "./git-repository-probe";

export interface SetWorkspaceGroupCollapsedInput {
  groupId: string;
  collapsed: boolean;
}

export interface ExcludeWorkspaceRepositoryInput {
  target: RepositoryTarget;
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

  configureRoot(path: string): Promise<Workspace> {
    return this.#runExclusive(async () => {
      const current = await this.#loadWorkspace();
      if (isConfiguredWorkspace(current)) {
        throw new WorkspaceError(
          "INVALID_REQUEST",
          "The Workspace root is already configured."
        );
      }
      if (!isEmptyWorkspacePlaceholder(current)) {
        throw new WorkspaceError(
          "INVALID_PERSISTED_DATA",
          "An unconfigured Workspace cannot contain repository topology."
        );
      }

      const normalized = this.#fileSystem.normalizePath(path);
      const root: WorkspaceRoot = {
        path: normalized.path,
        canonicalPath: normalized.canonicalPath,
        excludes: []
      };
      const now = this.#clock();
      const scan = await this.#scanner.scanRoot(root, {
        scannedAt: now
      });

      if (scan.repositories.length === 0) {
        const rootIssue = scan.issues[0];
        if (rootIssue) {
          throw new WorkspaceError(
            "DIRECTORY_UNAVAILABLE",
            rootIssue.message,
            {
              path: root.path,
              issueCount: scan.issues.length
            }
          );
        }

        throw new WorkspaceError(
          "NO_REPOSITORIES_FOUND",
          "No Git repositories were found in the selected directory.",
          { path: root.path }
        );
      }

      const workspace = this.#assembler.assemble({
        current,
        scan,
        updatedAt: now
      });
      await this.#save(workspace);
      return workspace;
    });
  }

  rescan(signal?: AbortSignal): Promise<Workspace> {
    return this.#runExclusive(async () => {
      const current = await this.#loadWorkspace();
      const root = toWorkspaceRoot(current);
      if (!root) {
        return current;
      }

      const now = this.#clock();
      const scan = await this.#scanner.scanRoot(root, {
        scannedAt: now,
        ...(signal ? { signal } : {})
      });
      const workspace = this.#assembler.assemble({
        current,
        scan,
        updatedAt: now
      });

      await this.#save(workspace);
      return workspace;
    });
  }

  excludeRepository(
    input: ExcludeWorkspaceRepositoryInput
  ): Promise<Workspace> {
    return this.#runExclusive(async () => {
      const current = await this.#loadWorkspace();
      const root = toWorkspaceRoot(current);
      if (!root) {
        throw new WorkspaceError(
          "INVALID_REQUEST",
          "The Workspace root is not configured."
        );
      }

      const targetKey = repositoryTargetKey(input.target);
      if (
        !listWorkspaceTargets(current).some(
          (candidate) =>
            repositoryTargetKey(candidate) === targetKey
        )
      ) {
        throw new WorkspaceError(
          "INVALID_REQUEST",
          "The repository is not part of this Workspace."
        );
      }

      const worktree = current.worktrees.find(
        (candidate) =>
          candidate.id === input.target.worktreeId &&
          candidate.repositoryId === input.target.repositoryId
      );
      if (!worktree) {
        throw new WorkspaceError(
          "INVALID_REQUEST",
          "The repository worktree is no longer available."
        );
      }
      if (!this.#fileSystem.isWithin(root.path, worktree.path)) {
        throw new WorkspaceError(
          "INVALID_REQUEST",
          "The repository is outside the Workspace root."
        );
      }

      const excludedPath = this.#fileSystem
        .relativeSegments(root.path, worktree.path)
        .join("/");
      if (!excludedPath) {
        throw new WorkspaceError(
          "INVALID_REQUEST",
          "The Workspace root repository cannot be excluded independently."
        );
      }

      const alreadyExcluded = root.excludes.some(
        (value) =>
          value.toLocaleLowerCase() ===
          excludedPath.toLocaleLowerCase()
      );
      const nextRoot = alreadyExcluded
        ? root
        : {
            ...root,
            excludes: [...root.excludes, excludedPath]
          };
      const now = this.#clock();
      const scan = await this.#scanner.scanRoot(nextRoot, {
        scannedAt: now
      });
      const workspace = this.#assembler.assemble({
        current,
        scan,
        updatedAt: now
      });

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
      const groups = current.groups.map((group) => {
        if (group.id !== input.groupId) {
          return group;
        }
        groupFound = true;
        return {
          ...group,
          collapsed: input.collapsed
        };
      });

      if (!groupFound) {
        throw new WorkspaceError(
          "GROUP_NOT_FOUND",
          "The repository group no longer exists."
        );
      }

      const workspace: Workspace = {
        ...current,
        groups,
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

      const workspace: Workspace = {
        ...current,
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

function toWorkspaceRoot(
  workspace: Workspace
): WorkspaceRoot | undefined {
  return workspace.path && workspace.canonicalPath
    ? {
        path: workspace.path,
        canonicalPath: workspace.canonicalPath,
        excludes: [...workspace.excludes]
      }
    : undefined;
}

function isConfiguredWorkspace(workspace: Workspace): boolean {
  return Boolean(
    workspace.path &&
    workspace.canonicalPath &&
    workspace.lastScannedAt
  );
}

function isEmptyWorkspacePlaceholder(
  workspace: Workspace
): boolean {
  return (
    workspace.path === undefined &&
    workspace.canonicalPath === undefined &&
    workspace.lastScannedAt === undefined &&
    workspace.excludes.length === 0 &&
    workspace.groups.length === 0 &&
    workspace.scanIssues.length === 0 &&
    workspace.repositories.length === 0 &&
    workspace.worktrees.length === 0 &&
    workspace.selectedTarget === undefined
  );
}
