/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GitNestBridge, GitReadResult, RepositoryTargetDto, RepositoryWorkflowStateDto, WorkspaceOperationDto
} from "@gitnest/contracts";
import { useRepositoryWorkflow, type RepositoryWorkflowController } from "./useRepositoryWorkflow";

const targetA = { repositoryId: "repository-a", worktreeId: "worktree-a" };
const targetB = { repositoryId: "repository-b", worktreeId: "worktree-b" };
type InspectResult = GitReadResult<RepositoryWorkflowStateDto>;

describe("useRepositoryWorkflow inspect scheduling", () => {
  let root: Root;
  let container: HTMLDivElement;
  let controller: RepositoryWorkflowController;
  const inspect = vi.fn<GitNestBridge["repositoryWorkflow"]["inspect"]>();
  const preflight = vi.fn<GitNestBridge["repositoryWorkflow"]["preflight"]>();
  const execute = vi.fn<GitNestBridge["repositoryWorkflow"]["execute"]>();
  function Harness({ target, operations, workspaceId, autoInspect, contentRevision }: {
    target: RepositoryTargetDto | undefined; operations: WorkspaceOperationDto[]; workspaceId: string; autoInspect: boolean;
    contentRevision?: string | undefined
  }) {
    controller = useRepositoryWorkflow(target, operations, workspaceId, autoInspect, contentRevision);
    return null;
  }
  async function render(
    target = targetA, operations: WorkspaceOperationDto[] = [], workspaceId = "workspace", autoInspect = true,
    contentRevision?: string
  ) {
    await act(async () => root.render(
      <Harness target={target} operations={operations} workspaceId={workspaceId} autoInspect={autoInspect}
        contentRevision={contentRevision} />
    ));
  }
  async function queueWorkflow() {
    await act(async () => { expect(await controller.request({ type: "skip" })).toBe(true); });
    await act(async () => { expect(await controller.confirm()).toBe(true); });
  }
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    inspect.mockReset().mockImplementation(async ({ target }) => ({ ok: true, value: state(target) }));
    preflight.mockReset().mockImplementation(async ({ command }) => ({
      ok: true, value: {
        preflightId: "preflight", expiresAt: "2026-10-06T15:00:00Z", command,
        state: state(command.target, "preflight"), summary: "跳过", warnings: [], confirmationRequired: true
      }
    }));
    execute.mockReset().mockResolvedValue({ ok: true, value: { operationId: "workflow" } });
    vi.stubGlobal("gitnest", { repositoryWorkflow: { inspect, preflight, execute } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("issues one inspect per target switch even with different terminal histories", async () => {
    const history = [operation("completed-a", "succeeded")];
    await render(targetA, history);
    expect(inspect).toHaveBeenCalledTimes(1);
    await render(targetB, history);
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(controller.state?.target).toEqual(targetB);
    await render(targetB, history, "other-workspace");
    expect(inspect).toHaveBeenCalledTimes(3);
  });

  it("shares repeated reloads until the in-flight read settles", async () => {
    const read = deferred<InspectResult>();
    inspect.mockReturnValueOnce(read.promise);
    await render();
    let requests: Promise<RepositoryWorkflowStateDto | null>[] = [];
    act(() => { requests = Array.from({ length: 10 }, () => controller.reload()); });
    expect(inspect).toHaveBeenCalledTimes(1);
    await act(async () => { read.resolve({ ok: true, value: state() }); await Promise.all(requests); });
    expect(await Promise.all(requests)).toEqual(Array.from({ length: 10 }, () => state()));
    expect(controller.inspecting).toBe(false);
  });

  it("refreshes a finished workflow once while preserving completion feedback", async () => {
    await render();
    await queueWorkflow();
    await render(targetA, [operation("workflow", "succeeded")]);
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(controller.completionVersion).toBe(1);
    expect(controller.notice).toBe("操作完成");
    await render(targetA, [operation("workflow", "succeeded")]);
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(controller.completionVersion).toBe(1);
  });

  it("waits for an old read then obtains a fresh snapshot after a mutation completes", async () => {
    await render();
    const old = deferred<InspectResult>();
    const fresh = deferred<InspectResult>();
    inspect.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    act(() => { void controller.reload(); });
    await render(targetA, [operation("external", "succeeded")]);
    expect(inspect).toHaveBeenCalledTimes(2);
    await act(async () => { old.resolve({ ok: true, value: state(targetA, "stale") }); });
    expect(inspect).toHaveBeenCalledTimes(3);
    expect(controller.state?.headMessage).toBe("initial");
    expect(controller.inspecting).toBe(true);
    await act(async () => { fresh.resolve({ ok: true, value: state(targetA, "fresh") }); });
    expect(controller.state?.headMessage).toBe("fresh");
    expect(controller.inspecting).toBe(false);
  });

  it("does not refresh when old operation records are reordered or trimmed", async () => {
    const first = operation("first", "succeeded");
    const second = operation("second", "failed");
    await render(targetA, [first, second]);
    await render(targetA, [second, first]);
    await render(targetA, [second]);
    expect(inspect).toHaveBeenCalledTimes(1);
    await render(targetA, [second, operation("new", "cancelled")]);
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it("does not let an earlier inspect overwrite a successful strict preflight", async () => {
    const old = deferred<InspectResult>();
    inspect.mockReturnValueOnce(old.promise);
    await render();
    await act(async () => { await controller.request({ type: "skip" }); });
    expect(controller.state?.headMessage).toBe("preflight");
    await act(async () => { old.resolve({ ok: true, value: state(targetA, "stale") }); });
    expect(controller.state?.headMessage).toBe("preflight");
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it("ignores stale target and workspace responses without clearing the current loading state", async () => {
    const oldTarget = deferred<InspectResult>();
    const oldWorkspace = deferred<InspectResult>();
    const current = deferred<InspectResult>();
    inspect.mockReturnValueOnce(oldTarget.promise).mockReturnValueOnce(oldWorkspace.promise).mockReturnValueOnce(current.promise);
    await render();
    await render(targetB);
    await render(targetB, [], "new-workspace");
    await act(async () => {
      oldTarget.resolve({ ok: true, value: state(targetA, "old target") });
      oldWorkspace.resolve({ ok: false, error: { code: "INVALID_REQUEST", message: "old workspace", details: {} } });
    });
    expect(controller.state).toBeNull();
    expect(controller.error).toBeNull();
    expect(controller.inspecting).toBe(true);
    await act(async () => { current.resolve({ ok: true, value: state(targetB, "current") }); });
    expect(controller.state?.headMessage).toBe("current");
    expect(controller.inspecting).toBe(false);
  });

  it("refreshes once when execution finishes before its IPC acknowledgement", async () => {
    await render();
    const acknowledgement = deferred<Awaited<ReturnType<GitNestBridge["repositoryWorkflow"]["execute"]>>>();
    execute.mockReturnValueOnce(acknowledgement.promise);
    await act(async () => { await controller.request({ type: "skip" }); });
    act(() => { void controller.confirm(); });
    await render(targetA, [operation("workflow", "succeeded")]);
    expect(inspect).toHaveBeenCalledTimes(2);
    await act(async () => { acknowledgement.resolve({ ok: true, value: { operationId: "workflow" } }); });
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(controller.completionVersion).toBe(1);
    expect(controller.notice).toBe("操作完成");
  });

  it("does not inspect hidden views and fetches the latest snapshot once when shown", async () => {
    await render(targetA, [], "workspace", false);
    await render(targetA, [operation("old", "succeeded")], "workspace", false);
    await render(targetB, [], "workspace", false);
    expect(inspect).not.toHaveBeenCalled();
    await render(targetA, [operation("latest", "succeeded")], "workspace", true);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(controller.state?.target).toEqual(targetA);
  });

  it("keeps hidden workflow completion feedback and permits explicit draft reads", async () => {
    await render(targetA, [], "workspace", false);
    await queueWorkflow();
    await render(targetA, [operation("workflow", "succeeded")], "workspace", false);
    expect(inspect).not.toHaveBeenCalled();
    expect(controller.completionVersion).toBe(1);
    expect(controller.notice).toBe("操作完成");
    await act(async () => { await controller.reload(); });
    expect(inspect).toHaveBeenCalledTimes(1);
    await render(targetA, [operation("workflow", "succeeded")], "workspace", true);
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(controller.completionVersion).toBe(1);
  });

  it("stops queued automatic follow-ups when hidden and reads afresh on return", async () => {
    const old = deferred<InspectResult>();
    inspect.mockReturnValueOnce(old.promise);
    await render();
    const completed = [operation("external", "succeeded")];
    await render(targetA, completed);
    await render(targetA, completed, "workspace", false);
    await act(async () => { old.resolve({ ok: true, value: state(targetA, "hidden stale") }); });
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(controller.state).toBeNull();
    expect(controller.inspecting).toBe(false);
    await render(targetA, completed, "workspace", true);
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(controller.state?.headMessage).toBe("initial");
  });

  it("coalesces multiple operation completions into one fresh follow-up and ignores stale errors", async () => {
    const old = deferred<InspectResult>();
    inspect.mockReturnValueOnce(old.promise);
    await render();
    await render(targetA, [operation("first", "succeeded")]);
    await render(targetA, [operation("first", "succeeded"), operation("second", "failed")]);
    expect(inspect).toHaveBeenCalledTimes(1);
    await act(async () => {
      old.resolve({ ok: false, error: { code: "INVALID_REQUEST", message: "obsolete failure", details: {} } });
    });
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(controller.error).toBeNull();
    expect(controller.state?.headMessage).toBe("initial");
  });

  it("allows a retry after an inspect rejects and shares that retry", async () => {
    inspect.mockRejectedValueOnce(new Error("Git unavailable"));
    await render();
    expect(controller.error).toBe("Git unavailable");
    expect(controller.inspecting).toBe(false);
    await act(async () => { await Promise.all([controller.reload(), controller.reload()]); });
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(controller.state?.headMessage).toBe("initial");
  });

  it("coalesces the development StrictMode mount cycle", async () => {
    await act(async () => root.render(<React.StrictMode>
      <Harness target={targetA} operations={[]} workspaceId="workspace" autoInspect />
    </React.StrictMode>));
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(controller.state?.headMessage).toBe("initial");
  });

  it("clears loading if the selected target disappears while its inspect is pending", async () => {
    const old = deferred<InspectResult>();
    inspect.mockReturnValueOnce(old.promise);
    await render();
    expect(controller.inspecting).toBe(true);
    await act(async () => root.render(
      <Harness target={undefined} operations={[]} workspaceId="workspace" autoInspect />
    ));
    expect(controller.inspecting).toBe(false);
    expect(controller.state).toBeNull();
    await act(async () => { old.resolve({ ok: true, value: state() }); });
    expect(controller.state).toBeNull();
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it("does not inspect again for an unchanged snapshot content revision", async () => {
    await render(targetA, [], "workspace", true, "content-1");
    await render(targetA, [], "workspace", true, "content-1");
    await render(targetA, [], "workspace", true, "content-1");
    expect(inspect).toHaveBeenCalledTimes(1);
    await render(targetA, [], "workspace", true, "content-2");
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it("refreshes externally changed conflict state after discarding an earlier in-flight snapshot", async () => {
    const old = deferred<InspectResult>();
    const fresh = deferred<InspectResult>();
    inspect.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    await render(targetA, [], "workspace", true, "before-external-git");
    await render(targetA, [], "workspace", true, "external-conflict");
    expect(inspect).toHaveBeenCalledTimes(1);
    await act(async () => { old.resolve({ ok: true, value: { ...state(), operation: null } }); });
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(controller.state).toBeNull();
    expect(controller.inspecting).toBe(true);
    await act(async () => {
      fresh.resolve({ ok: true, value: { ...state(), operation: "merge", conflictedPaths: ["conflict.txt"] } });
    });
    expect(controller.state?.operation).toBe("merge");
    expect(controller.state?.conflictedPaths).toEqual(["conflict.txt"]);
    expect(controller.inspecting).toBe(false);
  });

  it("defers hidden snapshot changes until shown and then reads only the latest state", async () => {
    await render(targetA, [], "workspace", false, "content-1");
    await render(targetA, [], "workspace", false, "content-2");
    await render(targetA, [], "workspace", false, "content-3");
    expect(inspect).not.toHaveBeenCalled();
    inspect.mockResolvedValueOnce({ ok: true, value: { ...state(), operation: "rebase" } });
    await render(targetA, [], "workspace", true, "content-3");
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(controller.state?.operation).toBe("rebase");
    await render(targetA, [], "workspace", true, "content-3");
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it("keeps an explicit hidden draft read alive across snapshot changes and returns fresh state", async () => {
    const old = deferred<InspectResult>();
    const fresh = deferred<InspectResult>();
    inspect.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    await render(targetA, [], "workspace", false, "content-1");
    let draftRead!: Promise<RepositoryWorkflowStateDto | null>;
    await act(async () => { draftRead = controller.reload(); });
    expect(inspect).toHaveBeenCalledTimes(1);
    await render(targetA, [], "workspace", false, "content-2");
    await render(targetA, [], "workspace", false, "content-3");
    await act(async () => { old.resolve({ ok: true, value: state(targetA, "outdated draft") }); });
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(controller.state).toBeNull();
    expect(controller.inspecting).toBe(true);
    const latest = state(targetA, "fresh draft");
    await act(async () => {
      fresh.resolve({ ok: true, value: latest });
      expect(await draftRead).toEqual(latest);
    });
    expect(controller.state).toEqual(latest);
    expect(controller.inspecting).toBe(false);
    await render(targetA, [], "workspace", false, "content-4");
    expect(inspect).toHaveBeenCalledTimes(2);
  });
});

function state(target: RepositoryTargetDto = targetA, headMessage = "initial"): RepositoryWorkflowStateDto {
  return {
    target, head: "a".repeat(40), branch: "main", headMessage, parentCount: 1,
    operation: "cherry-pick", conflictedPaths: [], changedPaths: [], hasStagedChanges: false,
    hasUntrackedFiles: false, untrackedPaths: [], remoteBranchesContainingHead: [], fingerprint: ""
  };
}
function operation(id: string, status: WorkspaceOperationDto["state"]): WorkspaceOperationDto {
  return {
    id, kind: "workflow", scope: "repository", targetIds: ["repository-a:worktree-a"],
    state: status, progress: 1, succeeded: status === "succeeded" ? 1 : 0,
    failed: status === "failed" ? 1 : 0, message: "操作完成"
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}
