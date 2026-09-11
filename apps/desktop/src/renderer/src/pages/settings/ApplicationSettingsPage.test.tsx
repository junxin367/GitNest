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
});

function settingsController(): AppSettingsController {
  return {
    settings: createDefaultAppSettings(),
    loading: false,
    saving: false,
    clearingKey: false,
    error: null,
    notice: null,
    reload: vi.fn(async () => undefined),
    update: vi.fn(async () => true),
    clearAiApiKey: vi.fn(async () => true),
    clearFeedback: vi.fn()
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
