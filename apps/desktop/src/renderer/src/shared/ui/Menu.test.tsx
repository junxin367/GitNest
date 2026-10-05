/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi
} from "vitest";

import {
  Menu,
  MenuHeading,
  MenuItem,
  MenuPopover,
  MenuSeparator,
  resolveMenuPlacement
} from "./Menu";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

describe("Menu", () => {
  beforeAll(() => {
    vi.stubGlobal("React", React);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("renders the shared menu structure and item states", () => {
    const markup = renderToStaticMarkup(
      <Menu aria-label="仓库操作" className="positioned-menu">
        <MenuHeading>Repository</MenuHeading>
        <MenuItem
          disabled
          leading={<span>icon</span>}
          trailing={<span>arrow</span>}
        >
          打开方式
        </MenuItem>
        <MenuSeparator />
        <MenuItem tone="danger">删除</MenuItem>
      </Menu>
    );

    expect(markup).toContain(
      'class="menu-surface positioned-menu"'
    );
    expect(markup).toContain('class="menu-heading"');
    expect(markup).toContain('class="menu-item"');
    expect(markup).toContain('data-has-leading="true"');
    expect(markup).toContain('data-has-trailing="true"');
    expect(markup).toContain("disabled");
    expect(markup).toContain('class="menu-separator"');
    expect(markup).toContain('class="menu-item danger"');
  });

  it("moves focus between enabled menu items", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <Menu aria-label="焦点测试">
          <MenuItem>第一项</MenuItem>
          <MenuItem disabled>第二项</MenuItem>
          <MenuItem>第三项</MenuItem>
        </Menu>
      );
    });

    const items = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".menu-item")
    );
    items[0]?.focus();
    act(() => {
      items[0]?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "ArrowDown"
        })
      );
    });

    expect(document.activeElement).toBe(items[2]);

    act(() => root.unmount());
    container.remove();
  });

  it("keeps keyboard focus on the navigated item when an autofocus menu is repositioned", async () => {
    const container = document.createElement("div");
    const anchor = document.createElement("button");
    document.body.append(container, anchor);
    const root = createRoot(container);
    try {
      act(() => root.render(
        <MenuPopover anchor={anchor} autoFocus aria-label="自动焦点">
          <MenuItem role="menuitemradio" aria-checked>First</MenuItem>
          <MenuItem role="menuitemradio">Second</MenuItem>
        </MenuPopover>
      ));
      await act(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      const menu = document.querySelector<HTMLElement>('[aria-label="自动焦点"]')!;
      const items = menu.querySelectorAll<HTMLButtonElement>("button");
      expect(document.activeElement).toBe(items[0]);
      act(() => items[0]!.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowDown", bubbles: true
      })));
      expect(document.activeElement).toBe(items[1]);
      act(() => window.dispatchEvent(new Event("resize")));
      expect(document.activeElement).toBe(items[1]);
    } finally {
      act(() => root.unmount());
      container.remove();
      anchor.remove();
    }
  });

  it("positions menus to the right with a 4px gap by default", () => {
    expect(
      resolveMenuPlacement(
        {
          bottom: 40,
          left: 100,
          right: 120,
          top: 20
        },
        {
          height: 60,
          width: 50
        },
        {
          height: 200,
          width: 300
        }
      )
    ).toEqual({
      left: 124,
      side: "right",
      top: 20
    });
  });

  it("focuses an explicitly marked search field before checked menu options", () => {
    const anchor = document.createElement("button");
    const container = document.createElement("div");
    document.body.append(anchor, container);
    const root = createRoot(container);
    try {
      act(() => root.render(
        <MenuPopover anchor={anchor} autoFocus aria-label="搜索菜单">
          <input data-menu-initial-focus aria-label="搜索选项" />
          <MenuItem role="menuitemradio" aria-checked>Selected</MenuItem>
        </MenuPopover>
      ));
      const input = document.querySelector<HTMLInputElement>('[aria-label="搜索选项"]')!;
      expect(document.activeElement).toBe(input);
      act(() => input.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowDown", bubbles: true, cancelable: true
      })));
      expect(document.activeElement?.getAttribute("role")).toBe("menuitemradio");
    } finally {
      act(() => root.unmount());
      anchor.remove();
      container.remove();
    }
  });

  it.each([
    { isComposing: true },
    { keyCode: 229 },
    { key: "Home" },
    { key: "End" }
  ])("preserves input editing keys inside a searchable menu (%j)", (keyboardState) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      act(() => root.render(
        <Menu>
          <input aria-label="分支搜索" defaultValue="feature/branch" />
          <MenuItem>First</MenuItem>
          <MenuItem>Last</MenuItem>
        </Menu>
      ));
      const input = container.querySelector<HTMLInputElement>("input")!;
      input.focus();
      input.setSelectionRange(4, 4);
      const keys = keyboardState.key
        ? [keyboardState.key]
        : ["ArrowDown", "ArrowUp", "Home", "End"];
      for (const key of keys) {
        const event = new KeyboardEvent("keydown", {
          bubbles: true, cancelable: true, ...keyboardState, key
        });
        act(() => input.dispatchEvent(event));
        expect(document.activeElement).toBe(input);
        expect(input.value).toBe("feature/branch");
        expect(event.defaultPrevented).toBe(false);
      }
      act(() => input.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowDown", bubbles: true, cancelable: true
      })));
      expect(document.activeElement?.textContent).toBe("First");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("supports custom menu side, alignment, and gap", () => {
    expect(
      resolveMenuPlacement(
        {
          bottom: 40,
          left: 100,
          right: 120,
          top: 20
        },
        {
          height: 60,
          width: 50
        },
        {
          height: 200,
          width: 300
        },
        {
          align: "end",
          gap: 6,
          side: "bottom"
        }
      )
    ).toEqual({
      left: 70,
      side: "bottom",
      top: 46
    });
  });

  it("flips a right-side menu to the left before clamping", () => {
    expect(
      resolveMenuPlacement(
        {
          bottom: 40,
          left: 280,
          right: 300,
          top: 20
        },
        {
          height: 60,
          width: 50
        },
        {
          height: 200,
          width: 320
        }
      )
    ).toEqual({
      left: 226,
      side: "left",
      top: 20
    });
  });
});
