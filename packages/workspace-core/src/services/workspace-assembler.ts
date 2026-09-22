import type {
  RepositoryGroup,
  RepositoryTarget,
  Workspace,
  WorkspaceEntry,
  WorkspaceRepository,
  WorkspaceRootDefinition,
  WorkspaceWorktree
} from "../domain/workspace";
import type { WorkspaceFileSystem } from "../ports/workspace-filesystem";
import type {
  DiscoveredRepository,
  WorkspaceRootScan
} from "../discovery/workspace-scanner";
import { createPathIdentity } from "./path-identity";
import {
  getEntryDefaultTarget,
  listEntryTargets,
  listWorkspaceTargets,
  repositoryTargetKey
} from "./workspace-targets";

export const DEFAULT_ROOT_REPOSITORY_GROUP_NAME = "原/根仓库";
const LEGACY_ROOT_REPOSITORY_GROUP_NAME = "根目录仓库";

interface OwnedRepository {
  rootId: string;
  discovery: DiscoveredRepository;
}

interface DiscoveryOccurrence {
  rootId: string;
  discovery: DiscoveredRepository;
}

export interface AssembleWorkspaceInput {
  current: Workspace;
  roots: WorkspaceRootDefinition[];
  scans: WorkspaceRootScan[];
  updatedAt: string;
}

export class WorkspaceAssembler {
  readonly #fileSystem: WorkspaceFileSystem;

  constructor(fileSystem: WorkspaceFileSystem) {
    this.#fileSystem = fileSystem;
  }

