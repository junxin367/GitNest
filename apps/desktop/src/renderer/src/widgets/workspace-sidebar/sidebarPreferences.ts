const CHANGED_REPOSITORIES_ONLY_KEY_PREFIX =
  "gitnest.workspace.sidebar.changed-repositories-only:";

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function changedRepositoriesOnlyPreferenceKey(
  workspaceId: string,
  entryId: string
): string {
  return `${CHANGED_REPOSITORIES_ONLY_KEY_PREFIX}${workspaceId}:${entryId}`;
}

export function readChangedRepositoriesOnlyPreference(
  storage: PreferenceStorage | undefined,
  workspaceId: string | undefined,
  entryId: string | undefined
): boolean {
  if (!storage || !workspaceId || !entryId) {
    return false;
  }

  try {
    return (
      storage.getItem(
        changedRepositoriesOnlyPreferenceKey(
          workspaceId,
          entryId
        )
      ) === "true"
    );
  } catch {
    return false;
  }
}

export function writeChangedRepositoriesOnlyPreference(
  storage: PreferenceStorage | undefined,
  workspaceId: string | undefined,
  entryId: string | undefined,
  enabled: boolean
): void {
  if (!storage || !workspaceId || !entryId) {
    return;
  }

  try {
    storage.setItem(
      changedRepositoriesOnlyPreferenceKey(
        workspaceId,
        entryId
      ),
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
