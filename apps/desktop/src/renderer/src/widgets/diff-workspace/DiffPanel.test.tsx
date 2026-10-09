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

import { DiffPanel } from "./DiffPanel";
import { scrollWithinContainer } from "../../shared/lib/scrollWithinContainer";
import * as diffViewModel from "../../shared/model/diffViewModel";
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

const compactMultiHunkContent = [
  "@@ -4,7 +4,7 @@",
  " line 4",
  " line 5",
  " line 6",
  "-old line 7",
  "+new line 7",
  " line 8",
  " line 9",
  " line 10",
  "@@ -20,7 +20,7 @@",
  " line 20",
  " line 21",
  " line 22",
  "-old line 23",
  "+new line 23",
  " line 24",
  " line 25",
  " line 26"
].join("\n");

const expandedMultiHunkContent = [
  "@@ -1,29 +1,29 @@",
  " line 1",
  " line 2",
  " line 3",
  " line 4",
  " line 5",
  " line 6",
  "-old line 7",
  "+new line 7",
  " line 8",
  " line 9",
  " line 10",
  " line 11",
  " line 12",
  " line 13",
  " line 14",
  " line 15",
  " line 16",
  " line 17",
  " line 18",
  " line 19",
  " line 20",
  " line 21",
  " line 22",
  "-old line 23",
  "+new line 23",
  " line 24",
  " line 25",
  " line 26",
  " line 27",
  " line 28",
  " line 29"
].join("\n");

