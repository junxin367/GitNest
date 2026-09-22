import { createHash } from "node:crypto";

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
  type WorkspaceRepository,
  type WorkspaceScanIssue,
  type WorkspaceWorktree
} from "@gitnest/workspace-core";

const LEGACY_ROOT_REPOSITORY_GROUP_NAME = "根目录仓库";

interface LegacyWorkspaceEntryBase {
  id: string;
  displayName: string;
  path: string;
  canonicalPath: string;
  excludes: string[];
  order: number;
  groups: RepositoryGroup[];
  scanIssues: WorkspaceScanIssue[];
  lastScannedAt: string;
}

interface LegacyAggregateWorkspaceEntry
  extends LegacyWorkspaceEntryBase {
  kind: "workspace-meta-repository";
  rootTarget: RepositoryTarget;
}

interface LegacyDirectoryWorkspaceEntry
  extends LegacyWorkspaceEntryBase {
  kind: "workspace-directory";
}

interface LegacyStandaloneRepositoryEntry
  extends LegacyWorkspaceEntryBase {
  kind: "standalone-repository";
  target: RepositoryTarget;
}

type LegacyWorkspaceEntry =
  | LegacyAggregateWorkspaceEntry
  | LegacyDirectoryWorkspaceEntry
  | LegacyStandaloneRepositoryEntry;

interface LegacyWorkspaceDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  entries: LegacyWorkspaceEntry[];
  repositories: WorkspaceRepository[];
  worktrees: WorkspaceWorktree[];
  selectedEntryId?: string;
  selectedTarget?: RepositoryTarget;
  updatedAt: string;
}

export function migrateWorkspaceDocument(value: unknown): Workspace {
  const workspaces = migrateWorkspaceDocumentSet(value);
  const sourceId = readWorkspaceId(value);
  return (
    workspaces.find((workspace) => workspace.id === sourceId) ??
    (workspaces[0] as Workspace)
  );
}

export function migrateWorkspaceDocumentSet(
  value: unknown,
  reservedIds: ReadonlySet<string> = new Set()
): Workspace[] {
  if (!isRecord(value)) {
    throw invalidDocument();
  }

  if (value.schemaVersion === WORKSPACE_SCHEMA_VERSION) {
    return [parseCurrentWorkspaceDocument(value)];
  }

  if (value.schemaVersion !== 0 && value.schemaVersion !== 1) {
    throw new WorkspaceError(
      "INVALID_PERSISTED_DATA",
      `Unsupported Workspace schema version: ${String(value.schemaVersion)}.`
    );
  }

  return splitLegacyWorkspace(
    parseLegacyWorkspaceDocument(value),
    reservedIds
  );
}

function parseCurrentWorkspaceDocument(
  value: Record<string, unknown>
): Workspace {
  const configuredFields = [
    value.path,
    value.canonicalPath,
    value.lastScannedAt
  ];
  const configured = configuredFields.every(
    (field) => field !== undefined
  );
  const unconfigured = configuredFields.every(
    (field) => field === undefined
  );

  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.name) ||
    !isTimestamp(value.updatedAt) ||
    (!configured && !unconfigured) ||
    (configured &&
      (!isNonEmptyString(value.path) ||
        !isNonEmptyString(value.canonicalPath) ||
        !isTimestamp(value.lastScannedAt))) ||
    !Array.isArray(value.excludes) ||
    !value.excludes.every((item) => typeof item === "string") ||
    !Array.isArray(value.groups) ||
    !value.groups.every(isRepositoryGroup) ||
    !Array.isArray(value.scanIssues) ||
    !value.scanIssues.every(isWorkspaceScanIssue) ||
    !Array.isArray(value.repositories) ||
    !value.repositories.every(isWorkspaceRepository) ||
    !Array.isArray(value.worktrees) ||
    !value.worktrees.every(isWorkspaceWorktree) ||
    (value.selectedTarget !== undefined &&
      !isRepositoryTarget(value.selectedTarget))
  ) {
    throw invalidDocument();
  }
  if (
    unconfigured &&
    ((value.excludes as string[]).length > 0 ||
      (value.groups as RepositoryGroup[]).length > 0 ||
      (value.scanIssues as WorkspaceScanIssue[]).length > 0 ||
      (value.repositories as WorkspaceRepository[]).length > 0 ||
      (value.worktrees as WorkspaceWorktree[]).length > 0 ||
      value.selectedTarget !== undefined)
  ) {
    throw invalidDocument();
  }

  const workspace: Workspace = {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    id: value.id,
    name: value.name,
    ...(configured
      ? {
          path: value.path as string,
          canonicalPath: value.canonicalPath as string
        }
      : {}),
    excludes: [...value.excludes],
    groups: (value.groups as RepositoryGroup[]).map(
      rebuildRepositoryGroup
    ),
    scanIssues: (value.scanIssues as WorkspaceScanIssue[]).map(
      rebuildWorkspaceScanIssue
    ),
    ...(configured
      ? { lastScannedAt: value.lastScannedAt as string }
      : {}),
    repositories: (
      value.repositories as WorkspaceRepository[]
    ).map(rebuildWorkspaceRepository),
    worktrees: (value.worktrees as WorkspaceWorktree[]).map(
      rebuildWorkspaceWorktree
    ),
    ...(value.selectedTarget
      ? {
          selectedTarget: rebuildRepositoryTarget(
            value.selectedTarget as RepositoryTarget
          )
        }
      : {}),
    updatedAt: value.updatedAt
  };

  assertCurrentWorkspaceRelationships(workspace);
  return workspace;
}

