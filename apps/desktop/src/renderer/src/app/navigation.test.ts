import { describe, expect, it } from "vitest";

import {
  repositoryTabForTargetSwitch,
  type RepositoryTab
} from "./navigation";

describe("repositoryTabForTargetSwitch", () => {
  it.each<RepositoryTab>([
    "overview",
    "changes",
    "history",
    "branches",
    "worktrees"
  ])("keeps the current %s tab", (tab) => {
    expect(repositoryTabForTargetSwitch(tab)).toBe(tab);
  });

  it("opens the overview when there is no previous repository tab", () => {
    expect(repositoryTabForTargetSwitch()).toBe("overview");
  });
});
