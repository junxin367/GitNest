import { describe, expect, it } from "vitest";
import {
  validateFileHistory,
  validateFileHistoryCancel,
  validateFileHistoryDiff,
  validateIgnoreExecute,
  validateIgnorePreflight
} from "./file-actions-validation";

const target = { repositoryId: "repo", worktreeId: "worktree" };
const revision = "a".repeat(40);
const base = { target, queryId: "history:1", path: "目录/[test] a.ts" };

describe("file action IPC boundary", () => {
  it.each(["file", "directory", "extension"])("admits only the requested ignore scope %s", scope => {
    expect(validateIgnorePreflight({ ...base, scope, force: true })).toEqual({ target, path: base.path, scope });
  });

  it.each(["../outside", "/root", "C:/file", "a\\b", ".git/config", "x/.GIT/config", "a/./b",
    "a//b", "a/../b", "file\nnext", "", " "])("rejects unsafe file paths %j", path => {
    expect(() => validateIgnorePreflight({ target, path, scope: "file" })).toThrow();
    expect(() => validateFileHistory({ ...base, path })).toThrow();
    expect(() => validateFileHistoryDiff({ ...base, path, commitHash: revision })).toThrow();
  });

  it("preserves literal special characters and spaces", () => {
    const path = "目录/!#[literal] .txt ";
    expect(validateIgnorePreflight({ target, path, scope: "file" }).path).toBe(path);
    expect(validateFileHistory({ ...base, path }).path).toBe(path);
  });

  it("requires a supported scope and explicit boolean confirmation", () => {
    expect(() => validateIgnorePreflight({ ...base, scope: "all" })).toThrow();
    for (const confirmed of [undefined, "true", 1, null]) {
      expect(() => validateIgnoreExecute({ preflightId: "preview", confirmed })).toThrow();
    }
    expect(validateIgnoreExecute({ preflightId: "preview", confirmed: false, force: true })).toEqual({
      preflightId: "preview", confirmed: false
    });
  });

  it("pins further history pages to a full revision and bounds pagination", () => {
    expect(validateFileHistory({ ...base, originalPath: "old name.ts", offset: 50, limit: 100, revision, force: true })).toEqual({
      ...base, originalPath: "old name.ts", offset: 50, limit: 100, revision
    });
    expect(() => validateFileHistory({ ...base, offset: 1 })).toThrow();
    for (const offset of [-1, 0.5, NaN, Infinity, 100_001, "0"]) {
      expect(() => validateFileHistory({ ...base, offset, revision })).toThrow();
    }
    for (const limit of [0, 101, 0.5, "50", NaN]) {
      expect(() => validateFileHistory({ ...base, limit })).toThrow();
    }
  });

  it("requires full hashes and validates both sides of renames", () => {
    for (const value of ["HEAD", "--help", "a".repeat(39), null]) {
      expect(() => validateFileHistory({ ...base, revision: value })).toThrow();
      expect(() => validateFileHistoryDiff({ ...base, commitHash: value })).toThrow();
    }
    expect(() => validateFileHistory({ ...base, originalPath: "../old" })).toThrow();
    expect(() => validateFileHistoryDiff({ ...base, commitHash: revision, previousPath: "../old" })).toThrow();
    expect(validateFileHistoryDiff({ ...base, commitHash: revision, previousPath: "old.ts", force: true })).toEqual({
      ...base, commitHash: revision, previousPath: "old.ts"
    });
  });

  it("bounds cancellation identifiers and strips extra data", () => {
    expect(validateFileHistoryCancel({ queryId: "history:1", target })).toEqual({ queryId: "history:1" });
    for (const queryId of ["", "a".repeat(161), "a b", "a\nb", null]) {
      expect(() => validateFileHistoryCancel({ queryId })).toThrow();
      expect(() => validateFileHistory({ ...base, queryId })).toThrow();
    }
  });
});
