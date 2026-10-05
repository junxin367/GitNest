import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterEach,
  describe,
  expect,
  it
} from "vitest";

import { AtomicJsonStore } from "./atomic-json-store";

describe("AtomicJsonStore size limits", () => {
  const temporaryPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryPaths.map((path) =>
        rm(path, { recursive: true, force: true })
      )
    );
  });

  it("rejects an oversized primary document before parsing and blocks replacement writes", async () => {
    const { filePath } = await createStorePath(
      "oversized-primary"
    );
    await writeFile(
      filePath,
      JSON.stringify({ value: "x".repeat(256) }),
      "utf8"
    );
    const store = new AtomicJsonStore(filePath, {
      maxBytes: 64
    });

    await expect(store.read()).rejects.toMatchObject({
      code: "INVALID_PERSISTED_DATA",
      message:
        "The persisted JSON document exceeds the supported limit of 64 bytes."
    });
    await expect(
      store.write({ value: "replacement" })
    ).rejects.toMatchObject({
      code: "PERSISTENCE_FAILED"
    });
    await expect(stat(filePath)).resolves.toMatchObject({
      size: expect.any(Number)
    });
  });

  it("skips an oversized pending write and recovers the newest valid bounded candidate", async () => {
    const { directory, filePath } = await createStorePath(
      "bounded-recovery"
    );
    const fileName = "document.json";
    const validPending = join(
      directory,
      `.${fileName}.100.valid.tmp`
    );
    const oversizedPending = join(
      directory,
      `.${fileName}.200.oversized.tmp`
    );
    await writeFile(
      validPending,
      JSON.stringify({ recovered: true }),
      "utf8"
    );
    await writeFile(
      oversizedPending,
      JSON.stringify({ value: "x".repeat(256) }),
      "utf8"
    );
    const now = new Date();
    await utimes(
      validPending,
      new Date(now.getTime() - 1_000),
      new Date(now.getTime() - 1_000)
    );
    await utimes(oversizedPending, now, now);

    const store = new AtomicJsonStore(filePath, {
      maxBytes: 64
    });

    await expect(store.read()).resolves.toEqual({
      recovered: true
    });
    await expect(
      readFile(filePath, "utf8")
    ).resolves.toBe(JSON.stringify({ recovered: true }));
    await expect(
      stat(oversizedPending)
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves oversized pending writes when no bounded recovery candidate exists", async () => {
    const { directory, filePath } = await createStorePath(
      "oversized-recovery"
    );
    const pendingPath = join(
      directory,
      ".document.json.100.oversized.tmp"
    );
    await writeFile(
      pendingPath,
      JSON.stringify({ value: "x".repeat(256) }),
      "utf8"
    );
    const store = new AtomicJsonStore(filePath, {
      maxBytes: 64
    });

    await expect(store.read()).rejects.toMatchObject({
      code: "INVALID_PERSISTED_DATA",
      message:
        "Interrupted JSON writes were found, but none contains valid JSON within the supported size limit."
    });
    await expect(stat(pendingPath)).resolves.toMatchObject({
      size: expect.any(Number)
    });
  });

  it("refuses oversized writes without replacing the last valid document", async () => {
    const { filePath } = await createStorePath(
      "oversized-write"
    );
    const store = new AtomicJsonStore(filePath, {
      maxBytes: 128
    });
    await store.write({ value: "ok" });
    const original = await readFile(filePath, "utf8");

    await expect(
      store.write({ value: "x".repeat(256) })
    ).rejects.toMatchObject({
      code: "PERSISTENCE_FAILED",
      message:
        "Refusing to save a JSON document larger than 128 bytes."
    });
    await expect(readFile(filePath, "utf8")).resolves.toBe(
      original
    );
    await expect(store.read()).resolves.toEqual({
      value: "ok"
    });
  });

  it("persists concurrent writes in invocation order", async () => {
    const { filePath } = await createStorePath(
      "concurrent-write-order"
    );
    const store = new AtomicJsonStore(filePath, {
      maxBytes: 16 * 1_024 * 1_024
    });

    const olderWrite = store.write({
      revision: 1,
      padding: "x".repeat(8 * 1_024 * 1_024)
    });
    const newerValue = {
      revision: 2
    };
    const newerWrite = store.write(newerValue);
    newerValue.revision = 3;

    await Promise.all([olderWrite, newerWrite]);

    await expect(store.read()).resolves.toEqual({
      revision: 2
    });
  });

  it("continues the write queue after a filesystem failure", async () => {
    const { directory, filePath } = await createStorePath(
      "write-failure-recovery"
    );
    const store = new AtomicJsonStore(filePath);
    await expect(store.read()).resolves.toBeNull();

    await rm(directory, { recursive: true, force: true });
    await writeFile(directory, "blocks directory creation", "utf8");
    await expect(
      store.write({ revision: 1 })
    ).rejects.toMatchObject({
      code: "PERSISTENCE_FAILED"
    });

    await rm(directory, { force: true });
    await mkdir(directory, { recursive: true });
    await expect(
      store.write({ revision: 2 })
    ).resolves.toBeUndefined();
    await expect(store.read()).resolves.toEqual({
      revision: 2
    });
  });

  it("retries recovery after a transient inspection failure", async () => {
    const { directory } = await createStorePath(
      "recovery-retry"
    );
    const documentDirectory = join(directory, "documents");
    const filePath = join(
      documentDirectory,
      "document.json"
    );
    await writeFile(
      documentDirectory,
      "temporarily blocks directory access",
      "utf8"
    );
    const store = new AtomicJsonStore(filePath);

    await expect(store.read()).rejects.toMatchObject({
      code: "PERSISTENCE_FAILED"
    });

    await rm(documentDirectory, { force: true });
    await mkdir(documentDirectory);
    await expect(
      store.write({ revision: 1 })
    ).resolves.toBeUndefined();
    await expect(store.read()).resolves.toEqual({
      revision: 1
    });
  });

  async function createStorePath(
    name: string
  ): Promise<{
    directory: string;
    filePath: string;
  }> {
    const directory = await mkdtemp(
      join(tmpdir(), `gitnest-${name}-`)
    );
    temporaryPaths.push(directory);
    return {
      directory,
      filePath: join(directory, "document.json")
    };
  }
});
