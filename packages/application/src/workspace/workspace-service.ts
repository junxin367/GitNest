import type { GitTopologyClient } from "@gitnest/git-core";
import {
  WorkspaceAssembler,
  WorkspaceError,
  WorkspaceScanner,
  createEmptyWorkspace,
  listWorkspaceRoots,
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

export interface AddWorkspaceDirectoryInput {
  path: string;
}

export interface AddWorkspaceDirectoryResult {
  workspace: Workspace;
  duplicate: boolean;
}

interface WorkspaceServiceOptions {
  clock?: () => string;
}

type WorkspaceRescanCommit = (
  commit: () => Promise<Workspace>
) => Promise<Workspace>;

export class WorkspaceService {
  readonly #fileSystem: WorkspaceFileSystem;
  readonly #store: WorkspaceStore;
  readonly #scanner: WorkspaceScanner;
  readonly #assembler: WorkspaceAssembler;
  readonly #clock: () => string;
  #workspace: Workspace | undefined;
  #topologyRevision = 0;
  #rescanGeneration = 0;
  #queue: Promise<void> = Promise.resolve();

  constructor(
    gitClient: GitTopologyClient,
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
      assertRootContainsRepositories(scan);

      const workspace = this.#assembler.assemble({
        current,
        scans: [scan],
        updatedAt: now
      });
      await this.#save(workspace);
      this.#topologyRevision += 1;
      return workspace;
    });
  }

  addDirectory(
    input: AddWorkspaceDirectoryInput
  ): Promise<AddWorkspaceDirectoryResult> {
    return this.#runExclusive(async () => {
      const current = await this.#loadWorkspace();
      const normalized = this.#fileSystem.normalizePath(input.path);
      const roots = listWorkspaceRoots(current);
      if (
        roots.some(
          (root) =>
            root.canonicalPath === normalized.canonicalPath
        )
      ) {
        return {
          workspace: current,
          duplicate: true
        };
      }

      const root: WorkspaceRoot = {
        path: normalized.path,
        canonicalPath: normalized.canonicalPath,
        excludes: []
      };
      const now = this.#clock();
      const scan = await this.#scanner.scanRoot(root, {
        scannedAt: now
      });
      assertRootContainsRepositories(scan);
      const scans = await this.#scanRoots(roots, now);
      scans.push(scan);
      const workspace = this.#assembler.assemble({
        current,
        scans,
        updatedAt: now
      });

      await this.#save(workspace);
      this.#topologyRevision += 1;
      return {
        workspace,
        duplicate: false
      };
    });
  }

  async rescan(
    signal?: AbortSignal,
    runCommit: WorkspaceRescanCommit = (commit) => commit()
  ): Promise<Workspace> {
    // Capture only immutable scan inputs under the queue. Git and file-system
    // discovery stays outside it so selection and presentation updates remain responsive.
    const request = await this.#runExclusive(async () => {
      const current = await this.#loadWorkspace();
      return {
        workspaceId: current.id,
        roots: listWorkspaceRoots(current),
        topologyRevision: this.#topologyRevision,
        generation: ++this.#rescanGeneration,
        scannedAt: this.#clock()
      };
    });
    const scans =
      request.roots.length > 0
        ? await this.#scanRoots(
            request.roots,
            request.scannedAt,
            signal
          )
        : [];

    return runCommit(() =>
      this.#runExclusive(async () => {
        // A newer scan or topology edit makes these discoveries stale. Selection
        // and group state are safe to merge from the latest Workspace document.
        assertNotCancelled(signal);
        const current = await this.#loadWorkspace();
        if (
          scans.length === 0 ||
          current.id !== request.workspaceId ||
          request.generation !== this.#rescanGeneration ||
          request.topologyRevision !== this.#topologyRevision ||
          !workspaceRootsEqual(
            request.roots,
            listWorkspaceRoots(current)
          )
        ) {
          return current;
        }

        const workspace = this.#assembler.assemble({
          current,
          scans,
          updatedAt: latestTimestamp(
            current.updatedAt,
            this.#clock()
          )
        });

        await this.#save(workspace);
        return workspace;
      })
    );
  }

  excludeRepository(
    input: ExcludeWorkspaceRepositoryInput
  ): Promise<Workspace> {
    return this.#runExclusive(async () => {
      const current = await this.#loadWorkspace();
      const roots = listWorkspaceRoots(current);
      if (roots.length === 0) {
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
      const root = findOwningRoot(
        roots,
        worktree.path,
        this.#fileSystem
      );
      if (!root) {
        throw new WorkspaceError(
          "INVALID_REQUEST",
          "The repository is outside the Workspace roots."
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
      const nextRoot: WorkspaceRoot = alreadyExcluded
        ? root
        : {
            ...root,
            excludes: [...root.excludes, excludedPath]
          };
      const now = this.#clock();
      const scans = await this.#scanRoots(
        roots.map((candidate) =>
          candidate.canonicalPath === root.canonicalPath
            ? nextRoot
            : candidate
        ),
        now
      );
      const workspace = this.#assembler.assemble({
        current,
        scans,
        updatedAt: now
      });

      await this.#save(workspace);
      this.#topologyRevision += 1;
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

  async #scanRoots(
    roots: readonly WorkspaceRoot[],
    scannedAt: string,
    signal?: AbortSignal
  ) {
    const scans = [];
    for (const root of roots) {
      scans.push(
        await this.#scanner.scanRoot(root, {
          scannedAt,
          ...(signal ? { signal } : {})
        })
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

function assertRootContainsRepositories(
  scan: Awaited<ReturnType<WorkspaceScanner["scanRoot"]>>
): void {
  if (scan.repositories.length > 0) {
    return;
  }
  const rootIssue = scan.issues[0];
  if (rootIssue) {
    throw new WorkspaceError(
      "DIRECTORY_UNAVAILABLE",
      rootIssue.message,
      {
        path: scan.root.path,
        issueCount: scan.issues.length
      }
    );
  }
  throw new WorkspaceError(
    "NO_REPOSITORIES_FOUND",
    "No Git repositories were found in the selected directory.",
    { path: scan.root.path }
  );
}

function findOwningRoot(
  roots: readonly WorkspaceRoot[],
  path: string,
  fileSystem: WorkspaceFileSystem
): WorkspaceRoot | undefined {
  return roots
    .filter((root) => fileSystem.isWithin(root.path, path))
    .sort(
      (left, right) =>
        right.canonicalPath.length - left.canonicalPath.length
    )[0];
}

function isConfiguredWorkspace(workspace: Workspace): boolean {
  return Boolean(
    listWorkspaceRoots(workspace).length > 0 &&
    workspace.lastScannedAt
  );
}

function isEmptyWorkspacePlaceholder(
  workspace: Workspace
): boolean {
  return (
    workspace.path === undefined &&
    workspace.canonicalPath === undefined &&
    (workspace.additionalRoots?.length ?? 0) === 0 &&
    workspace.lastScannedAt === undefined &&
    workspace.excludes.length === 0 &&
    workspace.groups.length === 0 &&
    workspace.scanIssues.length === 0 &&
    workspace.repositories.length === 0 &&
    workspace.worktrees.length === 0 &&
    workspace.selectedTarget === undefined
  );
}

function workspaceRootsEqual(
  left: readonly WorkspaceRoot[],
  right: readonly WorkspaceRoot[]
): boolean {
  return (
    left.length === right.length &&
    left.every((root, index) => {
      const candidate = right[index];
      return Boolean(
        candidate &&
        root.path === candidate.path &&
        root.canonicalPath === candidate.canonicalPath &&
        root.excludes.length === candidate.excludes.length &&
        root.excludes.every(
          (exclude, excludeIndex) =>
            exclude === candidate.excludes[excludeIndex]
        )
      );
    })
  );
}

function latestTimestamp(left: string, right: string): string {
  return left > right ? left : right;
}

function assertNotCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  throw new WorkspaceError(
    "SCAN_CANCELLED",
    "Workspace 扫描已取消。"
  );
}
