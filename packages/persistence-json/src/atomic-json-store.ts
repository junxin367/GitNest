import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { WorkspaceError } from "@gitnest/workspace-core";

export class AtomicJsonStore {
  readonly #filePath: string;
  #recovery: Promise<void> | undefined;
  #writeBlockedReason: string | undefined;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async read(): Promise<unknown | null> {
    await this.#ensureRecovered();
    let contents: string;

    try {
      contents = await readFile(this.#filePath, "utf8");
    } catch (error) {
      if (getErrorCode(error) === "ENOENT") {
        return null;
      }

      throw new WorkspaceError(
        "PERSISTENCE_FAILED",
        "Unable to read the persisted Workspace.",
        { cause: getErrorMessage(error) }
      );
    }

    try {
      return JSON.parse(contents) as unknown;
    } catch (error) {
      this.blockWrites(
        "The persisted JSON document is malformed."
      );
      throw new WorkspaceError(
        "INVALID_PERSISTED_DATA",
        "The persisted JSON document is malformed.",
        { cause: getErrorMessage(error) }
      );
    }
  }

  async write(value: unknown): Promise<void> {
    await this.#ensureRecovered();
    if (this.#writeBlockedReason) {
      throw new WorkspaceError(
        "PERSISTENCE_FAILED",
        "Refusing to overwrite persisted data after a recovery or migration failure.",
        { cause: this.#writeBlockedReason }
      );
    }
    const directory = dirname(this.#filePath);
    const temporaryPath = join(
      directory,
      `.${basename(this.#filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;

    try {
      await mkdir(directory, { recursive: true });
      handle = await open(temporaryPath, "wx");
      await handle.writeFile(
        `${JSON.stringify(value, null, 2)}\n`,
        "utf8"
      );
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.#filePath);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);

      if (error instanceof WorkspaceError) {
        throw error;
      }

      throw new WorkspaceError(
        "PERSISTENCE_FAILED",
        "Unable to save the JSON document atomically.",
        { cause: getErrorMessage(error) }
      );
    }
  }

  blockWrites(reason: string): void {
    this.#writeBlockedReason =
      reason || "Persisted data validation failed.";
  }

  async #ensureRecovered(): Promise<void> {
    if (!this.#recovery) {
      this.#recovery = this.#recoverInterruptedWrites();
    }
    await this.#recovery;
  }

  async #recoverInterruptedWrites(): Promise<void> {
    const directory = dirname(this.#filePath);
    const fileName = basename(this.#filePath);
    const prefix = `.${fileName}.`;
    let entries;

    try {
      entries = await readdir(directory, {
        withFileTypes: true
      });
    } catch (error) {
      if (getErrorCode(error) === "ENOENT") {
        return;
      }
      throw new WorkspaceError(
        "PERSISTENCE_FAILED",
        "Unable to inspect pending JSON writes.",
        { cause: getErrorMessage(error) }
      );
    }

    const pendingPaths = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.startsWith(prefix) &&
          entry.name.endsWith(".tmp")
      )
      .map((entry) => join(directory, entry.name));
    if (pendingPaths.length === 0) {
      return;
    }

    const finalState = await inspectJsonFile(
      this.#filePath
    );
    if (finalState === "valid") {
      await removePendingFiles(pendingPaths);
      return;
    }
    if (finalState === "invalid") {
      this.blockWrites(
        "The primary persisted JSON document is malformed; pending writes were preserved."
      );
      return;
    }

    const candidates = await Promise.all(
      pendingPaths.map(async (path) => ({
        path,
        modifiedAt: await stat(path)
          .then((info) => info.mtimeMs)
          .catch(() => 0)
      }))
    );
    candidates.sort(
      (left, right) =>
        right.modifiedAt - left.modifiedAt
    );
    let recoveredPath: string | undefined;
    for (const candidate of candidates) {
      if (
        (await inspectJsonFile(candidate.path)) ===
        "valid"
      ) {
        recoveredPath = candidate.path;
        break;
      }
    }

    if (!recoveredPath) {
      this.blockWrites(
        "Only malformed pending JSON writes were found."
      );
      throw new WorkspaceError(
        "INVALID_PERSISTED_DATA",
        "Interrupted JSON writes were found, but none contains valid JSON."
      );
    }

    try {
      await rename(recoveredPath, this.#filePath);
      await removePendingFiles(
        pendingPaths.filter(
          (path) => path !== recoveredPath
        )
      );
    } catch (error) {
      throw new WorkspaceError(
        "PERSISTENCE_FAILED",
        "Unable to recover an interrupted JSON write.",
        { cause: getErrorMessage(error) }
      );
    }
  }
}

type JsonFileState = "missing" | "valid" | "invalid";

async function inspectJsonFile(
  path: string
): Promise<JsonFileState> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return "missing";
    }
    throw error;
  }
  try {
    JSON.parse(contents);
    return "valid";
  } catch {
    return "invalid";
  }
}

async function removePendingFiles(
  paths: readonly string[]
): Promise<void> {
  await Promise.all(
    paths.map((path) => unlink(path).catch(() => undefined))
  );
}

function getErrorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown persistence error.";
}
