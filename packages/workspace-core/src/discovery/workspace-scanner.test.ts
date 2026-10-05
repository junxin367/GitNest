import { win32 } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  RepositoryProbe,
  RepositoryProbeResult
} from "../ports/repository-probe";
import type {
  NormalizedWorkspacePath,
  WorkspaceDirectoryEntry,
  WorkspaceFileSystem
} from "../ports/workspace-filesystem";
import { createPathIdentity } from "../services/path-identity";
import {
  DEFAULT_ROOT_REPOSITORY_GROUP_NAME,
  WorkspaceAssembler
} from "../services/workspace-assembler";
import { createEmptyWorkspace } from "../domain/workspace";
import {
  WorkspaceScanner,
  type DiscoveredRepository,
  type WorkspaceRootScan
} from "./workspace-scanner";

describe("WorkspaceScanner", () => {
  it("continues below a root repository, applies exclusions, stops below child repositories, and isolates local errors", async () => {
    const fileSystem = new FakeWindowsFileSystem();
    const scanner = new WorkspaceScanner(
      fileSystem,
      new FakeRepositoryProbe()
    );
    const normalizedRoot = fileSystem.normalizePath("C:\\root");
    const scan = await scanner.scanRoot({
      path: normalizedRoot.path,
      canonicalPath: normalizedRoot.canonicalPath,
      excludes: []
    });

    expect(
      scan.repositories.map((repository) => repository.path)
    ).toEqual(["C:\\root", "C:\\root\\core"]);
    expect(
      scan.repositories.some((repository) =>
        repository.path.includes("node_modules")
      )
    ).toBe(false);
    expect(
      scan.repositories.some((repository) =>
        repository.path.includes("nested")
      )
    ).toBe(false);
    expect(scan.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "C:\\root\\denied",
          code: "PERMISSION_DENIED"
        }),
        expect.objectContaining({
          path: "C:\\root\\linked-outside",
          code: "OUTSIDE_ROOT_LINK_SKIPPED"
        })
      ])
    );
  });

  it("applies path exclusions only to the matching nested directory", async () => {
    const fileSystem = new FakeWindowsFileSystem();
    const scanner = new WorkspaceScanner(
      fileSystem,
      new FakeRepositoryProbe()
    );
    const normalizedRoot = fileSystem.normalizePath(
      "C:\\exclude-root"
    );
    const scan = await scanner.scanRoot({
      path: normalizedRoot.path,
      canonicalPath: normalizedRoot.canonicalPath,
      excludes: ["svr/resource-server-demo"]
    });

    expect(
      scan.repositories.map((repository) => repository.path)
    ).toEqual([
      "C:\\exclude-root\\other\\resource-server-demo"
    ]);
  });

  it("treats a single-segment user exclusion as a root-relative path", async () => {
    const fileSystem = new FakeWindowsFileSystem();
    const scanner = new WorkspaceScanner(
      fileSystem,
      new FakeRepositoryProbe()
    );
    const normalizedRoot = fileSystem.normalizePath(
      "C:\\basename-exclude-root"
    );
    const scan = await scanner.scanRoot({
      path: normalizedRoot.path,
      canonicalPath: normalizedRoot.canonicalPath,
      excludes: ["api"]
    });

    expect(
      scan.repositories.map((repository) => repository.path)
    ).toEqual([
      "C:\\basename-exclude-root\\services\\api"
    ]);
  });

  it("rejects a scan cancelled while a directory read is in progress", async () => {
    const fileSystem = new BlockingReadWindowsFileSystem();
    const scanner = new WorkspaceScanner(
      fileSystem,
      new FakeRepositoryProbe()
    );
    const normalizedRoot = fileSystem.normalizePath(
      "C:\\cancelled-root"
    );
    const controller = new AbortController();
    const scan = scanner.scanRoot(
      {
        path: normalizedRoot.path,
        canonicalPath: normalizedRoot.canonicalPath,
        excludes: []
      },
      { signal: controller.signal }
    );

    await fileSystem.readStarted;
    controller.abort();
    fileSystem.releaseRead();

    await expect(scan).rejects.toMatchObject({
      code: "SCAN_CANCELLED"
    });
  });
});

