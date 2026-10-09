import { link, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTemporaryDirectoryFixture } from "@gitnest/testkit";
import type { GitIgnoreScope } from "@gitnest/git-core";
import { runProcess } from "../process/git-process-runner";
import { findGitExecutable } from "../environment/find-git-executable";
import { GitCliIgnoreClient } from "./git-ignore-client";

describe("GitCliIgnoreClient real Git", () => {
  it.each(["[x] 中文 !# file.txt", "-option.txt", "#comment.txt", "!negative.txt", "..literal.txt"])("ignores literal filename %s without touching bytes or index", async name => {
    const fixture = await repository();
    try {
      await writeFile(join(fixture.path, name), "keep me\n");
      const plan = await fixture.client.inspect(fixture.path, { path: name, scope: "file" });
      await fixture.client.execute(fixture.path, plan);
      expect((await fixture.git(["check-ignore", "--quiet", "--", name], fixture.path, true)).exitCode).toBe(0);
      expect(await readFile(join(fixture.path, name), "utf8")).toBe("keep me\n");
      expect((await fixture.git(["diff", "--cached", "--name-only"])).stdout).toBe("");
      expect((await fixture.git(["ls-files", "-z"])).stdout).toBe("tracked.txt\0");
    } finally { await fixture.dispose(); }
  }, 30_000);
  it("anchors literal patterns without matching lookalikes or deeper names", async () => {
    const f = await repository();
    try {
      await mkdir(join(f.path, "nested"));
      for (const name of ["[a].txt", "a.txt", "nested/[a].txt"]) await writeFile(join(f.path, name), "keep");
      await f.client.execute(f.path, await f.client.inspect(f.path, { path: "[a].txt", scope: "file" }));
      expect((await f.git(["check-ignore", "--quiet", "--", "[a].txt"], f.path, true)).exitCode).toBe(0);
      for (const name of ["a.txt", "nested/[a].txt"]) expect((await f.git(["check-ignore", "--quiet", "--", name], f.path, true)).exitCode).toBe(1);
    } finally { await f.dispose(); }
  }, 30_000);
  it.each(["directory", "extension"] as const)("implements %s scope and retains tracked files", async scope => {
    const f = await repository();
    try {
      await mkdir(join(f.path, "build space"));
      await mkdir(join(f.path, "elsewhere"));
      await writeFile(join(f.path, "build space/a.log"), "keep");
      await writeFile(join(f.path, "build space/other.bin"), "keep");
      await writeFile(join(f.path, "elsewhere/a.log"), "keep");
      const plan = await f.client.inspect(f.path, { path: "build space/a.log", scope });
      await f.client.execute(f.path, plan);
      expect((await f.git(["check-ignore", "--quiet", "--", "build space/a.log"], f.path, true)).exitCode).toBe(0);
      expect((await f.git(["check-ignore", "--quiet", "--", "build space/other.bin"], f.path, true)).exitCode).toBe(scope === "directory" ? 0 : 1);
      expect((await f.git(["check-ignore", "--quiet", "--", "elsewhere/a.log"], f.path, true)).exitCode).toBe(scope === "extension" ? 0 : 1);
      expect((await f.git(["ls-files", "-z"])).stdout).toBe("tracked.txt\0");
    } finally { await f.dispose(); }
  }, 30_000);
  it.each(["", "\uFEFF", "# existing\r\nold", "# existing\nold\n"])("preserves original bytes, BOM and newline style %j", async initial => {
    const f = await repository();
    try {
      await writeFile(join(f.path, ".gitignore"), initial);
      await writeFile(join(f.path, "new.txt"), "keep");
      await f.client.execute(f.path, await f.client.inspect(f.path, { path: "new.txt", scope: "file" }));
      const eol = initial.includes("\r\n") ? "\r\n" : "\n";
      const separator = initial && !initial.endsWith("\n") && initial !== "\uFEFF" ? eol : "";
      expect(await readFile(join(f.path, ".gitignore"), "utf8")).toBe(`${initial}${separator}/new.txt${eol}`);
      expect((await f.git(["check-ignore", "--quiet", "new.txt"], f.path, true)).exitCode).toBe(0);
    } finally { await f.dispose(); }
  }, 30_000);
  it("refuses tracked files, previously ignored files and unsupported scopes", async () => {
    const f = await repository();
    try {
      await expect(f.client.inspect(f.path, { path: "tracked.txt", scope: "file" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      await writeFile(join(f.path, ".gitignore"), "/ignored.txt\n");
      await writeFile(join(f.path, "ignored.txt"), "keep");
      await expect(f.client.inspect(f.path, { path: "ignored.txt", scope: "file" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      for (const input of [{ path: "tracked.txt", scope: "directory" }, { path: ".env", scope: "extension" }, { path: "no-extension", scope: "extension" }]) {
        await expect(f.client.inspect(f.path, input as { path: string; scope: GitIgnoreScope })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      }
    } finally { await f.dispose(); }
  }, 30_000);
  it.each(["../escape", "folder/../escape", "/absolute", "C:/absolute", ".git/config", ".GIT/config", "file:stream", "a\nrule", "a\\b"])("rejects unsafe path %j before Git", async path => {
    const client = new GitCliIgnoreClient({ executable: "must-not-run", runner: async () => { throw new Error("unexpected Git"); } });
    await expect(client.inspect("unused", { path, scope: "file" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it("rejects changed ignore content without overwriting new user edits", async () => {
    const f = await repository();
    try {
      await writeFile(join(f.path, "new.txt"), "keep");
      const plan = await f.client.inspect(f.path, { path: "new.txt", scope: "file" });
      await writeFile(join(f.path, ".gitignore"), "# user edit\n");
      await expect(f.client.execute(f.path, plan)).rejects.toMatchObject({ code: "PREFLIGHT_CHANGED" });
      expect(await readFile(join(f.path, ".gitignore"), "utf8")).toBe("# user edit\n");
    } finally { await f.dispose(); }
  }, 30_000);
  it("rechecks newly tracked files before writing", async () => {
    const f = await repository();
    try {
      await writeFile(join(f.path, "new.txt"), "keep");
      const plan = await f.client.inspect(f.path, { path: "new.txt", scope: "file" });
      await f.git(["add", "new.txt"]);
      await expect(f.client.execute(f.path, plan)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      await expect(readFile(join(f.path, ".gitignore"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await f.dispose(); }
  }, 30_000);
  it("explains nested override limits and protects changed nested rules", async () => {
    const f = await repository();
    try {
      await mkdir(join(f.path, "nested"));
      await writeFile(join(f.path, "nested/new.log"), "keep");
      await writeFile(join(f.path, "nested/.gitignore"), "!new.log\n");
      const plan = await f.client.inspect(f.path, { path: "nested/new.log", scope: "extension" });
      expect(plan.warnings.join("")).toContain("取消忽略");
      await f.client.execute(f.path, plan);
      // The preview explicitly does not claim a root rule overrides deeper negations.
      expect((await f.git(["check-ignore", "--quiet", "--", "nested/new.log"], f.path, true)).exitCode).toBe(1);
      const next = await f.client.inspect(f.path, { path: "nested/new.log", scope: "file" });
      await writeFile(join(f.path, "nested/.gitignore"), "!new.log\n# new edit\n");
      await expect(f.client.execute(f.path, next)).rejects.toMatchObject({ code: "PREFLIGHT_CHANGED" });
    } finally { await f.dispose(); }
  }, 30_000);
  it("writes only the selected linked Worktree ignore file", async () => {
    const f = await repository();
    try {
      const linked = join(f.root, "linked");
      await f.git(["worktree", "add", "-b", "linked", linked]);
      await writeFile(join(linked, "new.log"), "keep");
      await f.client.execute(linked, await f.client.inspect(linked, { path: "new.log", scope: "file" }));
      expect(await readFile(join(linked, ".gitignore"), "utf8")).toBe("/new.log\n");
      await expect(readFile(join(f.path, ".gitignore"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await f.dispose(); }
  }, 30_000);
  it("rejects hard-linked ignore files and invalid encodings", async () => {
    const f = await repository();
    try {
      await writeFile(join(f.path, "new.txt"), "keep");
      await writeFile(join(f.root, "outside"), "# external\n");
      await link(join(f.root, "outside"), join(f.path, ".gitignore"));
      await expect(f.client.inspect(f.path, { path: "new.txt", scope: "file" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      expect(await readFile(join(f.root, "outside"), "utf8")).toBe("# external\n");
    } finally { await f.dispose(); }
    const other = await repository();
    try {
      await writeFile(join(other.path, "new.txt"), "keep");
      await writeFile(join(other.path, ".gitignore"), Buffer.from([0xff, 0xfe, 0x61, 0]));
      await expect(other.client.inspect(other.path, { path: "new.txt", scope: "file" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    } finally { await other.dispose(); }
  }, 30_000);
  it("rejects junction paths that lead outside the Worktree", async () => {
    const f = await repository();
    try {
      const outside = join(f.root, "outside");
      await mkdir(outside);
      await writeFile(join(outside, "new.txt"), "keep");
      await symlink(outside, join(f.path, "linked"), process.platform === "win32" ? "junction" : "dir");
      await expect(f.client.inspect(f.path, { path: "linked/new.txt", scope: "file" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      expect(await readFile(join(outside, "new.txt"), "utf8")).toBe("keep");
    } finally { await f.dispose(); }
  }, 30_000);
  it("rejects a symbolic link at the root .gitignore path", async () => {
    const f = await repository();
    try {
      const outside = join(f.root, "outside");
      await mkdir(outside);
      await writeFile(join(f.path, "new.txt"), "keep");
      // A junction exercises the Windows reparse-point branch without requiring
      // elevated file-symlink privileges.
      await symlink(outside, join(f.path, ".gitignore"), process.platform === "win32" ? "junction" : "dir");
      await expect(f.client.inspect(f.path, { path: "new.txt", scope: "file" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    } finally { await f.dispose(); }
  }, 30_000);
  it("escapes extension glob characters literally", async () => {
    const f = await repository();
    try {
      await writeFile(join(f.path, "one.t[x]"), "keep");
      await writeFile(join(f.path, "two.tx"), "keep");
      await f.client.execute(f.path, await f.client.inspect(f.path, { path: "one.t[x]", scope: "extension" }));
      expect((await f.git(["check-ignore", "--quiet", "--", "one.t[x]"], f.path, true)).exitCode).toBe(0);
      expect((await f.git(["check-ignore", "--quiet", "--", "two.tx"], f.path, true)).exitCode).toBe(1);
    } finally { await f.dispose(); }
  }, 30_000);
  it("does not create .gitignore when the operation is cancelled", async () => {
    const f = await repository();
    try {
      await writeFile(join(f.path, "new.txt"), "keep");
      const plan = await f.client.inspect(f.path, { path: "new.txt", scope: "file" });
      const controller = new AbortController(); controller.abort();
      await expect(f.client.execute(f.path, plan, { signal: controller.signal })).rejects.toMatchObject({ code: "COMMAND_CANCELLED" });
      await expect(readFile(join(f.path, ".gitignore"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await f.dispose(); }
  }, 30_000);
});
async function repository() {
  const fixture = await createTemporaryDirectoryFixture("gitnest-ignore-");
  const root = fixture.path;
  const path = join(root, "repository");
  await mkdir(path);
  const executable = await findGitExecutable();
  const environment = { GIT_CONFIG_GLOBAL: join(root, "missing-global"), GIT_CONFIG_NOSYSTEM: "1", GIT_EDITOR: "true" };
  const git = (args: string[], cwd = path, allowFailure = false) => runProcess({ executable, args, cwd, allowFailure, writeIntent: true, environment, timeoutMs: 30_000 });
  await git(["init", "-b", "main"]);
  await git(["config", "user.name", "Ignore Test"]); await git(["config", "user.email", "ignore@example.test"]);
  await git(["config", "core.autocrlf", "false"]); await git(["config", "commit.gpgsign", "false"]);
  await writeFile(join(path, "tracked.txt"), "base\n");
  await git(["add", "."]); await git(["commit", "-m", "initial"]);
  return { ...fixture, root, path, git, client: new GitCliIgnoreClient({ executable, runner: request => runProcess({ ...request, environment }) }) };
}
