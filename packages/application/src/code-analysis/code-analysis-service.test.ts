import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AnalysisSnapshotCache,
  type CodeAnalysisInput,
  type CodeAnalysisSettings,
  type CodeAnalysisSnapshot,
  type CodeAnalysisSnapshotStore
} from "@gitnest/code-analysis";
import type { GitClient } from "@gitnest/git-core";
import type { Workspace } from "@gitnest/workspace-core";

import {
  CodeAnalysisService,
  type CodeAnalysisState
} from "./code-analysis-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
  );
});

describe("CodeAnalysisService snapshot persistence", () => {
  it("restores a compatible snapshot before the renderer reads state", async () => {
    const workspace = createWorkspace();
    const snapshot = createSnapshot("persisted");
    const store = createSnapshotStore(snapshot);
    const engine = createEngine();
    const service = createService(
      workspace,
      store,
      engine
    );

    const state = await service.getState();

    expect(state).toMatchObject({
      state: "ready",
      snapshotAvailable: true,
      analysisId: "persisted",
      generatedAt: snapshot.generatedAt
    });
    await expect(service.getSnapshot()).resolves.toEqual(
      snapshot
    );
    expect(engine.analyze).not.toHaveBeenCalled();
    await service.dispose();
  });

  it("restores a completed analysis after the service is recreated", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "gitnest-analysis-restart-")
    );
    temporaryDirectories.push(directory);
    const workspace = createWorkspace();
    const firstEngine = createEngine();
    const firstService = createService(
      workspace,
      new AnalysisSnapshotCache(directory),
      firstEngine
    );
    const ready = waitForState(
      firstService,
      (state) => state.state === "ready"
    );

    await firstService.start("workspace");
    await ready;
    await firstService.dispose();

    const restoredEngine = createEngine();
    const restoredService = createService(
      workspace,
      new AnalysisSnapshotCache(directory),
      restoredEngine
    );

    await expect(restoredService.getState()).resolves.toMatchObject({
      state: "ready",
      snapshotAvailable: true,
      analysisId: "fresh"
    });
    await expect(
      restoredService.getSnapshot()
    ).resolves.toMatchObject({
      analysisId: "fresh",
      scope: "workspace"
    });
    expect(restoredEngine.analyze).not.toHaveBeenCalled();
    await restoredService.dispose();
  });

  it("persists a completed analysis and keeps it available when saving fails", async () => {
    const workspace = createWorkspace();
    const snapshot = createSnapshot("fresh");
    const store = createSnapshotStore(null);
    store.save.mockRejectedValueOnce(
      new Error("disk unavailable")
    );
    const engine = createEngine(async () => snapshot);
    const service = createService(
      workspace,
      store,
      engine
    );
    const ready = waitForState(
      service,
      (state) => state.state === "ready"
    );

    await service.start("workspace");
    await ready;

    expect(store.save).toHaveBeenCalledWith(
      snapshot,
      createSettings()
    );
    const current = await service.getSnapshot();
    expect(current?.analysisId).toBe("fresh");
    expect(current?.warnings).toContain(
      "无法保存完整分析快照：disk unavailable"
    );
    expect((await service.getState()).state).toBe("ready");
    await service.dispose();
  });

  it("does not let a late restore from the previous entry replace the current entry", async () => {
    let workspace = createWorkspace("entry-a", "worktree-a");
    const pending = deferred<CodeAnalysisSnapshot | null>();
    const store: TestSnapshotStore = {
      load: vi.fn(
        async (_workspaceId, entryId) =>
          entryId === "entry-a"
            ? pending.promise
            : createSnapshot(
                "entry-b-cache",
                "entry-b",
                "worktree-b"
              )
      ),
      save: vi.fn(async () => undefined)
    };
    const engine = createEngine();
    const service = new CodeAnalysisService(
      {
        getCurrent: async () => structuredClone(workspace)
      },
      createGitClient(),
      {
        cacheDirectory: "C:\\cache",
        lspDataDirectory: "C:\\lsp",
        settingsProvider: async () => createSettings(),
        snapshotStore: store,
        runner: engine
      }
    );

    const firstLoad = service.getState();
    workspace = createWorkspace("entry-b", "worktree-b");
    service.handleWorkspaceChanged(workspace);
    const currentState = await service.getState();
    pending.resolve(
      createSnapshot(
        "entry-a-cache",
        "entry-a",
        "worktree-a"
      )
    );
    await firstLoad;

    expect(currentState).toMatchObject({
      state: "ready",
      analysisId: "entry-b-cache",
      entryId: "entry-b"
    });
    await expect(service.getSnapshot()).resolves.toMatchObject({
      analysisId: "entry-b-cache",
      entryId: "entry-b"
    });
    await service.dispose();
  });
});

