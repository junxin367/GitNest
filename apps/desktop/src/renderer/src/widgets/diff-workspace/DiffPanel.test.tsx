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

import { DiffPanel } from "./DiffPanel";
import {
  repositoryDiffWorkspaceConfiguration,
  standaloneDiffWorkspaceConfiguration
} from "./diffWorkspaceConfiguration";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const content = [
  "diff --git a/src/App.tsx b/src/App.tsx",
  "index 1111111..2222222 100644",
  "--- a/src/App.tsx",
  "+++ b/src/App.tsx",
  "@@ -1 +1 @@",
  "-const oldValue = true;",
  "+const newValue = true;"
].join("\n");

describe("DiffPanel configuration", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }
    );
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn()
    });
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      {
        configurable: true,
        value: vi.fn()
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

  it("keeps the standalone layout controls from the Diff window", () => {
    act(() => {
      root.render(
        <DiffPanel
          additions={1}
          config={standaloneDiffWorkspaceConfiguration.document}
          content={content}
          deletions={1}
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
        />
      );
    });

    expect(findButton(container, "统一").dataset.selected).toBe(
      "true"
    );
    expect(findButton(container, "并排")).toBeDefined();
    expect(findButton(container, "自动换行")).toBeDefined();
  });

  it("uses one unified layout for repositories and exposes extensions as slots", () => {
    act(() => {
      root.render(
        <DiffPanel
          additions={1}
          config={repositoryDiffWorkspaceConfiguration.document}
          content={content}
          deletions={1}
          headerActions={
            <button type="button">打开独立 Diff</button>
          }
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
        />
      );
    });

    expect(
      container.querySelector(".diff-viewer-toolbar")
    ).toBeNull();
    expect(
      container.querySelector(".diff-viewer-unified")
    ).not.toBeNull();
    expect(
      container.querySelector<HTMLElement>(
        '[role="region"][aria-label="文件 Diff"]'
      )?.tabIndex
    ).toBe(0);
    expect(container.textContent).not.toContain("diff --git");
    expect(container.textContent).not.toContain("index 1111111");
    expect(container.textContent).not.toContain("--- a/");
    expect(container.textContent).not.toContain("+++ b/");
    expect(findButton(container, "打开独立 Diff")).toBeDefined();
  });
});

function findButton(
  root: ParentNode,
  text: string
): HTMLButtonElement {
  const button = Array.from(
    root.querySelectorAll<HTMLButtonElement>("button")
  ).find((candidate) => candidate.textContent?.trim() === text);
  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}
