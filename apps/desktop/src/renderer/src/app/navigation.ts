export type AppView =
  | "workspace"
  | "repository"
  | "analysis"
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

export function repositoryTabForTargetSwitch(
  currentTab?: RepositoryTab
): RepositoryTab {
  return currentTab ?? "overview";
}
