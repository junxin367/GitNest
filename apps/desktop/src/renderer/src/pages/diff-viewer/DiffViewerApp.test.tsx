/** @vitest-environment jsdom */

import React, { act, Profiler } from "react";
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
  type AppSettingsDto,
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
let emitWindowMaximized:
  | ((maximized: boolean) => void)
  | undefined;
let emitSettings: ((settings: AppSettingsDto) => void) | undefined;

describe("DiffViewerApp", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    emitWorkspaceState = undefined;
    emitWindowMaximized = undefined;
    emitSettings = undefined;
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

  it("shows the restore icon while the window is maximized", async () => {
    await renderDiffViewer(root);

    const maximizeButton =
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="最大化"]'
      );
    expect(maximizeButton).not.toBeNull();
    expect(
      maximizeButton?.querySelector("svg path")
    ).toBeNull();

    act(() => {
      emitWindowMaximized?.(true);
    });

    const restoreButton =
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="还原"]'
      );
    expect(restoreButton).not.toBeNull();
    expect(
      restoreButton?.querySelector("svg path")
    ).not.toBeNull();
  });

  it("loads repository browsing preferences and synchronizes changes from another window", async () => {
    const settings = createDefaultAppSettings();
    settings.repositoryFileBrowsing.repository = {
      fileView: "tree", treeDirectoriesCollapsed: true
    };
    vi.mocked(window.gitnest.settings.get).mockResolvedValue({
      ok: true, value: { settings, storageState: "persisted" }
    });
    await renderDiffViewer(root);
    await vi.waitFor(() => {
      expect(container.querySelector(".diff-workspace-tree-directory")?.getAttribute("aria-expanded")).toBe("false");
    });
    act(() => {
      emitSettings?.({
        ...settings,
        repositoryFileBrowsing: {
          repository: { fileView: "tree", treeDirectoriesCollapsed: false },
          other: { fileView: "list", treeDirectoriesCollapsed: true }
        }
      });
    });
    expect(container.querySelector(".diff-workspace-tree-directory")?.getAttribute("aria-expanded")).toBe("true");
    act(() => {
      emitSettings?.({
        ...settings,
        repositoryFileBrowsing: {
          repository: { fileView: "list", treeDirectoriesCollapsed: false }
        }
      });
    });
    expect(container.querySelector(".diff-workspace-tree-directory")).toBeNull();
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
    expect(window.gitnest.settings.update).toHaveBeenLastCalledWith({
      repositoryFileBrowsing: { repositoryId: "repository", fileView: "tree" }
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

  it("keeps the selected diff visible when a background refresh fails", async () => {
    await renderDiffViewer(root);
    expect(container.textContent).toContain("const newValue = true;");
    const pending = deferred<Awaited<ReturnType<typeof window.gitnest.repository.getDiff>>>();
    vi.mocked(window.gitnest.repository.getDiff).mockReturnValueOnce(pending.promise);
    await refreshChanges(container);
    expect(container.textContent).toContain("const newValue = true;");
    expect(container.querySelector(".diff-content-skeleton")).toBeNull();
    await act(async () => {
      pending.resolve({ ok: false, error: {
        code: "COMMAND_FAILED", message: "后台读取失败", details: {}
      } });
    });
    expect(container.textContent).toContain("const newValue = true;");
    expect(document.body.textContent).toContain("后台读取失败");
    expect(container.querySelector(".diff-content-skeleton")).toBeNull();
  });

  it("uses a skeleton again while retrying the first unsuccessful changes read", async () => {
    vi.mocked(window.gitnest.repository.getChanges).mockResolvedValueOnce({
      ok: false, error: { code: "COMMAND_FAILED", message: "首次变更读取失败", details: {} }
    });
    vi.mocked(window.gitnest.repository.getDiff).mockResolvedValue({
      ok: false, error: { code: "COMMAND_FAILED", message: "首次 Diff 读取失败", details: {} }
    });
    await renderDiffViewer(root);
    expect(container.textContent).toContain("首次变更读取失败");
    const pending = deferred<Awaited<ReturnType<typeof window.gitnest.repository.getChanges>>>();
    vi.mocked(window.gitnest.repository.getChanges).mockReturnValueOnce(pending.promise);
    await refreshChanges(container);
    expect(container.querySelector(".diff-workspace-skeleton")).not.toBeNull();
  });

  it("shows an available diff while the initial changes list is still loading", async () => {
    vi.mocked(window.gitnest.repository.getChanges).mockImplementation(
      () => new Promise(() => undefined)
    );
    await renderDiffViewer(root);
    expect(container.textContent).toContain("const newValue = true;");
    expect(container.querySelector(".diff-workspace-skeleton")).toBeNull();
  });

  it("keeps a loaded single-file list visible when its refresh fails", async () => {
    const initial = await window.gitnest.repository.getChanges({
      queryId: "fixture",
      target: { repositoryId: "repository", worktreeId: "worktree" }
    });
    if (!initial.ok) throw new Error("Expected successful fixture");
    vi.mocked(window.gitnest.repository.getChanges).mockResolvedValue({
      ...initial,
      value: {
        ...initial.value,
        snapshot: {
          ...initial.value.snapshot,
          changes: initial.value.snapshot.changes.filter(change => change.path.endsWith("App.java"))
        }
      }
    });
    await renderDiffViewer(root);
    expect(container.querySelectorAll(".diff-workspace-file")).toHaveLength(1);
    vi.mocked(window.gitnest.repository.getChanges).mockResolvedValueOnce({
      ok: false, error: { code: "COMMAND_FAILED", message: "变更刷新失败", details: {} }
    });
    await refreshChanges(container);
    expect(container.querySelectorAll(".diff-workspace-file")).toHaveLength(1);
    expect(document.body.textContent).toContain("变更刷新失败");
  });

  it("never paints the previous file's diff under the newly selected path", async () => {
    const frames: Array<{ content: string; skeleton: boolean }> = [];
    await act(async () => {
      root.render(
        <Profiler id="diff-viewer" onRender={() => {
          frames.push({
            content: container.querySelector(".diff-viewer-code")?.textContent ?? "",
            skeleton: Boolean(container.querySelector(".diff-content-skeleton"))
          });
        }}>
          <DiffViewerApp />
        </Profiler>
      );
    });
    expect(container.textContent).toContain("const newValue = true;");
    vi.mocked(window.gitnest.repository.getDiff).mockImplementation(
      () => new Promise(() => undefined)
    );
    frames.length = 0;
    const row = Array.from(container.querySelectorAll<HTMLElement>(".diff-workspace-file"))
      .find(candidate => candidate.textContent?.includes("Config.java"));
    expect(row).toBeDefined();
    await act(async () => { row!.querySelector<HTMLButtonElement>(".diff-workspace-file-select")!.click(); });
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every(frame => !frame.content.includes("const newValue = true;"))).toBe(true);
    expect(frames[0]?.skeleton).toBe(true);
  });

  it("shows initial loading when an unavailable target reappears without cached files", async () => {
    const frames: boolean[] = [];
    await act(async () => {
      root.render(
        <Profiler id="restored-target" onRender={() => {
          frames.push(Boolean(container.querySelector(".diff-workspace-skeleton")));
        }}>
          <DiffViewerApp />
        </Profiler>
      );
    });
    await act(async () => { emitWorkspaceState?.({ snapshots: [] }); });
    expect(container.textContent).toContain("仓库或 Worktree 已不可用");
    vi.mocked(window.gitnest.repository.getChanges).mockImplementation(
      () => new Promise(() => undefined)
    );
    frames.length = 0;
    await act(async () => { emitWorkspaceState?.({ snapshots: [workspaceSnapshot(5)] }); });
    expect(container.querySelector(".diff-workspace-skeleton")).not.toBeNull();
    expect(container.textContent).not.toContain("工作区干净");
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every(Boolean)).toBe(true);
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

async function refreshChanges(container: HTMLElement) {
  await act(async () => {
    const menu = container.querySelector<HTMLButtonElement>('button[title="变更文件视图"]');
    expect(menu).not.toBeNull();
    menu!.click();
  });
  await act(async () => { findButton(document.body, "重新读取变更").click(); });
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
      onChanged: vi.fn((listener: (settings: AppSettingsDto) => void) => {
        emitSettings = listener;
        return () => { emitSettings = undefined; };
      }),
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
          if (patch.repositoryFileBrowsing) {
            const { repositoryId, ...preference } = patch.repositoryFileBrowsing;
            appSettings.repositoryFileBrowsing[repositoryId] = {
              fileView: appSettings.diff.fileView,
              treeDirectoriesCollapsed: appSettings.diff.treeDirectoriesCollapsed,
              ...appSettings.repositoryFileBrowsing[repositoryId],
              ...preference
            };
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
      isMaximized: vi.fn().mockResolvedValue(false),
      minimize: vi.fn().mockResolvedValue(undefined),
      onMaximizedChanged: vi.fn((listener) => {
        emitWindowMaximized = listener;
        return () => {
          if (emitWindowMaximized === listener) {
            emitWindowMaximized = undefined;
          }
        };
      }),
      toggleMaximize: vi.fn().mockResolvedValue(true)
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
