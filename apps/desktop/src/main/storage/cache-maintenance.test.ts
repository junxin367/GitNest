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
import { basename, join } from "node:path";

import { codeAnalysisWorkspaceCacheDirectory } from "@gitnest/code-analysis";
import { afterEach, describe, expect, it } from "vitest";

import { runCodeAnalysisCacheMaintenance } from "./cache-maintenance";
import { createDataRegistry } from "./data-registry";

describe("runCodeAnalysisCacheMaintenance", () => {
  const temporaryPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryPaths.map((path) =>
        rm(path, { recursive: true, force: true })
      )
    );
  });

  it("removes expired inactive Workspaces and preserves the active Workspace", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "gitnest-cache-maintenance-")
    );
    temporaryPaths.push(root);
    const registry = createDataRegistry(root);
    const activePath = codeAnalysisWorkspaceCacheDirectory(
      registry.paths.codeAnalysisIndex,
      "default"
    );
    const stalePath = codeAnalysisWorkspaceCacheDirectory(
      registry.paths.codeAnalysisIndex,
      "stale-workspace"
    );
    await writeCacheFile(activePath, "active");
    await writeCacheFile(stalePath, "stale");
    const oldDate = new Date("2026-07-01T00:00:00.000Z");
    await utimes(join(stalePath, "index.json"), oldDate, oldDate);
    await utimes(stalePath, oldDate, oldDate);

    const result = await runCodeAnalysisCacheMaintenance({
      registry,
      workspaceId: "default",
      now: Date.parse("2026-09-19T00:00:00.000Z")
    });

    await expect(
      readFile(join(activePath, "index.json"), "utf8")
    ).resolves.toBe("active");
    await expect(stat(stalePath)).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect(result.removedEntries).toBe(1);
  });

  it("ignores unknown and symlink-like names outside the cache key format", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "gitnest-cache-maintenance-")
    );
    temporaryPaths.push(root);
    const registry = createDataRegistry(root);
    const unknown = join(
      registry.paths.codeAnalysisIndex,
      "manual-backup"
    );
    await mkdir(unknown, { recursive: true });
    await writeFile(join(unknown, "keep.txt"), "keep", "utf8");

    const result = await runCodeAnalysisCacheMaintenance({
      registry,
      workspaceId: "default",
      now: Date.parse("2026-09-19T00:00:00.000Z")
    });

    await expect(
      readFile(join(unknown, "keep.txt"), "utf8")
    ).resolves.toBe("keep");
    expect(result.skippedEntries).toBeGreaterThanOrEqual(1);
  });

  it("removes stale temporary files without removing the entry", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "gitnest-cache-maintenance-")
    );
    temporaryPaths.push(root);
    const registry = createDataRegistry(root);
    const entryPath = codeAnalysisWorkspaceCacheDirectory(
      registry.paths.codeAnalysisIndex,
      "default"
    );
    await writeCacheFile(entryPath, "active");
    const temporaryPath = join(
      entryPath,
      "index.json.1.tmp"
    );
    await writeFile(temporaryPath, "temporary", "utf8");
    const oldDate = new Date("2026-09-01T00:00:00.000Z");
    await utimes(temporaryPath, oldDate, oldDate);

    const result = await runCodeAnalysisCacheMaintenance({
      registry,
      workspaceId: "default",
      now: Date.parse("2026-09-19T00:00:00.000Z")
    });

    await expect(stat(temporaryPath)).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(
      readFile(join(entryPath, "index.json"), "utf8")
    ).resolves.toBe("active");
    expect(result.removedTemporaryFiles).toBe(1);
    expect(
      basename(entryPath)
    ).toMatch(/^[a-f0-9]{24}$/);
  });

  it("reports when protected entries alone exceed the configured quota", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "gitnest-cache-maintenance-")
    );
    temporaryPaths.push(root);
    const registry = createDataRegistry(root);
    const activePath = codeAnalysisWorkspaceCacheDirectory(
      registry.paths.codeAnalysisIndex,
      "default"
    );
    await writeCacheFile(activePath, "larger-than-test-quota");
    const descriptors = registry.descriptors.map((descriptor) =>
      descriptor.id === "code-analysis-index" &&
      descriptor.retention.policy === "bounded"
        ? {
            ...descriptor,
            retention: {
              ...descriptor.retention,
              maxBytes: 1
            }
          }
        : descriptor
    );

    const result = await runCodeAnalysisCacheMaintenance({
      registry: { ...registry, descriptors },
      workspaceId: "default"
    });

    await expect(
      readFile(join(activePath, "index.json"), "utf8")
    ).resolves.toBe("larger-than-test-quota");
    expect(result.warnings).toContainEqual(
      expect.stringContaining(
        "protected cache entries retain"
      )
    );
  });

  async function writeCacheFile(
    entryPath: string,
    contents: string
  ): Promise<void> {
    await mkdir(entryPath, { recursive: true });
    await writeFile(
      join(entryPath, "index.json"),
      contents,
      "utf8"
    );
  }
});