describe("WorkspaceAssembler", () => {
  it.each([
    { excluded: "api", childFirst: false },
    { excluded: "api", childFirst: true },
    { excluded: " ./API\\nested// ", childFirst: false },
    { excluded: " ./API\\nested// ", childFirst: true }
  ])(
    "applies owning-root exclusion $excluded to broader-root discoveries (child first: $childFirst)",
    ({ excluded, childFirst }) => {
      const fileSystem = new FakeWindowsFileSystem();
      const parent = rootDefinition(fileSystem, "C:\\root");
      const child = {
        ...rootDefinition(fileSystem, "C:\\root\\services"),
        excludes: [excluded]
      };
      const hidden = "C:\\root\\services\\api\\nested";
      const visible = "C:\\root\\services\\api-two\\nested";
      const scannedAt = "2026-10-04T12:00:00.000Z";
      const parentScan: WorkspaceRootScan = {
        root: parent,
        repositories: [hidden, visible].map((path) =>
          discovery(fileSystem, parent.path, path, repository(path, win32.join(path, ".git")))
        ),
        issues: [],
        scannedAt
      };
      const childScan: WorkspaceRootScan = {
        root: child,
        repositories: [
          discovery(fileSystem, child.path, visible, repository(visible, win32.join(visible, ".git")))
        ],
        issues: [],
        scannedAt
      };
      const assembled = new WorkspaceAssembler(fileSystem).assemble({
        current: createEmptyWorkspace(scannedAt),
        scans: childFirst ? [childScan, parentScan] : [parentScan, childScan],
        updatedAt: scannedAt
      });
      expect(assembled.worktrees.map((entry) => entry.path)).toEqual([visible]);
      expect(assembled.groups.flatMap((group) => group.targets)).toHaveLength(1);
    }
  );

  it("does not restore excluded topology when an unrelated scan error triggers offline preservation", () => {
    const fileSystem = new FakeWindowsFileSystem();
    const assembler = new WorkspaceAssembler(fileSystem);
    const root = rootDefinition(fileSystem, "C:\\root");
    const path = "C:\\root\\api\\repository";
    const scannedAt = "2026-10-04T12:00:00.000Z";
    const current = assembler.assemble({
      current: createEmptyWorkspace(scannedAt),
      scan: {
        root,
        repositories: [
          discovery(fileSystem, root.path, path, repository(path, win32.join(path, ".git")))
        ],
        issues: [],
        scannedAt
      },
      updatedAt: scannedAt
    });
    expect(current.groups.flatMap((group) => group.targets)).toHaveLength(1);
    const excluded = assembler.assemble({
      current,
      scan: {
        root: { ...root, excludes: ["./API//"] },
        repositories: [],
        issues: [{
          path: "C:\\root\\denied",
          code: "PERMISSION_DENIED",
          message: "Access denied"
        }],
        scannedAt
      },
      updatedAt: scannedAt
    });
    expect(excluded.groups).toEqual([]);
    expect(excluded.repositories).toEqual([]);
    expect(excluded.worktrees).toEqual([]);
    expect(excluded.selectedTarget).toBeUndefined();
    expect(excluded.scanIssues).toHaveLength(1);
  });

  it.each([false, true])(
    "preserves fresh topology when a shared repository has an offline root (offline first: %s)",
    (offlineFirst) => {
      const fileSystem = new FakeWindowsFileSystem();
      const assembler = new WorkspaceAssembler(fileSystem);
      const onlineRoot = rootDefinition(fileSystem, "C:\\root");
      const offlineRoot = rootDefinition(fileSystem, "D:\\linked");
      const commonDir = "C:\\root\\.git";
      const oldWorktrees = [
        worktree(onlineRoot.path, true),
        worktree(offlineRoot.path, false),
        worktree("D:\\unavailable-sibling", false)
      ];
      const timestamp = "2026-10-04T10:00:00.000Z";
      const initialScans: WorkspaceRootScan[] = [
        onlineRoot,
        offlineRoot
      ].map((root) => ({
        root,
        repositories: [
          discovery(
            fileSystem,
            root.path,
            root.path,
            repository(root.path, commonDir, oldWorktrees)
          )
        ],
        issues: [],
        scannedAt: timestamp
      }));
      const current = assembler.assemble({
        current: createEmptyWorkspace(timestamp),
        scans: initialScans,
        updatedAt: timestamp
      });
      const freshPrimary = {
        ...worktree(onlineRoot.path, true),
        head: "def456",
        branch: "updated-main"
      };
      const onlineScan: WorkspaceRootScan = {
        ...initialScans[0]!,
        repositories: [
          discovery(
            fileSystem,
            onlineRoot.path,
            onlineRoot.path,
            repository(onlineRoot.path, commonDir, [
              freshPrimary,
              worktree(offlineRoot.path, false),
              worktree("E:\\new-linked", false)
            ])
          )
        ]
      };
      const offlineScan: WorkspaceRootScan = {
        ...initialScans[1]!,
        repositories: [],
        issues: [{
          path: offlineRoot.path,
          code: "DIRECTORY_UNAVAILABLE",
          message: "offline"
        }]
      };
      const assembled = assembler.assemble({
        current,
        scans: offlineFirst
          ? [offlineScan, onlineScan]
          : [onlineScan, offlineScan],
        updatedAt: timestamp
      });

      expect(assembled.repositories).toHaveLength(1);
      expect(assembled.worktrees).toHaveLength(4);
      expect(assembled.repositories[0]?.worktreeIds.toSorted()).toEqual(
        assembled.worktrees.map((entry) => entry.id).toSorted()
      );
      expect(
        assembled.worktrees.find((entry) => entry.path === onlineRoot.path)
      ).toMatchObject({
        head: "def456",
        branch: "updated-main"
      });
      expect(assembled.groups.flatMap((group) => group.targets)).toEqual(
        expect.arrayContaining(
          current.groups.flatMap((group) => group.targets)
        )
      );
      expect(current.worktrees).toHaveLength(3);
      expect(current.worktrees[0]?.head).toBe("abc123");
    }
  );

  it("assembles one Workspace root, groups repositories, and merges linked worktrees", () => {
    const fileSystem = new FakeWindowsFileSystem();
    const root = rootDefinition(fileSystem, "C:\\root");
    const scan: WorkspaceRootScan = {
      root,
      repositories: [
        discovery(
          fileSystem,
          root.path,
          "C:\\root",
          repository("C:\\root", "C:\\root\\.git", [
            worktree("C:\\root", true),
            worktree("D:\\linked root", false)
          ])
        ),
        discovery(
          fileSystem,
          root.path,
          "C:\\root\\core",
          repository(
            "C:\\root\\core",
            "C:\\root\\core\\.git"
          )
        ),
        discovery(
          fileSystem,
          root.path,
          "C:\\root\\svr\\resource-server-demo",
          repository(
            "C:\\root\\svr\\resource-server-demo",
            "C:\\root\\svr\\resource-server-demo\\.git"
          )
        )
      ],
      issues: [],
      scannedAt: "2026-09-04T10:00:00.000Z"
    };
    const assembled = new WorkspaceAssembler(fileSystem).assemble({
      current: createEmptyWorkspace(
        "2026-09-04T09:00:00.000Z"
      ),
      scan,
      updatedAt: "2026-09-04T10:00:00.000Z"
    });

    expect(assembled).toMatchObject({
      path: root.path,
      canonicalPath: root.canonicalPath,
      groups: [
        {
          name: DEFAULT_ROOT_REPOSITORY_GROUP_NAME,
          collapsed: false
        },
        {
          name: "svr",
          collapsed: false
        }
      ]
    });
    expect(assembled.groups[0]?.targets).toHaveLength(2);
    expect(assembled.groups[1]?.targets).toHaveLength(1);
    expect(assembled.repositories).toHaveLength(3);
    expect(assembled.worktrees).toHaveLength(4);

    const rootRepository = assembled.repositories.find(
      (candidate) =>
        candidate.id ===
        createPathIdentity(
          "repository",
          fileSystem.normalizePath("C:\\root\\.git").canonicalPath
        )
    );
    expect(rootRepository?.worktreeIds).toHaveLength(2);
  });

  it("keeps the primary worktree name when the same repository is also discovered through a linked worktree", () => {
    const fileSystem = new FakeWindowsFileSystem();
    const root = rootDefinition(fileSystem, "C:\\root");
    const scan: WorkspaceRootScan = {
      root,
      repositories: [
        discovery(
          fileSystem,
          root.path,
            "C:\\root",
            repository("C:\\root", "C:\\root\\.git", [
            worktree("C:\\root", true),
            worktree("C:\\root\\linked", false)
          ])
        ),
        discovery(
          fileSystem,
          root.path,
          "C:\\root\\linked",
          repository("C:\\root\\linked", "C:\\root\\.git", [
            worktree("C:\\root", true),
            worktree("C:\\root\\linked", false)
          ])
        )
      ],
      issues: [],
      scannedAt: "2026-09-04T10:00:00.000Z"
    };
    const assembled = new WorkspaceAssembler(fileSystem).assemble({
      current: createEmptyWorkspace("2026-09-04T09:00:00.000Z"),
      scan,
      updatedAt: "2026-09-04T10:00:00.000Z"
    });

    expect(assembled.repositories).toHaveLength(1);
    expect(assembled.repositories[0]?.name).toBe("root");
    expect(assembled.worktrees).toHaveLength(2);
  });
});

