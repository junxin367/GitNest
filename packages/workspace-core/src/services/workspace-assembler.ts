import type {
  RepositoryGroup,
  RepositoryTarget,
  Workspace,
  WorkspaceRepository,
  WorkspaceRoot,
  WorkspaceWorktree
} from "../domain/workspace";
import type { WorkspaceFileSystem } from "../ports/workspace-filesystem";
import type {
  DiscoveredRepository,
  WorkspaceRootScan
} from "../discovery/workspace-scanner";
import { createPathIdentity } from "./path-identity";
import {
  getWorkspaceDefaultTarget,
  listWorkspaceTargets,
  repositoryTargetKey
} from "./workspace-targets";

export const DEFAULT_ROOT_REPOSITORY_GROUP_NAME = "原/根仓库";
const LEGACY_ROOT_REPOSITORY_GROUP_NAME = "根目录仓库";

export interface AssembleWorkspaceInput {
  current: Workspace;
  scan?: WorkspaceRootScan;
  scans?: readonly WorkspaceRootScan[];
  updatedAt: string;
}

export class WorkspaceAssembler {
  readonly #fileSystem: WorkspaceFileSystem;

  constructor(fileSystem: WorkspaceFileSystem) {
    this.#fileSystem = fileSystem;
  }

  assemble(input: AssembleWorkspaceInput): Workspace {
    const { current, updatedAt } = input;
    const scans = input.scans
      ? [...input.scans]
      : input.scan
        ? [input.scan]
        : [];
    if (scans.length === 0) {
      throw new Error(
        "Workspace assembly requires at least one root scan."
      );
    }
    const roots = scans.map((scan) => scan.root);
    const discoveriesByRoot = assignDiscoveriesToRoots(
      scans,
      this.#fileSystem
    );
    const repositoryRegistry = new Map<
      string,
      WorkspaceRepository
    >();
    const worktreeRegistry = new Map<string, WorkspaceWorktree>();
    const targetByDiscovery = new Map<
      DiscoveredRepository,
      RepositoryTarget
    >();

    for (const scan of scans) {
      const discoveries =
        discoveriesByRoot.get(scan.root.canonicalPath) ?? [];
      for (const discovery of discoveries) {
        targetByDiscovery.set(
          discovery,
          registerRepository(
            discovery,
            this.#fileSystem,
            repositoryRegistry,
            worktreeRegistry
          )
        );
      }

      if (isOfflineScan(scan)) {
        registerPreviousTopologyForRoot(
          current,
          scan.root,
          roots,
          this.#fileSystem,
          repositoryRegistry,
          worktreeRegistry
        );
      }
    }

    const groups = scans.flatMap((scan) => {
      if (isOfflineScan(scan)) {
        return preserveGroupsForRoot(
          current,
          scan.root,
          roots,
          this.#fileSystem
        );
      }
      return createGroups(
        scan.root,
        discoveriesByRoot.get(scan.root.canonicalPath) ?? [],
        targetByDiscovery,
        current.groups,
        scans.length,
        this.#fileSystem
      );
    });
    const root = scans[0]?.root as WorkspaceRoot;
    const additionalRoots = scans.slice(1).map((scan) => ({
      path: scan.root.path,
      canonicalPath: scan.root.canonicalPath,
      excludes: [...scan.root.excludes]
    }));
    const lastScannedAt = scans.reduce(
      (latest, scan) =>
        scan.scannedAt > latest ? scan.scannedAt : latest,
      scans[0]?.scannedAt ?? updatedAt
    );
    const {
      additionalRoots: _previousAdditionalRoots,
      ...currentBase
    } = current;
    const provisionalWorkspace: Workspace = {
      ...currentBase,
      path: root.path,
      canonicalPath: root.canonicalPath,
      excludes: [...root.excludes],
      ...(additionalRoots.length > 0
        ? { additionalRoots }
        : {}),
      groups,
      scanIssues: scans.flatMap((scan) => scan.issues),
      lastScannedAt,
      repositories: [...repositoryRegistry.values()],
      worktrees: [...worktreeRegistry.values()],
      updatedAt
    };
    const availableTargets = new Set(
      listWorkspaceTargets(provisionalWorkspace).map(
        repositoryTargetKey
      )
    );
    const selectedTarget =
      current.selectedTarget &&
      availableTargets.has(repositoryTargetKey(current.selectedTarget))
        ? current.selectedTarget
        : getWorkspaceDefaultTarget(provisionalWorkspace);
    const {
      selectedTarget: _previousSelectedTarget,
      ...workspaceBase
    } = provisionalWorkspace;

    return {
      ...workspaceBase,
      repositories: [...repositoryRegistry.values()].sort(
        (left, right) =>
          left.name.localeCompare(right.name, undefined, {
            sensitivity: "base"
          })
      ),
      worktrees: [...worktreeRegistry.values()].sort(
        (left, right) =>
          left.path.localeCompare(right.path, undefined, {
            sensitivity: "base"
          })
      ),
      ...(selectedTarget ? { selectedTarget } : {})
    };
  }
}

