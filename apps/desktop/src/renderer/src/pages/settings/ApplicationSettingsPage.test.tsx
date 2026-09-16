/** @vitest-environment jsdom */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createDefaultAppSettings } from "@gitnest/contracts";

import type { AccountController } from "../../features/account-manage/useAccounts";
import type { AppSettingsController } from "../../features/settings/useAppSettings";
import { ApplicationSettingsPage } from "./ApplicationSettingsPage";

describe("ApplicationSettingsPage", () => {
  it("shows exactly the four application setting sections and no removable dangerous-operation switch", () => {
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
        界面外观: ["界面主题"],
        文件浏览: ["文件变更视图", "树形目录"],
        差异查看: ["Diff 布局", "自动换行"],
        提交体验: ["提交区域高度"]
      });
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
});

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
