import { describe, expect, it, vi } from "vitest";

import type {
  AddWorkspaceEntryRequest,
  WorkspaceDetailsDto,
  WorkspaceMutationResultDto,
  WorkspaceResult
} from "@gitnest/contracts";

import { addWorkspaceEntries } from "./addWorkspaceEntries";

describe("addWorkspaceEntries", () => {
  it("keeps successful results visible and continues after a later path fails", async () => {
    const first = workspace("first");
    const third = workspace("third");
    const addEntry = vi
      .fn<
        (
          request: AddWorkspaceEntryRequest
        ) => Promise<
          WorkspaceResult<WorkspaceMutationResultDto>
        >
      >()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          workspace: first,
          focusedEntryId: "first",
          duplicate: false
        }
      })
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "DIRECTORY_UNAVAILABLE",
          message: "Unavailable.",
          details: {}
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          workspace: third,
          focusedEntryId: "third",
          duplicate: false
        }
      });

    const result = await addWorkspaceEntries(
      ["C:\\first", "C:\\missing", "C:\\third"],
      "drop",
      null,
      addEntry
    );

    expect(addEntry).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      workspace: third,
      added: 2,
      duplicates: 0,
      failures: [
        {
          path: "C:\\missing",
          error: {
            code: "DIRECTORY_UNAVAILABLE"
          }
        }
      ]
    });
  });
});

function workspace(id: string): WorkspaceDetailsDto {
  return {
    schemaVersion: 1,
    id,
    name: id,
    entries: [],
    repositories: [],
    worktrees: [],
    updatedAt: "2026-09-04T10:00:00.000Z"
  };
}