  assemble({
    current,
    roots,
    scans,
    updatedAt
  }: AssembleWorkspaceInput): Workspace {
    const scansByRoot = new Map(
      scans.map((scan) => [scan.root.id, scan])
    );
    const previousEntries = new Map(
      current.entries.map((entry) => [entry.id, entry])
    );
    const ownedRepositories = selectOwnedRepositories(
      roots,
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

    for (const owned of ownedRepositories) {
      const target = registerRepository(
        owned.discovery,
        this.#fileSystem,
        repositoryRegistry,
        worktreeRegistry
      );
      targetByDiscovery.set(owned.discovery, target);
    }

    const entries: WorkspaceEntry[] = [];

    for (const root of [...roots].sort(compareRootOrder)) {
      const scan = scansByRoot.get(root.id);
      const previous = previousEntries.get(root.id);

      if (!scan) {
        if (previous) {
          entries.push(previous);
          registerPreviousEntryData(
            previous,
            current,
            repositoryRegistry,
            worktreeRegistry
          );
        }
        continue;
      }

      const owned = ownedRepositories.filter(
        (candidate) => candidate.rootId === root.id
      );

      if (
        scan.repositories.length === 0 &&
        scan.issues.length > 0 &&
        previous
      ) {
        entries.push({
          ...previous,
          scanIssues: scan.issues,
          lastScannedAt: scan.scannedAt
        });
        registerPreviousEntryData(
          previous,
          current,
          repositoryRegistry,
          worktreeRegistry
        );
        continue;
      }

      const rootRepository = owned.find(
        ({ discovery }) =>
          discovery.canonicalPath === root.canonicalPath
      );
      const descendants = owned.filter(
        ({ discovery }) =>
          discovery.canonicalPath !== root.canonicalPath
      );
      const groupedRepositories =
        rootRepository && descendants.length > 0
          ? [rootRepository, ...descendants]
          : descendants;
      const groups = createGroups(
        root,
        groupedRepositories,
        targetByDiscovery,
        previous?.groups ?? []
      );
      const base = {
        id: root.id,
        displayName: root.displayName,
        path: root.path,
        canonicalPath: root.canonicalPath,
        excludes: [...root.excludes],
        order: root.order,
        groups,
        scanIssues: scan.issues,
        lastScannedAt: scan.scannedAt
      };

      if (rootRepository && descendants.length > 0) {
        entries.push({
          ...base,
          kind: "workspace-meta-repository",
          rootTarget: targetByDiscovery.get(
            rootRepository.discovery
          ) as RepositoryTarget
        });
      } else if (rootRepository) {
        entries.push({
          ...base,
          kind: "standalone-repository",
          target: targetByDiscovery.get(
            rootRepository.discovery
          ) as RepositoryTarget
        });
      } else {
        entries.push({
          ...base,
          kind: "workspace-directory"
        });
      }
    }

    const sortedEntries = entries
      .sort(compareRootOrder)
      .map((entry, order) => ({ ...entry, order }));
    const selectedEntryId =
      current.selectedEntryId &&
      sortedEntries.some(
        (entry) => entry.id === current.selectedEntryId
      )
        ? current.selectedEntryId
        : sortedEntries[0]?.id;
    const provisionalWorkspace: Workspace = {
      ...current,
      entries: sortedEntries,
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
        : getEntryDefaultTarget(
            sortedEntries.find(
              (entry) => entry.id === selectedEntryId
            )
          );
    const {
      selectedEntryId: _previousSelectedEntryId,
      selectedTarget: _previousSelectedTarget,
      ...workspaceBase
    } = current;

    return {
      ...workspaceBase,
      entries: sortedEntries,
      repositories: [...repositoryRegistry.values()].sort((left, right) =>
        left.name.localeCompare(right.name, undefined, {
          sensitivity: "base"
        })
      ),
      worktrees: [...worktreeRegistry.values()].sort((left, right) =>
        left.path.localeCompare(right.path, undefined, {
          sensitivity: "base"
        })
      ),
      ...(selectedEntryId ? { selectedEntryId } : {}),
      ...(selectedTarget ? { selectedTarget } : {}),
      updatedAt
    };
  }
}

function selectOwnedRepositories(
  roots: WorkspaceRootDefinition[],
  scans: WorkspaceRootScan[],
  fileSystem: WorkspaceFileSystem
): OwnedRepository[] {
  const occurrences = new Map<string, DiscoveryOccurrence[]>();
  for (const scan of scans) {
    for (const discovery of scan.repositories) {
      const matches =
        occurrences.get(discovery.canonicalPath) ?? [];
      matches.push({
        rootId: scan.root.id,
        discovery
      });
      occurrences.set(discovery.canonicalPath, matches);
    }
  }

  return [...occurrences.values()].map((matches) => {
    const first = matches[0] as DiscoveryOccurrence;
    const owner = selectMostSpecificRoot(
      roots,
      first.discovery.path,
      fileSystem
    );
    const ownedOccurrence =
      matches.find((match) => match.rootId === owner.id) ?? first;

    return {
      rootId: owner.id,
      discovery: ownedOccurrence.discovery
    };
  });
}

function selectMostSpecificRoot(
  roots: WorkspaceRootDefinition[],
  repositoryPath: string,
  fileSystem: WorkspaceFileSystem
): WorkspaceRootDefinition {
  const candidates = roots
    .filter((root) =>
      fileSystem.isWithin(root.path, repositoryPath)
    )
    .sort((left, right) => {
      const depth =
        fileSystem.pathDepth(right.path) -
        fileSystem.pathDepth(left.path);
      return depth || compareRootOrder(left, right);
    });

  return candidates[0] as WorkspaceRootDefinition;
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

  const uniqueWorktreeIds = [...new Set(worktreeIds)];
  const existingRepository = repositories.get(repositoryId);
  const identityName = fileSystem.basename(normalizedIdentityPath.path);
  const repository: WorkspaceRepository = {
    id: repositoryId,
    // 共享同一 Git common directory 的多个 Worktree 会归入同一仓库实例，
    // 仓库名只能由主 Worktree 决定，否则会被后处理的 linked Worktree 覆盖。
    name:
      primaryWorktreeName ??
      existingRepository?.name ??
      identityName,
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
        ...uniqueWorktreeIds
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
  root: WorkspaceRootDefinition,
  repositories: OwnedRepository[],
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

  for (const { discovery } of repositories) {
    const relativeSegments = discovery.relativeSegments;
    const groupName =
      relativeSegments.length <= 1
        ? DEFAULT_ROOT_REPOSITORY_GROUP_NAME
        : (relativeSegments[0] as string);
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
          existing.repositoryId === target.repositoryId &&
          existing.worktreeId === target.worktreeId
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

function registerPreviousEntryData(
  entry: WorkspaceEntry,
  current: Workspace,
  repositories: Map<string, WorkspaceRepository>,
  worktrees: Map<string, WorkspaceWorktree>
): void {
  const targets = listEntryTargets(entry);

  for (const target of targets) {
    const repository = current.repositories.find(
      (candidate) => candidate.id === target.repositoryId
    );

    if (repository) {
      repositories.set(repository.id, repository);

      for (const worktreeId of repository.worktreeIds) {
        const worktree = current.worktrees.find(
          (candidate) => candidate.id === worktreeId
        );
        if (worktree) {
          worktrees.set(worktree.id, worktree);
        }
      }
    }
  }
}

function compareRootOrder(
  left: Pick<WorkspaceRootDefinition, "order" | "path">,
  right: Pick<WorkspaceRootDefinition, "order" | "path">
): number {
  return (
    left.order - right.order ||
    left.path.localeCompare(right.path, undefined, {
      sensitivity: "base"
    })
  );
}