describe("DiffPanel configuration", () => {
  let container: HTMLDivElement;
  let root: Root;
  let createObjectUrlDescriptor:
    | PropertyDescriptor
    | undefined;
  let revokeObjectUrlDescriptor:
    | PropertyDescriptor
    | undefined;
  let createObjectUrlMock: ReturnType<typeof vi.fn>;
  let revokeObjectUrlMock: ReturnType<typeof vi.fn>;
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;

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
    scrollIntoViewMock = vi.fn();
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      {
        configurable: true,
        value: scrollIntoViewMock
      }
    );
    createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
      URL,
      "createObjectURL"
    );
    revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
      URL,
      "revokeObjectURL"
    );
    let objectUrlSequence = 0;
    createObjectUrlMock = vi.fn(
      () => `blob:media-preview-${++objectUrlSequence}`
    );
    revokeObjectUrlMock = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrlMock
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrlMock
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    if (createObjectUrlDescriptor) {
      Object.defineProperty(
        URL,
        "createObjectURL",
        createObjectUrlDescriptor
      );
    } else {
      Reflect.deleteProperty(URL, "createObjectURL");
    }
    if (revokeObjectUrlDescriptor) {
      Object.defineProperty(
        URL,
        "revokeObjectURL",
        revokeObjectUrlDescriptor
      );
    } else {
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
    vi.unstubAllGlobals();
  });

  it.each(["unified", "split"] as const)(
    "updates %s text and search hits after the same file refreshes",
    (layout) => {
      const props = {
        config: standaloneDiffWorkspaceConfiguration.document,
        scopeKey: `same-file-refresh-${layout}`,
        path: "src/App.tsx",
        preferredLayout: layout
      };
      act(() => root.render(<DiffPanel {...props} content={content} />));
      setInputValue(openDiffSearch(container), "updatedValue");
      expect(
        container.querySelectorAll(".diff-viewer-search-hit")
      ).toHaveLength(0);
      act(() =>
        root.render(
          <DiffPanel
            {...props}
            content={content.replace("newValue", "updatedValue")}
          />
        )
      );
      expect(container.textContent).toContain("updatedValue");
      expect(container.textContent).not.toContain("newValue");
      expect(
        container.querySelectorAll(".diff-viewer-search-hit")
      ).toHaveLength(1);
    }
  );

  it.each([
    ["unified", false],
    ["split", false],
    ["split", true]
  ] as const)(
    "does not revisit code text for %s wrap=%s navigation, context menus, or parent updates",
    (layout, wrap) => {
      const parse = diffViewModel.parseDiffViewModel;
      let codeReads = 0;
      const observeText = (record: { text: string }) => {
        const text = record.text;
        Object.defineProperty(record, "text", {
          get: () => { codeReads += 1; return text; }
        });
      };
      const parseSpy = vi.spyOn(diffViewModel, "parseDiffViewModel")
        .mockImplementation((source) => {
          const model = parse(source);
          model.unifiedLines
            .filter((line) => ["context", "added", "removed"].includes(line.kind))
            .forEach(observeText);
          model.splitRows.forEach((row) => {
            if (row.oldCell) observeText(row.oldCell);
            if (row.newCell) observeText(row.newCell);
          });
          return model;
        });
      const props = {
        config: standaloneDiffWorkspaceConfiguration.document,
        scopeKey: `stable-code-${layout}-${wrap}`,
        path: "src/long.ts",
        content: compactMultiHunkContent,
        preferredLayout: layout,
        preferredWrap: wrap
      };
      try {
        act(() => root.render(<DiffPanel {...props} onContextRequest={vi.fn()} />));
        setInputValue(openDiffSearch(container), "line");
        expect(codeReads).toBeGreaterThan(0);
        codeReads = 0;
        const parseCalls = parseSpy.mock.calls.length;
        act(() => container.querySelector<HTMLButtonElement>('[aria-label="下一个匹配"]')!.click());
        act(() => container.querySelector<HTMLButtonElement>('[aria-label="下一处变更"]')!.click());
        act(() => openHunkContextMenu(findHunkContextTrigger(container, 1, "expand")));
        expect(readHunkContextMenuItems()).toHaveLength(1);
        act(() => root.render(
          <DiffPanel {...props} headerActions={<button>Updated action</button>}
            onContextRequest={vi.fn()} />
        ));
        expect(codeReads).toBe(0);
        expect(parseSpy).toHaveBeenCalledTimes(parseCalls);
        expect(container.querySelectorAll(".diff-viewer-search-hit.current").length)
          .toBeGreaterThan(0);
        expect(container.querySelectorAll('.diff-viewer-wide-row.current[data-diff-viewer-hunk="1"]').length)
          .toBe(layout === "split" && !wrap ? 2 : 1);
      } finally {
        parseSpy.mockRestore();
      }
    }
  );

  it("keeps exactly the selected search mark across repeated matches, layout remounts, and loading", () => {
    const props = {
      config: standaloneDiffWorkspaceConfiguration.document,
      scopeKey: "selected-mark-remount",
      path: "src/matches.ts",
      content: "@@ -1 +1 @@\n-old old\n+new new",
      onContextRequest: vi.fn()
    };
    act(() => root.render(<DiffPanel {...props} preferredLayout="unified" />));
    setInputValue(openDiffSearch(container), "new");
    const currentIndices = () => Array.from(
      container.querySelectorAll(".diff-viewer-search-hit.current"),
      (mark) => mark.getAttribute("data-diff-viewer-search-hit")
    );
    expect(currentIndices()).toEqual(["0"]);
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="下一个匹配"]')!.click());
    expect(currentIndices()).toEqual(["1"]);
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="下一个匹配"]')!.click());
    expect(currentIndices()).toEqual(["0"]);
    act(() => root.render(<DiffPanel {...props} preferredLayout="split" />));
    expect(currentIndices()).toEqual(["0"]);
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="下一个匹配"]')!.click());
    act(() => root.render(<DiffPanel {...props} preferredLayout="split" preferredWrap />));
    expect(currentIndices()).toEqual(["1"]);
    act(() => root.render(<DiffPanel {...props} preferredLayout="split" preferredWrap
      state={{ busy: true, icon: "refresh", title: "Loading", message: "Loading" }} />));
    expect(currentIndices()).toEqual([]);
    act(() => root.render(<DiffPanel {...props} preferredLayout="split" preferredWrap />));
    expect(currentIndices()).toEqual(["1"]);
    act(() => root.render(<DiffPanel {...props} preferredLayout="split" preferredWrap
      content="@@ -1 +1 @@\n-old\n+new" />));
    expect(currentIndices()).toEqual(["0"]);
    act(() => root.render(<DiffPanel {...props} preferredLayout="split" preferredWrap content="" />));
    expect(currentIndices()).toEqual([]);
  });

  it("uses the refreshed compact hunk as the expansion and collapse baseline", () => {
    const props = {
      config: repositoryDiffWorkspaceConfiguration.document,
      scopeKey: "refresh-before-expand",
      path: "src/App.tsx",
      onContextRequest: vi.fn()
    };
    act(() =>
      root.render(<DiffPanel {...props} content={compactMultiHunkContent} />)
    );
    const compact = compactMultiHunkContent.replace("new line 7", "refreshed line 7");
    act(() =>
      root.render(<DiffPanel {...props} content={compact} />)
    );
    act(() => findHunkContextTrigger(container, 0, "expand").click());
    act(() =>
      root.render(
        <DiffPanel
          {...props}
          content={expandedMultiHunkContent.replace("new line 7", "refreshed line 7")}
          contextLines={10}
        />
      )
    );
    const visibleCodeLines = () =>
      Array.from(
        container.querySelectorAll(".diff-viewer-code-cell > code")
      ).map((element) => element.textContent);
    expect(visibleCodeLines()).toContain("line 1");
    expect(readHunkText(container, 0)).toContain("refreshed line 7");
    act(() => findHunkContextTrigger(container, 0, "collapse").click());
    expect(visibleCodeLines()).not.toContain("line 1");
    expect(readHunkText(container, 0)).toContain("refreshed line 7");
    expect(readHunkText(container, 0)).not.toContain("new line 7");
  });

  it.each([false, true])(
    "refreshes all hunks after context was expanded (collapsed: %s)",
    (collapsed) => {
      const props = {
        config: repositoryDiffWorkspaceConfiguration.document,
        scopeKey: `expanded-refresh-${collapsed}`,
        path: "src/App.tsx",
        onContextRequest: vi.fn()
      };
      act(() =>
        root.render(<DiffPanel {...props} content={compactMultiHunkContent} />)
      );
      act(() => findHunkContextTrigger(container, 0, "expand").click());
      act(() =>
        root.render(
          <DiffPanel {...props} content={expandedMultiHunkContent} contextLines={10} />
        )
      );
      if (collapsed) {
        act(() => findHunkContextTrigger(container, 0, "collapse").click());
      }
      const refreshed = expandedMultiHunkContent
        .replace("new line 7", "latest first change")
        .replace("new line 23", "latest second change");
      act(() =>
        root.render(<DiffPanel {...props} content={refreshed} contextLines={10} />)
      );
      expect(readHunkText(container, 0)).toContain("latest first change");
      expect(readHunkText(container, 1)).toContain("latest second change");
      expect(container.textContent).not.toContain("new line 7");
      expect(container.textContent).not.toContain("new line 23");
      expect(
        container.querySelectorAll('[aria-label^="收起第"]')
      ).toHaveLength(0);
      expect(
        Array.from(container.querySelectorAll(".diff-viewer-code-cell > code"))
          .map((element) => element.textContent)
      ).not.toContain("line 1");
      // The expanded source is still cached and can expand the new revision
      // without another IPC read.
      act(() => findHunkContextTrigger(container, 1, "expand").click());
      expect(readHunkText(container, 1)).toContain("line 15");
      expect(readHunkText(container, 1)).toContain("latest second change");
      expect(props.onContextRequest).toHaveBeenCalledTimes(1);
    }
  );

  it.each(["unified", "split"] as const)(
    "refreshes %s content and context actions after unrelated toolbar updates",
    (layout) => {
      const oldRequest = vi.fn();
      const nextRequest = vi.fn();
      const props = {
        config: standaloneDiffWorkspaceConfiguration.document,
        scopeKey: `refresh-${layout}`,
        path: "src/App.tsx",
        content,
        preferredLayout: layout,
        onContextRequest: oldRequest
      };
      act(() => root.render(<DiffPanel {...props} />));
      act(() => root.render(<DiffPanel {...props} searchOpen />));
      const nextContent = content.replaceAll("newValue", "updatedValue");
      act(() =>
        root.render(
          <DiffPanel
            {...props}
            content={nextContent}
            onContextRequest={nextRequest}
            scopeKey={`next-${layout}`}
            searchOpen
          />
        )
      );
      expect(container.textContent).toContain("updatedValue");
      expect(container.textContent).not.toContain("newValue");
      act(() => findHunkContextTrigger(container, 0, "expand").click());
      expect(nextRequest).toHaveBeenCalledWith({
        direction: "around",
        hunkIndex: 0,
        contextLines: 10
      });
      expect(oldRequest).not.toHaveBeenCalled();
    }
  );

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

  it("opens controlled search even when global shortcuts are disabled", () => {
    const onSearchOpenChange = vi.fn();
    act(() => {
      root.render(
        <DiffPanel
          config={repositoryDiffWorkspaceConfiguration.document}
          content={content}
          keyboardShortcutsEnabled={false}
          onSearchOpenChange={onSearchOpenChange}
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
          searchOpen
        />
      );
    });

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="搜索文本"]'
    );
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          ctrlKey: true,
          key: "f"
        })
      );
    });
    expect(onSearchOpenChange).not.toHaveBeenCalledWith(true);
  });

  it("focuses the added side of a replacement line and scrolls it into view", () => {
    act(() => {
      root.render(
        <DiffPanel
          config={repositoryDiffWorkspaceConfiguration.document}
          content={content}
          focusLine={1}
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
        />
      );
    });

    const focusedRows = container.querySelectorAll<HTMLElement>(
      '[data-diff-viewer-focus-line="true"]'
    );
    expect(focusedRows).toHaveLength(1);
    expect(focusedRows[0]?.textContent).toContain(
      "const newValue = true;"
    );
    expect(focusedRows[0]?.getAttribute("aria-current")).toBe(
      "location"
    );
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    const scroll = vi.mocked(HTMLElement.prototype.scrollTo);
    expect(scroll.mock.instances).toContain(container.querySelector(".diff-viewer-code"));
  });

  it("reveals nested split-diff matches without scrolling the surrounding page", () => {
    const boundary = document.createElement("div");
    const vertical = document.createElement("div");
    const horizontal = document.createElement("div");
    const target = document.createElement("mark");
    container.append(boundary);
    boundary.append(vertical);
    vertical.append(horizontal);
    horizontal.append(target);
    vertical.style.overflowY = "auto";
    horizontal.style.overflowX = "auto";
    Object.defineProperties(vertical, {
      scrollHeight: { value: 1000 }, clientHeight: { value: 200 },
      clientWidth: { value: 300 }
    });
    Object.defineProperties(horizontal, {
      scrollWidth: { value: 1000 }, clientWidth: { value: 300 }
    });
    boundary.getBoundingClientRect = () => new DOMRect(0, 100, 300, 200);
    vertical.getBoundingClientRect = () => new DOMRect(0, 100, 300, 200);
    horizontal.getBoundingClientRect = () => new DOMRect(0, 100, 300, 1000);
    target.getBoundingClientRect = () => new DOMRect(
      800 - horizontal.scrollLeft, 900 - vertical.scrollTop, 30, 20
    );
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollTo")
      .mockImplementation(function (this: HTMLElement, options: ScrollToOptions | number) {
        if (typeof options === "object") {
          this.scrollTop = options.top ?? this.scrollTop;
          this.scrollLeft = options.left ?? this.scrollLeft;
        }
      });
    container.scrollTop = 73;
    scrollWithinContainer(boundary, target);
    expect(horizontal.scrollLeft).toBe(530);
    expect(vertical.scrollTop).toBe(710);
    expect(container.scrollTop).toBe(73);
    expect(scroll.mock.instances).not.toContain(container);
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    scroll.mockClear();
    scrollWithinContainer(boundary, container);
    scrollWithinContainer(boundary, boundary);
    expect(scroll).not.toHaveBeenCalled();
    scroll.mockRestore();
  });

  it("renders a diff-shaped skeleton while content is loading", () => {
    act(() => {
      root.render(
        <DiffPanel
          config={repositoryDiffWorkspaceConfiguration.document}
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
          statsAvailable={false}
          state={{
            busy: true,
            icon: "refresh",
            message: "正在读取所选文件内容。",
            title: "读取 Diff…"
          }}
        />
      );
    });

    const region = container.querySelector<HTMLElement>(
      '[role="region"][aria-label="文件 Diff"]'
    );
    expect(region?.getAttribute("aria-busy")).toBe("true");
    expect(
      region?.querySelector(".diff-content-skeleton")
    ).not.toBeNull();
    expect(
      region?.querySelectorAll(
        ".diff-workspace-skeleton-code-row"
      )
    ).toHaveLength(10);
    expect(container.textContent).not.toContain("读取 Diff…");
  });

  it("adapts the loading placeholder when switching between split and unified views", () => {
    const renderLoading = (layout: "split" | "unified") => {
      act(() => {
        root.render(
          <DiffPanel
            config={standaloneDiffWorkspaceConfiguration.document}
            path="src/App.tsx"
            preferredLayout={layout}
            scopeKey="unstaged:src/App.tsx"
            state={{ busy: true, icon: "refresh", title: "读取 Diff", message: "加载中" }}
          />
        );
      });
    };
    renderLoading("split");
    expect(container.querySelector(".diff-content-skeleton")?.getAttribute("data-layout")).toBe("split");
    expect(container.querySelectorAll(".diff-content-skeleton-pane")).toHaveLength(2);
    renderLoading("unified");
    expect(container.querySelectorAll(".diff-content-skeleton-pane")).toHaveLength(1);
  });

  it("shows stats and their separator only when available without an empty placeholder", () => {
    act(() => {
      root.render(
        <DiffPanel
          config={repositoryDiffWorkspaceConfiguration.document}
          emptyStatsLabel=""
          headerActions={
            <button type="button">打开独立 Diff</button>
          }
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
          statsAvailable={false}
          state={{
            busy: true,
            icon: "refresh",
            message: "正在读取所选文件内容。",
            title: "读取 Diff…"
          }}
        />
      );
    });

    expect(
      container.querySelector(".diff-viewer-stats.muted")
    ).toBeNull();
    expect(container.querySelector(".diff-viewer-stats-slot")).toBeNull();
    expect(container.querySelector(".diff-viewer-file-header-separator")).toBeNull();
    expect(findButton(container, "打开独立 Diff")).toBeDefined();
    act(() => {
      root.render(
        <DiffPanel
          config={repositoryDiffWorkspaceConfiguration.document}
          emptyStatsLabel=""
          headerActions={<button type="button">打开独立 Diff</button>}
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
          statsAvailable
          additions={12345678}
          deletions={4}
          content={content}
        />
      );
    });
    expect(container.querySelector(".diff-viewer-stats-slot")).toBeNull();
    expect(container.querySelector(".diff-viewer-stats")
      ?.getAttribute("title")).toBe("新增 12345678 行，删除 4 行");
    expect(container.querySelector<HTMLElement>(".diff-viewer-file-header-separator")
      ?.style.visibility).toBe("");
  });

  it("remembers search queries for each repository scope", () => {
    const renderPanel = (
      scopeKey: string,
      searchScopeKey: string
    ) => {
      act(() => {
        root.render(
          <DiffPanel
            config={repositoryDiffWorkspaceConfiguration.document}
            content={content}
            path="src/App.tsx"
            scopeKey={scopeKey}
            searchScopeKey={searchScopeKey}
          />
        );
      });
    };
    const renderSkeleton = () => {
      act(() => {
        root.render(
          <div data-testid="repository-loading" />
        );
      });
    };

    renderPanel("unstaged:src/App.tsx", "repository-a");
    const repositoryAInput = openDiffSearch(container);
    setInputValue(repositoryAInput, "first repository");

    renderSkeleton();
    renderPanel("unstaged:src/App.tsx", "repository-b");
    const repositoryBInput = openDiffSearch(container);
    expect(repositoryBInput.value).toBe("");
    setInputValue(repositoryBInput, "second repository");

    renderSkeleton();
    renderPanel("unstaged:src/Other.tsx", "repository-a");
    expect(openDiffSearch(container).value).toBe(
      "first repository"
    );

    renderSkeleton();
    renderPanel("unstaged:src/App.tsx", "repository-b");
    expect(openDiffSearch(container).value).toBe(
      "second repository"
    );
  });

  it("toggles ten context lines around only the selected hunk", () => {
    const onContextRequest = vi.fn();

    act(() => {
      root.render(
        <DiffPanel
          additions={1}
          config={repositoryDiffWorkspaceConfiguration.document}
          content={compactMultiHunkContent}
          contextLines={3}
          deletions={1}
          onContextRequest={onContextRequest}
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
        />
      );
    });

    act(() => {
      findHunkContextTrigger(container, 1, "expand").click();
    });
    expect(onContextRequest).toHaveBeenCalledWith({
      direction: "around",
      hunkIndex: 1,
      contextLines: 10
    });

    act(() => {
      root.render(
        <DiffPanel
          additions={1}
          config={repositoryDiffWorkspaceConfiguration.document}
          content={expandedMultiHunkContent}
          contextLines={10}
          deletions={1}
          onContextRequest={onContextRequest}
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
        />
      );
    });
    expect(readHunkText(container, 0)).not.toContain("line 15");
    expect(readHunkText(container, 1)).toContain("line 15");

    act(() => {
      findHunkContextTrigger(container, 1, "collapse").click();
    });
    expect(onContextRequest).toHaveBeenCalledTimes(1);
    expect(readHunkText(container, 0)).not.toContain("line 15");
    expect(readHunkText(container, 1)).not.toContain("line 15");
    expect(container.textContent).not.toContain("展开本段");
  });

  it("offers one right-click action for full or compact hunk context", () => {
    const onContextRequest = vi.fn();

    act(() => {
      root.render(
        <DiffPanel
          additions={1}
          config={repositoryDiffWorkspaceConfiguration.document}
          content={compactMultiHunkContent}
          contextLines={3}
          deletions={1}
          onContextRequest={onContextRequest}
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
        />
      );
    });

    act(() => {
      openHunkContextMenu(
        findHunkContextTrigger(container, 0, "expand")
      );
    });
    expect(readHunkContextMenuItems()).toHaveLength(1);
    expect(readHunkContextMenuItems()[0]?.textContent).toContain(
      "展开全部"
    );

    act(() => {
      readHunkContextMenuItems()[0]?.click();
    });
    expect(onContextRequest).toHaveBeenLastCalledWith({
      direction: "all",
      hunkIndex: 0,
      contextLines: 100_000
    });
    expect(readHunkContextMenuItems()).toHaveLength(0);
    expect(document.activeElement).toBe(
      container.querySelector(
        '[role="region"][aria-label="文件 Diff"]'
      )
    );

    act(() => {
      root.render(
        <DiffPanel
          additions={1}
          config={repositoryDiffWorkspaceConfiguration.document}
          content={expandedMultiHunkContent}
          contextLines={100_000}
          deletions={1}
          onContextRequest={onContextRequest}
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
        />
      );
    });
    expect(document.activeElement).toBe(
      findHunkContextTrigger(container, 0, "collapse")
    );

    act(() => {
      openHunkContextMenu(
        findHunkContextTrigger(container, 0, "collapse")
      );
    });
    expect(readHunkContextMenuItems()).toHaveLength(1);
    expect(readHunkContextMenuItems()[0]?.textContent).toContain(
      "恢复精简"
    );

    act(() => {
      readHunkContextMenuItems()[0]?.click();
    });
    expect(onContextRequest).toHaveBeenCalledTimes(1);
    expect(
      findHunkContextTrigger(container, 0, "expand")
    ).toBeDefined();
    expect(document.activeElement).toBe(
      findHunkContextTrigger(container, 0, "expand")
    );

    act(() => {
      root.render(
        <DiffPanel
          additions={1}
          config={repositoryDiffWorkspaceConfiguration.document}
          content={compactMultiHunkContent}
          contextLines={3}
          deletions={1}
          onContextRequest={onContextRequest}
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
        />
      );
    });

    act(() => {
      findHunkContextTrigger(container, 1, "expand").click();
    });
    expect(onContextRequest).toHaveBeenLastCalledWith({
      direction: "around",
      hunkIndex: 1,
      contextLines: 10
    });

    act(() => {
      openHunkContextMenu(
        findHunkContextTrigger(container, 1, "collapse")
      );
    });
    expect(readHunkContextMenuItems()).toHaveLength(1);
    expect(readHunkContextMenuItems()[0]?.textContent).toContain(
      "展开全部"
    );
  });

  it("closes only the hunk context menu when Escape is pressed", () => {
    act(() => {
      root.render(
        <DiffPanel
          config={repositoryDiffWorkspaceConfiguration.document}
          content={compactMultiHunkContent}
          onContextRequest={vi.fn()}
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
        />
      );
    });

    const searchInput = openDiffSearch(container);
    const trigger = findHunkContextTrigger(
      container,
      0,
      "expand"
    );
    act(() => {
      openHunkContextMenu(trigger);
    });
    const menuItem = readHunkContextMenuItems()[0];
    expect(document.activeElement).toBe(menuItem);

    act(() => {
      menuItem?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Escape"
        })
      );
    });

    expect(readHunkContextMenuItems()).toHaveLength(0);
    expect(
      container.querySelector('input[aria-label="搜索文本"]')
    ).toBe(searchInput);
    expect(document.activeElement).toBe(trigger);
  });

  it("dismisses a hunk context menu when its diff becomes stale", () => {
    const renderPanel = ({
      content = compactMultiHunkContent,
      truncated = false
    }: {
      content?: string;
      truncated?: boolean;
    } = {}) => {
      act(() => {
        root.render(
          <DiffPanel
            config={repositoryDiffWorkspaceConfiguration.document}
            content={content}
            onContextRequest={vi.fn()}
            path="src/App.tsx"
            scopeKey="unstaged:src/App.tsx"
            truncated={truncated}
          />
        );
      });
    };

    renderPanel();
    act(() => {
      openHunkContextMenu(
        findHunkContextTrigger(container, 0, "expand")
      );
    });
    expect(readHunkContextMenuItems()).toHaveLength(1);

    renderPanel({
      content: compactMultiHunkContent.replace(
        "@@ -4,7 +4,7 @@",
        "@@ -5,7 +5,7 @@"
      )
    });
    expect(readHunkContextMenuItems()).toHaveLength(0);

    act(() => {
      openHunkContextMenu(
        findHunkContextTrigger(container, 0, "expand")
      );
    });
    expect(readHunkContextMenuItems()).toHaveLength(1);

    renderPanel({
      content: compactMultiHunkContent.replace(
        "@@ -4,7 +4,7 @@",
        "@@ -5,7 +5,7 @@"
      ),
      truncated: true
    });
    expect(readHunkContextMenuItems()).toHaveLength(0);
  });

  it("does not expose context expansion for binary or truncated diffs", () => {
    act(() => {
      root.render(
        <DiffPanel
          binary
          config={repositoryDiffWorkspaceConfiguration.document}
          content={content}
          onContextRequest={vi.fn()}
          path="src/App.bin"
          scopeKey="unstaged:src/App.bin"
        />
      );
    });
    expect(
      container.querySelector(".diff-viewer-hunk-trigger")
    ).toBeNull();

    act(() => {
      root.render(
        <DiffPanel
          config={repositoryDiffWorkspaceConfiguration.document}
          content={content}
          onContextRequest={vi.fn()}
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
          truncated
        />
      );
    });
    expect(
      container.querySelector(".diff-viewer-hunk-trigger")
    ).toBeNull();
  });

  it("renders SVG as an image preview and hides text-only controls", () => {
    act(() => {
      root.render(
        <DiffPanel
          additions={2}
          config={standaloneDiffWorkspaceConfiguration.document}
          content={"<svg></svg>"}
          deletions={1}
          media={{
            status: "available",
            kind: "image",
            mimeType: "image/svg+xml",
            size: 11,
            content: new TextEncoder().encode("<svg></svg>")
          }}
          path="assets/diagram.svg"
          scopeKey="unstaged:assets/diagram.svg"
        />
      );
    });

    const image = container.querySelector<HTMLImageElement>(
      ".diff-viewer-media img"
    );
    expect(image?.getAttribute("src")).toBe(
      "blob:media-preview-1"
    );
    expect(image?.alt).toBe(
      "assets/diagram.svg 图片预览"
    );
    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector(".diff-viewer-toolbar")
    ).toBeNull();
    expect(
      container.querySelector(".diff-viewer-unified")
    ).toBeNull();
    expect(
      container.querySelector('[aria-label="文件预览"]')
    ).not.toBeNull();

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
        'input[aria-label="搜索文本"]'
      )
    ).toBeNull();
  });

  it("uses native non-autoplay video and audio controls", () => {
    act(() => {
      root.render(
        <DiffPanel
          config={standaloneDiffWorkspaceConfiguration.document}
          media={{
            status: "available",
            kind: "video",
            mimeType: "video/mp4",
            size: 4,
            content: new Uint8Array([0, 1, 2, 3])
          }}
          path="assets/demo.mp4"
          scopeKey="unstaged:assets/demo.mp4"
        />
      );
    });

    const video =
      container.querySelector<HTMLVideoElement>("video");
    expect(video?.controls).toBe(true);
    expect(video?.autoplay).toBe(false);

    act(() => {
      root.render(
        <DiffPanel
          config={standaloneDiffWorkspaceConfiguration.document}
          media={{
            status: "available",
            kind: "audio",
            mimeType: "audio/mpeg",
            size: 3,
            content: new Uint8Array([4, 5, 6])
          }}
          path="assets/demo.mp3"
          scopeKey="unstaged:assets/demo.mp3"
        />
      );
    });

    const audio =
      container.querySelector<HTMLAudioElement>("audio");
    expect(audio?.controls).toBe(true);
    expect(audio?.autoplay).toBe(false);
    expect(revokeObjectUrlMock).toHaveBeenCalledWith(
      "blob:media-preview-1"
    );
  });

  it("does not carry a failed media preview into the first frame of a new file", () => {
    const failures: boolean[] = [];
    const renderMedia = (path: string) => {
      act(() => {
        root.render(
          <Profiler id="media-preview" onRender={() => {
            failures.push(Boolean(container.textContent?.includes("媒体预览失败")));
          }}>
            <DiffPanel config={standaloneDiffWorkspaceConfiguration.document}
              scopeKey={`unstaged:${path}`} path={path}
              media={{status:"available",kind:"image",mimeType:"image/png",
                size:3,content:new Uint8Array([1,2,3])}} />
          </Profiler>
        );
      });
    };
    renderMedia("first.png");
    act(() => { container.querySelector("img")!.dispatchEvent(new Event("error")); });
    expect(container.textContent).toContain("媒体预览失败");
    failures.length = 0;
    renderMedia("second.png");
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.every(failed => !failed)).toBe(true);
    expect(container.querySelector("img")?.alt).toBe("second.png 图片预览");
  });

  it("explains why an oversized media file is unavailable", () => {
    act(() => {
      root.render(
        <DiffPanel
          config={repositoryDiffWorkspaceConfiguration.document}
          media={{
            status: "unavailable",
            kind: "video",
            mimeType: "video/mp4",
            reason: "too-large",
            size: 50 * 1024 * 1024 + 1
          }}
          path="assets/demo.mp4"
          scopeKey="untracked:assets/demo.mp4"
        />
      );
    });

    expect(container.textContent).toContain("文件过大");
    expect(container.textContent).toContain("50 MB");
    expect(container.textContent).toContain("外部应用");
    expect(createObjectUrlMock).not.toHaveBeenCalled();
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

function openDiffSearch(root: ParentNode): HTMLInputElement {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        ctrlKey: true,
        key: "f"
      })
    );
  });
  const input = root.querySelector<HTMLInputElement>(
    'input[aria-label="搜索文本"]'
  );
  if (!input) {
    throw new Error("Diff search input was not rendered.");
  }
  return input;
}

