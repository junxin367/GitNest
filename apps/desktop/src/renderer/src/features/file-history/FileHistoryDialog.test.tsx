/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileHistoryBridge, FileHistoryEntryDto, FileHistoryResultDto } from "@gitnest/contracts";
import { FileHistoryDialog, type FileHistoryDialogProps } from "./FileHistoryDialog";

vi.mock("../../widgets/diff-workspace/DiffPanel", () => ({
  DiffPanel: ({ content, path, state }: { content?: string; path?: string; state?: { title: string; message?: string } }) =>
    <div data-testid="diff" data-path={path}>{state ? `${state.title} ${state.message ?? ""}` : content}</div>
}));
const target = { repositoryId: "repo", worktreeId: "tree" };
const first: FileHistoryEntryDto = {
  hash: "a".repeat(40), path: "src/new.ts", previousPath: "src/old.ts",
  authorName: "作者甲", authoredAt: "2026-10-06T08:00:00Z", subject: "重命名文件", status: "R100"
};
const second: FileHistoryEntryDto = {
  hash: "b".repeat(40), path: "src/old.ts", authorName: "作者乙",
  authoredAt: "2026-10-05T08:00:00Z", subject: "添加文件", status: "A"
};
const history: FileHistoryResultDto = {
  revision: "c".repeat(40), path: "src/new.ts", entries: [first], nextOffset: 1, status: "ok"
};
function createBridge(): FileHistoryBridge {
  return {
    history: vi.fn<FileHistoryBridge["history"]>(async () => ({ ok: true, value: history })),
    diff: vi.fn<FileHistoryBridge["diff"]>(async request => ({
      ok: true, value: { commitHash: request.commitHash, path: request.path, patch: `@@ -1 +1 @@\n-before\n+patch:${request.path}`, status: "ok" }
    })),
    cancel: vi.fn<FileHistoryBridge["cancel"]>(async () => ({ ok: true, value: true }))
  };
}
function button(text: string): HTMLButtonElement {
  const value = [...document.querySelectorAll("button")].find(element => element.textContent === text);
  if (!value) throw new Error(`Missing button ${text}`);
  return value;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
describe("FileHistoryDialog", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
  async function render(bridge: FileHistoryBridge, overrides: Partial<FileHistoryDialogProps> = {}) {
    await act(async () => root.render(<FileHistoryDialog bridge={bridge} target={target} path="src/new.ts" onDismiss={() => undefined} {...overrides} />));
  }
  it("loads a bounded history page and directly displays the rename diff", async () => {
    const bridge = createBridge();
    await render(bridge, { originalPath: "src/old.ts" });
    expect(bridge.history).toHaveBeenCalledWith(expect.objectContaining({ target, path: "src/new.ts", originalPath: "src/old.ts", limit: 50 }));
    expect(bridge.diff).toHaveBeenCalledWith(expect.objectContaining({ target, commitHash: first.hash, path: first.path, previousPath: first.previousPath }));
    expect(document.body.textContent).toContain("src/old.ts → src/new.ts");
    expect(document.querySelector('[role="region"][aria-label="提交变更"]')).not.toBeNull();
    expect(document.querySelector('[role="tablist"]')).toBeNull();
  });
  it("freezes pagination to the returned revision and follows each historical path", async () => {
    const bridge = createBridge();
    await render(bridge);
    vi.mocked(bridge.history).mockResolvedValueOnce({ ok: true, value: { ...history, entries: [second], nextOffset: null } });
    await act(async () => button("加载更多历史").click());
    expect(bridge.history).toHaveBeenLastCalledWith(expect.objectContaining({ revision: history.revision, path: history.path, offset: 1, limit: 50 }));
    const entry = [...document.querySelectorAll<HTMLButtonElement>(".file-history-entry")].find(item => item.textContent?.includes(second.subject))!;
    await act(async () => entry.click());
    expect(bridge.diff).toHaveBeenLastCalledWith(expect.objectContaining({ commitHash: second.hash, path: "src/old.ts" }));
    expect(document.body.textContent).toContain("已加载 2 条");
    expect(document.body.textContent).toContain("已到当前历史范围末尾");
  });
  it("ignores and cancels an old history response when the target changes", async () => {
    const bridge = createBridge();
    const pending = deferred<Awaited<ReturnType<FileHistoryBridge["history"]>>>();
    vi.mocked(bridge.history).mockReturnValueOnce(pending.promise).mockResolvedValue({ ok: true, value: { ...history, entries: [], nextOffset: null, status: "empty", message: "新仓库没有记录" } });
    await render(bridge);
    const queryId = vi.mocked(bridge.history).mock.calls[0]![0].queryId;
    await render(bridge, { target: { repositoryId: "other", worktreeId: "other-tree" } });
    await act(async () => pending.resolve({ ok: true, value: history }));
    expect(bridge.cancel).toHaveBeenCalledWith({ queryId });
    expect(document.body.textContent).toContain("新仓库没有记录");
    expect(document.body.textContent).not.toContain(first.subject);
    expect(bridge.diff).not.toHaveBeenCalled();
  });
  it("cancels close immediately and rejects late responses even before the parent unmounts", async () => {
    const bridge = createBridge();
    const pending = deferred<Awaited<ReturnType<FileHistoryBridge["history"]>>>();
    vi.mocked(bridge.history).mockReturnValue(pending.promise);
    const onDismiss = vi.fn();
    await render(bridge, { onDismiss });
    await act(async () => button("关闭").click());
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(bridge.cancel).toHaveBeenCalledWith({ queryId: vi.mocked(bridge.history).mock.calls[0]![0].queryId });
    await act(async () => pending.resolve({ ok: true, value: history }));
    expect(bridge.diff).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(first.subject);
  });
  it("shows empty/untracked history without issuing a diff request", async () => {
    const bridge = createBridge();
    vi.mocked(bridge.history).mockResolvedValue({ ok: true, value: { ...history, revision: null, status: "empty", entries: [], nextOffset: null } });
    await render(bridge);
    expect(document.body.textContent).toContain("未跟踪文件");
    expect(bridge.diff).not.toHaveBeenCalled();
  });
  it("keeps a failed next page retryable without losing previous entries or changing the revision", async () => {
    const bridge = createBridge();
    await render(bridge);
    vi.mocked(bridge.history).mockRejectedValueOnce(new Error("读取被暂时中断")).mockResolvedValueOnce({
      ok: true, value: { ...history, entries: [second], nextOffset: null }
    });
    await act(async () => button("加载更多历史").click());
    expect(document.body.textContent).toContain("读取被暂时中断");
    expect(document.querySelectorAll(".file-history-entry")).toHaveLength(1);
    await act(async () => button("重试读取").click());
    expect(document.querySelectorAll(".file-history-entry")).toHaveLength(2);
    expect(bridge.history).toHaveBeenLastCalledWith(expect.objectContaining({ revision: history.revision, offset: 1 }));
  });
  it("retries failed detail reads on the same commit and historical path", async () => {
    const bridge = createBridge();
    vi.mocked(bridge.diff).mockRejectedValueOnce(new Error("暂时无法读取变更"));
    await render(bridge);
    expect(document.body.textContent).toContain("暂时无法读取变更");
    await act(async () => button("重试读取变更").click());
    expect(bridge.diff).toHaveBeenCalledTimes(2);
    expect(bridge.diff).toHaveBeenLastCalledWith(expect.objectContaining({ commitHash: first.hash, path: first.path }));
    expect(document.body.textContent).toContain(`patch:${first.path}`);
  });
  it("explains a pure rename without text hunks and shows its historical paths", async () => {
    const bridge = createBridge();
    vi.mocked(bridge.diff).mockResolvedValue({
      ok: true, value: {
        commitHash: first.hash, path: first.path, status: "ok",
        patch: "diff --git a/src/old.ts b/src/new.ts\nsimilarity index 100%\nrename from src/old.ts\nrename to src/new.ts\n"
      }
    });
    await render(bridge);
    const detail = document.querySelector('[data-testid="diff"]')?.textContent;
    expect(detail).toContain("没有文本行变更");
    expect(detail).toContain("src/old.ts → src/new.ts");
    expect(detail).toContain("未改变文本行内容");
  });
  it("reuses successful immutable diffs across A-B-A selections", async () => {
    const bridge = createBridge();
    vi.mocked(bridge.history).mockResolvedValue({ ok: true, value: { ...history, entries: [first, second], nextOffset: null } });
    await render(bridge);
    await act(async () => document.querySelectorAll<HTMLButtonElement>(".file-history-entry")[1]!.click());
    await act(async () => document.querySelectorAll<HTMLButtonElement>(".file-history-entry")[0]!.click());
    expect(bridge.diff).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-testid="diff"]')?.textContent).toContain(`patch:${first.path}`);
  });
  it("only formats the added rows when loading another history page", async () => {
    const bridge = createBridge();
    const entries = Array.from({ length: 50 }, (_, index) => ({
      ...first, hash: index.toString(16).padStart(40, "0"), subject: `commit ${index}`
    }));
    vi.mocked(bridge.history).mockResolvedValueOnce({ ok: true, value: { ...history, entries, nextOffset: 50 } })
      .mockResolvedValueOnce({ ok: true, value: { ...history, entries: [second], nextOffset: null } });
    await render(bridge);
    const format = vi.spyOn(Date.prototype, "toLocaleString");
    await act(async () => button("加载更多历史").click());
    expect(format).toHaveBeenCalledOnce();
    expect(document.querySelectorAll(".file-history-entry")).toHaveLength(51);
    expect(bridge.diff).toHaveBeenCalledOnce();
  });
  it("cancels a previous version and never displays or caches its late diff", async () => {
    const bridge = createBridge();
    vi.mocked(bridge.history).mockResolvedValue({ ok: true, value: { ...history, entries: [first, second], nextOffset: null } });
    const pending = deferred<Awaited<ReturnType<FileHistoryBridge["diff"]>>>();
    vi.mocked(bridge.diff).mockReturnValueOnce(pending.promise);
    await render(bridge);
    const queryId = vi.mocked(bridge.diff).mock.calls[0]![0].queryId;
    await act(async () => document.querySelectorAll<HTMLButtonElement>(".file-history-entry")[1]!.click());
    await act(async () => pending.resolve({ ok: true, value: {
      commitHash: first.hash, path: first.path, patch: "stale cancelled result", status: "ok"
    } }));
    expect(bridge.cancel).toHaveBeenCalledWith({ queryId });
    expect(document.body.textContent).toContain(`patch:${second.path}`);
    expect(document.body.textContent).not.toContain("stale cancelled result");
    await act(async () => document.querySelectorAll<HTMLButtonElement>(".file-history-entry")[0]!.click());
    expect(bridge.diff).toHaveBeenCalledTimes(3);
    expect(document.body.textContent).toContain(`patch:${first.path}`);
    expect(document.body.textContent).not.toContain("stale cancelled result");
  });
  it("does not cache errors and releases cached diffs when the scope changes", async () => {
    const bridge = createBridge();
    vi.mocked(bridge.history).mockResolvedValue({ ok: true, value: { ...history, entries: [first, second], nextOffset: null } });
    vi.mocked(bridge.diff).mockRejectedValueOnce(new Error("temporary diff error"));
    await render(bridge);
    expect(document.body.textContent).toContain("temporary diff error");
    await act(async () => document.querySelectorAll<HTMLButtonElement>(".file-history-entry")[1]!.click());
    await act(async () => document.querySelectorAll<HTMLButtonElement>(".file-history-entry")[0]!.click());
    expect(bridge.diff).toHaveBeenCalledTimes(3);
    expect(document.body.textContent).toContain(`patch:${first.path}`);
    await render(bridge, { revision: "d".repeat(40) });
    expect(bridge.diff).toHaveBeenCalledTimes(4);
    expect(bridge.history).toHaveBeenLastCalledWith(expect.objectContaining({ revision: "d".repeat(40) }));
  });
  it("deduplicates overlapping history pages including repeated entries in one page", async () => {
    const bridge = createBridge();
    await render(bridge);
    vi.mocked(bridge.history).mockResolvedValueOnce({ ok: true, value: { ...history, entries: [first, second, second], nextOffset: null } });
    await act(async () => button("加载更多历史").click());
    expect(document.querySelectorAll(".file-history-entry")).toHaveLength(2);
  });
  it("keeps caches bounded when visiting many commits", async () => {
    const bridge = createBridge();
    const entries = Array.from({ length: 13 }, (_, index) => ({
      ...first, hash: index.toString(16).padStart(40, "0"), subject: `commit ${index}`
    }));
    vi.mocked(bridge.history).mockResolvedValue({ ok: true, value: { ...history, entries, nextOffset: null } });
    await render(bridge);
    for (let index = 1; index < entries.length; index++) {
      await act(async () => document.querySelectorAll<HTMLButtonElement>(".file-history-entry")[index]!.click());
    }
    await act(async () => document.querySelectorAll<HTMLButtonElement>(".file-history-entry")[1]!.click());
    expect(bridge.diff).toHaveBeenCalledTimes(13);
    await act(async () => document.querySelectorAll<HTMLButtonElement>(".file-history-entry")[0]!.click());
    expect(bridge.diff).toHaveBeenCalledTimes(14);
  });
});
