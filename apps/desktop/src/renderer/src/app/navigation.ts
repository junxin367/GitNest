export type AppView =
  | "workspace"
  | "repository"
  | "operations"
  | "settings";

export type WorkspaceTab =
  | "overview"
  | "repositories"
  | "activity"
  | "worktrees";

export type RepositoryTab =
  | "overview"
  | "changes"
  | "history"
  | "branches"
  | "worktrees";

export function preferredRepositoryTab(
  changeCount: number
): RepositoryTab {
  return changeCount > 0 ? "changes" : "overview";
}
