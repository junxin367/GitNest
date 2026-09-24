/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppTitlebar } from "./AppTitlebar";

describe("AppTitlebar help menu", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
