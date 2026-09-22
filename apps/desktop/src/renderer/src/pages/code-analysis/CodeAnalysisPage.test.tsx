/** @vitest-environment jsdom */

import React, { act } from "react";
import {
  createRoot,
  type Root
} from "react-dom/client";
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
  LANGUAGE_SERVER_LANGUAGES,
  type CodeAnalysisSnapshotDto,
  type GitNestBridge,
  type LanguageServerLanguageDto
} from "@gitnest/contracts";

import type { CodeAnalysisController } from "../../entities/code-analysis/useCodeAnalysis";
import { CodeAnalysisPage } from "./CodeAnalysisPage";

const analysisMock = vi.hoisted(() => ({
  controller: null as CodeAnalysisController | null
}));

const languageServerNames: Record<
  LanguageServerLanguageDto,
  string
> = {
  typescript: "TypeScript",
  vue: "Vue",
  java: "Java",
  python: "Python",
  go: "Go",
  kotlin: "Kotlin",
  csharp: "C#",
  rust: "Rust"
};

vi.mock(
  "../../entities/code-analysis/useCodeAnalysis",
  () => ({
    useCodeAnalysis: () => analysisMock.controller
  })
);

describe("CodeAnalysisPage relationship graph workspace", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    Object.defineProperties(Element.prototype, {
      setPointerCapture: {
        configurable: true,
        value: vi.fn()
      },
      hasPointerCapture: {
        configurable: true,
        value: () => true
      },
      releasePointerCapture: {
        configurable: true,
        value: vi.fn()
      },
      scrollIntoView: {
        configurable: true,
        value: vi.fn()
      },
      scrollTo: {
        configurable: true,
        value: vi.fn()
      }
    });
    analysisMock.controller = createController();
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
      .querySelectorAll(".toast-viewport")
      .forEach((element) => element.remove());
    analysisMock.controller = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps actions on the title row and reuses shared page margins", async () => {
    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    const page = container.querySelector(".code-analysis-page");
    const header = container.querySelector(
      ".analysis-page-header"
    );
    const titleRow = header?.querySelector(
      ".analysis-page-title-row"
    );

    expect(page?.classList.contains("page-scroll")).toBe(true);
    expect(titleRow?.querySelector("h1")?.textContent).toBe(
      "代码分析"
    );
    expect(header?.querySelector(".eyebrow")).toBeNull();
    expect(header?.textContent).not.toContain(
      "Workspace 代码智能"
    );
    expect(
      titleRow?.querySelector(".analysis-header-actions")
    ).not.toBeNull();
    expect(header?.lastElementChild?.tagName).toBe("P");
  });

  it("uses the same code-node count in the summary and navigation tab", async () => {
    const base = createSnapshot();
    const snapshot: CodeAnalysisSnapshotDto = {
      ...base,
      nodes: [
        {
          ...base.nodes[0]!,
          id: "file-node",
          kind: "file",
          name: "caller.ts",
          qualifiedName: "src/caller.ts"
        },
        ...base.nodes
      ],
      stats: {
        ...base.stats,
        analyzedFiles: 1,
        symbolCount: 2
      }
    };
    analysisMock.controller = createController(snapshot);

    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    const summaryCard = Array.from(
      container.querySelectorAll(".analysis-summary-card")
    ).find(
      (card) =>
        card.querySelector("span")?.textContent === "代码节点"
    );
    const navigationTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '.analysis-navigation-tabs [role="tab"]'
      )
    ).find((tab) => tab.textContent?.includes("代码节点"));

    expect(
      summaryCard?.querySelector("strong")?.textContent
    ).toBe("3");
    expect(
      navigationTab?.querySelector("span")?.textContent
    ).toBe("3");
  });

  it("limits code-node results without rendering a truncation notice", async () => {
    const base = createSnapshot();
    const nodes = Array.from({ length: 121 }, (_, index) => ({
      ...base.nodes[0]!,
      id: `node-${index}`,
      name: `Node ${index}`,
      qualifiedName: `Fixture.Node${index}`,
      location: {
        ...base.nodes[0]!.location,
        path: `src/node-${index}.ts`
      }
    }));
    analysisMock.controller = createController({
      ...base,
      nodes,
      edges: [],
      stats: {
        ...base.stats,
        symbolCount: nodes.length,
        edgeCount: 0
      }
    });

    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    expect(
      container.querySelectorAll(".analysis-symbol-result")
    ).toHaveLength(120);
    expect(container.textContent).not.toContain(
      "仅显示前 120 个匹配节点"
    );

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="搜索代码节点"]'
    );
    if (!input) {
      throw new Error("Code-node search input was not rendered.");
    }
    await act(async () => {
      setInputValue(input, "Node 120");
      await flushAsyncWork();
    });

    expect(
      container.querySelectorAll(".analysis-symbol-result")
    ).toHaveLength(1);
  });

  it("shows qualified class member names and renders their containment graph", async () => {
    const base = createSnapshot();
    const nestedClass = {
      ...base.nodes[0]!,
      id: "flag",
      kind: "class" as const,
      name: "Flag",
      qualifiedName: "ScProfDef.Flag",
      language: "java" as const,
      location: {
        ...base.nodes[0]!.location,
        path: "src/main/java/fai/app/ScProfDef.java",
        line: 28
      }
    };
    const property = {
      ...base.nodes[0]!,
      id: "open-guide",
      kind: "property" as const,
      name: "OPEN_GUIDE",
      qualifiedName: "ScProfDef.Flag.OPEN_GUIDE",
      language: "java" as const,
      location: {
        ...base.nodes[0]!.location,
        path: "src/main/java/fai/app/ScProfDef.java",
        line: 29
      }
    };
    analysisMock.controller = createController({
      ...base,
      nodes: [nestedClass, property],
      edges: [
        {
          id: "flag-open-guide",
          from: nestedClass.id,
          to: property.id,
          kind: "contains",
          confidence: "exact"
        }
      ],
      requestChains: [],
      stats: {
        ...base.stats,
        symbolCount: 2,
        edgeCount: 1,
        requestChainCount: 0
      }
    });

    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    expect(
      Array.from(
        container.querySelectorAll(
          ".analysis-symbol-result strong"
        )
      ).map((element) => element.textContent)
    ).toEqual(
      expect.arrayContaining([
        "ScProfDef.Flag",
        "ScProfDef.Flag.OPEN_GUIDE"
      ])
    );
    expect(
      container.querySelector(
        ".analysis-graph-panel .analysis-panel-heading span"
      )?.textContent
    ).toBe("ScProfDef.Flag 的上下游");
    expect(
      container.querySelector(".edge-contains")
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[aria-label="property ScProfDef.Flag.OPEN_GUIDE"] .analysis-node-name'
      )?.textContent
    ).toBe("ScProfDef.Flag.OPEN_GUIDE");
  });

  it("offers managed installation for every supported LSP", async () => {
    const snapshot = {
      ...createSnapshot(),
      languageServers: LANGUAGE_SERVER_LANGUAGES.map(
        (language) => ({
          language,
          state:
            language === "python"
              ? ("disabled" as const)
              : ("unavailable" as const),
          command: `${language}-language-server`,
          message: `${language} Language Server 未安装。`,
          symbolCount: 0
        })
      )
    };
    const controller = createController(snapshot);
    controller.installLanguageServer = vi.fn(
      async (language) => ({
        language,
        status: "installed" as const,
        command: `C:\\GitNest\\runtime\\lsp\\servers\\${language}\\server.exe`,
        message: `${language} Language Server 已安装。`
      })
    );
    analysisMock.controller = controller;
    const reloadSettings = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={reloadSettings}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    for (const language of LANGUAGE_SERVER_LANGUAGES.filter(
      (language) => language !== "python"
    )) {
      expect(
        container.querySelector(
          `[aria-label="安装 ${languageServerNames[language]} Language Server"]`
        )
      ).not.toBeNull();
    }
    const installButton =
      container.querySelector<HTMLButtonElement>(
        '[aria-label="安装并启用 Python Language Server"]'
      );
    expect(installButton).not.toBeNull();
    expect(
      container.querySelector(
        '[aria-label^="配置 "]'
      )
    ).toBeNull();

    await act(async () => {
      installButton?.click();
      await flushAsyncWork();
    });

    expect(
      controller.installLanguageServer
    ).toHaveBeenCalledWith("python");
    expect(reloadSettings).toHaveBeenCalledOnce();
    expect(controller.start).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "请手动运行代码分析以使用该服务。"
    );
    expect(document.body.textContent).not.toContain(
      "正在重新运行代码分析。"
    );
  });

  it("does not offer installation when an enabled LSP only has no matching files", async () => {
    const snapshot = {
      ...createSnapshot(),
      languageServers: [
        {
          language: "typescript" as const,
          state: "disabled" as const,
          command: "typescript-language-server",
          message: "当前范围没有对应语言文件。",
          symbolCount: 0
        }
      ]
    };
    analysisMock.controller = createController(snapshot);

    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    expect(
      container.querySelector(
        '[aria-label="安装并启用 TypeScript Language Server"]'
      )
    ).toBeNull();
  });

  it("shows a layout-matched skeleton while the initial analysis state loads", async () => {
    const controller = createController();
    controller.state = {
      state: "idle",
      snapshotAvailable: false
    };
    controller.snapshot = null;
    controller.loading = true;
    analysisMock.controller = controller;

    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    const skeleton = container.querySelector(
      '[role="status"][aria-label="正在读取代码分析"]'
    );
    expect(skeleton).not.toBeNull();
    expect(
      skeleton?.classList.contains("analysis-page-skeleton")
    ).toBe(true);
    expect(
      skeleton?.querySelectorAll(
        ".analysis-skeleton-summary-card"
      )
    ).toHaveLength(5);
    expect(
      skeleton?.querySelectorAll(
        ".analysis-skeleton-graph-node"
      )
    ).toHaveLength(7);
    expect(
      container.querySelector(".analysis-empty-state")
    ).toBeNull();
    expect(container.textContent).not.toContain(
      "正在读取代码分析状态"
    );
  });

  it("replaces the empty state with full-page progress as soon as analysis starts", async () => {
    vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2026-09-21T12:00:00.000Z")
    );
    const controller = createController();
    controller.state = {
      state: "idle",
      snapshotAvailable: false
    };
    controller.snapshot = null;
    controller.action = "starting";
    analysisMock.controller = controller;

    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    const startingProgress = container.querySelector(
      '[aria-label="代码分析进度"]'
    );
    expect(
      startingProgress?.classList.contains(
        "analysis-progress-empty-state"
      )
    ).toBe(true);
    expect(startingProgress?.textContent).toContain(
      "正在启动代码分析"
    );
    expect(startingProgress?.textContent).toContain(
      "执行时间 00:00"
    );
    expect(container.textContent).not.toContain(
      "尚未生成代码关系索引"
    );
    expect(
      startingProgress
        ?.querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow")
    ).toBe("0");

    controller.action = null;
    controller.state = {
      state: "running",
      snapshotAvailable: false,
      analysisId: "running-analysis",
      workspaceId: "workspace",
      entryId: "entry",
      entryName: "Entry",
      scope: "workspace",
      startedAt: "2026-09-21T11:58:55.000Z",
      progress: {
        stage: "parsing",
        completed: 3,
        total: 10,
        message: "正在解析源码"
      }
    };
    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    const runningProgress = container.querySelector(
      '[aria-label="代码分析进度"]'
    );
    expect(
      container.querySelectorAll(
        '[aria-label="代码分析进度"]'
      )
    ).toHaveLength(1);
    expect(runningProgress?.textContent).toContain("建立索引");
    expect(runningProgress?.textContent).toContain(
      "正在解析源码"
    );
    expect(runningProgress?.textContent).toContain("3/10");
    expect(runningProgress?.textContent).toContain(
      "执行时间 01:05"
    );
    expect(
      runningProgress
        ?.querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow")
    ).toBe("30");
  });

  it("keeps an existing analysis visible while reanalysis progress runs", async () => {
    const snapshot: CodeAnalysisSnapshotDto = {
      ...createSnapshot(),
      scope: "changed"
    };
    const controller = createController(snapshot);
    controller.state = {
      ...controller.state,
      state: "running",
      scope: "changed",
      progress: {
        stage: "linking",
        completed: 1,
        total: 2,
        message: "正在解析调用关系"
      }
    };
    analysisMock.controller = controller;

    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    const progressPanel = container.querySelector(
      '[aria-label="代码分析进度"]'
    );
    expect(
      container.querySelector(".analysis-summary-grid")
    ).not.toBeNull();
    expect(
      progressPanel?.classList.contains(
        "analysis-progress-empty-state"
      )
    ).toBe(false);
    expect(progressPanel?.textContent).toContain(
      "正在解析调用关系"
    );
  });

  it("shows the original analysis time as the leftmost runtime detail", async () => {
    const snapshot = createSnapshot();
    analysisMock.controller = createController(snapshot);
    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    const details = Array.from(
      container.querySelector(
        ".analysis-runtime-strip"
      )?.children ?? []
    ).map((element) => element.textContent?.trim());
    expect(details.slice(0, 3)).toEqual([
      `分析时间 ${new Date(
        snapshot.generatedAt
      ).toLocaleString()}`,
      "全部代码",
      "耗时 1 ms"
    ]);
  });

  it("switches analysis scopes without showing the previous scope snapshot", async () => {
    const controller = createController();
    analysisMock.controller = controller;
    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    const changedScope = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".analysis-scope-switch button"
      )
    ).find((button) => button.textContent === "变动代码");
    const workspaceScope = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".analysis-scope-switch button"
      )
    ).find((button) => button.textContent === "全部代码");

    expect(workspaceScope?.getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(
      container.querySelector(".analysis-summary-grid")
    ).not.toBeNull();

    await act(async () => {
      changedScope?.click();
      await flushAsyncWork();
    });

    expect(controller.start).toHaveBeenCalledWith("changed");
    expect(changedScope?.getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(
      container.querySelector(".analysis-summary-grid")
    ).toBeNull();
    expect(container.textContent).toContain(
      "目标范围完成前不会展示另一范围的统计和关系图"
    );

    controller.state = {
      state: "ready",
      snapshotAvailable: true,
      analysisId: "changed-analysis",
      workspaceId: "workspace",
      entryId: "entry",
      entryName: "Entry",
      scope: "changed",
      generatedAt: "2026-09-17T00:01:00.000Z"
    };
    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    expect(changedScope?.getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(
      container.querySelector(".analysis-summary-grid")
    ).toBeNull();

    controller.snapshot = {
      ...createSnapshot(),
      analysisId: "changed-analysis",
      scope: "changed",
      generatedAt: "2026-09-17T00:01:00.000Z"
    };
    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    expect(changedScope?.getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(
      container.querySelector(".analysis-summary-grid")
    ).not.toBeNull();
  });

  it("aggregates connected LSPs while keeping failures and warnings separate", async () => {
    const snapshot: CodeAnalysisSnapshotDto = {
      ...createSnapshot(),
      languageServers: [
        {
          language: "typescript",
          state: "connected",
          command: "typescript-language-server",
          message: "已连接。",
          symbolCount: 1
        },
        {
          language: "vue",
          state: "failed",
          command: "vue-language-server",
          message: "连接失败。",
          symbolCount: 0
        },
        {
          language: "java",
          state: "connected",
          command: "jdtls",
          message: "已连接。",
          symbolCount: 1
        }
      ],
      warnings: ["部分动态调用无法静态解析。"]
    };
    analysisMock.controller = createController(snapshot);
    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    const runtimeStrip = container.querySelector(
      ".analysis-runtime-strip"
    );
    const runtimeItems = Array.from(runtimeStrip?.children ?? []);
    const connectedState = runtimeItems.find((item) =>
      item.textContent?.includes("LSP：2 个已连接")
    );
    const failedState = runtimeItems.find((item) =>
      item.textContent?.includes("Vue LSP：失败")
    );
    const warningPanel = runtimeStrip?.querySelector(
      ".analysis-warning-panel"
    );

    expect(connectedState).not.toBeUndefined();
    expect(connectedState?.getAttribute("title")).toBe(
      "已连接：TypeScript、Java"
    );
    expect(runtimeStrip?.textContent).not.toContain(
      "TypeScript LSP：已连接"
    );
    expect(runtimeStrip?.textContent).not.toContain(
      "Java LSP：已连接"
    );
    expect(failedState).not.toBeUndefined();
    expect(warningPanel).not.toBeNull();
    expect(runtimeItems.indexOf(warningPanel!)).toBe(
      runtimeItems.indexOf(failedState!) + 1
    );
    expect(
      warningPanel?.querySelector("summary")?.textContent
    ).toContain("1 条分析提示");
    expect(
      warningPanel?.querySelector(".analysis-warning-menu")
        ?.textContent
    ).toContain("部分动态调用无法静态解析。");
  });

  it("clears navigation search from the input and uses the shared dropdown menu for request types", async () => {
    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    const chainTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]'
      )
    ).find((button) =>
      button.textContent?.includes("请求链")
    );
    await act(async () => {
      chainTab?.click();
      await flushAsyncWork();
    });

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="筛选请求链"]'
    );
    expect(input).not.toBeNull();
    expect(
      container.querySelector(
        'button[aria-label="清空请求链筛选"]'
      )
    ).toBeNull();

    act(() => {
      setInputValue(input as HTMLInputElement, "caller");
    });
    const clear = container.querySelector<HTMLButtonElement>(
      'button[aria-label="清空请求链筛选"]'
    );
    expect(clear).not.toBeNull();
    act(() => clear?.click());
    expect(input?.value).toBe("");
    expect(document.activeElement).toBe(input);

    expect(
      container.querySelector(
        'select[aria-label="按请求类型筛选"]'
      )
    ).toBeNull();
    const methodTrigger =
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="按请求类型筛选"]'
      );
    expect(methodTrigger?.textContent).toContain("全部类型");
    act(() => methodTrigger?.click());

    const menu = document.body.querySelector(
      '[aria-label="请求类型筛选选项"]'
    );
    expect(menu).not.toBeNull();
    act(() => {
      menu?.dispatchEvent(new Event("scroll"));
    });
    expect(
      document.body.querySelector(
        '[aria-label="请求类型筛选选项"]'
      )
    ).toBe(menu);
    const getOption = Array.from(
      menu?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]'
      ) ?? []
    ).find((option) => option.textContent?.trim() === "GET");
    act(() => getOption?.click());
    expect(methodTrigger?.textContent).toContain("GET");
    expect(
      document.body.querySelector(
        '[aria-label="请求类型筛选选项"]'
      )
    ).toBeNull();
    expect(document.activeElement).toBe(methodTrigger);
  });

  it("deduplicates legacy request-chain ids before rendering and clears every row for an empty filter result", async () => {
    const baseSnapshot = createSnapshot();
    const duplicateChain = {
      id: "duplicate-chain",
      profileId: "web-http" as const,
      transport: "http" as const,
      operationKey: "GET /api/users/:id",
      method: "GET",
      route: "/api/users/:id",
      title: "GET /api/users/:id",
      clientNodeId: "caller",
      endpointNodeId: "callee",
      nodeIds: ["caller", "callee"],
      edgeIds: ["caller-callee"],
      changed: true,
      ambiguous: false,
      confidence: "exact" as const
    };
    analysisMock.controller = createController({
      ...baseSnapshot,
      requestChains: [
        duplicateChain,
        { ...duplicateChain }
      ],
      stats: {
        ...baseSnapshot.stats,
        requestChainCount: 2
      }
    });

    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    expect(
      container.querySelectorAll(
        ".analysis-chain-list > button"
      )
    ).toHaveLength(1);
    expect(container.textContent).toContain("1 条请求链");

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="筛选请求链"]'
    );
    if (!input) {
      throw new Error("Request-chain filter was not rendered.");
    }
    await act(async () => {
      setInputValue(input, "no-such-request-chain");
      await flushAsyncWork();
    });

    expect(
      container.querySelectorAll(
        ".analysis-chain-list > button"
      )
    ).toHaveLength(0);
    expect(container.textContent).toContain(
      "没有匹配的请求链"
    );
  });

  it("selects a request chain's entry node without replacing navigation", async () => {
    const snapshot: CodeAnalysisSnapshotDto = {
      ...createSnapshot(),
      requestChains: [
        {
          id: "get-user",
          profileId: "web-http",
          transport: "http",
          operationKey: "GET /api/users/:id",
          method: "GET",
          route: "/api/users/:id",
          title: "GET /api/users/:id",
          clientNodeId: "caller",
          endpointNodeId: "callee",
          nodeIds: ["caller", "callee"],
          edgeIds: ["caller-callee"],
          changed: true,
          ambiguous: false,
          confidence: "exact"
        },
        {
          id: "get-admin",
          profileId: "web-http",
          transport: "http",
          operationKey: "GET /api/admin/:id",
          method: "GET",
          route: "/api/admin/:id",
          title: "GET /api/admin/:id",
          clientNodeId: "callee",
          endpointNodeId: "callee",
          nodeIds: ["callee"],
          edgeIds: [],
          changed: true,
          ambiguous: false,
          confidence: "exact"
        }
      ],
      stats: {
        ...createSnapshot().stats,
        requestChainCount: 2
      }
    };
    analysisMock.controller = createController(snapshot);

    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    expect(
      container.querySelector(
        '.analysis-graph-node.selected[aria-label="function caller"]'
      )
    ).not.toBeNull();

    const adminChain = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".analysis-chain-list > button"
      )
    ).find((button) =>
      button.textContent?.includes("/api/admin/:id")
    );
    act(() => {
      adminChain?.click();
    });

    await vi.waitFor(() => {
      expect(
        container.querySelector(
          '.analysis-graph-node.selected[aria-label="function callee"]'
        )
      ).not.toBeNull();
    });
    expect(adminChain?.getAttribute("aria-current")).toBe("true");
    expect(
      container.querySelector(".analysis-chain-list")
    ).not.toBeNull();
    expect(
      container.querySelector(
        ".analysis-chain-panel.is-node-detail"
      )
    ).toBeNull();
  });

  it("clears the selected graph node after clicking blank canvas space", async () => {
    const baseSnapshot = createSnapshot();
    analysisMock.controller = createController({
      ...baseSnapshot,
      requestChains: [
        {
          id: "get-user",
          profileId: "web-http",
          transport: "http",
          operationKey: "GET /api/users/:id",
          method: "GET",
          route: "/api/users/:id",
          title: "GET /api/users/:id",
          clientNodeId: "caller",
          endpointNodeId: "callee",
          nodeIds: ["caller", "callee"],
          edgeIds: ["caller-callee"],
          changed: true,
          ambiguous: false,
          confidence: "exact"
        }
      ],
      stats: {
        ...baseSnapshot.stats,
        requestChainCount: 1
      }
    });

    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    expect(
      container.querySelector(
        '.analysis-graph-node.selected[aria-label="function caller"]'
      )
    ).not.toBeNull();

    const viewport = container.querySelector<HTMLDivElement>(
      ".analysis-graph-scroll"
    );
    act(() => {
      dispatchPointer(viewport as Element, "pointerdown", {
        pointerId: 7,
        clientX: 100,
        clientY: 100
      });
      dispatchPointer(viewport as Element, "pointerup", {
        pointerId: 7,
        clientX: 100,
        clientY: 100
      });
    });

    await vi.waitFor(() => {
      expect(
        container.querySelector(".analysis-graph-node.selected")
      ).toBeNull();
    });
    expect(
      container.querySelectorAll(".analysis-graph-node")
    ).toHaveLength(2);
    expect(
      container.querySelector(
        '.analysis-chain-list > button[aria-current="true"]'
      )
    ).not.toBeNull();
  });

  it("renders an RPC chain with its analysis profile and generic ambiguity wording", async () => {
    const baseSnapshot = createSnapshot();
    const snapshot: CodeAnalysisSnapshotDto = {
      ...baseSnapshot,
      nodes: [
        {
          ...baseSnapshot.nodes[0]!,
          id: "rpc-client",
          kind: "rpc-client",
          name: "getResource",
          qualifiedName: "fai.cli.ScResCli.getResource",
          language: "java",
          location: {
            repositoryId: "core",
            worktreeId: "core",
            path: "fai-cli-sc/ScResCli.java",
            line: 42,
            column: 1
          }
        },
        {
          ...baseSnapshot.nodes[1]!,
          id: "rpc-handler",
          kind: "rpc-handler",
          name: "getResource",
          qualifiedName:
            "fai.svr.ScResSvr.proc.ScResProc.getResource",
          language: "java",
          location: {
            repositoryId: "svr",
            worktreeId: "svr",
            path: "ScResSvr/proc/ScResProc.java",
            line: 88,
            column: 1
          }
        }
      ],
      edges: [
        {
          id: "rpc-request",
          from: "rpc-client",
          to: "rpc-handler",
          kind: "rpc-request",
          confidence: "exact"
        }
      ],
      requestChains: [
        {
          id: "rpc-get-resource",
          profileId: "fai-cli-rpc",
          transport: "rpc",
          operationKey: "ScResDef.Protocol.GET_RESOURCE",
          method: "RPC",
          route: "ScResDef.Protocol.GET_RESOURCE",
          title: "RPC ScResDef.Protocol.GET_RESOURCE",
          clientNodeId: "rpc-client",
          endpointNodeId: "rpc-handler",
          nodeIds: ["rpc-client", "rpc-handler"],
          edgeIds: ["rpc-request"],
          changed: true,
          ambiguous: true,
          confidence: "exact"
        }
      ],
      stats: {
        ...baseSnapshot.stats,
        edgeCount: 1,
        requestChainCount: 1
      }
    };
    analysisMock.controller = createController(snapshot);

    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    const chain = container.querySelector(
      ".analysis-chain-list > button"
    );
    expect(chain?.textContent).toContain("RPC");
    expect(chain?.textContent).toContain(
      "Profile: fai-cli-rpc"
    );
    expect(chain?.textContent).toContain("多个候选目标");
    expect(
      container.querySelector(".edge-rpc-request")
    ).not.toBeNull();
  });

  it("replaces navigation with node details, opens diff on demand to the right, and preserves the graph", async () => {
    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    const svg = container.querySelector<SVGSVGElement>(
      ".analysis-graph-svg"
    );
    Object.defineProperty(svg, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 800,
        bottom: 500,
        width: 800,
        height: 500,
        toJSON: () => ({})
      })
    });
    const caller = container.querySelector<SVGGElement>(
      '[aria-label="function caller"]'
    );
    expect(
      window.gitnest.repository.getChanges
    ).not.toHaveBeenCalled();
    act(() => {
      dispatchPointer(caller as Element, "pointerdown", {
        pointerId: 1,
        clientX: 120,
        clientY: 120
      });
      dispatchPointer(caller as Element, "pointerup", {
        pointerId: 1,
        clientX: 120,
        clientY: 120
      });
    });

    await vi.waitFor(() => {
      expect(
        container.querySelector(
          ".analysis-chain-panel.is-node-detail"
        )
      ).not.toBeNull();
    });
    expect(
      container.querySelector(".analysis-graph-svg")
    ).toBe(svg);
    expect(
      container.querySelector(
        ".analysis-chain-panel .analysis-chain-list"
      )
    ).toBeNull();
    expect(
      container.querySelector(
        ".analysis-node-detail-back[aria-label=\"返回代码导航\"]"
      )
    ).not.toBeNull();
    expect(
      container.querySelector(
        ".analysis-node-details .analysis-detail-wide dd"
      )?.textContent
    ).toBe("src/caller.ts:2");
    expect(
      container.querySelector(
        ".analysis-node-documentation p"
      )?.textContent
    ).toBe("Calls the downstream service.");
    expect(container.textContent).not.toContain("直接关系");
    expect(
      container.querySelector(".analysis-node-diff-drawer")
    ).toBeNull();
    expect(
      window.gitnest.repository.getChanges
    ).not.toHaveBeenCalled();

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-controls="analysis-node-diff-drawer"]'
        )
        ?.click();
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector(".analysis-node-diff-drawer")
      ).not.toBeNull();
      expect(container.textContent).toContain("newValue");
    });
    const focusedRows = container.querySelectorAll<HTMLElement>(
      '[data-diff-viewer-focus-line="true"]'
    );
    expect(focusedRows).toHaveLength(1);
    expect(focusedRows[0]?.textContent).toContain("newValue");

    const searchButton =
      container.querySelector<HTMLButtonElement>(
        '[aria-label="搜索节点文件 Diff"]'
      );
    expect(searchButton?.disabled).toBe(false);
    act(() => {
      searchButton?.click();
    });
    const searchInput =
      container.querySelector<HTMLInputElement>(
        'input[aria-label="搜索文本"]'
      );
    expect(searchInput).not.toBeNull();
    expect(document.activeElement).toBe(searchInput);

    const graphWorkspace = container.querySelector(
      ".analysis-graph-workspace"
    );
    const analysisWorkbench = container.querySelector(
      ".analysis-workbench"
    );
    const nodeDetailPanel = container.querySelector(
      ".analysis-chain-panel.is-node-detail"
    );
    expect(analysisWorkbench?.contains(nodeDetailPanel)).toBe(true);
    expect(analysisWorkbench?.contains(graphWorkspace)).toBe(true);
    expect(
      graphWorkspace?.children[0]?.classList.contains(
        "analysis-node-diff-drawer"
      )
    ).toBe(true);
    expect(
      graphWorkspace?.children[1]?.classList.contains(
        "analysis-graph-panel"
      )
    ).toBe(true);
    expect(
      window.gitnest.repository.getDiff
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        target: {
          repositoryId: "repository",
          worktreeId: "worktree"
        },
        path: "src/caller.ts",
        mode: "unstaged"
      })
    );
    expect(
      container.querySelector(".analysis-graph-svg")
    ).toBe(svg);

    const originalSvg = svg;
    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="全屏显示代码分析工作区"]'
        )
        ?.click();
    });
    expect(analysisWorkbench?.classList.contains("is-fullscreen")).toBe(
      true
    );
    expect(graphWorkspace?.classList.contains("is-fullscreen")).toBe(
      false
    );
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Escape"
        })
      );
    });
    expect(analysisWorkbench?.classList.contains("is-fullscreen")).toBe(
      false
    );
    expect(
      container.querySelector(".analysis-graph-svg")
    ).toBe(originalSvg);

    const viewport = container.querySelector(
      ".analysis-graph-scroll"
    );
    act(() => {
      dispatchPointer(viewport as Element, "pointerdown", {
        pointerId: 2,
        clientX: 240,
        clientY: 180
      });
      dispatchPointer(viewport as Element, "pointerup", {
        pointerId: 2,
        clientX: 240,
        clientY: 180
      });
    });
    expect(
      container.querySelector(
        ".analysis-chain-panel.is-node-detail"
      )
    ).toBeNull();
    expect(
      container.querySelector(".analysis-node-diff-drawer")
    ).toBeNull();
    expect(container.textContent).toContain("代码导航");
  });

  it("shows Diff for changed nodes and actual code for unchanged nodes", async () => {
    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    const caller = container.querySelector<SVGGElement>(
      '[aria-label="function caller"]'
    );
    act(() => {
      caller?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter"
        })
      );
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector(
          '[aria-controls="analysis-node-diff-drawer"]'
        )?.textContent
      ).toContain("查看文件 Diff");
    });
    const fixedDiffTrigger = container.querySelector(
      ".analysis-node-diff-trigger"
    );
    expect(
      fixedDiffTrigger?.parentElement?.classList.contains(
        "analysis-chain-panel"
      )
    ).toBe(true);
    expect(
      fixedDiffTrigger?.closest(".analysis-node-details")
    ).toBeNull();

    const callee = container.querySelector<SVGGElement>(
      '[aria-label="function callee"]'
    );
    act(() => {
      callee?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter"
        })
      );
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector(
          ".analysis-node-title strong"
        )?.textContent
      ).toBe("callee");
      expect(
        container.querySelector(
          '[aria-controls="analysis-node-diff-drawer"]'
        )?.textContent
      ).toContain("查看代码");
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-controls="analysis-node-diff-drawer"]'
        )
        ?.click();
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector(
          ".analysis-node-source-drawer"
        )
      ).not.toBeNull();
      expect(container.textContent).toContain("节点所在代码");
      expect(container.textContent).toContain(
        "export function callee()"
      );
    });
    expect(
      container.querySelector(
        '.analysis-node-source-line[aria-current="location"]'
      )?.textContent
    ).toContain("export function callee()");
    expect(
      Array.from(
        container.querySelectorAll(
          ".analysis-source-token.is-keyword"
        )
      ).map((token) => token.textContent)
    ).toEqual(
      expect.arrayContaining(["export", "function", "return"])
    );
    expect(
      container.querySelector(
        ".analysis-source-token.is-function"
      )?.textContent
    ).toBe("callee");
    expect(
      container.querySelector(
        ".analysis-source-token.is-string"
      )?.textContent
    ).toBe('"actual"');
    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="搜索节点代码"]'
        )
        ?.click();
    });
    const sourceSearchInput =
      container.querySelector<HTMLInputElement>(
        ".analysis-node-source-search input"
      );
    expect(sourceSearchInput).not.toBeNull();
    act(() => {
      setInputValue(
        sourceSearchInput as HTMLInputElement,
        "function callee"
      );
    });
    const sourceSearchHit = container.querySelector(
      '[data-source-search-hit="0"]'
    );
    expect(sourceSearchHit?.textContent).toBe(
      "function callee"
    );
    expect(
      sourceSearchHit?.querySelector(
        ".analysis-source-token.is-keyword"
      )?.textContent
    ).toBe("function");
    expect(
      sourceSearchHit?.querySelector(
        ".analysis-source-token.is-function"
      )?.textContent
    ).toBe("callee");
    expect(
      window.gitnest.codeAnalysis.readFile
    ).toHaveBeenCalledWith({
      nodeId: "callee"
    });
    expect(
      window.gitnest.repository.getChanges
    ).not.toHaveBeenCalled();
    expect(
      window.gitnest.repository.getDiff
    ).not.toHaveBeenCalled();
    expect(
      container.querySelector(
        ".analysis-diff-mode-tabs"
      )
    ).toBeNull();
  });

  it("shows a readable source error without falling back to Diff", async () => {
    vi.mocked(
      window.gitnest.codeAnalysis.readFile
    ).mockResolvedValueOnce({
      ok: false,
      error: {
        code: "DIRECTORY_UNAVAILABLE",
        message: "文件已被移动。",
        details: {}
      }
    });

    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    const callee = container.querySelector<SVGGElement>(
      '[aria-label="function callee"]'
    );
    act(() => {
      callee?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter"
        })
      );
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector(
          '[aria-controls="analysis-node-diff-drawer"]'
        )
      ).not.toBeNull();
    });
    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-controls="analysis-node-diff-drawer"]'
        )
        ?.click();
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain(
        "无法读取节点代码"
      );
      expect(container.textContent).toContain("文件已被移动。");
    });
    expect(
      window.gitnest.repository.getDiff
    ).not.toHaveBeenCalled();
  });

  it("shows index coverage, edge evidence, and editor positioning without extra filter or chain-step panels", async () => {
    const base = createSnapshot();
    const snapshot: CodeAnalysisSnapshotDto = {
      ...base,
      edges: [
        {
          ...base.edges[0]!,
          source: "merged",
          evidence: "LSP call hierarchy matched callee"
        }
      ],
      requestChains: [
        {
          id: "request-chain",
          profileId: "web-http",
          transport: "http",
          operationKey: "GET /items",
          method: "GET",
          route: "/items",
          title: "GET /items",
          clientNodeId: "caller",
          endpointNodeId: "callee",
          nodeIds: ["caller", "callee"],
          edgeIds: ["caller-callee"],
          changed: true,
          ambiguous: false,
          confidence: "probable"
        }
      ],
      indexStatus: {
        fullIndexAvailable: false,
        resultCompleteness: "partial",
        impactCoverage: "possible-omissions",
        lastFullIndexAt: "2026-09-19T12:00:00.000Z",
        message: "当前结果来自局部索引，可能遗漏未扫描调用者。"
      },
      diagnostics: [
        {
          id: "diagnostic",
          kind: "unresolved-call",
          severity: "warning",
          message: "下游调用未解析",
          evidence: "未找到 receiverType 对应实现",
          nodeId: "callee",
          relatedNodeIds: []
        }
      ],
      stats: {
        ...base.stats,
        requestChainCount: 1,
        truncated: true
      }
    };
    const controller = createController(snapshot);
    analysisMock.controller = controller;

    await act(async () => {
      root.render(
        <CodeAnalysisPage
          onOpenSettings={vi.fn()}
          onReloadSettings={vi.fn(async () => undefined)}
          settings={createDefaultAppSettings()}
          workspace={null}
        />
      );
      await flushAsyncWork();
    });

    expect(
      container.querySelector(
        '[aria-label="代码索引状态"]'
      )
    ).toBeNull();
    const indexStatusMenu =
      container.querySelector<HTMLDetailsElement>(
        ".analysis-index-status-menu"
      );
    expect(indexStatusMenu?.textContent).toContain(
      "结果已按性能上限截断"
    );
    expect(indexStatusMenu?.textContent).toContain(
      "局部索引"
    );
    expect(
      indexStatusMenu?.parentElement?.classList.contains(
        "analysis-runtime-strip"
      )
    ).toBe(true);
    expect(container.textContent).toContain(
      "LSP call hierarchy matched callee"
    );
    expect(
      container.querySelector(
        '[aria-label="代码分析筛选"]'
      )
    ).toBeNull();
    expect(
      container.querySelector(
        '[aria-label="请求链步骤"]'
      )
    ).toBeNull();
    expect(
      container.querySelector(
        '[aria-label="复制当前请求链"]'
      )
    ).toBeNull();

    await act(async () => {
      Array.from(
        container.querySelectorAll<HTMLButtonElement>("button")
      )
        .find((button) =>
          button.textContent?.includes("建立完整索引")
        )
        ?.click();
      await flushAsyncWork();
    });
    expect(controller.start).toHaveBeenCalledWith("workspace");

    expect(container.textContent).not.toContain("导出 JSON");

    act(() => {
      container
        .querySelector<SVGGElement>(
          '[aria-label="function callee"]'
        )
        ?.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            key: "Enter"
          })
        );
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain(
        "在 Cursor 中定位"
      );
      expect(container.textContent).toContain(
        "下游调用未解析"
      );
    });
    await act(async () => {
      Array.from(
        container.querySelectorAll<HTMLButtonElement>("button")
      )
        .find((button) =>
          button.textContent?.includes("在 Cursor 中定位")
        )
        ?.click();
      await flushAsyncWork();
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
        path: "src/callee.ts",
        line: 1,
        column: 1
      },
      kind: "cursor"
    });
  });
});

