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
import type {
  GitReadOptions,
  GitTopologyClient,
  RepositoryTopology
} from "@gitnest/git-core";
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
import {
  WorkspaceError,
  listWorkspaceTargets
} from "@gitnest/workspace-core";

import { NodeWorkspaceFileSystem } from "../adapters/filesystem.adapter";

describe("WorkspaceService integration", () => {
  let fixture: WorkspaceFixture;
  let appData: TemporaryDirectoryFixture;
  let service: WorkspaceService;
  let storePath: string;
  let tick = 0;
  const gitClient = new GitCliClient();
  const clock = () =>
    new Date(
      Date.UTC(2026, 8, 4, 10, tick++)
    ).toISOString();

  beforeAll(async () => {
    fixture = await createWorkspaceFixture();
    appData = await createTemporaryDirectoryFixture("app-data");
    storePath = join(appData.path, "default.workspace.json");
    service = new WorkspaceService(
      gitClient,
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
    const fullInspection = vi.spyOn(gitClient, "inspectRepository");
    const topology = vi.spyOn(gitClient, "readRepositoryTopology");
    const configured = await service.configureRoot(
      fixture.metaRootPath
    );

    expect(topology).toHaveBeenCalled();
    expect(fullInspection).not.toHaveBeenCalled();
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

  it("keeps selection and collapsed groups responsive while a rescan is waiting on Git", async () => {
    const localAppData =
      await createTemporaryDirectoryFixture(
        "responsive-rescan-app-data"
      );
    const localStorePath = join(
      localAppData.path,
      "default.workspace.json"
    );
    const gitClient = new DeferredTopologyClient();
    const localService = new WorkspaceService(
      gitClient,
      new NodeWorkspaceFileSystem(),
      new JsonWorkspaceStore(localStorePath),
      { clock }
    );

    try {
      const configured = await localService.configureRoot(
        fixture.metaRootPath
      );
      const target = listWorkspaceTargets(configured).find(
        (candidate) =>
          candidate.repositoryId !==
            configured.selectedTarget?.repositoryId ||
          candidate.worktreeId !==
            configured.selectedTarget?.worktreeId
      );
      const group = configured.groups.find(
        (candidate) => !candidate.collapsed
      );
      if (!target || !group) {
        throw new Error(
          "Workspace fixture did not provide selection and group alternatives."
        );
      }

      const gate = gitClient.deferNextRead();
      const rescanning = localService.rescan();
      await gate.started;
      const selected = await resolveWithin(
        localService.selectTarget(target),
        500
      );
      const collapsed = await resolveWithin(
        localService.setGroupCollapsed({
          groupId: group.id,
          collapsed: true
        }),
        500
      );

      expect(selected.selectedTarget).toEqual(target);
      expect(
        collapsed.groups.find(
          (candidate) => candidate.id === group.id
        )?.collapsed
      ).toBe(true);

      gate.release();
      const refreshed = await rescanning;
      expect(refreshed.selectedTarget).toEqual(target);
      expect(
        refreshed.groups.find(
          (candidate) => candidate.id === group.id
        )?.collapsed
      ).toBe(true);
      await expect(
        new WorkspaceService(
          new GitCliClient(),
          new NodeWorkspaceFileSystem(),
          new JsonWorkspaceStore(localStorePath),
          { clock }
        ).getCurrent()
      ).resolves.toEqual(refreshed);
    } finally {
      await localAppData.dispose();
    }
  }, 15_000);

  it("discards an older rescan after roots or exclusions change", async () => {
    const localAppData =
      await createTemporaryDirectoryFixture(
        "stale-rescan-topology-app-data"
      );
    const gitClient = new DeferredTopologyClient();
    const localService = new WorkspaceService(
      gitClient,
      new NodeWorkspaceFileSystem(),
      new JsonWorkspaceStore(
        join(localAppData.path, "default.workspace.json")
      ),
      { clock }
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

      const rootGate = gitClient.deferNextRead();
      const staleRootRescan = localService.rescan();
      await rootGate.started;
      const added = await resolveWithin(
        localService.addDirectory({
          path: fixture.standaloneRepositoryPath
        }),
        5_000
      );
      rootGate.release();
      const afterRootRescan = await staleRootRescan;
      expect(afterRootRescan).toEqual(added.workspace);
      expect(afterRootRescan.additionalRoots).toEqual([
        expect.objectContaining({
          path: fixture.standaloneRepositoryPath
        })
      ]);

      const excludeGate = gitClient.deferNextRead();
      const staleExcludeRescan = localService.rescan();
      await excludeGate.started;
      const excluded = await resolveWithin(
        localService.excludeRepository({
          target: nestedTarget
        }),
        5_000
      );
      excludeGate.release();
      const afterExcludeRescan = await staleExcludeRescan;
      expect(afterExcludeRescan).toEqual(excluded);
      expect(afterExcludeRescan.excludes).toContain(
        "svr/resource-server-demo"
      );
      expect(listWorkspaceTargets(afterExcludeRescan)).not.toContainEqual(
        nestedTarget
      );
    } finally {
      await localAppData.dispose();
    }
  }, 20_000);

  it("does not let an old collection rescan overwrite a switched or deleted Workspace", async () => {
    const localAppData =
      await createTemporaryDirectoryFixture(
        "stale-collection-rescan-app-data"
      );
    const store = new JsonWorkspaceCollectionStore({
      catalogFilePath: join(localAppData.path, "catalog.json"),
      workspaceDirectory: join(localAppData.path, "items")
    });
    const gitClient = new DeferredTopologyClient();
    const collection = new WorkspaceCollectionService(
      gitClient,
      new NodeWorkspaceFileSystem(),
      store,
      {
        clock,
        idFactory: () => "workspace_second"
      }
    );

    try {
      await collection.createWorkspace({
        name: "Primary Workspace",
        path: fixture.metaRootPath
      });
      const second = await collection.createWorkspace({
        name: "Second Workspace",
        path: fixture.standaloneRepositoryPath
      });

      const switchGate = gitClient.deferNextRead();
      const staleSwitchRescan = collection.rescan();
      await switchGate.started;
      const switched = await resolveWithin(
        collection.switchWorkspace("default"),
        500
      );
      switchGate.release();
      const afterSwitchRescan = await staleSwitchRescan;
      expect(switched.id).toBe("default");
      expect(afterSwitchRescan.id).toBe("default");
      expect((await collection.getCurrent()).id).toBe("default");

      await collection.switchWorkspace(second.id);
      const deleteGate = gitClient.deferNextRead();
      const staleDeleteRescan = collection.rescan();
      await deleteGate.started;
      const afterDelete = await resolveWithin(
        collection.deleteWorkspace(second.id),
        500
      );
      deleteGate.release();
      const afterDeleteRescan = await staleDeleteRescan;
      expect(afterDelete.id).toBe("default");
      expect(afterDeleteRescan.id).toBe("default");
      expect(
        (await store.loadCatalog())?.workspaces.map(
          (workspace) => workspace.id
        )
      ).toEqual(["default"]);
      expect(await store.loadWorkspace(second.id)).toBeNull();
    } finally {
      await localAppData.dispose();
    }
  }, 20_000);

  it("keeps collection selection responsive and preserves it after the active Workspace rescan", async () => {
    const localAppData =
      await createTemporaryDirectoryFixture(
        "responsive-collection-rescan-app-data"
      );
    const store = new JsonWorkspaceCollectionStore({
      catalogFilePath: join(localAppData.path, "catalog.json"),
      workspaceDirectory: join(localAppData.path, "items")
    });
    const gitClient = new DeferredTopologyClient();
    const collection = new WorkspaceCollectionService(
      gitClient,
      new NodeWorkspaceFileSystem(),
      store,
      { clock }
    );

    try {
      const configured = await collection.createWorkspace({
        name: "Primary Workspace",
        path: fixture.metaRootPath
      });
      const target = listWorkspaceTargets(configured).find(
        (candidate) =>
          candidate.repositoryId !==
            configured.selectedTarget?.repositoryId ||
          candidate.worktreeId !==
            configured.selectedTarget?.worktreeId
      );
      if (!target) {
        throw new Error(
          "Workspace fixture did not provide another repository target."
        );
      }

      const gate = gitClient.deferNextRead();
      const rescanning = collection.rescan();
      await gate.started;
      const selected = await resolveWithin(
        collection.selectTarget(target),
        500
      );
      expect(selected.selectedTarget).toEqual(target);

      gate.release();
      const refreshed = await rescanning;
      expect(refreshed.id).toBe(configured.id);
      expect(refreshed.selectedTarget).toEqual(target);
      expect((await collection.getCurrent()).selectedTarget).toEqual(
        target
      );
    } finally {
      await localAppData.dispose();
    }
  }, 15_000);

  it("does not commit a cancelled rescan", async () => {
    const localAppData =
      await createTemporaryDirectoryFixture(
        "cancelled-rescan-app-data"
      );
    const store = new JsonWorkspaceStore(
      join(localAppData.path, "default.workspace.json")
    );
    const gitClient = new DeferredTopologyClient();
    const localService = new WorkspaceService(
      gitClient,
      new NodeWorkspaceFileSystem(),
      store,
      { clock }
    );

    try {
      const configured = await localService.configureRoot(
        fixture.metaRootPath
      );
      const gate = gitClient.deferNextRead();
      const controller = new AbortController();
      const rescanning = localService.rescan(controller.signal);
      await gate.started;
      controller.abort();

      await expect(rescanning).rejects.toMatchObject({
        code: "SCAN_CANCELLED"
      });
      expect(await localService.getCurrent()).toEqual(configured);
      expect(await store.load()).toEqual(configured);
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
        "svr/resource-server-demo"
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

  it.each(["parent-first", "child-first"] as const)(
    "preserves root exclusions across overlapping directories and restarts (%s)",
    async (order) => {
      const localAppData = await createTemporaryDirectoryFixture(
        "overlapping-root-exclusion"
      );
      const path = join(localAppData.path, "workspace.json");
      const store = new JsonWorkspaceStore(path);
      const createService = () => new WorkspaceService(
        new GitCliClient(),
        new NodeWorkspaceFileSystem(),
        new JsonWorkspaceStore(path)
      );
      try {
        const localService = createService();
        const childRoot = join(fixture.metaRootPath, "svr");
        const roots = order === "parent-first"
          ? [fixture.metaRootPath, childRoot]
          : [childRoot, fixture.metaRootPath];
        await localService.configureRoot(roots[0]!);
        const { workspace } = await localService.addDirectory({ path: roots[1]! });
        const targetAt = (repositoryPath: string) => {
          const worktree = workspace.worktrees.find(
            (candidate) => candidate.path === repositoryPath
          )!;
          return {
            repositoryId: worktree.repositoryId,
            worktreeId: worktree.id
          };
        };
        const childTarget = targetAt(fixture.nestedRepositoryPath);
        const parentTarget = targetAt(fixture.directRepositoryPath);
        const withoutChild = await localService.excludeRepository({ target: childTarget });
        expect(withoutChild.groups.flatMap((group) => group.targets))
          .not.toContainEqual(childTarget);
        expect(withoutChild.groups.flatMap((group) => group.targets))
          .toContainEqual(parentTarget);
        await localService.excludeRepository({ target: parentTarget });
        const restored = await createService().rescan();
        const targets = restored.groups.flatMap((group) => group.targets);
        expect(targets).not.toContainEqual(childTarget);
        expect(targets).not.toContainEqual(parentTarget);
        await expect(access(fixture.nestedRepositoryPath)).resolves.toBeUndefined();
        await expect(access(fixture.directRepositoryPath)).resolves.toBeUndefined();

        // There is no unexclude UI; clear persisted exclusions through the
        // store to verify that filtering does not permanently drop topology.
        await store.save({
          ...restored,
          excludes: [],
          ...(restored.additionalRoots ? {
            additionalRoots: restored.additionalRoots.map(
              (root) => ({ ...root, excludes: [] })
            )
          } : {})
        });
        const recovered = await createService().rescan();
        expect(recovered.groups.flatMap((group) => group.targets))
          .toContainEqual(childTarget);
        expect(recovered.groups.flatMap((group) => group.targets))
          .toContainEqual(parentTarget);
      } finally {
        await localAppData.dispose();
      }
    },
    15_000
  );

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

class DeferredTopologyClient implements GitTopologyClient {
  readonly #delegate = new GitCliClient();
  #nextGate: DeferredTopologyRead | undefined;

  deferNextRead(): DeferredTopologyRead {
    if (this.#nextGate) {
      throw new Error("A topology read is already deferred.");
    }
    const gate = new DeferredTopologyRead();
    this.#nextGate = gate;
    return gate;
  }

  async readRepositoryTopology(
    path: string,
    options?: GitReadOptions
  ): Promise<RepositoryTopology> {
    const gate = this.#nextGate;
    if (gate) {
      this.#nextGate = undefined;
      await gate.wait(options?.signal);
    }
    return this.#delegate.readRepositoryTopology(path, options);
  }
}

class DeferredTopologyRead {
  readonly started: Promise<void>;
  readonly #released: Promise<void>;
  #markStarted!: () => void;
  #release!: () => void;

  constructor() {
    this.started = new Promise<void>((resolve) => {
      this.#markStarted = resolve;
    });
    this.#released = new Promise<void>((resolve) => {
      this.#release = resolve;
    });
  }

  release(): void {
    this.#release();
  }

  async wait(signal?: AbortSignal): Promise<void> {
    this.#markStarted();
    if (signal?.aborted) {
      throw scanCancelled();
    }
    if (!signal) {
      await this.#released;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const cancel = () => {
        reject(scanCancelled());
      };
      signal.addEventListener("abort", cancel, { once: true });
      void this.#released.then(() => {
        signal.removeEventListener("abort", cancel);
        resolve();
      });
    });
  }
}

function scanCancelled(): WorkspaceError {
  return new WorkspaceError(
    "SCAN_CANCELLED",
    "Workspace 扫描已取消。"
  );
}

function resolveWithin<Result>(
  promise: Promise<Result>,
  timeoutMs: number
): Promise<Result> {
  return new Promise<Result>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Operation did not finish within ${timeoutMs} ms.`
        )
      );
    }, timeoutMs);
    void promise.then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}
