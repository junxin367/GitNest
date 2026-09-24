import {
  access,
  rename
} from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  WorkspaceCollectionService,
  WorkspaceService
} from "@gitnest/application";
import { GitCliClient } from "@gitnest/git-cli";
import {
  JsonWorkspaceCollectionStore,
  JsonWorkspaceStore
} from "@gitnest/persistence-json";
import {
  createTemporaryDirectoryFixture,
  createWorkspaceFixture,
  type TemporaryDirectoryFixture,
  type WorkspaceFixture
} from "@gitnest/testkit";

import { NodeWorkspaceFileSystem } from "../adapters/filesystem.adapter";

describe("WorkspaceService integration", () => {
  let fixture: WorkspaceFixture;
  let appData: TemporaryDirectoryFixture;
  let service: WorkspaceService;
  let storePath: string;
  let tick = 0;
  const clock = () =>
    `2026-09-04T10:${String(tick++).padStart(2, "0")}:00.000Z`;

  beforeAll(async () => {
    fixture = await createWorkspaceFixture();
    appData = await createTemporaryDirectoryFixture("app-data");
    storePath = join(appData.path, "default.workspace.json");
    service = new WorkspaceService(
      new GitCliClient(),
      new NodeWorkspaceFileSystem(),
      new JsonWorkspaceStore(storePath),
      { clock }
    );
  });

  afterAll(async () => {
    await fixture.dispose();
    await appData.dispose();
  });

  it("discovers nested repositories and linked Worktrees, groups them, and restores persisted state", async () => {
    const configured = await service.configureRoot(
      fixture.metaRootPath
    );

    expect(configured).toMatchObject({
      path: fixture.metaRootPath,
      excludes: [],
      scanIssues: []
    });
    expect(configured.groups.map((group) => group.name)).toEqual([
      "原/根仓库",
      "svr"
    ]);
    expect(
      configured.groups.find(
        (group) => group.name === "原/根仓库"
      )?.targets
    ).toHaveLength(2);
    expect(
      configured.groups.find(
        (group) => group.name === "svr"
      )?.targets
    ).toHaveLength(1);
    expect(configured.repositories).toHaveLength(3);
    expect(
      configured.worktrees.some(
        (worktree) => worktree.path === fixture.linkedWorktreePath
      )
    ).toBe(true);
    expect(
      configured.worktrees.some(
        (worktree) =>
          worktree.path === fixture.ignoredRepositoryPath
      )
    ).toBe(false);
    await expect(
      access(join(fixture.metaRootPath, ".gitnest"))
    ).rejects.toMatchObject({
      code: "ENOENT"
    });

    const group = configured.groups.find(
      (candidate) => candidate.name === "svr"
    );
    expect(group).toBeDefined();
    const collapsed = await service.setGroupCollapsed({
      groupId: group?.id as string,
      collapsed: true
    });
    expect(
      collapsed.groups.find(
        (candidate) => candidate.id === group?.id
      )?.collapsed
    ).toBe(true);

    const restored = await new WorkspaceService(
      new GitCliClient(),
      new NodeWorkspaceFileSystem(),
      new JsonWorkspaceStore(storePath),
      { clock }
    ).getCurrent();
    expect(restored).toEqual(collapsed);
    expect(
      restored.groups.find(
        (candidate) => candidate.id === group?.id
      )?.collapsed
    ).toBe(true);
  }, 15_000);

  it("does not configure a root without repositories", async () => {
    const localAppData =
      await createTemporaryDirectoryFixture(
        "empty-workspace-app-data"
      );
    const localService = new WorkspaceService(
      new GitCliClient(),
      new NodeWorkspaceFileSystem(),
      new JsonWorkspaceStore(
        join(localAppData.path, "default.workspace.json")
      ),
      { clock }
    );

    try {
      await expect(
        localService.configureRoot(
          fixture.emptyDirectoryPath
        )
      ).rejects.toMatchObject({
        code: "NO_REPOSITORIES_FOUND"
      });
      await expect(
        localService.getCurrent()
      ).resolves.not.toHaveProperty("path");
    } finally {
      await localAppData.dispose();
    }
  });

  it("adds, deduplicates, and restores another directory in the current Workspace", async () => {
    const localAppData =
      await createTemporaryDirectoryFixture(
        "additional-directory-app-data"
      );
    const localStorePath = join(
      localAppData.path,
      "default.workspace.json"
    );
    const createService = () =>
      new WorkspaceService(
        new GitCliClient(),
        new NodeWorkspaceFileSystem(),
        new JsonWorkspaceStore(localStorePath),
        { clock }
      );

    try {
      const localService = createService();
      const configured = await localService.configureRoot(
        fixture.metaRootPath
      );
      const added = await localService.addDirectory({
        path: fixture.standaloneRepositoryPath
      });

      expect(added.duplicate).toBe(false);
      expect(added.workspace.path).toBe(fixture.metaRootPath);
      expect(added.workspace.additionalRoots).toEqual([
        expect.objectContaining({
          path: fixture.standaloneRepositoryPath,
          excludes: []
        })
      ]);
      expect(added.workspace.repositories).toHaveLength(
        configured.repositories.length + 1
      );
      expect(
        added.workspace.worktrees.some(
          (worktree) =>
            worktree.path ===
            fixture.standaloneRepositoryPath
        )
      ).toBe(true);

      const duplicate = await localService.addDirectory({
        path: fixture.standaloneRepositoryPath
      });
      expect(duplicate).toEqual({
        workspace: added.workspace,
        duplicate: true
      });

      await expect(createService().getCurrent()).resolves.toEqual(
        added.workspace
      );
    } finally {
      await localAppData.dispose();
    }
  }, 15_000);

  it("creates, switches, restores, renames, and deletes independent multi-repository Workspaces", async () => {
    const localAppData =
      await createTemporaryDirectoryFixture(
        "workspace-collection-app-data"
      );
    const externalWorktreePath = join(
      localAppData.path,
      "externally-created-worktree"
    );
    const gitClient = new GitCliClient();
    let externalWorktreeCreated = false;
    const options = {
      catalogFilePath: join(
        localAppData.path,
        "workspaces",
        "catalog.json"
      ),
      workspaceDirectory: join(
        localAppData.path,
        "workspaces",
        "items"
      )
    };
    const createService = () =>
      new WorkspaceCollectionService(
        new GitCliClient(),
        new NodeWorkspaceFileSystem(),
        new JsonWorkspaceCollectionStore(options),
        {
          clock,
          idFactory: () => "workspace_second"
        }
      );

    try {
      const collection = createService();
      await expect(
        collection.createWorkspace({
          name: "Invalid Workspace",
          path: fixture.emptyDirectoryPath
        })
      ).rejects.toMatchObject({
        code: "NO_REPOSITORIES_FOUND"
      });
      expect((await collection.getCurrent()).id).toBe("default");
      expect(await collection.listWorkspaces()).toHaveLength(1);
      expect(
        await new JsonWorkspaceCollectionStore(options)
          .loadWorkspace("workspace_second")
      ).toBeNull();

      const firstConfigured =
        await collection.createWorkspace({
          name: "Primary Workspace",
          path: fixture.metaRootPath
        });
      expect(firstConfigured).toMatchObject({
        id: "default",
        name: "Primary Workspace",
        path: fixture.metaRootPath,
        groups: [
          { name: "原/根仓库" },
          { name: "svr" }
        ]
      });

      const second = await collection.createWorkspace({
        name: "Second Workspace",
        path: fixture.standaloneRepositoryPath
      });
      expect(second).toMatchObject({
        id: "workspace_second",
        name: "Second Workspace",
        path: fixture.standaloneRepositoryPath,
        groups: [
          {
            name: "原/根仓库",
            targets: [expect.any(Object)]
          }
        ]
      });
      const secondGroup = second.groups[0];
      expect(secondGroup).toBeDefined();
      const collapsedSecond =
        await collection.setGroupCollapsed({
          groupId: secondGroup?.id as string,
          collapsed: true
        });
      expect(collapsedSecond.groups[0]?.collapsed).toBe(true);

      const first = await collection.switchWorkspace(
        "default"
      );
      expect(first.path).toBe(fixture.metaRootPath);
      expect(
        first.groups.every((group) => !group.collapsed)
      ).toBe(true);

      const standaloneSnapshot =
        await gitClient.readRepositorySnapshot(
          fixture.standaloneRepositoryPath
        );
      await gitClient.createWorktree(
        fixture.standaloneRepositoryPath,
        externalWorktreePath,
        {
          startPoint: standaloneSnapshot.head,
          createBranch: false,
          detached: true
        }
      );
      externalWorktreeCreated = true;
      expect(
        (
          await new JsonWorkspaceCollectionStore(
            options
          ).loadWorkspace("workspace_second")
        )?.worktrees.some(
          (worktree) => worktree.path === externalWorktreePath
        )
      ).toBe(false);

      const restoredSecond =
        await collection.switchWorkspace(
          "workspace_second"
        );
      expect(restoredSecond.path).toBe(
        fixture.standaloneRepositoryPath
      );
      expect(restoredSecond.groups[0]?.collapsed).toBe(true);
      expect(
        restoredSecond.worktrees.some(
          (worktree) => worktree.path === externalWorktreePath
        )
      ).toBe(false);
      const refreshedSecond = await collection.rescan();
      expect(
        refreshedSecond.worktrees.some(
          (worktree) => worktree.path === externalWorktreePath
        )
      ).toBe(true);
      await gitClient.removeWorktree(
        fixture.standaloneRepositoryPath,
        externalWorktreePath
      );
      externalWorktreeCreated = false;
      await collection.renameWorkspace({
        workspaceId: "workspace_second",
        name: "Renamed Workspace"
      });
      expect(await collection.listWorkspaces()).toEqual([
        expect.objectContaining({
          id: "default",
          name: "Primary Workspace"
        }),
        expect.objectContaining({
          id: "workspace_second",
          name: "Renamed Workspace"
        })
      ]);

      const afterDelete = await collection.deleteWorkspace(
        "workspace_second"
      );
      expect(afterDelete.id).toBe("default");
      expect(await collection.listWorkspaces()).toHaveLength(1);

      const restored = createService();
      await expect(restored.getCurrent()).resolves.toMatchObject({
        id: "default",
        name: "Primary Workspace",
        path: fixture.metaRootPath
      });
      await expect(
        restored.listWorkspaces()
      ).resolves.toEqual([
        expect.objectContaining({ id: "default" })
      ]);
    } finally {
      if (externalWorktreeCreated) {
        await gitClient
          .removeWorktree(
            fixture.standaloneRepositoryPath,
            externalWorktreePath
          )
          .catch(() => undefined);
      }
      await localAppData.dispose();
    }
  }, 15_000);

  it("reports document cleanup failures without restoring a deleted Workspace to the catalog", async () => {
    const localAppData =
      await createTemporaryDirectoryFixture(
        "workspace-delete-failure"
      );
    try {
      const store = new JsonWorkspaceCollectionStore({
        catalogFilePath: join(
          localAppData.path,
          "catalog.json"
        ),
        workspaceDirectory: join(localAppData.path, "items")
      });
      const collection = new WorkspaceCollectionService(
        new GitCliClient(),
        new NodeWorkspaceFileSystem(),
        store,
        {
          idFactory: () =>
            "workspace_delete_failure"
        }
      );
      await collection.createWorkspace({
        name: "Primary Workspace",
        path: fixture.metaRootPath
      });
      const created = await collection.createWorkspace({
        name: "Delete test",
        path: fixture.standaloneRepositoryPath
      });
      const remove = vi
        .spyOn(store, "deleteWorkspace")
        .mockRejectedValueOnce(new Error("Access denied"));
      const next = await collection.deleteWorkspace(created.id);
      expect(next.id).toBe("default");
      expect(
        (await store.loadCatalog())?.workspaces.map(
          ({ id }) => id
        )
      ).toEqual(["default"]);
      expect(
        await store.loadWorkspace(created.id)
      ).not.toBeNull();
      expect(
        collection.consumeCleanupWarning()
      ).toContain("配置文件未能清理");
      expect(collection.consumeCleanupWarning()).toBeUndefined();
      expect((await collection.getCurrent()).id).toBe("default");
      remove.mockRestore();
    } finally {
      await localAppData.dispose();
    }
  });

  it("excludes a nested repository without deleting its directory", async () => {
    const localAppData =
      await createTemporaryDirectoryFixture(
        "exclude-repository-app-data"
      );
    const localStorePath = join(
      localAppData.path,
      "default.workspace.json"
    );
    let localTick = 0;
    const localService = new WorkspaceService(
      new GitCliClient(),
      new NodeWorkspaceFileSystem(),
      new JsonWorkspaceStore(localStorePath),
      {
        clock: () =>
          `2026-09-04T11:${String(localTick++).padStart(2, "0")}:00.000Z`
      }
    );

    try {
      const configured = await localService.configureRoot(
        fixture.metaRootPath
      );
      const nestedTarget = configured.groups
        .find((group) => group.name === "svr")
        ?.targets[0];

      if (!nestedTarget) {
        throw new Error(
          "Workspace fixture did not contain a nested repository."
        );
      }

      const withoutNested =
        await localService.excludeRepository({
          target: nestedTarget
        });
      expect(
        withoutNested.groups.some((group) =>
          group.targets.some(
            (target) =>
              target.repositoryId ===
                nestedTarget.repositoryId &&
              target.worktreeId === nestedTarget.worktreeId
          )
        )
      ).toBe(false);
      expect(withoutNested.excludes).toContain(
        "svr/ScResSvr"
      );
      expect(
        withoutNested.worktrees.some(
          (worktree) =>
            worktree.path === fixture.nestedRepositoryPath
        )
      ).toBe(false);
      await expect(
        access(fixture.nestedRepositoryPath)
      ).resolves.toBeUndefined();

      const restored = await new WorkspaceService(
        new GitCliClient(),
        new NodeWorkspaceFileSystem(),
        new JsonWorkspaceStore(localStorePath),
        { clock }
      ).getCurrent();
      expect(restored).toEqual(withoutNested);
    } finally {
      await localAppData.dispose();
    }
  }, 15_000);

  it("preserves the last known topology while a root is offline and recovers after it returns", async () => {
    const offlineFixture = await createWorkspaceFixture();
    const offlineAppData =
      await createTemporaryDirectoryFixture(
        "offline-root-app-data"
      );
    const originalPath =
      offlineFixture.standaloneRepositoryPath;
    const movedPath = `${originalPath}-offline`;
    let moved = false;

    try {
      const offlineService = new WorkspaceService(
        new GitCliClient(),
        new NodeWorkspaceFileSystem(),
        new JsonWorkspaceStore(
          join(
            offlineAppData.path,
            "default.workspace.json"
          )
        ),
        { clock }
      );
      const added =
        await offlineService.configureRoot(originalPath);
      const previousRepositoryId =
        added.repositories[0]?.id;

      await rename(originalPath, movedPath);
      moved = true;
      const offline = await offlineService.rescan();
      expect(offline).toMatchObject({
        path: originalPath,
        scanIssues: [
          {
            code: "DIRECTORY_UNAVAILABLE"
          }
        ]
      });
      expect(offline.repositories[0]?.id).toBe(
        previousRepositoryId
      );
      expect(offline.worktrees[0]?.path).toBe(originalPath);

      await rename(movedPath, originalPath);
      moved = false;
      const recovered = await offlineService.rescan();
      expect(recovered.scanIssues).toEqual([]);
      expect(recovered.repositories[0]?.id).toBe(
        previousRepositoryId
      );
      expect(recovered.worktrees[0]?.path).toBe(originalPath);
    } finally {
      if (moved) {
        await rename(movedPath, originalPath).catch(
          () => undefined
        );
      }
      await offlineFixture.dispose();
      await offlineAppData.dispose();
    }
  }, 15_000);
});
