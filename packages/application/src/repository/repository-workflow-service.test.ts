import { describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "@gitnest/workspace-core";
import type { GitWorkflowClient, GitWorkflowState } from "@gitnest/git-core";
import type { RepositoryCommandRuntime } from "./repository-command-service";
import { RepositoryWorkflowService, type RepositoryWorkflowCommand } from "./repository-workflow-service";

const target = { repositoryId: "repo", worktreeId: "wt" };
const amend: RepositoryWorkflowCommand = { type: "amend", target, message: "new message" };

describe("RepositoryWorkflowService", () => {
  it("uses lightweight UI inspection but strict preflight inspection", async () => {
    const fixture = setup();
    await fixture.service.inspect(target);
    expect(fixture.client.inspect).toHaveBeenLastCalledWith("C:/repo", { includeFingerprint: false });
    await fixture.service.preflight(amend);
    expect(fixture.client.inspect).toHaveBeenLastCalledWith("C:/repo");
  });
  it("queues the exact target with cancellation signal and retains operationId", async () => {
    const fixture = setup();
    const preflight = await fixture.service.preflight(amend);
    expect(await fixture.service.execute(amend, preflight.preflightId, true)).toEqual({ operationId: "operation-1" });
    expect(fixture.runtime.queueRepositoryOperation).toHaveBeenCalledWith(target, "workflow", expect.any(Function), { expectedWorkspaceId: "default" });
    await fixture.run();
    expect(fixture.client.execute).toHaveBeenCalledWith("C:/repo", amend, { signal: fixture.signal });
  });
  it("requires explicit confirmation without consuming preflight", async () => {
    const fixture = setup();
    const preflight = await fixture.service.preflight(amend);
    await expect(fixture.service.execute(amend, preflight.preflightId, false)).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    await expect(fixture.service.execute(amend, preflight.preflightId, true)).resolves.toBeDefined();
  });
  it("expires old preflights", async () => {
    const fixture = setup();
    const preflight = await fixture.service.preflight(amend);
    fixture.advance(60_001);
    await expect(fixture.service.execute(amend, preflight.preflightId, true)).rejects.toMatchObject({ code: "PREFLIGHT_EXPIRED" });
  });
  it("consumes authorization once under concurrent execution", async () => {
    const fixture = setup();
    const preflight = await fixture.service.preflight(amend);
    const results = await Promise.allSettled([fixture.service.execute(amend, preflight.preflightId, true), fixture.service.execute(amend, preflight.preflightId, true)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(fixture.runtime.queueRepositoryOperation).toHaveBeenCalledTimes(1);
  });
  it("expires queued authorization before touching Git", async () => {
    const fixture = setup();
    const preflight = await fixture.service.preflight(amend);
    await fixture.service.execute(amend, preflight.preflightId, true);
    fixture.advance(60_001);
    await expect(fixture.run()).rejects.toMatchObject({ code: "PREFLIGHT_EXPIRED" });
    expect(fixture.client.execute).not.toHaveBeenCalled();
  });
  it.each(["before-queue", "inside-queue"] as const)("blocks changed bytes %s", async phase => {
    const fixture = setup();
    const preflight = await fixture.service.preflight(amend);
    if (phase === "inside-queue") await fixture.service.execute(amend, preflight.preflightId, true);
    fixture.state.fingerprint = "different-file-bytes-same-status";
    await expect(phase === "inside-queue" ? fixture.run() : fixture.service.execute(amend, preflight.preflightId, true)).rejects.toMatchObject({ code: "PREFLIGHT_CHANGED" });
    expect(fixture.client.execute).not.toHaveBeenCalled();
  });
  it("blocks workspace switches and changed command parameters", async () => {
    const fixture = setup();
    const first = await fixture.service.preflight(amend);
    await expect(fixture.service.execute({ ...amend, message: "different" }, first.preflightId, true)).rejects.toMatchObject({ code: "PREFLIGHT_CHANGED" });
    fixture.workspace.id = "another-workspace";
    await expect(fixture.service.execute(amend, first.preflightId, true)).rejects.toMatchObject({ code: "PREFLIGHT_CHANGED" });
  });
  it("does not let callers mutate stored authorization", async () => {
    const fixture = setup();
    const preflight = await fixture.service.preflight(amend);
    if (preflight.command.type === "amend") preflight.command.message = "different";
    await expect(fixture.service.execute(amend, preflight.preflightId, true)).resolves.toBeDefined();
  });
  it("rejects unregistered targets", async () => {
    const fixture = setup();
    fixture.workspace.groups = [];
    await expect(fixture.service.inspect(target)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it("warns about known published history and complete staged content", async () => {
    const fixture = setup();
    fixture.state.remoteBranchesContainingHead = ["origin/main"];
    const result = await fixture.service.preflight(amend);
    expect(result.warnings.join("\n")).toContain("origin/main");
    expect(result.warnings.join("\n")).toContain("全部暂存内容");
  });
  it.each(["continue", "abort", "skip", "keep-empty"] as const)("requires an active operation for %s", async type => {
    const fixture = setup();
    await expect(fixture.service.preflight({ type, target })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it("requires all conflicts resolved before continue but permits abort", async () => {
    const fixture = setup();
    fixture.state.operation = "rebase"; fixture.state.conflictedPaths = ["file.txt"];
    await expect(fixture.service.preflight({ type: "continue", target })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect((await fixture.service.preflight({ type: "abort", target })).warnings.join("")).toContain("丢弃");
  });
  it("previews the exact skipped commit and queues it with the existing one-use authorization", async () => {
    const fixture = setup();
    fixture.state.operation = "cherry-pick";
    fixture.state.currentReplay = replay();
    const command = { type: "skip", target } as const;
    const preview = await fixture.service.preflight(command);
    expect(preview.summary).toContain("bbbbbbbbbbbb replay subject");
    expect(preview.warnings.join("")).toContain("丢弃");
    await fixture.service.execute(command, preview.preflightId, true);
    await fixture.run();
    expect(fixture.client.execute).toHaveBeenCalledWith("C:/repo", command, { signal: fixture.signal });
    await expect(fixture.service.execute(command, preview.preflightId, true)).rejects.toMatchObject({ code: "PREFLIGHT_EXPIRED" });
  });
  it("rejects repeat continue on an empty replay and offers an explicit keep-empty preview", async () => {
    const fixture = setup();
    fixture.state.operation = "rebase";
    fixture.state.currentReplay = replay({ isEmpty: true, canKeepEmpty: true });
    await expect(fixture.service.preflight({ type: "continue", target })).rejects.toThrow("保留空提交");
    expect((await fixture.service.preflight({ type: "keep-empty", target })).warnings.join("")).toContain("不修改文件");
  });
  it.each(["skip", "keep-empty"] as const)("rejects %s during merge or without an identified replay", async type => {
    const fixture = setup();
    fixture.state.operation = "merge";
    fixture.state.currentReplay = replay({ isEmpty: true, canKeepEmpty: true });
    await expect(fixture.service.preflight({ type, target })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    fixture.state.operation = "rebase";
    fixture.state.currentReplay = null;
    await expect(fixture.service.preflight({ type, target })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it("blocks unsafe skip and refuses to bundle newly staged content into an empty commit", async () => {
    const fixture = setup();
    fixture.state.operation = "revert";
    fixture.state.currentReplay = replay({ canSkip: false, blockedReason: "outside replay edits" });
    await expect(fixture.service.preflight({ type: "skip", target })).rejects.toThrow("outside replay edits");
    fixture.state.currentReplay = replay({ isEmpty: true, canKeepEmpty: true });
    fixture.state.hasStagedChanges = true;
    await expect(fixture.service.preflight({ type: "keep-empty", target })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it("rechecks replay identity and skip capability inside the queue", async () => {
    const fixture = setup();
    fixture.state.operation = "cherry-pick";
    fixture.state.currentReplay = replay();
    const command = { type: "skip", target } as const;
    const preview = await fixture.service.preflight(command);
    await fixture.service.execute(command, preview.preflightId, true);
    fixture.state.currentReplay.canSkip = false;
    await expect(fixture.run()).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fixture.client.execute).not.toHaveBeenCalled();
  });
  it("allows marking only current conflicts and explains manual resolution", async () => {
    const fixture = setup();
    fixture.state.conflictedPaths = ["file.txt"];
    await expect(fixture.service.preflight({ type: "mark-resolved", target, paths: ["other.txt"] })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect((await fixture.service.preflight({ type: "mark-resolved", target, paths: ["file.txt"] })).warnings.join("")).toContain("不会自动合并");
  });
  it("blocks creating stash without eligible changes", async () => {
    const fixture = setup();
    await expect(fixture.service.preflight({ type: "create-stash", target })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    fixture.state.changedPaths = ["new.txt"]; fixture.state.untrackedPaths = ["new.txt"]; fixture.state.hasUntrackedFiles = true;
    await expect(fixture.service.preflight({ type: "create-stash", target })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(fixture.service.preflight({ type: "create-stash", target, includeUntracked: true })).resolves.toBeDefined();
  });
  it.each([false, true])("rejects partial stash of removed index paths before issuing a preview (untracked=%s)", async includeUntracked => {
    const fixture = setup();
    fixture.state.changedPaths = ["old.txt", "renamed.txt", "other.txt"];
    fixture.state.partialStashBlockedPaths = ["old.txt"];
    await expect(fixture.service.preflight({
      type: "create-stash", target, paths: ["renamed.txt", "old.txt"], includeUntracked
    })).rejects.toThrow("请在储藏面板右键选择“创建储藏”");
    expect(fixture.runtime.queueRepositoryOperation).not.toHaveBeenCalled();
    expect(fixture.client.execute).not.toHaveBeenCalled();
    await expect(fixture.service.preflight({
      type: "create-stash", target, paths: ["other.txt"], includeUntracked
    })).resolves.toBeDefined();
    await expect(fixture.service.preflight({
      type: "create-stash", target, includeUntracked
    })).resolves.toBeDefined();
  });
  it.each(["../outside", "/absolute", "C:/drive", "file\0name", "folder\\..\\file"])("rejects unsafe path %s", async path => {
    const fixture = setup();
    await expect(fixture.service.preflight({ type: "create-stash", target, paths: [path] })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it("rejects initial commit undo and merge commit replay", async () => {
    const fixture = setup();
    fixture.state.parentCount = 0;
    await expect(fixture.service.preflight({ type: "undo-commit", target, mode: "soft" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    fixture.client.validateCommit.mockRejectedValueOnce(new Error("merge needs mainline"));
    await expect(fixture.service.preflight({ type: "cherry-pick", target, commitHash: "b".repeat(40) })).rejects.toThrow("merge needs mainline");
  });
  it("rejects replay while dirty or another operation is active", async () => {
    const fixture = setup();
    fixture.state.changedPaths = ["dirty.txt"];
    await expect(fixture.service.preflight({ type: "revert", target, commitHash: "b".repeat(40) })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    fixture.state.operation = "merge";
    await expect(fixture.service.preflight(amend)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});

function replay(overrides: Partial<NonNullable<GitWorkflowState["currentReplay"]>> = {}) {
  return { commitHash: "b".repeat(40), subject: "replay subject", isEmpty: false, canSkip: true, canKeepEmpty: false, ...overrides };
}

function setup() {
  const workspace = createEmptyWorkspace();
  workspace.groups = [{ id: "group", name: "group", targets: [target], collapsed: false }];
  workspace.worktrees = [{
    id: "wt", repositoryId: "repo", name: "repo", path: "C:/repo", canonicalPath: "c:/repo",
    head: "a".repeat(40), branch: "main", isPrimary: true, isBare: false, isDetached: false, isLocked: false, isPrunable: false
  }];
  workspace.repositories = [{ id: "repo", name: "repo", commonDir: "C:/repo/.git", canonicalCommonDir: "c:/repo/.git", worktreeIds: ["wt"], primaryWorktreeId: "wt" }];
  const state: GitWorkflowState = {
    head: "a".repeat(40), branch: "main", headMessage: "old", parentCount: 1, operation: null,
    conflictedPaths: [], changedPaths: [], hasStagedChanges: false, hasUntrackedFiles: false, untrackedPaths: [],
    remoteBranchesContainingHead: [], fingerprint: "same"
  };
  const client = {
    inspect: vi.fn(async () => structuredClone(state)),
    validateCommit: vi.fn<GitWorkflowClient["validateCommit"]>(async () => undefined),
    execute: vi.fn<GitWorkflowClient["execute"]>(async () => undefined)
  };
  let action: (path: string, signal: AbortSignal) => Promise<void>;
  const signal = new AbortController().signal;
  const runtime = {
    getCurrent: vi.fn(async () => workspace),
    queueRepositoryOperation: vi.fn<RepositoryCommandRuntime["queueRepositoryOperation"]>(async (_target, _kind, callback) => {
      action = callback;
      return { operationId: "operation-1" };
    }),
    cancelOperation: vi.fn(async () => undefined)
  };
  let now = Date.parse("2026-10-06T00:00:00Z");
  let sequence = 0;
  const service = new RepositoryWorkflowService(runtime, client, { clock: () => new Date(now).toISOString(), idFactory: () => `workflow-${++sequence}` });
  return { service, state, client, workspace, runtime, signal, advance: (ms: number) => { now += ms; }, run: () => action("C:/repo", signal) };
}
