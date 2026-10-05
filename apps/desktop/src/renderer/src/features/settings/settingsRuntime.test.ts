import {
  createDefaultAppSettings,
  type ExternalTerminalProfileDto,
  type RepositoryTargetDto
} from "@gitnest/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  chunkRepositoryTargets,
  requestRepositoryFetchBatches,
  resolveDefaultTerminalProfile,
  resolveRepositoryFileBrowsing,
  resolveStartupNavigation
} from "./settingsRuntime";

describe("settings runtime preferences", () => {
  it("resolves browsing preferences by repository with legacy defaults for untouched repositories", () => {
    const settings = createDefaultAppSettings();
    settings.diff.fileView = "tree";
    settings.diff.treeDirectoriesCollapsed = true;
    settings.repositoryFileBrowsing["repository-a"] = {
      fileView: "list",
      treeDirectoriesCollapsed: false
    };
    expect(resolveRepositoryFileBrowsing(settings, "repository-a")).toEqual({
      fileView: "list", treeDirectoriesCollapsed: false
    });
    expect(resolveRepositoryFileBrowsing(settings, "repository-b")).toEqual({
      fileView: "tree", treeDirectoriesCollapsed: true
    });
  });
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

  it.each([1, 2])("stops Fetch batching when chunk %s is not fully accepted", async (rejectedChunk) => {
    const targets = Array.from({ length: 121 }, (_, index) => ({
      repositoryId: `repository-${index}`, worktreeId: `worktree-${index}`
    }));
    let submittedChunks = 0;
    const request = vi.fn(async () => ++submittedChunks !== rejectedChunk);
    expect(await requestRepositoryFetchBatches(targets, request)).toBe(false);
    expect(request).toHaveBeenCalledTimes(rejectedChunk);
    expect(request).toHaveBeenNthCalledWith(1, { type: "fetch", targets: targets.slice(0, 50) });
  });

  it("waits for each Fetch submission before sending the next chunk", async () => {
    const targets = Array.from({ length: 51 }, (_, index) => ({
      repositoryId: `repository-${index}`, worktreeId: `worktree-${index}`
    }));
    let release!: (accepted: boolean) => void;
    const first = new Promise<boolean>((resolve) => { release = resolve; });
    const request = vi.fn().mockReturnValueOnce(first).mockResolvedValue(true);
    const pending = requestRepositoryFetchBatches(targets, request);
    expect(request).toHaveBeenCalledTimes(1);
    release(true);
    expect(await pending).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith({ type: "fetch", targets: targets.slice(50) });
  });
});
