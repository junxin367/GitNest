/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { Textarea } from "./Textarea";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal("React", React);

describe("Textarea", () => {
  it("keeps the native control inside one shared visual boundary", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <Textarea
          aria-label="提交信息"
          fullWidth
          maxLength={100_000}
          rows={3}
          size="small"
          textareaClassName="commit-message"
          value="更新仓库"
          onChange={() => undefined}
        />
      );
    });

    const field = container.querySelector(".gn-textarea-field");
    const boundary = container.querySelector(".gn-textarea");
    const control =
      container.querySelector<HTMLTextAreaElement>(
        ".gn-textarea__control"
      );

    expect(field?.getAttribute("data-full-width")).toBe("true");
    expect(boundary?.getAttribute("data-size")).toBe("small");
    expect(control?.value).toBe("更新仓库");
    expect(control?.rows).toBe(3);
    expect(control?.maxLength).toBe(100_000);
    expect(control?.classList).toContain("commit-message");
    expect(boundary?.querySelectorAll("textarea")).toHaveLength(1);

    act(() => root.unmount());
    container.remove();
  });

  it("associates labels and exposes error state", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <Textarea
          helpText="请输入提交信息"
          id="commit-message"
          label="提交信息"
          state="error"
        />
      );
    });

    expect(
      container.querySelector("label")?.getAttribute("for")
    ).toBe("commit-message");
    expect(
      container
        .querySelector("textarea")
        ?.getAttribute("aria-invalid")
    ).toBe("true");
    expect(
      container.querySelector(".gn-textarea-field__help")
        ?.textContent
    ).toBe("请输入提交信息");

    act(() => root.unmount());
    container.remove();
  });
});
