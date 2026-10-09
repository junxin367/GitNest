import {
  mkdir,
  readFile,
  rename,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";

import {
  afterEach,
  describe,
  expect,
  it
} from "vitest";

import type { WorkspaceOperation } from "@gitnest/application";
import {
  createTemporaryDirectoryFixture,
  type TemporaryDirectoryFixture
} from "@gitnest/testkit";

import {
  JsonWorkspaceOperationStore,
  WORKSPACE_OPERATION_SCHEMA_VERSION
} from "./workspace-operation.repository";
import { JsonWorkspaceOperationCollectionStore } from "./workspace-runtime-stores";

describe("JsonWorkspaceOperationStore", () => {
  let temporary: TemporaryDirectoryFixture | undefined;

  afterEach(async () => {
    await temporary?.dispose();
    temporary = undefined;
  });

  it("round-trips bounded operation recovery records", async () => {
    temporary =
      await createTemporaryDirectoryFixture(
        "operation-store"
      );
    const filePath = join(
      temporary.path,
      "operations",
      "default.operations.json"
    );
    const store = new JsonWorkspaceOperationStore(
      filePath,
      () => "2026-09-04T12:00:00.000Z"
    );
    const operations = [
      createOperation("operation_1", "running")
    ];

    await store.save("workspace", operations);
    await expect(store.load("workspace")).resolves.toEqual(
      operations
    );
    await expect(store.load("other")).rejects.toMatchObject({
      code: "INVALID_PERSISTED_DATA"
    });
  });

  it("isolates operation history by Workspace id", async () => {
    temporary =
      await createTemporaryDirectoryFixture(
        "operation-collection"
      );
    const store =
      new JsonWorkspaceOperationCollectionStore({
        directoryPath: join(
          temporary.path,
          "operations",
          "items"
        ),
        clock: () => "2026-09-20T12:00:00.000Z"
      });
    const first = [
      createOperation("operation_first", "succeeded")
    ];
    const second = [
      createOperation("operation_second", "running")
    ];

    await store.save("workspace_one", first);
    await store.save("workspace_two", second);

    await expect(
      store.load("workspace_one")
    ).resolves.toEqual(first);
    await expect(
      store.load("workspace_two")
    ).resolves.toEqual(second);
  });

  it("preserves queued ignore-file operations in recovery history", async () => {
    temporary = await createTemporaryDirectoryFixture("ignore-operation-store");
    const store = new JsonWorkspaceOperationStore(join(temporary.path, "operations.json"));
    const operation = { ...createOperation("ignore:1", "succeeded"), kind: "ignore-file" as const };
    await store.save("workspace", [operation]);
    await expect(store.load("workspace")).resolves.toEqual([operation]);
  });

  it("migrates a v0 operation document and drops unknown fields", async () => {
    temporary =
      await createTemporaryDirectoryFixture(
        "operation-migration"
      );
    const filePath = join(
      temporary.path,
      "operations.json"
    );
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 0,
        workspaceId: "workspace",
        operations: [
          {
            id: "operation_1",
            kind: "scan",
            state: "running",
            message: "Scanning.",
            unknown: true
          }
        ],
        updatedAt: "2026-09-04T11:00:00.000Z",
        unknownDocumentField: true
      }),
      "utf8"
    );
    const store = new JsonWorkspaceOperationStore(
      filePath
    );

    await expect(store.load("workspace")).resolves.toEqual([
      {
        id: "operation_1",
        kind: "scan",
        scope: "workspace",
        targetIds: [],
        state: "running",
        progress: 0,
        succeeded: 0,
        failed: 0,
        message: "Scanning."
      }
    ]);
    const persisted = JSON.parse(
      await readFile(filePath, "utf8")
    );
    expect(persisted.schemaVersion).toBe(
      WORKSPACE_OPERATION_SCHEMA_VERSION
    );
    expect(persisted.unknownDocumentField).toBeUndefined();
    expect(persisted.operations[0].unknown).toBeUndefined();
  });

  it.each([
    ["pending history", true, false],
    ["pending empty history", true, true],
    ["primary empty history", false, true]
  ] as const)(
    "prefers scoped %s over legacy operations",
    async (_label, pendingOnly, empty) => {
      temporary = await createTemporaryDirectoryFixture("operation-scoped-recovery");
      const directoryPath = join(temporary.path, "items");
      const legacyFilePath = join(temporary.path, "legacy.json");
      const scopedPath = join(directoryPath, "default.operations.json");
      const legacy = [createOperation("legacy", "succeeded")];
      const current = empty ? [] : [createOperation("current", "running")];
      await new JsonWorkspaceOperationStore(legacyFilePath).save("default", legacy);
      await new JsonWorkspaceOperationStore(scopedPath).save("default", current);
      const pendingPath = join(directoryPath, ".default.operations.json.pending.tmp");
      if (pendingOnly) {
        await rename(scopedPath, pendingPath);
      }
      const store = new JsonWorkspaceOperationCollectionStore({ directoryPath, legacyFilePath });

      await expect(store.load("default")).resolves.toEqual(current);
      await expect(store.load("default")).resolves.toEqual(current);
      expect(JSON.parse(await readFile(scopedPath, "utf8")).operations).toEqual(current);
      if (pendingOnly) {
        await expect(readFile(pendingPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      }
      expect(JSON.parse(await readFile(legacyFilePath, "utf8")).operations).toEqual(legacy);
    }
  );

  it.each([false, true])(
    "migrates legacy operations once and preserves an emptied scoped history (pending=%s)",
    async (pendingOnly) => {
      temporary = await createTemporaryDirectoryFixture("operation-legacy-recovery");
      const directoryPath = join(temporary.path, "items");
      const legacyFilePath = join(temporary.path, "legacy.json");
      const operations = [createOperation("legacy", "succeeded")];
      await new JsonWorkspaceOperationStore(legacyFilePath).save("default", operations);
      if (pendingOnly) {
        await rename(legacyFilePath, join(temporary.path, ".legacy.json.pending.tmp"));
      }
      const store = new JsonWorkspaceOperationCollectionStore({ directoryPath, legacyFilePath });

      await expect(store.load("default")).resolves.toEqual(operations);
      await store.save("default", []);
      await expect(
        new JsonWorkspaceOperationCollectionStore({ directoryPath, legacyFilePath }).load("default")
      ).resolves.toEqual([]);
    }
  );

  it.each([false, true])(
    "preserves corrupt scoped operations and refuses writes instead of using legacy (pending=%s)",
    async (pendingOnly) => {
      temporary = await createTemporaryDirectoryFixture("operation-collection-invalid");
      const directoryPath = join(temporary.path, "items");
      const legacyFilePath = join(temporary.path, "legacy.json");
      await new JsonWorkspaceOperationStore(legacyFilePath).save(
        "default", [createOperation("legacy", "succeeded")]
      );
      await mkdir(directoryPath, { recursive: true });
      const corruptPath = join(
        directoryPath,
        pendingOnly ? ".default.operations.json.pending.tmp" : "default.operations.json"
      );
      await writeFile(corruptPath, "{malformed", "utf8");
      const store = new JsonWorkspaceOperationCollectionStore({ directoryPath, legacyFilePath });

      await expect(store.load("default")).rejects.toMatchObject({ code: "INVALID_PERSISTED_DATA" });
      await expect(store.save("default", [])).rejects.toMatchObject({
        code: pendingOnly ? "INVALID_PERSISTED_DATA" : "PERSISTENCE_FAILED"
      });
      await expect(readFile(corruptPath, "utf8")).resolves.toBe("{malformed");
    }
  );

  it("keeps absent scoped and legacy operation stores absent", async () => {
    temporary = await createTemporaryDirectoryFixture("operation-collection-missing");
    const directoryPath = join(temporary.path, "items");
    const legacyFilePath = join(temporary.path, "legacy.json");
    const store = new JsonWorkspaceOperationCollectionStore({ directoryPath, legacyFilePath });

    await expect(store.load("default")).resolves.toEqual([]);
    await expect(readFile(join(directoryPath, "default.operations.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(legacyFilePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("blocks overwrite after invalid persisted operation data", async () => {
    temporary =
      await createTemporaryDirectoryFixture(
        "operation-invalid"
      );
    const filePath = join(
      temporary.path,
      "operations.json"
    );
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        workspaceId: "workspace",
        operations: [
          {
            ...createOperation(
              "operation_1",
              "succeeded"
            ),
            progress: 2
          }
        ],
        updatedAt: "2026-09-04T11:00:00.000Z"
      }),
      "utf8"
    );
    const original = await readFile(filePath, "utf8");
    const store = new JsonWorkspaceOperationStore(
      filePath
    );

    await expect(store.load("workspace")).rejects.toMatchObject({
      code: "INVALID_PERSISTED_DATA"
    });
    await expect(
      store.save("workspace", [])
    ).rejects.toMatchObject({
      code: "PERSISTENCE_FAILED"
    });
    await expect(readFile(filePath, "utf8")).resolves.toBe(
      original
    );
  });
});

function createOperation(
  id: string,
  state: WorkspaceOperation["state"]
): WorkspaceOperation {
  return {
    id,
    kind: "worktree-create",
    scope: "repository",
    targetIds: ["repository:worktree"],
    state,
    progress: state === "succeeded" ? 1 : 0.5,
    succeeded: state === "succeeded" ? 1 : 0,
    failed: 0,
    message: "Creating Worktree.",
    startedAt: "2026-09-04T11:59:00.000Z"
  };
}
