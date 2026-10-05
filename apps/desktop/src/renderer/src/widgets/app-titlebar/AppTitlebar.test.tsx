/** @vitest-environment jsdom */

import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppTitlebar } from "./AppTitlebar";
import { Dialog } from "../../shared/ui/Dialog";

describe("AppTitlebar help menu", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["file", "help"])("opens the %s menu with ArrowDown and restores focus on Escape", async (menuName) => {
    const fixture = await renderTitlebar();
    try {
      const trigger = fixture.container.querySelector<HTMLButtonElement>(`.titlebar-${menuName}-menu > button`)!;
      trigger.focus();
      act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowDown", bubbles: true, cancelable: true
      })));
      const items = document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
      expect(items.length).toBeGreaterThan(0);
      expect(document.activeElement).toBe(items[0]);
      act(() => items[0]!.dispatchEvent(new KeyboardEvent("keydown", {
        key: "End", bubbles: true, cancelable: true
      })));
      expect(document.activeElement).toBe(items[items.length - 1]);
      act(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape", bubbles: true, cancelable: true
      })));
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally {
      fixture.cleanup();
    }
  });

  it.each([false, true])("closes the menu on Tab and resumes native traversal at its trigger (shift: %s)", async (shiftKey) => {
    const fixture = await renderTitlebar();
    try {
      const trigger = fixture.container.querySelector<HTMLButtonElement>(".titlebar-help-menu > button")!;
      act(() => trigger.click());
      const item = document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
      item.focus();
      const event = new KeyboardEvent("keydown", {
        key: "Tab", shiftKey, bubbles: true, cancelable: true
      });
      act(() => item.dispatchEvent(event));
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(event.defaultPrevented).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });

  it("returns focus to Help after closing a dialog opened from a menu item", async () => {
    const fixture = await renderTitlebar(true);
    try {
      const trigger = fixture.container.querySelector<HTMLButtonElement>(".titlebar-help-menu > button")!;
      trigger.focus();
      act(() => trigger.click());
      const version = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find(item => item.textContent?.startsWith("版本"))!;
      version.focus();
      act(() => version.click());
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement?.textContent).toBe("关闭");
      act(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape", bubbles: true, cancelable: true
      })));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally {
      fixture.cleanup();
    }
  });

  it("dismisses an open menu when the application loses focus", async () => {
    const fixture = await renderTitlebar();
    try {
      act(() => fixture.container.querySelector<HTMLButtonElement>(".titlebar-help-menu > button")!.click());
      expect(document.querySelector('[role="menu"]')).not.toBeNull();
      act(() => window.dispatchEvent(new Event("blur")));
      expect(document.querySelector('[role="menu"]')).toBeNull();
    } finally {
      fixture.cleanup();
    }
  });

  it("opens the GitNest issue form from the feedback item", async () => {
    vi.stubGlobal("React", React);
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const openIssuesPage = vi.fn(async () => undefined);
    vi.stubGlobal("gitnest", {
      system: { openIssuesPage },
      window: {
        isMaximized: vi.fn(async () => false),
        onMaximizedChanged: vi.fn(() => () => undefined)
      }
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <AppTitlebar
            onCreateWorkspace={vi.fn()}
            onOpenSearch={vi.fn()}
            onOpenVersion={vi.fn()}
            runtimeInfo={null}
            searchOpen={false}
          />
        );
      });

      await act(async () => {
        container.querySelector<HTMLButtonElement>(
          '.titlebar-help-menu > button'
        )?.click();
      });
      const feedbackItem = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]'
        )
      ).find((item) => item.textContent === "反馈问题");
      expect(feedbackItem).toBeDefined();

      await act(async () => {
        feedbackItem?.click();
      });
      expect(openIssuesPage).toHaveBeenCalledOnce();
      expect(
        container.querySelector<HTMLButtonElement>(
          '.titlebar-help-menu > button'
        )?.getAttribute("aria-expanded")
      ).toBe("false");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});

async function renderTitlebar(withDialog = false) {
  vi.stubGlobal("React", React);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("gitnest", {
    window: {
      isMaximized: vi.fn(async () => false),
      onMaximizedChanged: vi.fn(() => () => undefined)
    }
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Harness() {
    const [dialogOpen, setDialogOpen] = useState(false);
    return <>
      <AppTitlebar runtimeInfo={null} searchOpen={false}
        onCreateWorkspace={vi.fn()} onOpenSearch={vi.fn()}
        onOpenVersion={() => setDialogOpen(withDialog)} />
      {dialogOpen && <Dialog icon="sparkle" title="版本" onDismiss={() => setDialogOpen(false)}>
        <button type="button" onClick={() => setDialogOpen(false)}>关闭</button>
      </Dialog>}
    </>;
  }
  await act(async () => root.render(<Harness />));
  return {
    container,
    cleanup() {
      act(() => root.unmount());
      container.remove();
    }
  };
}
