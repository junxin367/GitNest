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

  it("summarizes the visible additions and deletions for each file group", () => {
    act(() => {
      root.render(
        <DiffFileNavigator
          configuration={
            repositoryDiffWorkspaceConfiguration.navigation
          }
          files={FILES_WITH_STATS}
          onSelectedFileChange={vi.fn()}
          selectedFileKey={FILES_WITH_STATS[0]!.key}
        />
      );
    });

    expect(sectionStats(container, "已暂存")).toBe("+2-1");
    expect(sectionStats(container, "未暂存")).toBe("+4-2");
    expect(sectionStats(container, "未跟踪")).toBe("+4-0");
    expect(fileStatus(container, "src/App.tsx")).toBe("M");
    expect(fileStatus(container, "src/Button.tsx")).toBe("D");
    expect(fileStatus(container, "src/Input.tsx")).toBe("A");
    expect(fileStatus(container, "README.md")).toBe("?");

    const filter = container.querySelector<HTMLInputElement>(
      'input[aria-label="筛选变更文件"]'
    );
    act(() => setInputValue(filter, "Button"));

    expect(sectionStats(container, "已暂存")).toBeNull();
    expect(sectionStats(container, "未暂存")).toBe("+1-0");
    expect(sectionStats(container, "未跟踪")).toBeNull();
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

const FILES_WITH_STATS: DiffViewerFile[] = [
  {
    key: "staged\u0001src/App.tsx",
    path: "src/App.tsx",
    mode: "staged",
    status: "M",
    kind: "ordinary",
    additions: 2,
    deletions: 1,
    change: {
      path: "src/App.tsx",
      indexStatus: "M",
      worktreeStatus: ".",
      kind: "ordinary"
    }
  },
  {
    key: "unstaged\u0001src/Button.tsx",
    path: "src/Button.tsx",
    mode: "unstaged",
    status: "D",
    kind: "ordinary",
    additions: 1,
    deletions: 0,
    change: {
      path: "src/Button.tsx",
      indexStatus: ".",
      worktreeStatus: "D",
      kind: "ordinary"
    }
  },
  {
    key: "unstaged\u0001src/Input.tsx",
    path: "src/Input.tsx",
    mode: "unstaged",
    status: "A",
    kind: "ordinary",
    additions: 3,
    deletions: 2,
    change: {
      path: "src/Input.tsx",
      indexStatus: ".",
      worktreeStatus: "A",
      kind: "ordinary"
    }
  },
  {
    key: "untracked\u0001README.md",
    path: "README.md",
    mode: "untracked",
    status: "?",
    kind: "untracked",
    additions: 4,
    deletions: 0,
    change: {
      path: "README.md",
      indexStatus: "?",
      worktreeStatus: "?",
      kind: "untracked"
    }
  }
];

function sectionStats(
  root: ParentNode,
  title: string
): string | null {
  const section = Array.from(
    root.querySelectorAll<HTMLElement>(
      ".diff-workspace-file-section"
    )
  ).find(
    (candidate) =>
      candidate
        .querySelector(
          ".diff-workspace-file-section-label"
        )
        ?.textContent?.trim() === title
  );
  return (
    section
      ?.querySelector(
        ".diff-workspace-file-section-stats"
      )
      ?.textContent?.replace(/\s+/g, "") ?? null
  );
}

function fileStatus(
  root: ParentNode,
  path: string
): string | null {
  return (
    root
      .querySelector<HTMLButtonElement>(
        `button[aria-label="${path}"]`
      )
      ?.querySelector(".diff-workspace-file-status")
      ?.getAttribute("data-status") ?? null
  );
}

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
