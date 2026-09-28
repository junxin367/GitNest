import { describe, expect, it } from "vitest";

import { parseBranches } from "./branches";
import {
  parseComparedCommitHistory,
  parseCommitHistory
} from "./history";
import { parseStashList } from "./stashes";
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

  it("parses branch-comparison side and merge-base markers", () => {
    const output = [
      "<\x1fleft123\x1fleft123\x1fJune\x1fjune@example.com\x1f2026-09-15T10:00:00+08:00\x1fLeft commit\x1fbase123\x1fmain\x1e",
      "\n>\x1fright12\x1fright12\x1fJune\x1fjune@example.com\x1f2026-09-15T11:00:00+08:00\x1fRight commit\x1fbase123\x1fdevelop\x1e",
      "\n-\x1fbase123\x1fbase123\x1fJune\x1fjune@example.com\x1f2026-09-14T10:00:00+08:00\x1fMerge base\x1f\x1f\x1e"
    ].join("");

    expect(parseComparedCommitHistory(output)).toEqual([
      expect.objectContaining({
        hash: "left123",
        comparisonSide: "left"
      }),
      expect.objectContaining({
        hash: "right12",
        comparisonSide: "right"
      }),
      expect.objectContaining({
        hash: "base123",
        comparisonSide: "base"
      })
    ]);
  });

  it("parses stash metadata with its exact reflog selector and base commit", () => {
    const output =
      "stash@{0}\0" +
      "0123456789abcdef0123456789abcdef01234567\0" +
      "June\0" +
      "june@example.com\0" +
      "2026-09-16T10:00:00+08:00\0" +
      "On main: work in progress\0" +
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\0\0";

    expect(parseStashList(output)).toEqual([
      {
        ref: "stash@{0}",
        hash: "0123456789abcdef0123456789abcdef01234567",
        authorName: "June",
        authorEmail: "june@example.com",
        authoredAt: "2026-09-16T10:00:00+08:00",
        subject: "On main: work in progress",
        parentHashes: [
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        ],
        baseHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    ]);
  });

  it("rejects stash object ids between the complete SHA-1 and SHA-256 lengths", () => {
    for (const length of [41, 52, 63]) {
      const output =
        `stash@{0}\0${"a".repeat(length)}\0` +
        "June\0" +
        "june@example.com\0" +
        "2026-09-16T10:00:00+08:00\0" +
        "On main: work in progress\0" +
        `${"b".repeat(40)}\0\0`;

      expect(() => parseStashList(output)).toThrowError(
        expect.objectContaining({
          code: "INVALID_GIT_OUTPUT"
        })
      );
    }
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