function createController(
  snapshot = createSnapshot()
): CodeAnalysisController {
  return {
    state: {
      state: "ready",
      snapshotAvailable: true,
      analysisId: "analysis",
      workspaceId: "workspace",
      entryId: "entry",
      entryName: "Entry",
      scope: "workspace",
      generatedAt: "2026-09-17T00:00:00.000Z"
    },
    snapshot,
    loading: false,
    action: null,
    installingLanguage: null,
    error: null,
    start: vi.fn(async () => true),
    cancel: vi.fn(async () => true),
    installLanguageServer: vi.fn(async () => null),
    reload: vi.fn(async () => undefined),
    clearError: vi.fn()
  };
}

function createSnapshot(): CodeAnalysisSnapshotDto {
  const nodes = [
    {
      id: "caller",
      kind: "function",
      name: "caller",
      qualifiedName: "caller",
      language: "typescript",
      location: {
        repositoryId: "repository",
        worktreeId: "worktree",
        path: "src/caller.ts",
        line: 2,
        column: 1
      },
      changed: true,
      source: "builtin",
      confidence: "probable",
      metadata: {
        endLine: 8,
        documentation: "Calls the downstream service."
      }
    },
    {
      id: "callee",
      kind: "function",
      name: "callee",
      qualifiedName: "callee",
      language: "typescript",
      location: {
        repositoryId: "repository",
        worktreeId: "worktree",
        path: "src/callee.ts",
        line: 1,
        column: 1
      },
      changed: false,
      source: "builtin",
      confidence: "probable",
      metadata: {}
    }
  ] as const;
  return {
    schemaVersion: 1,
    analysisId: "analysis",
    workspaceId: "workspace",
    entryId: "entry",
    entryName: "Entry",
    scope: "workspace",
    generatedAt: "2026-09-17T00:00:00.000Z",
    roots: [],
    nodes: [...nodes],
    edges: [
      {
        id: "caller-callee",
        from: "caller",
        to: "callee",
        kind: "calls",
        confidence: "exact"
      }
    ],
    requestChains: [],
    languageServers: [],
    warnings: [],
    stats: {
      discoveredFiles: 2,
      analyzedFiles: 2,
      cachedFiles: 0,
      skippedFiles: 0,
      symbolCount: 2,
      edgeCount: 1,
      requestChainCount: 0,
      truncated: false,
      durationMs: 1
    }
  };
}

