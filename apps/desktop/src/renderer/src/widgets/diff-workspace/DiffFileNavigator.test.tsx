/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import type { DiffViewerFile } from "../../shared/model/diffViewModel";
import { DiffFileNavigator } from "./DiffFileNavigator";
import { repositoryDiffWorkspaceConfiguration } from "./diffWorkspaceConfiguration";

describe("DiffFileNavigator selection reveal", () => {
  let container: HTMLDivElement;
  let root: Root;
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) =>
        window.setTimeout(() => callback(0), 0)
    );
    vi.stubGlobal("cancelAnimationFrame", window.clearTimeout);
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    scrollIntoView = vi.fn();
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      {
        configurable: true,
        value: scrollIntoView
      }
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("clears the old filter, expands tree ancestors, scrolls, and focuses the requested file", async () => {
    act(() => {
      root.render(
        <DiffFileNavigator
          configuration={
            repositoryDiffWorkspaceConfiguration.navigation
          }
          fileView="tree"
          files={FILES}
          selectedFileKey={FILES[0]!.key}
          treePreference={{
            initiallyCollapsed: true,
            scopeKey: "selection-reveal-test"
          }}
          onSelectedFileChange={vi.fn()}
        />
      );
    });
    const filter = container.querySelector<HTMLInputElement>(
      'input[aria-label="筛选变更文件"]'
    );
    act(() => setInputValue(filter, "other"));
    expect(filter?.value).toBe("other");

    await act(async () => {
      root.render(
        <DiffFileNavigator
          configuration={
            repositoryDiffWorkspaceConfiguration.navigation
          }
          fileView="tree"
          files={FILES}
          selectedFileKey={FILES[1]!.key}
          selectionRevealKey="request-1"
          treePreference={{
            initiallyCollapsed: true,
            scopeKey: "selection-reveal-test"
          }}
          onSelectedFileChange={vi.fn()}
        />
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const requestedButton =
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="target.ts"]'
      );
    expect(requestedButton).not.toBeNull();
    expect(requestedButton?.getAttribute("aria-current")).toBe(
      "true"
    );
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="筛选变更文件"]'
      )?.value
    ).toBe("");
    expect(document.activeElement).toBe(requestedButton);
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });
});

const FILES: DiffViewerFile[] = [
  {
    key: "unstaged\u0001src/other.ts",
    path: "src/other.ts",
    mode: "unstaged",
    status: "M",
    kind: "ordinary",
    change: {
      path: "src/other.ts",
      indexStatus: ".",
      worktreeStatus: "M",
      kind: "ordinary"
    }
  },
  {
    key: "unstaged\u0001src/nested/target.ts",
    path: "src/nested/target.ts",
    mode: "unstaged",
    status: "M",
    kind: "ordinary",
    change: {
      path: "src/nested/target.ts",
      indexStatus: ".",
      worktreeStatus: "M",
      kind: "ordinary"
    }
  }
];

function setInputValue(
  input: HTMLInputElement | null,
  value: string
) {
  if (!input) {
    throw new Error("Diff file filter was not rendered.");
  }
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(
    new Event("input", {
      bubbles: true
    })
  );
}
