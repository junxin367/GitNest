/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { Input } from "./Input";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal("React", React);

describe("Input", () => {
  it("renders leading and clear controls and invokes clear", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onClear = vi.fn();

    act(() => {
      root.render(
        <Input
          aria-label="筛选文件"
          leading={<span>search</span>}
          onClear={onClear}
          size="small"
          value="src"
          onChange={() => undefined}
        />
      );
    });

    expect(container.querySelector(".gn-input")).not.toBeNull();
    expect(
      container.querySelector(".gn-input__leading")
    ).not.toBeNull();
    const clear = container.querySelector<HTMLButtonElement>(
      ".gn-input__clear"
    );
    act(() => clear?.click());
    expect(onClear).toHaveBeenCalledOnce();

    act(() => root.unmount());
    container.remove();
  });
});
