import {
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  WORKSPACE_CATALOG_SCHEMA_VERSION,
  WORKSPACE_SCHEMA_VERSION,
  createEmptyWorkspace
} from "@gitnest/workspace-core";
import {
  createTemporaryDirectoryFixture,
  type TemporaryDirectoryFixture
} from "@gitnest/testkit";

import { AtomicJsonStore } from "./atomic-json-store";
import { migrateWorkspaceDocumentSet } from "./migrations/workspace-document";
import { JsonRepositorySnapshotStore } from "./repository-snapshot.repository";
import { JsonWorkspaceCollectionStore } from "./workspace-collection.repository";
import { JsonWorkspaceSnapshotCollectionStore } from "./workspace-runtime-stores";
import { JsonWorkspaceStore } from "./workspace.repository";

describe("JsonWorkspaceStore", () => {
  let temporary: TemporaryDirectoryFixture | undefined;

  afterEach(async () => {
    await temporary?.dispose();
    temporary = undefined;
  });

  it("writes through a same-directory temporary file and atomically replaces an existing document", async () => {
    temporary =
      await createTemporaryDirectoryFixture("json-store");
    const filePath = join(
      temporary.path,
      "workspaces",
      "default.workspace.json"
    );
    const store = new JsonWorkspaceStore(filePath);
    const initial = createEmptyWorkspace(
      "2026-09-04T10:00:00.000Z"
    );
    const updated = {
      ...initial,
      name: "Persisted Workspace",
      updatedAt: "2026-09-04T11:00:00.000Z"
    };

    await store.save(initial);
    await store.save(updated);

    await expect(store.load()).resolves.toEqual(updated);
    await expect(
      readdir(join(temporary.path, "workspaces"))
    ).resolves.toEqual(["default.workspace.json"]);
    await expect(readFile(filePath, "utf8")).resolves.not.toMatch(
      /token|password|private.?key/i
    );
  });

  it("round-trips additional Workspace roots", async () => {
    temporary =
      await createTemporaryDirectoryFixture("workspace-roots");
    const filePath = join(
      temporary.path,
      "default.workspace.json"
    );
    const workspace = {
      ...createEmptyWorkspace("2026-09-23T10:00:00.000Z"),
      path: "C:\\workspace",
      canonicalPath: "c:\\workspace",
      excludes: [],
      additionalRoots: [
        {
          path: "D:\\shared\\tools",
          canonicalPath: "d:\\shared\\tools",
          excludes: ["vendor"]
        }
      ],
      lastScannedAt: "2026-09-23T10:00:00.000Z"
    };
    const store = new JsonWorkspaceStore(filePath);

    await store.save(workspace);

    await expect(store.load()).resolves.toEqual(workspace);
  });

  it.each([
    {
      path: "C:\\workspace"
    },
    {
      path: "C:\\workspace",
      canonicalPath: "c:\\workspace"
    },
    {
      lastScannedAt: "2026-09-22T10:00:00.000Z"
    }
  ])(
    "rejects a Workspace whose root path fields are only partially persisted",
    async (partialRoot) => {
      temporary =
        await createTemporaryDirectoryFixture(
          "workspace-partial-root"
        );
      const filePath = join(
        temporary.path,
        "default.workspace.json"
      );
      await new AtomicJsonStore(filePath).write({
        ...createEmptyWorkspace(
          "2026-09-22T10:00:00.000Z"
        ),
        ...partialRoot
      });

      await expect(
        new JsonWorkspaceStore(filePath).load()
      ).rejects.toMatchObject({
        code: "INVALID_PERSISTED_DATA"
      });
    }
  );

  it("rejects an unconfigured Workspace that still contains topology", async () => {
    temporary =
      await createTemporaryDirectoryFixture(
        "workspace-rootless-topology"
      );
    const filePath = join(
      temporary.path,
      "default.workspace.json"
    );
    const workspace = migrateWorkspaceDocumentSet(
      createLegacyWorkspaceDocument()
    )[0];
    if (!workspace) {
      throw new Error("Expected a migrated Workspace fixture.");
    }
    const invalid = structuredClone(workspace) as unknown as Record<
      string,
      unknown
    >;
    delete invalid.path;
    delete invalid.canonicalPath;
    delete invalid.lastScannedAt;
    await new AtomicJsonStore(filePath).write(invalid);

    await expect(
      new JsonWorkspaceStore(filePath).load()
    ).rejects.toMatchObject({
      code: "INVALID_PERSISTED_DATA"
    });
  });

  it("promotes each legacy top-level entry into an independent Workspace", async () => {
    temporary =
      await createTemporaryDirectoryFixture(
        "workspace-collection"
      );
    const legacyPath = join(
      temporary.path,
      "workspaces",
      "default.workspace.json"
    );
    const legacy = createLegacyWorkspaceWithTwoEntries();
    await new AtomicJsonStore(legacyPath).write(legacy);
    const store = new JsonWorkspaceCollectionStore({
      catalogFilePath: join(
        temporary.path,
        "workspaces",
        "catalog.json"
      ),
      workspaceDirectory: join(
        temporary.path,
        "workspaces",
        "items"
      ),
      legacyWorkspaceFilePath: legacyPath,
      clock: () => "2026-09-20T10:00:00.000Z"
    });

    const catalog = await store.loadCatalog();
    expect(catalog).toEqual({
      schemaVersion: WORKSPACE_CATALOG_SCHEMA_VERSION,
      activeWorkspaceId: "default",
      workspaces: [
        {
          id: "default",
          name: "Python",
          updatedAt: "2026-09-20T09:00:00.000Z"
        },
        {
          id: expect.stringMatching(
            /^workspace_[a-f0-9]{32}$/
          ),
          name: "Web",
          updatedAt: "2026-09-20T09:00:00.000Z"
        }
      ],
      updatedAt: "2026-09-20T10:00:00.000Z"
    });
    const promotedId = catalog?.workspaces[1]?.id;
    expect(promotedId).toBeTruthy();
    await expect(store.loadWorkspace("default")).resolves.toMatchObject({
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      id: "default",
      name: "Python",
      path: "C:\\workspace",
      groups: [{ id: "group" }],
      repositories: [{ id: "repository" }],
      worktrees: [
        { id: "worktree" },
        { id: "worktree-linked" }
      ]
    });
    await expect(
      store.loadWorkspace(promotedId as string)
    ).resolves.toMatchObject({
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      id: promotedId,
      name: "Web",
      path: "C:\\workspace\\web",
      groups: [
        {
          name: "原/根仓库",
          targets: [
            {
              repositoryId: "repository_web",
              worktreeId: "worktree_web"
            }
          ]
        }
      ],
      repositories: [{ id: "repository_web" }],
      worktrees: [{ id: "worktree_web" }]
    });
    expect(
      await store.loadWorkspace("default")
    ).not.toHaveProperty("entries");
    await expect(
      readdir(
        join(temporary.path, "workspaces", "items")
      )
    ).resolves.toEqual(
      [
        "default.workspace.json",
        `${promotedId}.workspace.json`
      ].sort()
    );
  });

  it("keeps the original Workspace id on the selected legacy Entry and generates stable ids for the others", () => {
    const legacy = createLegacyWorkspaceWithTwoEntries();
    legacy.selectedEntryId = "entry_web";

    const firstMigration =
      migrateWorkspaceDocumentSet(legacy);
    const secondMigration =
      migrateWorkspaceDocumentSet(legacy);

    expect(secondMigration).toEqual(firstMigration);
    expect(firstMigration).toHaveLength(2);
    expect(
      firstMigration.find(
        (workspace) => workspace.id === "default"
      )
    ).toMatchObject({
      id: "default",
      name: "Web",
      path: "C:\\workspace\\web"
    });

    const promoted = firstMigration.find(
      (workspace) => workspace.id !== "default"
    );
    expect(promoted).toMatchObject({
      id: expect.stringMatching(
        /^workspace_[a-f0-9]{32}$/
      ),
      name: "Python",
      worktrees: [
        { id: "worktree" },
        { id: "worktree-linked" }
      ]
    });
  });

  it.each([1, 2] as const)(
    "migrates a v%s catalog and splits every legacy multi-entry Workspace",
    async (catalogSchemaVersion) => {
      temporary =
        await createTemporaryDirectoryFixture(
          "workspace-catalog-v1-repair"
        );
      const workspaceDirectory = join(
        temporary.path,
        "workspaces"
      );
      const legacyPath = join(
        workspaceDirectory,
        "default.workspace.json"
      );
      const itemDirectory = join(
        workspaceDirectory,
        "items"
      );
      const legacy = createLegacyWorkspaceWithTwoEntries();
      const current = structuredClone(legacy);
      current.entries[0]!.displayName = "Python Current";
      current.updatedAt = "2026-09-20T09:30:00.000Z";
      const existing = {
        ...createEmptyWorkspace(
          "2026-09-20T09:45:00.000Z"
        ),
        id: "workspace_existing",
        name: "Existing Workspace"
      };

      await new AtomicJsonStore(legacyPath).write(legacy);
      await new AtomicJsonStore(
        join(itemDirectory, "default.workspace.json")
      ).write(current);
      await new JsonWorkspaceStore(
        join(
          itemDirectory,
          "workspace_existing.workspace.json"
        )
      ).save(existing);
      await new AtomicJsonStore(
        join(workspaceDirectory, "catalog.json")
      ).write({
        schemaVersion: catalogSchemaVersion,
        activeWorkspaceId: existing.id,
        workspaces: [
          {
            id: current.id,
            name: current.name,
            updatedAt: current.updatedAt
          },
          {
            id: existing.id,
            name: existing.name,
            updatedAt: existing.updatedAt
          }
        ],
        updatedAt: "2026-09-20T09:45:00.000Z"
      });

      const store = new JsonWorkspaceCollectionStore({
        catalogFilePath: join(
          workspaceDirectory,
          "catalog.json"
        ),
        workspaceDirectory: itemDirectory,
        legacyWorkspaceFilePath: legacyPath,
        clock: () => "2026-09-20T10:00:00.000Z"
      });
      const catalog = await store.loadCatalog();

      expect(catalog).toMatchObject({
        schemaVersion: WORKSPACE_CATALOG_SCHEMA_VERSION,
        activeWorkspaceId: existing.id,
        workspaces: [
          {
            id: "default",
            name: "Python Current",
            updatedAt: current.updatedAt
          },
          {
            name: "Web",
            updatedAt: current.updatedAt
          },
          {
            id: existing.id,
            name: existing.name,
            updatedAt: existing.updatedAt
          }
        ],
        updatedAt: "2026-09-20T10:00:00.000Z"
      });
      await expect(
        store.loadWorkspace("default")
      ).resolves.toMatchObject({
        name: "Python Current",
        path: "C:\\workspace",
        groups: [{ id: "group" }]
      });
      await expect(
        store.loadWorkspace(existing.id)
      ).resolves.toEqual(existing);
    }
  );

  it("rejects an unsupported persisted schema", async () => {
    temporary =
      await createTemporaryDirectoryFixture("json-invalid");
    const filePath = join(
      temporary.path,
      "default.workspace.json"
    );
    await new AtomicJsonStore(filePath).write({
      schemaVersion: 99
    });

    const store = new JsonWorkspaceStore(filePath);
    await expect(store.load()).rejects.toMatchObject({
      code: "INVALID_PERSISTED_DATA"
    });
    await expect(
      store.save(createEmptyWorkspace())
    ).rejects.toMatchObject({
      code: "PERSISTENCE_FAILED",
      message: expect.stringContaining("Refusing to overwrite")
    });
    await expect(readFile(filePath, "utf8")).resolves.toContain(
      '"schemaVersion": 99'
    );
  });

  it("classifies malformed JSON as invalid persisted data", async () => {
    temporary =
      await createTemporaryDirectoryFixture("json-malformed");
    const filePath = join(
      temporary.path,
      "default.workspace.json"
    );
    await writeFile(filePath, "{ invalid", "utf8");

    const store = new JsonWorkspaceStore(filePath);
    await expect(store.load()).rejects.toMatchObject({
      code: "INVALID_PERSISTED_DATA"
    });
    await expect(
      store.save(createEmptyWorkspace())
    ).rejects.toMatchObject({
      code: "PERSISTENCE_FAILED"
    });
    await expect(readFile(filePath, "utf8")).resolves.toBe(
      "{ invalid"
    );
  });

  it("recovers the newest valid same-directory pending write when the final file is absent", async () => {
    temporary =
      await createTemporaryDirectoryFixture("json-recovery");
    const directory = join(temporary.path, "workspaces");
    const filePath = join(
      directory,
      "default.workspace.json"
    );
    await mkdir(directory, { recursive: true });
    const workspace = createEmptyWorkspace(
      "2026-09-04T12:00:00.000Z"
    );
    await writeFile(
      join(
        directory,
        ".default.workspace.json.100.1.valid.tmp"
      ),
      `${JSON.stringify(workspace)}\n`,
      "utf8"
    );
    await writeFile(
      join(
        directory,
        ".default.workspace.json.100.0.invalid.tmp"
      ),
      "{ invalid",
      "utf8"
    );

    await expect(
      new JsonWorkspaceStore(filePath).load()
    ).resolves.toEqual(workspace);
    await expect(readdir(directory)).resolves.toEqual([
      "default.workspace.json"
    ]);
  });

  it("preserves malformed pending writes and blocks initialization when recovery is impossible", async () => {
    temporary =
      await createTemporaryDirectoryFixture(
        "json-invalid-recovery"
      );
    const directory = join(temporary.path, "workspaces");
    const filePath = join(
      directory,
      "default.workspace.json"
    );
    const pendingName =
      ".default.workspace.json.100.1.invalid.tmp";
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, pendingName),
      "{ invalid",
      "utf8"
    );
    const store = new JsonWorkspaceStore(filePath);

    await expect(store.load()).rejects.toMatchObject({
      code: "INVALID_PERSISTED_DATA"
    });
    await expect(
      store.save(createEmptyWorkspace())
    ).rejects.toMatchObject({
      code: "INVALID_PERSISTED_DATA"
    });
    await expect(readdir(directory)).resolves.toEqual([
      pendingName
    ]);
  });

  it("cleans stale pending writes only after a valid final document is present", async () => {
    temporary =
      await createTemporaryDirectoryFixture(
        "json-stale-pending"
      );
    const directory = join(temporary.path, "workspaces");
    const filePath = join(
      directory,
      "default.workspace.json"
    );
    const workspace = createEmptyWorkspace(
      "2026-09-04T12:00:00.000Z"
    );
    await mkdir(directory, { recursive: true });
    await writeFile(
      filePath,
      `${JSON.stringify(workspace)}\n`,
      "utf8"
    );
    await writeFile(
      join(
        directory,
        ".default.workspace.json.100.1.tmp"
      ),
      "{ invalid",
      "utf8"
    );

    await expect(
      new JsonWorkspaceStore(filePath).load()
    ).resolves.toEqual(workspace);
    await expect(readdir(directory)).resolves.toEqual([
      "default.workspace.json"
    ]);
  });

  it("migrates a supported v0 Workspace directly to v2 and drops unknown fields", async () => {
    temporary =
      await createTemporaryDirectoryFixture(
        "workspace-migration"
      );
    const filePath = join(
      temporary.path,
      "default.workspace.json"
    );
    await new AtomicJsonStore(filePath).write(
      createLegacyWorkspaceDocument()
    );

    const migrated = await new JsonWorkspaceStore(
      filePath
    ).load();
    expect(migrated).toMatchObject({
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      path: "C:\\workspace",
      groups: [
        {
          name: "原/根仓库",
          collapsed: false
        }
      ],
      scanIssues: [],
      worktrees: [
        {
          isDetached: false,
          isLocked: false,
          isPrunable: false
        }
      ]
    });
    const persisted = JSON.parse(
      await readFile(filePath, "utf8")
    );
    expect(persisted.schemaVersion).toBe(
      WORKSPACE_SCHEMA_VERSION
    );
    expect(persisted.entries).toBeUndefined();
    expect(persisted.unknownLegacyField).toBeUndefined();
  });

  it("normalizes root and standalone targets into the default Workspace group", async () => {
    temporary =
      await createTemporaryDirectoryFixture(
        "workspace-root-group-normalization"
      );
    const filePath = join(
      temporary.path,
      "default.workspace.json"
    );
    const document =
      createLegacyWorkspaceWithTwoEntries() as unknown as Record<
        string,
        unknown
      >;
    const entries = document.entries as Array<
      Record<string, unknown>
    >;
    const entry = entries[0] as Record<string, unknown>;
    const target = document.selectedTarget;
    entry.kind = "workspace-meta-repository";
    entry.rootTarget = target;
    (
      (entry.groups as Array<Record<string, unknown>>)[0]!
        .targets as unknown[]
    ).length = 0;
    await new AtomicJsonStore(filePath).write(document);

    const migrated = await new JsonWorkspaceStore(
      filePath
    ).load();
    expect(migrated).toMatchObject({
      path: "C:\\workspace",
      groups: [
        {
          name: "原/根仓库",
          targets: [target]
        }
      ]
    });
    const persisted = JSON.parse(
      await readFile(filePath, "utf8")
    );
    expect(persisted.groups[0]).toMatchObject({
      name: "原/根仓库",
      targets: [target]
    });
    expect(persisted.entries).toBeUndefined();
  });

  it("rejects semantically inconsistent Repository and selected-target relationships", async () => {
    temporary =
      await createTemporaryDirectoryFixture(
        "workspace-relationships"
      );
    const filePath = join(
      temporary.path,
      "default.workspace.json"
    );
    const document =
      createCurrentWorkspaceDocument() as Record<
        string,
        unknown
      >;
    const repositories = document.repositories as Array<
      Record<string, unknown>
    >;
    const worktrees = document.worktrees as Array<
      Record<string, unknown>
    >;
    (repositories[0]?.worktreeIds as string[]).push(
      "orphan-worktree"
    );
    worktrees.push({
      ...worktrees[0],
      id: "orphan-worktree",
      path: "C:\\workspace\\orphan",
      canonicalPath: "c:\\workspace\\orphan",
      isPrimary: false
    });
    document.selectedTarget = {
      repositoryId: "repository",
      worktreeId: "orphan-worktree"
    };
    await new AtomicJsonStore(filePath).write(document);

    await expect(
      new JsonWorkspaceStore(filePath).load()
    ).rejects.toMatchObject({
      code: "INVALID_PERSISTED_DATA"
    });
  });

  it("persists and restores repository status snapshots independently from Workspace configuration", async () => {
    temporary =
      await createTemporaryDirectoryFixture("snapshot-store");
    const filePath = join(
      temporary.path,
      "cache",
      "workspace.snapshots.json"
    );
    const store = new JsonRepositorySnapshotStore(
      filePath,
      () => "2026-09-04T12:00:00.000Z"
    );
    const snapshots = [
      {
        repositoryId: "repository",
        worktreeId: "worktree",
        branch: "main",
        head: "abc123",
        upstream: "origin/main",
        ahead: 1,
        behind: 2,
        staged: 1,
        unstaged: 2,
        untracked: 3,
        conflicted: 0,
        contentVersion: 7,
        refreshPending: false,
        stale: false,
        refreshedAt: "2026-09-04T11:59:00.000Z"
      }
    ];

    await store.save("workspace", snapshots);

    await expect(store.load("workspace")).resolves.toEqual(
      snapshots
    );
    await expect(store.load("other-workspace")).rejects.toMatchObject({
      code: "INVALID_PERSISTED_DATA"
    });
  });

  it("isolates repository snapshot caches by Workspace id", async () => {
    temporary =
      await createTemporaryDirectoryFixture(
        "snapshot-collection"
      );
    const store =
      new JsonWorkspaceSnapshotCollectionStore({
        directoryPath: join(
          temporary.path,
          "cache",
          "repository-snapshots"
        ),
        clock: () => "2026-09-20T12:00:00.000Z"
      });
    const snapshots = [
      {
        repositoryId: "repository",
        worktreeId: "worktree",
        branch: "main",
        head: "abc123",
        ahead: 0,
        behind: 0,
        staged: 1,
        unstaged: 0,
        untracked: 0,
        conflicted: 0,
        refreshPending: false,
        stale: false,
        refreshedAt: "2026-09-20T11:59:00.000Z"
      }
    ];

    await store.save("workspace_one", snapshots);
    await store.save("workspace_two", []);

    await expect(
      store.load("workspace_one")
    ).resolves.toEqual(snapshots);
    await expect(
      store.load("workspace_two")
    ).resolves.toEqual([]);
  });

  it("migrates legacy snapshots to explicit stale terminal cache state", async () => {
    temporary =
      await createTemporaryDirectoryFixture(
        "snapshot-migration"
      );
    const filePath = join(
      temporary.path,
      "cache",
      "workspace.snapshots.json"
    );
    await new AtomicJsonStore(filePath).write({
      schemaVersion: 0,
      workspaceId: "workspace",
      snapshots: [
        {
          repositoryId: "repository",
          worktreeId: "worktree",
          branch: "main",
          head: "abc123",
          ahead: 0,
          behind: 0,
          staged: 0,
          unstaged: 0,
          untracked: 0,
          conflicted: 0,
          refreshedAt: "2026-09-04T11:59:00.000Z"
        }
      ],
      updatedAt: "2026-09-04T12:00:00.000Z",
      unknownLegacyField: true
    });
    const store = new JsonRepositorySnapshotStore(
      filePath
    );

    await expect(store.load("workspace")).resolves.toEqual([
      expect.objectContaining({
        refreshPending: false,
        stale: true
      })
    ]);
    const persisted = JSON.parse(
      await readFile(filePath, "utf8")
    );
    expect(persisted.schemaVersion).toBe(1);
    expect(persisted.unknownLegacyField).toBeUndefined();
  });
});

