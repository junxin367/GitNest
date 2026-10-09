import { spawn } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GitError } from "@gitnest/git-core";
import { createTemporaryDirectoryFixture, type TemporaryDirectoryFixture } from "@gitnest/testkit";
import { GitCliFileHistoryClient } from "./file-history-client";
import type { ProcessRequest } from "../process/git-process-runner";

describe("file history committed object queries", () => {
  let fixture: TemporaryDirectoryFixture;
  const client = new GitCliFileHistoryClient();
  const original = "中文 空格[1].txt";
  const renamed = "renamed 中文[1].txt";
  let initial: string;
  let renameHash: string;
  let head: string;
  beforeAll(async () => {
    fixture = await createTemporaryDirectoryFixture("file-history");
    await git(["init", "--initial-branch=main", "."]);
    await git(["config", "user.name", "History Author"]);
    await git(["config", "user.email", "file-history@example.test"]);
    await writeFile(join(fixture.path, original), "first line\nsecond line\n");
    await writeFile(join(fixture.path, "literal1.txt"), "unrelated\n");
    await git(["add", "."]);
    await git(["commit", "-m", "ancient file"]);
    initial = (await git(["rev-parse", "HEAD"])).trim();
    await rename(join(fixture.path, original), join(fixture.path, renamed));
    await git(["add", "-A"]);
    await git(["commit", "-m", "rename file"]);
    renameHash = (await git(["rev-parse", "HEAD"])).trim();
    await writeFile(join(fixture.path, renamed), "first line\nupdated second line\n");
    await git(["add", "."]);
    await git(["commit", "-m", "update file"]);
    await writeFile(join(fixture.path, "--all"), "literal option filename\n");
    await git(["add", "."]);
    await git(["commit", "-m", "other files"]);
    for (let index = 0; index < 52; index++) await git(["commit", "--allow-empty", "-m", `unrelated ${index}`]);
    head = (await git(["rev-parse", "HEAD"])).trim();
  }, 40_000);
  afterAll(async () => fixture.dispose());

  it("finds history beyond repository first page and follows rename with exact historical paths", async () => {
    const page = await client.history(fixture.path, { path: renamed });
    expect(page.status).toBe("ok");
    expect(page.entries.map((entry) => entry.subject)).toEqual(["update file", "rename file", "ancient file"]);
    expect(page.entries[1]).toMatchObject({ hash: renameHash, path: renamed, previousPath: original, status: "R100" });
    expect(page.entries[2]).toMatchObject({ hash: initial, path: original });
    expect(page.revision).toBe(head);
  });
  it("paginates through a rename using the original frozen query path", async () => {
    const first = await client.history(fixture.path, { path: renamed, limit: 1 });
    expect(first.nextOffset).toBe(1);
    const second = await client.history(fixture.path, { path: renamed, limit: 1, offset: 1, revision: first.revision! });
    const third = await client.history(fixture.path, { path: renamed, limit: 1, offset: 2, revision: first.revision! });
    expect(second.entries[0]?.subject).toBe("rename file");
    expect(third.entries[0]).toMatchObject({ subject: "ancient file", path: original });
    expect(third.nextOffset).toBeNull();
  });
  it("returns root and rename diffs for exact historical paths", async () => {
    const old = await client.diff(fixture.path, { path: original, commitHash: initial });
    expect(old.patch).toContain("+first line");
    const renameDiff = await client.diff(fixture.path, { path: renamed, previousPath: original, commitHash: renameHash });
    expect(renameDiff.patch).toContain("rename from");
    expect(renameDiff.patch).toContain("rename to");
  });
  it("uses originalPath for a pending rename and returns an explicit empty history for untracked paths", async () => {
    expect((await client.history(fixture.path, { path: "pending rename.txt", originalPath: renamed })).entries).toHaveLength(3);
    expect(await client.history(fixture.path, { path: "never tracked.txt" })).toMatchObject({ status: "empty", entries: [], nextOffset: null });
  });
  it("supports literal option-looking filenames and rejects unsafe paths/revisions before Git", async () => {
    expect((await client.history(fixture.path, { path: "--all" })).entries).toHaveLength(1);
    const runner = vi.fn();
    const guarded = new GitCliFileHistoryClient({ executable: "git", runner });
    for (const path of ["../escape", ".git/config", "dir/.GIT/config", "/root", "C:/outside", "dir\\file", "bad\0path"]) {
      await expect(guarded.history(fixture.path, { path })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    }
    await expect(guarded.history(fixture.path, { path: renamed, revision: "--all" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(guarded.history(fixture.path, { path: renamed, offset: 1 })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(runner).not.toHaveBeenCalled();
  });
  it("preserves original history after HEAD moves and exposes deletion commits", async () => {
    await git(["rm", "-f", "--", renamed]);
    await git(["commit", "-m", "delete file"]);
    const frozen = await client.history(fixture.path, { path: renamed, revision: head });
    expect(frozen.entries[0]?.subject).toBe("update file");
    const latest = await client.history(fixture.path, { path: renamed });
    expect(latest.entries[0]).toMatchObject({ status: "D", path: renamed, subject: "delete file" });
    expect((await client.diff(fixture.path, { path: renamed, commitHash: latest.revision! })).patch).toContain("-updated second line");
  });
  it("returns empty history for an unborn repository", async () => {
    const path = join(fixture.path, "unborn");
    await mkdir(path);
    await git(["init", path]);
    expect(await client.history(path, { path: "a.txt" })).toMatchObject({ revision: null, status: "empty" });
  });
  it("honors cancellation without writes", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(client.history(fixture.path, { path: renamed }, { signal: controller.signal })).rejects.toMatchObject({ code: "COMMAND_CANCELLED" });
  });
  it("includes merge conflict resolution commits and compares them with the first parent", async () => {
    const path = join(fixture.path, "merge-repo");
    await mkdir(path);
    await git(["init", "--initial-branch=main", "."], path);
    await git(["config", "user.name", "Merge Author"], path);
    await git(["config", "user.email", "merge@example.test"], path);
    await writeFile(join(path, "file.txt"), "base\n");
    await git(["add", "file.txt"], path);
    await git(["commit", "-m", "base"], path);
    await git(["branch", "topic"], path);
    await writeFile(join(path, "file.txt"), "main\n");
    await git(["commit", "-am", "main change"], path);
    await git(["switch", "topic"], path);
    await writeFile(join(path, "file.txt"), "topic\n");
    await git(["commit", "-am", "topic change"], path);
    await git(["switch", "main"], path);
    await expect(git(["merge", "topic"], path)).rejects.toThrow();
    await writeFile(join(path, "file.txt"), "resolved\n");
    await git(["add", "file.txt"], path);
    await git(["commit", "-m", "merge resolution"], path);
    const history = await client.history(path, { path: "file.txt" });
    expect(history.entries[0]).toMatchObject({ subject: "merge resolution", path: "file.txt" });
    const patch = await client.diff(path, { path: "file.txt", commitHash: history.entries[0]!.hash });
    expect(patch.patch).toContain("-main");
    expect(patch.patch).toContain("+resolved");
  });
  it("reports output limit failures explicitly and never returns a partial diff/history", async () => {
    const runner = vi.fn(async (request: ProcessRequest) => {
      if (request.args.includes("rev-parse")) return { exitCode: 0, stdout: head, stderr: "", durationMs: 0 };
      throw new GitError("OUTPUT_LIMIT_EXCEEDED", "limit");
    });
    const limited = new GitCliFileHistoryClient({ executable: "git", runner });
    expect(await limited.history(fixture.path, { path: renamed })).toMatchObject({ status: "too-large", entries: [], nextOffset: null });
    expect(await limited.diff(fixture.path, { path: renamed, commitHash: head })).toMatchObject({ status: "too-large", patch: "" });
    for (const [request] of runner.mock.calls) {
      expect(request.writeIntent).not.toBe(true);
      expect(request.args).toContain("--literal-pathspecs");
    }
  });

  function git(args: string[], cwd = fixture.path): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, { cwd, windowsHide: true, env: { ...process.env, GIT_CONFIG_GLOBAL: "NUL", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_DATE: "2026-10-06T10:00:00+08:00", GIT_COMMITTER_DATE: "2026-10-06T10:00:00+08:00" } });
      let stdout = ""; let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
    });
  }
});
