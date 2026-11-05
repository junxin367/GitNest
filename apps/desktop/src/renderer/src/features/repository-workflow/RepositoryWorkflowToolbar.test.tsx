/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepositoryWorkflowStateDto } from "@gitnest/contracts";
import { RepositoryWorkflowDraftDialog, RepositoryWorkflowToolbar } from "./RepositoryWorkflowToolbar";
import type { RepositoryWorkflowController } from "./useRepositoryWorkflow";
import { useRepositoryWorkflow } from "./useRepositoryWorkflow";
import type { ExternalApplicationController } from "../external-application/useExternalApplications";
import { RepositoryHistoryOperationDialog, type HistoryOperationType } from "./RepositoryHistoryOperationDialog";
import { CreateBranchFromCommitDialog } from "./RepositoryCommitActions";
import type { RepositoryCommandController } from "../repository-command/useRepositoryCommands";

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
    for (const label of ["创建储藏", "储藏当前文件", "修改最近一次提交", "撤销最近提交", "刷新操作状态"]) {
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
    await act(async () => [...dialog.querySelectorAll("button")].find(entry => entry.textContent === "修改最近一次提交")!.click());
    expect(controller.request).toHaveBeenCalledWith({
      type: "amend", message: "Current HEAD message", expectedHead: "a".repeat(40), expectedBranch: "main"
    }, { confirmed: true, reviewedState: controller.state });
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
  const selected = { hash: "c".repeat(40), subject: "所选提交", parentHashes: ["d".repeat(40)] };
  async function operationDialog(type: HistoryOperationType, parentHashes = selected.parentHashes) {
    const controller = fixture({ operation: null, currentReplay: null, conflictedPaths: [], changedPaths: [] });
    controller.reload = vi.fn(async () => controller.state);
    const close = vi.fn();
    await act(async () => root.render(<RepositoryHistoryOperationDialog intent={{
      type, commit: { ...selected, parentHashes }
    }} controller={controller} onClose={close} />));
    return { controller, close };
  }
  const dialogButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
    .find(entry => entry.textContent === label)!;

  it("Hard Reset 必须明确勾选丢弃修改，提交时绑定当前分支和 HEAD", async () => {
    const { controller, close } = await operationDialog("reset");
    act(() => document.querySelector<HTMLInputElement>('input[name="history-reset-mode"][value="hard"]')!.click());
    expect(dialogButton("丢弃修改并重置 main").disabled).toBe(true);
    act(() => document.querySelector<HTMLInputElement>("#history-reset-discard")!.click());
    await act(async () => dialogButton("丢弃修改并重置 main").click());
    expect(controller.request).toHaveBeenCalledWith({
      type: "reset", commitHash: selected.hash, mode: "hard",
      expectedHead: "a".repeat(40), expectedBranch: "main"
    }, { confirmed: true, reviewedState: controller.state });
    expect(controller.confirm).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
  it("合并提交需要显式选择主线，不默认使用第一父提交", async () => {
    const { controller } = await operationDialog("cherry-pick", ["d".repeat(40), "e".repeat(40)]);
    expect(dialogButton("拣选到 main（Cherry-pick）").disabled).toBe(true);
    act(() => {
      const select = document.querySelector<HTMLSelectElement>("#history-mainline")!;
      select.value = "2"; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => dialogButton("拣选到 main（Cherry-pick）").click());
    expect(controller.request).toHaveBeenCalledWith(expect.objectContaining({
      type: "cherry-pick", commitHash: selected.hash, mainline: 2
    }), { confirmed: true, reviewedState: controller.state });
  });
  it("仅应用变更时清除来源记录，防止互相冲突的选项", async () => {
    const { controller } = await operationDialog("cherry-pick");
    act(() => document.querySelector<HTMLInputElement>("#history-record-origin")!.click());
    act(() => document.querySelector<HTMLInputElement>("#history-no-commit")!.click());
    expect(document.querySelector<HTMLInputElement>("#history-record-origin")!.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>("#history-record-origin")!.disabled).toBe(true);
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("应用变更（不提交）");
    await act(async () => dialogButton("仅应用变更").click());
    expect(controller.request).toHaveBeenCalledWith(expect.objectContaining({
      type: "cherry-pick", noCommit: true, recordOrigin: false
    }), { confirmed: true, reviewedState: controller.state });
  });
  it("Squash 合并只生成待提交结果", async () => {
    const { controller } = await operationDialog("merge");
    act(() => {
      const select = document.querySelector<HTMLSelectElement>('select[aria-label="合并方式"]')!;
      select.value = "squash"; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => dialogButton("准备合并结果").click());
    expect(controller.request).toHaveBeenCalledWith(expect.objectContaining({ type: "merge", mode: "squash", noCommit: true }),
      { confirmed: true, reviewedState: controller.state });
  });
  it("HEAD 相同但当前分支被外部切换后也禁止继续", async () => {
    const { controller } = await operationDialog("reset");
    const changed = { ...controller, state: { ...controller.state!, branch: "other" } };
    act(() => root.render(<RepositoryHistoryOperationDialog intent={{ type: "reset", commit: selected }}
      controller={changed} onClose={vi.fn()} />));
    expect(dialogButton("将 other 重置到此提交").disabled).toBe(true);
    expect(document.body.textContent).toContain("当前分支或 HEAD 已变化");
    expect(controller.request).not.toHaveBeenCalled();
  });
  it("读取当前状态失败时不能使用缓存 HEAD 继续操作", async () => {
    const controller = fixture({ operation: null, currentReplay: null, conflictedPaths: [] });
    controller.reload = vi.fn(async () => null);
    controller.error = "读取失败";
    await act(async () => root.render(<RepositoryHistoryOperationDialog intent={{ type: "reset", commit: selected }}
      controller={controller} onClose={vi.fn()} />));
    expect(dialogButton("将 main 重置到此提交").disabled).toBe(true);
    expect(document.body.textContent).toContain("读取失败");
    expect(controller.request).not.toHaveBeenCalled();
  });
  it("Revert 与撤销最近提交分别说明保留历史和保留文件修改", async () => {
    await operationDialog("revert");
    expect(document.body.textContent).toContain("原提交保留在历史中");
    expect(dialogButton("还原此提交（Revert）").disabled).toBe(false);
    const controller = fixture({ operation: null, currentReplay: null, conflictedPaths: [] });
    controller.draft = { type: "undo-commit" };
    controller.reload = vi.fn(async () => controller.state);
    await act(async () => root.render(<RepositoryWorkflowDraftDialog controller={controller} />));
    expect(document.body.textContent).toContain("最近提交会从当前分支历史中移除");
    expect(document.body.textContent).toContain("文件改动保留在本地");
    expect(dialogButton("撤销最近提交并保留修改").disabled).toBe(false);
  });
  it("Hard Reset 展示最新变更路径，影响变化后清除丢弃勾选", async () => {
    const { controller } = await operationDialog("reset");
    act(() => document.querySelector<HTMLInputElement>('input[value="hard"]')!.click());
    act(() => document.querySelector<HTMLInputElement>("#history-reset-discard")!.click());
    const changed = { ...controller, state: { ...controller.state!, changedPaths: ["新增文件.txt"] } };
    act(() => root.render(<RepositoryHistoryOperationDialog intent={{ type: "reset", commit: selected }}
      controller={changed} onClose={vi.fn()} />));
    expect(document.body.textContent).toContain("新增文件.txt");
    expect(document.querySelector<HTMLInputElement>("#history-reset-discard")!.checked).toBe(false);
    expect(dialogButton("丢弃修改并重置 main").disabled).toBe(true);
  });
  it("从提交创建分支可直接选择切换，并在原弹窗完成确认", async () => {
    const request = vi.fn(async () => true);
    const commands = { busy: false, request, error: null } as unknown as RepositoryCommandController;
    const close = vi.fn();
    await act(async () => root.render(<CreateBranchFromCommitDialog commit={selected}
      target={{ repositoryId: "repo", worktreeId: "wt" }} commands={commands} onClose={close} />));
    act(() => {
      const input = document.querySelector<HTMLInputElement>("#commit-new-branch")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "feature/new");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector<HTMLInputElement>("#commit-new-branch-checkout")!.click();
    });
    await act(async () => dialogButton("创建并切换分支").click());
    expect(request).toHaveBeenCalledExactlyOnceWith({
      type: "create-branch", target: { repositoryId: "repo", worktreeId: "wt" },
      branch: "feature/new", startPoint: selected.hash, checkout: true
    }, { confirmed: true });
    expect(close).toHaveBeenCalledOnce();
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
