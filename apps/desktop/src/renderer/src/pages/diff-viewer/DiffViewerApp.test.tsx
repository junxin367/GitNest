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

import {
  createDefaultAppSettings,
  type RepositoryStatusSnapshotDto,
  type UpdateAppSettingsRequest
} from "@gitnest/contracts";

import { DiffViewerApp } from "./DiffViewerApp";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

let emitWorkspaceState:
  | ((state: unknown) => void)
  | undefined;

describe("DiffViewerApp", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    emitWorkspaceState = undefined;
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
    window.history.replaceState(
      {},
      "",
      "/?view=diff&repositoryId=repository&worktreeId=worktree&path=src/main/java/App.java&mode=unstaged"
    );
    Object.defineProperty(window, "gitnest", {
      configurable: true,
      value: createBridge()
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document
      .querySelectorAll(".menu-surface, .toast-viewport")
      .forEach((element) => element.remove());
    vi.unstubAllGlobals();
  });

  it("uses the prototype layout, shared search, filter, and compact tree", async () => {
    await renderDiffViewer(root);

    await vi.waitFor(() => {
      expect(
        container.querySelectorAll(".diff-workspace-file")
      ).toHaveLength(4);
    });

    const unifiedButton = findButton(container, "统一");
    expect(unifiedButton.dataset.selected).toBe("true");
    expect(
      container.querySelector(".diff-viewer-unified")
    ).not.toBeNull();
    expect(container.textContent).not.toContain("diff --git");
    expect(container.textContent).not.toContain("index 1111111");
    expect(container.textContent).not.toContain("--- a/");
    expect(container.textContent).not.toContain("+++ b/");
    expect(
      container.querySelector(".diff-viewer-toolbar")
        ?.firstElementChild?.classList.contains(
          "diff-viewer-toolbar-spacer"
        )
    ).toBe(true);
    const workspace = container.querySelector(
      ".diff-viewer-workspace"
    );
    const content = workspace?.querySelector(
      ":scope > .diff-workspace-content"
    );
    const panel = content?.querySelector(
      ":scope > .diff-viewer-panel"
    );
    expect(
      workspace?.querySelector(":scope > .diff-workspace-sidebar")
    ).not.toBeNull();
    expect(
      panel?.firstElementChild?.classList.contains(
        "diff-viewer-toolbar"
      )
    ).toBe(true);
    expect(
      panel?.querySelector(":scope > .diff-viewer-main")
    ).not.toBeNull();

    const splitButton = findButton(container, "并排");
    await act(async () => {
      splitButton.click();
      await Promise.resolve();
    });
    expect(splitButton.dataset.selected).toBe("true");
    expect(
      container.querySelector(".diff-viewer-split-panes")
    ).not.toBeNull();
    expect(
      container.querySelectorAll(".diff-viewer-split-pane")
    ).toHaveLength(2);
    expect(
      container.querySelectorAll(".diff-viewer-split-scrollbar")
    ).toHaveLength(1);
    expect(
      container.querySelectorAll(
        ".diff-viewer-split-metadata .diff-viewer-wide-row"
      )
    ).toHaveLength(2);
    expect(
      container.textContent?.match(/old mode 100644/g)
    ).toHaveLength(1);
    expect(
      container
        .querySelector(".diff-viewer-code")
        ?.classList.contains("split-nowrap")
    ).toBe(true);
    expect(
      container.querySelector(".diff-viewer-unified")
    ).toBeNull();

    const splitPanes = container.querySelectorAll<HTMLDivElement>(
      ".diff-viewer-split-pane"
    );
    const splitScrollbar =
      container.querySelector<HTMLDivElement>(
        ".diff-viewer-split-scrollbar"
      );
    act(() => {
      if (!splitScrollbar) {
        throw new Error("Shared split scrollbar was not rendered.");
      }
      splitScrollbar.scrollLeft = 36;
      splitScrollbar.dispatchEvent(
        new Event("scroll", { bubbles: true })
      );
    });
    expect(splitPanes[0]?.scrollLeft).toBe(36);
    expect(splitPanes[1]?.scrollLeft).toBe(36);

    act(() => {
      if (!splitPanes[0]) {
        throw new Error("Old split pane was not rendered.");
      }
      splitPanes[0].scrollLeft = 52;
      splitPanes[0].dispatchEvent(
        new Event("scroll", { bubbles: true })
      );
    });
    expect(splitPanes[1]?.scrollLeft).toBe(52);
    expect(splitScrollbar?.scrollLeft).toBe(52);

    const wrapButton = findButton(container, "自动换行");
    await act(async () => {
      wrapButton.click();
      await Promise.resolve();
    });
    expect(
      container.querySelector(".diff-viewer-split-table")
    ).not.toBeNull();
    expect(
      container.querySelector(".diff-viewer-split-panes")
    ).toBeNull();
    expect(
      container
        .querySelector(".diff-viewer-code")
        ?.classList.contains("wrap")
    ).toBe(true);

    await act(async () => {
      wrapButton.click();
      await Promise.resolve();
      unifiedButton.click();
      await Promise.resolve();
    });
    expect(unifiedButton.dataset.selected).toBe("true");
    expect(
      container.querySelector(".diff-viewer-unified")
    ).not.toBeNull();
    expect(
      container.querySelector(".diff-workspace-file-filter-field")
    ).not.toBeNull();
    expect(
      container.querySelector(".diff-viewer-titlebar")
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[aria-label="在独立窗口中打开 Diff"]'
      )
    ).toBeNull();
    expect(
      container.querySelector(".diff-workspace-commit")
    ).toBeNull();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          ctrlKey: true,
          key: "f"
        })
      );
    });
    expect(
      container.querySelector(
        ".gn-diff-search-popover.diff-viewer-search"
      )
    ).not.toBeNull();

    const viewMenuButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="打开变更文件视图菜单"]'
    );
    act(() => viewMenuButton?.click());
    const treeViewButton = findButton(document.body, "以树形式查看");
    await act(async () => {
      treeViewButton.click();
      await Promise.resolve();
    });

    const directoryLabels = Array.from(
      container.querySelectorAll(
        ".diff-workspace-tree-directory > span"
      )
    ).map((element) => element.textContent);
    expect(directoryLabels).toEqual(
      expect.arrayContaining([
        "src \\ main \\ java",
        "docs \\ guide"
      ])
    );
  });

  it("refreshes changes and the selected diff for the first content change after the baseline", async () => {
    await renderDiffViewer(root);

    await vi.waitFor(() => {
      expect(
        container.querySelectorAll(".diff-workspace-file")
      ).toHaveLength(4);
    });
    const bridge = window.gitnest;
    const initialChangesCalls = vi.mocked(
      bridge.repository.getChanges
    ).mock.calls.length;
    const initialDiffCalls = vi.mocked(
      bridge.repository.getDiff
    ).mock.calls.length;

    await vi.waitFor(() => {
      expect(bridge.workspace.getState).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
    });

    emitWorkspaceState?.({
      snapshots: [workspaceSnapshot(5)]
    });

    await vi.waitFor(() => {
      expect(
        vi.mocked(bridge.repository.getChanges).mock.calls.length
      ).toBeGreaterThan(initialChangesCalls);
      expect(
        vi.mocked(bridge.repository.getDiff).mock.calls.length
      ).toBeGreaterThan(initialDiffCalls);
    });
  });

  it("does not refresh when only the target refresh timestamp changes", async () => {
    await renderDiffViewer(root);

    await vi.waitFor(() => {
      expect(
        container.querySelectorAll(".diff-workspace-file")
      ).toHaveLength(4);
      expect(window.gitnest.workspace.getState).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const bridge = window.gitnest;
    const initialChangesCalls = vi.mocked(
      bridge.repository.getChanges
    ).mock.calls.length;
    const initialDiffCalls = vi.mocked(
      bridge.repository.getDiff
    ).mock.calls.length;

    emitWorkspaceState?.({
      snapshots: [
        {
          ...workspaceSnapshot(4),
          refreshedAt: "2026-09-21T13:15:00.000Z"
        }
      ]
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(
      vi.mocked(bridge.repository.getChanges).mock.calls.length
    ).toBe(initialChangesCalls);
    expect(
      vi.mocked(bridge.repository.getDiff).mock.calls.length
    ).toBe(initialDiffCalls);
  });

  it("clears stale files and diff when the target snapshot disappears", async () => {
    await renderDiffViewer(root);

    await vi.waitFor(() => {
      expect(
        container.querySelectorAll(".diff-workspace-file")
      ).toHaveLength(4);
      expect(container.textContent).toContain(
        "const newValue = true;"
      );
    });

    emitWorkspaceState?.({ snapshots: [] });

    await vi.waitFor(() => {
      expect(
        container.querySelectorAll(".diff-workspace-file")
      ).toHaveLength(0);
      expect(container.textContent).toContain(
        "仓库或 Worktree 已不可用"
      );
      expect(container.textContent).not.toContain(
        "const newValue = true;"
      );
    });
  });

  it("ignores an in-flight changes response after the target snapshot disappears", async () => {
    const bridge = createBridge();
    const pendingChanges = deferred<
      Awaited<
        ReturnType<typeof bridge.repository.getChanges>
      >
    >();
    vi.mocked(
      bridge.repository.getChanges
    ).mockReturnValueOnce(pendingChanges.promise);
    Object.defineProperty(window, "gitnest", {
      configurable: true,
      value: bridge
    });

    await act(async () => {
      root.render(<DiffViewerApp />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        bridge.repository.getChanges
      ).toHaveBeenCalled();
    });

    await act(async () => {
      emitWorkspaceState?.({ snapshots: [] });
      pendingChanges.resolve({
        ok: true,
        value: {
          target: {
            repositoryId: "repository",
            worktreeId: "worktree"
          },
          snapshot: {
            branch: "stale",
            head: "stale-head",
            ahead: 0,
            behind: 0,
            staged: 0,
            unstaged: 1,
            untracked: 0,
            conflicted: 0,
            changes: [
              {
                path: "src/stale/LateResponse.ts",
                indexStatus: ".",
                worktreeStatus: "M",
                kind: "ordinary"
              }
            ],
            refreshedAt: "2026-09-21T13:52:00.000Z"
          }
        }
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain(
        "仓库或 Worktree 已不可用"
      );
      expect(
        container.querySelectorAll(".diff-workspace-file")
      ).toHaveLength(0);
      expect(container.textContent).not.toContain(
        "LateResponse.ts"
      );
    });
  });

  it("toggles the selected hunk context from its marker", async () => {
    await renderDiffViewer(root);

    const getDiff = vi.mocked(
      window.gitnest.repository.getDiff
    );
    await vi.waitFor(() => {
      expect(getDiff).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "src/main/java/App.java",
          mode: "unstaged",
          contextLines: 3
        })
      );
    });

    await vi.waitFor(() => {
      expect(
        container.querySelector(
          '[aria-label="展开第 1 个变更块上下各 10 行"]'
        )
      ).not.toBeNull();
    });
    const hunkTrigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="展开第 1 个变更块上下各 10 行"]'
    );
    if (!hunkTrigger) {
      throw new Error("Hunk context trigger was not rendered.");
    }
    await act(async () => {
      hunkTrigger.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(getDiff).toHaveBeenLastCalledWith(
        expect.objectContaining({
          contextLines: 10
        })
      );
      expect(
        container.querySelector(
          '[aria-label="收起第 1 个变更块上下文"]'
        )
      ).not.toBeNull();
    });

    const callsBeforeReset = getDiff.mock.calls.length;
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="收起第 1 个变更块上下文"]'
        )
        ?.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(getDiff).toHaveBeenCalledTimes(callsBeforeReset);
      expect(
        container.querySelector(
          '[aria-label="展开第 1 个变更块上下各 10 行"]'
        )
      ).not.toBeNull();
      expect(container.textContent).not.toContain("展开本段");
    });
  });

  it("opens the shared file context menu in the standalone window", async () => {
    await renderDiffViewer(root);

    await vi.waitFor(() => {
      expect(
        container.querySelectorAll(".diff-workspace-file")
      ).toHaveLength(4);
      expect(
        vi.mocked(
          window.gitnest.system.listExternalApplications
        )
      ).toHaveBeenCalled();
    });

    const fileRow = Array.from(
      container.querySelectorAll<HTMLDivElement>(
        ".diff-workspace-file"
      )
    ).find((candidate) =>
      candidate.textContent?.includes("Config.java")
    );
    if (!fileRow) {
      throw new Error("Config.java file row was not rendered.");
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

    await vi.waitFor(() => {
      expect(
        Array.from(
          document.body.querySelectorAll<HTMLButtonElement>(
            "button"
          )
        ).some(
          (candidate) =>
            candidate.textContent?.trim() === "VS Code"
        )
      ).toBe(true);
    });
    await act(async () => {
      findButton(document.body, "VS Code").click();
      await Promise.resolve();
    });

    expect(
      window.gitnest.system.openExternalApplication
    ).toHaveBeenCalledWith({
      context: {
        scope: "file",
        target: {
          repositoryId: "repository",
          worktreeId: "worktree"
        },
        path: "src/main/java/Config.java"
      },
      kind: "vscode"
    });
  });
});

