import {
  mkdir,
  symlink,
  writeFile
} from "node:fs/promises";
import * as fileSystemPromises from "node:fs/promises";
import { join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import {
  createTemporaryDirectoryFixture,
  type TemporaryDirectoryFixture
} from "@gitnest/testkit";
import { WorkspaceScanner } from "@gitnest/workspace-core";

import {
  NodeWorkspaceFileSystem,
  NodeWorktreePathPolicy
} from "./filesystem.adapter";

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>()
}));

describe("NodeWorktreePathPolicy", () => {
  let fixture: TemporaryDirectoryFixture;

  beforeEach(async () => {
    fixture = await createTemporaryDirectoryFixture(
      "worktree-path-policy"
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fixture.dispose();
  });

  it.each(["inside", "outside"])(
    "ignores file symlinks to targets %s the workspace",
    async (location) => {
      const root = join(fixture.path, "workspace");
      await mkdir(root);
      const sourceFile = join(
        location === "inside" ? root : fixture.path,
        "shared.txt"
      );
      await writeFile(sourceFile, "shared file\n", "utf8");
      const link = join(root, "linked-file.txt");
      const originalReadDirectory = fileSystemPromises.readdir;
      const originalRealpath = fileSystemPromises.realpath;
      const originalStat = fileSystemPromises.stat;
      // Windows file symlinks require privileges unavailable to the
      // test runner. Supply only the link's filesystem observations.
      vi.spyOn(fileSystemPromises, "readdir").mockImplementation(
        (async (path: Parameters<typeof fileSystemPromises.readdir>[0]) => {
          if (path === link) {
            throw Object.assign(new Error("not a directory"), {
              code: "ENOTDIR"
            });
          }
          const entries = await originalReadDirectory(path, {
            withFileTypes: true
          });
          return path === root
            ? [...entries, {
                name: "linked-file.txt",
                isSymbolicLink: () => true,
                isDirectory: () => false,
                isFile: () => false
              }]
            : entries;
        }) as unknown as typeof fileSystemPromises.readdir
      );
      vi.spyOn(fileSystemPromises, "realpath").mockImplementation(
        ((path) => originalRealpath(
          path === link ? sourceFile : path
        )) as typeof fileSystemPromises.realpath
      );
      vi.spyOn(fileSystemPromises, "stat").mockImplementation(
        ((path) => originalStat(
          path === link ? sourceFile : path
        )) as typeof fileSystemPromises.stat
      );
      const fileSystem = new NodeWorkspaceFileSystem();
      const scanner = new WorkspaceScanner(fileSystem, {
        inspectRepository: async () => {
          throw new Error("No Git marker exists in this fixture.");
        }
      });

      const result = await scanner.scanRoot({
        ...fileSystem.normalizePath(root),
        excludes: []
      });

      expect(result.issues).toEqual([]);
      expect(result.repositories).toEqual([]);
    }
  );

  it("accepts dot-prefixed descendants while rejecting parent and sibling paths", async () => {
    const policy = new NodeWorktreePathPolicy();
    const fileSystem = new NodeWorkspaceFileSystem();
    const selected = join(fixture.path, "selected");
    const child = join(selected, "..项目");
    await mkdir(child, { recursive: true });

    for (const boundary of [policy, fileSystem]) {
      expect(boundary.isWithin(selected, child)).toBe(true);
      expect(
        boundary.isWithin(selected, selected)
      ).toBe(true);
      expect(
        boundary.isWithin(selected, fixture.path)
      ).toBe(false);
      expect(
        boundary.isWithin(
          selected,
          join(fixture.path, "selected-other")
        )
      ).toBe(false);
    }

    await policy.grantSelection(selected);
    expect(
      policy.isExplicitlySelected(
        (await policy.inspectPath(child)).canonicalPath
      )
    ).toBe(true);
  });

  it("distinguishes missing, empty, non-empty, file, and symbolic-link paths", async () => {
    const policy = new NodeWorktreePathPolicy();
    const empty = join(fixture.path, "empty");
    const nonEmpty = join(fixture.path, "non-empty");
    const file = join(fixture.path, "file.txt");
    const link = join(fixture.path, "directory-link");
    await mkdir(empty);
    await mkdir(nonEmpty);
    await writeFile(
      join(nonEmpty, "content.txt"),
      "content\n",
      "utf8"
    );
    await writeFile(file, "file\n", "utf8");
    await symlink(
      empty,
      link,
      process.platform === "win32" ? "junction" : "dir"
    );

    await expect(policy.inspectPath(empty)).resolves.toMatchObject({
      exists: true,
      kind: "directory",
      empty: true
    });
    await expect(
      policy.inspectPath(nonEmpty)
    ).resolves.toMatchObject({
      exists: true,
      kind: "directory",
      empty: false
    });
    await expect(policy.inspectPath(file)).resolves.toMatchObject({
      exists: true,
      kind: "file",
      empty: false
    });
    await expect(policy.inspectPath(link)).resolves.toMatchObject({
      exists: true,
      kind: "symbolic-link",
      empty: false
    });
    await expect(
      policy.inspectPath(join(fixture.path, "missing"))
    ).resolves.toMatchObject({
      exists: false,
      kind: "missing",
      empty: false
    });
  });

  it("canonicalizes missing descendants through the nearest real ancestor", async () => {
    const policy = new NodeWorktreePathPolicy();
    const realParent = join(fixture.path, "real-parent");
    const linkedParent = join(fixture.path, "linked-parent");
    await mkdir(realParent);
    await symlink(
      realParent,
      linkedParent,
      process.platform === "win32" ? "junction" : "dir"
    );

    const inspection = await policy.inspectPath(
      join(linkedParent, "new-worktree")
    );
    const expected = policy.normalizePath(
      join(realParent, "new-worktree")
    );

    expect(inspection).toMatchObject({
      exists: false,
      kind: "missing",
      canonicalPath: expected.canonicalPath
    });
  });

  it("grants bounded descendant authorization and expires it", async () => {
    let now = 1_000;
    const policy = new NodeWorktreePathPolicy({
      now: () => now,
      selectionTtlMs: 500
    });
    const selected = join(fixture.path, "selected");
    await mkdir(selected);
    await policy.grantSelection(selected);
    const selectedCanonical =
      policy.normalizePath(selected).canonicalPath;
    const childCanonical = (
      await policy.inspectPath(
        join(selected, "new-worktree")
      )
    ).canonicalPath;

    expect(
      policy.isExplicitlySelected(selectedCanonical)
    ).toBe(true);
    expect(
      policy.isExplicitlySelected(childCanonical)
    ).toBe(true);
    expect(
      policy.isExplicitlySelected(
        policy.normalizePath(fixture.path).canonicalPath
      )
    ).toBe(false);

    now += 501;
    expect(
      policy.isExplicitlySelected(childCanonical)
    ).toBe(false);
  });

  it("rejects relative paths and non-directory grants", async () => {
    const policy = new NodeWorktreePathPolicy();
    const file = join(fixture.path, "file.txt");
    await writeFile(file, "file\n", "utf8");

    expect(() => policy.normalizePath("relative")).toThrowError(
      expect.objectContaining({
        code: "INVALID_REQUEST"
      })
    );
    await expect(
      policy.grantSelection(file)
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
  });
});
