import { describe, expect, it } from "vitest";

import {
  changedRepositoriesOnlyPreferenceKey,
  readChangedRepositoriesOnlyPreference,
  writeChangedRepositoriesOnlyPreference,
  type PreferenceStorage
} from "./sidebarPreferences";

class MemoryStorage implements PreferenceStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("workspace sidebar preferences", () => {
  it("keeps the changed-repositories filter separate per Workspace", () => {
    const storage = new MemoryStorage();

    writeChangedRepositoriesOnlyPreference(
      storage,
      "workspace-a",
      true
    );

    expect(
      readChangedRepositoriesOnlyPreference(
        storage,
        "workspace-a"
      )
    ).toBe(true);
    expect(
      readChangedRepositoriesOnlyPreference(
        storage,
        "workspace-b",
      )
    ).toBe(false);
  });

  it("uses a stable, scoped preference key", () => {
    expect(
      changedRepositoriesOnlyPreferenceKey("workspace-a")
    ).toBe(
      "gitnest.workspace.sidebar.changed-repositories-only:workspace-a"
    );
  });
});
