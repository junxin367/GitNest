import {
  DEFAULT_ROOT_REPOSITORY_GROUP_NAME,
  WORKSPACE_SCHEMA_VERSION,
  WorkspaceError,
  createPathIdentity,
  listWorkspaceTargets,
  repositoryTargetKey,
  type RepositoryGroup,
  type RepositoryTarget,
  type Workspace,
  type WorkspaceEntry,
  type WorkspaceRepository,
  type WorkspaceScanIssue,
  type WorkspaceWorktree
} from "@gitnest/workspace-core";

const LEGACY_ROOT_REPOSITORY_GROUP_NAME = "根目录仓库";

export function migrateWorkspaceDocument(value: unknown): Workspace {
  const migrated = migrateLegacyWorkspaceDocument(value);
  if (!isRecord(migrated)) {
    throw invalidDocument();
  }

  if (migrated.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    throw new WorkspaceError(
      "INVALID_PERSISTED_DATA",
      `Unsupported Workspace schema version: ${String(migrated.schemaVersion)}.`
    );
  }

  if (
    !isNonEmptyString(migrated.id) ||
    !isNonEmptyString(migrated.name) ||
    !isTimestamp(migrated.updatedAt) ||
    !Array.isArray(migrated.entries) ||
    !Array.isArray(migrated.repositories) ||
    !Array.isArray(migrated.worktrees) ||
    !migrated.entries.every(isWorkspaceEntry) ||
    !migrated.repositories.every(isWorkspaceRepository) ||
    !migrated.worktrees.every(isWorkspaceWorktree) ||
    (migrated.selectedEntryId !== undefined &&
      !isNonEmptyString(migrated.selectedEntryId)) ||
    (migrated.selectedTarget !== undefined &&
      !isRepositoryTarget(migrated.selectedTarget))
  ) {
    throw invalidDocument();
  }

  const workspace = rebuildWorkspaceDocument(migrated);
  assertWorkspaceRelationships(workspace);
  return workspace;
}

function migrateLegacyWorkspaceDocument(
  value: unknown
): unknown {
  if (!isRecord(value) || value.schemaVersion !== 0) {
    return value;
  }
  if (
    !Array.isArray(value.entries) ||
    !Array.isArray(value.worktrees)
  ) {
    throw invalidDocument();
  }
  return {
    ...value,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    entries: value.entries.map((entry) => {
      if (!isRecord(entry)) {
        return entry;
      }
      return {
        ...entry,
        scanIssues: Array.isArray(entry.scanIssues)
          ? entry.scanIssues
          : [],
        groups: Array.isArray(entry.groups)
          ? entry.groups.map((group) =>
              isRecord(group)
                ? {
                    ...group,
                    collapsed:
                      typeof group.collapsed === "boolean"
                        ? group.collapsed
                        : false
                  }
                : group
            )
          : entry.groups
      };
    }),
    worktrees: value.worktrees.map((worktree) => {
      if (!isRecord(worktree)) {
        return worktree;
      }
      const branch =
        typeof worktree.branch === "string"
          ? worktree.branch
          : undefined;
      return {
        ...worktree,
        isDetached:
          typeof worktree.isDetached === "boolean"
            ? worktree.isDetached
            : !branch && worktree.isBare !== true,
        isLocked:
          typeof worktree.isLocked === "boolean"
            ? worktree.isLocked
            : false,
        isPrunable:
          typeof worktree.isPrunable === "boolean"
            ? worktree.isPrunable
            : false
      };
    })
  };
}

function isWorkspaceEntry(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.displayName) ||
    !isNonEmptyString(value.path) ||
    !isNonEmptyString(value.canonicalPath) ||
    !isNonNegativeInteger(value.order) ||
    !isTimestamp(value.lastScannedAt) ||
    !Array.isArray(value.excludes) ||
    !value.excludes.every((item) => typeof item === "string") ||
    !Array.isArray(value.groups) ||
    !value.groups.every(isRepositoryGroup) ||
    !Array.isArray(value.scanIssues) ||
    !value.scanIssues.every(isWorkspaceScanIssue)
  ) {
    return false;
  }

  if (value.kind === "workspace-meta-repository") {
    return isRepositoryTarget(value.rootTarget);
  }

  if (value.kind === "standalone-repository") {
    return isRepositoryTarget(value.target);
  }

  return value.kind === "workspace-directory";
}

function isWorkspaceScanIssue(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.path) &&
    typeof value.code === "string" &&
    [
      "DIRECTORY_UNAVAILABLE",
      "PERMISSION_DENIED",
      "REPOSITORY_UNAVAILABLE",
      "OUTSIDE_ROOT_LINK_SKIPPED",
      "SYMLINK_LOOP_SKIPPED"
    ].includes(value.code) &&
    isNonEmptyString(value.message)
  );
}

function isRepositoryGroup(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    typeof value.collapsed === "boolean" &&
    Array.isArray(value.targets) &&
    value.targets.every(isRepositoryTarget)
  );
}

