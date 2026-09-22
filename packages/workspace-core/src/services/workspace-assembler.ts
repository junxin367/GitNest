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
  scan: WorkspaceRootScan;
  updatedAt: string;
}

export class WorkspaceAssembler {
  readonly #fileSystem: WorkspaceFileSystem;

  constructor(fileSystem: WorkspaceFileSystem) {
    this.#fileSystem = fileSystem;
  }

  assemble({
    current,
    scan,
    updatedAt
  }: AssembleWorkspaceInput): Workspace {
    const root = scan.root;

    if (
      scan.repositories.length === 0 &&
      scan.issues.length > 0 &&
      current.path
    ) {
      return {
        ...current,
        path: root.path,
        canonicalPath: root.canonicalPath,
        excludes: [...root.excludes],
        scanIssues: scan.issues,
        lastScannedAt: scan.scannedAt,
        updatedAt
      };
    }

    const repositoryRegistry = new Map<
      string,
      WorkspaceRepository
    >();
    const worktreeRegistry = new Map<string, WorkspaceWorktree>();
    const targetByDiscovery = new Map<
      DiscoveredRepository,
      RepositoryTarget
    >();

    for (const discovery of scan.repositories) {
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

    const groups = createGroups(
      root,
      scan.repositories,
      targetByDiscovery,
      current.groups
    );
    const provisionalWorkspace: Workspace = {
      ...current,
      path: root.path,
      canonicalPath: root.canonicalPath,
      excludes: [...root.excludes],
      groups,
      scanIssues: scan.issues,
      lastScannedAt: scan.scannedAt,
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
  previousGroups: RepositoryGroup[]
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
        name: group.name,
        targets: group.targets,
        collapsed:
          collapsedById.get(id) ??
          (legacyId ? collapsedById.get(legacyId) : undefined) ??
          false
      };
    });
}
