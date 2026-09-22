import {
  mkdtemp,
  readdir,
  rm,
  truncate,
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

import {
  AnalysisSnapshotCache,
  assertCodeAnalysisSnapshotPayloadSize,
  codeAnalysisSnapshotConfigurationKey,
  MAX_ANALYSIS_SNAPSHOT_PAYLOAD_BYTES,
  type AnalysisRoot,
  type CodeAnalysisSettings,
  type CodeAnalysisSnapshot
} from "./index";
import { MAX_ANALYSIS_SNAPSHOT_BYTES } from "./analysis-cache";

describe("AnalysisSnapshotCache", () => {
  const temporaryPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryPaths.splice(0).map((path) =>
        rm(path, { recursive: true, force: true })
      )
    );
  });

  it("persists the latest complete snapshot across cache instances", async () => {
    const directory = await createTemporaryDirectory();
    const first = new AnalysisSnapshotCache(directory);
    const original = createSnapshot("analysis-1");

    await first.save(original, createSettings());
    await first.save(
      createSnapshot("analysis-2"),
      createSettings()
    );

    const restored = await new AnalysisSnapshotCache(
      directory
    ).load(
      original.workspaceId,
      original.entryId,
      createSettings(),
      original.roots
    );

    expect(restored).toEqual(createSnapshot("analysis-2"));
    expect(restored).not.toBe(original);
  });

  it("restores a legacy snapshot and migrates it into the primary directory", async () => {
    const primaryDirectory =
      await createTemporaryDirectory();
    const legacyDirectory =
      await createTemporaryDirectory();
    const snapshot = createSnapshot("legacy-analysis");
    await new AnalysisSnapshotCache(
      legacyDirectory
    ).save(snapshot, createSettings());

    const restored = await new AnalysisSnapshotCache(
      primaryDirectory,
      {
        fallbackDirectories: [legacyDirectory]
      }
    ).load(
      snapshot.workspaceId,
      snapshot.entryId,
      createSettings(),
      snapshot.roots
    );

    expect(restored).toEqual(snapshot);
    await expect(
      new AnalysisSnapshotCache(primaryDirectory).load(
        snapshot.workspaceId,
        snapshot.entryId,
        createSettings(),
        snapshot.roots
      )
    ).resolves.toEqual(snapshot);
  });

  it("treats changed analysis settings or roots as a cache miss", async () => {
    const directory = await createTemporaryDirectory();
    const store = new AnalysisSnapshotCache(directory);
    const snapshot = createSnapshot("analysis");
    await store.save(snapshot, createSettings());

    expect(
      await store.load(
        snapshot.workspaceId,
        snapshot.entryId,
        {
          ...createSettings(),
          graphDepth: 9
        },
        snapshot.roots
      )
    ).toBeNull();
    expect(
      await store.load(
        snapshot.workspaceId,
        snapshot.entryId,
        {
          ...createSettings(),
          maxGraphEdges: 80_000
        },
        snapshot.roots
      )
    ).toBeNull();
    expect(
      await store.load(
        snapshot.workspaceId,
        snapshot.entryId,
        {
          ...createSettings(),
          java: {
            ...createSettings().java,
            maxReferenceRequests: 2_000
          }
        },
        snapshot.roots
      )
    ).toBeNull();
    expect(
      await store.load(
        snapshot.workspaceId,
        snapshot.entryId,
        {
          ...createSettings(),
          maxGraphNodes: 40_000
        },
        snapshot.roots
      )
    ).toBeNull();
    expect(
      await store.load(
        snapshot.workspaceId,
        snapshot.entryId,
        createSettings(),
        [
          {
            ...snapshot.roots[0]!,
            revision: "head-two"
          }
        ]
      )
    ).toBeNull();
    expect(
      await store.load(
        snapshot.workspaceId,
        snapshot.entryId,
        createSettings(),
        [
          {
            ...snapshot.roots[0]!,
            path: "C:\\workspace\\other"
          }
        ]
      )
    ).toBeNull();
  });

  it("includes every configurable analysis budget in the snapshot key", () => {
    const settings = createSettings();
    const roots = createSnapshot("analysis").roots;
    const baseline = codeAnalysisSnapshotConfigurationKey(
      settings,
      roots
    );
    const variants: CodeAnalysisSettings[] = [
      { ...settings, maxTotalSourceBytes: 256 * 1_024 * 1_024 },
      { ...settings, maxGraphEdges: 80_000 },
      { ...settings, maxRequestChains: 8_000 },
      { ...settings, maxDiagnostics: 4_000 },
      {
        ...settings,
        java: { ...settings.java, maxDocuments: 160 }
      },
      {
        ...settings,
        java: {
          ...settings.java,
          maxSymbolsPerDocument: 10_000
        }
      },
      {
        ...settings,
        java: {
          ...settings.java,
          maxCallHierarchyRequests: 80
        }
      },
      {
        ...settings,
        java: {
          ...settings.java,
          maxTypeHierarchyRequests: 160
        }
      },
      {
        ...settings,
        java: {
          ...settings.java,
          maxReferenceRequests: 2_000
        }
      },
      {
        ...settings,
        java: {
          ...settings.java,
          maxDocumentationRequests: 80
        }
      },
      {
        ...settings,
        java: {
          ...settings.java,
          maxReferencesPerSymbol: 1_000
        }
      }
    ];

    expect(
      variants.map((variant) =>
        codeAnalysisSnapshotConfigurationKey(
          variant,
          roots
        )
      )
    ).not.toContain(baseline);
  });

  it("ignores malformed snapshot JSON", async () => {
    const directory = await createTemporaryDirectory();
    const store = new AnalysisSnapshotCache(directory);
    const snapshot = createSnapshot("analysis");
    await store.save(snapshot, createSettings());
    const [entryDirectory] = await readdir(directory);
    expect(entryDirectory).toBeDefined();
    await writeFile(
      join(
        directory,
        entryDirectory as string,
        "snapshot.json"
      ),
      "{ invalid",
      "utf8"
    );

    await expect(
      store.load(
        snapshot.workspaceId,
        snapshot.entryId,
        createSettings(),
        snapshot.roots
      )
    ).resolves.toBeNull();
  });

  it("does not read a snapshot above the safety limit", async () => {
    const directory = await createTemporaryDirectory();
    const store = new AnalysisSnapshotCache(directory);
    const snapshot = createSnapshot("oversized-analysis");
    await store.save(snapshot, createSettings());
    const [entryDirectory] = await readdir(directory);
    expect(entryDirectory).toBeDefined();
    await truncate(
      join(
        directory,
        entryDirectory as string,
        "snapshot.json"
      ),
      MAX_ANALYSIS_SNAPSHOT_BYTES + 1
    );

    await expect(
      store.load(
        snapshot.workspaceId,
        snapshot.entryId,
        createSettings(),
        snapshot.roots
      )
    ).resolves.toBeNull();
  });

  it("rejects a live snapshot above the IPC payload limit", () => {
    const snapshot = createSnapshot("oversized-payload");
    snapshot.warnings = [
      "x".repeat(MAX_ANALYSIS_SNAPSHOT_PAYLOAD_BYTES)
    ];

    expect(() =>
      assertCodeAnalysisSnapshotPayloadSize(snapshot)
    ).toThrow("snapshot payload");
  });

  async function createTemporaryDirectory(): Promise<string> {
    const path = await mkdtemp(
      join(tmpdir(), "gitnest-analysis-snapshot-")
    );
    temporaryPaths.push(path);
    return path;
  }
});

