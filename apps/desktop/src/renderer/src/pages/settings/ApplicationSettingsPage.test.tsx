/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
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
      expect(html).toContain("危险操作始终确认");
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

  it("shows, hides, and preserves the current AI API Key after saving", async () => {
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
      expect(keyInput?.type).toBe("text");

      act(() => {
        setNativeInputValue(keyInput, "sk-current-draft");
        keyInput?.dispatchEvent(
          new Event("input", { bubbles: true })
        );
      });

      const hideKey = container.querySelector<HTMLButtonElement>(
        '[aria-label="隐藏 API Key"]'
      );
      act(() => hideKey?.click());
      expect(getKeyInput()?.type).toBe("password");
      expect(getKeyInput()?.value).toBe("sk-current-draft");

      const showKey = container.querySelector<HTMLButtonElement>(
        '[aria-label="显示 API Key"]'
      );
      act(() => showKey?.click());
      expect(getKeyInput()?.type).toBe("text");

      const save = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button")
      ).find((button) =>
        button.textContent?.includes("保存 AI 设置")
      );
      await act(async () => {
        save?.click();
        await Promise.resolve();
      });

      expect(getKeyInput()?.value).toBe("sk-current-draft");
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
