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
