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
    const output = [
      "abcdef",
      "abcdef1",
      "June",
      "june@example.com",
      "2026-09-04T10:00:00+08:00",
      "Initial commit",
      "parent1 parent2",
      "HEAD -> main, tag: release,one, origin/main"
    ].join("\0") + "\0\n";

    expect(parseCommitHistory(output)).toEqual([
      {
        hash: "abcdef",
        shortHash: "abcdef1",
        authorName: "June",
        authorEmail: "june@example.com",
        authoredAt: "2026-09-04T10:00:00+08:00",
        subject: "Initial commit",
        parentHashes: ["parent1", "parent2"],
        refs: [
          "HEAD -> main",
          "tag: release,one",
          "origin/main"
        ]
      }
    ]);
  });

  it("retains remote branch names ending in HEAD and filters explicit symbolic refs", () => {
    const output = [
      "refs/remotes/origin/feature/HEAD\x1forigin/feature\x1faaa\x1f\x1f \x1f\x1f2026-10-04T00:00:00Z\x1f\x1e",
      "refs/remotes/team/origin/HEAD\x1fteam/origin\x1faaa\x1f\x1f \x1f\x1f2026-10-04T00:00:00Z\x1frefs/remotes/team/origin/main\x1e",
      "refs/remotes/origin/alias\x1forigin/alias\x1faaa\x1f\x1f \x1f\x1f2026-10-04T00:00:00Z\x1frefs/remotes/origin/main\x1e"
    ].join("\n");

    expect(parseBranches(output)).toEqual([
      expect.objectContaining({
        fullName: "refs/remotes/origin/feature/HEAD",
        name: "origin/feature",
        remote: true
      })
    ]);
  });

  it("keeps nested HEAD branches in legacy six- and seven-field records", () => {
    for (const suffix of ["", "\x1f2026-10-04T00:00:00Z"]) {
      const output =
        `refs/remotes/origin/feature/HEAD\x1forigin/feature\x1faaa\x1f\x1f \x1f${suffix}\x1e`;
      expect(parseBranches(output)).toEqual([
        expect.objectContaining({
          fullName: "refs/remotes/origin/feature/HEAD"
        })
      ]);
    }
  });

  it("parses branch-comparison side and merge-base markers", () => {
    const output =
      [
        [
          "<",
          "left123",
          "left123",
          "June",
          "june@example.com",
          "2026-09-15T10:00:00+08:00",
          "Left commit",
          "base123",
          "main"
        ].join("\0"),
        [
          ">",
          "right12",
          "right12",
          "June",
          "june@example.com",
          "2026-09-15T11:00:00+08:00",
          "Right commit",
          "base123",
          "develop"
        ].join("\0"),
        [
          "-",
          "base123",
          "base123",
          "June",
          "june@example.com",
          "2026-09-14T10:00:00+08:00",
          "Merge base",
          "",
          ""
        ].join("\0")
      ].join("\0\n") + "\0\n";

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

  it("preserves a bare primary entry without HEAD before linked worktrees", () => {
    const output = [
      "worktree D:/裸仓库/repository.git",
      "bare",
      "",
      "worktree D:/linked worktree",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      ""
    ].join("\0");

    expect(parseWorktrees(output)).toEqual([
      expect.objectContaining({
        path: "D:/裸仓库/repository.git",
        head: "",
        bare: true,
        primary: true
      }),
      expect.objectContaining({
        path: "D:/linked worktree",
        head: "abc123",
        branch: "main",
        bare: false,
        primary: false
      })
    ]);
  });

  it("still rejects a non-bare worktree whose HEAD is missing", () => {
    expect(() =>
      parseWorktrees("worktree D:/broken\0branch refs/heads/main\0\0")
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_GIT_OUTPUT" })
    );
  });
});
