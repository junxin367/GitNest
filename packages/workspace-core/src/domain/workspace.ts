export const WORKSPACE_SCHEMA_VERSION = 1;

export type WorkspaceEntryKind =
  | "workspace-meta-repository"
  | "workspace-directory"
  | "standalone-repository";

export interface RepositoryTarget {
  repositoryId: string;
  worktreeId: string;
}

export interface WorkspaceRepository {
  id: string;
  name: string;
  commonDir: string;
  canonicalCommonDir: string;
  primaryWorktreeId?: string;
  worktreeIds: string[];
}

export interface WorkspaceWorktree {
  id: string;
  repositoryId: string;
  name: string;
  path: string;
  canonicalPath: string;
  gitDir?: string;
  head: string;
  branch?: string;
  isPrimary: boolean;
  isBare: boolean;
  isDetached: boolean;
  isLocked: boolean;
  lockReason?: string;
  isPrunable: boolean;
  pruneReason?: string;
}

export type WorkspaceScanIssueCode =
  | "DIRECTORY_UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "REPOSITORY_UNAVAILABLE"
  | "OUTSIDE_ROOT_LINK_SKIPPED"
  | "SYMLINK_LOOP_SKIPPED";

export interface WorkspaceScanIssue {
  path: string;
  code: WorkspaceScanIssueCode;
  message: string;
}

export interface RepositoryGroup {
  id: string;
  name: string;
  targets: RepositoryTarget[];
  collapsed: boolean;
}

interface WorkspaceEntryBase {
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

export interface AggregateWorkspaceEntry
  extends WorkspaceEntryBase {
  kind: "workspace-meta-repository";
  rootTarget: RepositoryTarget;
}

export interface DirectoryWorkspaceEntry
  extends WorkspaceEntryBase {
  kind: "workspace-directory";
}

export interface StandaloneRepositoryEntry
  extends WorkspaceEntryBase {
  kind: "standalone-repository";
  target: RepositoryTarget;
}

export type WorkspaceEntry =
  | AggregateWorkspaceEntry
  | DirectoryWorkspaceEntry
  | StandaloneRepositoryEntry;

export interface Workspace {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  id: string;
  name: string;
  entries: WorkspaceEntry[];
  repositories: WorkspaceRepository[];
  worktrees: WorkspaceWorktree[];
  selectedEntryId?: string;
  selectedTarget?: RepositoryTarget;
  updatedAt: string;
}

export interface WorkspaceRootDefinition {
  id: string;
  displayName: string;
  path: string;
  canonicalPath: string;
  excludes: string[];
  order: number;
}

export function createEmptyWorkspace(
  now = new Date().toISOString()
): Workspace {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    id: "default",
    name: "GitNest Workspace",
    entries: [],
    repositories: [],
    worktrees: [],
    updatedAt: now
  };
}
