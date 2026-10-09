/** @vitest-environment jsdom */

import React, { act, forwardRef } from "react";
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

const changeTreeCalls = vi.hoisted(() => ({
  build: vi.fn(),
  compact: vi.fn(),
  fileButton: vi.fn()
}));

vi.mock("../../shared/ui/Button", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../shared/ui/Button")>();
  return {
    ...actual,
    Button: forwardRef<HTMLButtonElement, React.ComponentProps<typeof actual.Button>>(
      (props, ref) => {
        if (props.className === "diff-workspace-file-select") {
          changeTreeCalls.fileButton();
        }
        return <actual.Button {...props} ref={ref} />;
      }
    )
  };
});

vi.mock("../../shared/model/changeTree", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../shared/model/changeTree")
    >();
  return {
    ...actual,
    buildChangeTree: (
      ...args: Parameters<typeof actual.buildChangeTree>
    ) => {
      changeTreeCalls.build();
      return actual.buildChangeTree(...args);
    },
    compactChangeTreeNodes: (
      ...args: Parameters<
        typeof actual.compactChangeTreeNodes
      >
    ) => {
      changeTreeCalls.compact();
      return actual.compactChangeTreeNodes(...args);
    }
  };
});

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
    changeTreeCalls.build.mockClear();
    changeTreeCalls.compact.mockClear();
    changeTreeCalls.fileButton.mockClear();
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
    vi.restoreAllMocks();
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

  it("keeps a manually collapsed directory closed when a refresh updates the selected file", () => {
    const onSelectedFileChange = vi.fn();
    const render = (files: DiffViewerFile[]) => {
      root.render(
        <DiffFileNavigator configuration={repositoryDiffWorkspaceConfiguration.navigation}
          fileView="tree" files={files} selectedFileKey={FILES[1]!.key}
          treePreference={{ initiallyCollapsed: false, scopeKey: "manual-collapse-refresh" }}
          onSelectedFileChange={onSelectedFileChange} />
      );
    };
    act(() => render(FILES));
    const directory = container.querySelector<HTMLSpanElement>('.diff-workspace-tree-directory span[title="src"]')
      ?.closest("button");
    expect(directory?.getAttribute("aria-expanded")).toBe("true");
    act(() => directory?.click());
    expect(directory?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('button[aria-label="target.ts"]')).toBeNull();

    act(() => render(FILES.map((file) => ({
      ...file, additions: 5, deletions: 1, change: { ...file.change }
    }))));

    expect(directory?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('button[aria-label="target.ts"]')).toBeNull();
    expect(onSelectedFileChange).not.toHaveBeenCalled();
  });

  it("applies a changed saved collapse preference without changing the file scope", () => {
    const render = (initiallyCollapsed: boolean) => root.render(
      <DiffFileNavigator
        configuration={repositoryDiffWorkspaceConfiguration.navigation}
        fileView="tree" files={FILES}
        treePreference={{ initiallyCollapsed, scopeKey: "saved-preference-sync" }}
        onSelectedFileChange={vi.fn()} />
    );
    act(() => render(false));
    expect(container.querySelector('button[aria-label="target.ts"]')).not.toBeNull();
    act(() => render(true));
    expect(container.querySelector('button[aria-label="target.ts"]')).toBeNull();
    act(() => render(false));
    expect(container.querySelector('button[aria-label="target.ts"]')).not.toBeNull();
  });

  it.each(["selection", "reveal"] as const)(
    "expands a manually collapsed directory after an explicit %s",
    (action) => {
      const render = (selectedFileKey: string, selectionRevealKey?: string) => {
        root.render(
          <DiffFileNavigator configuration={repositoryDiffWorkspaceConfiguration.navigation}
            fileView="tree" files={FILES} selectedFileKey={selectedFileKey}
            selectionRevealKey={selectionRevealKey}
            treePreference={{ initiallyCollapsed: false, scopeKey: `manual-collapse-${action}` }}
            onSelectedFileChange={vi.fn()} />
        );
      };
      act(() => render(FILES[0]!.key));
      const directory = container.querySelector<HTMLSpanElement>('.diff-workspace-tree-directory span[title="src"]')
        ?.closest("button");
      act(() => directory?.click());
      expect(directory?.getAttribute("aria-expanded")).toBe("false");
      act(() => render(
        action === "selection" ? FILES[1]!.key : FILES[0]!.key,
        action === "reveal" ? "reveal-collapsed-file" : undefined
      ));
      expect(directory?.getAttribute("aria-expanded")).toBe("true");
      const selectedButton = container.querySelector<HTMLButtonElement>(
        `.diff-workspace-file-select[aria-current="true"]`
      );
      expect(selectedButton).not.toBeNull();
      if (action === "reveal") {
        expect(document.activeElement).toBe(selectedButton);
      }
    }
  );

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

  it("does not show a filter-empty result while a new file list is loading", () => {
    const renderFiles = (changesLoading: boolean, files: DiffViewerFile[]) => {
      act(() => root.render(
        <DiffFileNavigator
          changesLoading={changesLoading}
          configuration={repositoryDiffWorkspaceConfiguration.navigation}
          files={files}
          onSelectedFileChange={vi.fn()}
        />
      ));
    };
    renderFiles(false, FILES_WITH_STATS);
    act(() => setInputValue(
      container.querySelector('input[aria-label="筛选变更文件"]'),
      "no-match"
    ));
    expect(container.textContent).toContain("没有匹配的变更");
    renderFiles(true, []);
    expect(container.textContent).not.toContain("没有匹配的变更");
    expect(container.textContent).not.toContain("工作区干净");
    renderFiles(false, FILES_WITH_STATS);
    expect(container.textContent).toContain("没有匹配的变更");
  });

  it("indexes files by path and does not rescan stable files when the menu changes", () => {
    const files = Array.from(
      { length: 100 },
      (_, index) =>
        file(`unstaged\u0001src/file-${index}.ts`, `src/file-${index}.ts`)
    );
    const originalFind = Array.prototype.find;
    const sectionFinds = vi
      .spyOn(Array.prototype, "find")
      .mockImplementation(function (
        this: unknown[],
        ...args: Parameters<typeof originalFind>
      ) {
        return originalFind.apply(this, args);
      });

    act(() => {
      root.render(
        <DiffFileNavigator
          configuration={
            repositoryDiffWorkspaceConfiguration.navigation
          }
          fileView="tree"
          files={files}
          onSelectedFileChange={vi.fn()}
          selectedFileKey={files[0]!.key}
          treePreference={{
            initiallyCollapsed: false,
            scopeKey: "path-index"
          }}
        />
      );
    });

    const matchingFileArrayFinds = () =>
      sectionFinds.mock.instances.filter(
        (instance) =>
          Array.isArray(instance) &&
          instance.length === files.length &&
          instance.every(
            (candidate) =>
              typeof candidate === "object" &&
              candidate !== null &&
              "key" in candidate &&
              "mode" in candidate &&
              "path" in candidate
          )
      );
    expect(new Set(matchingFileArrayFinds()).size).toBe(1);
    const initialFindCount = matchingFileArrayFinds().length;
    const viewMenu = container.querySelector<HTMLButtonElement>(
      'button[aria-label="打开变更文件视图菜单"]'
    );
    act(() => viewMenu?.click());
    act(() => viewMenu?.click());
    expect(matchingFileArrayFinds()).toHaveLength(
      initialFindCount
    );
  });

  it("keeps the first section file when duplicate paths share one tree leaf", () => {
    const first = file(
      "unstaged\u0001src/duplicate.ts:first",
      "src/duplicate.ts"
    );
    const duplicate = {
      ...file(
        "unstaged\u0001src/duplicate.ts:second",
        "src/duplicate.ts"
      ),
      status: "D"
    };

    act(() => {
      root.render(
        <DiffFileNavigator
          configuration={
            repositoryDiffWorkspaceConfiguration.navigation
          }
          fileView="tree"
          files={[first, duplicate]}
          onSelectedFileChange={vi.fn()}
          selectedFileKey={first.key}
        />
      );
    });

    expect(
      container.querySelector(
        `[data-diff-file-key="${first.key}"]`
      )
    ).not.toBeNull();
    expect(
      container.querySelector(
        `[data-diff-file-key="${duplicate.key}"]`
      )
    ).toBeNull();
  });

  it.each(["list", "tree"] as const)(
    "does not rerender %s file rows or recheck action eligibility when toggling the menu",
    (fileView) => {
      const files = Array.from({ length: 100 }, (_, index) =>
        file(`unstaged\u0001src/file-${index}.ts`, `src/file-${index}.ts`)
      );
      const canStageFile = vi.fn(() => true);
      const onStageFile = vi.fn();
      act(() => root.render(
        <DiffFileNavigator
          configuration={repositoryDiffWorkspaceConfiguration.navigation}
          fileView={fileView}
          files={files}
          selectedFileKey={files[0]!.key}
          onSelectedFileChange={vi.fn()}
          onStageFile={onStageFile}
          canStageFile={canStageFile}
          treePreference={{ initiallyCollapsed: false, scopeKey: `render-cache-${fileView}` }}
        />
      ));
      expect(changeTreeCalls.fileButton).toHaveBeenCalled();
      changeTreeCalls.fileButton.mockClear();
      canStageFile.mockClear();
      const menu = container.querySelector<HTMLButtonElement>(
        'button[aria-label="打开变更文件视图菜单"]'
      );
      act(() => menu!.click());
      act(() => menu!.click());
      expect(changeTreeCalls.fileButton).not.toHaveBeenCalled();
      expect(canStageFile).not.toHaveBeenCalled();
    }
  );

  it.each(["list", "tree"] as const)(
    "only renders the previous and next selected %s file rows",
    (fileView) => {
      const files = Array.from({ length: 100 }, (_, index) =>
        file(`unstaged\u0001src/file-${index}.ts`, `src/file-${index}.ts`)
      );
      const onSelectedFileChange = vi.fn();
      const canStageFile = vi.fn(() => true);
      const onStageFile = vi.fn();
      const render = (selectedFileKey: string) => root.render(
        <DiffFileNavigator
          configuration={repositoryDiffWorkspaceConfiguration.navigation}
          fileView={fileView}
          files={files}
          selectedFileKey={selectedFileKey}
          onSelectedFileChange={onSelectedFileChange}
          canStageFile={canStageFile}
          onStageFile={onStageFile}
        />
      );
      act(() => render(files[0]!.key));
      changeTreeCalls.fileButton.mockClear();
      canStageFile.mockClear();
      act(() => render(files[50]!.key));
      expect(changeTreeCalls.fileButton).toHaveBeenCalledTimes(2);
      expect(canStageFile).toHaveBeenCalledTimes(2);
      const selected = container.querySelector<HTMLButtonElement>(
        '.diff-workspace-file.selected .diff-workspace-file-select'
      )!;
      act(() => selected.click());
      expect(onSelectedFileChange).toHaveBeenCalledWith(files[50], "user");
    }
  );

  it("only visits files in the toggled tree branch and leaves other sections untouched", () => {
    const otherFileRead = vi.fn();
    const files = [
      file("unstaged\u0001a/target.ts", "a/target.ts"),
      ...Array.from({ length: 100 }, (_, index) => {
        const candidate = file(`unstaged\u0001b/file-${index}.ts`, `b/file-${index}.ts`);
        return {
          ...candidate,
          get key() {
            otherFileRead();
            return candidate.key;
          }
        };
      }),
      { ...file("staged\u0001c/staged.ts", "c/staged.ts"), mode: "staged" as const }
    ];
    act(() => root.render(
      <DiffFileNavigator
        configuration={repositoryDiffWorkspaceConfiguration.navigation}
        fileView="tree"
        files={files}
        selectedFileKey={files[0]!.key}
        onSelectedFileChange={vi.fn()}
        treePreference={{ initiallyCollapsed: false, scopeKey: "isolated-tree-toggle" }}
      />
    ));
    const directory = Array.from(container.querySelectorAll<HTMLButtonElement>(
      ".diff-workspace-tree-directory"
    )).find((button) => button.querySelector('span[title="a"]'))!;
    otherFileRead.mockClear();
    act(() => directory.click());
    expect(container.querySelector('button[aria-label="target.ts"]')).toBeNull();
    expect(otherFileRead).not.toHaveBeenCalled();
    act(() => directory.click());
    expect(container.querySelector('button[aria-label="target.ts"]')).not.toBeNull();
    expect(otherFileRead).not.toHaveBeenCalled();

    const stagedSection = container.querySelector<HTMLButtonElement>(
      ".diff-workspace-file-section-title"
    )!;
    act(() => stagedSection.click());
    expect(container.querySelector('button[aria-label="staged.ts"]')).toBeNull();
    expect(otherFileRead).not.toHaveBeenCalled();
    act(() => stagedSection.click());
    expect(container.querySelector('button[aria-label="staged.ts"]')).not.toBeNull();
    expect(otherFileRead).not.toHaveBeenCalled();
  });

  it("uses current directory state and file handlers after a collapsed subtree remounts", () => {
    let files = [...FILES];
    let scopeKey = "tree-subscription-first";
    let onFileContextMenu = vi.fn();
    const onSelectedFileChange = vi.fn();
    const render = () => root.render(
      <DiffFileNavigator
        configuration={repositoryDiffWorkspaceConfiguration.navigation}
        fileView="tree"
        files={files}
        selectedFileKey={files[0]!.key}
        onSelectedFileChange={onSelectedFileChange}
        onFileContextMenu={onFileContextMenu}
        treePreference={{ initiallyCollapsed: false, scopeKey }}
      />
    );
    const directory = (path: string) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>(".diff-workspace-tree-directory"))
        .find((button) => button.querySelector(`span[title="${path}"]`))!;
    act(render);
    act(() => directory("src/nested").click());
    act(() => directory("src").click());
    const oldContextMenu = onFileContextMenu;
    onFileContextMenu = vi.fn();
    files = files.map((item) => ({ ...item, additions: 13, deletions: 2 }));
    act(render);
    expect(container.querySelectorAll("[data-diff-file-key]")).toHaveLength(0);
    act(() => directory("src").click());
    expect(directory("src/nested").getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll("[data-diff-file-key]")).toHaveLength(1);
    act(() => directory("src/nested").click());
    const target = container.querySelector<HTMLElement>(
      `[data-diff-file-key="${files[1]!.key}"]`
    )!;
    act(() => target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    expect(oldContextMenu).not.toHaveBeenCalled();
    expect(onFileContextMenu).toHaveBeenCalledWith(expect.anything(), files[1]);
    expect(target.querySelector('[aria-label="新增 13 行，删除 2 行"]')).not.toBeNull();
    act(() => directory("src").click());
    scopeKey = "tree-subscription-second";
    act(render);
    expect(container.querySelectorAll("[data-diff-file-key]")).toHaveLength(2);
    expect(directory("src").getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps bulk collapse actions synchronized with local toggles and newly discovered directories", () => {
    let files = [...FILES];
    let initiallyCollapsed = false;
    const preferenceChanged = vi.fn((collapsed: boolean) => {
      initiallyCollapsed = collapsed;
    });
    const onSelectedFileChange = vi.fn();
    const render = () => root.render(
      <DiffFileNavigator
        configuration={repositoryDiffWorkspaceConfiguration.navigation}
        fileView="tree"
        files={files}
        selectedFileKey={files[0]!.key}
        onSelectedFileChange={onSelectedFileChange}
        treePreference={{
          initiallyCollapsed,
          scopeKey: "bulk-directory-subscriptions",
          onCollapsedPreferenceChange: preferenceChanged
        }}
      />
    );
    const menuAction = (text: string) => {
      act(() => container.querySelector<HTMLButtonElement>(
        'button[aria-label="打开变更文件视图菜单"]'
      )!.click());
      const menu = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        .find((item) => item.textContent === text)!;
      expect(menu).toBeDefined();
      act(() => menu.click());
    };
    act(render);
    menuAction("收起目录");
    act(render);
    expect(preferenceChanged).toHaveBeenLastCalledWith(true);
    expect(container.querySelectorAll("[data-diff-file-key]")).toHaveLength(0);
    files = [...files, file("unstaged\u0001new/fresh.ts", "new/fresh.ts")];
    act(render);
    expect(container.querySelector('button[aria-label="fresh.ts"]')).toBeNull();
    menuAction("展开目录");
    act(render);
    expect(preferenceChanged).toHaveBeenLastCalledWith(false);
    expect(container.querySelectorAll("[data-diff-file-key]")).toHaveLength(3);
    const directory = container.querySelector<HTMLButtonElement>(".diff-workspace-tree-directory")!;
    act(() => directory.click());
    menuAction("收起目录");
    act(render);
    expect(container.querySelectorAll("[data-diff-file-key]")).toHaveLength(0);
  });

  it("refreshes cached rows and mutation handlers when selection, permissions, busy state or files change", () => {
    let files = [...FILES];
    let selectedFileKey = files[0]!.key;
    let mutationBusy = false;
    let canStageFile = () => true;
    let onStageFile = vi.fn();
    const onSelectedFileChange = vi.fn();
    const render = () => root.render(
      <DiffFileNavigator
        configuration={repositoryDiffWorkspaceConfiguration.navigation}
        fileView="tree"
        files={files}
        selectedFileKey={selectedFileKey}
        onSelectedFileChange={onSelectedFileChange}
        onStageFile={onStageFile}
        canStageFile={canStageFile}
        mutationBusy={mutationBusy}
      />
    );
    const stageButton = () => container.querySelector<HTMLButtonElement>(
      `button[aria-label="暂存 ${files[0]!.path}"]`
    )!;
    act(render);
    selectedFileKey = files[1]!.key;
    act(render);
    expect(container.querySelector('.diff-workspace-file.selected')?.getAttribute("data-diff-file-key"))
      .toBe(selectedFileKey);
    mutationBusy = true;
    act(render);
    expect(stageButton().disabled).toBe(true);
    mutationBusy = false;
    canStageFile = () => false;
    act(render);
    expect(stageButton().disabled).toBe(true);
    canStageFile = () => true;
    const oldHandler = onStageFile;
    onStageFile = vi.fn();
    files = files.map(item => ({ ...item, additions: 8, deletions: 3 }));
    act(render);
    expect(container.querySelector('[aria-label="新增 8 行，删除 3 行"]')).not.toBeNull();
    act(() => stageButton().click());
    expect(oldHandler).not.toHaveBeenCalled();
    expect(onStageFile).toHaveBeenCalledWith(files[0]);
    const directory = container.querySelector<HTMLButtonElement>('.diff-workspace-tree-directory')!;
    act(() => directory.click());
    expect(container.querySelectorAll('[data-diff-file-key]')).toHaveLength(0);
    act(() => directory.click());
    expect(container.querySelectorAll('[data-diff-file-key]')).toHaveLength(2);
  });

  it("reuses derived trees for menu state and rebuilds for files, filters, and tree view changes", () => {
    const onSelectedFileChange = vi.fn();
    let files = FILES;
    let fileView: "list" | "tree" = "tree";
    const render = () =>
      root.render(
        <DiffFileNavigator
          configuration={
            repositoryDiffWorkspaceConfiguration.navigation
          }
          fileView={fileView}
          files={files}
          onSelectedFileChange={onSelectedFileChange}
          selectedFileKey={files[0]!.key}
          treePreference={{
            initiallyCollapsed: false,
            scopeKey: "tree-cache"
          }}
        />
      );

    act(render);
    expect(changeTreeCalls.build).toHaveBeenCalledTimes(1);
    expect(changeTreeCalls.compact).toHaveBeenCalledTimes(1);

    const viewMenu = container.querySelector<HTMLButtonElement>(
      'button[aria-label="打开变更文件视图菜单"]'
    );
    act(() => viewMenu?.click());
    act(() => viewMenu?.click());
    act(render);
    expect(changeTreeCalls.build).toHaveBeenCalledTimes(1);
    expect(changeTreeCalls.compact).toHaveBeenCalledTimes(1);

    files = [
      ...FILES,
      file(
        "unstaged\u0001src/new-file.ts",
        "src/new-file.ts"
      )
    ];
    act(render);
    expect(changeTreeCalls.build).toHaveBeenCalledTimes(2);
    expect(changeTreeCalls.compact).toHaveBeenCalledTimes(2);

    const filter = container.querySelector<HTMLInputElement>(
      'input[aria-label="筛选变更文件"]'
    );
    act(() => setInputValue(filter, "nested"));
    expect(changeTreeCalls.build).toHaveBeenCalledTimes(3);
    expect(changeTreeCalls.compact).toHaveBeenCalledTimes(3);

    fileView = "list";
    act(render);
    expect(changeTreeCalls.build).toHaveBeenCalledTimes(3);
    expect(changeTreeCalls.compact).toHaveBeenCalledTimes(3);

    fileView = "tree";
    act(render);
    expect(changeTreeCalls.build).toHaveBeenCalledTimes(4);
    expect(changeTreeCalls.compact).toHaveBeenCalledTimes(4);
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

function file(
  key: string,
  path: string
): DiffViewerFile {
  return {
    key,
    path,
    mode: "unstaged",
    status: "M",
    kind: "ordinary",
    change: {
      path,
      indexStatus: ".",
      worktreeStatus: "M",
      kind: "ordinary"
    }
  };
}
