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
import { collectSkeletonLayout } from "../../shared/lib/skeleton-layout";
import { useMinimumLoadingIndicator } from "../../shared/lib/useMinimumLoadingIndicator";
import {
  AutoSkeletonBoundary,
  Skeleton,
  SkeletonBoundary,
  SkeletonScope,
  SkeletonSurface,
  SKELETON_REVEAL_DELAY_MS
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

function layoutRect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x, y, width, height, left: x, top: y,
    right: x + width, bottom: y + height,
    toJSON: () => ({ x, y, width, height })
  };
}

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
    vi.useRealTimers();
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

  it("reserves the loading layout without flashing or announcing a fast request", () => {
    vi.useFakeTimers();
    act(() => root.render(<SkeletonBoundaryHarness loading />));
    const surface = container.querySelector(".gn-skeleton-surface");
    expect(surface?.getAttribute("data-skeleton-phase")).toBe("pending");
    expect(surface?.getAttribute("aria-hidden")).toBe("true");
    expect(surface?.getAttribute("aria-live")).toBe("off");
    expect(container.querySelector('[data-testid="loaded-content"]')).toBeNull();
    act(() => vi.advanceTimersByTime(SKELETON_REVEAL_DELAY_MS - 1));
    expect(surface?.getAttribute("data-skeleton-phase")).toBe("pending");
    act(() => root.render(<SkeletonBoundaryHarness hasContent loading={false} />));
    expect(container.textContent).toBe("content");
    expect(container.querySelector(".gn-skeleton-surface")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(1000));
    expect(container.textContent).toBe("content");
  });

  it("reveals a slow request once and removes it immediately when it settles", () => {
    vi.useFakeTimers();
    act(() => root.render(<SkeletonBoundaryHarness loading />));
    act(() => vi.advanceTimersByTime(SKELETON_REVEAL_DELAY_MS));
    const surface = container.querySelector(".gn-skeleton-surface");
    expect(surface?.getAttribute("data-skeleton-phase")).toBe("visible");
    expect(surface?.hasAttribute("aria-hidden")).toBe(false);
    expect(surface?.getAttribute("aria-live")).toBe("polite");
    act(() => root.render(<SkeletonBoundaryHarness loading={false} />));
    expect(container.textContent).toBe("content");
    expect(container.querySelector(".gn-skeleton-surface")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives each completed loading cycle its own reveal delay", () => {
    vi.useFakeTimers();
    act(() => root.render(<SkeletonBoundaryHarness loading />));
    act(() => vi.advanceTimersByTime(SKELETON_REVEAL_DELAY_MS));
    act(() => root.render(<SkeletonBoundaryHarness hasContent loading={false} />));
    act(() => root.render(<SkeletonBoundaryHarness loading />));
    const surface = container.querySelector(".gn-skeleton-surface");
    expect(surface?.getAttribute("data-skeleton-phase")).toBe("pending");
    expect(container.textContent).not.toContain("content");
    act(() => vi.advanceTimersByTime(SKELETON_REVEAL_DELAY_MS - 1));
    expect(surface?.getAttribute("data-skeleton-phase")).toBe("pending");
    act(() => vi.advanceTimersByTime(1));
    expect(surface?.getAttribute("data-skeleton-phase")).toBe("visible");
  });

  it("does not restart a continuous wait when the loading target changes", () => {
    vi.useFakeTimers();
    const renderTarget = (label: string) => root.render(
      <SkeletonSurface label={label}><Skeleton /></SkeletonSurface>
    );
    act(() => renderTarget("目标 A"));
    act(() => vi.advanceTimersByTime(100));
    act(() => renderTarget("目标 B"));
    act(() => vi.advanceTimersByTime(SKELETON_REVEAL_DELAY_MS - 100));
    expect(container.querySelector(".gn-skeleton-surface")?.getAttribute("data-skeleton-phase"))
      .toBe("visible");
    expect(container.querySelector(".gn-skeleton-surface")?.getAttribute("aria-label"))
      .toBe("目标 B");
    expect(container.innerHTML).not.toContain("目标 A");
  });

  it("shares one reveal clock and status announcement with nested diff placeholders", () => {
    vi.useFakeTimers();
    act(() => root.render(<DiffWorkspaceSkeleton />));
    const surfaces = container.querySelectorAll(".gn-skeleton-surface");
    expect(surfaces.length).toBe(2);
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(SKELETON_REVEAL_DELAY_MS));
    for (const surface of surfaces) {
      expect(surface.getAttribute("data-skeleton-phase")).toBe("visible");
    }
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    expect(surfaces[1]?.getAttribute("aria-hidden")).toBe("true");
  });

  it("cleans up pending reveal timers under StrictMode and rapid unmounts", () => {
    vi.useFakeTimers();
    act(() => root.render(
      <React.StrictMode><SkeletonBoundaryHarness loading /></React.StrictMode>
    ));
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(50));
    act(() => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(1000));
    expect(container.innerHTML).toBe("");
  });

  it("keeps the already revealed placeholder visible through a whole-page to file handoff", () => {
    vi.useFakeTimers();
    const renderStage = (whole: boolean) => root.render(
      <SkeletonScope loading scopeKey="repository-a">
        {whole ? <DiffWorkspaceSkeleton /> : (
          <main><SkeletonSurface label="文件 Diff"><Skeleton /></SkeletonSurface></main>
        )}
      </SkeletonScope>
    );
    act(() => renderStage(true));
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(SKELETON_REVEAL_DELAY_MS));
    act(() => renderStage(false));
    const surface = container.querySelector(".gn-skeleton-surface");
    expect(surface?.getAttribute("data-skeleton-phase")).toBe("visible");
    expect(surface?.getAttribute("role")).toBe("status");
    expect(surface?.hasAttribute("aria-hidden")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the remainder of the original reveal delay across a quick loading handoff", () => {
    vi.useFakeTimers();
    const renderStage = (whole: boolean) => root.render(
      <SkeletonScope loading scopeKey="repository-a">
        {whole ? <DiffWorkspaceSkeleton /> : (
          <main><SkeletonSurface label="文件 Diff"><Skeleton /></SkeletonSurface></main>
        )}
      </SkeletonScope>
    );
    act(() => renderStage(true));
    act(() => vi.advanceTimersByTime(100));
    act(() => renderStage(false));
    act(() => vi.advanceTimersByTime(SKELETON_REVEAL_DELAY_MS - 101));
    expect(container.querySelector(".gn-skeleton-surface")?.getAttribute("data-skeleton-phase")).toBe("pending");
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector(".gn-skeleton-surface")?.getAttribute("data-skeleton-phase")).toBe("visible");
  });

  it("resets a scoped reveal after completion and when the repository changes", () => {
    vi.useFakeTimers();
    const renderScope = (scopeKey: string, loading: boolean) => root.render(
      <SkeletonScope loading={loading} scopeKey={scopeKey}>
        <SkeletonBoundaryHarness loading={loading} hasContent={!loading} />
      </SkeletonScope>
    );
    act(() => renderScope("repository-a", true));
    act(() => vi.advanceTimersByTime(SKELETON_REVEAL_DELAY_MS));
    act(() => renderScope("repository-b", true));
    expect(container.querySelector(".gn-skeleton-surface")?.getAttribute("data-skeleton-phase")).toBe("pending");
    act(() => vi.advanceTimersByTime(SKELETON_REVEAL_DELAY_MS));
    act(() => renderScope("repository-b", false));
    expect(container.textContent).toBe("content");
    expect(vi.getTimerCount()).toBe(0);
    act(() => renderScope("repository-b", true));
    expect(container.querySelector(".gn-skeleton-surface")?.getAttribute("data-skeleton-phase")).toBe("pending");
    act(() => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps an independent auxiliary load stable when the primary load finishes", () => {
    vi.useFakeTimers();
    const renderScope = (primary: boolean, auxiliary: boolean) => root.render(
      <SkeletonScope loading={primary} scopeKey="repository">
        <SkeletonScope loading={auxiliary} scopeKey="stash">
          {auxiliary && <SkeletonSurface label="储藏"><Skeleton /></SkeletonSurface>}
        </SkeletonScope>
      </SkeletonScope>
    );
    act(() => renderScope(true, false));
    act(() => vi.advanceTimersByTime(SKELETON_REVEAL_DELAY_MS));
    act(() => renderScope(true, true));
    expect(container.querySelector(".gn-skeleton-surface")?.getAttribute("data-skeleton-phase")).toBe("pending");
    act(() => vi.advanceTimersByTime(SKELETON_REVEAL_DELAY_MS));
    act(() => renderScope(false, true));
    expect(container.querySelector(".gn-skeleton-surface")?.getAttribute("data-skeleton-phase")).toBe("visible");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resets presentation without remounting business content when the scope changes", () => {
    const renderScope = (scopeKey: string) => root.render(
      <SkeletonScope loading={false} scopeKey={scopeKey}>
        <input defaultValue="draft" />
      </SkeletonScope>
    );
    act(() => renderScope("repository-a"));
    const input = container.querySelector("input")!;
    input.value = "unsaved draft";
    act(() => renderScope("repository-b"));
    expect(container.querySelector("input")).toBe(input);
    expect(input.value).toBe("unsaved draft");
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

  it("reveals settled empty or error content immediately instead of holding a skeleton", () => {
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
      });
      expect(
        container.querySelector('[role="status"]')
      ).toBeNull();
      expect(container.textContent).toBe("content");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not carry a previous page's loading timer into an idle page", () => {
    vi.useFakeTimers();
    try {
      act(() => {
        root.render(<SkeletonBoundaryHarness loading />);
      });
      act(() => {
        root.render(<SkeletonBoundaryHarness hasContent loading={false} />);
      });
      act(() => {
        root.render(<SkeletonBoundaryHarness loading={false} />);
      });
      expect(container.querySelector('[role="status"]')).toBeNull();
      expect(container.textContent).toBe("content");
      expect(vi.getTimerCount()).toBe(0);
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

  it.each([false, true])("keeps split skeleton scrolling consistent across loading phases (wrap=%s)", (wrap) => {
    act(() => {
      root.render(<DiffWorkspaceSkeleton layout="split" wrap={wrap} />);
    });
    expect(container.querySelector(".diff-content-skeleton")?.getAttribute("data-wrap"))
      .toBe(String(wrap));
    expect(container.querySelectorAll(".diff-content-skeleton-pane")).toHaveLength(2);

    act(() => {
      root.render(
        <DiffWorkspace
          configuration={standaloneDiffWorkspaceConfiguration}
          externalApplications={externalApplications}
          files={files}
          onSelectedFileChange={() => undefined}
          panelProps={{
            preferredLayout: "split",
            preferredWrap: wrap,
            state: { busy: true, icon: "refresh", title: "Loading", message: "Loading" }
          }}
        />
      );
    });
    expect(container.querySelector(".diff-content-skeleton")?.getAttribute("data-wrap"))
      .toBe(String(wrap));
    expect(container.querySelectorAll(".diff-content-skeleton-pane")).toHaveLength(2);
    expect(container.querySelector(".diff-viewer-code")?.classList.contains("split-nowrap"))
      .toBe(!wrap);
  });

  it("uses the real five toolbar controls and responsive structure for its skeleton", () => {
    const controls = () => Array.from(
      container.querySelectorAll<HTMLButtonElement>(".diff-viewer-toolbar .gn-button")
    ).map((button) => ({
      variant: button.dataset.variant,
      size: button.dataset.size,
      label: button.querySelector(".gn-button__label")?.textContent ?? "",
      icon: Boolean(button.querySelector(".gn-button__icon")),
      wrap: button.classList.contains("diff-viewer-wrap-button")
    }));
    act(() => {
      root.render(<DiffWorkspaceSkeleton showToolbar />);
    });
    const skeletonControls = controls();
    expect(skeletonControls).toHaveLength(5);
    expect(container.querySelectorAll(".diff-viewer-toolbar button:disabled")).toHaveLength(5);
    expect(container.querySelector(".diff-viewer-toolbar-spacer")).not.toBeNull();
    expect(container.querySelector(".diff-viewer-segmented")?.children).toHaveLength(2);
    expect(container.querySelector(".diff-viewer-hunk-navigation")?.children).toHaveLength(3);
    expect(container.querySelector(".diff-workspace-skeleton-content")
      ?.getAttribute("aria-hidden")).toBe("true");

    act(() => {
      root.render(
        <DiffWorkspace
          configuration={standaloneDiffWorkspaceConfiguration}
          externalApplications={externalApplications}
          files={files}
          onSelectedFileChange={() => undefined}
          panelProps={{ content }}
        />
      );
    });
    expect(controls()).toEqual(skeletonControls);
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

  it.each([
    [repositoryDiffWorkspaceConfiguration, "list"],
    [repositoryDiffWorkspaceConfiguration, "tree"],
    [standaloneDiffWorkspaceConfiguration, "list"],
    [standaloneDiffWorkspaceConfiguration, "tree"]
  ] as const)("opens the file context menu without changing the Diff selection (%j, %s)", (configuration, fileView) => {
    const onSelectedFileChange = vi.fn();
    const openFile = vi.fn().mockResolvedValue(true);

    act(() => {
      root.render(
        <DiffWorkspace
          configuration={configuration}
          externalApplications={{
            active: null,
            loading: false,
            openFile,
            profiles: [{ kind: "vscode", label: "VS Code" }]
          }}
          files={files}
          fileView={fileView}
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
    expect(onSelectedFileChange).not.toHaveBeenCalled();
    expect(
      container.querySelector(".diff-workspace-file.selected")
        ?.getAttribute("data-diff-file-key")
    ).toBe(files[0]?.key);

    act(() => {
      findButton(document.body, "VS Code").click();
    });

    expect(openFile).toHaveBeenCalledWith(
      "vscode",
      "src/components/Button.tsx"
    );
    expect(onSelectedFileChange).not.toHaveBeenCalled();

    act(() => {
      fileRow.querySelector<HTMLButtonElement>(".diff-workspace-file-select")?.click();
    });
    expect(onSelectedFileChange).toHaveBeenCalledExactlyOnceWith(files[1]);
  });

  function openFileMenu() {
    const openFile = vi.fn().mockResolvedValue(true);
    act(() => root.render(
      <DiffWorkspace
        configuration={standaloneDiffWorkspaceConfiguration}
        externalApplications={{
          active: null, loading: false, openFile,
          profiles: [
            { kind: "vscode", label: "VS Code" },
            { kind: "cursor", label: "Cursor" }
          ]
        }}
        files={files}
        onSelectedFileChange={vi.fn()}
        panelProps={{ content }}
        selectedFileKey={files[1]!.key}
      />
    ));
    const row = Array.from(container.querySelectorAll<HTMLDivElement>(
      ".diff-workspace-file"
    )).find((candidate) => candidate.textContent?.includes("Button.tsx"))!;
    act(() => {
      row.querySelector<HTMLButtonElement>("button")!.focus();
      row.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, clientX: 120, clientY: 80
      }));
    });
    return {
      openFile,
      trigger: findButton(document.body, "打开方式"),
      submenu: () => document.querySelector<HTMLElement>(
        '[aria-label="选择用于打开此文件的应用"]'
      )
    };
  }

  it("offers history for tracked files and scoped ignore previews only for untracked files", () => {
    const onFileHistory = vi.fn();
    const onIgnoreFile = vi.fn();
    const untracked: DiffViewerFile = {
      key: "untracked\u0001cache/build.trace", path: "cache/build.trace",
      mode: "untracked", status: "?", kind: "untracked",
      change: { path: "cache/build.trace", indexStatus: "?", worktreeStatus: "?", kind: "untracked" }
    };
    act(() => root.render(<DiffWorkspace
      configuration={repositoryDiffWorkspaceConfiguration}
      externalApplications={{ active: null, loading: false, profiles: [], openFile: vi.fn() }}
      files={[...files, untracked]} onSelectedFileChange={vi.fn()}
      onFileHistory={onFileHistory} onIgnoreFile={onIgnoreFile}
      panelProps={{ content }} />));
    const open = (name: string) => {
      const row = [...container.querySelectorAll<HTMLDivElement>(".diff-workspace-file")]
        .find(candidate => candidate.textContent?.includes(name))!;
      act(() => row.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, clientX: 120, clientY: 80
      })));
    };
    open("Button.tsx");
    expect(document.querySelector(".change-file-context-menu")?.textContent).not.toContain("忽略此文件");
    act(() => findButton(document.body, "文件历史").click());
    expect(onFileHistory).toHaveBeenCalledExactlyOnceWith(files[1]);
    open("build.trace");
    act(() => findButton(document.body, "忽略所在目录").click());
    expect(onIgnoreFile).toHaveBeenCalledExactlyOnceWith(untracked, "directory");
    expect(document.querySelector(".change-file-context-menu")).toBeNull();
  });

  it("disables invalid ignore scopes and fits the expanded menu inside the viewport", () => {
    const file: DiffViewerFile = {
      key: "untracked\u0001.env", path: ".env", mode: "untracked", status: "?", kind: "untracked",
      change: { path: ".env", indexStatus: "?", worktreeStatus: "?", kind: "untracked" }
    };
    act(() => root.render(<DiffWorkspace
      configuration={repositoryDiffWorkspaceConfiguration}
      externalApplications={{ active: null, loading: false, profiles: [], openFile: vi.fn() }}
      files={[file]} onSelectedFileChange={vi.fn()} onFileHistory={vi.fn()} onIgnoreFile={vi.fn()}
      panelProps={{ content }} />));
    const row = container.querySelector<HTMLDivElement>(".diff-workspace-file")!;
    act(() => row.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: window.innerWidth, clientY: window.innerHeight
    })));
    expect(findButton(document.body, "忽略所在目录").disabled).toBe(true);
    expect(findButton(document.body, "忽略同扩展名文件").disabled).toBe(true);
    expect(findButton(document.body, "忽略此文件").disabled).toBe(false);
    const menu = document.querySelector<HTMLElement>(".change-file-context-menu")!;
    expect(Number.parseFloat(menu.style.top)).toBeLessThanOrEqual(window.innerHeight - 196);
  });

  it("keeps the file Open In submenu available after hovering and clicking its trigger", () => {
    const menu = openFileMenu();
    act(() => menu.trigger.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
    expect(menu.submenu()).not.toBeNull();

    act(() => menu.trigger.click());

    expect(menu.submenu()).not.toBeNull();
    act(() => findButton(document.body, "Cursor").click());
    expect(menu.openFile).toHaveBeenCalledExactlyOnceWith("cursor", "src/components/Button.tsx");
  });

  it.each(["Escape", "ArrowLeft"])(
    "returns from the file submenu with %s and re-enters it with ArrowRight",
    (key) => {
      const menu = openFileMenu();
      act(() => findButton(document.body, "VS Code").focus());
      act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", {
        key, bubbles: true, cancelable: true
      })));

      expect(document.querySelector(".change-file-context-menu")).not.toBeNull();
      expect(menu.submenu()).toBeNull();
      expect(document.activeElement).toBe(menu.trigger);
      act(() => menu.trigger.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowRight", bubbles: true, cancelable: true
      })));
      expect(menu.submenu()).not.toBeNull();
      expect(document.activeElement).toBe(findButton(document.body, "VS Code"));
      expect(menu.openFile).not.toHaveBeenCalled();
      act(() => (document.activeElement as HTMLButtonElement).click());
      expect(menu.openFile).toHaveBeenCalledExactlyOnceWith("vscode", "src/components/Button.tsx");
    }
  );

  it("keeps file menus open for internal scrolling and closes them for page scrolling", () => {
    const menu = openFileMenu();
    act(() => menu.submenu()!.dispatchEvent(new Event("scroll")));
    expect(menu.submenu()).not.toBeNull();
    expect(document.querySelector(".change-file-context-menu")).not.toBeNull();
    act(() => container.dispatchEvent(new Event("scroll")));
    expect(document.querySelector(".change-file-context-menu")).toBeNull();
  });

  it("closes the file menu when Tab moves focus outside without stealing that focus", () => {
    const menu = openFileMenu();
    act(() => findButton(document.body, "VS Code").focus());
    const destination = document.createElement("button");
    destination.textContent = "Next control";
    container.append(destination);
    const tab = new KeyboardEvent("keydown", {
      key: "Tab", bubbles: true, cancelable: true
    });
    act(() => {
      document.activeElement!.dispatchEvent(tab);
      // JSDOM does not perform the browser's native Tab focus movement.
      destination.focus();
    });
    expect(tab.defaultPrevented).toBe(false);
    expect(document.querySelector(".change-file-context-menu")).toBeNull();
    expect(menu.submenu()).toBeNull();
    expect(document.activeElement).toBe(destination);
    expect(menu.openFile).not.toHaveBeenCalled();
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

  it.each(["removed", "untracked", "renamed"] as const)(
    "invalidates a discard confirmation when a refreshed target is %s",
    (changeKind) => {
      const onDiscardFiles = vi.fn().mockResolvedValue(true);
      const originalFile = files[1]!;
      const renderFiles = (nextFiles: DiffViewerFile[]) => act(() => {
        root.render(
          <DiffWorkspace
            canDiscardFile={() => true}
            configuration={repositoryDiffWorkspaceConfiguration}
            externalApplications={externalApplications}
            files={nextFiles}
            onDiscardFiles={onDiscardFiles}
            onSelectedFileChange={vi.fn()}
            panelProps={{ content }}
            selectedFileKey={nextFiles[0]?.key}
          />
        );
      });
      renderFiles([originalFile]);
      act(() => {
        container.querySelector<HTMLButtonElement>(
          '[aria-label="放弃未暂存分组的更改"]'
        )!.click();
      });
      expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull();
      const nextFile: DiffViewerFile = changeKind === "untracked"
        ? {
            ...originalFile,
            key: `untracked\u0001${originalFile.path}`,
            mode: "untracked", kind: "untracked", status: "?",
            change: { path: originalFile.path, kind: "untracked", indexStatus: "?", worktreeStatus: "?" }
          }
        : {
            ...originalFile,
            kind: "renamed",
            change: { ...originalFile.change, kind: "renamed", originalPath: "src/OldButton.tsx" }
          };
      renderFiles(changeKind === "removed" ? [] : [nextFile]);
      expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
      expect(onDiscardFiles).not.toHaveBeenCalled();
    }
  );

  it("keeps the confirmed batch fixed when another changed file appears", async () => {
    const onDiscardFiles = vi.fn().mockResolvedValue(true);
    const renderFiles = (nextFiles: DiffViewerFile[]) => act(() => {
      root.render(
        <DiffWorkspace
          canDiscardFile={() => true}
          configuration={repositoryDiffWorkspaceConfiguration}
          externalApplications={externalApplications}
          files={nextFiles}
          onDiscardFiles={onDiscardFiles}
          onSelectedFileChange={vi.fn()}
          panelProps={{ content }}
          selectedFileKey={nextFiles.at(-1)?.key}
        />
      );
    });
    renderFiles([files[1]!]);
    act(() => {
      container.querySelector<HTMLButtonElement>(
        '[aria-label="放弃未暂存分组的更改"]'
      )!.click();
    });
    renderFiles([files[1]!, {
      ...files[1]!,
      path: "src/NewButton.tsx",
      key: "unstaged\u0001src/NewButton.tsx",
      change: { ...files[1]!.change, path: "src/NewButton.tsx" }
    }]);
    await act(async () => {
      findButton(document.body, "确认放弃").click();
      await Promise.resolve();
    });
    expect(onDiscardFiles).toHaveBeenCalledTimes(1);
    expect(onDiscardFiles).toHaveBeenCalledWith([files[1]]);
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

describe("automatic skeleton layout recognition", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    vi.spyOn(host, "getBoundingClientRect")
      .mockReturnValue(layoutRect(100, 50, 500, 500));
  });

  afterEach(() => {
    host.remove();
    vi.restoreAllMocks();
  });

  function box(element: Element, x: number, y: number, width: number, height: number) {
    vi.spyOn(element, "getBoundingClientRect")
      .mockReturnValue(layoutRect(x, y, width, height));
    return element;
  }

  it("recognizes each wrapped text line without copying its content", () => {
    host.innerHTML = '<p style="font-size:20px">private account information</p>';
    box(host.firstElementChild!, 120, 70, 220, 60);
    const selectNodeContents = vi.fn();
    vi.spyOn(document, "createRange").mockReturnValue({
      selectNodeContents,
      getClientRects: () => [
        layoutRect(120, 70, 220, 24),
        layoutRect(120, 98, 140, 24)
      ]
    } as unknown as Range);

    const shapes = collectSkeletonLayout(host);

    expect(selectNodeContents).toHaveBeenCalledWith(host.firstElementChild!.firstChild);
    expect(shapes).toEqual([
      { kind: "text", x: 20, y: 25.5, width: 220, height: 13, radius: "999px" },
      { kind: "text", x: 20, y: 53.5, width: 140, height: 13, radius: "999px" }
    ]);
    expect(JSON.stringify(shapes)).not.toContain("private account");
  });

  it("recognizes direct text inside the intentionally transparent measurement root", () => {
    host.textContent = "Loading text";
    host.style.opacity = "0";
    host.style.fontSize = "20px";
    vi.spyOn(document, "createRange").mockReturnValue({
      selectNodeContents: vi.fn(),
      getClientRects: () => [layoutRect(110, 60, 90, 20)]
    } as unknown as Range);

    expect(collectSkeletonLayout(host)).toEqual([
      { kind: "text", x: 10, y: 13.5, width: 90, height: 13, radius: "999px" }
    ]);
  });

  it("treats controls and SVG icons as atomic shapes without duplicating descendants", () => {
    host.innerHTML = `
      <button><svg><path /></svg><span>Save secret</span></button>
      <svg><path /></svg>
      <input type="radio" value="private-value" />
      <img alt="Avatar" style="border-radius:50%" />
    `;
    box(host.children[0]!, 120, 80, 160, 40);
    box(host.querySelector("button svg")!, 125, 85, 20, 20);
    box(host.querySelector("button span")!, 150, 85, 80, 20);
    box(host.children[1]!, 300, 80, 24, 24);
    box(host.children[2]!, 340, 80, 20, 20);
    box(host.children[3]!, 380, 80, 160, 160);

    const shapes = collectSkeletonLayout(host);

    expect(shapes.map(({ kind, x, width }) => ({ kind, x, width }))).toEqual([
      { kind: "block", x: 20, width: 160 },
      { kind: "block", x: 200, width: 24 },
      { kind: "circle", x: 240, width: 20 },
      { kind: "circle", x: 280, width: 160 }
    ]);
    expect(JSON.stringify(shapes)).not.toMatch(/Save secret|private-value/);
  });

  it("skips hidden and ignored subtrees while preserving display-contents children", () => {
    host.innerHTML = `
      <div hidden><button>hidden</button></div>
      <div style="display:none"><button>none</button></div>
      <div style="visibility:hidden"><button>invisible</button></div>
      <div style="opacity:0"><button>transparent</button></div>
      <div data-skeleton="ignore"><button>ignored</button></div>
      <div style="display:contents"><button>visible</button></div>
    `;
    host.querySelectorAll("*").forEach((element) => box(element, 120, 80, 100, 30));
    box(host.lastElementChild!, 0, 0, 0, 0);

    expect(collectSkeletonLayout(host)).toEqual([
      expect.objectContaining({ kind: "block", x: 20, y: 30, width: 100, height: 30 })
    ]);
  });

  it("clips geometry to scroll containers and the boundary instead of painting offscreen content", () => {
    host.innerHTML = `
      <div style="overflow-x:hidden;overflow-y:auto;border:1px solid;border-radius:8px">
        <button>Partially visible</button>
        <input />
      </div>
      <button>Outside boundary</button>
    `;
    box(host.children[0]!, 120, 80, 100, 80);
    box(host.querySelector("div button")!, 100, 60, 160, 50);
    box(host.querySelector("input")!, 125, 170, 80, 30);
    box(host.children[1]!, 590, 530, 100, 50);

    const shapes = collectSkeletonLayout(host);

    expect(shapes).toEqual([
      { kind: "frame", x: 20, y: 30, width: 100, height: 80, radius: "8px" },
      expect.objectContaining({ kind: "block", x: 20, y: 30, width: 100, height: 30 }),
      expect.objectContaining({ kind: "block", x: 490, y: 480, width: 10, height: 20 })
    ]);
  });

  it("clips a boundary inside scrolling ancestors to their intersected content areas", () => {
    const outer = document.createElement("div");
    const scrollPanel = document.createElement("div");
    outer.style.overflowY = "hidden";
    scrollPanel.style.overflowX = "auto";
    scrollPanel.style.overflowY = "auto";
    document.body.append(outer);
    outer.append(scrollPanel);
    scrollPanel.append(host);
    box(outer, 100, 90, 300, 50);
    box(scrollPanel, 120, 80, 100, 80);
    Object.defineProperties(scrollPanel, {
      clientLeft: { value: 2 },
      clientTop: { value: 3 },
      clientWidth: { value: 88 },
      clientHeight: { value: 66 }
    });
    host.innerHTML = "<button>Partially visible</button><input />";
    box(host.children[0]!, 100, 60, 160, 100);
    box(host.children[1]!, 130, 150, 80, 20);
    try {
      expect(collectSkeletonLayout(host)).toEqual([
        expect.objectContaining({ kind: "block", x: 22, y: 40, width: 88, height: 50 })
      ]);
    } finally {
      outer.remove();
    }
  });

  it("keeps a clipped avatar's original circular geometry instead of shrinking it into an ellipse", () => {
    host.innerHTML = '<img style="border-radius:50%" />';
    box(host.children[0]!, 100, -30, 160, 160);
    expect(collectSkeletonLayout(host)).toEqual([{
      kind: "circle", x: 0, y: 0, width: 160, height: 80, radius: "50%",
      content: { x: 0, y: -80, width: 160, height: 160 }
    }]);
  });
});

describe("automatic skeleton boundary lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;
  let resized: ResizeObserverCallback;
  let mutated: MutationCallback;
  let resizeDisconnect: ReturnType<typeof vi.fn>;
  let resizeObserve: ReturnType<typeof vi.fn>;
  let resizeUnobserve: ReturnType<typeof vi.fn>;
  let mutationDisconnect: ReturnType<typeof vi.fn>;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let buttonWidth: number;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.useFakeTimers();
    frames = new Map();
    nextFrame = 0;
    buttonWidth = 120;
    resizeDisconnect = vi.fn();
    resizeObserve = vi.fn();
    resizeUnobserve = vi.fn();
    mutationDisconnect = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal("ResizeObserver", class {
      observe = resizeObserve;
      unobserve = resizeUnobserve;
      disconnect = resizeDisconnect;
      constructor(callback: ResizeObserverCallback) { resized = callback; }
    });
    vi.stubGlobal("MutationObserver", class {
      observe = vi.fn();
      disconnect = mutationDisconnect;
      constructor(callback: MutationCallback) { mutated = callback; }
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.matches("button,input")
        ? layoutRect(120, 80, buttonWidth, 32)
        : layoutRect(100, 50, 500, 400);
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function flushFrame() {
    act(() => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(0));
    });
  }

  it("automatically derives placeholders when fallback is omitted and keeps fast responses hidden", () => {
    const render = (loading: boolean) => (
      <SkeletonBoundary hasContent={!loading} label="Loading settings" loading={loading}>
        <button>Save</button>
      </SkeletonBoundary>
    );
    act(() => root.render(render(true)));
    const content = container.querySelector(".gn-auto-skeleton-content")!;
    const overlay = container.querySelector(".gn-auto-skeleton-overlay")!;
    expect(content.hasAttribute("inert")).toBe(true);
    expect(content.getAttribute("aria-hidden")).toBe("true");
    expect(overlay.getAttribute("data-skeleton-shapes")).toBe("1");
    expect(overlay.getAttribute("data-skeleton-phase")).toBe("pending");
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    act(() => vi.advanceTimersByTime(100));
    act(() => root.render(render(false)));
    expect(container.querySelector(".gn-auto-skeleton-overlay")).toBeNull();
    expect(content.hasAttribute("inert")).toBe(false);
    expect(content.hasAttribute("aria-hidden")).toBe(false);
    act(() => vi.advanceTimersByTime(500));
    expect(container.querySelector(".gn-auto-skeleton-overlay")).toBeNull();
  });

  it("reveals one loading status after the delay without remounting or clearing a form draft", () => {
    const mounts = vi.fn();
    const unmounts = vi.fn();
    function Form() {
      React.useEffect(() => {
        mounts();
        return unmounts;
      }, []);
      return <input defaultValue="initial draft" />;
    }
    const render = (loading: boolean, hasContent = false) => (
      <AutoSkeletonBoundary hasContent={hasContent} label="Loading settings" loading={loading}>
        <Form />
      </AutoSkeletonBoundary>
    );
    act(() => root.render(render(true)));
    const input = container.querySelector("input")!;
    input.value = "retained draft";
    act(() => vi.advanceTimersByTime(SKELETON_REVEAL_DELAY_MS));
    const status = container.querySelector('[role="status"]')!;
    expect(status.getAttribute("aria-hidden")).toBeNull();
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);

    act(() => root.render(render(false, true)));
    expect(container.querySelector("input")).toBe(input);
    expect(input.value).toBe("retained draft");
    expect(mounts).toHaveBeenCalledOnce();
    expect(unmounts).not.toHaveBeenCalled();
    act(() => root.render(render(true, true)));
    expect(container.querySelector(".gn-auto-skeleton-overlay")).toBeNull();
    expect(container.querySelector("input")).toBe(input);
  });

  it("remeasures on resize, mutations, scrolling and completed motion and cancels work when loading ends", () => {
    const render = (loading: boolean) => (
      <AutoSkeletonBoundary hasContent={!loading} label="Loading settings" loading={loading}>
        <button>Save</button>
      </AutoSkeletonBoundary>
    );
    act(() => root.render(render(true)));
    const shape = () => container.querySelector<HTMLElement>(".gn-auto-skeleton-shape")!;
    expect(shape().style.width).toBe("120px");
    buttonWidth = 180;
    act(() => {
      resized([], {} as ResizeObserver);
      resized([], {} as ResizeObserver);
    });
    expect(frames.size).toBe(1);
    flushFrame();
    expect(shape().style.width).toBe("180px");

    buttonWidth = 210;
    act(() => mutated([], {} as MutationObserver));
    flushFrame();
    expect(shape().style.width).toBe("210px");
    buttonWidth = 240;
    act(() => container.querySelector("button")!.dispatchEvent(new Event("scroll")));
    flushFrame();
    expect(shape().style.width).toBe("240px");

    buttonWidth = 260;
    // This ancestor lives outside the measured content; scroll does not bubble.
    act(() => container.dispatchEvent(new Event("scroll")));
    expect(frames.size).toBe(1);
    flushFrame();
    expect(shape().style.width).toBe("260px");

    const motionEvents = [
      "animationend", "animationcancel", "transitionend", "transitioncancel"
    ];
    for (const eventName of motionEvents) {
      buttonWidth += 10;
      act(() => container.querySelector("button")!.dispatchEvent(new Event(eventName)));
      expect(frames.size).toBe(1);
      flushFrame();
      expect(shape().style.width).toBe(`${buttonWidth}px`);
    }

    act(() => resized([], {} as ResizeObserver));
    expect(frames.size).toBe(1);
    act(() => root.render(render(false)));
    expect(frames.size).toBe(0);
    expect(resizeDisconnect).toHaveBeenCalled();
    expect(mutationDisconnect).toHaveBeenCalledOnce();
    const observedBeforeCleanup = resizeObserve.mock.calls.length;
    act(() => {
      resized([], {} as ResizeObserver);
      mutated([], {} as MutationObserver);
      window.dispatchEvent(new Event("resize"));
      container.dispatchEvent(new Event("scroll"));
      for (const eventName of motionEvents) {
        container.querySelector("button")!.dispatchEvent(new Event(eventName));
      }
    });
    expect(frames.size).toBe(0);
    expect(resizeObserve).toHaveBeenCalledTimes(observedBeforeCleanup);
  });

  it("retains size subscriptions across text and attribute changes and updates only changed nodes", () => {
    act(() => root.render(
      <AutoSkeletonBoundary hasContent={false} label="Loading settings" loading>
        <button>Save</button>
      </AutoSkeletonBoundary>
    ));
    const observed = resizeObserve.mock.calls.length;
    const content = container.querySelector(".gn-auto-skeleton-content")!;
    act(() => {
      for (let index = 0; index < 20; index += 1) {
        mutated([{ type: "attributes", target: content }] as unknown as MutationRecord[], {} as MutationObserver);
      }
    });
    expect(frames.size).toBe(1);
    flushFrame();
    expect(resizeObserve).toHaveBeenCalledTimes(observed);
    expect(resizeDisconnect).not.toHaveBeenCalled();
    const input = document.createElement("input");
    content.append(input);
    act(() => mutated([{ type: "childList", target: content }] as unknown as MutationRecord[], {} as MutationObserver));
    flushFrame();
    expect(resizeObserve).toHaveBeenCalledTimes(observed + 1);
    expect(resizeObserve).toHaveBeenLastCalledWith(input);
    expect(resizeDisconnect).not.toHaveBeenCalled();
    input.remove();
    act(() => mutated([{ type: "childList", target: content }] as unknown as MutationRecord[], {} as MutationObserver));
    flushFrame();
    expect(resizeUnobserve).toHaveBeenCalledExactlyOnceWith(input);
  });

  it("skips a React commit when a layout notification leaves every placeholder unchanged", () => {
    const committed = vi.fn();
    act(() => root.render(
      <React.Profiler id="skeleton" onRender={committed}>
        <AutoSkeletonBoundary hasContent={false} label="Loading settings" loading>
          <button>Save</button>
        </AutoSkeletonBoundary>
      </React.Profiler>
    ));
    const initialCommits = committed.mock.calls.length;
    act(() => resized([], {} as ResizeObserver));
    flushFrame();
    expect(committed).toHaveBeenCalledTimes(initialCommits);
    buttonWidth = 180;
    act(() => resized([], {} as ResizeObserver));
    flushFrame();
    expect(committed).toHaveBeenCalledTimes(initialCommits + 1);
    expect(container.querySelector<HTMLElement>(".gn-auto-skeleton-shape")!.style.width).toBe("180px");
  });
});
