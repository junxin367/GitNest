import { describe, expect, it } from "vitest";

import { preferredRepositoryTab } from "./navigation";

describe("preferredRepositoryTab", () => {
  it("opens the overview when there are no changes", () => {
    expect(preferredRepositoryTab(0)).toBe("overview");
  });

  it("opens changes when the repository has local changes", () => {
    expect(preferredRepositoryTab(1)).toBe("changes");
  });
});
