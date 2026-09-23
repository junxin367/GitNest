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
import { useMinimumLoadingIndicator } from "../../shared/lib/useMinimumLoadingIndicator";
import {
  Skeleton,
  SkeletonBoundary
} from "../../shared/ui/Skeleton";
import {
  DiffWorkspace,
  DiffWorkspaceSkeleton,
  type DiffWorkspaceExternalApplications,
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

const untrackedFiles: DiffViewerFile[] = [
  {
    key: "untracked\u0001src/new-file.ts",
    path: "src/new-file.ts",
    mode: "untracked",
    status: "?",
    kind: "untracked",
    additions: 3,
    deletions: 0,
    change: {
      path: "src/new-file.ts",
      indexStatus: "?",
      worktreeStatus: "?",
      kind: "untracked"
    }
  },
  {
    key: "untracked\u0001src/another-file.ts",
    path: "src/another-file.ts",
    mode: "untracked",
    status: "?",
    kind: "untracked",
    additions: 1,
    deletions: 0,
    change: {
      path: "src/another-file.ts",
      indexStatus: "?",
      worktreeStatus: "?",
      kind: "untracked"
    }
  }
];

const externalApplications: DiffWorkspaceExternalApplications = {
  active: null,
  loading: false,
  openFile: vi.fn().mockResolvedValue(true),
  profiles: []
};

function DelayedLoadingHarness({
  loading
}: {
  loading: boolean;
}) {
  const visible = useMinimumLoadingIndicator(loading);
  return (
    <span data-testid="delayed-loading">
      {visible ? "visible" : "hidden"}
    </span>
  );
}

function SkeletonBoundaryHarness({
  hasContent = false,
  loading
}: {
  hasContent?: boolean;
  loading: boolean;
}) {
  return (
    <SkeletonBoundary
      fallback={<Skeleton height={40} />}
      hasContent={hasContent}
      label="正在读取测试内容"
      loading={loading}
    >
      <span data-testid="loaded-content">content</span>
    </SkeletonBoundary>
  );
}

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

  it("shows the skeleton as soon as loading starts", () => {
    act(() => {
      root.render(<DelayedLoadingHarness loading />);
    });

    expect(container.textContent).toBe("visible");
  });

  it("keeps a displayed skeleton visible for at least 100ms", () => {
    vi.useFakeTimers();
    try {
      act(() => {
        root.render(<DelayedLoadingHarness loading />);
      });
      expect(container.textContent).toBe("visible");

      act(() => {
        vi.advanceTimersByTime(50);
      });
      act(() => {
        root.render(<DelayedLoadingHarness loading={false} />);
      });
      act(() => {
        vi.advanceTimersByTime(49);
      });
      expect(container.textContent).toBe("visible");

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(container.textContent).toBe("hidden");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the skeleton visible when loading restarts", () => {
    vi.useFakeTimers();
    try {
      act(() => {
        root.render(<DelayedLoadingHarness loading />);
      });
      act(() => {
        root.render(<DelayedLoadingHarness loading={false} />);
      });
      act(() => {
        vi.advanceTimersByTime(200);
      });
      act(() => {
        root.render(<DelayedLoadingHarness loading />);
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(container.textContent).toBe("visible");

      act(() => {
        root.render(<DelayedLoadingHarness loading={false} />);
      });
      expect(container.textContent).toBe("hidden");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps existing content visible during background refreshes", () => {
    act(() => {
      root.render(
        <SkeletonBoundaryHarness hasContent loading />
      );
    });

    expect(
      container.querySelector('[role="status"]')
    ).toBeNull();
    expect(container.textContent).toBe("content");
  });

  it("removes a visible skeleton as soon as content arrives", () => {
    vi.useFakeTimers();
    try {
      act(() => {
        root.render(<SkeletonBoundaryHarness loading />);
      });
      expect(
        container.querySelector('[role="status"]')
      ).not.toBeNull();

      act(() => {
        root.render(
          <SkeletonBoundaryHarness hasContent loading />
        );
      });

      expect(
        container.querySelector('[role="status"]')
      ).toBeNull();
      expect(container.textContent).toBe("content");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the shared minimum duration for empty loading boundaries", () => {
    vi.useFakeTimers();
    try {
      act(() => {
        root.render(<SkeletonBoundaryHarness loading />);
      });
      expect(
        container.querySelector('[role="status"]')?.getAttribute(
          "aria-label"
        )
      ).toBe("正在读取测试内容");

      act(() => {
        root.render(
          <SkeletonBoundaryHarness loading={false} />
        );
        vi.advanceTimersByTime(99);
      });
      expect(
        container.querySelector('[role="status"]')
      ).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(container.textContent).toBe("content");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders a layout-matched loading skeleton for repository changes", () => {
    act(() => {
      root.render(
        <DiffWorkspaceSkeleton
          className="changes-layout"
          commitPanelHeight={240}
          label="正在读取工作区变更…"
          showCommit
        />
      );
    });

    const status = container.querySelector<HTMLElement>(
      '[role="status"]'
    );
    expect(status?.getAttribute("aria-busy")).toBe("true");
    expect(status?.getAttribute("aria-label")).toBe(
      "正在读取工作区变更…"
    );
    expect(status?.classList.contains("changes-layout")).toBe(true);
    expect(
      container.querySelector(".diff-workspace-sidebar")
    ).not.toBeNull();
    expect(
      container.querySelector(".diff-workspace-skeleton-content")
    ).not.toBeNull();
    expect(
      container.querySelectorAll(
        ".diff-workspace-skeleton-file-row"
      )
    ).toHaveLength(5);
    expect(
      container.querySelector<HTMLElement>(
        ".diff-workspace-skeleton-commit"
      )?.style.height
    ).toBe("240px");
  });

  it("renders repository navigation and extensions from the shared contract", () => {
    const onSelectedFileChange = vi.fn();
    const onStageFile = vi.fn();
    const onUnstageFile = vi.fn();
    const onOpen = vi.fn();
    const onMessageChange = vi.fn();
    const onPushChange = vi.fn();
    const onSubmit = vi.fn();
    const onGenerate = vi.fn();

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
            unstaged: 1,
            untracked: 0,
            submitting: false,
            ai: {
              enabled: true,
              busy: false,
              onGenerate
            },
            onMessageChange,
            onPushChange,
            onSubmit
          }}
          configuration={repositoryDiffWorkspaceConfiguration}
          externalApplications={externalApplications}
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
    expect(
      container.querySelectorAll(
        ".diff-workspace-file-meta small"
      )
    ).toHaveLength(0);
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
    expect(container.querySelector(".gn-textarea")).not.toBeNull();
    const aiGenerateButton =
      container.querySelector<HTMLButtonElement>(
        '[aria-label="使用 AI 生成提交信息"]'
      );
    const commitActions = container.querySelector(
      ".diff-workspace-commit-form-actions"
    );
    expect(
      aiGenerateButton?.parentElement
    ).toBe(commitActions);
    expect(aiGenerateButton?.textContent).toBe("");
    expect(aiGenerateButton?.dataset.iconOnly).toBe("true");
    expect(
      findButton(container, "提交已暂存变更")
        .parentElement
    ).toBe(commitActions);
    expect(
      findButton(container, "提交已暂存变更").dataset.fullWidth
    ).toBe("true");

    act(() => {
      aiGenerateButton?.click();
    });
    expect(onGenerate).toHaveBeenCalledTimes(1);

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

    const unstageButton =
      container.querySelector<HTMLButtonElement>(
        '[aria-label="取消暂存 src/App.tsx"]'
      );
    expect(
      unstageButton?.querySelector("path")?.getAttribute("d")
    ).toBe("M6 12h12");

    act(() => {
      unstageButton?.click();
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

  it("keeps navigation and commit state mounted while an auxiliary view replaces the document", () => {
    const onToggle = vi.fn();
    const onSelectedFileChange = vi.fn();
    const renderWorkspace = (active: boolean) => (
      <DiffWorkspace
        auxiliaryView={{
          active,
          content: (
            <div data-testid="stash-browser">
              Stash browser
            </div>
          ),
          count: 2,
          label: "储藏的变更",
          onToggle
        }}
        commit={{
          busy: false,
          conflicted: 0,
          message: "Keep this message",
          push: false,
          staged: 1,
          submitting: false,
          unstaged: 1,
          untracked: 0,
          onMessageChange: vi.fn(),
          onPushChange: vi.fn(),
          onSubmit: vi.fn()
        }}
        configuration={repositoryDiffWorkspaceConfiguration}
        externalApplications={externalApplications}
        files={files}
        onSelectedFileChange={onSelectedFileChange}
        panelProps={{
          additions: 2,
          content,
          deletions: 1
        }}
        selectedFileKey={files[0]?.key}
      />
    );

    act(() => {
      root.render(renderWorkspace(false));
    });

    const toggle =
      container.querySelector<HTMLButtonElement>(
        '[aria-label="储藏的变更"]'
      );
    const message =
      container.querySelector<HTMLTextAreaElement>(
        '[aria-label="提交信息"]'
      );
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    expect(toggle?.textContent).toContain("2");
    expect(
      container.querySelector(".diff-viewer-panel")
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="stash-browser"]')
    ).not.toBeNull();
    expect(
      container
        .querySelector(".diff-workspace-auxiliary-content")
        ?.hasAttribute("hidden")
    ).toBe(true);
    expect(
      container.querySelector(".diff-workspace-auxiliary-entry")
        ?.nextElementSibling
    ).toBe(container.querySelector(".diff-workspace-commit"));

    act(() => {
      toggle?.click();
    });
    expect(onToggle).toHaveBeenCalledTimes(1);

    act(() => {
      root.render(renderWorkspace(true));
    });

    expect(
      container
        .querySelector('[aria-label="储藏的变更"]')
        ?.getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      container.querySelector('[data-testid="stash-browser"]')
    ).not.toBeNull();
    expect(
      container.querySelector(".diff-viewer-panel")
    ).not.toBeNull();
    expect(
      container
        .querySelector(".diff-workspace-primary-content")
        ?.hasAttribute("hidden")
    ).toBe(true);
    expect(
      container.querySelector('[aria-label="提交信息"]')
    ).toBe(message);

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="src/components/Button.tsx"]'
        )
        ?.click();
    });
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onSelectedFileChange).toHaveBeenCalledWith(files[1]);
  });

  it("keeps the auxiliary view open for automatic file selection and closes it for a file click", () => {
    const onToggle = vi.fn();
    const onSelectedFileChange = vi.fn();

    act(() => {
      root.render(
        <DiffWorkspace
          auxiliaryView={{
            active: true,
            content: (
              <div data-testid="stash-browser">
                Stash browser
              </div>
            ),
            count: 2,
            label: "储藏的变更",
            onToggle
          }}
          configuration={repositoryDiffWorkspaceConfiguration}
          externalApplications={externalApplications}
          files={[files[1]!]}
          onSelectedFileChange={onSelectedFileChange}
          panelProps={{ content }}
          selectedFileKey={files[0]?.key}
        />
      );
    });

    expect(onSelectedFileChange).toHaveBeenCalledWith(files[1]);
    expect(onToggle).not.toHaveBeenCalled();

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="src/components/Button.tsx"]'
        )
        ?.click();
    });

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onSelectedFileChange).toHaveBeenLastCalledWith(
      files[1]
    );
  });

  it("keeps the auxiliary entry available when the working tree is clean", () => {
    act(() => {
      root.render(
        <DiffWorkspace
          auxiliaryView={{
            active: false,
            content: <div>Stash browser</div>,
            count: 0,
            label: "储藏的变更",
            onToggle: vi.fn()
          }}
          configuration={repositoryDiffWorkspaceConfiguration}
          externalApplications={externalApplications}
          files={[]}
          onSelectedFileChange={vi.fn()}
          panelProps={{
            emptyPathLabel: "选择一个文件"
          }}
        />
      );
    });

    expect(
      container.querySelector('[aria-label="储藏的变更"]')
    ).not.toBeNull();
    expect(container.textContent).toContain("工作区干净");
  });

  it("renders standalone toolbar, refresh, filtering, and tree view", () => {
    const onRefresh = vi.fn();

    act(() => {
      root.render(
        <DiffWorkspace
          configuration={standaloneDiffWorkspaceConfiguration}
          externalApplications={externalApplications}
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

  it("restores each repository file navigator state after unmounting", () => {
    const onSelectedFileChange = vi.fn();
    const renderRepository = (scopeKey?: string) => {
      act(() => {
        root.render(
          scopeKey ? (
            <DiffWorkspace
              configuration={repositoryDiffWorkspaceConfiguration}
              externalApplications={externalApplications}
              files={files}
              onSelectedFileChange={onSelectedFileChange}
              panelProps={{ content }}
              selectedFileKey={files[0]?.key}
              treePreference={{
                initiallyCollapsed: false,
                scopeKey
              }}
            />
          ) : (
            <div data-testid="repository-loading" />
          )
        );
      });
    };

    const repositoryAScope =
      "workspace\u0001repository-a:worktree-a";
    const repositoryBScope =
      "workspace\u0001repository-b:worktree-b";

    renderRepository(repositoryAScope);
    expect(
      findButton(container, "已暂存").getAttribute(
        "aria-expanded"
      )
    ).toBe("true");
    act(() => {
      findButton(container, "已暂存").click();
    });
    const repositoryAFilter =
      container.querySelector<HTMLInputElement>(
        '[aria-label="筛选变更文件"]'
      );
    act(() => {
      if (!repositoryAFilter) {
        throw new Error("File filter was not rendered.");
      }
      setInputValue(repositoryAFilter, "App");
    });
    expect(
      findButton(container, "已暂存").getAttribute(
        "aria-expanded"
      )
    ).toBe("false");

    renderRepository();
    renderRepository(repositoryBScope);
    const repositoryBFilter =
      container.querySelector<HTMLInputElement>(
        '[aria-label="筛选变更文件"]'
      );
    expect(repositoryBFilter?.value).toBe("");
    expect(
      findButton(container, "已暂存").getAttribute(
        "aria-expanded"
      )
    ).toBe("true");
    act(() => {
      findButton(container, "未暂存").click();
      if (!repositoryBFilter) {
        throw new Error("File filter was not rendered.");
      }
      setInputValue(repositoryBFilter, "Button");
    });
    expect(
      findButton(container, "未暂存").getAttribute(
        "aria-expanded"
      )
    ).toBe("false");

    renderRepository();
    renderRepository(repositoryAScope);
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="筛选变更文件"]'
      )?.value
    ).toBe("App");
    expect(
      findButton(container, "已暂存").getAttribute(
        "aria-expanded"
      )
    ).toBe("false");

    renderRepository();
    renderRepository(repositoryBScope);
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="筛选变更文件"]'
      )?.value
    ).toBe("Button");
    expect(
      findButton(container, "未暂存").getAttribute(
        "aria-expanded"
      )
    ).toBe("false");
  });

  it("provides the same file context menu to every workspace consumer", () => {
    const onSelectedFileChange = vi.fn();
    const openFile = vi.fn().mockResolvedValue(true);

    act(() => {
      root.render(
        <DiffWorkspace
          configuration={standaloneDiffWorkspaceConfiguration}
          externalApplications={{
            active: null,
            loading: false,
            openFile,
            profiles: [{ kind: "vscode", label: "VS Code" }]
          }}
          files={files}
          onSelectedFileChange={onSelectedFileChange}
          panelProps={{ content }}
          selectedFileKey={files[0]?.key}
        />
      );
    });

    const fileRow = Array.from(
      container.querySelectorAll<HTMLDivElement>(
        ".diff-workspace-file"
      )
    ).find((candidate) =>
      candidate.textContent?.includes("Button.tsx")
    );
    if (!fileRow) {
      throw new Error("Unstaged file row was not rendered.");
    }

    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 80
    });
    act(() => {
      fileRow.dispatchEvent(contextMenuEvent);
    });

    expect(contextMenuEvent.defaultPrevented).toBe(true);
    expect(onSelectedFileChange).toHaveBeenCalledWith(files[1]);

    act(() => {
      findButton(document.body, "VS Code").click();
    });

    expect(openFile).toHaveBeenCalledWith(
      "vscode",
      "src/components/Button.tsx"
    );
  });

  it("asks for confirmation before discarding one tracked file", async () => {
    const onDiscardFile = vi.fn().mockResolvedValue(true);

    act(() => {
      root.render(
        <DiffWorkspace
          canDiscardFile={() => true}
          configuration={repositoryDiffWorkspaceConfiguration}
          externalApplications={externalApplications}
          files={[files[1]!]}
          onDiscardFile={onDiscardFile}
          onSelectedFileChange={vi.fn()}
          panelProps={{ content }}
          selectedFileKey={files[1]?.key}
        />
      );
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="放弃更改 src/components/Button.tsx"]'
        )
        ?.click();
    });

    expect(onDiscardFile).not.toHaveBeenCalled();
    const discardDialog =
      document.body.querySelector<HTMLElement>(
        '[role="alertdialog"]'
      );
    expect(
      discardDialog?.querySelector("h2")?.textContent
    ).toBe("放弃文件更改？");
    expect(discardDialog?.textContent).toContain(
      "src/components/Button.tsx"
    );
    expect(document.activeElement?.textContent?.trim()).toBe(
      "取消"
    );

    act(() => {
      findButton(document.body, "取消").click();
    });
    expect(
      document.body.querySelector('[role="alertdialog"]')
    ).toBeNull();
    expect(onDiscardFile).not.toHaveBeenCalled();

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="放弃更改 src/components/Button.tsx"]'
        )
        ?.click();
    });
    await act(async () => {
      findButton(document.body, "确认放弃").click();
      await Promise.resolve();
    });

    expect(onDiscardFile).toHaveBeenCalledTimes(1);
    expect(onDiscardFile).toHaveBeenCalledWith(files[1]);
    expect(
      document.body.querySelector('[role="alertdialog"]')
    ).toBeNull();
  });

  it("warns that untracked files are permanently deleted before group discard", async () => {
    const onDiscardFiles = vi.fn().mockResolvedValue(true);
    const groupFiles = [untrackedFiles[0]!];

    act(() => {
      root.render(
        <DiffWorkspace
          canDiscardFile={() => true}
          configuration={standaloneDiffWorkspaceConfiguration}
          externalApplications={externalApplications}
          files={groupFiles}
          onDiscardFiles={onDiscardFiles}
          onSelectedFileChange={vi.fn()}
          panelProps={{ content }}
          selectedFileKey={groupFiles[0]?.key}
        />
      );
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="放弃未跟踪分组的更改"]'
        )
        ?.click();
    });

    const dialog =
      document.body.querySelector('[role="alertdialog"]');
    expect(onDiscardFiles).not.toHaveBeenCalled();
    expect(dialog?.textContent).toContain(
      "放弃 1 个文件的更改？"
    );
    expect(dialog?.textContent).toContain("1 个未跟踪文件");
    expect(dialog?.textContent).toContain("永久删除");
    expect(dialog?.textContent).toContain("不会移入回收站");

    await act(async () => {
      findButton(document.body, "永久删除并放弃").click();
      await Promise.resolve();
    });

    expect(onDiscardFiles).toHaveBeenCalledTimes(1);
    expect(onDiscardFiles).toHaveBeenCalledWith(groupFiles);
  });

  it("keeps the confirmation open when discard reports failure", async () => {
    const onDiscardFile = vi.fn().mockResolvedValue(false);

    act(() => {
      root.render(
        <DiffWorkspace
          canDiscardFile={() => true}
          configuration={repositoryDiffWorkspaceConfiguration}
          externalApplications={externalApplications}
          files={[files[1]!]}
          onDiscardFile={onDiscardFile}
          onSelectedFileChange={vi.fn()}
          panelProps={{ content }}
          selectedFileKey={files[1]?.key}
        />
      );
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="放弃更改 src/components/Button.tsx"]'
        )
        ?.click();
    });
    await act(async () => {
      findButton(document.body, "确认放弃").click();
      await Promise.resolve();
    });

    expect(onDiscardFile).toHaveBeenCalledTimes(1);
    expect(
      document.body.querySelector('[role="alertdialog"]')
    ).not.toBeNull();
    expect(
      findButton(document.body, "确认放弃").disabled
    ).toBe(false);
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

  it("keeps the AI commit entry visible when AI is disabled", () => {
    act(() => {
      root.render(
        <DiffWorkspace
          commit={{
            ai: {
              enabled: false,
              busy: false,
              onGenerate: vi.fn()
            },
            busy: false,
            conflicted: 0,
            message: "",
            push: false,
            staged: 1,
            unstaged: 0,
            untracked: 0,
            submitting: false,
            onMessageChange: vi.fn(),
            onPushChange: vi.fn(),
            onSubmit: vi.fn()
          }}
          configuration={repositoryDiffWorkspaceConfiguration}
          externalApplications={externalApplications}
          files={files}
          onSelectedFileChange={vi.fn()}
          onStageFile={vi.fn()}
          onUnstageFile={vi.fn()}
          panelProps={{ content }}
          selectedFileKey={files[0]?.key}
        />
      );
    });

    const aiGenerateButton =
      container.querySelector<HTMLButtonElement>(
        '[aria-label="使用 AI 生成提交信息"]'
      );
    expect(aiGenerateButton).not.toBeNull();
    expect(aiGenerateButton?.disabled).toBe(true);
    expect(aiGenerateButton?.title).toBe(
      "请先在设置中启用 AI 提交信息"
    );
  });

  it("renders the persisted commit panel height and exposes a keyboard resize control", () => {
    const onCommitPanelHeightChange = vi.fn();

    act(() => {
      root.render(
        <DiffWorkspace
          commit={{
            busy: false,
            conflicted: 0,
            commitPanelHeight: 240,
            message: "Resize the commit panel",
            onCommitPanelHeightChange,
            onMessageChange: vi.fn(),
            onPushChange: vi.fn(),
            onSubmit: vi.fn(),
            push: false,
            staged: 1,
            submitting: false,
            untracked: 0,
            unstaged: 0
          }}
          configuration={repositoryDiffWorkspaceConfiguration}
          externalApplications={externalApplications}
          files={[files[0]!]}
          onSelectedFileChange={vi.fn()}
          onStageFile={vi.fn()}
          onUnstageFile={vi.fn()}
          panelProps={{
            content
          }}
          selectedFileKey={files[0]?.key}
        />
      );
    });

    const composer = container.querySelector<HTMLElement>(
      ".diff-workspace-commit"
    );
    expect(composer?.style.height).toBe("240px");

    const resizeHandle = container.querySelector<HTMLElement>(
      '[role="separator"][aria-label="调整提交区域高度"]'
    );
    expect(resizeHandle).not.toBeNull();
    expect(resizeHandle?.getAttribute("aria-orientation")).toBe(
      "horizontal"
    );

    act(() => {
      resizeHandle?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "ArrowUp"
        })
      );
    });
    expect(onCommitPanelHeightChange).toHaveBeenCalled();
    expect(
      onCommitPanelHeightChange.mock.calls[0]?.[0]
    ).toBeGreaterThan(240);
  });

  it("enables committing all changes when the staged index is empty", () => {
    const onSubmit = vi.fn();

    act(() => {
      root.render(
        <DiffWorkspace
          commit={{
            busy: false,
            conflicted: 0,
            message: "Commit every change",
            push: false,
            staged: 0,
            unstaged: 1,
            untracked: 0,
            submitting: false,
            onMessageChange: vi.fn(),
            onPushChange: vi.fn(),
            onSubmit
          }}
          configuration={repositoryDiffWorkspaceConfiguration}
          externalApplications={externalApplications}
          files={[files[1]!]}
          onSelectedFileChange={vi.fn()}
          panelProps={{
            additions: 1,
            content,
            deletions: 0
          }}
          selectedFileKey={files[1]?.key}
        />
      );
    });

    const submit = findButton(container, "提交全部变更");
    expect(submit.disabled).toBe(false);

    act(() => {
      submit
        .closest("form")
        ?.dispatchEvent(
          new Event("submit", {
            bubbles: true,
            cancelable: true
          })
        );
    });

    expect(onSubmit).toHaveBeenCalledWith(
      "Commit every change",
      false
    );
  });
});

function findButton(
  root: ParentNode,
  text: string
): HTMLButtonElement {
  const buttons = Array.from(
    root.querySelectorAll<HTMLButtonElement>("button")
  );
  const button =
    buttons.find(
      (candidate) => candidate.textContent?.trim() === text
    ) ??
    buttons.find(
      (candidate) =>
        candidate
          .querySelector(
            ".diff-workspace-file-section-label"
          )
          ?.textContent?.trim() === text
    );
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
