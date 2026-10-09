/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepositoryWorkflowStateDto } from "@gitnest/contracts";
import { RepositoryWorkflowDraftDialog, RepositoryWorkflowToolbar } from "./RepositoryWorkflowToolbar";
import type { RepositoryWorkflowController } from "./useRepositoryWorkflow";
import { useRepositoryWorkflow } from "./useRepositoryWorkflow";
import type { ExternalApplicationController } from "../external-application/useExternalApplications";

describe("RepositoryWorkflowToolbar conflict choices", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  const button = (label: string) => [...container.querySelectorAll("button")].find(entry => entry.textContent === label);
  const render = (controller: RepositoryWorkflowController, busy = false) => act(() => root.render(
    <RepositoryWorkflowToolbar controller={controller} busy={busy} externalApplications={externalApplications} />
  ));

  it("adds no toolbar or spacing content to a normal changes page", () => {
    render(fixture({ operation: null, currentReplay: null, conflictedPaths: [] }));
    expect(container.childElementCount).toBe(0);
    render(fixture());
    for (const label of ["创建储藏", "储藏当前文件", "修正最近提交", "撤销最近提交", "刷新操作状态"]) {
      expect(button(label)).toBeUndefined();
    }
  });
  it("opens the shared amend draft independently of the changes toolbar and reads current HEAD", async () => {
    const controller = fixture({ operation: null, currentReplay: null, conflictedPaths: [] });
    controller.draft = { type: "amend" };
    controller.reload = vi.fn(async () => ({ ...controller.state!, headMessage: "Current HEAD message" }));
    await act(async () => root.render(<RepositoryWorkflowDraftDialog controller={controller} />));
    const dialog = document.querySelector("[role='dialog']")!;
    expect(controller.reload).toHaveBeenCalledTimes(1);
    expect(dialog.querySelector("textarea")?.value).toBe("Current HEAD message");
    await act(async () => [...dialog.querySelectorAll("button")].find(entry => entry.textContent === "检查并继续")!.click());
    expect(controller.request).toHaveBeenCalledWith({ type: "amend", message: "Current HEAD message" });
    expect(controller.closeDraft).toHaveBeenCalledTimes(1);
  });
  it("shows the current commit and requests skip through preflight even while conflicts remain", () => {
    const controller = fixture();
    render(controller);
    expect(container.textContent).toContain("bbbbbbbbbbbb");
    expect(container.textContent).toContain("Current replay");
    expect(button("继续 cherry-pick")?.disabled).toBe(true);
    expect(button("跳过当前提交")?.disabled).toBe(false);
    act(() => button("跳过当前提交")!.click());
    expect(controller.request).toHaveBeenCalledWith({ type: "skip" });
    expect(controller.confirm).not.toHaveBeenCalled();
  });
  it("explains an empty replay, disables repeat continue, and exposes both explicit choices", () => {
    const controller = fixture({
      conflictedPaths: [], currentReplay: {
        commitHash: "b".repeat(40), subject: "Empty replay", isEmpty: true, canSkip: true, canKeepEmpty: true
      }
    });
    render(controller);
    expect(container.textContent).toContain("当前提交已没有文件变更");
    expect(button("继续 cherry-pick")?.disabled).toBe(true);
    expect(button("保留空提交")?.disabled).toBe(false);
    act(() => button("保留空提交")!.click());
    expect(controller.request).toHaveBeenCalledWith({ type: "keep-empty" });
  });
  it("hides replay controls for merge and for rebase stops without a current replay", () => {
    const controller = fixture({ operation: "merge", currentReplay: null });
    render(controller);
    expect(button("跳过当前提交")).toBeUndefined();
    expect(button("保留空提交")).toBeUndefined();
    render(fixture({ operation: "rebase", currentReplay: null, conflictedPaths: [] }));
    expect(button("跳过当前提交")).toBeUndefined();
    expect(button("继续 rebase")?.disabled).toBe(false);
  });
  it("explains dirty guards and locks replay actions while another operation is running", () => {
    const controller = fixture({
      currentReplay: {
        commitHash: "b".repeat(40), subject: "Current replay", isEmpty: true,
        canSkip: false, canKeepEmpty: false, blockedReason: "请先保存未跟踪文件。"
      }
    });
    render(controller);
    expect(container.textContent).toContain("请先保存未跟踪文件");
    expect(button("跳过当前提交")?.disabled).toBe(true);
    expect(button("保留空提交")?.disabled).toBe(true);
    render(fixture(), true);
    expect(button("跳过当前提交")?.disabled).toBe(true);
    expect(button("中止 cherry-pick")?.disabled).toBe(true);
  });
  it("refreshes replay choices after continue preflight discovers the commit became empty", async () => {
    const initial = fixture({ conflictedPaths: [] }).state!;
    const empty = { ...initial, changedPaths: [], hasStagedChanges: false,
      currentReplay: { ...initial.currentReplay!, isEmpty: true, canKeepEmpty: true } };
    const inspect = vi.fn().mockResolvedValueOnce({ ok: true, value: initial })
      .mockResolvedValue({ ok: true, value: empty });
    const preflight = vi.fn().mockResolvedValue({ ok: false, error: { code: "INVALID_REQUEST", message: "请选择保留空提交或跳过。" } });
    vi.stubGlobal("gitnest", { repositoryWorkflow: { inspect, preflight } });
    function Harness() {
      const controller = useRepositoryWorkflow(initial.target, [], "workspace");
      return <RepositoryWorkflowToolbar controller={controller} externalApplications={externalApplications} />;
    }
    await act(async () => root.render(<Harness />));
    expect(button("继续 cherry-pick")?.disabled).toBe(false);
    await act(async () => button("继续 cherry-pick")!.click());
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(button("继续 cherry-pick")?.disabled).toBe(true);
    expect(button("保留空提交")?.disabled).toBe(false);
    expect(container.textContent).toContain("请选择保留空提交或跳过");
  });
});

function fixture(overrides: Partial<RepositoryWorkflowStateDto> = {}): RepositoryWorkflowController {
  return {
    state: {
      target: { repositoryId: "repo", worktreeId: "wt" }, head: "a".repeat(40), branch: "main",
      headMessage: "head", parentCount: 1, operation: "cherry-pick", conflictedPaths: ["file.txt"],
      changedPaths: ["file.txt"], hasStagedChanges: true, hasUntrackedFiles: false, untrackedPaths: [],
      remoteBranchesContainingHead: [], fingerprint: "",
      currentReplay: { commitHash: "b".repeat(40), subject: "Current replay", isEmpty: false, canSkip: true, canKeepEmpty: false },
      ...overrides
    },
    preflight: null, busy: false, inspecting: false, error: null, notice: null, completionVersion: 0, draft: null,
    openDraft: vi.fn(), closeDraft: vi.fn(), reload: vi.fn(async () => null),
    request: vi.fn(async () => true), confirm: vi.fn(async () => true), dismiss: vi.fn(), clearFeedback: vi.fn()
  };
}
const externalApplications: ExternalApplicationController = {
  profiles: [], preferredProfile: undefined, loading: false, active: null, error: null,
  reload: vi.fn(async () => undefined), open: vi.fn(async () => true),
  openFile: vi.fn(async () => true), clearError: vi.fn()
};
