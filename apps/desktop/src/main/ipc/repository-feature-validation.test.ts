import { describe, expect, it } from "vitest";
import {
  featureBoolean,
  featureHash,
  featureTarget,
  validateManagementCommand,
  validateRepositoryCreation,
  validateWorkflowCommand
} from "./repository-feature-validation";

const target = { repositoryId: "repo", worktreeId: "linked" };

describe("new repository operation IPC boundary", () => {
  it.each([null, [], {}, { repositoryId: "repo", worktreeId: "" },
    { repositoryId: "repo\nother", worktreeId: "linked" }])(
    "rejects malformed targets before admitting a write: %j", (value) => {
      expect(() => featureTarget(value)).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));
    });

  it.each(["true", 1, undefined, null])("requires explicit boolean confirmation: %j", value => {
    expect(() => featureBoolean(value)).toThrow();
  });

  it.each(["../outside", "C:\\outside", "\\\\host\\file", ".git/config", "a/../../outside"])(
    "rejects out-of-worktree file paths: %s", path => {
      expect(() => validateWorkflowCommand({ target, type: "mark-resolved", paths: [path] })).toThrow();
    });

  it("keeps user messages and literal filenames intact and strips unrelated options", () => {
    expect(validateWorkflowCommand({
      target, type: "create-stash", message: "临时保存\n说明", paths: ["src/[test].ts"],
      includeUntracked: true, force: true
    })).toEqual({
      target, type: "create-stash", message: "临时保存\n说明",
      paths: ["src/[test].ts"], includeUntracked: true
    });
  });

  it("rejects unsupported destructive modes and malformed revisions", () => {
    expect(() => validateWorkflowCommand({ target, type: "undo-commit", mode: "hard" })).toThrow();
    expect(() => validateWorkflowCommand({ target, type: "reset-hard" })).toThrow();
    for (const hash of ["HEAD", "--help", "abc", "a".repeat(65)]) expect(() => featureHash(hash)).toThrow();
    expect(featureHash("a".repeat(40))).toBe("a".repeat(40));
    expect(featureHash("b".repeat(64))).toBe("b".repeat(64));
  });
  it.each(["skip", "keep-empty"] as const)("admits %s only as an explicit workflow action and strips client-supplied safety overrides", type => {
    expect(validateWorkflowCommand({
      target, type, operation: "merge", canSkip: true, canKeepEmpty: true, force: true,
      commitHash: "a".repeat(40)
    })).toEqual({ target, type });
    expect(() => validateWorkflowCommand({ type })).toThrow();
  });

  it("does not infer truthy booleans or silently expand an empty file selection", () => {
    expect(() => validateWorkflowCommand({ target, type: "create-stash", includeUntracked: "false" })).toThrow();
    expect(() => validateWorkflowCommand({ target, type: "create-stash", paths: [] })).toThrow();
    expect(() => validateWorkflowCommand({ target, type: "mark-resolved", paths: [] })).toThrow();
  });

  it("limits management operations to their explicit action and fields", () => {
    expect(validateManagementCommand({
      target, action: { type: "tag-push", name: "v1", remote: "origin", force: true }
    })).toEqual({ target, action: { type: "tag-push", name: "v1", remote: "origin" } });
    expect(() => validateManagementCommand({ target, action: { type: "tag-delete-remote", name: "v1" } })).toThrow();
  });

  it("requires a clone URL and destination and disallows non-creation commands", () => {
    expect(() => validateRepositoryCreation({ kind: "clone", destination: "C:\\repos\\new" })).toThrow();
    expect(() => validateRepositoryCreation({ kind: "init", destination: "" })).toThrow();
    expect(() => validateRepositoryCreation({ kind: "clean", destination: "C:\\repos" })).toThrow();
    expect(validateRepositoryCreation({
      kind: "init", destination: "C:\\repos\\new", initialBranch: "main", force: true
    })).toEqual({ kind: "init", destination: "C:\\repos\\new", initialBranch: "main" });
  });
});