function createBridge(): GitNestBridge {
  return {
    codeAnalysis: {
      readFile: vi.fn(async (request) => ({
        ok: true as const,
        value: {
          nodeId: request.nodeId,
          path: "src/callee.ts",
          language: "typescript" as const,
          content:
            'export function callee() {\n  return "actual";\n}',
          startLine: 1,
          endLine: 3,
          totalLines: 3,
          truncated: false
        }
      }))
    },
    system: {
      listExternalApplications: vi.fn(async () => ({
        ok: true as const,
        value: [
          {
            kind: "cursor" as const,
            label: "Cursor"
          }
        ]
      })),
      openExternalApplication: vi.fn(async (request) => ({
        ok: true as const,
        value: {
          kind: request.kind,
          label: "Cursor",
          scope: request.context.scope
        }
      }))
    },
    repository: {
      getChanges: vi.fn(async () => ({
        ok: true as const,
        value: {
          target: {
            repositoryId: "repository",
            worktreeId: "worktree"
          },
          snapshot: {
            branch: "main",
            head: "abcdef",
            ahead: 0,
            behind: 0,
            staged: 0,
            unstaged: 1,
            untracked: 0,
            conflicted: 0,
            changes: [
              {
                path: "src/caller.ts",
                indexStatus: ".",
                worktreeStatus: "M",
                kind: "ordinary"
              }
            ],
            refreshedAt: "2026-09-17T00:00:00.000Z"
          }
        }
      })),
      getDiff: vi.fn(async (request) => ({
        ok: true as const,
        value: {
          target: request.target,
          diff: {
            path: request.path,
            mode: request.mode,
            content:
              "@@ -2,1 +2,1 @@\n-oldValue\n+newValue",
            binary: false,
            truncated: false,
            additions: 1,
            deletions: 1
          }
        }
      })),
      cancelQuery: vi.fn(async () => ({
        ok: true as const,
        value: undefined
      }))
    }
  } as unknown as GitNestBridge;
}

function dispatchPointer(
  target: Element,
  type: string,
  values: {
    pointerId: number;
    clientX: number;
    clientY: number;
  }
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX: values.clientX,
    clientY: values.clientY
  });
  Object.defineProperty(event, "pointerId", {
    configurable: true,
    value: values.pointerId
  });
  target.dispatchEvent(event);
}

function setInputValue(
  input: HTMLInputElement,
  value: string
): void {
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

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
