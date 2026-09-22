/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_CODE_ANALYSIS_GRAPH_EDGES,
  DEFAULT_CODE_ANALYSIS_GRAPH_NODES,
  MAX_CODE_ANALYSIS_DIAGNOSTICS,
  MAX_CODE_ANALYSIS_GRAPH_EDGES,
  MAX_CODE_ANALYSIS_GRAPH_NODES,
  MAX_CODE_ANALYSIS_REQUEST_CHAINS,
  MAX_CODE_ANALYSIS_TOTAL_SOURCE_MB,
  MAX_LSP_DOCUMENTS,
  MAX_LSP_REQUESTS,
  MIN_CODE_ANALYSIS_DIAGNOSTICS,
  MIN_CODE_ANALYSIS_GRAPH_EDGES,
  MIN_CODE_ANALYSIS_GRAPH_NODES,
  MIN_CODE_ANALYSIS_REQUEST_CHAINS,
  MIN_CODE_ANALYSIS_TOTAL_SOURCE_MB,
  MIN_LSP_DOCUMENTS,
  MIN_LSP_REQUESTS,
  createDefaultAppSettings,
  type ExternalTerminalProfileDto
} from "@gitnest/contracts";

import type { AccountController } from "../../features/account-manage/useAccounts";
import type { AppSettingsController } from "../../features/settings/useAppSettings";
import { ApplicationSettingsPage } from "./ApplicationSettingsPage";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

