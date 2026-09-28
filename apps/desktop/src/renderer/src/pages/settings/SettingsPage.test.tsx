import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SettingsPage } from "./SettingsPage";

describe("SettingsPage system Git authentication", () => {
  it("shows only the inherited system Git authentication source", () => {
    vi.stubGlobal("React", React);
    try {
      const html = renderToStaticMarkup(
        <SettingsPage
          embedded
          gitEnvironment={{
            executablePath: "C:\\Program Files\\Git\\cmd\\git.exe",
            version: "2.53.0",
            lfs: {
              available: true,
              version: "3.7.1"
            },
            identity: {
              name: "GitNest User",
              email: "gitnest@example.com"
            },
            credentialHelpers: ["manager-core"],
            ssh: {
              command: "ssh",
              authSockConfigured: true,
              configExists: true
            },
            detectedAt: "2026-09-24T00:00:00.000Z"
          }}
          terminalProfiles={[]}
        />
      );

      expect(html).toContain(
        '<div class="settings-card-title">系统 Git 认证</div>'
      );
      expect(html.match(/settings-info-item/g)).toHaveLength(6);
      for (const label of [
        "默认用户名",
        "默认邮箱",
        "Credential Helpers",
        "SSH Agent",
        ".ssh/config",
        "全局 Git 配置"
      ]) {
        expect(html).toContain(label);
      }
      expect(html).toContain("GitNest User");
      expect(html).toContain("gitnest@example.com");
      expect(html).toContain("1 个");
      expect(html).toContain("已配置");
      expect(html).toContain("已检测");
      expect(html).toContain("保持不变");
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

  it("keeps external terminal discovery in the standalone page", () => {
    vi.stubGlobal("React", React);
    try {
      const html = renderToStaticMarkup(
        <SettingsPage
          gitEnvironment={null}
          terminalProfiles={[
            {
              kind: "powershell",
              label: "PowerShell"
            }
          ]}
        />
      );

      expect(html).toContain("系统 Git 认证");
      expect(html).toContain("外部终端");
      expect(html).toContain("PowerShell");
      expect(html).toContain("未配置");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