async function renderDiffViewer(root: Root) {
  await act(async () => {
    root.render(<DiffViewerApp />);
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(
    () =>
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, 520);
      })
  );
}

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

function createBridge(): typeof window.gitnest {
  const appSettings = createDefaultAppSettings();
  const changes = [
    {
      path: "src/main/java/App.java",
      indexStatus: ".",
      worktreeStatus: "M",
      kind: "ordinary" as const
    },
    {
      path: "src/main/java/Config.java",
      indexStatus: ".",
      worktreeStatus: "M",
      kind: "ordinary" as const
    },
    {
      path: "docs/guide/start.md",
      indexStatus: "A",
      worktreeStatus: ".",
      kind: "added" as const
    },
    {
      path: "README.md",
      indexStatus: ".",
      worktreeStatus: "?",
      kind: "untracked" as const
    }
  ];

  return {
    settings: {
      get: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          settings: structuredClone(appSettings),
          storageState: "persisted"
        }
      }),
      update: vi.fn(
        async (patch: UpdateAppSettingsRequest) => {
          if (patch.general) {
            Object.assign(appSettings.general, patch.general);
          }
          if (patch.appearance) {
            Object.assign(
              appSettings.appearance,
              patch.appearance
            );
          }
          if (patch.diff) {
            Object.assign(appSettings.diff, patch.diff);
          }
          if (patch.git) {
            Object.assign(appSettings.git, patch.git);
          }
          if (patch.ai) {
            const { apiKey, ...publicAiPatch } = patch.ai;
            Object.assign(appSettings.ai, publicAiPatch);
            if (apiKey) {
              appSettings.ai.apiKeyConfigured = true;
            }
          }
          if (patch.navigation) {
            Object.assign(
              appSettings.navigation,
              patch.navigation
            );
          }
          return {
            ok: true as const,
            value: structuredClone(appSettings)
          };
        }
      ),
      clearAiApiKey: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          ...structuredClone(appSettings),
          ai: {
            ...appSettings.ai,
            apiKeyConfigured: false
          }
        }
      })
    },
    system: {
      listExternalApplications: vi.fn().mockResolvedValue({
        ok: true,
        value: [{ kind: "vscode", label: "VS Code" }]
      }),
      openExternalApplication: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          kind: "vscode"
        }
      })
    },
    repository: {
      getChanges: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          target: {
            repositoryId: "repository",
            worktreeId: "worktree"
          },
          snapshot: {
            branch: "main",
            changes
          }
        }
      }),
      getDiff: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          target: {
            repositoryId: "repository",
            worktreeId: "worktree"
          },
          diff: {
            path: "src/main/java/App.java",
            mode: "unstaged",
            content: [
              "diff --git a/src/main/java/App.java b/src/main/java/App.java",
              "index 1111111..2222222 100644",
              "--- a/src/main/java/App.java",
              "+++ b/src/main/java/App.java",
              "old mode 100644",
              "new mode 100755",
              "@@ -1 +1 @@",
              "-const oldValue = true;",
              "+const newValue = true;"
            ].join("\n"),
            binary: false,
            truncated: false,
            additions: 1,
            deletions: 1
          }
        }
      }),
      cancelQuery: vi.fn().mockResolvedValue({
        ok: true,
        value: undefined
      }),
      stage: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          operationId: "stage-operation"
        }
      }),
      unstage: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          operationId: "unstage-operation"
        }
      })
    },
    workspace: {
      getState: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          snapshots: [workspaceSnapshot(4)]
        }
      }),
      onStateChanged: vi.fn((listener: (state: unknown) => void) => {
        emitWorkspaceState = listener;
        return () => {
          if (emitWorkspaceState === listener) {
            emitWorkspaceState = undefined;
          }
        };
      })
    },
    window: {
      close: vi.fn().mockResolvedValue(undefined),
      minimize: vi.fn().mockResolvedValue(undefined),
      toggleMaximize: vi.fn().mockResolvedValue(undefined)
    }
  } as unknown as typeof window.gitnest;
}

function workspaceSnapshot(
  contentVersion: number
): RepositoryStatusSnapshotDto {
  return {
    repositoryId: "repository",
    worktreeId: "worktree",
    head: "head",
    branch: "main",
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 1,
    untracked: 0,
    conflicted: 0,
    contentVersion,
    refreshPending: false,
    stale: false,
    refreshedAt: "2026-09-21T13:14:00.000Z"
  };
}

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve(value: Value): void;
} {
  let resolvePromise!: (value: Value) => void;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: resolvePromise
  };
}
