import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTemporaryDirectoryFixture } from "@gitnest/testkit";
import { runProcess } from "../process/git-process-runner";
import { findGitExecutable } from "../environment/find-git-executable";
import { GitCliWorkflowClient } from "./git-workflow-client";

describe("GitCliWorkflowClient real Git workflows", () => {
  it("UI inspection omits binary diffs and does not open untracked file contents", async () => {
    const calls: readonly string[][] = [];
    const recorded = calls as string[][];
    const client = new GitCliWorkflowClient({
      executable: "unused",
      runner: async request => {
        recorded.push([...request.args]);
        const args = request.args;
        const stdout = args.includes("--absolute-git-dir") ? "Z:/gitnest-nonexistent-ui-fixture/.git\n"
          : args.includes("status") ? "M  tracked.txt\0?? nonexistent-large-untracked.bin\0"
          : args.includes("--others") ? "nonexistent-large-untracked.bin\0"
          : args.includes("--verify") ? `${"a".repeat(40)}\n`
          : args.includes("symbolic-ref") ? "main\n"
          : args.includes("show") ? `${"b".repeat(40)}\nmessage\n` : "";
        return { exitCode: 0, stdout, stderr: "", durationMs: 0 };
      }
    });
    const state = await client.inspect("Z:/gitnest-nonexistent-ui-fixture", { includeFingerprint: false });
    expect(state.hasStagedChanges).toBe(true);
    expect(state.hasUntrackedFiles).toBe(true);
    expect(state.fingerprint).toBe("");
    expect(calls.some(args => args.includes("diff"))).toBe(false);
    expect(calls.some(args => args.includes("--stage"))).toBe(false);
  });
  it("stashes literal selected paths and leaves other edits intact", async () => {
    const fixture = await repository();
    try {
      const { path, git, client } = fixture;
      await writeFile(join(path, "tracked.txt"), "edited\n");
      await writeFile(join(path, "[special] 中文.txt"), "untracked\n");
      await writeFile(join(path, "keep.txt"), "keep\n");
      await client.execute(path, { type: "create-stash", message: "任务现场", includeUntracked: true, paths: ["tracked.txt", "[special] 中文.txt"] });
      expect(await readFile(join(path, "tracked.txt"), "utf8")).toBe("base\n");
      await expect(readFile(join(path, "[special] 中文.txt"))).rejects.toMatchObject({ code: "ENOENT" });
      expect((await git(["status", "--porcelain"])).stdout).toContain("keep.txt");
      expect((await git(["stash", "list"])).stdout).toContain("任务现场");
      await git(["stash", "pop"]);
      expect(await readFile(join(path, "[special] 中文.txt"), "utf8")).toBe("untracked\n");
      expect(await readFile(join(path, "tracked.txt"), "utf8")).toBe("edited\n");
    } finally { await fixture.dispose(); }
  }, 30_000);

  it("amends staged content and preserves unstaged content", async () => {
    const fixture = await repository();
    try {
      const { path, git, client } = fixture;
      await writeFile(join(path, "tracked.txt"), "staged\n");
      await git(["add", "tracked.txt"]);
      await writeFile(join(path, "tracked.txt"), "unstaged\n");
      await client.execute(path, { type: "amend", message: "Updated subject\n\nUpdated body" });
      expect((await git(["show", "HEAD:tracked.txt"])).stdout).toBe("staged\n");
      expect(await readFile(join(path, "tracked.txt"), "utf8")).toBe("unstaged\n");
      expect((await client.inspect(path)).headMessage).toBe("Updated subject\n\nUpdated body");
    } finally { await fixture.dispose(); }
  }, 30_000);
  it.each([false, true])("rejects partial staged renames before creating a stash (include untracked=%s)", async (includeUntracked) => {
    const fixture = await repository();
    try {
      const { path, git, client } = fixture;
      await writeFile(join(path, "keep.txt"), "base\n");
      await git(["add", "keep.txt"]); await git(["commit", "-m", "another tracked file"]);
      await git(["mv", "tracked.txt", "renamed 中文.txt"]);
      await writeFile(join(path, "renamed 中文.txt"), "base\nedited\n");
      await writeFile(join(path, "keep.txt"), "staged\n");
      await git(["add", "keep.txt"]);
      await writeFile(join(path, "keep.txt"), "unstaged\n");
      await writeFile(join(path, "[selected].txt"), "selected untracked\n");
      await writeFile(join(path, "unselected.txt"), "unselected untracked\n");
      const before = {
        index: (await git(["ls-files", "--stage", "-z"])).stdout,
        status: (await git(["status", "--porcelain=v1", "-z"])).stdout,
        stash: (await git(["stash", "list"])).stdout,
        indexBytes: await readFile(join(path, ".git", "index"))
      };
      expect((await client.inspect(path)).partialStashBlockedPaths).toEqual(["tracked.txt"]);
      const paths = ["tracked.txt", "renamed 中文.txt", ...(includeUntracked ? ["[selected].txt"] : [])];
      await expect(client.execute(path, { type: "create-stash", includeUntracked, paths }))
        .rejects.toMatchObject({ code: "INVALID_REQUEST", message: expect.stringContaining("保存全部修改") });
      expect(await readFile(join(path, ".git", "index"))).toEqual(before.indexBytes);
      expect((await git(["ls-files", "--stage", "-z"])).stdout).toBe(before.index);
      expect((await git(["status", "--porcelain=v1", "-z"])).stdout).toBe(before.status);
      expect((await git(["stash", "list"])).stdout).toBe(before.stash);
      expect(await readFile(join(path, "renamed 中文.txt"), "utf8")).toBe("base\nedited\n");
      expect(await readFile(join(path, "keep.txt"), "utf8")).toBe("unstaged\n");
      expect(await readFile(join(path, "unselected.txt"), "utf8")).toBe("unselected untracked\n");
      expect(await readFile(join(path, "[selected].txt"), "utf8")).toBe("selected untracked\n");
    } finally { await fixture.dispose(); }
  }, 30_000);
  it("rejects a selected staged deletion but lets unrelated partial stashes preserve that deletion", async () => {
    const fixture = await repository();
    try {
      const { path, git, client } = fixture;
      await git(["rm", "tracked.txt"]);
      expect((await client.inspect(path)).partialStashBlockedPaths).toEqual(["tracked.txt"]);
      await expect(client.execute(path, { type: "create-stash", includeUntracked: true, paths: ["tracked.txt"] }))
        .rejects.toMatchObject({ code: "INVALID_REQUEST" });
      expect((await git(["stash", "list"])).stdout).toBe("");
      await writeFile(join(path, "selected.txt"), "selected\n");
      await writeFile(join(path, "keep.txt"), "keep\n");
      const index = (await git(["ls-files", "--stage", "-z"])).stdout;
      await client.execute(path, { type: "create-stash", includeUntracked: true, paths: ["selected.txt"] });
      expect((await git(["ls-files", "--stage", "-z"])).stdout).toBe(index);
      await expect(readFile(join(path, "selected.txt"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(path, "keep.txt"), "utf8")).toBe("keep\n");
      expect((await git(["status", "--porcelain"])).stdout).toContain("D  tracked.txt");
    } finally { await fixture.dispose(); }
  }, 30_000);
  it.each([false, true])("whole-worktree stash still saves and restores staged rename and content (include untracked=%s)", async (includeUntracked) => {
    const fixture = await repository();
    try {
      const { path, git, client } = fixture;
      await git(["mv", "tracked.txt", "renamed name.txt"]);
      await writeFile(join(path, "renamed name.txt"), "base\nedited\n");
      await writeFile(join(path, "untracked.txt"), "new\n");
      const index = (await git(["ls-files", "--stage", "-z"])).stdout;
      await client.execute(path, { type: "create-stash", includeUntracked });
      expect(await readFile(join(path, "tracked.txt"), "utf8")).toBe("base\n");
      await expect(readFile(join(path, "renamed name.txt"))).rejects.toMatchObject({ code: "ENOENT" });
      expect((await git(["diff", "--cached", "--name-only"])).stdout).toBe("");
      if (includeUntracked) await expect(readFile(join(path, "untracked.txt"))).rejects.toMatchObject({ code: "ENOENT" });
      else expect(await readFile(join(path, "untracked.txt"), "utf8")).toBe("new\n");
      await git(["stash", "pop", "--index"]);
      expect((await git(["ls-files", "--stage", "-z"])).stdout).toBe(index);
      expect(await readFile(join(path, "renamed name.txt"), "utf8")).toBe("base\nedited\n");
      await expect(readFile(join(path, "tracked.txt"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(path, "untracked.txt"), "utf8")).toBe("new\n");
    } finally { await fixture.dispose(); }
  }, 30_000);
  it("stashes all tracked edits without including untracked files unless requested", async () => {
    const fixture = await repository();
    try {
      const { path, git, client } = fixture;
      await writeFile(join(path, "tracked.txt"), "edited\n");
      await writeFile(join(path, "new.txt"), "new\n");
      await client.execute(path, { type: "create-stash", message: "tracked" });
      expect(await readFile(join(path, "new.txt"), "utf8")).toBe("new\n");
      expect(await readFile(join(path, "tracked.txt"), "utf8")).toBe("base\n");
      await client.execute(path, { type: "create-stash", includeUntracked: true });
      expect((await client.inspect(path)).changedPaths).toEqual([]);
      expect((await git(["stash", "list"])).stdout.trim().split("\n")).toHaveLength(2);
    } finally { await fixture.dispose(); }
  }, 30_000);
  it("reports known remote reachability and rejects merge replay without a mainline", async () => {
    const fixture = await repository();
    try {
      const { path, git, client } = fixture;
      await git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
      expect((await client.inspect(path)).remoteBranchesContainingHead).toEqual(["origin/main"]);
      await git(["switch", "-c", "feature"]);
      await writeFile(join(path, "feature.txt"), "feature\n");
      await git(["add", "."]); await git(["commit", "-m", "feature"]);
      await git(["switch", "main"]); await git(["merge", "--no-ff", "-m", "merge", "feature"]);
      const merged = await client.inspect(path);
      expect(merged.parentCount).toBe(2);
      await expect(client.validateCommit(path, merged.head!)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    } finally { await fixture.dispose(); }
  }, 30_000);

  it.each(["soft", "mixed"] as const)("undo %s preserves file content and the expected staging state", async (mode) => {
    const fixture = await repository();
    try {
      const { path, git, client } = fixture;
      const initial = (await client.inspect(path)).head;
      await writeFile(join(path, "tracked.txt"), "next\n");
      await git(["add", "."]); await git(["commit", "-m", "next"]);
      await client.execute(path, { type: "undo-commit", mode });
      const state = await client.inspect(path);
      expect(state.head).toBe(initial);
      expect(state.hasStagedChanges).toBe(mode === "soft");
      expect(await readFile(join(path, "tracked.txt"), "utf8")).toBe("next\n");
    } finally { await fixture.dispose(); }
  }, 30_000);

  it("fingerprints edits to already dirty and untracked files", async () => {
    const fixture = await repository();
    try {
      const { path, client } = fixture;
      await writeFile(join(path, "tracked.txt"), "one\n");
      await writeFile(join(path, "new.txt"), "one\n");
      const first = await client.inspect(path);
      await writeFile(join(path, "tracked.txt"), "two\n");
      const second = await client.inspect(path);
      expect(first.changedPaths).toEqual(second.changedPaths);
      expect(first.fingerprint).not.toBe(second.fingerprint);
      await writeFile(join(path, "new.txt"), "two\n");
      expect((await client.inspect(path)).fingerprint).not.toBe(second.fingerprint);
    } finally { await fixture.dispose(); }
  }, 30_000);

  it("cherry-picks and reverts a selected commit", async () => {
    const fixture = await repository();
    try {
      const { path, git, client } = fixture;
      await git(["switch", "-c", "feature"]);
      await writeFile(join(path, "feature.txt"), "feature\n");
      await git(["add", "."]); await git(["commit", "-m", "feature"]);
      const commitHash = (await git(["rev-parse", "HEAD"])).stdout.trim();
      await git(["switch", "main"]);
      await client.validateCommit(path, commitHash);
      await client.execute(path, { type: "cherry-pick", commitHash });
      expect(await readFile(join(path, "feature.txt"), "utf8")).toBe("feature\n");
      const applied = (await client.inspect(path)).head!;
      await client.execute(path, { type: "revert", commitHash: applied });
      expect((await git(["ls-files"])).stdout).not.toContain("feature.txt");
    } finally { await fixture.dispose(); }
  }, 30_000);

  for (const operation of ["merge", "rebase", "cherry-pick", "revert"] as const) {
    for (const action of ["continue", "abort"] as const) {
      it(`${operation} conflict ${action} works in a linked Worktree without an editor`, async () => {
        const fixture = await repository();
        try {
          const { path, git, client } = fixture;
          await git(["switch", "-c", "feature"]);
          await writeFile(join(path, "tracked.txt"), "feature\n");
          await git(["add", "."]); await git(["commit", "-m", "feature"]);
          const feature = (await git(["rev-parse", "HEAD"])).stdout.trim();
          await git(["switch", "main"]);
          await writeFile(join(path, "tracked.txt"), "main\n");
          await git(["add", "."]); await git(["commit", "-m", "main"]);
          const linked = join(fixture.root, "linked");
          await git(["worktree", "add", "-b", "linked", linked]);
          const initial = (await client.inspect(linked)).head;
          const startArgs = operation === "merge" ? ["merge", "feature"]
            : operation === "rebase" ? ["rebase", "feature"]
            : [operation, feature];
          const result = await git(startArgs, linked, true);
          expect(result.exitCode).not.toBe(0);
          const conflicted = await client.inspect(linked);
          expect(conflicted.operation).toBe(operation);
          expect(conflicted.conflictedPaths).toEqual(["tracked.txt"]);
          if (action === "continue") {
            await writeFile(join(linked, "tracked.txt"), "resolved\n");
            await client.execute(linked, { type: "mark-resolved", paths: ["tracked.txt"] });
            expect((await client.inspect(linked)).conflictedPaths).toEqual([]);
          }
          await client.execute(linked, { type: action });
          const finished = await client.inspect(linked);
          expect(finished.operation).toBeNull();
          expect(finished.conflictedPaths).toEqual([]);
          if (action === "abort") expect(finished.head).toBe(initial);
          else expect(await readFile(join(linked, "tracked.txt"), "utf8")).toBe("resolved\n");
          expect((await client.inspect(path)).head).toBe(initial);
        } finally { await fixture.dispose(); }
      }, 45_000);
    }
  }

  it("rejects cancellation before any mutation", async () => {
    const fixture = await repository();
    try {
      const controller = new AbortController(); controller.abort();
      await expect(fixture.client.execute(fixture.path, { type: "amend", message: "cancel" }, { signal: controller.signal })).rejects.toMatchObject({ code: "COMMAND_CANCELLED" });
      expect((await fixture.client.inspect(fixture.path)).headMessage).toBe("initial");
    } finally { await fixture.dispose(); }
  }, 30_000);
  for (const operation of ["rebase", "cherry-pick", "revert"] as const) {
    it(`${operation} skips a conflicted current commit and leaves no active operation`, async () => {
      const fixture = await conflictRepository(operation);
      try {
        const before = await fixture.client.inspect(fixture.path);
        expect(before.currentReplay).toMatchObject({ isEmpty: false, canSkip: true, canKeepEmpty: false });
        await fixture.client.execute(fixture.path, { type: "skip" });
        const after = await fixture.client.inspect(fixture.path);
        expect(after.operation).toBeNull();
        expect(after.changedPaths).toEqual([]);
        expect(after.head).toBe(before.head);
      } finally { await fixture.dispose(); }
    }, 45_000);
    it(`${operation} detects a resolution with no changes, blocks repeat continue, and preserves an explicit empty commit`, async () => {
      const fixture = await conflictRepository(operation);
      try {
        const { path, git, client } = fixture;
        await git(["checkout", "--ours", "tracked.txt"]);
        await client.execute(path, { type: "mark-resolved", paths: ["tracked.txt"] });
        const before = await client.inspect(path);
        expect(before.currentReplay).toMatchObject({ isEmpty: true, canSkip: true, canKeepEmpty: true });
        await expect(client.execute(path, { type: "continue" })).rejects.toThrow("保留空提交");
        await client.execute(path, { type: "keep-empty" });
        const after = await client.inspect(path);
        expect(after.operation).toBeNull();
        expect(after.head).not.toBe(before.head);
        expect((await git(["diff", `${before.head}..HEAD`])).stdout).toBe("");
        expect(after.headMessage).toBe(operation === "revert"
          ? `Revert "feature"\n\nThis reverts commit ${fixture.feature}.`
          : operation === "rebase" ? "main" : "feature");
        if (operation !== "revert") {
          expect((await git(["show", "-s", "--format=%an <%ae> %aI", "HEAD"])).stdout)
            .toBe((await git(["show", "-s", "--format=%an <%ae> %aI", before.currentReplay!.commitHash])).stdout);
        }
      } finally { await fixture.dispose(); }
    }, 45_000);
  }
  it("keeps one empty commit then resumes the remaining cherry-pick sequence", async () => {
    const fixture = await repository();
    try {
      const { path, git, client } = fixture;
      await git(["switch", "-c", "feature"]);
      await writeFile(join(path, "tracked.txt"), "feature\n");
      await git(["add", "."]); await git(["commit", "-m", "feature"]);
      const first = (await git(["rev-parse", "HEAD"])).stdout.trim();
      await writeFile(join(path, "second.txt"), "second\n");
      await git(["add", "."]); await git(["commit", "-m", "second"]);
      const second = (await git(["rev-parse", "HEAD"])).stdout.trim();
      await git(["switch", "main"]);
      await git(["cherry-pick", first]);
      const before = (await client.inspect(path)).head;
      expect((await git(["cherry-pick", first, second], path, true)).exitCode).not.toBe(0);
      expect((await client.inspect(path)).currentReplay?.isEmpty).toBe(true);
      await client.execute(path, { type: "keep-empty" });
      expect((await client.inspect(path)).operation).toBeNull();
      expect((await git(["rev-list", "--count", `${before}..HEAD`])).stdout.trim()).toBe("2");
      expect(await readFile(join(path, "second.txt"), "utf8")).toBe("second\n");
    } finally { await fixture.dispose(); }
  }, 45_000);
  it("detects a redundant rebase commit stopped by --empty=stop and preserves its original author", async () => {
    const fixture = await repository();
    try {
      const { path, git, client } = fixture;
      await git(["switch", "-c", "feature"]);
      await writeFile(join(path, "tracked.txt"), "same\n");
      await git(["add", "."]); await git(["commit", "-m", "upstream"]);
      await git(["switch", "main"]);
      await writeFile(join(path, "tracked.txt"), "same\n");
      await git(["add", "."]); await git(["commit", "--author", "Original Author <original@example.test>", "-m", "local"]);
      const original = (await git(["rev-parse", "HEAD"])).stdout.trim();
      expect((await git(["rebase", "--reapply-cherry-picks", "--empty=stop", "feature"], path, true)).exitCode).not.toBe(0);
      expect((await client.inspect(path)).currentReplay).toMatchObject({ commitHash: original, isEmpty: true, canKeepEmpty: true });
      await client.execute(path, { type: "keep-empty" });
      expect((await client.inspect(path)).operation).toBeNull();
      expect((await git(["show", "-s", "--format=%an <%ae>", "HEAD"])).stdout.trim()).toBe("Original Author <original@example.test>");
    } finally { await fixture.dispose(); }
  }, 45_000);
  it("skips an empty cherry-pick and proceeds to the next commit without creating an empty record", async () => {
    const fixture = await repository();
    try {
      const { path, git, client } = fixture;
      await git(["switch", "-c", "feature"]);
      await writeFile(join(path, "one.txt"), "one\n");
      await git(["add", "."]); await git(["commit", "-m", "one"]);
      const first = (await git(["rev-parse", "HEAD"])).stdout.trim();
      await writeFile(join(path, "two.txt"), "two\n");
      await git(["add", "."]); await git(["commit", "-m", "two"]);
      const second = (await git(["rev-parse", "HEAD"])).stdout.trim();
      await git(["switch", "main"]); await git(["cherry-pick", first]);
      const before = (await client.inspect(path)).head;
      expect((await git(["cherry-pick", first, second], path, true)).exitCode).not.toBe(0);
      await client.execute(path, { type: "skip" });
      expect((await client.inspect(path)).operation).toBeNull();
      expect((await git(["rev-list", "--count", `${before}..HEAD`])).stdout.trim()).toBe("1");
      expect(await readFile(join(path, "two.txt"), "utf8")).toBe("two\n");
    } finally { await fixture.dispose(); }
  }, 45_000);
  it("blocks keeping a staged resolution as empty and honours cancellation before skip", async () => {
    const fixture = await conflictRepository("revert");
    try {
      await writeFile(join(fixture.path, "tracked.txt"), "resolved\n");
      await fixture.git(["add", "."]);
      expect((await fixture.client.inspect(fixture.path)).currentReplay?.isEmpty).toBe(false);
      await expect(fixture.client.execute(fixture.path, { type: "keep-empty" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      const controller = new AbortController(); controller.abort();
      await expect(fixture.client.execute(fixture.path, { type: "skip" }, { signal: controller.signal })).rejects.toMatchObject({ code: "COMMAND_CANCELLED" });
      expect(await readFile(join(fixture.path, "tracked.txt"), "utf8")).toBe("resolved\n");
      expect((await fixture.client.inspect(fixture.path)).operation).toBe("revert");
    } finally { await fixture.dispose(); }
  }, 45_000);
  it("offers skip but not keep-empty for the legacy rebase apply backend", async () => {
    const fixture = await conflictRepository("rebase");
    try {
      const { path, git, client } = fixture;
      await git(["rebase", "--abort"]);
      expect((await git(["rebase", "--apply", "feature"], path, true)).exitCode).not.toBe(0);
      expect((await client.inspect(path)).currentReplay).toMatchObject({ canSkip: true, canKeepEmpty: false });
      await git(["checkout", "--ours", "tracked.txt"]); await git(["add", "."]);
      expect((await client.inspect(path)).currentReplay).toMatchObject({ isEmpty: true, canSkip: true, canKeepEmpty: false });
      await expect(client.execute(path, { type: "keep-empty" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      await client.execute(path, { type: "skip" });
      expect((await client.inspect(path)).operation).toBeNull();
    } finally { await fixture.dispose(); }
  }, 45_000);
  it("rejects skip and keep-empty for merge conflicts", async () => {
    const fixture = await conflictRepository("merge");
    try {
      expect((await fixture.client.inspect(fixture.path)).currentReplay).toBeNull();
      await expect(fixture.client.execute(fixture.path, { type: "skip" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      await expect(fixture.client.execute(fixture.path, { type: "keep-empty" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      expect((await fixture.client.inspect(fixture.path)).conflictedPaths).toEqual(["tracked.txt"]);
      await fixture.client.execute(fixture.path, { type: "abort" });
    } finally { await fixture.dispose(); }
  }, 45_000);
  it("does not mistake a manually committed rebase resolution for an empty replay", async () => {
    const fixture = await conflictRepository("rebase");
    try {
      await writeFile(join(fixture.path, "tracked.txt"), "resolved\n");
      await fixture.git(["add", "."]); await fixture.git(["commit", "-m", "manual resolution"]);
      expect((await fixture.client.inspect(fixture.path)).currentReplay).toBeNull();
      await expect(fixture.client.execute(fixture.path, { type: "keep-empty" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      await fixture.client.execute(fixture.path, { type: "continue" });
      expect((await fixture.client.inspect(fixture.path)).operation).toBeNull();
    } finally { await fixture.dispose(); }
  }, 45_000);
  it("guards unrelated tracked and untracked changes before skip and still permits abort", async () => {
    const fixture = await conflictRepository("cherry-pick");
    try {
      await writeFile(join(fixture.path, "untracked.txt"), "preserve\n");
      expect((await fixture.client.inspect(fixture.path)).currentReplay?.canSkip).toBe(false);
      await expect(fixture.client.execute(fixture.path, { type: "skip" })).rejects.toThrow("未跟踪");
      await fixture.git(["add", "untracked.txt"]);
      expect((await fixture.client.inspect(fixture.path)).currentReplay?.canSkip).toBe(false);
      await expect(fixture.client.execute(fixture.path, { type: "skip" })).rejects.toThrow("范围之外");
      await fixture.git(["reset", "--", "untracked.txt"]);
      await fixture.client.execute(fixture.path, { type: "abort" });
      expect(await readFile(join(fixture.path, "untracked.txt"), "utf8")).toBe("preserve\n");
    } finally { await fixture.dispose(); }
  }, 45_000);
  it.each(["skip", "keep-empty"] as const)("rejects %s outside a replay without changing HEAD", async type => {
    const fixture = await repository();
    try {
      const before = (await fixture.client.inspect(fixture.path)).head;
      await expect(fixture.client.execute(fixture.path, { type })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      expect((await fixture.client.inspect(fixture.path)).head).toBe(before);
    } finally { await fixture.dispose(); }
  }, 30_000);
  it("does not report a stash no-op as a successful save", async () => {
    const fixture = await repository();
    try {
      await expect(fixture.client.execute(fixture.path, { type: "create-stash" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    } finally { await fixture.dispose(); }
  }, 30_000);
  it("blocks git am explicitly instead of presenting incorrect rebase controls", async () => {
    const fixture = await repository();
    try {
      const { path, git, client } = fixture;
      await git(["switch", "-c", "patch"]);
      await writeFile(join(path, "tracked.txt"), "patch\n");
      await git(["add", "."]); await git(["commit", "-m", "patch"]);
      const patch = (await git(["format-patch", "-1", "--stdout"])).stdout;
      const patchPath = join(fixture.root, "change.patch");
      await writeFile(patchPath, patch);
      await git(["switch", "main"]);
      await writeFile(join(path, "tracked.txt"), "main\n");
      await git(["add", "."]); await git(["commit", "-m", "main"]);
      expect((await git(["am", patchPath], path, true)).exitCode).not.toBe(0);
      await expect(client.inspect(path)).rejects.toMatchObject({ code: "INVALID_REQUEST", message: expect.stringContaining("git am") });
      await git(["am", "--abort"]);
      expect((await client.inspect(path)).operation).toBeNull();
    } finally { await fixture.dispose(); }
  }, 30_000);
});

async function conflictRepository(operation: "merge" | "rebase" | "cherry-pick" | "revert") {
  const fixture = await repository();
  const { path, git } = fixture;
  await git(["switch", "-c", "feature"]);
  await writeFile(join(path, "tracked.txt"), "feature\n");
  await git(["add", "."]); await git(["commit", "-m", "feature"]);
  const feature = (await git(["rev-parse", "HEAD"])).stdout.trim();
  await git(["switch", "main"]);
  await writeFile(join(path, "tracked.txt"), "main\n");
  await git(["add", "."]); await git(["commit", "-m", "main"]);
  expect((await git([operation, operation === "rebase" ? "feature" : feature], path, true)).exitCode).not.toBe(0);
  return { ...fixture, feature };
}

async function repository() {
  const fixture = await createTemporaryDirectoryFixture("gitnest-workflow-");
  const root = fixture.path;
  const path = join(root, "repository");
  await mkdir(path);
  const executable = await findGitExecutable();
  const git = (args: string[], cwd = path, allowFailure = false) => runProcess({
    executable, args, cwd, allowFailure, writeIntent: true, timeoutMs: 30_000,
    environment: { GIT_CONFIG_GLOBAL: join(root, "missing-global-config"), GIT_CONFIG_NOSYSTEM: "1", GIT_EDITOR: "true" }
  });
  await git(["init", "-b", "main"]);
  await git(["config", "user.name", "Workflow Test"]);
  await git(["config", "user.email", "workflow@example.test"]);
  await git(["config", "core.autocrlf", "false"]);
  await git(["config", "commit.gpgsign", "false"]);
  await writeFile(join(path, "tracked.txt"), "base\n");
  await git(["add", "."]); await git(["commit", "-m", "initial"]);
  const client = new GitCliWorkflowClient({
    runner: request => runProcess({
      ...request,
      environment: { ...request.environment, GIT_CONFIG_GLOBAL: join(root, "missing-global-config"), GIT_CONFIG_NOSYSTEM: "1" }
    })
  });
  return { ...fixture, root, path, git, client };
}
