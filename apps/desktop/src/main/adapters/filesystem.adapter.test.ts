import {
  mkdir,
  symlink,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from "vitest";

import {
  createTemporaryDirectoryFixture,
  type TemporaryDirectoryFixture
} from "@gitnest/testkit";

import { NodeWorktreePathPolicy } from "./filesystem.adapter";

describe("NodeWorktreePathPolicy", () => {
  let fixture: TemporaryDirectoryFixture;

  beforeEach(async () => {
    fixture = await createTemporaryDirectoryFixture(
      "worktree-path-policy"
    );
  });

  afterEach(async () => {
    await fixture.dispose();
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