class FakeWindowsFileSystem implements WorkspaceFileSystem {
  normalizePath(path: string): NormalizedWorkspacePath {
    const normalized = win32.normalize(win32.resolve(path));
    return {
      path: normalized,
      canonicalPath: normalized.toLocaleLowerCase("en-US")
    };
  }

  basename(path: string): string {
    return win32.basename(path);
  }

  joinPath(parent: string, child: string): string {
    return win32.join(parent, child);
  }

  relativeSegments(parent: string, child: string): string[] {
    const value = win32.relative(parent, child);
    return value ? value.split("\\").filter(Boolean) : [];
  }

  isWithin(parent: string, child: string): boolean {
    const value = win32.relative(parent, child);
    return (
      value === "" ||
      (!value.startsWith("..") && !win32.isAbsolute(value))
    );
  }

  pathDepth(path: string): number {
    return win32
      .resolve(path)
      .split("\\")
      .filter(Boolean).length;
  }

  async resolveRealPath(path: string): Promise<string> {
    if (
      this.normalizePath(path).canonicalPath ===
      this.normalizePath(
        "C:\\root\\linked-outside"
      ).canonicalPath
    ) {
      return "C:\\outside";
    }

    return this.normalizePath(path).path;
  }

  async readDirectory(
    path: string
  ): Promise<WorkspaceDirectoryEntry[]> {
    const normalized = this.normalizePath(path).canonicalPath;
    const entries: Record<
      string,
      Array<[string, WorkspaceDirectoryEntry["kind"]]>
    > = {
      [this.normalizePath("C:\\root").canonicalPath]: [
        [".git", "directory"],
        ["core", "directory"],
        ["denied", "directory"],
        ["linked-outside", "symbolic-link"],
        ["node_modules", "directory"]
      ],
      [this.normalizePath("C:\\root\\core").canonicalPath]: [
        [".git", "directory"],
        ["nested", "directory"]
      ],
      [this.normalizePath(
        "C:\\root\\node_modules"
      ).canonicalPath]: [["ignored", "directory"]],
      [this.normalizePath(
        "C:\\root\\node_modules\\ignored"
      ).canonicalPath]: [[".git", "directory"]],
      [this.normalizePath("C:\\exclude-root").canonicalPath]: [
        ["svr", "directory"],
        ["other", "directory"]
      ],
      [this.normalizePath(
        "C:\\exclude-root\\svr"
      ).canonicalPath]: [["resource-server-demo", "directory"]],
      [this.normalizePath(
        "C:\\exclude-root\\svr\\resource-server-demo"
      ).canonicalPath]: [[".git", "directory"]],
      [this.normalizePath(
        "C:\\exclude-root\\other"
      ).canonicalPath]: [["resource-server-demo", "directory"]],
      [this.normalizePath(
        "C:\\exclude-root\\other\\resource-server-demo"
      ).canonicalPath]: [[".git", "directory"]],
      [this.normalizePath(
        "C:\\basename-exclude-root"
      ).canonicalPath]: [
        ["api", "directory"],
        ["services", "directory"]
      ],
      [this.normalizePath(
        "C:\\basename-exclude-root\\api"
      ).canonicalPath]: [[".git", "directory"]],
      [this.normalizePath(
        "C:\\basename-exclude-root\\services"
      ).canonicalPath]: [["api", "directory"]],
      [this.normalizePath(
        "C:\\basename-exclude-root\\services\\api"
      ).canonicalPath]: [[".git", "directory"]]
    };

    if (
      normalized ===
      this.normalizePath("C:\\root\\denied").canonicalPath
    ) {
      throw Object.assign(new Error("Access denied."), {
        code: "EACCES"
      });
    }

    return (entries[normalized] ?? []).map(([name, kind]) => ({
      name,
      path: win32.join(path, name),
      kind
    }));
  }
}

