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
import {
  DiffWorkspace,
  parseCommitMessage
} from "./DiffWorkspace";
import {
  repositoryDiffWorkspaceConfiguration,
  standaloneDiffWorkspaceConfiguration
} from "./diffWorkspaceConfiguration";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const content = [
  "@@ -1 +1 @@",
  "-const oldValue = true;",
  "+const newValue = true;"
].join("\n");

const files: DiffViewerFile[] = [
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
    key: "unstaged\u0001src/components/Button.tsx",
    path: "src/components/Button.tsx",
    mode: "unstaged",
    status: "M",
    kind: "ordinary",
    additions: 1,
    deletions: 0,
    change: {
      path: "src/components/Button.tsx",
      indexStatus: ".",
      worktreeStatus: "M",
      kind: "ordinary"
    }
  }
];

describe("DiffWorkspace", () => {
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
    document
      .querySelectorAll(".menu-surface")
      .forEach((element) => element.remove());
    vi.unstubAllGlobals();
  });

  it("renders repository navigation and extensions from the shared contract", () => {
    const onSelectedFileChange = vi.fn();
    const onStageFile = vi.fn();
    const onUnstageFile = vi.fn();
    const onOpen = vi.fn();
    const onMessageChange = vi.fn();
    const onPushChange = vi.fn();
    const onSubmit = vi.fn();

    act(() => {
      root.render(
        <DiffWorkspace
          className="changes-layout"
          commit={{
            busy: false,
            conflicted: 0,
            message: "Share the workspace",
            push: false,
            staged: 1,
            submitting: false,
            onMessageChange,
            onPushChange,
            onSubmit
          }}
          configuration={repositoryDiffWorkspaceConfiguration}
          files={files}
          onSelectedFileChange={onSelectedFileChange}
          onStageFile={onStageFile}
          onUnstageFile={onUnstageFile}
          openStandalone={{
            busy: false,
            onOpen
          }}
          panelProps={{
            additions: 2,
            content,
            deletions: 1
          }}
          selectedFileKey={files[0]?.key}
        />
      );
    });

    expect(
      container.querySelectorAll(".diff-workspace-file")
    ).toHaveLength(2);
    expect(container.textContent).toContain("+2");
    expect(container.textContent).toContain("-1");
    expect(
      container.querySelector(".diff-viewer-toolbar")
    ).toBeNull();
    expect(
      container.querySelector(
        '[aria-label="在独立窗口中打开 Diff"]'
      )
    ).not.toBeNull();
    expect(
      container.querySelector(
        ".diff-viewer-file-header-separator"
      )
    ).not.toBeNull();
    expect(
      container.querySelector(".diff-workspace-commit")
    ).not.toBeNull();
    expect(container.textContent).not.toContain("创建提交");
    expect(container.textContent).not.toContain("提交主题");
    expect(
      container.querySelector<HTMLInputElement>(
        '[name="push-after-commit"]'
      )
    ).not.toBeNull();
    expect(
      container.querySelector<HTMLTextAreaElement>(
        '[aria-label="提交信息"]'
      )?.value
    ).toBe("Share the workspace");

    act(() => {
      const message =
        container.querySelector<HTMLTextAreaElement>(
          '[aria-label="提交信息"]'
        );
      if (!message) {
        throw new Error("Commit message was not rendered.");
      }
      setTextControlValue(message, "Update workspace\n\nDetails");
    });
    expect(onMessageChange).toHaveBeenCalledWith(
      "Update workspace\n\nDetails"
    );

    act(() => {
      container
        .querySelector<HTMLInputElement>(
          '[name="push-after-commit"]'
        )
        ?.click();
    });
    expect(onPushChange).toHaveBeenCalledWith(true);

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="src/components/Button.tsx"]'
        )
        ?.click();
    });
    expect(onSelectedFileChange).toHaveBeenCalledWith(files[1]);

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="暂存 src/components/Button.tsx"]'
        )
        ?.click();
    });
    expect(onStageFile).toHaveBeenCalledWith(files[1]);

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="取消暂存 src/App.tsx"]'
        )
        ?.click();
    });
    expect(onUnstageFile).toHaveBeenCalledWith(files[0]);

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="在独立窗口中打开 Diff"]'
        )
        ?.click();
    });
    expect(onOpen).toHaveBeenCalledTimes(1);

    act(() => {
      container
        .querySelector<HTMLFormElement>(
          ".diff-workspace-commit form"
        )
        ?.dispatchEvent(
          new Event("submit", {
            bubbles: true,
            cancelable: true
          })
        );
    });
    expect(onSubmit).toHaveBeenCalledWith(
      "Share the workspace",
      false
    );
  });

  it("renders standalone toolbar, refresh, filtering, and tree view", () => {
    const onRefresh = vi.fn();

    act(() => {
      root.render(
        <DiffWorkspace
          configuration={standaloneDiffWorkspaceConfiguration}
          files={files}
          onRefresh={onRefresh}
          onSelectedFileChange={vi.fn()}
          onStageFile={vi.fn()}
          onUnstageFile={vi.fn()}
          panelProps={{
            additions: 2,
            content,
            deletions: 1
          }}
          selectedFileKey={files[0]?.key}
          statusbar={<span>UTF-8</span>}
        />
      );
    });

    expect(
      container.querySelector(".diff-viewer-toolbar")
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[aria-label="在独立窗口中打开 Diff"]'
      )
    ).toBeNull();
    expect(
      container.querySelector(".diff-workspace-commit")
    ).toBeNull();
    expect(
      container.querySelector(".diff-workspace-statusbar")
        ?.textContent
    ).toContain("UTF-8");

    const filter =
      container.querySelector<HTMLInputElement>(
        '[aria-label="筛选变更文件"]'
      );
    act(() => {
      if (!filter) {
        throw new Error("File filter was not rendered.");
      }
      setInputValue(filter, "Button");
    });
    expect(
      container.querySelectorAll(".diff-workspace-file")
    ).toHaveLength(1);

    act(() => {
      setInputValue(filter!, "");
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="打开变更文件视图菜单"]'
        )
        ?.click();
    });
    act(() => {
      findButton(document.body, "以树形式查看").click();
    });
    expect(
      container.querySelector(".diff-workspace-tree-directory")
    ).not.toBeNull();

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="打开变更文件视图菜单"]'
        )
        ?.click();
    });
    act(() => {
      findButton(document.body, "重新读取变更").click();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("maps the single commit message to Git subject and body", () => {
    expect(
      parseCommitMessage(
        "Update workspace state\n\nExplain the migration."
      )
    ).toEqual({
      subject: "Update workspace state",
      body: "Explain the migration."
    });
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

function setInputValue(
  input: HTMLInputElement,
  value: string
) {
  setTextControlValue(input, value);
}

function setTextControlValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string
) {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(
    prototype,
    "value"
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(
    new Event("input", {
      bubbles: true
    })
  );
}
