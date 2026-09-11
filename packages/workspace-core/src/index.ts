export {
  WORKSPACE_SCHEMA_VERSION,
  createEmptyWorkspace,
  type AggregateWorkspaceEntry,
  type DirectoryWorkspaceEntry,
  type RepositoryGroup,
  type RepositoryTarget,
  type StandaloneRepositoryEntry,
  type Workspace,
  type WorkspaceEntry,
  type WorkspaceEntryKind,
  type WorkspaceRepository,
  type WorkspaceRootDefinition,
  type WorkspaceScanIssue,
  type WorkspaceScanIssueCode,
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
  findTargetEntry,
  getEntryDefaultTarget,
  listEntryTargets,
  listWorkspaceTargets,
  repositoryTargetKey,
  repositoryTargetsEqual
} from "./services/workspace-targets";
