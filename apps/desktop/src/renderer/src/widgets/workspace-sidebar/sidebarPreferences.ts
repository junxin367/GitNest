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
  workspaceId: string
): string {
  return rendererPreferenceKeys.changedRepositoriesOnly(workspaceId);
}

export function readChangedRepositoriesOnlyPreference(
  storage: PreferenceStorage | undefined,
  workspaceId: string | undefined
): boolean {
  if (!storage || !workspaceId) {
    return false;
  }

  return (
    readRendererPreference(
      storage,
      changedRepositoriesOnlyPreferenceKey(workspaceId)
    ) === "true"
  );
}

export function writeChangedRepositoriesOnlyPreference(
  storage: PreferenceStorage | undefined,
  workspaceId: string | undefined,
  enabled: boolean
): void {
  if (!storage || !workspaceId) {
    return;
  }

  writeRendererPreference(
    storage,
    changedRepositoriesOnlyPreferenceKey(workspaceId),
    String(enabled)
  );
}