describe("CodeAnalysisService node source", () => {
  it("reads the analyzed file and returns the lines around the node", async () => {
    const rootPath = await createTemporaryWorktree();
    const sourcePath = join(rootPath, "src", "service.ts");
    await mkdir(join(rootPath, "src"), { recursive: true });
    const lines = Array.from(
      { length: 800 },
      (_, index) => `export const line${index + 1} = ${index + 1};`
    );
    await writeFile(sourcePath, lines.join("\r\n"), "utf8");
    const workspace = createWorkspaceAt(rootPath);
    const snapshot = createSnapshotWithNode(rootPath, {
      path: "src/service.ts",
      line: 700,
      endLine: 705
    });
    const service = createService(
      workspace,
      createSnapshotStore(snapshot),
      createEngine()
    );

    const file = await service.readFile("function_source");

    expect(file).toMatchObject({
      nodeId: "function_source",
      path: "src/service.ts",
      language: "typescript",
      totalLines: 800,
      truncated: true
    });
    expect(file.startLine).toBeLessThanOrEqual(700);
    expect(file.endLine).toBeGreaterThanOrEqual(705);
    expect(file.endLine - file.startLine + 1).toBe(600);
    expect(file.content).toContain(
      "export const line700 = 700;"
    );
    expect(file.content).not.toContain("\r");
    await service.dispose();
  });

  it("rejects a snapshot path that resolves outside the analyzed Worktree", async () => {
    const parentPath = await createTemporaryWorktree();
    const rootPath = join(parentPath, "repository");
    await mkdir(rootPath, { recursive: true });
    await writeFile(
      join(parentPath, "outside.ts"),
      "export const secret = true;",
      "utf8"
    );
    const workspace = createWorkspaceAt(rootPath);
    const snapshot = createSnapshotWithNode(rootPath, {
      path: "../outside.ts",
      line: 1,
      endLine: 1
    });
    const service = createService(
      workspace,
      createSnapshotStore(snapshot),
      createEngine()
    );

    await expect(
      service.readFile("function_source")
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    await service.dispose();
  });
});

describe("CodeAnalysisService lifecycle", () => {
  it("rejects a new analysis after disposal", async () => {
    const service = createService(
      createWorkspace(),
      createSnapshotStore(null),
      createEngine()
    );

    await service.dispose();

    await expect(service.start("workspace")).rejects.toThrow(
      "disposed"
    );
  });

  it("does not accept an analysis that was preparing while disposal completed", async () => {
    const settings = deferred<CodeAnalysisSettings>();
    const engine = createEngine();
    const service = new CodeAnalysisService(
      {
        getCurrent: async () =>
          structuredClone(createWorkspace())
      },
      createGitClient(),
      {
        cacheDirectory: "C:\\cache",
        lspDataDirectory: "C:\\lsp",
        settingsProvider: () => settings.promise,
        snapshotStore: createSnapshotStore(null),
        runner: engine
      }
    );

    const start = service.start("workspace");
    await Promise.resolve();
    await service.dispose();
    settings.resolve(createSettings());

    await expect(start).rejects.toThrow("disposed");
    expect(engine.analyze).not.toHaveBeenCalled();
  });
});

type TestSnapshotStore = CodeAnalysisSnapshotStore & {
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
};

function createService(
  workspace: Workspace,
  snapshotStore: CodeAnalysisSnapshotStore,
  engine: ReturnType<typeof createEngine>
): CodeAnalysisService {
  return new CodeAnalysisService(
    {
      getCurrent: async () => structuredClone(workspace)
    },
    createGitClient(),
    {
      cacheDirectory: "C:\\cache",
      lspDataDirectory: "C:\\lsp",
      settingsProvider: async () => createSettings(),
      snapshotStore,
      runner: engine,
      idFactory: () => "fresh"
    }
  );
}

function createSnapshotStore(
  snapshot: CodeAnalysisSnapshot | null
): TestSnapshotStore {
  return {
    load: vi.fn(async () =>
      snapshot ? structuredClone(snapshot) : null
    ),
    save: vi.fn(async () => undefined)
  };
}

function createEngine(
  analyze: (
    input: CodeAnalysisInput
  ) => Promise<CodeAnalysisSnapshot> = async (input) =>
    createSnapshot(
      input.analysisId,
      input.entryId,
      input.roots[0]?.worktreeId ?? "worktree"
    )
) {
  return {
    analyze: vi.fn(analyze),
    dispose: vi.fn(async () => undefined)
  };
}

function createGitClient(): Pick<
  GitClient,
  "readRepositorySnapshot"
> {
  return {
    readRepositorySnapshot: vi.fn(async () => ({
      branch: "main",
      head: "0123456789abcdef",
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
      changes: [],
      refreshedAt: "2026-09-17T08:42:00.000Z"
    }))
  };
}

function createWorkspace(
  entryId = "entry",
  worktreeId = "worktree"
): Workspace {
  const target = {
    repositoryId: "repository",
    worktreeId
  };
  return {
    schemaVersion: 1,
    id: "workspace",
    name: "Workspace",
    entries: [
      {
        id: entryId,
        displayName: `Entry ${entryId}`,
        path: `C:\\workspace\\${entryId}`,
        canonicalPath: `c:\\workspace\\${entryId}`,
        excludes: [],
        order: 0,
        kind: "workspace-directory",
        groups: [
          {
            id: "group",
            name: "Repositories",
            targets: [target],
            collapsed: false
          }
        ],
        scanIssues: [],
        lastScannedAt: "2026-09-17T08:42:00.000Z"
      }
    ],
    repositories: [
      {
        id: target.repositoryId,
        name: "Repository",
        commonDir: "C:\\workspace\\.git",
        canonicalCommonDir: "c:\\workspace\\.git",
        primaryWorktreeId: worktreeId,
        worktreeIds: [worktreeId]
      }
    ],
    worktrees: [
      {
        id: worktreeId,
        repositoryId: target.repositoryId,
        name: "Repository",
        path: `C:\\workspace\\${worktreeId}`,
        canonicalPath: `c:\\workspace\\${worktreeId}`,
        gitDir: `C:\\workspace\\${worktreeId}\\.git`,
        head: "0123456789abcdef",
        branch: "main",
        isPrimary: true,
        isBare: false,
        isDetached: false,
        isLocked: false,
        isPrunable: false
      }
    ],
    selectedEntryId: entryId,
    selectedTarget: target,
    updatedAt: "2026-09-17T08:42:00.000Z"
  };
}

function createWorkspaceAt(rootPath: string): Workspace {
  const workspace = createWorkspace();
  const entry = workspace.entries[0];
  const repository = workspace.repositories[0];
  const worktree = workspace.worktrees[0];
  if (!entry || !repository || !worktree) {
    throw new Error("Workspace fixture is incomplete.");
  }
  entry.path = rootPath;
  entry.canonicalPath = rootPath;
  repository.commonDir = join(rootPath, ".git");
  repository.canonicalCommonDir = join(rootPath, ".git");
  worktree.path = rootPath;
  worktree.canonicalPath = rootPath;
  worktree.gitDir = join(rootPath, ".git");
  return workspace;
}

function createSnapshot(
  analysisId: string,
  entryId = "entry",
  worktreeId = "worktree"
): CodeAnalysisSnapshot {
  return {
    schemaVersion: 1,
    analysisId,
    workspaceId: "workspace",
    entryId,
    entryName: `Entry ${entryId}`,
    scope: "workspace",
    generatedAt: "2026-09-17T08:42:00.000Z",
    roots: [
      {
        repositoryId: "repository",
        worktreeId,
        name: "Repository",
        path: `C:\\workspace\\${worktreeId}`
      }
    ],
    nodes: [],
    edges: [],
    requestChains: [],
    languageServers: [],
    warnings: [],
    stats: {
      discoveredFiles: 0,
      analyzedFiles: 0,
      cachedFiles: 0,
      skippedFiles: 0,
      symbolCount: 0,
      edgeCount: 0,
      requestChainCount: 0,
      truncated: false,
      durationMs: 20
    }
  };
}

function createSnapshotWithNode(
  rootPath: string,
  location: {
    path: string;
    line: number;
    endLine: number;
  }
): CodeAnalysisSnapshot {
  const snapshot = createSnapshot("persisted");
  const root = snapshot.roots[0];
  if (!root) {
    throw new Error("Snapshot fixture is incomplete.");
  }
  root.path = rootPath;
  snapshot.nodes = [
    {
      id: "function_source",
      kind: "function",
      name: "source",
      qualifiedName: "source",
      language: "typescript",
      location: {
        repositoryId: root.repositoryId,
        worktreeId: root.worktreeId,
        path: location.path,
        line: location.line,
        column: 1
      },
      changed: false,
      source: "builtin",
      confidence: "exact",
      metadata: {
        endLine: location.endLine
      }
    }
  ];
  return snapshot;
}

async function createTemporaryWorktree(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "gitnest-code-analysis-")
  );
  temporaryDirectories.push(directory);
  return directory;
}

function createSettings(): CodeAnalysisSettings {
  return {
    enabled: true,
    staticFallback: true,
    maxFiles: 5_000,
    maxFileSizeBytes: 768 * 1_024,
    readConcurrency: 2,
    graphDepth: 6,
    lspTimeoutMs: 8_000,
    ignoreDirectories: [".git", "node_modules"],
    typescript: {
      enabled: false,
      command: "typescript-language-server",
      args: ["--stdio"]
    },
    java: {
      enabled: false,
      command: "jdtls",
      args: []
    }
  };
}

function waitForState(
  service: CodeAnalysisService,
  predicate: (state: CodeAnalysisState) => boolean
): Promise<CodeAnalysisState> {
  let unsubscribe: (() => void) | undefined;
  return new Promise((resolve) => {
    unsubscribe = service.subscribe((state) => {
      if (!predicate(state)) {
        return;
      }
      resolve(state);
      queueMicrotask(() => unsubscribe?.());
    });
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
