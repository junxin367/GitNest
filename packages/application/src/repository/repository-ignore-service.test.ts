import { describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "@gitnest/workspace-core";
import type { GitIgnoreClient, GitIgnorePlan } from "@gitnest/git-core";
import type { RepositoryCommandRuntime } from "./repository-command-service";
import { RepositoryIgnoreService } from "./repository-ignore-service";

const target = { repositoryId: "repo", worktreeId: "wt" };
const input = { target, path: "new.txt", scope: "file" as const };
describe("RepositoryIgnoreService", () => {
  it("queues the exact target with cancellation and protected plan", async () => {
    const f = setup();
    const preview = await f.service.preflight(input);
    expect(preview).not.toHaveProperty("fingerprint");
    expect(await f.service.execute(preview.preflightId, true)).toEqual({ operationId: "operation-1" });
    expect(f.runtime.queueRepositoryOperation).toHaveBeenCalledWith(target, "ignore-file", expect.any(Function), { expectedWorkspaceId: "default" });
    await f.run();
    expect(f.client.execute).toHaveBeenCalledWith("C:/repo", f.plan, { signal: f.signal });
  });
  it("requires confirmation without consuming authorization", async () => {
    const f = setup(); const p = await f.service.preflight(input);
    await expect(f.service.execute(p.preflightId, false)).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    await expect(f.service.execute(p.preflightId, true)).resolves.toBeDefined();
  });
  it("consumes authorization once under concurrent execution", async () => {
    const f = setup(); const p = await f.service.preflight(input);
    const results = await Promise.allSettled([f.service.execute(p.preflightId, true), f.service.execute(p.preflightId, true)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(f.runtime.queueRepositoryOperation).toHaveBeenCalledTimes(1);
  });
  it.each(["before-queue", "inside-queue"] as const)("rejects expired authorization %s", async phase => {
    const f = setup(); const p = await f.service.preflight(input);
    if (phase === "inside-queue") await f.service.execute(p.preflightId, true);
    f.advance(60_001);
    await expect(phase === "inside-queue" ? f.run() : f.service.execute(p.preflightId, true)).rejects.toMatchObject({ code: "PREFLIGHT_EXPIRED" });
    expect(f.client.execute).not.toHaveBeenCalled();
  });
  it("rejects changed ignore state before queue submission", async () => {
    const f = setup(); const p = await f.service.preflight(input);
    f.plan.fingerprint = "changed";
    await expect(f.service.execute(p.preflightId, true)).rejects.toMatchObject({ code: "PREFLIGHT_CHANGED" });
    expect(f.runtime.queueRepositoryOperation).not.toHaveBeenCalled();
  });
  it("delegates in-queue state verification to the write adapter", async () => {
    const f = setup(); const p = await f.service.preflight(input);
    await f.service.execute(p.preflightId, true);
    f.client.execute.mockRejectedValueOnce(new Error("changed while queued"));
    await expect(f.run()).rejects.toThrow("changed while queued");
  });
  it.each(["workspace", "path", "unregister"] as const)("rejects stale registered target %s", async field => {
    const f = setup(); const p = await f.service.preflight(input);
    if (field === "workspace") f.workspace.id = "other";
    if (field === "path") f.workspace.worktrees[0]!.path = "C:/other";
    if (field === "unregister") f.workspace.groups = [];
    await expect(f.service.execute(p.preflightId, true)).rejects.toMatchObject({ code: field === "unregister" ? "INVALID_REQUEST" : "PREFLIGHT_CHANGED" });
    expect(f.runtime.queueRepositoryOperation).not.toHaveBeenCalled();
  });
  it("does not allow UI mutation to rewrite the stored rule or target", async () => {
    const f = setup(); const p = await f.service.preflight(input);
    p.rule = "/different"; p.target.worktreeId = "other";
    await f.service.execute(p.preflightId, true);
    await f.run();
    expect(f.client.execute).toHaveBeenCalledWith("C:/repo", expect.objectContaining({ rule: "/new.txt" }), expect.anything());
  });
  it("rejects bare or unregistered Worktrees", async () => {
    const f = setup(); f.workspace.worktrees[0]!.isBare = true;
    await expect(f.service.preflight(input)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(f.client.inspect).not.toHaveBeenCalled();
  });
});
function setup() {
  const workspace = createEmptyWorkspace();
  workspace.groups = [{ id: "group", name: "group", targets: [target], collapsed: false }];
  workspace.worktrees = [{
    id: "wt", repositoryId: "repo", name: "repo", path: "C:/repo", canonicalPath: "c:/repo",
    head: "a".repeat(40), branch: "main", isPrimary: true, isBare: false, isDetached: false, isLocked: false, isPrunable: false
  }];
  workspace.repositories = [{ id: "repo", name: "repo", commonDir: "C:/repo/.git", canonicalCommonDir: "c:/repo/.git", worktreeIds: ["wt"], primaryWorktreeId: "wt" }];
  const plan: GitIgnorePlan = { path: "new.txt", scope: "file", rule: "/new.txt", ignoreFilePath: "C:/repo/.gitignore", summary: "ignore", warnings: [], fingerprint: "same" };
  const client = {
    inspect: vi.fn<GitIgnoreClient["inspect"]>(async () => structuredClone(plan)),
    execute: vi.fn<GitIgnoreClient["execute"]>(async () => undefined)
  };
  let action: (path: string, signal: AbortSignal) => Promise<void>;
  const signal = new AbortController().signal;
  const runtime = {
    getCurrent: vi.fn(async () => workspace),
    queueRepositoryOperation: vi.fn<RepositoryCommandRuntime["queueRepositoryOperation"]>(async (_target, _kind, callback) => { action = callback; return { operationId: "operation-1" }; }),
    cancelOperation: vi.fn(async () => undefined)
  };
  let now = Date.parse("2026-10-06T00:00:00Z"); let sequence = 0;
  const service = new RepositoryIgnoreService(runtime, client, { clock: () => new Date(now).toISOString(), idFactory: () => `ignore-${++sequence}` });
  return { service, plan, client, workspace, runtime, signal, advance: (ms: number) => { now += ms; }, run: () => action("C:/repo", signal) };
}
