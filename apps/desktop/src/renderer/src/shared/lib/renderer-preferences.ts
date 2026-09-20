export interface RendererPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const KEY_PREFIX = "gitnest.";

export const rendererPreferenceKeys = {
  legacyTheme: `${KEY_PREFIX}theme`,
  preferredExternalApplication:
    `${KEY_PREFIX}open-in.preferred-application`,
  changedRepositoriesOnly(
    workspaceId: string,
    entryId: string
  ): string {
    return `${KEY_PREFIX}workspace.sidebar.changed-repositories-only:${workspaceId}:${entryId}`;
  },
  tapdKeyword(
    workspaceId: string,
    entryId: string
  ): string {
    return `${KEY_PREFIX}workspace.tapd-keyword:${workspaceId}:${entryId}`;
  }
} as const;

export function getRendererPreferenceStorage():
  | RendererPreferenceStorage
  | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readRendererPreference(
  storage: RendererPreferenceStorage | undefined,
  key: string
): string | null {
  if (!storage) {
    return null;
  }
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function writeRendererPreference(
  storage: RendererPreferenceStorage | undefined,
  key: string,
  value: string
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(key, value);
  } catch {
    // Preferences are best-effort in restricted renderer environments.
  }
}

export function removeRendererPreference(
  storage: RendererPreferenceStorage | undefined,
  key: string
): void {
  if (!storage?.removeItem) {
    return;
  }
  try {
    storage.removeItem(key);
  } catch {
    // Legacy preference cleanup is best-effort.
  }
}
