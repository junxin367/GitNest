import { describe, expect, it } from "vitest";

import {
  applyTapdKeywordToCommitMessage,
  readTapdKeywordPreference,
  tapdKeywordPreferenceKey,
  writeTapdKeywordPreference
} from "./tapdKeywordPreferences";
import type { PreferenceStorage } from "./sidebarPreferences";

class MemoryStorage implements PreferenceStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("TAPD keyword preferences", () => {
  it("persists the keyword per Workspace", () => {
    const storage = new MemoryStorage();

    writeTapdKeywordPreference(
      storage,
      "workspace-a",
      " TAPD-12345 "
    );

    expect(
      readTapdKeywordPreference(
        storage,
        "workspace-a"
      )
    ).toBe("TAPD-12345");
    expect(
      readTapdKeywordPreference(
        storage,
        "workspace-b"
      )
    ).toBe("");
    expect(
      tapdKeywordPreferenceKey("workspace-a")
    ).toBe("gitnest.workspace.tapd-keyword:workspace-a");
  });

  it("adds a non-empty keyword on the second line without duplicating it", () => {
    expect(
      applyTapdKeywordToCommitMessage(
        "feat: update parser\n\nDetails",
        " TAPD-12345 "
      )
    ).toBe("feat: update parser\nTAPD-12345\n\nDetails");
    expect(
      applyTapdKeywordToCommitMessage(
        "feat: update parser\nTAPD-12345\n\nDetails",
        "TAPD-12345"
      )
    ).toBe("feat: update parser\nTAPD-12345\n\nDetails");
    expect(
      applyTapdKeywordToCommitMessage(
        "feat: update parser",
        " "
      )
    ).toBe("feat: update parser");
    expect(
      applyTapdKeywordToCommitMessage(
        "feat: update parser\n",
        ""
      )
    ).toBe("feat: update parser\n");
  });
});
