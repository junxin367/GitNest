export type { GitEnvironment } from "./domain/git-environment";
export type {
  GitAncestry,
  RemoteBranchRef
} from "./domain/repository-commands";
export type {
  CommitDetails,
  CommitFileStat,
  CommitHistoryPage,
  RepositoryBranches,
  RepositoryChanges,
  RepositoryDiff,
  RepositoryDiffMode
} from "./domain/repository-queries";
export type {
  CreatedCommit
} from "./domain/repository-mutations";
export type {
  Branch,
  ChangedPath,
  CommitSummary,
  RepositoryIdentity,
  RepositoryInspection,
  RepositorySnapshot,
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
export { parseCommitHistory } from "./parsers/history";
export { parseStatusPorcelainV2 } from "./parsers/status-porcelain-v2";
export {
  parseGitLfsVersion,
  parseGitVersion
} from "./parsers/version";
export { parseWorktrees } from "./parsers/worktrees";
export type {
  FetchRemoteOptions,
  GitRepositoryCommandClient,
  PushBranchOptions
} from "./ports/git-command-client";
export type {
  GitClient,
  GitReadOptions,
  InspectRepositoryOptions,
  ReadCommitHistoryOptions,
  ReadRepositoryDiffOptions
} from "./ports/git-client";
export type {
  CreateCommitOptions,
  GitMutationClient,
  GitWriteOptions
} from "./ports/git-mutation-client";
export type {
  CreateWorktreeOptions,
  GitWorktreeCommandClient,
  LockWorktreeOptions
} from "./ports/git-worktree-client";
