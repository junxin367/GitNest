import { describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "@gitnest/workspace-core";
import type { FileHistoryClient, FileHistoryResult } from "@gitnest/git-core";
import { FileHistoryService } from "./file-history-service";

const target = { repositoryId: "repo", worktreeId: "wt" };
describe("FileHistoryService", () => {
  it("binds all reads to the exact registered worktree and forwards immutable history/diff inputs", async () => {
    const { service, client } = setup();
    await service.history({ queryId: "history:1", target, path: "中文 file.txt", revision: "a".repeat(40), offset: 10 });
    expect(client.history).toHaveBeenCalledWith("C:/repo", expect.objectContaining({ path: "中文 file.txt", revision: "a".repeat(40), offset: 10 }), expect.objectContaining({ signal: expect.any(AbortSignal), priority: "interactive" }));
    await service.diff({ queryId: "diff:1", target, path: "new.txt", previousPath: "old.txt", commitHash: "b".repeat(40) });
    expect(client.diff).toHaveBeenCalledWith("C:/repo", expect.objectContaining({
      path: "new.txt", previousPath: "old.txt", commitHash: "b".repeat(40)
    }), expect.objectContaining({ signal: expect.any(AbortSignal), priority: "interactive" }));
  });
  it("rejects unregistered, mismatched and bare targets", async () => {
    const { service, client, workspace } = setup();
    await expect(service.history({ queryId: "h1", target: { ...target, repositoryId: "other" }, path: "file" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    workspace.worktrees[0]!.isBare = true;
    await expect(service.history({ queryId: "h2", target, path: "file" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    workspace.worktrees[0]!.isBare = false;
    workspace.groups = [];
    await expect(service.history({ queryId: "h3", target, path: "file" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(client.history).not.toHaveBeenCalled();
  });
  it("cancels the exact in-flight query and discards a late adapter response", async () => {
    const { service, client } = setup();
    let finish!: (value: FileHistoryResult) => void;
    client.history.mockImplementationOnce(async () => new Promise(resolve => { finish = resolve; }));
    const pending = service.history({ queryId: "pending", target, path: "file" });
    await vi.waitFor(() => expect(client.history).toHaveBeenCalled());
    expect(service.cancel("unknown")).toBe(false);
    expect(service.cancel("pending")).toBe(true);
    expect(client.history.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
    finish(empty);
    await expect(pending).rejects.toMatchObject({ code: "COMMAND_CANCELLED" });
    expect(service.cancel("pending")).toBe(false);
  });
  it("discards a late response after a workspace or target-path switch", async () => {
    for (const mode of ["workspace", "path"]) {
      const { service, client, workspace } = setup();
      client.history.mockImplementationOnce(async () => {
        if (mode === "workspace") workspace.id = "new-workspace";
        else workspace.worktrees[0]!.path = "C:/other";
        return empty;
      });
      await expect(service.history({ queryId: "h", target, path: "file" })).rejects.toMatchObject({ code: "COMMAND_CANCELLED" });
    }
  });
  it("does not overwrite an active query with a duplicate id", async () => {
    const { service, client } = setup();
    let finish!: (value: FileHistoryResult) => void;
    client.history.mockImplementationOnce(async () => new Promise(resolve => { finish = resolve; }));
    const pending = service.history({ queryId: "duplicate", target, path: "file" });
    await vi.waitFor(() => expect(client.history).toHaveBeenCalled());
    await expect(service.history({ queryId: "duplicate", target, path: "another" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    finish(empty);
    await pending;
    expect(client.history).toHaveBeenCalledTimes(1);
  });
});
const empty: FileHistoryResult = { revision: null, path: "file", entries: [], nextOffset: null, status: "empty" };
function setup() {
  const workspace = createEmptyWorkspace();
  workspace.groups = [{ id: "group", name: "group", targets: [target], collapsed: false }];
  workspace.worktrees = [{
    id: "wt", repositoryId: "repo", name: "repo", path: "C:/repo", canonicalPath: "c:/repo",
    head: "a".repeat(40), branch: "main", isPrimary: true, isBare: false, isDetached: false, isLocked: false, isPrunable: false
  }];
  const client = {
    history: vi.fn<FileHistoryClient["history"]>(async () => empty),
    diff: vi.fn<FileHistoryClient["diff"]>(async (_path, query) => ({ ...query, patch: "", status: "empty" }))
  };
  const runtime = { getCurrent: vi.fn(async () => workspace) };
  return { service: new FileHistoryService(runtime, client), client, workspace };
}
