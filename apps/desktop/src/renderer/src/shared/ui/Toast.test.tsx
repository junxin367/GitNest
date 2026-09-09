/** @vitest-environment jsdom */

import React, { act } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import {
  createRoot,
  type Root
} from "react-dom/client";

import { Toast, ToastViewport } from "./Toast";

describe("Toast", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("portals messages outside the page container and supports dismissal", () => {
    let closed = false;

    act(() => {
      root.render(
        <ToastViewport>
          <Toast
            message="目录已经加入 Workspace。"
            onClose={() => {
              closed = true;
            }}
            title="操作完成"
            tone="success"
          />
        </ToastViewport>
      );
    });

    const toast = document.body.querySelector(".toast");
    expect(toast?.getAttribute("role")).toBe("status");
    expect(toast?.textContent).toContain("操作完成");
    expect(toast?.textContent).toContain(
      "目录已经加入 Workspace。"
    );
    expect(container.querySelector(".toast")).toBeNull();

    const close = toast?.querySelector("button");
    expect(close).toBeInstanceOf(HTMLButtonElement);
    act(() => {
      (close as HTMLButtonElement).click();
    });
    expect(closed).toBe(true);
  });
});