function assignDiscoveriesToRoots(
  scans: readonly WorkspaceRootScan[],
  fileSystem: WorkspaceFileSystem
): Map<string, DiscoveredRepository[]> {
  const roots = scans.map((scan) => scan.root);
  const assigned = new Map<
    string,
    Map<string, DiscoveredRepository>
  >(
    roots.map((root) => [
      root.canonicalPath,
      new Map<string, DiscoveredRepository>()
    ])
  );

  for (const scan of scans) {
    for (const discovery of scan.repositories) {
      const owner = findOwningRoot(
        roots,
        discovery.path,
        fileSystem
      );
      if (!owner) {
        continue;
      }
      const discoveries = assigned.get(owner.canonicalPath);
      const existing = discoveries?.get(discovery.canonicalPath);
      if (
        discoveries &&
        (!existing ||
          scan.root.canonicalPath === owner.canonicalPath)
      ) {
        discoveries.set(discovery.canonicalPath, discovery);
      }
    }
  }

  return new Map(
    [...assigned].map(([canonicalPath, discoveries]) => [
      canonicalPath,
      [...discoveries.values()]
    ])
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

function isOfflineScan(scan: WorkspaceRootScan): boolean {
  return (
    scan.repositories.length === 0 &&
    scan.issues.length > 0
  );
}

function registerPreviousTopologyForRoot(
  current: Workspace,
  root: WorkspaceRoot,
  roots: readonly WorkspaceRoot[],
  fileSystem: WorkspaceFileSystem,
  repositories: Map<string, WorkspaceRepository>,
  worktrees: Map<string, WorkspaceWorktree>
): void {
  const targetKeys = new Set(
    preserveGroupsForRoot(
      current,
      root,
      roots,
      fileSystem
    )
      .flatMap((group) => group.targets)
      .map(repositoryTargetKey)
  );
  const repositoryIds = new Set(
    current.worktrees
      .filter((worktree) =>
        targetKeys.has(
          repositoryTargetKey({
            repositoryId: worktree.repositoryId,
            worktreeId: worktree.id
          })
        )
      )
      .map((worktree) => worktree.repositoryId)
  );

  for (const repository of current.repositories) {
    if (repositoryIds.has(repository.id)) {
      repositories.set(repository.id, {
        ...repository,
        worktreeIds: [...repository.worktreeIds]
      });
    }
  }
  for (const worktree of current.worktrees) {
    if (repositoryIds.has(worktree.repositoryId)) {
      worktrees.set(worktree.id, { ...worktree });
    }
  }
}

function preserveGroupsForRoot(
  current: Workspace,
  root: WorkspaceRoot,
  roots: readonly WorkspaceRoot[],
  fileSystem: WorkspaceFileSystem
): RepositoryGroup[] {
  const worktreeByTarget = new Map(
    current.worktrees.map((worktree) => [
      repositoryTargetKey({
        repositoryId: worktree.repositoryId,
        worktreeId: worktree.id
      }),
      worktree
    ])
  );

  return current.groups.flatMap((group) => {
    const targets = group.targets.filter((target) => {
      const worktree = worktreeByTarget.get(
        repositoryTargetKey(target)
      );
      const owner = worktree
        ? findOwningRoot(roots, worktree.path, fileSystem)
        : undefined;
      return owner?.canonicalPath === root.canonicalPath;
    });
    return targets.length > 0
      ? [
          {
            ...group,
            targets: targets.map((target) => ({ ...target }))
          }
        ]
      : [];
  });
}

function registerRepository(
  discovery: DiscoveredRepository,
  fileSystem: WorkspaceFileSystem,
  repositories: Map<string, WorkspaceRepository>,
  worktrees: Map<string, WorkspaceWorktree>
): RepositoryTarget {
  const normalizedCommonDir = fileSystem.normalizePath(
    discovery.repository.commonDir
  );
  const repositoryId = createPathIdentity(
    "repository",
    normalizedCommonDir.canonicalPath
  );
  const probeWorktrees = [...discovery.repository.worktrees];
  const normalizedIdentityPath = fileSystem.normalizePath(
    discovery.repository.worktreePath
  );

  if (
    !probeWorktrees.some(
      (worktree) =>
        fileSystem.normalizePath(worktree.path).canonicalPath ===
        normalizedIdentityPath.canonicalPath
    )
  ) {
    probeWorktrees.push({
      path: normalizedIdentityPath.path,
      head: discovery.repository.head,
      ...(discovery.repository.branch
        ? { branch: discovery.repository.branch }
        : {}),
      gitDir: discovery.repository.gitDir,
      primary: probeWorktrees.length === 0,
      bare: false,
      detached: !discovery.repository.branch,
      locked: false,
      prunable: false
    });
  }

  const worktreeIds: string[] = [];
  let primaryWorktreeId: string | undefined;
  let primaryWorktreeName: string | undefined;

  for (const probedWorktree of probeWorktrees) {
    const normalizedWorktree = fileSystem.normalizePath(
      probedWorktree.path
    );
    const worktreeId = createPathIdentity(
      "worktree",
      normalizedWorktree.canonicalPath
    );
    const identityWorktree =
      normalizedWorktree.canonicalPath ===
      normalizedIdentityPath.canonicalPath;
    const existing = worktrees.get(worktreeId);
    const worktree: WorkspaceWorktree = {
      id: worktreeId,
      repositoryId,
      name: fileSystem.basename(normalizedWorktree.path),
      path: normalizedWorktree.path,
      canonicalPath: normalizedWorktree.canonicalPath,
      ...(probedWorktree.gitDir
        ? { gitDir: probedWorktree.gitDir }
        : identityWorktree
          ? { gitDir: discovery.repository.gitDir }
          : {}),
      head: probedWorktree.head,
      ...(probedWorktree.branch
        ? { branch: probedWorktree.branch }
        : {}),
      isPrimary: probedWorktree.primary,
      isBare: probedWorktree.bare,
      isDetached: probedWorktree.detached,
      isLocked: probedWorktree.locked,
      ...(probedWorktree.lockReason
        ? { lockReason: probedWorktree.lockReason }
        : {}),
      isPrunable: probedWorktree.prunable,
      ...(probedWorktree.pruneReason
        ? { pruneReason: probedWorktree.pruneReason }
        : {})
    };

    worktrees.set(worktreeId, {
      ...existing,
      ...worktree,
      ...(existing?.gitDir && !worktree.gitDir
        ? { gitDir: existing.gitDir }
        : {})
    });
    worktreeIds.push(worktreeId);

    if (probedWorktree.primary) {
      primaryWorktreeId = worktreeId;
      primaryWorktreeName = worktree.name;
    }
  }

  const existingRepository = repositories.get(repositoryId);
  const repository: WorkspaceRepository = {
    id: repositoryId,
    name:
      primaryWorktreeName ??
      existingRepository?.name ??
      fileSystem.basename(normalizedIdentityPath.path),
    commonDir: normalizedCommonDir.path,
    canonicalCommonDir: normalizedCommonDir.canonicalPath,
    ...(primaryWorktreeId
      ? { primaryWorktreeId }
      : existingRepository?.primaryWorktreeId
        ? {
            primaryWorktreeId:
              existingRepository.primaryWorktreeId
          }
        : {}),
    worktreeIds: [
      ...new Set([
        ...(existingRepository?.worktreeIds ?? []),
        ...worktreeIds
      ])
    ]
  };
  repositories.set(repositoryId, repository);

  return {
    repositoryId,
    worktreeId: createPathIdentity(
      "worktree",
      normalizedIdentityPath.canonicalPath
    )
  };
}

function createGroups(
  root: WorkspaceRoot,
  repositories: DiscoveredRepository[],
  targets: Map<DiscoveredRepository, RepositoryTarget>,
  previousGroups: RepositoryGroup[],
  rootCount: number,
  fileSystem: WorkspaceFileSystem
): RepositoryGroup[] {
  const collapsedById = new Map(
    previousGroups.map((group) => [group.id, group.collapsed])
  );
  const grouped = new Map<
    string,
    { name: string; targets: RepositoryTarget[] }
  >();

  for (const discovery of repositories) {
    const groupName =
      discovery.relativeSegments.length <= 1
        ? DEFAULT_ROOT_REPOSITORY_GROUP_NAME
        : (discovery.relativeSegments[0] as string);
    const groupKey = groupName.toLocaleLowerCase();
    const group = grouped.get(groupKey) ?? {
      name: groupName,
      targets: []
    };
    const target = targets.get(discovery);

    if (
      target &&
      !group.targets.some(
        (existing) =>
          repositoryTargetKey(existing) ===
          repositoryTargetKey(target)
      )
    ) {
      group.targets.push(target);
    }

    grouped.set(groupKey, group);
  }

  return [...grouped.values()]
    .sort((left, right) => {
      if (left.name === DEFAULT_ROOT_REPOSITORY_GROUP_NAME) {
        return -1;
      }
      if (right.name === DEFAULT_ROOT_REPOSITORY_GROUP_NAME) {
        return 1;
      }
      return left.name.localeCompare(right.name, undefined, {
        sensitivity: "base"
      });
    })
    .map((group) => {
      const id = createPathIdentity(
        "group",
        `${root.canonicalPath}\0${group.name.toLocaleLowerCase()}`
      );
      const legacyId =
        group.name === DEFAULT_ROOT_REPOSITORY_GROUP_NAME
          ? createPathIdentity(
              "group",
              `${root.canonicalPath}\0${LEGACY_ROOT_REPOSITORY_GROUP_NAME.toLocaleLowerCase()}`
            )
          : undefined;
      return {
        id,
        name:
          rootCount > 1
            ? group.name === DEFAULT_ROOT_REPOSITORY_GROUP_NAME
              ? fileSystem.basename(root.path) || root.path
              : `${fileSystem.basename(root.path) || root.path} / ${group.name}`
            : group.name,
        targets: group.targets,
        collapsed:
          collapsedById.get(id) ??
          (legacyId ? collapsedById.get(legacyId) : undefined) ??
          false
      };
    });
}