function parseLegacyWorkspaceDocument(
  value: Record<string, unknown>
): LegacyWorkspaceDocument {
  const normalized = normalizeLegacyVersionZero(value);

  if (
    !isRecord(normalized) ||
    normalized.schemaVersion !== 1 ||
    !isNonEmptyString(normalized.id) ||
    !isNonEmptyString(normalized.name) ||
    !isTimestamp(normalized.updatedAt) ||
    !Array.isArray(normalized.entries) ||
    !normalized.entries.every(isLegacyWorkspaceEntry) ||
    !Array.isArray(normalized.repositories) ||
    !normalized.repositories.every(isWorkspaceRepository) ||
    !Array.isArray(normalized.worktrees) ||
    !normalized.worktrees.every(isWorkspaceWorktree) ||
    (normalized.selectedEntryId !== undefined &&
      !isNonEmptyString(normalized.selectedEntryId)) ||
    (normalized.selectedTarget !== undefined &&
      !isRepositoryTarget(normalized.selectedTarget))
  ) {
    throw invalidDocument();
  }

  const legacy: LegacyWorkspaceDocument = {
    schemaVersion: 1,
    id: normalized.id,
    name: normalized.name,
    entries: (
      normalized.entries as LegacyWorkspaceEntry[]
    ).map(rebuildLegacyWorkspaceEntry),
    repositories: (
      normalized.repositories as WorkspaceRepository[]
    ).map(rebuildWorkspaceRepository),
    worktrees: (
      normalized.worktrees as WorkspaceWorktree[]
    ).map(rebuildWorkspaceWorktree),
    ...(typeof normalized.selectedEntryId === "string"
      ? { selectedEntryId: normalized.selectedEntryId }
      : {}),
    ...(normalized.selectedTarget
      ? {
          selectedTarget: rebuildRepositoryTarget(
            normalized.selectedTarget as RepositoryTarget
          )
        }
      : {}),
    updatedAt: normalized.updatedAt
  };

  assertLegacyWorkspaceRelationships(legacy);
  return legacy;
}

