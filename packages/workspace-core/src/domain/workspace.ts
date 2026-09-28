export const WORKSPACE_SCHEMA_VERSION = 2;
export const WORKSPACE_CATALOG_SCHEMA_VERSION = 3;

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

export interface WorkspaceRoot {
  path: string;
  canonicalPath: string;
  excludes: string[];
}

export interface Workspace {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  id: string;
  name: string;
  path?: string;
  canonicalPath?: string;
  excludes: string[];
  additionalRoots?: WorkspaceRoot[];
  groups: RepositoryGroup[];
  scanIssues: WorkspaceScanIssue[];
  lastScannedAt?: string;
  repositories: WorkspaceRepository[];
  worktrees: WorkspaceWorktree[];
  selectedTarget?: RepositoryTarget;
  updatedAt: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export interface WorkspaceCatalog {
  schemaVersion: typeof WORKSPACE_CATALOG_SCHEMA_VERSION;
  activeWorkspaceId: string;
  workspaces: WorkspaceSummary[];
  updatedAt: string;
}

export function createEmptyWorkspace(
  now = new Date().toISOString()
): Workspace {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    id: "default",
    name: "GitNest Workspace",
    excludes: [],
    groups: [],
    scanIssues: [],
    repositories: [],
    worktrees: [],
    updatedAt: now
  };
}

export function summarizeWorkspace(
  workspace: Workspace
): WorkspaceSummary {
  return {
    id: workspace.id,
    name: workspace.name,
    updatedAt: workspace.updatedAt
  };
}

export function listWorkspaceRoots(
  workspace: Workspace
): WorkspaceRoot[] {
  const roots: WorkspaceRoot[] = [];
  const canonicalPaths = new Set<string>();

  if (workspace.path && workspace.canonicalPath) {
    roots.push({
      path: workspace.path,
      canonicalPath: workspace.canonicalPath,
      excludes: [...workspace.excludes]
    });
    canonicalPaths.add(workspace.canonicalPath);
  }

  for (const root of workspace.additionalRoots ?? []) {
    if (canonicalPaths.has(root.canonicalPath)) {
      continue;
    }
    roots.push({
      path: root.path,
      canonicalPath: root.canonicalPath,
      excludes: [...root.excludes]
    });
    canonicalPaths.add(root.canonicalPath);
  }

  return roots;
}