function isRepositoryTarget(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.repositoryId) &&
    isNonEmptyString(value.worktreeId)
  );
}

function isWorkspaceRepository(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    typeof value.name === "string" &&
    isNonEmptyString(value.commonDir) &&
    isNonEmptyString(value.canonicalCommonDir) &&
    Array.isArray(value.worktreeIds) &&
    value.worktreeIds.every((item) => typeof item === "string") &&
    (value.primaryWorktreeId === undefined ||
      isNonEmptyString(value.primaryWorktreeId))
  );
}

function isWorkspaceWorktree(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.repositoryId) &&
    typeof value.name === "string" &&
    isNonEmptyString(value.path) &&
    isNonEmptyString(value.canonicalPath) &&
    typeof value.head === "string" &&
    typeof value.isPrimary === "boolean" &&
    typeof value.isBare === "boolean" &&
    typeof value.isDetached === "boolean" &&
    typeof value.isLocked === "boolean" &&
    typeof value.isPrunable === "boolean" &&
    (value.gitDir === undefined ||
      isNonEmptyString(value.gitDir)) &&
    (value.branch === undefined ||
      isNonEmptyString(value.branch)) &&
    (value.lockReason === undefined ||
      isNonEmptyString(value.lockReason)) &&
    (value.pruneReason === undefined ||
      isNonEmptyString(value.pruneReason))
  );
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function rebuildWorkspaceDocument(
  value: Record<string, unknown>
): Workspace {
  const entries = (
    value.entries as WorkspaceEntry[]
  ).map(rebuildWorkspaceEntry);
  const repositories = (
    value.repositories as WorkspaceRepository[]
  ).map((repository) => ({
    id: repository.id,
    name: repository.name,
    commonDir: repository.commonDir,
    canonicalCommonDir: repository.canonicalCommonDir,
    ...(repository.primaryWorktreeId
      ? {
          primaryWorktreeId:
            repository.primaryWorktreeId
        }
      : {}),
    worktreeIds: [...repository.worktreeIds]
  }));
  const worktrees = (
    value.worktrees as WorkspaceWorktree[]
  ).map((worktree) => ({
    id: worktree.id,
    repositoryId: worktree.repositoryId,
    name: worktree.name,
    path: worktree.path,
    canonicalPath: worktree.canonicalPath,
    ...(worktree.gitDir
      ? { gitDir: worktree.gitDir }
      : {}),
    head: worktree.head,
    ...(worktree.branch
      ? { branch: worktree.branch }
      : {}),
    isPrimary: worktree.isPrimary,
    isBare: worktree.isBare,
    isDetached: worktree.isDetached,
    isLocked: worktree.isLocked,
    ...(worktree.lockReason
      ? { lockReason: worktree.lockReason }
      : {}),
    isPrunable: worktree.isPrunable,
    ...(worktree.pruneReason
      ? { pruneReason: worktree.pruneReason }
      : {})
  }));
  const selectedTarget = value.selectedTarget as
    | Workspace["selectedTarget"]
    | undefined;
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    id: value.id as string,
    name: value.name as string,
    entries,
    repositories,
    worktrees,
    ...(typeof value.selectedEntryId === "string"
      ? { selectedEntryId: value.selectedEntryId }
      : {}),
    ...(selectedTarget
      ? {
          selectedTarget: {
            repositoryId: selectedTarget.repositoryId,
            worktreeId: selectedTarget.worktreeId
          }
        }
      : {}),
    updatedAt: value.updatedAt as string
  };
}

function rebuildWorkspaceEntry(
  entry: WorkspaceEntry
): WorkspaceEntry {
  const base = {
    id: entry.id,
    displayName: entry.displayName,
    path: entry.path,
    canonicalPath: entry.canonicalPath,
    excludes: [...entry.excludes],
    order: entry.order,
    groups: normalizeRepositoryGroups(entry),
    scanIssues: entry.scanIssues.map(
      (issue): WorkspaceScanIssue => ({
        path: issue.path,
        code: issue.code,
        message: issue.message
      })
    ),
    lastScannedAt: entry.lastScannedAt
  };
  if (entry.kind === "workspace-meta-repository") {
    return {
      ...base,
      kind: entry.kind,
      rootTarget: {
        repositoryId: entry.rootTarget.repositoryId,
        worktreeId: entry.rootTarget.worktreeId
      }
    };
  }
  if (entry.kind === "standalone-repository") {
    return {
      ...base,
      kind: entry.kind,
      target: {
        repositoryId: entry.target.repositoryId,
        worktreeId: entry.target.worktreeId
      }
    };
  }
  return {
    ...base,
    kind: "workspace-directory"
  };
}

