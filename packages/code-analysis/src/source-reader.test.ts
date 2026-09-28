import { createHash } from "node:crypto";
import {
  mkdtemp,
  rm,
  stat,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AnalysisSourceFile } from "./model";
import { readBoundedSourceFile } from "./source-reader";

describe("readBoundedSourceFile", () => {
  const temporaryPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryPaths.splice(0).map((path) =>
        rm(path, { recursive: true, force: true })
      )
    );
  });

  it("reads the exact file version discovered by inventory", async () => {
    const file = await createSourceFile("export const value = 1;");

    await expect(
      readBoundedSourceFile(file, file.size)
    ).resolves.toBe("export const value = 1;");
  });

  it("rejects a file that grew beyond the read limit", async () => {
    const file = await createSourceFile("small");
    await writeFile(file.absolutePath, "now much larger", "utf8");

    await expect(
      readBoundedSourceFile(file, 8)
    ).rejects.toThrow("safety limit");
  });

  it("rejects a different file version with the same path", async () => {
    const file = await createSourceFile("first");
    await writeFile(
      file.absolutePath,
      "other-content",
      "utf8"
    );

    await expect(
      readBoundedSourceFile(file, 64)
    ).rejects.toThrow("changed after discovery");
  });

  it("rejects changed content even when size and modified time match", async () => {
    const file = await createSourceFile("first");
    const originalModifiedAt = new Date(file.modifiedAtMs);
    file.fingerprint = `sha256:${createHash("sha256")
      .update("first")
      .digest("hex")}`;
    await writeFile(file.absolutePath, "other", "utf8");
    await utimes(
      file.absolutePath,
      originalModifiedAt,
      originalModifiedAt
    );

    await expect(
      readBoundedSourceFile(file, file.size)
    ).rejects.toThrow("changed after discovery");
  });

  async function createSourceFile(
    content: string
  ): Promise<AnalysisSourceFile> {
    const directory = await mkdtemp(
      join(tmpdir(), "gitnest-source-reader-")
    );
    temporaryPaths.push(directory);
    const absolutePath = join(directory, "source.ts");
    await writeFile(absolutePath, content, "utf8");
    const details = await stat(absolutePath);
    return {
      absolutePath,
      canonicalPath: absolutePath,
      relativePath: "source.ts",
      repositoryId: "repository",
      worktreeId: "worktree",
      rootPath: directory,
      language: "typescript",
      size: details.size,
      modifiedAtMs: details.mtimeMs,
      fingerprint: `${details.size}:${Math.trunc(
        details.mtimeMs
      )}`,
      changed: false
    };
  }
});