describe("ApplicationSettingsPage", () => {
  it("shows the application setting sections and no removable dangerous-operation switch", () => {
    vi.stubGlobal("React", React);
    try {
      const html = renderToStaticMarkup(
        <ApplicationSettingsPage
          accounts={emptyAccounts()}
          appSettings={settingsController()}
          gitEnvironment={null}
          terminalProfiles={[]}
          workspace={null}
        />
      );
      const document = new DOMParser().parseFromString(
        html,
        "text/html"
      );
      const navigationLabels = Array.from(
        document.querySelectorAll(
          'nav[aria-label="设置分组"] button'
        )
      ).map((button) =>
        button
          .querySelector(".settings-nav-item-title")
          ?.textContent?.trim()
      );

      expect(navigationLabels).toEqual([
        "通用",
        "AI 提交信息",
        "LSP 与代码分析",
        "Git",
        "账号与认证"
      ]);
      expect(html).not.toContain("快捷键");
      expect(html).not.toContain("危险操作前确认");
      expect(html).not.toContain("危险操作始终确认");
      expect(html).not.toContain("无法在设置中关闭");
      expect(html).not.toContain("重新读取");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the shared page skeleton before settings finish their first load", () => {
    vi.stubGlobal("React", React);
    try {
      const html = renderToStaticMarkup(
        <ApplicationSettingsPage
          accounts={emptyAccounts()}
          appSettings={settingsController({
            loaded: false,
            loading: true
          })}
          gitEnvironment={null}
          terminalProfiles={[]}
          workspace={null}
        />
      );

      expect(html).toContain("gn-skeleton-surface");
      expect(html).toContain("application-settings-page");
      expect(html).toContain('aria-label="正在读取应用设置"');
      expect(html).not.toContain("settings-nav-item-title");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("groups the current preferences by their purpose", () => {
    vi.stubGlobal("React", React);
    try {
      const html = renderToStaticMarkup(
        <ApplicationSettingsPage
          accounts={emptyAccounts()}
          appSettings={settingsController()}
          gitEnvironment={null}
          terminalProfiles={[]}
          workspace={null}
        />
      );
      const document = new DOMParser().parseFromString(
        html,
        "text/html"
      );
      const groups = Array.from(
        document.querySelectorAll(".settings-preference-group")
      );
      const preferenceLabelsByGroup = Object.fromEntries(
        groups.map((group) => [
          group
            .querySelector(".settings-preference-group-title")
            ?.textContent?.trim(),
          Array.from(group.querySelectorAll("dt")).map((item) =>
            item.textContent?.trim()
          )
        ])
      );

      expect(preferenceLabelsByGroup).toEqual({
        文件浏览: ["变更文件视图", "树形目录"],
        差异查看: ["Diff 布局", "自动换行"],
        提交体验: ["提交区域高度"]
      });
      expect(html).not.toContain("界面主题");
      expect(
        groups.every(
          (group) =>
            group.getAttribute("aria-labelledby") ===
            group.querySelector("h3")?.id
        )
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the shared dropdown menu for the default terminal", () => {
    vi.stubGlobal("React", React);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const appSettings = settingsController();
    const terminalProfiles: ExternalTerminalProfileDto[] = [
      {
        kind: "windows-terminal",
        label: "Windows Terminal"
      },
      {
        kind: "powershell",
        label: "PowerShell"
      }
    ];

    try {
      act(() => {
        root.render(
          <ApplicationSettingsPage
            accounts={emptyAccounts()}
            appSettings={appSettings}
            gitEnvironment={null}
            terminalProfiles={terminalProfiles}
            workspace={null}
          />
        );
      });

      const trigger = container.querySelector<HTMLButtonElement>(
        '[aria-label="选择默认终端"]'
      );
      expect(trigger).not.toBeNull();
      expect(trigger?.classList).toContain("gn-button");
      expect(trigger?.classList).toContain(
        "gn-select__trigger"
      );
      expect(trigger?.dataset.size).toBe("medium");
      expect(trigger?.textContent).toContain("Windows Terminal");
      expect(container.querySelector("select")).toBeNull();

      act(() => trigger?.click());

      const menu = document.body.querySelector(
        '[aria-label="默认终端选项"]'
      );
      expect(menu?.getAttribute("role")).toBe("menu");
      const powerShell = Array.from(
        menu?.querySelectorAll<HTMLButtonElement>(
          '[role="menuitemradio"]'
        ) ?? []
      ).find((item) => item.textContent?.includes("PowerShell"));

      act(() => powerShell?.click());

      expect(appSettings.update).toHaveBeenCalledWith({
        general: {
          defaultTerminalKind: "powershell"
        }
      });
      expect(document.activeElement).toBe(trigger);
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("keeps the AI API Key hidden by default and clears it after saving", async () => {
    vi.stubGlobal("React", React);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const appSettings = settingsController();

    try {
      act(() => {
        root.render(
          <ApplicationSettingsPage
            accounts={emptyAccounts()}
            appSettings={appSettings}
            gitEnvironment={null}
            initialSection="ai"
            terminalProfiles={[]}
            workspace={null}
          />
        );
      });

      const getKeyInput = () =>
        container.querySelector<HTMLInputElement>("#ai-api-key");
      const keyInput = getKeyInput();
      expect(keyInput?.type).toBe("password");

      act(() => {
        setNativeInputValue(keyInput, "sk-current-draft");
        keyInput?.dispatchEvent(
          new Event("input", { bubbles: true })
        );
      });

      const showKey = container.querySelector<HTMLButtonElement>(
        '[aria-label="显示 API Key"]'
      );
      act(() => showKey?.click());
      expect(getKeyInput()?.type).toBe("text");
      expect(getKeyInput()?.value).toBe("sk-current-draft");

      const save = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button")
      ).find((button) =>
        button.textContent?.includes("保存 AI 设置")
      );
      await act(async () => {
        save?.click();
        await Promise.resolve();
      });

      expect(getKeyInput()?.value).toBe("");
      expect(getKeyInput()?.type).toBe("password");
      expect(appSettings.update).toHaveBeenCalledWith(
        {
          ai: expect.objectContaining({
            apiKey: "sk-current-draft"
          })
        },
        {
          notice: "AI 提交信息设置已保存。"
        }
      );
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("preserves unsaved AI fields across unrelated settings updates", () => {
    vi.stubGlobal("React", React);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const appSettings = settingsController();
    const render = (controller: AppSettingsController) => {
      root.render(
        <ApplicationSettingsPage
          accounts={emptyAccounts()}
          appSettings={controller}
          gitEnvironment={null}
          initialSection="ai"
          terminalProfiles={[]}
          workspace={null}
        />
      );
    };

    try {
      act(() => render(appSettings));
      const input =
        container.querySelector<HTMLInputElement>("#ai-api-url");
      act(() => {
        setNativeInputValue(input, "https://draft.example/v1");
        input?.dispatchEvent(new Event("input", { bubbles: true }));
      });

      act(() =>
        render({
          ...appSettings,
          settings: {
            ...appSettings.settings,
            appearance: { theme: "light" },
            ai: {
              ...appSettings.settings.ai,
              apiUrl: "https://persisted.example/v1"
            }
          }
        })
      );

      expect(
        container.querySelector<HTMLInputElement>("#ai-api-url")
          ?.value
      ).toBe("https://draft.example/v1");
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("preserves an unsaved LSP draft across unrelated settings updates", () => {
    vi.stubGlobal("React", React);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const appSettings = settingsController();
    const render = (controller: AppSettingsController) => {
      root.render(
        <ApplicationSettingsPage
          accounts={emptyAccounts()}
          appSettings={controller}
          gitEnvironment={null}
          initialSection="analysis"
          terminalProfiles={[]}
          workspace={null}
        />
      );
    };

    try {
      act(() => render(appSettings));
      const input = container.querySelector<HTMLInputElement>(
        "#lsp-command-typescript-language-server"
      );
      act(() => {
        setNativeInputValue(input, "draft-language-server");
        input?.dispatchEvent(new Event("input", { bubbles: true }));
      });

      act(() =>
        render({
          ...appSettings,
          settings: {
            ...appSettings.settings,
            git: {
              ...appSettings.settings.git,
              fetchMode: "startup"
            },
            codeAnalysis: {
              ...appSettings.settings.codeAnalysis,
              typescript: {
                ...appSettings.settings.codeAnalysis.typescript,
                command: "persisted-language-server"
              }
            }
          }
        })
      );

      expect(
        container.querySelector<HTMLInputElement>(
          "#lsp-command-typescript-language-server"
        )?.value
      ).toBe("draft-language-server");
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("switches one shared LSP editor with breadcrumb navigation", () => {
    vi.stubGlobal("React", React);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      act(() => {
        root.render(
          <ApplicationSettingsPage
            accounts={emptyAccounts()}
            appSettings={settingsController()}
            gitEnvironment={null}
            initialSection="analysis"
            terminalProfiles={[]}
            workspace={null}
          />
        );
      });

      const breadcrumb = container.querySelector(
        'nav[aria-label="Language Server 配置导航"]'
      );
      const cardTitles = Array.from(
        container.querySelectorAll(".settings-card-title")
      ).map((element) => element.textContent?.trim());
      expect(cardTitles.indexOf("性能预算")).toBeLessThan(
        cardTitles.indexOf("Language Server 配置")
      );
      const serverButtons = Array.from(
        breadcrumb?.querySelectorAll<HTMLButtonElement>(
          "button[data-language-server-id]"
        ) ?? []
      );

      expect(
        serverButtons.map((button) => button.textContent?.trim())
      ).toEqual([
        "TypeScript",
        "Java",
        "Vue",
        "Python",
        "Go",
        "Kotlin",
        "C#",
        "Rust"
      ]);
      expect(
        container.querySelectorAll(".settings-lsp-editor")
      ).toHaveLength(1);
      const typescriptInput =
        container.querySelector<HTMLInputElement>(
          "#lsp-command-typescript-language-server"
        );
      expect(typescriptInput).not.toBeNull();
      const typescriptBudgetFields = container.querySelectorAll(
        ".settings-lsp-budget .gn-input-field"
      );
      expect(typescriptBudgetFields).toHaveLength(7);
      for (const field of typescriptBudgetFields) {
        expect(
          field.querySelector(".gn-input-field__help")
        ).not.toBeNull();
      }
      const maxDocuments =
        container.querySelector<HTMLInputElement>(
          "#lsp-max-documents-typescript-language-server"
        );
      expect(maxDocuments?.value).toBe(
        String(
          createDefaultAppSettings().codeAnalysis.typescript
            .maxDocuments
        )
      );
      expect(maxDocuments?.min).toBe(String(MIN_LSP_DOCUMENTS));
      expect(maxDocuments?.max).toBe(String(MAX_LSP_DOCUMENTS));
      const referenceRequests =
        container.querySelector<HTMLInputElement>(
          "#lsp-max-reference-requests-typescript-language-server"
        );
      expect(referenceRequests?.min).toBe(
        String(MIN_LSP_REQUESTS)
      );
      expect(referenceRequests?.max).toBe(
        String(MAX_LSP_REQUESTS)
      );
      const typeHierarchyRequests =
        container.querySelector<HTMLInputElement>(
          "#lsp-max-type-hierarchy-typescript-language-server"
        );
      expect(typeHierarchyRequests?.value).toBe(
        String(
          createDefaultAppSettings().codeAnalysis.typescript
            .maxTypeHierarchyRequests
        )
      );
      expect(typeHierarchyRequests?.min).toBe(
        String(MIN_LSP_REQUESTS)
      );
      expect(typeHierarchyRequests?.max).toBe(
        String(MAX_LSP_REQUESTS)
      );
      expect(
        container.querySelector(
          "#lsp-command-java-language-server"
        )
      ).toBeNull();

      act(() => {
        setNativeInputValue(
          typescriptInput,
          "draft-typescript-language-server"
        );
        typescriptInput?.dispatchEvent(
          new Event("input", { bubbles: true })
        );
        setNativeInputValue(referenceRequests, "125");
        referenceRequests?.dispatchEvent(
          new Event("input", { bubbles: true })
        );
      });
      const javaButton = breadcrumb?.querySelector<HTMLButtonElement>(
        'button[data-language-server-id="java"]'
      );
      act(() => javaButton?.click());

      expect(javaButton?.getAttribute("aria-current")).toBe("page");
      expect(
        container.querySelector(
          "#lsp-command-typescript-language-server"
        )
      ).toBeNull();
      expect(
        container.querySelector(
          "#lsp-command-java-language-server"
        )
      ).not.toBeNull();

      const typescriptButton =
        breadcrumb?.querySelector<HTMLButtonElement>(
          'button[data-language-server-id="typescript"]'
        );
      act(() => typescriptButton?.click());

      expect(
        container.querySelector<HTMLInputElement>(
          "#lsp-command-typescript-language-server"
        )?.value
      ).toBe("draft-typescript-language-server");
      expect(
        container.querySelector<HTMLInputElement>(
          "#lsp-max-reference-requests-typescript-language-server"
        )?.value
      ).toBe("125");
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("does not replace a newer AI draft when an earlier save finishes", async () => {
    vi.stubGlobal("React", React);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const pendingSave = deferred<boolean>();
    const appSettings = settingsController({
      update: vi.fn(() => pendingSave.promise)
    });

    try {
      act(() => {
        root.render(
          <ApplicationSettingsPage
            accounts={emptyAccounts()}
            appSettings={appSettings}
            gitEnvironment={null}
            initialSection="ai"
            terminalProfiles={[]}
            workspace={null}
          />
        );
      });
      const input =
        container.querySelector<HTMLInputElement>("#ai-api-url");
      act(() => {
        setNativeInputValue(
          input,
          "https://submitted.example/v1"
        );
        input?.dispatchEvent(
          new Event("input", { bubbles: true })
        );
      });
      const save = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button")
      ).find((button) =>
        button.textContent?.includes("保存 AI 设置")
      );
      act(() => save?.click());
      act(() => {
        setNativeInputValue(input, "https://newer.example/v1");
        input?.dispatchEvent(
          new Event("input", { bubbles: true })
        );
      });

      await act(async () => {
        pendingSave.resolve(true);
        await pendingSave.promise;
      });

      expect(
        container.querySelector<HTMLInputElement>("#ai-api-url")
          ?.value
      ).toBe("https://newer.example/v1");
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("keeps a newer LSP draft dirty when an earlier save finishes", async () => {
    vi.stubGlobal("React", React);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const pendingSave = deferred<boolean>();
    const appSettings = settingsController({
      update: vi.fn(() => pendingSave.promise)
    });
    const render = (controller: AppSettingsController) => {
      root.render(
        <ApplicationSettingsPage
          accounts={emptyAccounts()}
          appSettings={controller}
          gitEnvironment={null}
          initialSection="analysis"
          terminalProfiles={[]}
          workspace={null}
        />
      );
    };

    try {
      act(() => render(appSettings));
      const input = container.querySelector<HTMLInputElement>(
        "#lsp-command-typescript-language-server"
      );
      act(() => {
        setNativeInputValue(input, "submitted-language-server");
        input?.dispatchEvent(
          new Event("input", { bubbles: true })
        );
      });
      const save = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button")
      ).find((button) =>
        button.textContent?.includes(
          "保存代码分析设置"
        )
      );
      act(() => save?.click());
      act(() => {
        setNativeInputValue(input, "newer-language-server");
        input?.dispatchEvent(
          new Event("input", { bubbles: true })
        );
      });

      await act(async () => {
        pendingSave.resolve(true);
        await pendingSave.promise;
      });
      act(() =>
        render({
          ...appSettings,
          settings: {
            ...appSettings.settings,
            appearance: { theme: "light" },
            codeAnalysis: {
              ...appSettings.settings.codeAnalysis,
              typescript: {
                ...appSettings.settings.codeAnalysis.typescript,
                command: "submitted-language-server"
              }
            }
          }
        })
      );

      expect(
        container.querySelector<HTMLInputElement>(
          "#lsp-command-typescript-language-server"
        )?.value
      ).toBe("newer-language-server");
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("edits and saves configurable analysis limits", async () => {
    vi.stubGlobal("React", React);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const update = vi.fn(async () => true);
    const appSettings = settingsController({ update });

    try {
      act(() => {
        root.render(
          <ApplicationSettingsPage
            accounts={emptyAccounts()}
            appSettings={appSettings}
            gitEnvironment={null}
            initialSection="analysis"
            terminalProfiles={[]}
            workspace={null}
          />
        );
      });
      const input = container.querySelector<HTMLInputElement>(
        "#analysis-max-graph-nodes"
      );
      expect(input?.value).toBe(
        String(DEFAULT_CODE_ANALYSIS_GRAPH_NODES)
      );
      expect(input?.min).toBe(
        String(MIN_CODE_ANALYSIS_GRAPH_NODES)
      );
      expect(input?.max).toBe(
        String(MAX_CODE_ANALYSIS_GRAPH_NODES)
      );
      expect(input?.step).toBe("1000");
      const totalSourceInput =
        container.querySelector<HTMLInputElement>(
          "#analysis-max-total-source"
        );
      expect(totalSourceInput?.min).toBe(
        String(MIN_CODE_ANALYSIS_TOTAL_SOURCE_MB)
      );
      expect(totalSourceInput?.max).toBe(
        String(MAX_CODE_ANALYSIS_TOTAL_SOURCE_MB)
      );
      const graphEdgesInput =
        container.querySelector<HTMLInputElement>(
          "#analysis-max-graph-edges"
        );
      expect(graphEdgesInput?.min).toBe(
        String(MIN_CODE_ANALYSIS_GRAPH_EDGES)
      );
      expect(graphEdgesInput?.max).toBe(
        String(MAX_CODE_ANALYSIS_GRAPH_EDGES)
      );
      expect(graphEdgesInput?.value).toBe(
        String(DEFAULT_CODE_ANALYSIS_GRAPH_EDGES)
      );
      const requestChainsInput =
        container.querySelector<HTMLInputElement>(
          "#analysis-max-request-chains"
        );
      expect(requestChainsInput?.min).toBe(
        String(MIN_CODE_ANALYSIS_REQUEST_CHAINS)
      );
      expect(requestChainsInput?.max).toBe(
        String(MAX_CODE_ANALYSIS_REQUEST_CHAINS)
      );
      const diagnosticsInput =
        container.querySelector<HTMLInputElement>(
          "#analysis-max-diagnostics"
        );
      expect(diagnosticsInput?.min).toBe(
        String(MIN_CODE_ANALYSIS_DIAGNOSTICS)
      );
      expect(diagnosticsInput?.max).toBe(
        String(MAX_CODE_ANALYSIS_DIAGNOSTICS)
      );
      expect(
        container.querySelector<HTMLInputElement>(
          "#analysis-concurrency"
        )?.value
      ).toBe("4");
      expect(
        container.querySelector<HTMLInputElement>(
          "#analysis-graph-depth"
        )?.value
      ).toBe("8");
      const performanceFields = container.querySelectorAll(
        ".settings-card-body > .analysis-settings-number-grid .gn-input-field"
      );
      expect(performanceFields).toHaveLength(10);
      for (const field of performanceFields) {
        expect(
          field.querySelector(".gn-input-field__help")
        ).not.toBeNull();
      }
      expect(
        input
          ?.closest(".gn-input-field")
          ?.querySelector(".gn-input-field__help")
          ?.getAttribute("title")
      ).toBe(
        "提高上限会增加分析耗时、内存占用和快照体积。"
      );

      act(() => {
        setNativeInputValue(input, "45000");
        input?.dispatchEvent(
          new Event("input", { bubbles: true })
        );
        setNativeInputValue(graphEdgesInput, "120000");
        graphEdgesInput?.dispatchEvent(
          new Event("input", { bubbles: true })
        );
      });
      const save = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button")
      ).find((button) =>
        button.textContent?.includes(
          "保存代码分析设置"
        )
      );
      await act(async () => {
        save?.click();
        await Promise.resolve();
      });

      expect(update).toHaveBeenCalledWith(
        {
          codeAnalysis: expect.objectContaining({
            maxGraphNodes: 45_000,
            maxGraphEdges: 120_000
          })
        },
        expect.objectContaining({
          notice: expect.stringContaining("代码分析设置已保存")
        })
      );
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});

function setNativeInputValue(
  input: HTMLInputElement | null,
  value: string
): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  setter?.call(input, value);
}

function settingsController(
  overrides: Partial<AppSettingsController> = {}
): AppSettingsController {
  return {
    settings: createDefaultAppSettings(),
    loaded: true,
    loading: false,
    saving: false,
    clearingKey: false,
    error: null,
    notice: null,
    reload: vi.fn(async () => undefined),
    update: vi.fn(async () => true),
    clearAiApiKey: vi.fn(async () => true),
    clearFeedback: vi.fn(),
    ...overrides
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function emptyAccounts(): AccountController {
  return {
    overview: {
      accounts: [],
      bindings: []
    },
    removalImpact: null,
    active: null,
    error: null,
    notice: null,
    reload: vi.fn(async () => undefined),
    save: vi.fn(async () => false),
    bind: vi.fn(async () => false),
    unbind: vi.fn(async () => false),
    test: vi.fn(async () => false),
    requestRemoval: vi.fn(async () => false),
    confirmRemoval: vi.fn(async () => false),
    dismissRemoval: vi.fn(),
    clearFeedback: vi.fn()
  };
}