function normalizeRepositoryGroups(
  entry: WorkspaceEntry
): RepositoryGroup[] {
  const groups = entry.groups.map(rebuildRepositoryGroup);

  if (entry.kind === "standalone-repository") {
    return [];
  }

  const defaultGroup = groups.find(
    (group) =>
      group.name === DEFAULT_ROOT_REPOSITORY_GROUP_NAME ||
      group.name === LEGACY_ROOT_REPOSITORY_GROUP_NAME
  );

  if (defaultGroup) {
    defaultGroup.name = DEFAULT_ROOT_REPOSITORY_GROUP_NAME;
    if (entry.kind === "workspace-meta-repository") {
      appendTarget(defaultGroup.targets, entry.rootTarget);
    }
    return groups;
  }

  if (entry.kind !== "workspace-meta-repository") {
    return groups;
  }

  groups.unshift({
    id: createPathIdentity(
      "group",
      `${entry.canonicalPath}\0${DEFAULT_ROOT_REPOSITORY_GROUP_NAME.toLocaleLowerCase()}`
    ),
    name: DEFAULT_ROOT_REPOSITORY_GROUP_NAME,
    targets: [entry.rootTarget],
    collapsed: false
  });
  return groups;
}

function appendTarget(
  targets: RepositoryTarget[],
  target: RepositoryTarget
): void {
  if (
    !targets.some(
      (candidate) =>
        repositoryTargetKey(candidate) ===
        repositoryTargetKey(target)
    )
  ) {
    targets.push({
      repositoryId: target.repositoryId,
      worktreeId: target.worktreeId
    });
  }
}

function rebuildRepositoryGroup(
  group: RepositoryGroup
): RepositoryGroup {
  return {
    id: group.id,
    name: group.name,
    targets: group.targets.map((target) => ({
      repositoryId: target.repositoryId,
      worktreeId: target.worktreeId
    })),
    collapsed: group.collapsed
  };
}

function assertWorkspaceRelationships(
  workspace: Workspace
): void {
  if (
    hasDuplicates(workspace.entries.map((entry) => entry.id)) ||
    hasDuplicates(
      workspace.repositories.map(
        (repository) => repository.id
      )
    ) ||
    hasDuplicates(
      workspace.worktrees.map((worktree) => worktree.id)
    )
  ) {
    throw invalidDocument();
  }
  const repositories = new Map(
    workspace.repositories.map((repository) => [
      repository.id,
      repository
    ])
  );
  const worktrees = new Map(
    workspace.worktrees.map((worktree) => [
      worktree.id,
      worktree
    ])
  );
  for (const worktree of workspace.worktrees) {
    if (!repositories.has(worktree.repositoryId)) {
      throw invalidDocument();
    }
  }
  for (const repository of workspace.repositories) {
    const ownedWorktreeIds = workspace.worktrees
      .filter(
        (worktree) =>
          worktree.repositoryId === repository.id
      )
      .map((worktree) => worktree.id);
    const primaryWorktrees = workspace.worktrees.filter(
      (worktree) =>
        worktree.repositoryId === repository.id &&
        worktree.isPrimary
    );
    if (
      hasDuplicates(repository.worktreeIds) ||
      !setsEqual(
        new Set(repository.worktreeIds),
        new Set(ownedWorktreeIds)
      ) ||
      repository.worktreeIds.some(
        (worktreeId) =>
          worktrees.get(worktreeId)?.repositoryId !==
          repository.id
      ) ||
      primaryWorktrees.length > 1 ||
      (repository.primaryWorktreeId === undefined
        ? primaryWorktrees.length > 0
        : !repository.worktreeIds.includes(
              repository.primaryWorktreeId
            ) ||
          primaryWorktrees.length !== 1 ||
          primaryWorktrees[0]?.id !==
            repository.primaryWorktreeId)
    ) {
      throw invalidDocument();
    }
  }
  const availableTargets = new Set(
    workspace.worktrees.map((worktree) =>
      repositoryTargetKey({
        repositoryId: worktree.repositoryId,
        worktreeId: worktree.id
      })
    )
  );
  const registeredTargets = new Set(
    listWorkspaceTargets(workspace).map(
      repositoryTargetKey
    )
  );
  if (
    [...registeredTargets].some(
      (targetKey) => !availableTargets.has(targetKey)
    ) ||
    (workspace.selectedEntryId !== undefined &&
      !workspace.entries.some(
        (entry) => entry.id === workspace.selectedEntryId
      )) ||
    (workspace.selectedTarget !== undefined &&
      !registeredTargets.has(
        repositoryTargetKey(workspace.selectedTarget)
      ))
  ) {
    throw invalidDocument();
  }
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function setsEqual(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): boolean {
  return (
    left.size === right.size &&
    [...left].every((value) => right.has(value))
  );
}

function isNonEmptyString(
  value: unknown
): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeInteger(
  value: unknown
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
  );
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value))
  );
}

function invalidDocument(): WorkspaceError {
  return new WorkspaceError(
    "INVALID_PERSISTED_DATA",
    "The persisted Workspace document is invalid."
  );
}
