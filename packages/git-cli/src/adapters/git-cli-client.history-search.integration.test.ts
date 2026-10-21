import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTemporaryDirectoryFixture, type TemporaryDirectoryFixture } from "@gitnest/testkit";
import { GitCliClient } from "./git-cli-client";

describe("full repository history search", () => {
  let fixture: TemporaryDirectoryFixture;
  const client = new GitCliClient();
  beforeAll(async () => {
    fixture = await createTemporaryDirectoryFixture("history-search");
    await git(["init", "--initial-branch=main", "."]);
    await git(["config", "user.name", "History [Author]"]);
    await git(["config", "user.email", "history@example.test"]);
    await writeFile(join(fixture.path, "literal[1].txt"), "old\n");
    await git(["add", "--", "literal[1].txt"]);
    await git(["commit", "--author", "History [Author] Union[author] <history@example.test>",
      "-m", "Ancient first", "-m", "needle[body] --all union[author]"], "2020-01-02T12:00:00");
    await git(["branch", "base"]);
    await writeFile(join(fixture.path, "literal1.txt"), "different\n");
    await git(["add", "--", "literal1.txt"]);
    await git(["commit", "--author", "Union[author] Writer <union@example.test>",
      "-m", "Ancient second needle[body]"], "2020-01-03T12:00:00");
    for (let index = 0; index < 205; index += 1) {
      await git(["commit", "--allow-empty", "-m", `Recent ${index}`], "2026-01-01T12:00:00");
    }
    await git(["switch", "-c", "topic", "base"]);
    await git(["commit", "--allow-empty", "-m", "Topic needle[body]", "-m", "union[author]"], "2020-01-04T12:00:00");
    await git(["switch", "main"]);
  }, 60_000);
  afterAll(async () => fixture.dispose());

  it("searches commit bodies beyond the first page and paginates matching commits", async () => {
    const recent = await client.readCommitHistory(fixture.path);
    expect(recent.commits.some((commit) => commit.subject.startsWith("Ancient"))).toBe(false);
    const first = await client.readCommitHistory(fixture.path, {
      limit: 1, search: { keyword: "NEEDLE[body]" }
    });
    expect(first.commits.map((commit) => commit.subject)).toEqual(["Ancient second needle[body]"]);
    expect(first.nextOffset).toBe(1);
    const next = await client.readCommitHistory(fixture.path, {
      limit: 1, offset: first.nextOffset!, search: { keyword: "NEEDLE[body]" }
    });
    expect(next.commits.map((commit) => commit.subject)).toEqual(["Ancient first"]);
    expect(next.nextOffset).toBeUndefined();
    expect((await client.readCommitHistory(fixture.path, {
      search: { keyword: "no such message" }
    })).commits).toEqual([]);
  }, 15_000);

  it("intersects literal author, local inclusive dates and literal path filters", async () => {
    const result = await client.readCommitHistory(fixture.path, {
      search: {
        keyword: "needle[body]", author: "[Author]",
        since: "2020-01-02", until: "2020-01-02", path: "literal[1].txt"
      }
    });
    expect(result.commits.map((commit) => commit.subject)).toEqual(["Ancient first"]);
    expect((await client.readCommitHistory(fixture.path, {
      search: { path: "literal[1].txt" }
    })).commits).toHaveLength(1);
    expect((await client.readCommitHistory(fixture.path, {
      search: { keyword: "--all" }
    })).commits.map((commit) => commit.subject)).toEqual(["Ancient first"]);
  }, 15_000);

  it("matches message OR author OR email across scan batches and paginates without duplicates", async () => {
    for (const keyword of ["WRITER", "UNION@EXAMPLE.TEST"]) {
      const result = await client.readCommitHistory(fixture.path, { search: { keyword } });
      expect(result.commits.map(commit => commit.subject)).toEqual(["Ancient second needle[body]"]);
    }
    const first = await client.readCommitHistory(fixture.path, {
      limit: 1, search: { keyword: "UNION[AUTHOR]" }
    });
    const second = await client.readCommitHistory(fixture.path, {
      limit: 1, offset: first.nextOffset!, search: { keyword: "UNION[AUTHOR]" }
    });
    expect(first.commits.map(commit => commit.subject)).toEqual(["Ancient second needle[body]"]);
    expect(second.commits.map(commit => commit.subject)).toEqual(["Ancient first"]);
    expect(second.nextOffset).toBeUndefined();
    expect((await client.readCommitHistory(fixture.path, {
      search: { keyword: "union.*" }
    })).commits).toEqual([]);
  }, 15_000);

  it("keeps full-history searches inside the selected ref", async () => {
    const scope = { kind: "ref" as const, ref: "refs/heads/topic" };
    expect((await client.readCommitHistory(fixture.path, { scope, search: { keyword: "WRITER" } })).commits).toEqual([]);
    const result = await client.readCommitHistory(fixture.path, { scope, search: { keyword: "Topic" } });
    expect(result.commits.map(commit => commit.subject)).toEqual(["Topic needle[body]"]);
  }, 15_000);

  it("rejects malformed dates, ranges, controls and escaping paths before Git", async () => {
    for (const search of [
      { since: "2026-02-30" }, { until: "--all" },
      { since: "2026-03-02", until: "2026-03-01" },
      { keyword: "unsafe\0value" }, { path: "../outside" }, { path: "C:\\outside" }
    ]) {
      await expect(client.readCommitHistory(fixture.path, { search }))
        .rejects.toMatchObject({ code: "INVALID_REQUEST" });
    }
  });

  it("大量不同引用起点仍可加载、搜索和稳定分页", async () => {
    const bulk = await createTemporaryDirectoryFixture("history-many-refs");
    try {
      await git(["init", "-b", "main"], undefined, undefined, bulk.path);
      let input = "";
      for (let index = 1; index <= 1000; index += 1) {
        const subject = `release-${index}`;
        input += `commit refs/heads/main\nmark :${index}\nauthor Bulk Author <bulk@example.test> ${1750000000 + index} +0800\ncommitter Bulk Author <bulk@example.test> ${1750000000 + index} +0800\ndata ${subject.length}\n${subject}\n${index > 1 ? `from :${index - 1}\n` : ""}\nreset refs/tags/v${index}\nfrom :${index}\n\nreset refs/heads/topic-${index}\nfrom :${index}\n\n`;
      }
      await git(["fast-import", "--quiet"], undefined, input, bulk.path);
      const scope = { kind: "all" as const };
      const first = await client.readCommitHistory(bulk.path, { scope, limit: 50 });
      expect(first.traversal?.startHashes).toHaveLength(1000);
      expect(first.commits[0]?.subject).toBe("release-1000");
      expect(first.nextOffset).toBe(50);
      const last = await client.readCommitHistory(bulk.path, { scope, traversal: first.traversal!, offset: 990, limit: 50 });
      expect(last.commits).toHaveLength(10);
      expect(last.commits.at(-1)?.subject).toBe("release-1");
      expect(last.nextOffset).toBeUndefined();
      const message = await client.readCommitHistory(bulk.path, { scope, search: { keyword: "release-999" } });
      expect(message.commits.map(commit => commit.subject)).toEqual(["release-999"]);
      const author = await client.readCommitHistory(bulk.path, {
        scope, traversal: first.traversal!, search: { keyword: "Bulk Author" }, offset: 500, limit: 50
      });
      expect(author.commits).toHaveLength(50);
      expect(author.commits[0]?.subject).toBe("release-500");

      const ref = { kind: "ref" as const, ref: "refs/heads/main" };
      const pinned = await client.readCommitHistory(bulk.path, { scope: ref, limit: 3 });
      await git(["update-ref", ref.ref, pinned.commits[1]!.hash], undefined, undefined, bulk.path);
      const next = await client.readCommitHistory(bulk.path, { scope: ref, traversal: pinned.traversal!, offset: 3, limit: 3 });
      expect(next.commits[0]?.subject).toBe("release-997");
    } finally {
      await bulk.dispose();
    }
  }, 30_000);

  it("拒绝已删除的比较范围", async () => {
    await expect(client.readCommitHistory(fixture.path, {
      scope: { kind: "compare", leftRef: "refs/heads/main", rightRef: "refs/heads/topic" } as never
    })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  function git(args: string[], date?: string, input?: string, cwd = fixture.path): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, {
        cwd, shell: false, windowsHide: true,
        env: {
          ...process.env, GIT_TERMINAL_PROMPT: "0",
          ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {})
        }
      });
      let output = "";
      let error = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.on("data", (chunk) => { error += chunk; });
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve(output) : reject(new Error(error)));
      child.stdin.end(input);
    });
  }
});
