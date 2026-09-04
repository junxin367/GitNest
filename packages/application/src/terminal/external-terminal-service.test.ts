import { describe, expect, it } from "vitest";

import type {
  RepositoryTarget,
  Workspace
} from "@gitnest/workspace-core";

import {
  ExternalTerminalService,
  type ExternalTerminalPort,
  type ExternalTerminalProfile
} from "./external-terminal-service";

const TARGET: RepositoryTarget = {
  repositoryId: "repository",
  worktreeId: "worktree"
};
const WORKTREE_PATH = "C:\\workspace\\repository";

describe("ExternalTerminalService", () => {
  it("opens an available terminal only at the registered Worktree path", async () => {
    const terminal = new FakeTerminalPort();
    const service = new ExternalTerminalService(
      {
        getCurrent: async () => createWorkspace()
      },
      terminal
    );

    await expect(
      service.open(TARGET, "powershell")
    ).resolves.toEqual({
      kind: "powershell",
      label: "PowerShell",
      target: TARGET
    });
    expect(terminal.launches).toEqual([
      {
        profile: terminal.profiles[0],
        workingDirectory: WORKTREE_PATH
      }
    ]);
  });

  it("rejects unregistered, bare, and unavailable targets before launch", async () => {
    const terminal = new FakeTerminalPort();
    const workspace = createWorkspace();
    const service = new ExternalTerminalService(
      {
        getCurrent: async () => structuredClone(workspace)
      },
      terminal
    );

    await expect(
      service.open(
        {
          repositoryId: "other",
          worktreeId: "other"
        },
        "powershell"
      )
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });

    workspace.worktrees[0] = {
      ...(workspace.worktrees[0] as Workspace["worktrees"][number]),
      isBare: true
    };
    await expect(
      service.open(TARGET, "powershell")
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });

    workspace.worktrees[0] = {
      ...(workspace.worktrees[0] as Workspace["worktrees"][number]),
      isBare: false
    };
    await expect(
      service.open(TARGET, "git-bash")
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    expect(terminal.launches).toEqual([]);
  });
});

class FakeTerminalPort implements ExternalTerminalPort {
  readonly profiles: ExternalTerminalProfile[] = [
    {
      kind: "powershell",
      label: "PowerShell",
      executablePath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
    }
  ];
  readonly launches: Array<{
    profile: ExternalTerminalProfile;
    workingDirectory: string;
  }> = [];

  async listAvailable(): Promise<ExternalTerminalProfile[]> {
    return structuredClone(this.profiles);
  }

  async launch(
    profile: ExternalTerminalProfile,
    workingDirectory: string
  ): Promise<void> {
    this.launches.push({
      profile: structuredClone(profile),
      workingDirectory
    });
  }
}

function createWorkspace(): Workspace {
  return {
    schemaVersion: 1,
    id: "workspace",
    name: "Workspace",
    entries: [
      {
        id: "entry",
        displayName: "Repository",
        path: WORKTREE_PATH,
        canonicalPath: "c:\\workspace\\repository",
        excludes: [],
        order: 0,
        groups: [],
        scanIssues: [],
        lastScannedAt: "2026-09-04T12:00:00.000Z",
        kind: "standalone-repository",
        target: TARGET
      }
    ],
    repositories: [
      {
        id: TARGET.repositoryId,
        name: "repository",
        commonDir: `${WORKTREE_PATH}\\.git`,
        canonicalCommonDir: "c:\\workspace\\repository\\.git",
        primaryWorktreeId: TARGET.worktreeId,
        worktreeIds: [TARGET.worktreeId]
      }
    ],
    worktrees: [
      {
        id: TARGET.worktreeId,
        repositoryId: TARGET.repositoryId,
        name: "repository",
        path: WORKTREE_PATH,
        canonicalPath: "c:\\workspace\\repository",
        gitDir: `${WORKTREE_PATH}\\.git`,
        head: "a".repeat(40),
        branch: "main",
        isPrimary: true,
        isBare: false,
        isDetached: false,
        isLocked: false,
        isPrunable: false
      }
    ],
    selectedEntryId: "entry",
    selectedTarget: TARGET,
    updatedAt: "2026-09-04T12:00:00.000Z"
  };
}
