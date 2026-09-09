const TREE_DIRECTORIES_COLLAPSED_KEY_PREFIX =
  "gitnest.workspace.repository-changes.tree-directories-collapsed:";

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function treeDirectoriesCollapsedPreferenceKey(
  workspaceId: string
): string {
  return `${TREE_DIRECTORIES_COLLAPSED_KEY_PREFIX}${workspaceId}`;
}

export function readTreeDirectoriesCollapsedPreference(
  storage: PreferenceStorage | undefined,
  workspaceId: string | undefined
): boolean {
  if (!storage || !workspaceId) {
    return false;
  }

  try {
    return (
      storage.getItem(
        treeDirectoriesCollapsedPreferenceKey(workspaceId)
      ) === "true"
    );
  } catch {
    return false;
  }
}

export function writeTreeDirectoriesCollapsedPreference(
  storage: PreferenceStorage | undefined,
  workspaceId: string | undefined,
  collapsed: boolean
): void {
  if (!storage || !workspaceId) {
    return;
  }

  try {
    storage.setItem(
      treeDirectoriesCollapsedPreferenceKey(workspaceId),
      String(collapsed)
    );
  } catch {
    // Preference persistence is best-effort in restricted environments.
  }
}

export function getRendererPreferenceStorage():
  | PreferenceStorage
  | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
