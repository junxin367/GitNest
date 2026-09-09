/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { DiffSearchPopover } from "./DiffSearchPopover";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal("React", React);

describe("DiffSearchPopover", () => {
  it("shares search structure and keyboard navigation behavior", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onClose = vi.fn();

    act(() => {
      root.render(
        <DiffSearchPopover
          countLabel="2 / 5"
          hasMatches
          onChange={() => undefined}
          onClose={onClose}
          onNext={onNext}
          onPrevious={onPrevious}
          value="diff"
        />
      );
    });

    const popover = container.querySelector(
      ".gn-diff-search-popover"
    );
    expect(popover?.getAttribute("role")).toBe("search");
    expect(popover?.textContent).toContain("2 / 5");
    const input = container.querySelector<HTMLInputElement>(
      ".gn-diff-search-popover__input"
    );

    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter"
        })
      );
      input?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter",
          shiftKey: true
        })
      );
      input?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Escape"
        })
      );
    });

    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();

    act(() => root.unmount());
    container.remove();
  });

  it("does not render while closed", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <DiffSearchPopover
          countLabel="0 / 0"
          hasMatches={false}
          onChange={() => undefined}
          onClose={() => undefined}
          onNext={() => undefined}
          onPrevious={() => undefined}
          open={false}
          value=""
        />
      );
    });

    expect(container.innerHTML).toBe("");
    act(() => root.unmount());
    container.remove();
  });
});
