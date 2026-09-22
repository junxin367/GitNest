export {
  WORKSPACE_CATALOG_SCHEMA_VERSION,
  WORKSPACE_SCHEMA_VERSION,
  createEmptyWorkspace,
  summarizeWorkspace,
  type RepositoryGroup,
  type RepositoryTarget,
  type Workspace,
  type WorkspaceCatalog,
  type WorkspaceRepository,
  type WorkspaceRoot,
  type WorkspaceScanIssue,
  type WorkspaceScanIssueCode,
  type WorkspaceSummary,
  type WorkspaceWorktree
} from "./domain/workspace";
export type {
  RepositoryStatusError,
  RepositoryStatusSnapshot
} from "./domain/repository-status";
export {
  WorkspaceError,
  type WorkspaceErrorCode
} from "./errors/workspace-error";
export {
  DEFAULT_WORKSPACE_EXCLUDES,
  WorkspaceScanner,
  type DiscoveredRepository,
  type WorkspaceRootScan,
  type WorkspaceScanOptions
} from "./discovery/workspace-scanner";
export type {
  RepositoryProbe,
  RepositoryProbeResult,
  RepositoryProbeWorktree
} from "./ports/repository-probe";
export type {
  RepositorySnapshotStore
} from "./ports/repository-snapshot-store";
export type {
  NormalizedWorkspacePath,
  WorkspaceDirectoryEntry,
  WorkspaceDirectoryEntryKind,
  WorkspaceFileSystem
} from "./ports/workspace-filesystem";
export type {
  WorkspaceCollectionStore
} from "./ports/workspace-collection-store";
export type { WorkspaceStore } from "./ports/workspace-store";
export type {
  WorkspaceWatchEvent,
  WorkspaceWatchHandle,
  WorkspaceWatcher,
  WorkspaceWatchRegistration
} from "./ports/workspace-watcher";
export { createPathIdentity } from "./services/path-identity";
export {
  DEFAULT_ROOT_REPOSITORY_GROUP_NAME,
  WorkspaceAssembler,
  type AssembleWorkspaceInput
} from "./services/workspace-assembler";
export {
  getWorkspaceDefaultTarget,
  listWorkspaceTargets,
  repositoryTargetKey,
  repositoryTargetsEqual
} from "./services/workspace-targets";
