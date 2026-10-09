export type { GitEnvironment } from "./domain/git-environment";
export { normalizeCommitHistorySearch } from "./domain/history-search";
export type { CommitHistoryFilter } from "./domain/history-search";
export type {
  GitAncestry,
  RemoteBranchRef
} from "./domain/repository-commands";
export type {
  CommitDiff,
  CommitHistoryComparison,
  CommitHistoryComparisonSide,
  CommitHistoryEntry,
  CommitDetails,
  CommitFileStat,
  CommitHistoryPage,
  CommitHistoryScope,
  RepositoryBranches,
  RepositoryChanges,
  RepositoryDiff,
  RepositoryDiffMode,
  RepositoryMediaKind,
  RepositoryMediaPreview,
  RepositoryMediaUnavailableReason,
  StashDiff,
  StashFiles,
  StashFileStat,
  StashSummary
} from "./domain/repository-queries";
export type {
  CreatedCommit
} from "./domain/repository-mutations";
export type {
  Branch,
  ChangedPath,
  ChangedPathStats,
  CommitSummary,
  RepositoryIdentity,
  RepositoryInspection,
  RepositorySnapshot,
  RepositoryTopology,
  Worktree
} from "./domain/repository";
export {
  GitError,
  type GitErrorCode
} from "./errors/git-errors";
export { parseBranches } from "./parsers/branches";
export {
  parseCommitMetadata,
  parseCommitNumstat
} from "./parsers/commit-details";
export { parseRepositoryDiff } from "./parsers/diff";
export {
  parseCommitHistory,
  parseComparedCommitHistory
} from "./parsers/history";
export { parseStashList } from "./parsers/stashes";
export {
  parseStatusPorcelainV2,
  reconcileStatOnlyUnstagedChanges
} from "./parsers/status-porcelain-v2";
export {
  parseGitLfsVersion,
  parseGitVersion
} from "./parsers/version";
export { parseWorktrees } from "./parsers/worktrees";
export type {
  FetchRemoteOptions,
  GitPullStrategy,
  GitRepositoryCommandClient,
  PushBranchOptions
} from "./ports/git-command-client";
export type {
  GitClient,
  GitReadOptions,
  GitReadPriority,
  InspectRepositoryOptions,
  ReadCommitHistoryOptions,
  ReadRepositorySnapshotOptions,
  ReadRepositoryDiffOptions
} from "./ports/git-client";
export type { GitTopologyClient } from "./ports/git-topology-client";
export type {
  GitCommitDiffClient,
  ReadCommitDiffOptions
} from "./ports/git-commit-diff-client";
export type {
  GitStashClient,
  ReadStashDiffOptions,
  ReadStashesOptions
} from "./ports/git-stash-client";
export type {
  CreateCommitOptions,
  GitMutationClient,
  GitWriteOptions,
  RestoreWorktreeOptions,
  StashMutationAction
} from "./ports/git-mutation-client";
export type {
  CreateWorktreeOptions,
  GitWorktreeCommandClient,
  LockWorktreeOptions
} from "./ports/git-worktree-client";
export type { GitWorkflowAction, GitWorkflowClient, GitWorkflowInspectOptions, GitWorkflowOperation, GitWorkflowState } from "./ports/git-workflow-client";
export type { GitIgnoreScope, GitIgnoreInput, GitIgnorePlan, GitIgnoreClient } from "./ports/git-ignore-client";
export type * from "./ports/file-history-client";
export type {
  ManagedRemote, ManagedTag, RepositoryManagementState,
  RepositoryManagementAction, RepositoryCreationInput, RepositoryManagementPort
} from "./repository-management";
