/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RepositoryHistoryActions } from "./RepositoryHistoryActions";
import type { RepositoryWorkflowController } from "./useRepositoryWorkflow";

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
    ["修正最近提交", "amend"],
    ["撤销最近提交", "undo-commit"]
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
