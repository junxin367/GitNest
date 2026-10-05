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

export function shouldOpenGlobalSearch(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "defaultPrevented" | "isComposing">,
  modalOpen: boolean
): boolean {
  return !modalOpen &&
    !event.defaultPrevented &&
    !event.isComposing &&
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "k";
}
