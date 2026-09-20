import {
  getRendererPreferenceStorage,
  readRendererPreference,
  rendererPreferenceKeys,
  writeRendererPreference,
  type RendererPreferenceStorage
} from "../../shared/lib/renderer-preferences";

export type PreferenceStorage = RendererPreferenceStorage;
export { getRendererPreferenceStorage };

export function changedRepositoriesOnlyPreferenceKey(
  workspaceId: string,
  entryId: string
): string {
  return rendererPreferenceKeys.changedRepositoriesOnly(
    workspaceId,
    entryId
  );
}

export function readChangedRepositoriesOnlyPreference(
  storage: PreferenceStorage | undefined,
  workspaceId: string | undefined,
  entryId: string | undefined
): boolean {
  if (!storage || !workspaceId || !entryId) {
    return false;
  }

  return (
    readRendererPreference(
      storage,
      changedRepositoriesOnlyPreferenceKey(
        workspaceId,
        entryId
      )
    ) === "true"
  );
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

  writeRendererPreference(
    storage,
    changedRepositoriesOnlyPreferenceKey(
      workspaceId,
      entryId
    ),
    String(enabled)
  );
}