function setInputValue(
  input: HTMLInputElement,
  value: string
): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(
      new Event("input", { bubbles: true })
    );
  });
}

function findHunkContextTrigger(
  root: ParentNode,
  hunkIndex: number,
  action: "expand" | "collapse"
): HTMLButtonElement {
  const label =
    action === "expand"
      ? `展开第 ${hunkIndex + 1} 个变更块上下各 10 行`
      : `收起第 ${hunkIndex + 1} 个变更块上下文`;
  const trigger = root.querySelector<HTMLButtonElement>(
    `[aria-label="${label}"]`
  );
  if (!trigger) {
    throw new Error(
      `Hunk context trigger not found: ${action} ${hunkIndex}`
    );
  }
  return trigger;
}

function openHunkContextMenu(trigger: HTMLButtonElement): void {
  trigger.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      clientX: 120,
      clientY: 80
    })
  );
}

function readHunkContextMenuItems(): HTMLButtonElement[] {
  return Array.from(
    document.body.querySelectorAll<HTMLButtonElement>(
      ".diff-hunk-context-menu [role='menuitem']"
    )
  );
}

function readHunkText(
  root: ParentNode,
  hunkIndex: number
): string {
  const hunk = root.querySelector<HTMLElement>(
    `[data-diff-viewer-hunk="${hunkIndex}"]`
  );
  if (!hunk) {
    throw new Error(`Hunk not found: ${hunkIndex}`);
  }

  const parts = [hunk.textContent ?? ""];
  let sibling = hunk.nextElementSibling;
  while (
    sibling &&
    !sibling.hasAttribute("data-diff-viewer-hunk")
  ) {
    parts.push(sibling.textContent ?? "");
    sibling = sibling.nextElementSibling;
  }
  return parts.join("\n");
}
