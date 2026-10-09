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
    await git(["commit", "-m", "Ancient first", "-m", "needle[body] --all"], "2020-01-02T12:00:00");
    await git(["branch", "base"]);
    await writeFile(join(fixture.path, "literal1.txt"), "different\n");
    await git(["add", "--", "literal1.txt"]);
    await git(["commit", "-m", "Ancient second needle[body]"], "2020-01-03T12:00:00");
    for (let index = 0; index < 52; index += 1) {
      await git(["commit", "--allow-empty", "-m", `Recent ${index}`], "2026-01-01T12:00:00");
    }
    await git(["switch", "-c", "topic", "base"]);
    await git(["commit", "--allow-empty", "-m", "Topic needle[body]"], "2020-01-04T12:00:00");
    await git(["switch", "main"]);
  }, 30_000);
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
  });

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
  });

  it("keeps ref and comparison scopes, and excludes nonmatching boundary commits", async () => {
    const result = await client.readCommitHistory(fixture.path, {
      scope: { kind: "ref", ref: "refs/heads/topic" },
      search: { keyword: "Topic" }
    });
    expect(result.commits.map((commit) => commit.subject)).toEqual(["Topic needle[body]"]);
    const comparison = await client.readCommitHistory(fixture.path, {
      scope: { kind: "compare", leftRef: "refs/heads/main", rightRef: "refs/heads/topic" },
      search: { keyword: "needle[body]" }, limit: 1
    });
    const next = await client.readCommitHistory(fixture.path, {
      scope: { kind: "compare", leftRef: "refs/heads/main", rightRef: "refs/heads/topic" },
      search: { keyword: "needle[body]" }, offset: comparison.nextOffset!, limit: 1
    });
    expect([...comparison.commits, ...next.commits].map((commit) => commit.subject).sort())
      .toEqual(["Ancient second needle[body]", "Topic needle[body]"]);
    expect(comparison.comparison).toMatchObject({ leftOnly: 1, rightOnly: 1 });
    expect(next.nextOffset).toBeUndefined();
    expect((await client.readCommitHistory(fixture.path, {
      scope: { kind: "compare", leftRef: "refs/heads/main", rightRef: "refs/heads/topic" },
      search: { keyword: "no matches" }
    })).commits).toEqual([]);
  });

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

  function git(args: string[], date?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, {
        cwd: fixture.path, shell: false, windowsHide: true,
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
    });
  }
});
