/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepositoryIgnorePreflightDto, WorkspaceOperationDto } from "@gitnest/contracts";
import { RepositoryIgnoreDialog } from "./RepositoryIgnoreDialog";

const target = { repositoryId: "repo", worktreeId: "tree" };
const selection = { path: "build/new.log", scope: "file" as const };
const preview: RepositoryIgnorePreflightDto = {
  preflightId: "preview-1", expiresAt: "2026-10-06T23:59:59Z",
  target, ...selection, ignoreFilePath: "C:/repo/.gitignore", rule: "/build/new.log",
  summary: "忽略此文件：build/new.log", warnings: ["子目录中的规则可能覆盖此规则。"], confirmationRequired: true
};
type PreviewResult = Awaited<ReturnType<typeof window.gitnest.repositoryIgnore.preflight>>;
type ExecuteResult = Awaited<ReturnType<typeof window.gitnest.repositoryIgnore.execute>>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  return { promise: new Promise<T>((yes, no) => { resolve = yes; reject = no; }), resolve: (value: T) => resolve(value), reject: (reason: unknown) => reject(reason) };
}
function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(item => item.textContent === text);
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
}
function operation(state: WorkspaceOperationDto["state"], message = ""): WorkspaceOperationDto {
  return { id: "operation-1", kind: "ignore-file", scope: "repository", targetIds: ["repo"], state, message, progress: 0, succeeded: 0, failed: 0 };
}
describe("RepositoryIgnoreDialog", () => {
  let root: Root;
  let container: HTMLDivElement;
  let api: {
    preflight: ReturnType<typeof vi.fn<typeof window.gitnest.repositoryIgnore.preflight>>;
    execute: ReturnType<typeof vi.fn<typeof window.gitnest.repositoryIgnore.execute>>;
  };
  let onDismiss: ReturnType<typeof vi.fn<() => void>>;
  let onCompleted: ReturnType<typeof vi.fn<() => void>>;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    api = {
      preflight: vi.fn(async () => ({ ok: true as const, value: structuredClone(preview) })),
      execute: vi.fn(async () => ({ ok: true as const, value: { operationId: "operation-1" } }))
    };
    vi.stubGlobal("gitnest", { repositoryIgnore: api });
    onDismiss = vi.fn(); onCompleted = vi.fn();
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  const render = async (operations: WorkspaceOperationDto[] = [], key = "repo") => {
    await act(async () => root.render(<RepositoryIgnoreDialog key={key} target={target} selection={selection}
      operations={operations} onDismiss={onDismiss} onCompleted={onCompleted} />));
  };
  it("only previews the exact selected rule; cancelling never writes", async () => {
    await render();
    expect(api.preflight).toHaveBeenCalledWith({ target, ...selection });
    expect(document.body.textContent).toContain("C:/repo/.gitignore");
    expect(document.body.textContent).toContain("/build/new.log");
    expect(document.body.textContent).toContain("子目录中的规则");
    expect(api.execute).not.toHaveBeenCalled();
    await act(async () => button("取消").click());
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(api.execute).not.toHaveBeenCalled();
  });
  it("does not allow a write until preflight resolves", async () => {
    const pending = deferred<PreviewResult>(); api.preflight.mockReturnValueOnce(pending.promise);
    await render();
    expect(button("写入 .gitignore").disabled).toBe(true);
    await act(async () => button("写入 .gitignore").click());
    expect(api.execute).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ ok: true, value: preview }));
    expect(button("写入 .gitignore").disabled).toBe(false);
  });
  it("executes only once even when clicked twice before React commits", async () => {
    const pending = deferred<ExecuteResult>(); api.execute.mockReturnValueOnce(pending.promise);
    await render();
    const confirm = button("写入 .gitignore");
    await act(async () => { confirm.click(); confirm.click(); });
    expect(api.execute).toHaveBeenCalledOnce();
    expect(api.execute).toHaveBeenCalledWith({ preflightId: "preview-1", confirmed: true });
    expect(button("取消").disabled).toBe(true);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ ok: true, value: { operationId: "operation-1" } }));
    expect(onCompleted).not.toHaveBeenCalled();
  });
  it("waits for its own terminal success rather than acceptance or other operations", async () => {
    await render();
    await act(async () => button("写入 .gitignore").click());
    expect(document.body.textContent).toContain("操作已加入队列");
    expect(onCompleted).not.toHaveBeenCalled();
    await render([{ ...operation("succeeded"), id: "unrelated" }]);
    for (const state of ["queued", "running", "cancelling"] as const) {
      await render([operation(state)]);
      expect(onCompleted).not.toHaveBeenCalled();
      expect(onDismiss).not.toHaveBeenCalled();
      expect(button("取消").disabled).toBe(true);
    }
    await render([operation("succeeded")]);
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
    await render([operation("succeeded")]);
    expect(onCompleted).toHaveBeenCalledOnce();
  });
  it.each(["failed", "cancelled"] as const)("clears consumed authorization after %s and requires a new preflight", async state => {
    await render(); await act(async () => button("写入 .gitignore").click());
    await render([operation(state, "仓库状态已变化")]);
    expect(document.querySelector("[role=alert]")?.textContent).toBe("仓库状态已变化");
    expect(document.body.textContent).not.toContain("/build/new.log");
    expect(onCompleted).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(api.execute).toHaveBeenCalledOnce();
    api.preflight.mockResolvedValueOnce({ ok: true, value: { ...preview, preflightId: "preview-2" } });
    await act(async () => button("重新预览").click());
    await act(async () => button("写入 .gitignore").click());
    expect(api.preflight).toHaveBeenCalledTimes(2);
    expect(api.execute).toHaveBeenLastCalledWith({ preflightId: "preview-2", confirmed: true });
  });
  it("shows an execution rejection and discards the old preflight", async () => {
    api.execute.mockResolvedValueOnce({ ok: false, error: { code: "PREFLIGHT_CHANGED", message: "请重新预检。", details: {} } });
    await render(); await act(async () => button("写入 .gitignore").click());
    expect(document.querySelector("[role=alert]")?.textContent).toBe("请重新预检。");
    expect(button("重新预览").disabled).toBe(false);
    expect(document.body.textContent).not.toContain("/build/new.log");
    expect(onCompleted).not.toHaveBeenCalled();
  });
  it("recovers from a transport rejection with a new preview", async () => {
    api.execute.mockRejectedValueOnce(new Error("connection lost"));
    await render(); await act(async () => button("写入 .gitignore").click());
    expect(document.querySelector("[role=alert]")?.textContent).toBe("connection lost");
    expect(button("重新预览").disabled).toBe(false);
    expect(onCompleted).not.toHaveBeenCalled();
  });
  it("does not turn a preflight failure into a write", async () => {
    api.preflight.mockResolvedValueOnce({ ok: false, error: { code: "INVALID_REQUEST", message: "文件已被跟踪。", details: {} } });
    await render();
    expect(document.querySelector("[role=alert]")?.textContent).toBe("文件已被跟踪。");
    expect(button("重新预览")).toBeDefined();
    expect(api.execute).not.toHaveBeenCalled();
  });
  it("ignores a stale preflight after the scoped dialog is unmounted", async () => {
    const old = deferred<PreviewResult>(); api.preflight.mockReturnValueOnce(old.promise);
    await render();
    await render([], "new-scope");
    await act(async () => old.resolve({ ok: true, value: { ...preview, rule: "/stale-rule", preflightId: "stale" } }));
    expect(document.body.textContent).not.toContain("stale-rule");
    await act(async () => button("写入 .gitignore").click());
    expect(api.execute).toHaveBeenCalledWith({ preflightId: "preview-1", confirmed: true });
  });
  it("ignores stale execution acceptance after unmount and does not complete the new dialog", async () => {
    const old = deferred<ExecuteResult>(); api.execute.mockReturnValueOnce(old.promise);
    await render(); await act(async () => button("写入 .gitignore").click());
    await render([operation("succeeded")], "new-scope");
    await act(async () => old.resolve({ ok: true, value: { operationId: "operation-1" } }));
    expect(onCompleted).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(button("写入 .gitignore").disabled).toBe(false);
  });
});