function normalizeLegacyVersionZero(
  value: Record<string, unknown>
): unknown {
  if (value.schemaVersion !== 0) {
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
    schemaVersion: 1,
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

function splitLegacyWorkspace(
  source: LegacyWorkspaceDocument,
  reservedIds: ReadonlySet<string>
): Workspace[] {
  if (source.entries.length === 0) {
    return [
      {
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        id: source.id,
        name: source.name,
        excludes: [],
        groups: [],
        scanIssues: [],
        repositories: [],
        worktrees: [],
        updatedAt: source.updatedAt
      }
    ];
  }

  const entries = [...source.entries].sort(
    (left, right) =>
      left.order - right.order ||
      left.path.localeCompare(right.path, undefined, {
        sensitivity: "base"
      })
  );
  const selectedEntry =
    entries.find((entry) => entry.id === source.selectedEntryId) ??
    entries[0];
  const usedIds = new Set(reservedIds);
  usedIds.add(source.id);

  return entries.map((entry) => {
    const workspaceId =
      entry.id === selectedEntry?.id
        ? source.id
        : createPromotedWorkspaceId(
            source.id,
            entry.id,
            usedIds
          );
    usedIds.add(workspaceId);
    return createPromotedWorkspace(source, entry, workspaceId);
  });
}

function createPromotedWorkspace(
  source: LegacyWorkspaceDocument,
  entry: LegacyWorkspaceEntry,
  workspaceId: string
): Workspace {
  const groups = normalizeLegacyRepositoryGroups(entry);
  const targets = uniqueTargets(
    groups.flatMap((group) => group.targets)
  );
  const repositoryIds = new Set(
    targets.map((target) => target.repositoryId)
  );
  const repositories = source.repositories
    .filter((repository) => repositoryIds.has(repository.id))
    .map(rebuildWorkspaceRepository);
  const worktrees = source.worktrees
    .filter((worktree) =>
      repositoryIds.has(worktree.repositoryId)
    )
    .map(rebuildWorkspaceWorktree);
  const targetKeys = new Set(
    targets.map(repositoryTargetKey)
  );
  const selectedTarget =
    source.selectedTarget &&
    targetKeys.has(repositoryTargetKey(source.selectedTarget))
      ? rebuildRepositoryTarget(source.selectedTarget)
      : targets[0];

  const workspace: Workspace = {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    id: workspaceId,
    name: createWorkspaceName(entry.displayName),
    path: entry.path,
    canonicalPath: entry.canonicalPath,
    excludes: [...entry.excludes],
    groups,
    scanIssues: entry.scanIssues.map(rebuildWorkspaceScanIssue),
    lastScannedAt: entry.lastScannedAt,
    repositories,
    worktrees,
    ...(selectedTarget
      ? { selectedTarget: rebuildRepositoryTarget(selectedTarget) }
      : {}),
    updatedAt: source.updatedAt
  };

  assertCurrentWorkspaceRelationships(workspace);
  return workspace;
}

function normalizeLegacyRepositoryGroups(
  entry: LegacyWorkspaceEntry
): RepositoryGroup[] {
  const groups = entry.groups.map(rebuildRepositoryGroup);
  let defaultGroup = groups.find(
    (group) =>
      group.name === DEFAULT_ROOT_REPOSITORY_GROUP_NAME ||
      group.name === LEGACY_ROOT_REPOSITORY_GROUP_NAME
  );
  const specialTarget =
    entry.kind === "workspace-meta-repository"
      ? entry.rootTarget
      : entry.kind === "standalone-repository"
        ? entry.target
        : undefined;

  if (defaultGroup) {
    defaultGroup.name = DEFAULT_ROOT_REPOSITORY_GROUP_NAME;
  } else if (specialTarget) {
    defaultGroup = {
      id: createPathIdentity(
        "group",
        `${entry.canonicalPath}\0${DEFAULT_ROOT_REPOSITORY_GROUP_NAME.toLocaleLowerCase()}`
      ),
      name: DEFAULT_ROOT_REPOSITORY_GROUP_NAME,
      targets: [],
      collapsed: false
    };
    groups.unshift(defaultGroup);
  }

  if (defaultGroup && specialTarget) {
    appendTarget(defaultGroup.targets, specialTarget);
  }

  return groups.map((group) => ({
    ...group,
    targets: uniqueTargets(group.targets)
  }));
}

function isLegacyWorkspaceEntry(
  value: unknown
): value is LegacyWorkspaceEntry {
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

function rebuildLegacyWorkspaceEntry(
  entry: LegacyWorkspaceEntry
): LegacyWorkspaceEntry {
  const base = {
    id: entry.id,
    displayName: entry.displayName,
    path: entry.path,
    canonicalPath: entry.canonicalPath,
    excludes: [...entry.excludes],
    order: entry.order,
    groups: entry.groups.map(rebuildRepositoryGroup),
    scanIssues: entry.scanIssues.map(rebuildWorkspaceScanIssue),
    lastScannedAt: entry.lastScannedAt
  };
  if (entry.kind === "workspace-meta-repository") {
    return {
      ...base,
      kind: entry.kind,
      rootTarget: rebuildRepositoryTarget(entry.rootTarget)
    };
  }
  if (entry.kind === "standalone-repository") {
    return {
      ...base,
      kind: entry.kind,
      target: rebuildRepositoryTarget(entry.target)
    };
  }
  return {
    ...base,
    kind: "workspace-directory"
  };
}

function rebuildRepositoryGroup(
  group: RepositoryGroup
): RepositoryGroup {
  return {
    id: group.id,
    name: group.name,
    targets: group.targets.map(rebuildRepositoryTarget),
    collapsed: group.collapsed
  };
}

function rebuildRepositoryTarget(
  target: RepositoryTarget
): RepositoryTarget {
  return {
    repositoryId: target.repositoryId,
    worktreeId: target.worktreeId
  };
}

function rebuildWorkspaceScanIssue(
  issue: WorkspaceScanIssue
): WorkspaceScanIssue {
  return {
    path: issue.path,
    code: issue.code,
    message: issue.message
  };
}

function rebuildWorkspaceRepository(
  repository: WorkspaceRepository
): WorkspaceRepository {
  return {
    id: repository.id,
    name: repository.name,
    commonDir: repository.commonDir,
    canonicalCommonDir: repository.canonicalCommonDir,
    ...(repository.primaryWorktreeId
      ? { primaryWorktreeId: repository.primaryWorktreeId }
      : {}),
    worktreeIds: [...repository.worktreeIds]
  };
}

function rebuildWorkspaceWorktree(
  worktree: WorkspaceWorktree
): WorkspaceWorktree {
  return {
    id: worktree.id,
    repositoryId: worktree.repositoryId,
    name: worktree.name,
    path: worktree.path,
    canonicalPath: worktree.canonicalPath,
    ...(worktree.gitDir ? { gitDir: worktree.gitDir } : {}),
    head: worktree.head,
    ...(worktree.branch ? { branch: worktree.branch } : {}),
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
  };
}

function assertCurrentWorkspaceRelationships(
  workspace: Workspace
): void {
  if (
    hasDuplicates(workspace.groups.map((group) => group.id)) ||
    hasDuplicates(
      workspace.repositories.map((repository) => repository.id)
    ) ||
    hasDuplicates(workspace.worktrees.map((worktree) => worktree.id))
  ) {
    throw invalidDocument();
  }
  assertRepositoryRelationships(
    workspace.repositories,
    workspace.worktrees
  );

  const availableTargets = new Set(
    workspace.worktrees.map((worktree) =>
      repositoryTargetKey({
        repositoryId: worktree.repositoryId,
        worktreeId: worktree.id
      })
    )
  );
  const registeredTargets = new Set(
    listWorkspaceTargets(workspace).map(repositoryTargetKey)
  );
  if (
    [...registeredTargets].some(
      (targetKey) => !availableTargets.has(targetKey)
    ) ||
    (workspace.selectedTarget !== undefined &&
      !registeredTargets.has(
        repositoryTargetKey(workspace.selectedTarget)
      ))
  ) {
    throw invalidDocument();
  }
}

function assertLegacyWorkspaceRelationships(
  workspace: LegacyWorkspaceDocument
): void {
  if (
    hasDuplicates(workspace.entries.map((entry) => entry.id)) ||
    hasDuplicates(
      workspace.repositories.map((repository) => repository.id)
    ) ||
    hasDuplicates(workspace.worktrees.map((worktree) => worktree.id))
  ) {
    throw invalidDocument();
  }
  assertRepositoryRelationships(
    workspace.repositories,
    workspace.worktrees
  );

  const availableTargets = new Set(
    workspace.worktrees.map((worktree) =>
      repositoryTargetKey({
        repositoryId: worktree.repositoryId,
        worktreeId: worktree.id
      })
    )
  );
  const registeredTargets = new Set(
    workspace.entries.flatMap((entry) =>
      legacyEntryTargets(entry).map(repositoryTargetKey)
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

function assertRepositoryRelationships(
  repositories: WorkspaceRepository[],
  worktrees: WorkspaceWorktree[]
): void {
  const repositoryById = new Map(
    repositories.map((repository) => [
      repository.id,
      repository
    ])
  );
  const worktreeById = new Map(
    worktrees.map((worktree) => [worktree.id, worktree])
  );

  if (
    worktrees.some(
      (worktree) => !repositoryById.has(worktree.repositoryId)
    )
  ) {
    throw invalidDocument();
  }

  for (const repository of repositories) {
    const ownedWorktreeIds = worktrees
      .filter(
        (worktree) => worktree.repositoryId === repository.id
      )
      .map((worktree) => worktree.id);
    const primaryWorktrees = worktrees.filter(
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
          worktreeById.get(worktreeId)?.repositoryId !==
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
}

function legacyEntryTargets(
  entry: LegacyWorkspaceEntry
): RepositoryTarget[] {
  return uniqueTargets([
    ...entry.groups.flatMap((group) => group.targets),
    ...(entry.kind === "workspace-meta-repository"
      ? [entry.rootTarget]
      : entry.kind === "standalone-repository"
        ? [entry.target]
        : [])
  ]);
}

function uniqueTargets(
  targets: readonly RepositoryTarget[]
): RepositoryTarget[] {
  return [
    ...new Map(
      targets.map((target) => [
        repositoryTargetKey(target),
        rebuildRepositoryTarget(target)
      ])
    ).values()
  ];
}

function appendTarget(
  targets: RepositoryTarget[],
  target: RepositoryTarget
): void {
  const key = repositoryTargetKey(target);
  if (
    !targets.some(
      (candidate) => repositoryTargetKey(candidate) === key
    )
  ) {
    targets.push(rebuildRepositoryTarget(target));
  }
}

function createPromotedWorkspaceId(
  legacyWorkspaceId: string,
  entryId: string,
  usedIds: ReadonlySet<string>
): string {
  for (let attempt = 0; ; attempt += 1) {
    const digest = createHash("sha256")
      .update(`${legacyWorkspaceId}\0${entryId}\0${attempt}`)
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

function readWorkspaceId(value: unknown): string | undefined {
  return isRecord(value) && typeof value.id === "string"
    ? value.id
    : undefined;
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
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