interface MutableLegacyWorkspaceEntry
  extends Record<string, unknown> {
  id: string;
  displayName: string;
}

interface MutableLegacyWorkspaceDocument
  extends Record<string, unknown> {
  schemaVersion: number;
  id: string;
  name: string;
  entries: MutableLegacyWorkspaceEntry[];
  repositories: Array<Record<string, unknown>>;
  worktrees: Array<Record<string, unknown>>;
  selectedEntryId?: string;
  updatedAt: string;
}

function createLegacyWorkspaceDocument(): MutableLegacyWorkspaceDocument {
  return {
    schemaVersion: 0,
    id: "workspace",
    name: "Legacy Workspace",
    entries: [
      {
        id: "entry",
        displayName: "Root",
        path: "C:\\workspace",
        canonicalPath: "c:\\workspace",
        excludes: [],
        order: 0,
        groups: [
          {
            id: "group",
            name: "根目录仓库",
            targets: [
              {
                repositoryId: "repository",
                worktreeId: "worktree"
              }
            ]
          }
        ],
        lastScannedAt: "2026-09-04T11:00:00.000Z",
        kind: "workspace-directory"
      }
    ],
    repositories: [
      {
        id: "repository",
        name: "repository",
        commonDir: "C:\\workspace\\repository\\.git",
        canonicalCommonDir:
          "c:\\workspace\\repository\\.git",
        primaryWorktreeId: "worktree",
        worktreeIds: ["worktree"]
      }
    ],
    worktrees: [
      {
        id: "worktree",
        repositoryId: "repository",
        name: "repository",
        path: "C:\\workspace\\repository",
        canonicalPath: "c:\\workspace\\repository",
        gitDir: "C:\\workspace\\repository\\.git",
        head: "abc123",
        branch: "main",
        isPrimary: true,
        isBare: false
      }
    ],
    selectedEntryId: "entry",
    selectedTarget: {
      repositoryId: "repository",
      worktreeId: "worktree"
    },
    updatedAt: "2026-09-04T12:00:00.000Z",
    unknownLegacyField: true
  };
}

