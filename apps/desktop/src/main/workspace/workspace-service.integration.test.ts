import {
  access,
  rename
} from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WorkspaceService } from "@gitnest/application";
import { GitCliClient } from "@gitnest/git-cli";
import { JsonWorkspaceStore } from "@gitnest/persistence-json";
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

  it("discovers, classifies, groups, deduplicates, reassigns overlapping roots, and restores persisted state", async () => {
    const metaResult = await service.addEntry({
      path: fixture.metaRootPath,
      source: "picker"
    });
    const metaEntry = metaResult.workspace.entries[0];

    expect(metaEntry).toMatchObject({
      kind: "workspace-meta-repository",
      path: fixture.metaRootPath
    });
    expect(metaEntry?.groups.map((group) => group.name)).toEqual([
      "原/根仓库",
      "svr"
    ]);
    expect(
      metaEntry?.groups.find(
        (group) => group.name === "原/根仓库"
      )?.targets
    ).toHaveLength(2);
    expect(metaResult.workspace.repositories).toHaveLength(3);
    expect(
      metaResult.workspace.worktrees.some(
        (worktree) => worktree.path === fixture.linkedWorktreePath
      )
    ).toBe(true);
    expect(
      metaResult.workspace.worktrees.some(
        (worktree) =>
          worktree.path === fixture.ignoredRepositoryPath
      )
    ).toBe(false);
    await expect(
      access(join(fixture.metaRootPath, ".gitnest"))
    ).rejects.toMatchObject({
      code: "ENOENT"
    });

    const directoryResult = await service.addEntry({
      path: fixture.directoryRootPath,
      source: "manual"
    });
    expect(directoryResult.workspace.entries[1]).toMatchObject({
      kind: "workspace-directory",
      groups: [{ name: "web" }]
    });

    const standaloneResult = await service.addEntry({
      path: fixture.standaloneRepositoryPath,
      source: "drop"
    });
    expect(standaloneResult.workspace.entries[2]).toMatchObject({
      kind: "standalone-repository"
    });

    const duplicateResult = await service.addEntry({
      path: fixture.metaRootPath,
      source: "drop"
    });
    expect(duplicateResult.duplicate).toBe(true);
    expect(duplicateResult.workspace.entries).toHaveLength(3);
    expect(duplicateResult.focusedEntryId).toBe(metaEntry?.id);

    const overlapResult = await service.addEntry({
      path: join(fixture.metaRootPath, "svr"),
      source: "manual"
    });
    const rescannedMeta = overlapResult.workspace.entries.find(
      (entry) => entry.id === metaEntry?.id
    );
    const overlapEntry = overlapResult.workspace.entries.find(
      (entry) => entry.path === join(fixture.metaRootPath, "svr")
    );

    expect(rescannedMeta?.groups.map((group) => group.name)).toEqual([
      "原/根仓库"
    ]);
    expect(overlapEntry).toMatchObject({
      kind: "workspace-directory",
      groups: [{ name: "原/根仓库" }]
    });

    const group = overlapEntry?.groups[0];
    expect(group).toBeDefined();
    const collapsed = await service.setGroupCollapsed({
      entryId: overlapEntry?.id as string,
      groupId: group?.id as string,
      collapsed: true
    });
    expect(
      collapsed.entries.find(
        (entry) => entry.id === overlapEntry?.id
      )?.groups[0]?.collapsed
    ).toBe(true);

    const renamed = await service.updateEntry({
      entryId: overlapEntry?.id as string,
      displayName: "Backend repositories",
      order: 0
    });
    expect(renamed.entries[0]).toMatchObject({
      id: overlapEntry?.id,
      displayName: "Backend repositories",
      order: 0
    });

    const restored = await new WorkspaceService(
      new GitCliClient(),
      new NodeWorkspaceFileSystem(),
      new JsonWorkspaceStore(storePath),
      { clock }
    ).getCurrent();
    expect(restored).toEqual(renamed);
    expect(restored.entries[0]?.groups[0]?.collapsed).toBe(true);
  }, 15_000);

  it("does not add a directory without repositories", async () => {
    await expect(
      service.addEntry({
        path: fixture.emptyDirectoryPath,
        source: "manual"
      })
    ).rejects.toMatchObject({
      code: "NO_REPOSITORIES_FOUND"
    });
  });

  it("removes an entry from Workspace without deleting its directory", async () => {
    const localFixture = await createWorkspaceFixture();
    const localAppData =
      await createTemporaryDirectoryFixture(
        "remove-entry-app-data"
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
      const meta = await localService.addEntry({
        path: localFixture.metaRootPath,
        source: "picker"
      });
      const metaEntry = meta.workspace.entries[0];
      const nestedTarget = metaEntry?.groups
        .find((group) => group.name === "svr")
        ?.targets[0];

      if (!nestedTarget || !metaEntry) {
        throw new Error("Workspace fixture did not contain a nested repository.");
      }
      const withoutNested = await localService.removeEntry({
        entryId: metaEntry.id,
        target: nestedTarget
      });
      expect(
        withoutNested.entries
          .find((entry) => entry.id === metaEntry?.id)
          ?.groups.some((group) =>
            group.targets.some(
              (target) =>
                target.repositoryId ===
                  nestedTarget?.repositoryId &&
                target.worktreeId === nestedTarget?.worktreeId
            )
          )
      ).toBe(false);
      await expect(
        access(localFixture.nestedRepositoryPath)
      ).resolves.toBeUndefined();

      const standalone = await localService.addEntry({
        path: localFixture.standaloneRepositoryPath,
        source: "manual"
      });
      const standaloneEntry = standalone.workspace.entries.find(
        (entry) =>
          entry.path === localFixture.standaloneRepositoryPath
      );

      expect(standaloneEntry).toBeDefined();
      const removed = await localService.removeEntry({
        entryId: standaloneEntry?.id as string
      });

      expect(
        removed.entries.some(
          (entry) => entry.id === standaloneEntry?.id
        )
      ).toBe(false);
      await expect(
        access(localFixture.standaloneRepositoryPath)
      ).resolves.toBeUndefined();

      const remaining = removed.entries.find(
        (entry) => entry.id === metaEntry?.id
      );
      expect(remaining).toBeDefined();
      const empty = await localService.removeEntry({
        entryId: remaining?.id as string
      });
      expect(empty.entries).toHaveLength(0);
      await expect(access(localFixture.metaRootPath)).resolves.toBeUndefined();
    } finally {
      await localFixture.dispose();
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
      const added = await offlineService.addEntry({
        path: originalPath,
        source: "picker"
      });
      const previousRepositoryId =
        added.workspace.repositories[0]?.id;

      await rename(originalPath, movedPath);
      moved = true;
      const offline = await offlineService.rescan();
      expect(offline.entries[0]).toMatchObject({
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
      expect(recovered.entries[0]?.scanIssues).toEqual([]);
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
