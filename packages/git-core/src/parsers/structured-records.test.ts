import { describe, expect, it } from "vitest";

import { parseBranches } from "./branches";
import { parseCommitHistory } from "./history";
import { parseWorktrees } from "./worktrees";

describe("structured Git parsers", () => {
  it("parses local and remote branches", () => {
    const output = [
      "refs/heads/main\x1fmain\x1faaa\x1forigin/main\x1f*\x1fD:/repo\x1f2026-09-05T10:00:00+08:00\x1e",
      "\nrefs/remotes/origin/main\x1forigin/main\x1fbbb\x1f\x1f \x1f\x1f2026-09-05T10:00:00+08:00\x1e",
      "\nrefs/remotes/origin/HEAD\x1forigin/HEAD\x1fbbb\x1f\x1f \x1f\x1f2026-09-05T10:00:00+08:00\x1e"
    ].join("");

    expect(parseBranches(output)).toEqual([
      {
        fullName: "refs/heads/main",
        name: "main",
        head: "aaa",
        upstream: "origin/main",
        current: true,
        remote: false,
        worktreePath: "D:/repo",
        updatedAt: "2026-09-05T10:00:00+08:00"
      },
      {
        fullName: "refs/remotes/origin/main",
        name: "origin/main",
        head: "bbb",
        current: false,
        remote: true,
        updatedAt: "2026-09-05T10:00:00+08:00"
      }
    ]);
  });

  it("parses commit records", () => {
    const output =
      "abcdef\x1fabcdef1\x1fJune\x1fjune@example.com\x1f2026-09-04T10:00:00+08:00\x1fInitial commit\x1fparent1 parent2\x1fHEAD -> main, origin/main\x1e";

    expect(parseCommitHistory(output)).toEqual([
      {
        hash: "abcdef",
        shortHash: "abcdef1",
        authorName: "June",
        authorEmail: "june@example.com",
        authoredAt: "2026-09-04T10:00:00+08:00",
        subject: "Initial commit",
        parentHashes: ["parent1", "parent2"],
        refs: ["HEAD -> main", "origin/main"]
      }
    ]);
  });

  it("parses primary, linked, locked, and prunable worktrees", () => {
    const output = [
      "worktree D:/repo",
      "HEAD aaa",
      "branch refs/heads/main",
      "",
      "worktree D:/workspace/feature",
      "HEAD bbb",
      "detached",
      "locked active task",
      "prunable gitdir file points to non-existent location",
      "",
      ""
    ].join("\0");

    expect(parseWorktrees(output)).toEqual([
      {
        path: "D:/repo",
        head: "aaa",
        branch: "main",
        bare: false,
        detached: false,
        locked: false,
        prunable: false,
        primary: true
      },
      {
        path: "D:/workspace/feature",
        head: "bbb",
        bare: false,
        detached: true,
        locked: true,
        lockReason: "active task",
        prunable: true,
        pruneReason: "gitdir file points to non-existent location",
        primary: false
      }
    ]);
  });
});
