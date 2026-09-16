import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AccountController } from "../../features/account-manage/useAccounts";
import { SettingsPage } from "./SettingsPage";

describe("SettingsPage account states", () => {
  it("shows a blocking read error instead of a false empty account state", () => {
    vi.stubGlobal("React", React);
    try {
      const html = renderToStaticMarkup(
        <SettingsPage
          accounts={accountControllerWithReadError()}
          gitEnvironment={null}
          terminalProfiles={[]}
          workspace={null}
        />
      );

      expect(html).toContain("账号数据暂时不可用");
      expect(html).toContain("无法读取账号元数据");
      expect(html).not.toContain("尚未添加 GitNest 账号");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses shared skeleton rows while account metadata is initially loading", () => {
    vi.stubGlobal("React", React);
    try {
      const html = renderToStaticMarkup(
        <SettingsPage
          accounts={{
            ...accountControllerWithReadError(),
            active: "loading",
            error: null
          }}
          gitEnvironment={null}
          terminalProfiles={[]}
          workspace={null}
        />
      );

      expect(html).toContain("gn-skeleton-surface");
      expect(html).toContain(
        'aria-label="正在读取账号元数据"'
      );
      expect(html).not.toContain("empty-state-icon spinning");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function accountControllerWithReadError(): AccountController {
  return {
    overview: null,
    removalImpact: null,
    active: null,
    error: {
      code: "COMMAND_FAILED",
      message: "无法读取账号元数据",
      details: {}
    },
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