class BlockingReadWindowsFileSystem extends FakeWindowsFileSystem {
  readonly readStarted: Promise<void>;
  readonly #readGate: Promise<void>;
  #markReadStarted!: () => void;
  releaseRead!: () => void;

  constructor() {
    super();
    this.readStarted = new Promise<void>((resolve) => {
      this.#markReadStarted = resolve;
    });
    this.#readGate = new Promise<void>((resolve) => {
      this.releaseRead = resolve;
    });
  }

  override async readDirectory(
    path: string
  ): Promise<WorkspaceDirectoryEntry[]> {
    this.#markReadStarted();
    await this.#readGate;
    return super.readDirectory(path);
  }
}

class FakeRepositoryProbe implements RepositoryProbe {
  async inspectRepository(
    path: string
  ): Promise<RepositoryProbeResult> {
    return repository(path, win32.join(path, ".git"));
  }
}

function rootDefinition(
  fileSystem: WorkspaceFileSystem,
  path: string
) {
  const normalized = fileSystem.normalizePath(path);
  return {
    path: normalized.path,
    canonicalPath: normalized.canonicalPath,
    excludes: []
  };
}

function discovery(
  fileSystem: WorkspaceFileSystem,
  root: string,
  path: string,
  probe: RepositoryProbeResult
): DiscoveredRepository {
  const normalized = fileSystem.normalizePath(path);
  return {
    path: normalized.path,
    canonicalPath: normalized.canonicalPath,
    relativeSegments: fileSystem.relativeSegments(root, path),
    repository: probe
  };
}

function repository(
  path: string,
  commonDir: string,
  worktrees = [worktree(path, true)]
): RepositoryProbeResult {
  return {
    worktreePath: path,
    gitDir: commonDir,
    commonDir,
    head: "abc123",
    branch: "main",
    worktrees
  };
}

function worktree(
  path: string,
  primary: boolean
) {
  return {
    path,
    head: "abc123",
    branch: primary ? "main" : "linked/test",
    primary,
    bare: false,
    detached: false,
    locked: false,
    prunable: false
  };
}
