import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTemporaryDirectoryFixture, type TemporaryDirectoryFixture } from "@gitnest/testkit";
import { GitCliClient } from "./git-cli-client";
import { stashMatchesHistorySearch } from "./history-stashes";

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
    const recentBase = (await git(["rev-parse", "HEAD"])).trim();
    let recentInput = "";
    for (let index = 0; index < 205; index += 1) {
      const subject = `Recent ${index}`;
      recentInput += `commit refs/heads/main\nmark :${index + 1}\nauthor History [Author] <history@example.test> 1767268800 +0000\ncommitter History [Author] <history@example.test> 1767268800 +0000\ndata ${subject.length}\n${subject}\nfrom ${index === 0 ? recentBase : `:${index}`}\n\n`;
    }
    await git(["fast-import", "--quiet"], undefined, recentInput);
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
      const expanded = await client.readCommitHistory(bulk.path, {
        scope, traversal: first.traversal!, limit: 300
      });
      expect(expanded.commits).toHaveLength(300);
      expect(expanded.nextOffset).toBe(300);
      const capped = await client.readCommitHistory(bulk.path, {
        scope, traversal: first.traversal!, limit: 1000
      });
      expect(capped.commits).toHaveLength(500);
      expect(capped.nextOffset).toBe(500);
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

  it("按提交者时间跨分支排列，显示字段、日期筛选与稳定分页保持一致", async () => {
    const ordered = await createTemporaryDirectoryFixture("history-committer-order");
    try {
      await git(["init", "-b", "main"], undefined, undefined, ordered.path);
      const base = 1_760_000_000;
      const records: { subject: string; authored: number; committed: number; keywordMatch: boolean }[] = [];
      let input = "commit refs/heads/main\nmark :1\n";
      input += `author Root <root@example.test> ${base} +0800\ncommitter Root <root@example.test> ${base} +0800\ndata 4\nroot\n\n`;
      const tips = new Map<string, number>();
      for (let index = 1; index <= 260; index += 1) {
        const branch = ["production", "pre-production", "test"][index % 3]!;
        const authored = base + ((index * 37) % 263 + 1) * 60;
        const committed = base + 3_000_000 + index;
        const subject = `${index % 4 === 0 ? "needle" : "change"}-${index}`;
        const author = index % 3 === 0 ? "Needle Writer" : "Other Writer";
        const mark = index + 1;
        records.push({ subject, authored, committed, keywordMatch: index % 4 === 0 || index % 3 === 0 });
        input += `commit refs/heads/${branch}\nmark :${mark}\nauthor ${author} <writer@example.test> ${authored} +0800\ncommitter Integrator <integrator@example.test> ${committed} +0800\ndata ${subject.length}\n${subject}\nfrom :${tips.get(branch) ?? 1}\n\n`;
        tips.set(branch, mark);
      }
      await git(["fast-import", "--quiet"], undefined, input, ordered.path);
      records.push({ subject: "root", authored: base, committed: base, keywordMatch: false });
      records.sort((left, right) => right.committed - left.committed);

      const scope = { kind: "all" as const };
      const first = await client.readCommitHistory(ordered.path, { scope, limit: 50 });
      const commits = [...first.commits];
      let offset = first.nextOffset;
      while (offset !== undefined) {
        const page = await client.readCommitHistory(ordered.path, {
          scope, traversal: first.traversal!, offset, limit: 50
        });
        commits.push(...page.commits);
        offset = page.nextOffset;
      }
      expect(commits.map(commit => commit.subject)).toEqual(records.map(record => record.subject));
      expect(commits.map(commit => Date.parse(commit.committedAt!)))
        .toEqual(records.map(record => record.committed * 1000));
      expect(commits.map(commit => Date.parse(commit.authoredAt)))
        .toEqual(records.map(record => record.authored * 1000));
      expect(new Set(commits.map(commit => commit.hash)).size).toBe(records.length);
      const repeated = await client.readCommitHistory(ordered.path, {
        scope, traversal: first.traversal!, limit: 50
      });
      expect(repeated.commits.map(commit => commit.hash)).toEqual(first.commits.map(commit => commit.hash));

      const matching = records.filter(record => record.keywordMatch).map(record => record.subject);
      const searchFirst = await client.readCommitHistory(ordered.path, {
        scope, limit: 50, search: { keyword: "needle" }
      });
      const searchSecond = await client.readCommitHistory(ordered.path, {
        scope, traversal: searchFirst.traversal!, offset: searchFirst.nextOffset!, limit: 100,
        search: { keyword: "needle" }
      });
      expect([...searchFirst.commits, ...searchSecond.commits].map(commit => commit.subject)).toEqual(matching);
      expect(searchSecond.nextOffset).toBeUndefined();
      const authorIntersection = await client.readCommitHistory(ordered.path, {
        scope, limit: 100, search: { keyword: "needle", author: "Other Writer" }
      });
      expect(authorIntersection.commits.map(commit => commit.subject)).toEqual(
        records.filter(record => record.subject.startsWith("needle-") && Number(record.subject.split("-")[1]) % 3 !== 0)
          .map(record => record.subject)
      );

      const calendarDay = (timestamp: number) => {
        const date = new Date(timestamp * 1000);
        return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
      };
      const committedDay = calendarDay(records[0]!.committed);
      const dated = await client.readCommitHistory(ordered.path, {
        scope, limit: 100, search: { since: committedDay, until: committedDay }
      });
      expect(dated.commits.map(commit => commit.subject)).toEqual(
        records.filter(record => calendarDay(record.committed) === committedDay).slice(0, 100).map(record => record.subject)
      );
      const authoredDay = calendarDay(records[0]!.authored);
      expect((await client.readCommitHistory(ordered.path, {
        scope, search: { since: authoredDay, until: authoredDay }
      })).commits.map(commit => commit.subject)).toEqual(["root"]);
    } finally {
      await ordered.dispose();
    }
  }, 30_000);

  it("提交者时间倒置时仍保证子提交先于父提交，并按同一顺序分页", async () => {
    const ordered = await createTemporaryDirectoryFixture("history-parent-order");
    try {
      await git(["init", "-b", "main"], undefined, undefined, ordered.path);
      const base = 1_760_000_000;
      let input = "";
      for (const [index, subject, seconds] of [
        [1, "root", 400], [2, "child", 100], [3, "grandchild", 200]
      ] as const) {
        input += `commit refs/heads/main\nmark :${index}\nauthor Writer <writer@example.test> ${base + index} +0800\ncommitter Integrator <integrator@example.test> ${base + seconds} +0800\ndata ${subject.length}\n${subject}\n${index > 1 ? `from :${index - 1}\n` : ""}\n`;
      }
      await git(["fast-import", "--quiet"], undefined, input, ordered.path);
      const first = await client.readCommitHistory(ordered.path, { limit: 1 });
      const second = await client.readCommitHistory(ordered.path, {
        limit: 1, offset: first.nextOffset!, traversal: first.traversal!
      });
      const third = await client.readCommitHistory(ordered.path, {
        limit: 1, offset: second.nextOffset!, traversal: first.traversal!
      });
      expect([...first.commits, ...second.commits, ...third.commits].map(commit => commit.subject))
        .toEqual(["grandchild", "child", "root"]);
      expect(third.nextOffset).toBeUndefined();
    } finally {
      await ordered.dispose();
    }
  }, 15_000);

  it("stash 日期筛选同样使用提交者时间", () => {
    const stash = {
      ref: "stash@{0}", hash: "a".repeat(40), subject: "stash", authorName: "Writer",
      authorEmail: "writer@example.test", parentHashes: [],
      authoredAt: "2026-10-23T15:34:00+08:00",
      committedAt: "2026-11-04T11:06:00+08:00"
    };
    expect(stashMatchesHistorySearch(stash, { since: "2026-11-04", until: "2026-11-04" })).toBe(true);
    expect(stashMatchesHistorySearch(stash, { since: "2026-10-23", until: "2026-10-23" })).toBe(false);
  });

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
