import { describe, expect, it } from "vitest";

import type {
  RepositoryTarget,
  Workspace
} from "@gitnest/workspace-core";

import {
  ExternalApplicationService,
  type ExternalApplicationPort,
  type ExternalApplicationProfile
} from "./external-application-service";

const TARGET: RepositoryTarget = {
  repositoryId: "repository",
  worktreeId: "worktree"
};
const WORKSPACE_PATH = "C:\\workspace";
const SECOND_WORKSPACE_PATH = "D:\\code\\sc\\sc_code";
const WORKTREE_PATH = "C:\\workspace\\repository";

describe("ExternalApplicationService", () => {
  it("opens the Workspace root and registered Worktree only", async () => {
    const applications = new FakeApplicationPort();
    const service = new ExternalApplicationService(
      {
        getCurrent: async () => createWorkspace()
      },
      applications
    );

    await expect(
      service.open({ scope: "workspace" }, "vscode")
    ).resolves.toEqual({
      kind: "vscode",
      label: "VS Code",
      scope: "workspace"
    });
    await expect(
      service.open(
        {
          scope: "repository",
          target: TARGET
        },
        "file-explorer"
      )
    ).resolves.toEqual({
      kind: "file-explorer",
      label: "File Explorer",
      scope: "repository"
    });
    expect(applications.launches).toEqual([
      {
        profile: applications.profiles[0],
        workingDirectory: WORKSPACE_PATH
      },
      {
        profile: applications.profiles[1],
        workingDirectory: WORKTREE_PATH
      }
    ]);
  });

  it("opens the selected Workspace entry when multiple directories exist", async () => {
    const applications = new FakeApplicationPort();
    const service = new ExternalApplicationService(
      {
        getCurrent: async () =>
          createWorkspaceWithSelectedEntry()
      },
      applications
    );

    await service.open({ scope: "workspace" }, "vscode");

    expect(applications.launches).toEqual([
      {
        profile: applications.profiles[0],
        workingDirectory: SECOND_WORKSPACE_PATH
      }
    ]);
  });

  it("passes a validated file position to editor adapters", async () => {
    const applications = new FakeApplicationPort();
    const service = new ExternalApplicationService(
      {
        getCurrent: async () => createWorkspace()
      },
      applications
    );

    await service.open(
      {
        scope: "file",
        target: TARGET,
        path: "src/index.ts",
        line: 42,
        column: 7
      },
      "vscode"
    );

    expect(applications.launches).toEqual([
      {
        profile: applications.profiles[0],
        workingDirectory: WORKTREE_PATH,
        filePath: "src/index.ts",
        position: {
          line: 42,
          column: 7
        }
      }
    ]);
  });

  it("rejects unavailable applications and unregistered targets", async () => {
    const applications = new FakeApplicationPort();
    const service = new ExternalApplicationService(
      {
        getCurrent: async () => createWorkspace()
      },
      applications
    );

    await expect(
      service.open({ scope: "workspace" }, "cursor")
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    await expect(
      service.open(
        {
          scope: "repository",
          target: {
            repositoryId: "other",
            worktreeId: "other"
          }
        },
        "vscode"
      )
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    expect(applications.launches).toEqual([]);
  });
});

class FakeApplicationPort implements ExternalApplicationPort {
  readonly profiles: ExternalApplicationProfile[] = [
    {
      kind: "vscode",
      label: "VS Code",
      executablePath: "C:\\Apps\\Code.exe"
    },
    {
      kind: "file-explorer",
      label: "File Explorer"
    }
  ];
  readonly launches: Array<{
    profile: ExternalApplicationProfile;
    workingDirectory: string;
    filePath?: string;
    position?: {
      line: number;
      column: number;
    };
  }> = [];

  async listAvailable(): Promise<
    ExternalApplicationProfile[]
  > {
    return structuredClone(this.profiles);
  }

  async launch(
    profile: ExternalApplicationProfile,
    workingDirectory: string,
    filePath?: string,
    position?: {
      line: number;
      column: number;
    }
  ): Promise<void> {
    this.launches.push({
      profile: structuredClone(profile),
      workingDirectory,
      ...(filePath ? { filePath } : {}),
      ...(position ? { position: { ...position } } : {})
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
        id: "workspace-root",
        displayName: "Workspace",
        path: WORKSPACE_PATH,
        canonicalPath: "c:\\workspace",
        excludes: [],
        order: 0,
        groups: [],
        scanIssues: [],
        lastScannedAt: "2026-09-08T00:00:00.000Z",
        kind: "workspace-meta-repository",
        rootTarget: TARGET
      }
    ],
    repositories: [
      {
        id: TARGET.repositoryId,
        name: "repository",
        commonDir: `${WORKTREE_PATH}\\.git`,
        canonicalCommonDir:
          "c:\\workspace\\repository\\.git",
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
    selectedEntryId: "workspace-root",
    selectedTarget: TARGET,
    updatedAt: "2026-09-08T00:00:00.000Z"
  };
}

function createWorkspaceWithSelectedEntry(): Workspace {
  const workspace = createWorkspace();
  const selectedEntry = {
    ...workspace.entries[0]!,
    id: "workspace-second",
    displayName: "sc_code 原仓库",
    path: SECOND_WORKSPACE_PATH,
    canonicalPath: SECOND_WORKSPACE_PATH.toLocaleLowerCase(),
    order: 1
  };

  return {
    ...workspace,
    entries: [workspace.entries[0]!, selectedEntry],
    selectedEntryId: selectedEntry.id
  };
}
