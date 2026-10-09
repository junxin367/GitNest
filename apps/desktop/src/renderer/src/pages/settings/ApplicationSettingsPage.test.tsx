/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_CODE_ANALYSIS_PERIODIC_REFRESH_MINUTES,
  DEFAULT_CODE_ANALYSIS_GRAPH_EDGES,
  DEFAULT_CODE_ANALYSIS_GRAPH_NODES,
  DEFAULT_MCP_MAX_STALE_AGE_DAYS,
  MAX_CODE_ANALYSIS_DIAGNOSTICS,
  MAX_CODE_ANALYSIS_GRAPH_EDGES,
  MAX_CODE_ANALYSIS_GRAPH_NODES,
  MAX_CODE_ANALYSIS_PERIODIC_REFRESH_MINUTES,
  MAX_CODE_ANALYSIS_REQUEST_CHAINS,
  MAX_CODE_ANALYSIS_TOTAL_SOURCE_MB,
  MAX_LSP_DOCUMENTS,
  MAX_LSP_REQUESTS,
  MAX_MCP_MAX_STALE_AGE_DAYS,
  MIN_CODE_ANALYSIS_DIAGNOSTICS,
  MIN_CODE_ANALYSIS_GRAPH_EDGES,
  MIN_CODE_ANALYSIS_GRAPH_NODES,
  MIN_CODE_ANALYSIS_PERIODIC_REFRESH_MINUTES,
  MIN_CODE_ANALYSIS_REQUEST_CHAINS,
  MIN_CODE_ANALYSIS_TOTAL_SOURCE_MB,
  MIN_LSP_DOCUMENTS,
  MIN_LSP_REQUESTS,
  MIN_MCP_MAX_STALE_AGE_DAYS,
  createDefaultAppSettings,
  type ExternalTerminalProfileDto,
  type GitEnvironmentDto
} from "@gitnest/contracts";

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
          appSettings={settingsController()}
          gitEnvironment={null}
          terminalProfiles={[]}
        />
      );
      const document = new DOMParser().parseFromString(
        html,
        "text/html"
      );
      expect(document.querySelector(".settings-sidebar h1")?.textContent).toBe("设置");
      expect(document.querySelector(".settings-sidebar nav")).not.toBeNull();
      const navigationLabels = Array.from(
        document.querySelectorAll(
          'nav[aria-label="设置分组"] .settings-nav-item'
        )
      ).map((button) =>
        button
          .querySelector(".settings-nav-item-title")
          ?.textContent?.trim()
      );

      expect(navigationLabels).toEqual([
        "通用",
        "代码分析",
        "AI 提交信息",
        "Git",
        "账号与认证"
      ]);
      expect(
        Array.from(
          document.querySelectorAll(
            'nav[aria-label="设置分组"] .settings-nav-subitem'
          )
        ).map((button) => button.textContent?.trim())
      ).toEqual(["应用行为", "默认终端", "当前偏好"]);
      expect(
        document.querySelector(
          'nav[aria-label="设置分组"] .settings-nav-subitem[aria-current="location"]'
        )?.textContent
      ).toBe("应用行为");
      expect(html).not.toContain("快捷键");
      expect(html).not.toContain("危险操作前确认");
      expect(html).not.toContain("危险操作始终确认");
      expect(html).not.toContain("无法在设置中关闭");
      expect(html).not.toContain("重新读取");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("expands card navigation, scrolls to anchors, and tracks the visible card", async () => {
    vi.stubGlobal("React", React);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const scrollIntoView = vi.fn();
    const originalScrollIntoView =
      Object.getOwnPropertyDescriptor(
        HTMLElement.prototype,
        "scrollIntoView"
      );
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      {
        configurable: true,
        value: scrollIntoView
      }
    );

    try {
      await act(async () => {
        root.render(
          <ApplicationSettingsPage
            appSettings={settingsController()}
            gitEnvironment={null}
            terminalProfiles={[]}
          />
        );
      });
      const gitNavigationItem = Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          ".settings-nav-item"
        )
      ).find(
        (button) =>
          button.querySelector(".settings-nav-item-title")
            ?.textContent === "Git"
      );
      await act(async () => {
        gitNavigationItem?.click();
      });

      expect(
        Array.from(
          container.querySelectorAll(".settings-nav-subitem")
        ).map((button) => button.textContent?.trim())
      ).toEqual([
        "Git 运行环境",
        "远程检查策略",
        "Push 同步策略"
      ]);
      expect(
        container.querySelector(
          '.settings-nav-subitem[aria-current="location"]'
        )?.textContent
      ).toBe("Git 运行环境");

      scrollIntoView.mockClear();
      const pushNavigationItem = Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          ".settings-nav-subitem"
        )
      ).find(
        (button) => button.textContent === "Push 同步策略"
      );
      await act(async () => {
        pushNavigationItem?.click();
      });
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start"
      });
      expect(
        container.querySelector(
          '.settings-nav-subitem[aria-current="location"]'
        )?.textContent
      ).toBe("Push 同步策略");

      const scrollHost = container.querySelector<HTMLElement>(
        ".settings-page-scroll"
      );
      const environmentCard =
        container.querySelector<HTMLElement>(
          "#settings-git-environment"
        );
      const fetchCard = container.querySelector<HTMLElement>(
        "#settings-git-fetch"
      );
      const pushCard = container.querySelector<HTMLElement>(
        "#settings-git-push"
      );
      scrollHost?.dispatchEvent(new Event("scrollend"));
      Object.defineProperties(scrollHost, {
        clientHeight: {
          configurable: true,
          value: 800
        },
        scrollHeight: {
          configurable: true,
          value: 2000
        },
        scrollTop: {
          configurable: true,
          value: 600
        }
      });
      vi.spyOn(
        scrollHost as HTMLElement,
        "getBoundingClientRect"
      ).mockReturnValue(rectAt(0, 800));
      vi.spyOn(
        environmentCard as HTMLElement,
        "getBoundingClientRect"
      ).mockReturnValue(rectAt(-400));
      vi.spyOn(
        fetchCard as HTMLElement,
        "getBoundingClientRect"
      ).mockReturnValue(rectAt(40));
      vi.spyOn(
        pushCard as HTMLElement,
        "getBoundingClientRect"
      ).mockReturnValue(rectAt(500));

      await act(async () => {
        scrollHost?.dispatchEvent(
          new Event("scroll", { bubbles: true })
        );
      });
      expect(
        container.querySelector(
          '.settings-nav-subitem[aria-current="location"]'
        )?.textContent
      ).toBe("远程检查策略");
    } finally {
      act(() => root.unmount());
      container.remove();
      if (originalScrollIntoView) {
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollIntoView",
          originalScrollIntoView
        );
      } else {
        Reflect.deleteProperty(
          HTMLElement.prototype,
          "scrollIntoView"
        );
      }
      vi.unstubAllGlobals();
    }
  });

  it("updates the main-window close behavior", () => {
    vi.stubGlobal("React", React);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const appSettings = settingsController();

    try {
      act(() => {
        root.render(
          <ApplicationSettingsPage
            appSettings={appSettings}
            gitEnvironment={null}
            terminalProfiles={[]}
          />
        );
      });

      const trayOption = Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          ".settings-option"
        )
      ).find((button) =>
        button.textContent?.includes("最小化到托盘")
      );
      const quitOption = Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          ".settings-option"
        )
      ).find((button) =>
        button.textContent?.includes("退出应用")
      );

      expect(trayOption?.getAttribute("aria-pressed")).toBe(
        "false"
      );
      expect(quitOption?.getAttribute("aria-pressed")).toBe(
        "true"
      );
      act(() => trayOption?.click());
      expect(appSettings.update).toHaveBeenCalledWith({
        general: { closeBehavior: "tray" }
      });
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("derives the first-load skeleton from the inert real settings layout", () => {
    vi.stubGlobal("React", React);
    try {
      const html = renderToStaticMarkup(
        <ApplicationSettingsPage
          appSettings={settingsController({
            loaded: false,
            loading: true
          })}
          gitEnvironment={null}
          terminalProfiles={[]}
        />
      );

      expect(html).toContain("gn-skeleton-surface");
      expect(html).toContain("application-settings-page");
      expect(html).toContain('aria-label="正在读取应用设置"');
      expect(html).toContain("settings-nav-item-title");
      expect(html).toContain('class="gn-auto-skeleton-content" inert="" aria-hidden="true"');
      expect(html).not.toContain("应用设置读取失败");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows a retryable first-read failure instead of editable default settings", () => {
    vi.stubGlobal("React", React);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const appSettings = settingsController({
      loaded: false,
      loading: false,
      error: {
        code: "COMMAND_FAILED",
        message: "settings unavailable",
        details: {}
      }
    });
    try {
      act(() => {
        root.render(
          <ApplicationSettingsPage
            appSettings={appSettings}
            gitEnvironment={null}
            terminalProfiles={[]}
          />
        );
      });
      expect(container.textContent).toContain("settings unavailable");
      expect(container.querySelector(".settings-layout")).toBeNull();
      expect(container.querySelector(".gn-skeleton-surface")).toBeNull();
      const retry = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button")
      ).find((button) => button.textContent?.includes("重新读取"));
      expect(retry).toBeDefined();
      act(() => retry?.click());
      expect(appSettings.reload).toHaveBeenCalledOnce();
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("only shows the saved-terminal warning when an available fallback is selected", () => {
    vi.stubGlobal("React", React);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const settings = createDefaultAppSettings();
    settings.general.defaultTerminalKind = "git-bash";
    const terminalLabel = "PowerShell 团队专用终端".repeat(8);
    try {
      act(() => root.render(
        <ApplicationSettingsPage
          appSettings={settingsController({ loaded: false, loading: true })}
          gitEnvironment={null}
          terminalProfiles={[]}
        />
      ));
      expect(container.querySelector(".settings-inline-warning")).toBeNull();
      expect(container.querySelector(".settings-terminal-note")).toBeNull();
      act(() => root.render(
        <ApplicationSettingsPage
          appSettings={settingsController({ settings })}
          gitEnvironment={null}
          terminalProfiles={[{
            kind: "powershell",
            label: terminalLabel
          }]}
        />
      ));
      const warning = container.querySelector(".settings-inline-warning");
      expect(warning?.textContent).toContain("已保存的终端当前不可用，暂时回退到");
      expect(warning?.textContent).toContain(terminalLabel);
      expect(warning?.textContent).toContain("原选择会被保留");
      act(() => root.render(
        <ApplicationSettingsPage
          appSettings={settingsController({ settings })}
          gitEnvironment={null}
          terminalProfiles={[{ kind: "git-bash", label: "Git Bash" }]}
        />
      ));
      expect(container.querySelector(".settings-inline-warning")).toBeNull();
      act(() => root.render(
        <ApplicationSettingsPage
          appSettings={settingsController({ settings })}
          gitEnvironment={null}
          terminalProfiles={[]}
        />
      ));
      expect(container.querySelector(".settings-inline-warning")).toBeNull();
      act(() => root.render(
        <ApplicationSettingsPage
          appSettings={settingsController()}
          gitEnvironment={null}
          terminalProfiles={[{ kind: "powershell", label: terminalLabel }]}
        />
      ));
      expect(container.querySelector(".settings-inline-warning")).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("defers analysis registration reads and portal feedback until settings are loaded", async () => {
    vi.stubGlobal("React", React);
    const getMcpRegistration = vi.fn(async () => ({
      ok: false,
      error: { code: "COMMAND_FAILED", message: "registration unavailable" }
    }));
    vi.stubGlobal("gitnest", { codeAnalysis: { getMcpRegistration } });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (loaded: boolean) => root.render(
      <ApplicationSettingsPage
        appSettings={settingsController({
          loaded,
          loading: !loaded,
          notice: "loaded feedback"
        })}
        gitEnvironment={null}
        initialSection="analysis"
        terminalProfiles={[]}
      />
    );
    try {
      await act(async () => render(false));
      expect(container.querySelector("#settings-analysis-codex")).not.toBeNull();
      expect(getMcpRegistration).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain("loaded feedback");
      expect(container.querySelector(".gn-auto-skeleton-content")?.hasAttribute("inert")).toBe(true);
      await act(async () => render(true));
      expect(getMcpRegistration).toHaveBeenCalledOnce();
      expect(document.body.textContent).toContain("registration unavailable");
      expect(container.querySelector(".gn-auto-skeleton-content")?.hasAttribute("inert")).toBe(false);
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("keeps loaded settings visible during a background reload", () => {
    vi.stubGlobal("React", React);
    try {
      const html = renderToStaticMarkup(
        <ApplicationSettingsPage
          appSettings={settingsController({ loading: true })}
          gitEnvironment={null}
          terminalProfiles={[]}
        />
      );
      expect(html).toContain("settings-nav-item-title");
      expect(html).not.toContain("gn-skeleton-surface");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows only system Git authentication in the account section", () => {
    vi.stubGlobal("React", React);
    try {
      const html = renderToStaticMarkup(
        <ApplicationSettingsPage
          appSettings={settingsController()}
          gitEnvironment={null}
          initialSection="account"
          terminalProfiles={[]}
        />
      );
      const document = new DOMParser().parseFromString(
        html,
        "text/html"
      );
      const titles = Array.from(
        document.querySelectorAll(".settings-card-title")
      ).map((item) => item.textContent?.trim());
      const activeNavigationItem = document.querySelector(
        'nav[aria-label="设置分组"] button[aria-current="page"]'
      );

      expect(titles).toEqual(["系统 Git 认证"]);
      expect(activeNavigationItem?.textContent).toContain(
        "系统 Git 凭据"
      );
      expect(html).toContain(
        "所有远程 Git 操作均使用系统认证"
      );
      expect(html).not.toContain("添加 GitNest 账号");
      expect(html).not.toContain("GitNest 账号中心");
      expect(html).not.toContain("HTTPS Token");
      expect(html).not.toContain("仓库绑定");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("groups the current preferences by their purpose", () => {
    vi.stubGlobal("React", React);
    try {
      const html = renderToStaticMarkup(
        <ApplicationSettingsPage
          appSettings={settingsController()}
          gitEnvironment={null}
          terminalProfiles={[]}
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
        差异查看: ["Diff 布局", "自动换行"],
        提交体验: ["提交区域高度"]
      });
      expect(html).not.toContain("界面主题");
      expect(html).not.toContain("文件浏览");
      expect(html).not.toContain("变更文件视图");
      expect(html).not.toContain("树形目录");
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
            appSettings={appSettings}
            gitEnvironment={null}
            terminalProfiles={terminalProfiles}
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

  it("matches the prototype Git environment information card", () => {
    vi.stubGlobal("React", React);
    const gitEnvironment: GitEnvironmentDto = {
      executablePath: "C:\\Program Files\\Git\\cmd\\git.exe",
      version: "2.53.0.windows.3",
      lfs: {
        available: true,
        version: "3.7.1"
      },
      identity: {
        name: "GitNest User",
        email: "gitnest@example.com"
      },
      credentialHelpers: ["manager"],
      ssh: {
        command: "ssh",
        authSockConfigured: true,
        configPath: "C:\\Users\\test\\.ssh\\config",
        configExists: true
      },
      detectedAt: "2026-09-24T00:00:00.000Z"
    };

    try {
      const html = renderToStaticMarkup(
        <ApplicationSettingsPage
          appSettings={settingsController()}
          gitEnvironment={gitEnvironment}
          initialSection="git"
          terminalProfiles={[]}
        />
      );
      const document = new DOMParser().parseFromString(
        html,
        "text/html"
      );
      const card = Array.from(
        document.querySelectorAll(".settings-card")
      ).find(
        (item) =>
          item.querySelector(".settings-card-title")?.textContent ===
          "Git 运行环境"
      );
      const badge = card?.querySelector(
        ".settings-card-header > .status-pill"
      );
      const items = card?.querySelectorAll(".settings-info-item");

      expect(badge?.textContent).toContain("可用");
      expect(badge?.classList.contains("green")).toBe(true);
      expect(badge?.querySelector(".icon")).not.toBeNull();
      expect(items).toHaveLength(2);
      expect(card?.textContent).toContain("Git 版本");
      expect(card?.textContent).toContain(gitEnvironment.version);
      expect(card?.textContent).toContain("执行文件");
      expect(card?.textContent).toContain(
        gitEnvironment.executablePath
      );
      expect(card?.querySelector(".detail-list")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reveals a stored AI API Key on demand without rewriting it", async () => {
    vi.stubGlobal("React", React);
    const readAiApiKey = vi.fn(
      async ({ reveal }: { reveal: boolean }) => ({
        ok: true as const,
        value: {
          apiKey: reveal ? "sk-stored-secret" : null,
          length: 16
        }
      })
    );
    vi.stubGlobal("gitnest", {
      settings: { readAiApiKey }
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const settings = createDefaultAppSettings();
    settings.ai.apiKeyConfigured = true;
    const appSettings = settingsController({ settings });

    try {
      await act(async () => {
        root.render(
          <ApplicationSettingsPage
            appSettings={appSettings}
            gitEnvironment={null}
            initialSection="ai"
            terminalProfiles={[]}
          />
        );
        await Promise.resolve();
      });

      const getKeyInput = () =>
        container.querySelector<HTMLInputElement>("#ai-api-key");
      const keyInput = getKeyInput();
      expect(keyInput?.type).toBe("password");
      expect(keyInput?.value).toBe("*".repeat(16));
      expect(keyInput?.readOnly).toBe(true);
      expect(container.textContent).not.toContain("清空 Key");
      expect(readAiApiKey).toHaveBeenCalledWith({
        reveal: false
      });

      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            '[aria-label="显示 API Key"]'
          )
          ?.click();
        await Promise.resolve();
      });

      expect(readAiApiKey).toHaveBeenCalledTimes(2);
      expect(readAiApiKey).toHaveBeenLastCalledWith({
        reveal: true
      });
      expect(getKeyInput()?.type).toBe("text");
      expect(getKeyInput()?.value).toBe("sk-stored-secret");
      expect(getKeyInput()?.readOnly).toBe(false);

      act(() => {
        container
          .querySelector<HTMLButtonElement>(
            '[aria-label="隐藏 API Key"]'
          )
          ?.click();
      });
      expect(getKeyInput()?.type).toBe("password");
      expect(getKeyInput()?.value).toBe("*".repeat(16));
      expect(getKeyInput()?.readOnly).toBe(true);

      const save = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button")
      ).find((button) =>
        button.textContent?.includes("保存 AI 设置")
      );
      await act(async () => {
        save?.click();
        await Promise.resolve();
      });

      const savedAiPatch = vi.mocked(appSettings.update).mock
        .calls.at(-1)?.[0].ai;
      expect(savedAiPatch).not.toHaveProperty("apiKey");
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("ignores a late key reveal after leaving AI settings and allows a fresh reveal", async () => {
    vi.stubGlobal("React", React);
    const firstReveal = deferred<{
      ok: true;
      value: { apiKey: string; length: number };
    }>();
    const secondReveal = deferred<{
      ok: true;
      value: { apiKey: string; length: number };
    }>();
    const reveal = vi.fn()
      .mockReturnValueOnce(firstReveal.promise)
      .mockReturnValueOnce(secondReveal.promise);
    vi.stubGlobal("gitnest", {
      settings: {
        readAiApiKey: vi.fn(({ reveal: requested }: { reveal: boolean }) =>
          requested
            ? reveal()
            : Promise.resolve({
                ok: true,
                value: { apiKey: null, length: 15 }
              })
        )
      }
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const settings = createDefaultAppSettings();
    settings.ai.apiKeyConfigured = true;
    const appSettings = settingsController({ settings });
    const render = (section: "ai" | "general") =>
      root.render(
        <ApplicationSettingsPage
          appSettings={appSettings}
          gitEnvironment={null}
          initialSection={section}
          terminalProfiles={[]}
        />
      );
    const revealButton = () =>
      container.querySelector<HTMLButtonElement>(
        '[aria-label="显示 API Key"]'
      )!;

    try {
      await act(async () => render("ai"));
      act(() => revealButton().click());
      await act(async () => render("general"));
      await act(async () => render("ai"));
      expect(revealButton().disabled).toBe(false);
      act(() => revealButton().click());

      await act(async () =>
        firstReveal.resolve({
          ok: true,
          value: { apiKey: "fake-old-secret", length: 15 }
        })
      );
      expect(
        container.querySelector<HTMLInputElement>("#ai-api-key")?.type
      ).toBe("password");
      expect(revealButton().disabled).toBe(true);

      await act(async () =>
        secondReveal.resolve({
          ok: true,
          value: { apiKey: "fake-new-secret", length: 15 }
        })
      );
      expect(
        container.querySelector<HTMLInputElement>("#ai-api-key")?.value
      ).toBe("fake-new-secret");
      expect(
        container.querySelector<HTMLInputElement>("#ai-api-key")?.type
      ).toBe("text");
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("saves a newly entered AI API Key while hiding it by default", async () => {
    vi.stubGlobal("React", React);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const appSettings = settingsController();

    try {
      act(() => {
        root.render(
          <ApplicationSettingsPage
            appSettings={appSettings}
            gitEnvironment={null}
            initialSection="ai"
            terminalProfiles={[]}
          />
        );
      });

      const getKeyInput = () =>
        container.querySelector<HTMLInputElement>("#ai-api-key");
      const keyInput = getKeyInput();
      expect(keyInput?.type).toBe("password");
      expect(keyInput?.readOnly).toBe(false);

      act(() => {
        setNativeInputValue(keyInput, "sk-current-draft");
        keyInput?.dispatchEvent(
          new Event("input", { bubbles: true })
        );
        container
          .querySelector<HTMLButtonElement>(
            '[aria-label="显示 API Key"]'
          )
          ?.click();
      });
      expect(getKeyInput()?.type).toBe("text");
      expect(getKeyInput()?.value).toBe("sk-current-draft");

      await act(async () => {
        Array.from(
          container.querySelectorAll<HTMLButtonElement>("button")
        )
          .find((button) =>
            button.textContent?.includes("保存 AI 设置")
          )
          ?.click();
        await Promise.resolve();
      });

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

  it.each(["success", "failure", "rejection"] as const)(
    "ignores an outdated AI connection %s after editing and lets the user test again",
    async (outcome) => {
      vi.stubGlobal("React", React);
      const firstTest = deferred<unknown>();
      const testConnection = vi.fn()
        .mockReturnValueOnce(firstTest.promise)
        .mockResolvedValue({
          ok: true,
          value: { model: "new-model", endpoint: "https://new.example/v1" }
        });
      vi.stubGlobal("gitnest", { ai: { testConnection } });
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const settings = createDefaultAppSettings();
      settings.ai.apiUrl = "https://old.example/v1";
      settings.ai.model = "old-model";
      const testButton = () => Array.from(
        container.querySelectorAll<HTMLButtonElement>("button")
      ).find((button) => /测试连接|测试中/.test(button.textContent ?? ""))!;
      const edit = (id: string, value: string) => {
        const input = container.querySelector<HTMLInputElement>(id);
        setNativeInputValue(input, value);
        input?.dispatchEvent(new Event("input", { bubbles: true }));
      };

      try {
        act(() => root.render(
          <ApplicationSettingsPage
            appSettings={settingsController({ settings })}
            gitEnvironment={null}
            initialSection="ai"
            terminalProfiles={[]}
          />
        ));
        act(() => edit("#ai-api-key", "fake-test-key"));
        act(() => testButton().click());
        expect(testButton().disabled).toBe(true);
        expect(testConnection).toHaveBeenCalledTimes(1);
        act(() => {
          edit("#ai-api-url", "https://new.example/v1");
          edit("#ai-model", "new-model");
        });

        await act(async () => firstTest.resolve(
          outcome === "success"
            ? {
                ok: true,
                value: { model: "old-model", endpoint: "https://old.example/v1" }
              }
            : outcome === "failure"
              ? {
                  ok: false,
                  error: { code: "COMMAND_FAILED", message: "old connection failed" }
                }
              : Promise.reject(new Error("old transport failed"))
        ));

        expect(document.body.textContent).not.toContain("AI 连接测试成功");
        expect(document.body.textContent).not.toContain("AI 连接测试失败");
        expect(testButton().disabled).toBe(false);
        await act(async () => testButton().click());
        expect(testConnection).toHaveBeenLastCalledWith({
          apiUrl: "https://new.example/v1",
          model: "new-model",
          apiKey: "fake-test-key"
        });
        expect(document.body.textContent).toContain("AI 连接测试成功");
        expect(document.body.textContent).toContain("new-model");
        act(() => edit("#ai-model", "third-model"));
        expect(document.body.textContent).not.toContain("AI 连接测试成功");
      } finally {
        act(() => root.unmount());
        container.remove();
        vi.unstubAllGlobals();
      }
    }
  );

  it("preserves unsaved AI fields across unrelated settings updates", () => {
    vi.stubGlobal("React", React);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const appSettings = settingsController();
    const render = (controller: AppSettingsController) => {
      root.render(
        <ApplicationSettingsPage
          appSettings={controller}
          gitEnvironment={null}
          initialSection="ai"
          terminalProfiles={[]}
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
          appSettings={controller}
          gitEnvironment={null}
          initialSection="analysis"
          terminalProfiles={[]}
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

  it.each([
    ["忽略目录", "#analysis-ignore-directories"],
    ["LSP 启动参数", "#lsp-args-typescript-language-server"]
  ])("preserves typed multiline %s drafts until a successful save", async (_, selector) => {
    vi.stubGlobal("React", React);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const update = vi.fn<AppSettingsController["update"]>(async () => false);
    const appSettings = settingsController({ update });
    const render = (controller = appSettings) =>
      root.render(
        <ApplicationSettingsPage
          appSettings={controller}
          gitEnvironment={null}
          initialSection="analysis"
          terminalProfiles={[]}
        />
      );
    const input = () =>
      container.querySelector<HTMLTextAreaElement>(selector)!;
    const setText = (value: string) => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )?.set?.call(input(), value);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    };
    const save = () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("保存代码分析设置"))!
        .click();

    try {
      act(() => render());
      act(() => setText(""));
      const draft = "first\n\n second \n";
      for (const character of draft) {
        const expected = input().value + character;
        act(() => setText(expected));
        expect(input().value).toBe(expected);
      }

      if (selector.includes("lsp-args")) {
        act(() =>
          container.querySelector<HTMLButtonElement>(
            '[data-language-server-id="java"]'
          )?.click()
        );
        act(() =>
          container.querySelector<HTMLButtonElement>(
            '[data-language-server-id="typescript"]'
          )?.click()
        );
      }
      expect(input().value).toBe(draft);

      await act(async () => save());
      const patch = update.mock.calls.at(-1)?.[0] as
        Parameters<AppSettingsController["update"]>[0] | undefined;
      expect(
        selector.includes("lsp-args")
          ? patch?.codeAnalysis?.typescript?.args
          : patch?.codeAnalysis?.ignoreDirectories
      ).toEqual(["first", "second"]);
      expect(input().value).toBe(draft);

      act(() =>
        render({
          ...appSettings,
          settings: {
            ...appSettings.settings,
            codeAnalysis: {
              ...appSettings.settings.codeAnalysis,
              ignoreDirectories: ["external"],
              typescript: {
                ...appSettings.settings.codeAnalysis.typescript,
                args: ["external"]
              }
            }
          }
        })
      );
      expect(input().value).toBe(draft);

      update.mockResolvedValue(true);
      await act(async () => save());
      expect(input().value).toBe("first\nsecond");
      act(() =>
        render({
          ...appSettings,
          settings: {
            ...appSettings.settings,
            codeAnalysis: {
              ...appSettings.settings.codeAnalysis,
              ignoreDirectories: ["reloaded"],
              typescript: {
                ...appSettings.settings.codeAnalysis.typescript,
                args: ["reloaded"]
              }
            }
          }
        })
      );
      expect(input().value).toBe("reloaded");
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
            appSettings={settingsController()}
            gitEnvironment={null}
            initialSection="analysis"
            terminalProfiles={[]}
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
            appSettings={appSettings}
            gitEnvironment={null}
            initialSection="ai"
            terminalProfiles={[]}
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
          appSettings={controller}
          gitEnvironment={null}
          initialSection="analysis"
          terminalProfiles={[]}
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
            appSettings={appSettings}
            gitEnvironment={null}
            initialSection="analysis"
            terminalProfiles={[]}
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
      const periodicRefreshInput =
        container.querySelector<HTMLInputElement>(
          "#analysis-periodic-refresh-minutes"
        );
      const autoRefreshDebounceInput =
        container.querySelector<HTMLInputElement>(
          "#analysis-auto-refresh-debounce-ms"
        );
      expect(periodicRefreshInput?.value).toBe(
        String(DEFAULT_CODE_ANALYSIS_PERIODIC_REFRESH_MINUTES)
      );
      expect(periodicRefreshInput?.min).toBe(
        String(MIN_CODE_ANALYSIS_PERIODIC_REFRESH_MINUTES)
      );
      expect(periodicRefreshInput?.max).toBe(
        String(MAX_CODE_ANALYSIS_PERIODIC_REFRESH_MINUTES)
      );
      expect(
        container.querySelector<HTMLButtonElement>(
          'button[aria-label="定时更新分析快照"]'
        )?.getAttribute("aria-pressed")
      ).toBe("true");
      expect(
        autoRefreshDebounceInput?.closest(
          ".mcp-registration-grid"
        )
      ).toBe(
        periodicRefreshInput?.closest(".mcp-registration-grid")
      );
      expect(
        autoRefreshDebounceInput
          ?.closest(".gn-input-field")
          ?.querySelector(".gn-input-field__help")
          ?.getAttribute("aria-hidden")
      ).toBe("true");
      expect(
        periodicRefreshInput
          ?.closest(".gn-input-field")
          ?.querySelector(".gn-input-field__help")
          ?.getAttribute("title")
      ).toBe(
        "最短 5 分钟；更新在后台运行，不切换当前代码分析视图。"
      );
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
        setNativeInputValue(periodicRefreshInput, "0");
        periodicRefreshInput?.dispatchEvent(
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
      expect(
        periodicRefreshInput?.getAttribute("aria-invalid")
      ).toBe("true");
      expect(save?.disabled).toBe(true);
      act(() => {
        setNativeInputValue(periodicRefreshInput, "120");
        periodicRefreshInput?.dispatchEvent(
          new Event("input", { bubbles: true })
        );
      });
      expect(save?.disabled).toBe(false);
      await act(async () => {
        save?.click();
        await Promise.resolve();
      });

      expect(update).toHaveBeenCalledWith(
        {
          codeAnalysis: expect.objectContaining({
            maxGraphNodes: 45_000,
            maxGraphEdges: 120_000,
            autoRefresh: expect.objectContaining({
              periodicEnabled: true,
              periodicIntervalMinutes: 120
            })
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

  it("exposes MCP controls under code analysis and saves only MCP settings", async () => {
    vi.stubGlobal("React", React);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const update = vi.fn(async () => true);

    try {
      await act(async () => {
        root.render(
          <ApplicationSettingsPage
            appSettings={settingsController({ update })}
            gitEnvironment={null}
            initialSection="analysis"
            terminalProfiles={[]}
          />
        );
      });
      expect(
        container.querySelector(
          'nav[aria-label="设置分组"] button[aria-current="page"] .settings-nav-item-title'
        )?.textContent
      ).toBe("代码分析");
      expect(container.querySelector("#analysis-max-graph-nodes"))
        .not.toBeNull();
      expect(
        Array.from(
          container.querySelectorAll(
            'nav[aria-label="设置分组"] .settings-nav-item-title'
          )
        ).some((item) => item.textContent?.trim() === "MCP")
      ).toBe(false);
      expect(container.textContent).toContain("MCP 服务");
      expect(container.textContent).toContain("Codex 连接");
      const mcpCard = Array.from(
        container.querySelectorAll<HTMLElement>(".settings-card")
      ).find(
        (card) =>
          card.querySelector(".settings-card-title")?.textContent ===
          "MCP 服务"
      );
      const mcpHeader = mcpCard?.querySelector(
        ".settings-card-header"
      );
      const mcpToggle = mcpCard?.querySelector<HTMLButtonElement>(
        'button[aria-label="启用 MCP 服务"]'
      );
      expect(mcpToggle?.parentElement).toBe(mcpHeader);
      expect(
        mcpCard?.querySelector(
          ".settings-card-body > .settings-setting-row"
        )
      ).toBeNull();
      expect(
        mcpCard?.querySelector(".settings-card-description")
          ?.textContent
      ).toContain("关闭后仅停止返回 MCP 数据");
      const responseLimit =
        container.querySelector<HTMLInputElement>(
          "#analysis-mcp-response-kb"
        );
      expect(responseLimit?.value).toBe("256");
      expect(responseLimit?.min).toBe("64");
      expect(responseLimit?.max).toBe("1024");
      const staleAgeInput =
        container.querySelector<HTMLInputElement>(
          "#analysis-mcp-max-stale-age-days"
        );
      expect(staleAgeInput?.value).toBe(
        String(DEFAULT_MCP_MAX_STALE_AGE_DAYS)
      );
      expect(staleAgeInput?.min).toBe(
        String(MIN_MCP_MAX_STALE_AGE_DAYS)
      );
      expect(staleAgeInput?.max).toBe(
        String(MAX_MCP_MAX_STALE_AGE_DAYS)
      );
      expect(
        responseLimit?.closest(".mcp-registration-grid")
      ).toBe(
        staleAgeInput?.closest(".mcp-registration-grid")
      );
      expect(
        responseLimit
          ?.closest(".gn-input-field")
          ?.querySelector(".gn-input-field__help")
          ?.getAttribute("aria-hidden")
      ).toBe("true");
      expect(
        staleAgeInput
          ?.closest(".gn-input-field")
          ?.querySelector(".gn-input-field__help")
          ?.getAttribute("title")
      ).toBe(
        "仅限制已确认陈旧或无法验证的快照；与当前源码一致的快照不会因时间过期。"
      );
      const toggle = (label: string) =>
        container.querySelector<HTMLButtonElement>(
          `button[aria-label="${label}"]`
        );
      act(() => {
        toggle("启用 MCP 服务")?.click();
        setNativeInputValue(responseLimit, "512");
        responseLimit?.dispatchEvent(
          new Event("input", { bubbles: true })
        );
        setNativeInputValue(staleAgeInput, "14");
        staleAgeInput?.dispatchEvent(
          new Event("input", { bubbles: true })
        );
      });
      expect(toggle("允许返回源码片段")).toBeNull();
      const save = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button")
      ).find((button) =>
        button.textContent?.includes("保存 MCP 设置")
      );
      await act(async () => {
        save?.click();
        await Promise.resolve();
      });

      expect(update).toHaveBeenCalledWith(
        {
          codeAnalysis: {
            mcp: {
              enabled: false,
              allowSourceSnippets: true,
              maxResponseKb: 512,
              maxStaleAgeDays: 14
            }
          }
        },
        { notice: "MCP 设置已保存。" }
      );
      act(() => {
        setNativeInputValue(staleAgeInput, "0");
        staleAgeInput?.dispatchEvent(
          new Event("input", { bubbles: true })
        );
      });
      expect(staleAgeInput?.getAttribute("aria-invalid")).toBe(
        "true"
      );
      expect(save?.disabled).toBe(true);
      expect(update).toHaveBeenCalledTimes(1);
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("keeps an unsaved LSP draft when MCP settings are saved", async () => {
    vi.stubGlobal("React", React);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const update = vi.fn(async () => true);
    const initial = settingsController({ update });
    const render = (appSettings: AppSettingsController) =>
      root.render(
        <ApplicationSettingsPage
          appSettings={appSettings}
          gitEnvironment={null}
          initialSection="analysis"
          terminalProfiles={[]}
        />
      );

    try {
      act(() => render(initial));
      const lspCommand =
        container.querySelector<HTMLInputElement>(
          "#lsp-command-typescript-language-server"
        );
      act(() => {
        setNativeInputValue(lspCommand, "pending-lsp-command");
        lspCommand?.dispatchEvent(
          new Event("input", { bubbles: true })
        );
      });
      await act(async () => {
        container.querySelector<HTMLButtonElement>(
          'button[aria-label="启用 MCP 服务"]'
        )?.click();
        Array.from(
          container.querySelectorAll<HTMLButtonElement>("button")
        ).find((button) =>
          button.textContent?.includes("保存 MCP 设置")
        )?.click();
        await Promise.resolve();
      });
      const persisted = {
        ...initial,
        settings: {
          ...initial.settings,
          codeAnalysis: {
            ...initial.settings.codeAnalysis,
            mcp: {
              ...initial.settings.codeAnalysis.mcp,
              enabled: false
            }
          }
        }
      };
      act(() => render(persisted));
      expect(
        container.querySelector<HTMLInputElement>(
          "#lsp-command-typescript-language-server"
        )?.value
      ).toBe("pending-lsp-command");
      await act(async () => {
        Array.from(
          container.querySelectorAll<HTMLButtonElement>("button")
        ).find((button) =>
          button.textContent?.includes("保存代码分析设置")
        )?.click();
        await Promise.resolve();
      });
      expect(update).toHaveBeenLastCalledWith(
        {
          codeAnalysis: expect.objectContaining({
            mcp: expect.objectContaining({ enabled: false }),
            typescript: expect.objectContaining({
              command: "pending-lsp-command"
            })
          })
        },
        expect.anything()
      );
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it.each(["failure", "rejection"] as const)(
    "retries a Codex registration read after dismissing its %s feedback",
    async (failureKind) => {
      vi.stubGlobal("React", React);
      const retry = deferred<unknown>();
      const getMcpRegistration = vi.fn()
        .mockImplementationOnce(async () => {
          if (failureKind === "rejection") {
            throw new Error("Registration read failed");
          }
          return {
            ok: false,
            error: { code: "COMMAND_FAILED", message: "Registration read failed" }
          };
        })
        .mockReturnValueOnce(retry.promise);
      const setMcpRegistration = vi.fn();
      vi.stubGlobal("gitnest", {
        codeAnalysis: { getMcpRegistration, setMcpRegistration }
      });
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);

      try {
        await act(async () => root.render(
          <ApplicationSettingsPage
            appSettings={settingsController()}
            gitEnvironment={null}
            initialSection="analysis"
            terminalProfiles={[]}
          />
        ));
        const card = container.querySelector("#settings-analysis-codex")!;
        expect(card.querySelectorAll(".mcp-registration-path")).toHaveLength(1);
        expect(card.textContent).not.toContain("数据目录");
        expect(card.textContent).not.toContain("读取后显示");
        expect(card.textContent).toContain("状态不可用");
        expect(document.body.textContent).toContain("Registration read failed");
        act(() => document.querySelector<HTMLButtonElement>(
          '[aria-label="关闭 MCP 注册提示"]'
        )?.click());

        expect(card.textContent).toContain("状态不可用");
        expect(card.textContent).not.toContain("正在读取");
        expect(getMcpRegistration).toHaveBeenCalledTimes(1);
        const retryButton = Array.from(
          card.querySelectorAll<HTMLButtonElement>("button")
        ).find((button) => button.textContent?.trim() === "重新读取");
        expect(retryButton).toBeDefined();
        act(() => retryButton!.click());
        expect(getMcpRegistration).toHaveBeenCalledTimes(2);
        expect(retryButton!.disabled).toBe(true);
        expect(retryButton!.textContent?.trim()).toBe("正在读取…");
        expect(card.querySelectorAll(".mcp-registration-path")).toHaveLength(1);
        expect(card.textContent).toContain("正在读取");
        act(() => retryButton!.click());
        expect(getMcpRegistration).toHaveBeenCalledTimes(2);

        await act(async () => retry.resolve({
          ok: true,
          value: {
            executablePath: "C:\\GitNest\\GitNest.exe",
            entryScriptPath: "C:\\GitNest\\resources\\mcp\\gitnest-mcp.mjs",
            dataDirectory: "C:\\GitNest\\user-data",
            command: "fixture command",
            configSnippet: "fixture config",
            registered: false,
            codexAvailable: true,
            serverAvailable: true,
            message: "尚未注册。"
          }
        }));
        expect(card.textContent).toContain("未注册");
        expect(card.textContent).not.toContain("正在读取");
        const directory = card.querySelectorAll(".mcp-registration-path")[1];
        expect(directory?.textContent).toContain("数据目录");
        expect(directory?.querySelector("code")?.textContent).toBe("C:\\GitNest\\user-data");
        expect(retryButton?.isConnected).toBe(false);
        expect(card.textContent).not.toContain("重新读取");
        const register = Array.from(
          card.querySelectorAll<HTMLButtonElement>("button")
        ).find((button) => button.textContent?.trim() === "一键注册");
        expect(register?.disabled).toBe(false);
        expect(setMcpRegistration).not.toHaveBeenCalled();
      } finally {
        act(() => root.unmount());
        container.remove();
        vi.unstubAllGlobals();
      }
    }
  );

  it("shows Codex registration status and invokes registration explicitly", async () => {
    vi.stubGlobal("React", React);
    const registration = {
      executablePath: "C:\\GitNest\\GitNest.exe",
      entryScriptPath: "C:\\GitNest\\resources\\mcp\\gitnest-mcp.mjs",
      dataDirectory: "C:\\Users\\test\\AppData\\GitNest",
      command: "codex mcp add GitNest_code_lsp -- ...",
      configSnippet: "[mcp_servers.GitNest_code_lsp]",
      registered: false,
      codexAvailable: true,
      serverAvailable: true,
      message: "尚未注册。"
    };
    const setMcpRegistration = vi.fn(async () => ({
      ok: true as const,
      value: {
        ...registration,
        registered: true,
        message: "已注册，重新启动 Codex 后生效。"
      }
    }));
    vi.stubGlobal("gitnest", {
      codeAnalysis: {
        getMcpRegistration: vi.fn(async () => ({
          ok: true,
          value: registration
        })),
        setMcpRegistration
      }
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <ApplicationSettingsPage
            appSettings={settingsController()}
            gitEnvironment={null}
            initialSection="analysis"
            terminalProfiles={[]}
          />
        );
      });
      expect(container.textContent).toContain(registration.dataDirectory);
      expect(container.textContent).not.toContain(registration.command);
      const registrationPanel = container.querySelector(
        ".mcp-registration"
      );
      const registrationCard = registrationPanel?.closest(
        ".settings-card"
      );
      const registrationBadge = registrationCard?.querySelector(
        ".settings-card-header > .status-pill"
      );
      const registrationActions = container.querySelector(
        ".mcp-registration-actions"
      );
      expect(registrationActions?.parentElement).toBe(
        registrationPanel
      );
      expect(registrationPanel?.lastElementChild).toBe(
        registrationActions
      );
      expect(
        registrationPanel?.querySelector(
          ".mcp-registration-command"
        )
      ).toBeNull();
      expect(
        registrationActions?.querySelectorAll("button")
      ).toHaveLength(1);
      expect(registrationActions?.textContent).not.toContain("重新读取");
      expect(registrationActions?.textContent).not.toContain("复制");
      expect(
        registrationPanel?.querySelector(
          ".mcp-registration-hint"
        )
      ).toBeNull();
      expect(
        registrationPanel?.querySelector(
          ".mcp-registration-status"
        )
      ).toBeNull();
      expect(registrationPanel?.textContent).toContain(
        "GitNest_code_lsp"
      );
      expect(registrationBadge?.textContent).toBe("未注册");
      expect(registrationBadge?.classList.contains("neutral")).toBe(
        true
      );
      expect(document.querySelector(".toast")).toBeNull();
      await act(async () => {
        Array.from(
          container.querySelectorAll<HTMLButtonElement>("button")
        ).find((button) =>
          button.textContent?.includes("一键注册")
        )?.click();
        await Promise.resolve();
      });
      expect(setMcpRegistration).toHaveBeenCalledWith({
        registered: true
      });
      expect(registrationBadge?.textContent).toBe("已注册");
      expect(registrationBadge?.classList.contains("green")).toBe(
        true
      );
      expect(document.querySelector(".toast")?.textContent).toContain(
        "MCP 已注册"
      );
      expect(document.querySelector(".toast")?.textContent).toContain(
        "已注册，重新启动 Codex 后生效。"
      );
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("does not offer an invalid registration command in a development build", async () => {
    vi.stubGlobal("React", React);
    const setMcpRegistration = vi.fn();
    vi.stubGlobal("gitnest", {
      codeAnalysis: {
        getMcpRegistration: vi.fn(async () => ({
          ok: true,
          value: {
            executablePath: "C:\\GitNest\\electron.exe",
            entryScriptPath: "C:\\GitNest\\resources\\mcp\\gitnest-mcp.mjs",
            dataDirectory: "C:\\GitNest\\user-data",
            command: "invalid development command",
            configSnippet: "invalid config",
            registered: false,
            codexAvailable: true,
            serverAvailable: false,
            message: "开发版不提供可注册的 MCP 入口。"
          }
        })),
        setMcpRegistration
      }
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <ApplicationSettingsPage
            appSettings={settingsController()}
            gitEnvironment={null}
            initialSection="analysis"
            terminalProfiles={[]}
          />
        );
      });
      const register = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button")
      ).find((button) =>
        button.textContent?.includes("一键注册")
      );
      expect(register?.disabled).toBe(true);
      const registrationBadge = container.querySelector(
        ".settings-card-header > .status-pill"
      );
      expect(registrationBadge?.textContent).toBe("注册不可用");
      expect(registrationBadge?.classList.contains("red")).toBe(true);
      expect(document.querySelector(".toast")?.textContent).toContain(
        "开发版不提供"
      );
      expect(
        container.querySelector(".mcp-registration-hint")
      ).toBeNull();
      expect(container.textContent).not.toContain(
        "invalid development command"
      );
      expect(setMcpRegistration).not.toHaveBeenCalled();
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

function rectAt(top: number, height = 100): DOMRect {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: 100,
    top,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => ({})
  };
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
