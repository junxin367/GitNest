import { describe, expect, it } from "vitest";

import { isWorkspaceDataBlocked } from "../../entities/workspace/model";

describe("Workspace overview state", () => {
  it("replaces unknown Workspace data with a blocking error state", () => {
    expect(
      isWorkspaceDataBlocked(
        null,
        {
          code: "INVALID_PERSISTED_DATA",
          message: "Workspace document is invalid.",
          details: {}
        },
        null
      )
    ).toBe(true);
  });
});
