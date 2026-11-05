/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepositoryManagementBridge, RepositoryManagementStateDto } from "@gitnest/contracts";
import { RepositoryManagementDialog } from "./RepositoryManagementDialog";
import { RepositoryCreationDialog } from "./RepositoryCreationDialog";
import { RepositoryTagActionDialog } from "./RepositoryTagActionDialog";

const target = { repositoryId: "repo", worktreeId: "tree" };
const initial: RepositoryManagementStateDto = {
  remotes: [{ name: "origin", fetchUrl: "https://github.com/owner/repo", pushUrl: "https://github.com/owner/repo" }],
  tags: [{ name: "v1", hash: "a".repeat(40), subject: "Release" }]
};
function bridge(): RepositoryManagementBridge {
  return {
    inspect: vi.fn<RepositoryManagementBridge["inspect"]>(async () => ({ ok: true, value: initial })),
    preflight: vi.fn<RepositoryManagementBridge["preflight"]>(async (command) => ({ ok: true, value: { preflightId: "preflight", command, expiresAt: "", summary: "删除本地标签：v1" } })),
    execute: vi.fn<RepositoryManagementBridge["execute"]>(async () => ({ ok: true, value: { operationId: "operation" } })),
    create: vi.fn<RepositoryManagementBridge["create"]>(async (input) => ({ ok: true, value: { operationId: "creation", kind: input.kind, destination: input.destination, state: "running", message: "正在克隆" } })),
    creationStatus: vi.fn<RepositoryManagementBridge["creationStatus"]>(async () => ({ ok: true, value: { operationId: "creation", kind: "clone", destination: "C:\\new", state: "succeeded", message: "已完成" } })),
    cancelCreation: vi.fn<RepositoryManagementBridge["cancelCreation"]>(async () => ({ ok: true, value: undefined })),
    openCommit: vi.fn<RepositoryManagementBridge["openCommit"]>(async () => ({ ok: true, value: { url: "" } }))
  };
}
function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
}
async function input(id: string, value: string) {
  await act(async () => {
    const element = document.getElementById(id) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
describe("Repository management dialogs", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });
  it("preflights tag deletion and only writes after explicit confirmation", async () => {
    const api = bridge();
    await act(async () => root.render(<RepositoryManagementDialog bridge={api} target={target} onDismiss={() => undefined} />));
    await act(async () => button("删除本地标签").click());
    expect(api.preflight).toHaveBeenCalledWith({ target, action: { type: "tag-delete", name: "v1" } });
    expect(api.execute).not.toHaveBeenCalled();
    await act(async () => button("删除本地标签").click());
    expect(api.execute).toHaveBeenCalledWith({ preflightId: "preflight", confirmed: true });
    expect(document.body.textContent).toContain("操作已加入队列");
  });
  it("keeps remote deletion cancellable and shows the selected target", async () => {
    const api = bridge();
    await act(async () => root.render(<RepositoryManagementDialog bridge={api} target={target} onDismiss={() => undefined} />));
    await act(async () => button("删除远程").click());
    expect(api.preflight).toHaveBeenCalledWith({ target, action: { type: "remote-remove", name: "origin" } });
    await act(async () => button("返回编辑").click());
    expect(api.execute).not.toHaveBeenCalled();
    expect(document.getElementById("manage-remote-name")).not.toBeNull();
  });
  it("refreshes after the queued operation completes and exposes its result", async () => {
    const api = bridge();
    const render = (operations: NonNullable<Parameters<typeof RepositoryManagementDialog>[0]["operations"]>) => root.render(<RepositoryManagementDialog bridge={api} target={target} operations={operations} onDismiss={() => undefined} />);
    await act(async () => render([]));
    await act(async () => button("删除本地标签").click());
    await act(async () => button("删除本地标签").click());
    expect(button("删除本地标签").disabled).toBe(true);
    api.inspect = vi.fn<RepositoryManagementBridge["inspect"]>(async () => ({ ok: true, value: { ...initial, tags: [] } }));
    await act(async () => render([{ id: "operation", kind: "tag-delete", scope: "repository", targetIds: ["repo"], state: "succeeded", progress: 1, succeeded: 1, failed: 0, message: "删除标签已完成。" }]));
    expect(api.inspect).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("删除标签已完成。");
    expect(document.body.textContent).toContain("尚无本地标签");
  });
  it("disables tag push for remotes with multiple destinations", async () => {
    const api = bridge();
    api.inspect = vi.fn<RepositoryManagementBridge["inspect"]>(async () => ({ ok: true, value: { ...initial, remotes: [{ ...initial.remotes[0]!, pushUrls: ["https://github.com/one/repo", "https://github.com/two/repo"] }] } }));
    await act(async () => root.render(<RepositoryManagementDialog bridge={api} target={target} onDismiss={() => undefined} />));
    expect(button("推送标签").disabled).toBe(true);
    expect(document.body.textContent).toContain("https://github.com/two/repo");
  });
  it("ignores an old target inspection result after target changes", async () => {
    const api = bridge();
    let resolveOld!: (value: Awaited<ReturnType<RepositoryManagementBridge["inspect"]>>) => void;
    api.inspect = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValue({ ok: true, value: { remotes: [], tags: [] } });
    await act(async () => root.render(<RepositoryManagementDialog bridge={api} target={target} onDismiss={() => undefined} />));
    await act(async () => root.render(<RepositoryManagementDialog bridge={api} target={{ repositoryId: "other", worktreeId: "other" }} onDismiss={() => undefined} />));
    await act(async () => resolveOld({ ok: true, value: initial }));
    expect(document.body.textContent).toContain("尚未配置远程");
    expect(document.body.textContent).not.toContain("https://github.com/owner/repo");
  });
  it("polls creation and only registers the successfully created path when requested", async () => {
    vi.useFakeTimers();
    const api = bridge(); const onCreated = vi.fn(async () => undefined);
    await act(async () => root.render(<RepositoryCreationDialog bridge={api} onDismiss={() => undefined} onCreated={onCreated} />));
    await input("create-repository-url", "https://github.com/owner/repo");
    await input("create-repository-destination", "C:\\new");
    await act(async () => button("开始克隆").click());
    expect(api.create).toHaveBeenCalledWith({ kind: "clone", destination: "C:\\new", url: "https://github.com/owner/repo" });
    expect(onCreated).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(300));
    await act(async () => button("加入 Workspace").click());
    expect(onCreated).toHaveBeenCalledWith("C:\\new");
  });
  it("cancels the active clone without pretending it has completed", async () => {
    const api = bridge();
    await act(async () => root.render(<RepositoryCreationDialog bridge={api} onDismiss={() => undefined} onCreated={async () => undefined} />));
    await input("create-repository-url", "https://github.com/owner/repo");
    await input("create-repository-destination", "C:\\new");
    await act(async () => button("开始克隆").click());
    await act(async () => button("取消操作").click());
    expect(api.cancelCreation).toHaveBeenCalledWith({ operationId: "creation" });
    expect(button("处理中…").disabled).toBe(true);
  });
  it("从历史提交创建标签固定目标 Hash，确认之前不写入", async () => {
    const api = bridge();
    const intent = { type: "tag-create" as const, revision: "b".repeat(40), subject: "选中的提交" };
    await act(async () => root.render(<RepositoryTagActionDialog bridge={api} target={target}
      intent={intent} operations={[]} onDismiss={vi.fn()} onCompleted={vi.fn()} />));
    await input("history-tag-name", "v2");
    await input("history-tag-message", "发布说明");
    expect(api.execute).not.toHaveBeenCalled();
    await act(async () => button("创建标签").click());
    expect(api.preflight).toHaveBeenCalledWith({ target, action: {
      type: "tag-create", name: "v2", revision: intent.revision, message: "发布说明"
    } });
    expect(api.execute).toHaveBeenCalledWith({ preflightId: "preflight", confirmed: true });
    expect(document.body.textContent).toContain("完成后自动刷新");
  });
  it("历史标签删除完成后刷新，队列失败时保留错误并允许重试", async () => {
    const api = bridge();
    const completed = vi.fn();
    const render = (operations: NonNullable<Parameters<typeof RepositoryManagementDialog>[0]["operations"]>) =>
      root.render(<RepositoryTagActionDialog bridge={api} target={target}
        intent={{ type: "tag-delete", name: "v1" }} operations={operations}
        onDismiss={vi.fn()} onCompleted={completed} />);
    await act(async () => render([]));
    await act(async () => button("删除本地标签").click());
    expect(api.preflight).toHaveBeenCalledWith({ target, action: { type: "tag-delete", name: "v1" } });
    await act(async () => render([{ id: "operation", kind: "tag-delete", scope: "repository", targetIds: ["repo:tree"], state: "failed", progress: 1, succeeded: 0, failed: 1, message: "标签已变化" }]));
    expect(completed).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("标签已变化");
    expect(button("删除本地标签").disabled).toBe(false);
    await act(async () => render([]));
    await act(async () => button("删除本地标签").click());
    await act(async () => render([{ id: "operation", kind: "tag-delete", scope: "repository", targetIds: ["repo:tree"], state: "succeeded", progress: 1, succeeded: 1, failed: 0, message: "完成" }]));
    expect(completed).toHaveBeenCalledOnce();
  });
  it("历史标签推送选择远程，多推送地址时不能提交", async () => {
    const api = bridge();
    api.inspect = vi.fn(async () => ({ ok: true as const, value: { ...initial, remotes: [{ ...initial.remotes[0]!, pushUrls: ["one", "two"] }] } }));
    await act(async () => root.render(<RepositoryTagActionDialog bridge={api} target={target}
      intent={{ type: "tag-push", name: "v1" }} operations={[]} onDismiss={vi.fn()} onCompleted={vi.fn()} />));
    expect(button("推送标签").disabled).toBe(true);
    expect(document.body.textContent).toContain("多个推送地址");
    expect(api.preflight).not.toHaveBeenCalled();
  });
  it("标签预检失败时留在原弹窗，重试仍只需点击一次", async () => {
    const api = bridge();
    api.preflight = vi.fn().mockResolvedValueOnce({ ok: false, error: {
      code: "INVALID_REQUEST", message: "标签已存在", details: {}
    } }).mockImplementation(async command => ({ ok: true, value: {
      preflightId: "retry", command, expiresAt: "", summary: "创建标签"
    } }));
    await act(async () => root.render(<RepositoryTagActionDialog bridge={api} target={target}
      intent={{ type: "tag-create", revision: "b".repeat(40), subject: "所选提交" }}
      operations={[]} onDismiss={vi.fn()} onCompleted={vi.fn()} />));
    await input("history-tag-name", "v2");
    await act(async () => button("创建标签").click());
    expect(api.execute).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("标签已存在");
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await act(async () => button("创建标签").click());
    expect(api.execute).toHaveBeenCalledExactlyOnceWith({ preflightId: "retry", confirmed: true });
  });
  it("标签预检期间切换仓库后不执行旧操作", async () => {
    const api = bridge();
    let complete!: (value: Awaited<ReturnType<RepositoryManagementBridge["preflight"]>>) => void;
    api.preflight = vi.fn<RepositoryManagementBridge["preflight"]>(() => new Promise(resolve => { complete = resolve; }));
    const intent = { type: "tag-delete" as const, name: "v1" };
    const render = (selectedTarget: typeof target) => root.render(<RepositoryTagActionDialog bridge={api}
      target={selectedTarget} intent={intent} operations={[]} onDismiss={vi.fn()} onCompleted={vi.fn()} />);
    await act(async () => render(target));
    act(() => button("删除本地标签").click());
    await act(async () => render({ repositoryId: "other", worktreeId: "other" }));
    await act(async () => complete({ ok: true, value: {
      preflightId: "obsolete", command: { target, action: { type: "tag-delete", name: "v1" } },
      expiresAt: "", summary: "删除标签"
    } }));
    expect(api.execute).not.toHaveBeenCalled();
    expect(button("删除本地标签").disabled).toBe(false);
  });
  it("仓库管理切换目标再切回来时，旧预检也不会继续写入", async () => {
    const api = bridge();
    let complete!: (value: Awaited<ReturnType<RepositoryManagementBridge["preflight"]>>) => void;
    api.preflight = vi.fn<RepositoryManagementBridge["preflight"]>(() => new Promise(resolve => { complete = resolve; }));
    const render = (selectedTarget: typeof target) => root.render(<RepositoryManagementDialog bridge={api}
      target={selectedTarget} onDismiss={vi.fn()} />);
    await act(async () => render(target));
    await input("manage-tag-name", "v2");
    act(() => button("创建标签").click());
    await act(async () => render({ repositoryId: "other", worktreeId: "other" }));
    await act(async () => render(target));
    await act(async () => complete({ ok: true, value: {
      preflightId: "obsolete", command: { target, action: { type: "tag-create", name: "v2", revision: "HEAD" } },
      expiresAt: "", summary: "创建标签"
    } }));
    expect(api.execute).not.toHaveBeenCalled();
    expect(button("创建标签").disabled).toBe(false);
  });
});
