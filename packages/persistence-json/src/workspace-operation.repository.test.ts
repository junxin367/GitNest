import {
  readFile,
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
