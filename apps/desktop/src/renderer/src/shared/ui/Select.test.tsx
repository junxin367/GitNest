/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import { Select } from "./Select";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal("React", React);

afterEach(() => {
  document.body.replaceChildren();
});

describe("Select", () => {
  it("uses the shared medium button contract by default", () => {
    const markup = renderToStaticMarkup(
      <Select
        ariaLabel="选择终端"
        label="默认终端"
        onChange={() => undefined}
        options={[
          {
            label: "Windows Terminal",
            value: "windows-terminal"
          }
        ]}
        value="windows-terminal"
      />
    );

    expect(markup).toContain("gn-select-field");
    expect(markup).toContain("gn-select__trigger");
    expect(markup).toContain("gn-button");
    expect(markup).toContain('data-size="medium"');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain("Windows Terminal");
  });

  it("passes small and large sizes to the shared button", () => {
    for (const size of ["small", "large"] as const) {
      const markup = renderToStaticMarkup(
        <Select
          ariaLabel={`${size} select`}
          onChange={() => undefined}
          options={[{ label: size, value: size }]}
          size={size}
          value={size}
        />
      );

      expect(markup).toContain(`data-size="${size}"`);
    }
  });

  it("opens the shared menu, selects an option, and restores focus", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => {
      root.render(
        <Select
          ariaLabel="选择终端"
          menuAriaLabel="终端选项"
          onChange={onChange}
          options={[
            {
              label: "Windows Terminal",
              value: "windows-terminal"
            },
            {
              label: "PowerShell",
              value: "powershell"
            }
          ]}
          value="windows-terminal"
        />
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      ".gn-select__trigger"
    );
    act(() => trigger?.click());

    const menu = document.body.querySelector(
      '[aria-label="终端选项"]'
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(menu?.getAttribute("role")).toBe("menu");
    const selectedOption = menu?.querySelector(
      '[role="menuitemradio"][aria-checked="true"]'
    );
    expect(selectedOption?.textContent).toContain(
      "Windows Terminal"
    );
    expect(selectedOption?.classList.contains("is-selected")).toBe(
      true
    );
    expect(
      selectedOption?.querySelector(".menu-item-trailing")
    ).toBeNull();
    act(() => {
      menu?.dispatchEvent(new Event("scroll"));
    });
    expect(
      document.body.querySelector('[aria-label="终端选项"]')
    ).toBe(menu);

    const powerShell = Array.from(
      menu?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]'
      ) ?? []
    ).find((item) => item.textContent?.includes("PowerShell"));
    act(() => powerShell?.click());

    expect(onChange).toHaveBeenCalledWith("powershell");
    expect(
      document.body.querySelector('[aria-label="终端选项"]')
    ).toBeNull();
    expect(document.activeElement).toBe(trigger);

    act(() => root.unmount());
  });

  it("closes on Escape and disables an empty select", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <Select
          ariaLabel="选择终端"
          onChange={() => undefined}
          options={[
            {
              label: "Windows Terminal",
              value: "windows-terminal"
            }
          ]}
          value="windows-terminal"
        />
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      ".gn-select__trigger"
    );
    act(() => trigger?.click());
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Escape"
        })
      );
    });

    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);

    act(() => {
      root.render(
        <Select
          ariaLabel="选择终端"
          onChange={() => undefined}
          options={[]}
          placeholder="没有可用终端"
        />
      );
    });

    const emptyTrigger =
      container.querySelector<HTMLButtonElement>(
        ".gn-select__trigger"
      );
    expect(emptyTrigger?.disabled).toBe(true);
    expect(emptyTrigger?.textContent).toContain("没有可用终端");

    act(() => root.unmount());
  });
});
