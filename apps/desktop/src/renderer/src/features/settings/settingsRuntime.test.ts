import {
  createDefaultAppSettings,
  type ExternalTerminalProfileDto,
  type RepositoryTargetDto
} from "@gitnest/contracts";
import { describe, expect, it } from "vitest";

import {
  chunkRepositoryTargets,
  resolveDefaultTerminalProfile,
  resolveStartupNavigation
} from "./settingsRuntime";

describe("settings runtime preferences", () => {
  it("restores only a valid business destination and falls back to the Workspace overview", () => {
    const settings = createDefaultAppSettings();
    settings.navigation = {
      lastContentView: "repository",
      workspaceTab: "activity",
      repositoryTab: "changes"
    };

    expect(
      resolveStartupNavigation(settings, true)
    ).toEqual({
      view: "repository",
      workspaceTab: "activity",
      repositoryTab: "changes"
    });
    expect(
      resolveStartupNavigation(settings, false)
    ).toEqual({
      view: "workspace",
      workspaceTab: "overview",
      repositoryTab: "changes"
    });

    settings.navigation.lastContentView = "workspace";
    expect(
      resolveStartupNavigation(settings, false)
    ).toEqual({
      view: "workspace",
      workspaceTab: "activity",
      repositoryTab: "changes"
    });

    settings.general.restoreLastView = false;
    expect(
      resolveStartupNavigation(settings, true)
    ).toEqual({
      view: "workspace",
      workspaceTab: "overview",
      repositoryTab: "overview"
    });
  });

  it("uses the saved terminal when available and otherwise uses the first detected profile", () => {
    const profiles: ExternalTerminalProfileDto[] = [
      {
        kind: "powershell",
        label: "PowerShell"
      },
      {
        kind: "git-bash",
        label: "Git Bash"
      }
    ];

    expect(
      resolveDefaultTerminalProfile(
        profiles,
        "git-bash"
      )?.kind
    ).toBe("git-bash");
    expect(
      resolveDefaultTerminalProfile(
        profiles,
        "windows-terminal"
      )?.kind
    ).toBe("powershell");
  });

  it("splits all-repository Fetch requests into bounded batches", () => {
    const targets: RepositoryTargetDto[] = Array.from(
      { length: 121 },
      (_, index) => ({
        repositoryId: `repository-${index}`,
        worktreeId: `worktree-${index}`
      })
    );

    expect(
      chunkRepositoryTargets(targets).map(
        (batch) => batch.length
      )
    ).toEqual([50, 50, 21]);
  });
});
