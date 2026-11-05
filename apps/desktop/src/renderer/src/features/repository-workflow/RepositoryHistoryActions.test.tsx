/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RepositoryHistoryActions } from "./RepositoryHistoryActions";
import type { RepositoryWorkflowController } from "./useRepositoryWorkflow";
import { RepositoryHistoryMenu, type HistoryContextMenuState } from "../../pages/repository/RepositoryHistoryMenu";
import type { RepositoryCommandController } from "../repository-command/useRepositoryCommands";
import type { RepositoryCommitActionHandler } from "./RepositoryCommitActions";
import type { HistoryRefLabel } from "../../pages/repository/RepositoryHistory";

describe("RepositoryHistoryActions", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: RepositoryWorkflowController;
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    controller = {
      state: null, preflight: null, busy: false, inspecting: false,
      error: null, notice: null, completionVersion: 0, draft: null,
      openDraft: vi.fn(), closeDraft: vi.fn(), reload: vi.fn(async () => null),
      request: vi.fn(async () => true), confirm: vi.fn(async () => true),
      dismiss: vi.fn(), clearFeedback: vi.fn()
    };
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  const render = (repositoryKey = "repo:wt", busy = false) => act(() => root.render(
    <RepositoryHistoryActions repositoryKey={repositoryKey} busy={busy} controller={controller} />
  ));
  const trigger = () => container.querySelector("button")!;
  const menu = () => document.querySelector('[role="menu"]');
  const items = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  const open = () => act(() => trigger().click());

  it.each([
    ["修改最近一次提交（Amend）…", "amend"],
    ["撤销最近提交（保留修改）…", "undo-commit"]
  ] as const)("opens the %s draft for HEAD without loading or executing on menu open", (label, type) => {
    render();
    expect(container.querySelectorAll("button")).toHaveLength(1);
    open();
    expect(menu()?.textContent).toContain("当前工作区 · 最近提交 HEAD");
    expect(controller.reload).not.toHaveBeenCalled();
    act(() => items().find(item => item.textContent === label)!.click());
    expect(controller.openDraft).toHaveBeenCalledExactlyOnceWith(type);
    expect(controller.request).not.toHaveBeenCalled();
    expect(controller.confirm).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("supports keyboard opening, item navigation, and Escape focus restoration", () => {
    render();
    act(() => trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement).toBe(items()[0]);
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement).toBe(items()[1]);
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("dismisses on outside pointer, focus departure, window blur, and Tab", () => {
    render();
    open();
    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(menu()).toBeNull();
    open();
    act(() => document.body.dispatchEvent(new Event("focusin", { bubbles: true })));
    expect(menu()).toBeNull();
    open();
    act(() => window.dispatchEvent(new Event("blur")));
    expect(menu()).toBeNull();
    open();
    act(() => items()[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(controller.openDraft).not.toHaveBeenCalled();
  });

  it("closes on repository changes and does not reopen when returning to the previous repository", () => {
    render();
    open();
    render("other:wt");
    expect(menu()).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    render();
    expect(menu()).toBeNull();
  });

  it("closes and locks for running commands or pending confirmations without reopening later", () => {
    render();
    open();
    render("repo:wt", true);
    expect(menu()).toBeNull();
    expect(trigger().disabled).toBe(true);
    render();
    expect(menu()).toBeNull();
    controller = { ...controller, busy: true };
    render();
    expect(trigger().disabled).toBe(true);
    controller = { ...controller, busy: false, preflight: {} as RepositoryWorkflowController["preflight"] };
    render();
    expect(trigger().disabled).toBe(true);
    controller = { ...controller, preflight: null, draft: { type: "amend" } };
    render();
    expect(trigger().disabled).toBe(true);
    expect(controller.openDraft).not.toHaveBeenCalled();
  });
});

describe("历史记录对象菜单", () => {
  let container: HTMLDivElement;
  let anchor: HTMLButtonElement;
  let root: Root;
  const commit = {
    hash: "a".repeat(40), shortHash: "aaaaaaa", subject: "所点提交",
    parentHashes: ["b".repeat(40)], refs: ["HEAD -> main"],
    authorName: "作者", authorEmail: "author@example.com", authoredAt: "2026-11-04T00:00:00Z"
  };
  let close: ReturnType<typeof vi.fn<() => void>>;
  let request: ReturnType<typeof vi.fn<RepositoryCommandController["request"]>>;
  let action: ReturnType<typeof vi.fn<RepositoryCommitActionHandler>>;
  let draft: ReturnType<typeof vi.fn<RepositoryWorkflowController["openDraft"]>>;
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    anchor = document.createElement("button");
    document.body.append(anchor);
    root = createRoot(container);
    close = vi.fn<() => void>();
    request = vi.fn<RepositoryCommandController["request"]>(async () => true);
    action = vi.fn<RepositoryCommitActionHandler>();
    draft = vi.fn<RepositoryWorkflowController["openDraft"]>();
    Object.defineProperty(window, "gitnest", { configurable: true, value: {
      repository: {
        cancelQuery: vi.fn(async () => ({ ok: true })),
        mutateStash: vi.fn(async () => ({ ok: true, value: {} })),
        getStashes: vi.fn(async ({ target }) => ({ ok: true, value: { target, stashes: [] } }))
      }
    } });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    anchor.remove();
    vi.unstubAllGlobals();
  });
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find(item => item.textContent?.trim() === text)!;
  const render = (changes: Partial<React.ComponentProps<typeof RepositoryHistoryMenu>> = {}) => {
    const menu: HistoryContextMenuState = { anchor, x: 20, y: 20, commit };
    act(() => root.render(<RepositoryHistoryMenu contextMenu={menu} onClose={close}
      target={{ repositoryId: "repo", worktreeId: "wt" }} branches={[]} currentBranchName="test"
      commands={{ busy: false, preflight: null, request } as unknown as RepositoryCommandController}
      workflow={{ busy: false, preflight: null, draft: null, openDraft: draft } as unknown as RepositoryWorkflowController}
      operations={[]} onCommitAction={action} onCopyCommitId={async () => undefined}
      onRefresh={async () => undefined} {...changes} />));
  };

  it("对右键点到的提交执行 Revert，打开菜单时不执行 Git", () => {
    render();
    expect(action).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    act(() => button("还原此提交（Revert）…").click());
    expect(action).toHaveBeenCalledExactlyOnceWith("revert", commit);
    expect(close).toHaveBeenCalled();
    expect(document.activeElement).toBe(anchor);
  });

  it("合并提交交由主线选择对话框处理，仍允许创建分支", () => {
    const merge = { ...commit, parentHashes: ["b", "c"] };
    render({ contextMenu: { anchor, x: 20, y: 20, commit: merge } });
    expect(button("拣选到 test（Cherry-pick）…").disabled).toBe(false);
    expect(button("还原此提交（Revert）…").disabled).toBe(false);
    act(() => button("拣选到 test（Cherry-pick）…").click());
    expect(action).toHaveBeenCalledWith("cherry-pick", merge);
    expect(button("创建分支…").disabled).toBe(false);
  });
  it.each([
    ["将 test 重置到此提交（Reset）…", "reset"],
    ["检出此提交…", "checkout-commit"],
    ["拣选到 test（Cherry-pick）…", "cherry-pick"],
    ["还原此提交（Revert）…", "revert"]
  ] as const)("将 %s 绑定到右键所选提交", (label, type) => {
    render();
    act(() => button(label).click());
    expect(action).toHaveBeenCalledWith(type, commit);
    expect(request).not.toHaveBeenCalled();
  });

  it("HEAD 菜单绑定原始 Hash，初始提交不能撤销", () => {
    render();
    act(() => button("修改最近一次提交（Amend）…").click());
    expect(draft).toHaveBeenCalledWith("amend", undefined, undefined, commit.hash);
    render({ contextMenu: { anchor, x: 20, y: 20, commit: { ...commit, parentHashes: [] } } });
    expect(button("撤销最近提交（保留修改）…").disabled).toBe(true);
    render({ head: "c".repeat(40) });
    expect(button("修改最近一次提交（Amend）…")).toBeUndefined();
  });

  it("本地分支按所点名称切换，受其他 Worktree 占用时禁用", () => {
    const contextMenu: HistoryContextMenuState = {
      anchor, x: 20, y: 20, commit,
      refLabel: { kind: "head", key: "head:feature", name: "feature", active: false, remotes: [] }
    };
    const branch = { name: "feature", fullName: "refs/heads/feature", head: commit.hash, remote: false, current: false };
    render({ contextMenu, branches: [branch] });
    act(() => button("切换到此分支…").click());
    expect(request).toHaveBeenCalledWith({ type: "switch-branch", target: { repositoryId: "repo", worktreeId: "wt" }, branch: "feature" });
    render({ contextMenu, branches: [{ ...branch, worktreePath: "E:/other" }], worktreePath: "E:/current" });
    expect(button("切换到此分支…").disabled).toBe(true);
    expect(button("重命名分支…").disabled).toBe(true);
    expect(button("删除本地分支…").disabled).toBe(true);
    render({ contextMenu, branches: [{ ...branch, current: true }] });
    expect(button("删除本地分支…").disabled).toBe(true);
  });

  it("远程分支使用完整名称，不显示本地分支删除入口", () => {
    const contextMenu: HistoryContextMenuState = {
      anchor, x: 20, y: 20, commit,
      refLabel: { kind: "remote", key: "remote:upstream/feature", name: "feature", remote: "upstream" }
    };
    render({ contextMenu, branches: [{ name: "upstream/feature", fullName: "refs/remotes/upstream/feature", head: commit.hash, remote: true, current: false }] });
    act(() => button("切换到此分支…").click());
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ branch: "upstream/feature" }));
    expect(button("删除本地分支…")).toBeUndefined();
  });

  const refLabels: HistoryRefLabel[] = [
    { kind: "head", key: "head:feature", name: "feature", active: false, remotes: [] },
    { kind: "remote", key: "remote:upstream/feature", name: "feature", remote: "upstream" },
    { kind: "tag", key: "tag:v1", name: "v1" }
  ];
  const submenu = () => document.querySelector<HTMLElement>(".history-ref-submenu");
  const childItems = () => [...submenu()!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  function renderWithRefs() {
    render({
      contextMenu: { anchor, x: 20, y: 20, commit, refs: refLabels },
      head: "d".repeat(40),
      branches: [
        { name: "feature", fullName: "refs/heads/feature", head: commit.hash, current: false, remote: false },
        { name: "upstream/feature", fullName: "refs/remotes/upstream/feature", head: commit.hash, current: false, remote: true }
      ]
    });
  }

  it("悬停只展开所选引用的子菜单，保留提交菜单且不执行 Git", async () => {
    renderWithRefs();
    act(() => button("分支：feature").dispatchEvent(new Event("pointerover", { bubbles: true })));
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(2);
    expect(button("还原此提交（Revert）…")).toBeDefined();
    expect(submenu()?.textContent).toContain("重命名分支…");
    expect(request).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    const trigger = button("分支：feature");
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(submenu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(close).not.toHaveBeenCalled();
    act(() => button("远程分支：upstream/feature").dispatchEvent(new Event("pointerover", { bubbles: true })));
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(2);
    expect(submenu()?.textContent).toContain("upstream/feature");
    expect(submenu()?.textContent).not.toContain("删除本地分支");
    expect(close).not.toHaveBeenCalled();
    act(() => button("标签：v1").dispatchEvent(new Event("pointerover", { bubbles: true })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
    expect(submenu()?.textContent).toContain("推送标签…");
    act(() => button("远程分支：upstream/feature").dispatchEvent(new Event("pointerover", { bubbles: true })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
    expect(submenu()?.textContent).toContain("upstream/feature");
    act(() => childItems()[0]!.click());
    expect(request).toHaveBeenCalledExactlyOnceWith({
      type: "switch-branch", target: { repositoryId: "repo", worktreeId: "wt" }, branch: "upstream/feature"
    });
  });

  it("键盘进入和退出子菜单时保持父菜单，并将焦点还给对应引用", () => {
    renderWithRefs();
    const trigger = button("分支：feature");
    act(() => {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(childItems()[0]);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement).toBe(childItems()[1]);
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true })));
    expect(submenu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(close).not.toHaveBeenCalled();
    act(() => trigger.click());
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(submenu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(close).not.toHaveBeenCalled();
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(close).toHaveBeenCalled();
    expect(document.activeElement).toBe(anchor);
  });

  it("鼠标经过相邻引用再进入子菜单时保留原对象，关闭后不被延迟悬停重新打开", async () => {
    renderWithRefs();
    act(() => button("分支：feature").click());
    const localMenu = submenu()!;
    act(() => {
      button("远程分支：upstream/feature").dispatchEvent(new Event("pointerover", { bubbles: true }));
      localMenu.dispatchEvent(new Event("pointerover", { bubbles: true }));
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
    expect(submenu()?.querySelector(".menu-heading")?.textContent).toBe("feature");
    act(() => {
      button("标签：v1").dispatchEvent(new Event("pointerover", { bubbles: true }));
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
    expect(submenu()).toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("引用子菜单的合并绑定来源名称和所选 Hash，目标仍是当前分支", () => {
    renderWithRefs();
    act(() => button("远程分支：upstream/feature").click());
    const merge = childItems().find(item => item.textContent === "合并到 test（Merge）…")!;
    act(() => merge.click());
    expect(action).toHaveBeenCalledExactlyOnceWith("merge", { ...commit, refName: "upstream/feature" });
    expect(request).not.toHaveBeenCalled();
  });

  it("标签子菜单隔离标签操作，外部点击和提交变化会清除子菜单", () => {
    renderWithRefs();
    act(() => button("标签：v1").click());
    expect(submenu()?.textContent).toContain("推送标签…");
    expect(submenu()?.textContent).not.toContain("切换到此分支");
    expect(submenu()?.textContent).not.toContain("重命名分支");
    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(close).toHaveBeenCalled();
    render({ contextMenu: { anchor, x: 20, y: 20, commit: { ...commit, hash: "f".repeat(40) } } });
    expect(submenu()).toBeNull();
    expect(action).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("在 HEAD 禁用合并和变基，并在当前分支变化时更新菜单操作方向", () => {
    render();
    expect(button("合并到 test（Merge）…").disabled).toBe(true);
    expect(button("将 test 变基到此处（Rebase）…").disabled).toBe(true);
    render({ currentBranchName: "pre", head: "d".repeat(40) });
    expect(button("将 pre 重置到此提交（Reset）…").disabled).toBe(false);
    expect(button("拣选到 pre（Cherry-pick）…").disabled).toBe(false);
    act(() => button("将 pre 变基到此处（Rebase）…").click());
    expect(action).toHaveBeenCalledWith("rebase", commit);
  });

  it("stash 先确认，再携带不可变 Hash 执行恢复", async () => {
    const stashCommit = { ...commit, stashRef: "stash@{2}" };
    render({ contextMenu: { anchor, x: 20, y: 20, commit: stashCommit } });
    expect(button("拣选到 test（Cherry-pick）…")).toBeUndefined();
    act(() => button("恢复储藏").click());
    expect(window.gitnest.repository.mutateStash).not.toHaveBeenCalled();
    await act(async () => button("确认恢复").click());
    expect(window.gitnest.repository.mutateStash).toHaveBeenCalledWith({
      target: { repositoryId: "repo", worktreeId: "wt" },
      stashRef: "stash@{2}", stashHash: commit.hash, action: "apply"
    });
  });

  it.each(["scroll", "blur", "resize", "pointerdown"])("在 %s 时关闭对象菜单", event => {
    render();
    act(() => (event === "blur" || event === "resize" ? window : document.body)
      .dispatchEvent(new Event(event, { bubbles: true })));
    expect(close).toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });

  it("支持键盘菜单导航和 Escape 焦点恢复", () => {
    render();
    const first = document.activeElement;
    act(() => first!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement).not.toBe(first);
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(close).toHaveBeenCalled();
    expect(document.activeElement).toBe(anchor);
  });
});