function createSettings(): CodeAnalysisSettings {
  return {
    enabled: true,
    staticFallback: true,
    maxFiles: 5_000,
    maxTotalSourceBytes: 128 * 1_024 * 1_024,
    maxGraphNodes: 30_000,
    maxGraphEdges: 100_000,
    maxRequestChains: 5_000,
    maxDiagnostics: 2_000,
    maxFileSizeBytes: 768 * 1_024,
    readConcurrency: 4,
    graphDepth: 8,
    lspTimeoutMs: 8_000,
    ignoreDirectories: [".git", "node_modules"],
    typescript: {
      enabled: true,
      command: "typescript-language-server",
      args: ["--stdio"],
      maxDocuments: 120,
      maxSymbolsPerDocument: 5_000,
      maxCallHierarchyRequests: 50,
      maxReferenceRequests: 50,
      maxDocumentationRequests: 50,
      maxReferencesPerSymbol: 500
    },
    java: {
      enabled: true,
      command: "jdtls",
      args: [],
      maxDocuments: 80,
      maxSymbolsPerDocument: 5_000,
      maxCallHierarchyRequests: 40,
      maxReferenceRequests: 1_000,
      maxDocumentationRequests: 40,
      maxReferencesPerSymbol: 500
    }
  };
}

function createSnapshot(
  analysisId: string
): CodeAnalysisSnapshot {
  const roots: AnalysisRoot[] = [
    {
      repositoryId: "repository",
      worktreeId: "worktree",
      name: "Repository",
      path: "C:\\workspace\\repository",
      revision: "head-one"
    }
  ];
  return {
    schemaVersion: 1,
    analysisId,
    workspaceId: "workspace",
    entryId: "entry",
    entryName: "Workspace",
    scope: "workspace",
    generatedAt: "2026-09-17T08:42:00.000Z",
    roots,
    nodes: [
      {
        id: "node",
        kind: "function",
        name: "load",
        qualifiedName: "load",
        language: "typescript",
        location: {
          repositoryId: "repository",
          worktreeId: "worktree",
          path: "src/load.ts",
          line: 1,
          column: 1
        },
        changed: false,
        source: "builtin",
        confidence: "probable",
        metadata: {}
      }
    ],
    edges: [],
    requestChains: [],
    languageServers: [
      {
        language: "typescript",
        state: "connected",
        command: "typescript-language-server",
        message: "Connected",
        symbolCount: 1
      }
    ],
    warnings: [],
    stats: {
      discoveredFiles: 1,
      analyzedFiles: 1,
      cachedFiles: 0,
      skippedFiles: 0,
      symbolCount: 1,
      edgeCount: 0,
      requestChainCount: 0,
      truncated: false,
      durationMs: 25
    }
  };
}