function createCurrentWorkspaceDocument(): MutableLegacyWorkspaceDocument {
  const document = structuredClone(
    createLegacyWorkspaceDocument()
  );
  document.schemaVersion = 1;
  delete document.unknownLegacyField;
  const entries = document.entries as Array<
    Record<string, unknown>
  >;
  for (const entry of entries) {
    entry.scanIssues = [];
    for (const group of entry.groups as Array<
      Record<string, unknown>
    >) {
      group.collapsed = false;
    }
  }
  const worktrees = document.worktrees as Array<
    Record<string, unknown>
  >;
  for (const worktree of worktrees) {
    worktree.isDetached = false;
    worktree.isLocked = false;
    worktree.isPrunable = false;
  }
  return document;
}

function createLegacyWorkspaceWithTwoEntries(): MutableLegacyWorkspaceDocument {
  const workspace = createCurrentWorkspaceDocument();
  workspace.id = "default";
  workspace.name = "GitNest Workspace";
  workspace.updatedAt = "2026-09-20T09:00:00.000Z";
  workspace.entries[0]!.displayName = "Python";
  workspace.entries.push({
    id: "entry_web",
    displayName: "Web",
    path: "C:\\workspace\\web",
    canonicalPath: "c:\\workspace\\web",
    excludes: [],
    order: 1,
    groups: [],
    scanIssues: [],
    lastScannedAt: "2026-09-20T08:59:00.000Z",
    kind: "standalone-repository",
    target: {
      repositoryId: "repository_web",
      worktreeId: "worktree_web"
    }
  });
  workspace.repositories.push({
    id: "repository_web",
    name: "web",
    commonDir: "C:\\workspace\\web\\.git",
    canonicalCommonDir: "c:\\workspace\\web\\.git",
    primaryWorktreeId: "worktree_web",
    worktreeIds: ["worktree_web"]
  });
  workspace.worktrees.push({
    id: "worktree_web",
    repositoryId: "repository_web",
    name: "web",
    path: "C:\\workspace\\web",
    canonicalPath: "c:\\workspace\\web",
    gitDir: "C:\\workspace\\web\\.git",
    head: "def456",
    branch: "main",
    isPrimary: true,
    isBare: false,
    isDetached: false,
    isLocked: false,
    isPrunable: false
  });
  const rootRepository = workspace.repositories[0];
  if (!rootRepository) {
    throw new Error("Legacy Workspace fixture is incomplete.");
  }
  (rootRepository.worktreeIds as string[]).push(
    "worktree-linked"
  );
  workspace.worktrees.push({
    id: "worktree-linked",
    repositoryId: "repository",
    name: "repository-linked",
    path: "D:\\linked\\repository",
    canonicalPath: "d:\\linked\\repository",
    gitDir:
      "C:\\workspace\\repository\\.git\\worktrees\\repository-linked",
    head: "abc456",
    branch: "feature/linked",
    isPrimary: false,
    isBare: false,
    isDetached: false,
    isLocked: false,
    isPrunable: false
  });
  return workspace;
}
