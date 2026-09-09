const CHANGED_REPOSITORIES_ONLY_KEY_PREFIX =
  "gitnest.workspace.sidebar.changed-repositories-only:";

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function changedRepositoriesOnlyPreferenceKey(
  workspaceId: string
): string {
  return `${CHANGED_REPOSITORIES_ONLY_KEY_PREFIX}${workspaceId}`;
}

export function readChangedRepositoriesOnlyPreference(
  storage: PreferenceStorage | undefined,
  workspaceId: string | undefined
): boolean {
  if (!storage || !workspaceId) {
    return false;
  }

  try {
    return (
      storage.getItem(
        changedRepositoriesOnlyPreferenceKey(workspaceId)
      ) === "true"
    );
  } catch {
    return false;
  }
}

export function writeChangedRepositoriesOnlyPreference(
  storage: PreferenceStorage | undefined,
  workspaceId: string | undefined,
  enabled: boolean
): void {
  if (!storage || !workspaceId) {
    return;
  }

  try {
    storage.setItem(
      changedRepositoriesOnlyPreferenceKey(workspaceId),
      String(enabled)
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
