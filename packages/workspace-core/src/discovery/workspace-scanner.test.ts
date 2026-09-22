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
      id: "root",
      displayName: "root",
      path: normalizedRoot.path,
      canonicalPath: normalizedRoot.canonicalPath,
      excludes: [],
      order: 0
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
      id: "exclude-root",
      displayName: "exclude-root",
      path: normalizedRoot.path,
      canonicalPath: normalizedRoot.canonicalPath,
      excludes: ["svr/ScResSvr"],
      order: 0
    });

    expect(
      scan.repositories.map((repository) => repository.path)
    ).toEqual([
      "C:\\exclude-root\\other\\ScResSvr"
    ]);
  });
});

describe("WorkspaceAssembler", () => {
  it("classifies roots, groups direct repositories, assigns overlaps to the most specific root, and merges linked worktrees", () => {
    const fileSystem = new FakeWindowsFileSystem();
    const outer = rootDefinition(fileSystem, "C:\\root", 0);
    const nested = rootDefinition(
      fileSystem,
      "C:\\root\\svr",
      1
    );
    const standalone = rootDefinition(
      fileSystem,
      "C:\\standalone",
      2
    );
    const outerScan: WorkspaceRootScan = {
      root: outer,
      repositories: [
        discovery(
          fileSystem,
          outer.path,
          "C:\\root",
          repository("C:\\root", "C:\\root\\.git", [
            worktree("C:\\root", true),
            worktree("D:\\linked root", false)
          ])
        ),
        discovery(
          fileSystem,
          outer.path,
          "C:\\root\\core",
          repository(
            "C:\\root\\core",
            "C:\\root\\core\\.git"
          )
        ),
        discovery(
          fileSystem,
          outer.path,
          "C:\\root\\svr\\ScResSvr",
          repository(
            "C:\\root\\svr\\ScResSvr",
            "C:\\root\\svr\\ScResSvr\\.git"
          )
        )
      ],
      issues: [],
      scannedAt: "2026-09-04T10:00:00.000Z"
    };
    const nestedScan: WorkspaceRootScan = {
      root: nested,
      repositories: [
        discovery(
          fileSystem,
          nested.path,
          "C:\\root\\svr\\ScResSvr",
          repository(
            "C:\\root\\svr\\ScResSvr",
            "C:\\root\\svr\\ScResSvr\\.git"
          )
        )
      ],
      issues: [],
      scannedAt: "2026-09-04T10:00:00.000Z"
    };
    const standaloneScan: WorkspaceRootScan = {
      root: standalone,
      repositories: [
        discovery(
          fileSystem,
          standalone.path,
          standalone.path,
          repository(
            standalone.path,
            `${standalone.path}\\.git`
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
      roots: [outer, nested, standalone],
      scans: [outerScan, nestedScan, standaloneScan],
      updatedAt: "2026-09-04T10:00:00.000Z"
    });

    expect(assembled.entries).toHaveLength(3);
    expect(assembled.entries[0]).toMatchObject({
      kind: "workspace-meta-repository",
      groups: [
        {
          name: DEFAULT_ROOT_REPOSITORY_GROUP_NAME,
          collapsed: false
        }
      ]
    });
    expect(assembled.entries[1]).toMatchObject({
      kind: "workspace-directory",
      groups: [
        {
          name: DEFAULT_ROOT_REPOSITORY_GROUP_NAME,
          collapsed: false
        }
      ]
    });
    expect(assembled.entries[2]).toMatchObject({
      kind: "standalone-repository",
      groups: []
    });
    expect(
      assembled.entries[0]?.groups[0]?.targets
    ).toHaveLength(2);
    expect(assembled.repositories).toHaveLength(4);
    expect(assembled.worktrees).toHaveLength(5);

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
    const root = rootDefinition(fileSystem, "C:\\root", 0);
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
      roots: [root],
      scans: [scan],
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
      ).canonicalPath]: [["ScResSvr", "directory"]],
      [this.normalizePath(
        "C:\\exclude-root\\svr\\ScResSvr"
      ).canonicalPath]: [[".git", "directory"]],
      [this.normalizePath(
        "C:\\exclude-root\\other"
      ).canonicalPath]: [["ScResSvr", "directory"]],
      [this.normalizePath(
        "C:\\exclude-root\\other\\ScResSvr"
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

class FakeRepositoryProbe implements RepositoryProbe {
  async inspectRepository(
    path: string
  ): Promise<RepositoryProbeResult> {
    return repository(path, win32.join(path, ".git"));
  }
}

function rootDefinition(
  fileSystem: WorkspaceFileSystem,
  path: string,
  order: number
) {
  const normalized = fileSystem.normalizePath(path);
  return {
    id: createPathIdentity("entry", normalized.canonicalPath),
    displayName: fileSystem.basename(normalized.path),
    path: normalized.path,
    canonicalPath: normalized.canonicalPath,
    excludes: [],
    order
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
