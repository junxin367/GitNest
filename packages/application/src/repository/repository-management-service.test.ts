import { describe, expect, it, vi } from "vitest";
import type { RepositoryManagementPort, RepositoryManagementState } from "@gitnest/git-core";
import type { Workspace } from "@gitnest/workspace-core";
import { RepositoryManagementService, remoteCommitUrl, type ManagementRuntime } from "./repository-management-service";

const target = { repositoryId: "repo", worktreeId: "tree" };
function setup() {
  let state: RepositoryManagementState = { remotes: [], tags: [] };
  let head = "a".repeat(40);
  const workspace: Workspace = {
    schemaVersion: 2, id: "workspace", name: "Workspace", excludes: [], groups: [], scanIssues: [], repositories: [], updatedAt: "",
    worktrees: [{ id: "tree", repositoryId: "repo", name: "repo", path: "/repo", canonicalPath: "/repo", head, isPrimary: true, isBare: false, isDetached: false, isLocked: false, isPrunable: false }]
  };
  const queue: Array<(path: string, signal: AbortSignal) => Promise<void>> = [];
  const runtime: ManagementRuntime = {
    getCurrent: async () => workspace,
    queueRepositoryOperation: vi.fn(async (_target, _kind, action) => { queue.push(action); return { operationId: "operation" }; })
  };
  const git: RepositoryManagementPort = {
    inspect: vi.fn(async () => structuredClone(state)), validateAction: vi.fn(async () => undefined),
    resolveCommit: vi.fn(async () => head), execute: vi.fn(async () => undefined),
    create: vi.fn(async () => undefined)
  };
  return { service: new RepositoryManagementService(runtime, git), git, runtime, queue, workspace, setState(next: RepositoryManagementState) { state = next; }, setHead(next: string) { head = next; } };
}
describe("RepositoryManagementService", () => {
  it("queues confirmed writes in the owning workspace and consumes preflight once", async () => {
    const { service, runtime, queue, git } = setup();
    const preflight = await service.preflight({ target, action: { type: "remote-add", name: "origin", url: "https://github.com/a/b" } });
    await expect(service.execute(preflight.preflightId, false)).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    await expect(service.execute(preflight.preflightId, true)).resolves.toEqual({ operationId: "operation" });
    expect(runtime.queueRepositoryOperation).toHaveBeenCalledWith(target, "remote-add", expect.any(Function), { expectedWorkspaceId: "workspace" });
    expect(git.execute).not.toHaveBeenCalled();
    await queue[0]!("/repo", new AbortController().signal);
    expect(git.execute).toHaveBeenCalledOnce();
    await expect(service.execute(preflight.preflightId, true)).rejects.toMatchObject({ code: "PREFLIGHT_EXPIRED" });
  });
  it("rejects a changed remote configuration after queuing", async () => {
    const { service, queue, git, setState } = setup();
    const preflight = await service.preflight({ target, action: { type: "remote-add", name: "origin", url: "https://github.com/a/b" } });
    await service.execute(preflight.preflightId, true);
    setState({ remotes: [{ name: "origin", fetchUrl: "https://github.com/changed/repo", pushUrl: "https://github.com/changed/repo" }], tags: [] });
    await expect(queue[0]!("/repo", new AbortController().signal)).rejects.toMatchObject({ code: "PREFLIGHT_CHANGED" });
    expect(git.execute).not.toHaveBeenCalled();
  });
  it("rejects branch movement between tag confirmation and execution", async () => {
    const { service, queue, git, setHead } = setup();
    const preflight = await service.preflight({ target, action: { type: "tag-create", name: "v1", revision: "HEAD" } });
    await service.execute(preflight.preflightId, true);
    setHead("b".repeat(40));
    await expect(queue[0]!("/repo", new AbortController().signal)).rejects.toMatchObject({ code: "PREFLIGHT_CHANGED" });
    expect(git.execute).not.toHaveBeenCalled();
  });
  it("does not retain caller-owned command references", async () => {
    const { service, queue, git } = setup();
    const command = { target: { ...target }, action: { type: "remote-add" as const, name: "origin", url: "https://github.com/a/b" } };
    const preflight = await service.preflight(command);
    command.action.url = "https://github.com/other/repo";
    preflight.command.action.name = "changed";
    await service.execute(preflight.preflightId, true);
    await queue[0]!("/repo", new AbortController().signal);
    expect(git.execute).toHaveBeenCalledWith("/repo", { type: "remote-add", name: "origin", url: "https://github.com/a/b" }, expect.any(AbortSignal));
  });
  it("expires old confirmations", async () => {
    const { service } = setup();
    const preflight = await service.preflight({ target, action: { type: "tag-delete", name: "v1" } });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    await expect(service.execute(preflight.preflightId, true)).rejects.toMatchObject({ code: "PREFLIGHT_EXPIRED" });
  });
  it("rejects stale targets", async () => {
    const { service } = setup();
    await expect(service.inspect({ repositoryId: "other", worktreeId: "tree" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it("tracks progress and completes creation without auto-registering anything", async () => {
    const { service, git } = setup();
    let complete!: () => void;
    git.create = vi.fn((_input, _signal, progress) => { progress("Receiving objects: 50%"); return new Promise<void>((resolve) => { complete = resolve; }); });
    const initial = service.create({ kind: "clone", destination: "/new", url: "https://github.com/a/b" });
    expect(service.creationStatus(initial.operationId)).toMatchObject({ state: "running", message: "Receiving objects: 50%" });
    expect(() => service.create({ kind: "init", destination: "/other" })).toThrow();
    complete(); await Promise.resolve();
    expect(service.creationStatus(initial.operationId).state).toBe("succeeded");
  });
  it("cancels owned creation and preserves destination information", async () => {
    const { service, git } = setup();
    git.create = vi.fn((_input, signal) => new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("cancel")), { once: true })));
    const initial = service.create({ kind: "clone", destination: "/partial", url: "https://github.com/a/b" });
    service.cancelCreation(initial.operationId); await Promise.resolve();
    expect(service.creationStatus(initial.operationId)).toMatchObject({ state: "cancelled", destination: "/partial" });
    expect(service.creationStatus(initial.operationId).message).toContain("保留");
  });
  it("waits for process termination on disposal and rejects new creation", async () => {
    const { service, git } = setup();
    let acknowledgeTermination!: () => void;
    let signal!: AbortSignal;
    git.create = vi.fn((_input, currentSignal) => {
      signal = currentSignal;
      return new Promise<void>((_resolve, reject) => { acknowledgeTermination = () => reject(new Error("terminated")); });
    });
    const initial = service.create({ kind: "clone", destination: "/partial", url: "https://github.com/a/b" });
    let disposed = false;
    const disposal = service.dispose().then(() => { disposed = true; });
    expect(signal.aborted).toBe(true);
    await Promise.resolve();
    expect(disposed).toBe(false);
    expect(() => service.create({ kind: "init", destination: "/another" })).toThrow();
    acknowledgeTermination(); await disposal;
    expect(disposed).toBe(true);
    expect(service.creationStatus(initial.operationId).state).toBe("cancelled");
  });
  it("resolves the default remote and validates selected commit", async () => {
    const { service, setState } = setup();
    setState({ remotes: [{ name: "origin", fetchUrl: "git@github.com:owner/repository.git", pushUrl: "" }], tags: [] });
    await expect(service.commitUrl(target, "a".repeat(40))).resolves.toEqual({ url: `https://github.com/owner/repository/commit/${"a".repeat(40)}` });
    await expect(service.commitUrl(target, "--help")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});
describe("remoteCommitUrl", () => {
  it.each([
    ["git@github.com:owner/repository.git", "https://github.com/owner/repository/commit/"],
    ["ssh://git@gitlab.com/group/nested/repository.git", "https://gitlab.com/group/nested/repository/-/commit/"],
    ["https://gitee.com/owner/repository.git", "https://gitee.com/owner/repository/commit/"]
  ])("maps %s safely", (remote, expected) => expect(remoteCommitUrl(remote, "abc")).toBe(`${expected}abc`));
  it.each(["file:///tmp/repo", "https://github.com.evil.test/a/b", "javascript:alert(1)", "https://example.test/a/b"])("rejects unsupported or misleading %s", (remote) => expect(() => remoteCommitUrl(remote, "abc")).toThrow());
});
