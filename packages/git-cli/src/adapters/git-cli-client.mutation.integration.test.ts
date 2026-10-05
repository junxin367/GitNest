import { spawn } from "node:child_process";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  rmdir,
  unlink,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createTemporaryDirectoryFixture
} from "@gitnest/testkit";

import { GitCliClient } from "./git-cli-client";
import { RepositoryMutationService } from "../../../application/src/repository/repository-mutation-service";

describe("GitCliClient mutation integration", () => {
  const client = new GitCliClient();

  for (const operation of ["stage", "discard", "unstage"] as const) {
    for (const recreateOriginal of [false, true]) {
      it(`handles ${operation} on a staged rename${recreateOriginal ? " with an independently recreated original path" : ""}`, async () => {
        const fixture = await createMutationRepository();
        const path = fixture.repositoryPath;
        const beforePath = join(path, "rename me.txt");
        const afterPath = join(path, "renamed.txt");
        try {
          await runGit(path, ["config", "core.autocrlf", "false"]);
          await rename(beforePath, afterPath);
          await runGit(path, ["add", "-A"]);
          await writeFile(afterPath, "rename\nedited\n");
          if (recreateOriginal) {
            await writeFile(beforePath, "independent file\n");
          }
          expect(
            (await client.readRepositorySnapshot(path)).changes
          ).toContainEqual(expect.objectContaining({
            path: "renamed.txt",
            originalPath: "rename me.txt",
            indexStatus: "R",
            worktreeStatus: "M"
          }));
          const service = new RepositoryMutationService({
            async runWorktreeMutation(_target, _kind, action) {
              return { operationId: "rename", result: await action(path) };
            }
          }, client, client);
          await service[operation](
            { repositoryId: "repo", worktreeId: "wt" },
            operation === "unstage"
              ? ["renamed.txt", "rename me.txt"]
              : ["renamed.txt"]
          );
          expect(await readFile(afterPath, "utf8")).toBe(
            operation === "discard" ? "rename\n" : "rename\nedited\n"
          );
          if (recreateOriginal) {
            expect(await readFile(beforePath, "utf8")).toBe("independent file\n");
          }
          const snapshot = await client.readRepositorySnapshot(path);
          const indexed = (await runGit(path, ["ls-files"])).stdout;
          if (operation === "unstage") {
            expect(snapshot.staged).toBe(0);
            expect(indexed).toContain("rename me.txt");
            expect(indexed).not.toContain("renamed.txt");
          } else {
            expect(snapshot.unstaged).toBe(0);
            expect(snapshot.untracked).toBe(recreateOriginal ? 1 : 0);
            expect(indexed).not.toContain("rename me.txt");
            expect((await runGit(path, ["show", ":renamed.txt"])).stdout).toBe(
              operation === "stage" ? "rename\nedited\n" : "rename\n"
            );
          }
        } finally {
          await fixture.dispose();
        }
      });
    }
  }

  it("stages and unstages exact renamed, leading-dash, and non-ASCII paths", async () => {
    const fixture = await createMutationRepository();

    try {
      await appendFile(
        join(fixture.repositoryPath, "tracked.txt"),
        "changed\n",
        "utf8"
      );
      await rename(
        join(fixture.repositoryPath, "rename me.txt"),
        join(fixture.repositoryPath, "renamed 文件.txt")
      );
      await writeFile(
        join(fixture.repositoryPath, "-leading file.txt"),
        "leading\n",
        "utf8"
      );

      await client.stagePaths(fixture.repositoryPath, [
        "tracked.txt",
        "rename me.txt",
        "renamed 文件.txt",
        "-leading file.txt"
      ]);

      const staged = await client.readRepositorySnapshot(
        fixture.repositoryPath
      );
      expect(staged.staged).toBeGreaterThanOrEqual(3);
      expect(staged.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "renamed 文件.txt",
            originalPath: "rename me.txt",
            kind: "renamed"
          }),
          expect.objectContaining({
            path: "-leading file.txt",
            indexStatus: "A"
          })
        ])
      );

      await client.unstagePaths(fixture.repositoryPath, [
        "tracked.txt",
        "rename me.txt",
        "renamed 文件.txt",
        "-leading file.txt"
      ]);
      const unstaged = await client.readRepositorySnapshot(
        fixture.repositoryPath
      );

      expect(unstaged.staged).toBe(0);
      expect(unstaged.unstaged).toBeGreaterThanOrEqual(2);
      expect(unstaged.untracked).toBeGreaterThanOrEqual(2);
      await expect(
        client.stagePaths(fixture.repositoryPath, [
          "..\\outside.txt"
        ])
      ).rejects.toMatchObject({
        code: "INVALID_REQUEST"
      });
    } finally {
      await fixture.dispose();
    }
  });

  it("stages all modified, deleted, and untracked paths", async () => {
    const fixture = await createMutationRepository();

    try {
      await appendFile(
        join(fixture.repositoryPath, "tracked.txt"),
        "changed\n",
        "utf8"
      );
      await unlink(
        join(fixture.repositoryPath, "rename me.txt")
      );
      await writeFile(
        join(fixture.repositoryPath, "untracked.txt"),
        "new\n",
        "utf8"
      );

      await client.stageAll(fixture.repositoryPath);

      const snapshot = await client.readRepositorySnapshot(
        fixture.repositoryPath
      );
      expect(snapshot).toMatchObject({
        staged: 3,
        unstaged: 0,
        untracked: 0
      });
      expect(snapshot.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "tracked.txt",
            indexStatus: "M"
          }),
          expect.objectContaining({
            path: "rename me.txt",
            indexStatus: "D"
          }),
          expect.objectContaining({
            path: "untracked.txt",
            indexStatus: "A"
          })
        ])
      );
    } finally {
      await fixture.dispose();
    }
  });

  it.each(["tracked.txt", "-文件 [1]&.txt"])(
    "stages only the selected deletion when %s was replaced by an untracked directory",
    async (selectedPath) => {
      const fixture = await createMutationRepository();
      const path = fixture.repositoryPath;
      try {
        if (selectedPath !== "tracked.txt") {
          await writeFile(join(path, selectedPath), "special path\n");
          await runGit(path, ["add", "--", selectedPath]);
          await runGit(path, ["commit", "-m", "Special path fixture"]);
        }
        await unlink(join(path, selectedPath));
        await mkdir(join(path, selectedPath));
        await writeFile(join(path, selectedPath, "unselected.txt"), "keep untracked\n");
        const service = new RepositoryMutationService({
          async runWorktreeMutation(_target, _kind, action) {
            return { operationId: "stage-deletion", result: await action(path) };
          }
        }, client, client);

        await service.stage(
          { repositoryId: "repo", worktreeId: "wt" },
          [selectedPath]
        );

        expect((await runGit(path, ["diff", "--cached", "--name-status", "-z"])).stdout)
          .toBe(`D\0${selectedPath}\0`);
        expect((await runGit(path, ["ls-files", "--others", "--exclude-standard", "-z"])).stdout)
          .toBe(`${selectedPath}/unselected.txt\0`);
        expect(await readFile(join(path, selectedPath, "unselected.txt"), "utf8"))
          .toBe("keep untracked\n");
      } finally {
        await fixture.dispose();
      }
    }
  );

  it("stages a selected replacement child without adding its unselected sibling", async () => {
    const fixture = await createMutationRepository();
    const path = fixture.repositoryPath;
    try {
      await unlink(join(path, "tracked.txt"));
      await mkdir(join(path, "tracked.txt"));
      await writeFile(join(path, "tracked.txt", "selected.txt"), "selected\n");
      await writeFile(join(path, "tracked.txt", "unselected.txt"), "unselected\n");

      await client.stagePaths(path, ["tracked.txt", "tracked.txt/selected.txt"]);

      expect((await runGit(path, ["diff", "--cached", "--name-status", "--no-renames"])).stdout)
        .toBe("D\ttracked.txt\nA\ttracked.txt/selected.txt\n");
      expect((await runGit(path, ["ls-files", "--others", "--exclude-standard"])).stdout.trim())
        .toBe("tracked.txt/unselected.txt");
    } finally {
      await fixture.dispose();
    }
  });

  it("does not stage a selected deletion when another selected path cannot be added", async () => {
    const fixture = await createMutationRepository();
    const path = fixture.repositoryPath;
    try {
      await unlink(join(path, "tracked.txt"));
      await mkdir(join(path, "tracked.txt"));
      await writeFile(join(path, "tracked.txt", "unselected.txt"), "unselected\n");

      await expect(
        client.stagePaths(path, ["tracked.txt", "missing.txt"])
      ).rejects.toMatchObject({ code: "COMMAND_FAILED" });

      expect((await runGit(path, ["diff", "--cached", "--name-only"])).stdout)
        .toBe("");
      expect(await readFile(join(path, "tracked.txt", "unselected.txt"), "utf8"))
        .toBe("unselected\n");
    } finally {
      await fixture.dispose();
    }
  });

  it.each(["deleted-child", "new-parent", "all"] as const)(
    "stages a directory-to-file replacement only within the explicit selection (%s)",
    async (selection) => {
      const fixture = await createMutationRepository();
      const path = fixture.repositoryPath;
      try {
        await unlink(join(path, "tracked.txt"));
        await mkdir(join(path, "tracked.txt"));
        await writeFile(join(path, "tracked.txt", "first.txt"), "first child\n");
        await writeFile(join(path, "tracked.txt", "second.txt"), "second child\n");
        await client.stageAll(path);
        await runGit(path, ["commit", "-m", "Directory fixture"]);
        await unlink(join(path, "tracked.txt", "first.txt"));
        await unlink(join(path, "tracked.txt", "second.txt"));
        await rmdir(join(path, "tracked.txt"));
        await writeFile(join(path, "tracked.txt"), "replacement file\n");
        const paths = selection === "deleted-child"
          ? ["tracked.txt/first.txt"]
          : selection === "new-parent"
            ? ["tracked.txt"]
            : ["tracked.txt", "tracked.txt/first.txt", "tracked.txt/second.txt"];

        if (selection === "new-parent") {
          await expect(client.stagePaths(path, paths))
            .rejects.toMatchObject({ code: "INVALID_REQUEST" });
          expect((await runGit(path, ["diff", "--cached", "--name-only"])).stdout)
            .toBe("");
        } else {
          await client.stagePaths(path, paths);
          expect((await runGit(path, ["diff", "--cached", "--name-status", "--no-renames"])).stdout)
            .toBe(selection === "deleted-child"
              ? "D\ttracked.txt/first.txt\n"
              : "A\ttracked.txt\nD\ttracked.txt/first.txt\nD\ttracked.txt/second.txt\n");
        }
        expect(await readFile(join(path, "tracked.txt"), "utf8"))
          .toBe("replacement file\n");
      } finally {
        await fixture.dispose();
      }
    }
  );

  it.each(["file-to-directory", "directory-to-file"] as const)(
    "rejects unstaging one side of a %s replacement when it would unstage unselected paths",
    async (direction) => {
      const fixture = await createMutationRepository();
      const path = fixture.repositoryPath;
      try {
        await unlink(join(path, "tracked.txt"));
        await mkdir(join(path, "tracked.txt"));
        await writeFile(join(path, "tracked.txt", "child.txt"), "replacement child\n");
        if (direction === "directory-to-file") {
          await client.stageAll(path);
          await runGit(path, ["commit", "-m", "Directory replacement fixture"]);
          await unlink(join(path, "tracked.txt", "child.txt"));
          await rmdir(join(path, "tracked.txt"));
          await writeFile(join(path, "tracked.txt"), "replacement file\n");
        }
        await client.stageAll(path);
        const before = (await runGit(path, ["diff", "--cached", "--name-status", "-z"])).stdout;

        await expect(
          client.unstagePaths(path, ["tracked.txt"])
        ).rejects.toMatchObject({ code: "INVALID_REQUEST" });

        expect((await runGit(path, ["diff", "--cached", "--name-status", "-z"])).stdout)
          .toBe(before);
        await client.unstagePaths(path, ["tracked.txt", "tracked.txt/child.txt"]);
        expect((await runGit(path, ["diff", "--cached", "--name-only"])).stdout).toBe("");
        const workingPath = direction === "file-to-directory"
          ? join(path, "tracked.txt", "child.txt")
          : join(path, "tracked.txt");
        expect(await readFile(workingPath, "utf8")).toBe(
          direction === "file-to-directory"
            ? "replacement child\n"
            : "replacement file\n"
        );
      } finally {
        await fixture.dispose();
      }
    }
  );

  it("applies a validated stash by immutable hash without removing it", async () => {
    const fixture = await createMutationRepository();

    try {
      const stash = await createTrackedStash(
        client,
        fixture.repositoryPath
      );

      await client.mutateStash(
        fixture.repositoryPath,
        "apply",
        stash.ref,
        stash.hash
      );

      expect(
        await client.readRepositorySnapshot(
          fixture.repositoryPath
        )
      ).toMatchObject({ unstaged: 1 });
      expect(
        await client.readStashes(fixture.repositoryPath)
      ).toHaveLength(1);
    } finally {
      await fixture.dispose();
    }
  });

  it("drops a validated stash and pops a validated stash only after applying it", async () => {
    const dropFixture = await createMutationRepository();
    const popFixture = await createMutationRepository();

    try {
      const dropped = await createTrackedStash(
        client,
        dropFixture.repositoryPath
      );
      await client.mutateStash(
        dropFixture.repositoryPath,
        "drop",
        dropped.ref,
        dropped.hash
      );
      expect(
        await client.readStashes(dropFixture.repositoryPath)
      ).toHaveLength(0);
      expect(
        await client.readRepositorySnapshot(
          dropFixture.repositoryPath
        )
      ).toMatchObject({ staged: 0, unstaged: 0 });

      const popped = await createTrackedStash(
        client,
        popFixture.repositoryPath
      );
      await client.mutateStash(
        popFixture.repositoryPath,
        "pop",
        popped.ref,
        popped.hash
      );
      expect(
        await client.readStashes(popFixture.repositoryPath)
      ).toHaveLength(0);
      expect(
        await client.readRepositorySnapshot(
          popFixture.repositoryPath
        )
      ).toMatchObject({ unstaged: 1 });
    } finally {
      await dropFixture.dispose();
      await popFixture.dispose();
    }
  }, 15_000);

  it("rejects a stale stash hash without mutating the stash or worktree", async () => {
    const fixture = await createMutationRepository();

    try {
      const stash = await createTrackedStash(
        client,
        fixture.repositoryPath
      );

      await expect(
        client.mutateStash(
          fixture.repositoryPath,
          "drop",
          stash.ref,
          "f".repeat(40)
        )
      ).rejects.toMatchObject({
        code: "INVALID_REQUEST",
        message: expect.stringContaining(
          "selected stash changed"
        )
      });
      expect(
        await client.readStashes(fixture.repositoryPath)
      ).toHaveLength(1);
      expect(
        await client.readRepositorySnapshot(
          fixture.repositoryPath
        )
      ).toMatchObject({ staged: 0, unstaged: 0 });
    } finally {
      await fixture.dispose();
    }
  });

  it("retains the stash when pop cannot apply over local changes", async () => {
    const fixture = await createMutationRepository();

    try {
      const stash = await createTrackedStash(
        client,
        fixture.repositoryPath
      );
      await appendFile(
        join(fixture.repositoryPath, "tracked.txt"),
        "competing local change\n",
        "utf8"
      );
      const beforeContent = await readFile(
        join(fixture.repositoryPath, "tracked.txt"),
        "utf8"
      );

      const failure = await client.mutateStash(
        fixture.repositoryPath,
        "pop",
        stash.ref,
        stash.hash
      ).then(() => undefined, (error: unknown) => error);
      expect(failure).toMatchObject({ code: "COMMAND_FAILED" });
      expect(failure).not.toMatchObject({
        details: { stashOutcome: "conflicted" }
      });
      expect(await readFile(
        join(fixture.repositoryPath, "tracked.txt"), "utf8"
      )).toBe(beforeContent);
      expect(
        await client.readStashes(fixture.repositoryPath)
      ).toHaveLength(1);
      expect(
        await client.readRepositorySnapshot(
          fixture.repositoryPath
        )
      ).toMatchObject({ staged: 0, unstaged: 1, conflicted: 0 });
    } finally {
      await fixture.dispose();
    }
  });

  it.each(["apply", "pop"] as const)(
    "reports %s conflicts as a partial worktree result while retaining the stash",
    async (action) => {
      const fixture = await createMutationRepository();
      const path = fixture.repositoryPath;
      try {
        await writeFile(join(path, "tracked.txt"), "stash version\n");
        await appendFile(join(path, "rename me.txt"), "independent stash change\n");
        await runGit(path, ["stash", "push", "-m", "Conflicting stash"]);
        const [stash] = await client.readStashes(path);
        expect(stash).toBeDefined();
        await writeFile(join(path, "tracked.txt"), "new committed version\n");
        await runGit(path, ["add", "--", "tracked.txt"]);
        await runGit(path, ["commit", "-m", "Competing fixture change"]);

        const error = await client.mutateStash(
          path, action, stash!.ref, stash!.hash
        ).then(() => undefined, (reason: unknown) => reason);

        const snapshot = await client.readRepositorySnapshot(path);
        expect(snapshot.conflicted).toBe(1);
        expect(await readFile(join(path, "tracked.txt"), "utf8"))
          .toContain("<<<<<<<");
        expect(await readFile(join(path, "rename me.txt"), "utf8"))
          .toContain("independent stash change");
        expect(await client.readStashes(path)).toEqual([
          expect.objectContaining({ ref: stash!.ref, hash: stash!.hash })
        ]);
        expect(error).toMatchObject({
          code: "COMMAND_FAILED",
          message: expect.stringContaining("可能已部分应用"),
          details: {
            stashOutcome: "conflicted",
            stashRefUnchanged: true,
            conflictedPathCount: 1
          }
        });
      } finally {
        await fixture.dispose();
      }
    }
  );

  it("unstages a newly added path from an unborn repository without deleting the working file", async () => {
    const fixture = await createMutationRepository(false);

    try {
      await writeFile(
        join(fixture.repositoryPath, "first.txt"),
        "first\n",
        "utf8"
      );
      await client.stagePaths(fixture.repositoryPath, [
        "first.txt"
      ]);
      expect(
        await client.readRepositorySnapshot(
          fixture.repositoryPath
        )
      ).toMatchObject({
        staged: 1,
        untracked: 0
      });

      await client.unstagePaths(fixture.repositoryPath, [
        "first.txt"
      ]);
      expect(
        await client.readRepositorySnapshot(
          fixture.repositoryPath
        )
      ).toMatchObject({
        staged: 0,
        untracked: 1
      });
    } finally {
      await fixture.dispose();
    }
  });

  it("unstages an edited initial file through the mutation service while preserving working content and other staged files", async () => {
    const fixture = await createMutationRepository(false);
    const path = fixture.repositoryPath;
    try {
      await writeFile(join(path, "first.txt"), "staged version\n");
      await writeFile(join(path, "keep.txt"), "keep staged\n");
      await client.stagePaths(path, ["first.txt", "keep.txt"]);
      await writeFile(join(path, "first.txt"), "new working version\n");
      const service = new RepositoryMutationService({
        async runWorktreeMutation(_target, _kind, action) {
          return { operationId: "initial-unstage", result: await action(path) };
        }
      }, client, client);

      await service.unstage(
        { repositoryId: "repo", worktreeId: "wt" },
        ["first.txt"]
      );

      expect(await readFile(join(path, "first.txt"), "utf8"))
        .toBe("new working version\n");
      expect((await runGit(path, ["ls-files"])).stdout.trim())
        .toBe("keep.txt");
      expect(await client.readRepositorySnapshot(path))
        .toMatchObject({ staged: 1, untracked: 1, head: "" });
    } finally {
      await fixture.dispose();
    }
  });

  it("creates a commit with a bounded subject and body while leaving hooks enabled", async () => {
    const fixture = await createMutationRepository();

    try {
      await appendFile(
        join(fixture.repositoryPath, "tracked.txt"),
        "commit me\n",
        "utf8"
      );
      await client.stagePaths(fixture.repositoryPath, [
        "tracked.txt"
      ]);
      const created = await client.createCommit(
        fixture.repositoryPath,
        {
          subject: "Mutation commit",
          body: "Commit body line"
        }
      );
      expect(created.hash).toMatch(/^[0-9a-f]{40}$/);
      if (!created.hash) {
        throw new Error("Committed object identity was unavailable.");
      }
      const details = await client.readCommitDetails(
        fixture.repositoryPath,
        created.hash
      );

      expect(created).toMatchObject({
        subject: "Mutation commit"
      });
      expect(details.body).toBe(
        "Mutation commit\n\nCommit body line"
      );
      expect(
        await client.readRepositorySnapshot(
          fixture.repositoryPath
        )
      ).toMatchObject({
        staged: 0,
        unstaged: 0
      });
    } finally {
      await fixture.dispose();
    }
  });

  it("surfaces commit hook failure without creating a commit", async () => {
    const fixture = await createMutationRepository();

    try {
      await appendFile(
        join(fixture.repositoryPath, "tracked.txt"),
        "blocked\n",
        "utf8"
      );
      await client.stagePaths(fixture.repositoryPath, [
        "tracked.txt"
      ]);
      await runGit(fixture.repositoryPath, [
        "config",
        "core.hooksPath",
        ".git/hooks"
      ]);
      await writeFile(
        join(
          fixture.repositoryPath,
          ".git",
          "hooks",
          "commit-msg"
        ),
        [
          "#!/bin/sh",
          "echo \"commit message rejected\" >&2",
          "exit 1",
          ""
        ].join("\n"),
        { encoding: "utf8", mode: 0o755 }
      );
      const before = (
        await runGit(fixture.repositoryPath, [
          "rev-parse",
          "HEAD"
        ])
      ).stdout.trim();

      await expect(
        client.createCommit(fixture.repositoryPath, {
          subject: "Rejected commit"
        })
      ).rejects.toMatchObject({
        code: "COMMAND_FAILED"
      });
      const after = (
        await runGit(fixture.repositoryPath, [
          "rev-parse",
          "HEAD"
        ])
      ).stdout.trim();

      expect(after).toBe(before);
      expect(
        await client.readRepositorySnapshot(
          fixture.repositoryPath
        )
      ).toMatchObject({
        staged: 1
      });
    } finally {
      await fixture.dispose();
    }
  });

  for (const hookName of ["pre-commit", "post-commit"] as const) {
    for (const termination of ["cancel", "timeout"] as const) {
      it(`reports an uncertain commit outcome after ${termination} in ${hookName}`, async () => {
        const fixture = await createMutationRepository();
        const path = fixture.repositoryPath;
        const controller = new AbortController();
        let releasePath: string | undefined;
        let settled: Promise<unknown> | undefined;
        try {
          await appendFile(join(path, "tracked.txt"), "commit gate content\n");
          await client.stagePaths(path, ["tracked.txt"]);
          const beforeHead = (await runGit(path, ["rev-parse", "HEAD"])).stdout.trim();
          const gate = await installCommitGate(path, hookName);
          releasePath = gate.releasePath;
          settled = client.createCommit(path, {
            subject: "Commit gate fixture",
            signal: controller.signal,
            timeoutMs: termination === "timeout" ? 2_500 : 15_000
          }).then(
            (commit) => ({ success: true, commit }),
            (error: unknown) => error
          );
          await waitForFixtureFile(gate.readyPath);
          if (termination === "cancel") {
            controller.abort();
          }
          const result = await settled;
          const afterHead = (await runGit(path, ["rev-parse", "HEAD"])).stdout.trim();
          const snapshot = await client.readRepositorySnapshot(path);
          if (hookName === "post-commit") {
            expect(afterHead).not.toBe(beforeHead);
            expect(snapshot.staged).toBe(0);
            expect((await runGit(path, ["show", "HEAD:tracked.txt"])).stdout)
              .toContain("commit gate content");
          } else {
            expect(afterHead).toBe(beforeHead);
            expect(snapshot.staged).toBe(1);
          }
          expect(result).toMatchObject({
            code: termination === "cancel" ? "COMMAND_CANCELLED" : "COMMAND_TIMEOUT",
            message: expect.stringContaining("不要直接重试"),
            details: {
              commitOutcome: "unknown",
              headBefore: beforeHead,
              headAfter: afterHead
            }
          });
        } finally {
          controller.abort();
          if (releasePath) {
            await writeFile(releasePath, "release");
          }
          await settled;
          await fixture.dispose();
        }
      }, 20_000);
    }
  }

  it("stages an explicitly resolved conflict", async () => {
    const fixture = await createMutationRepository();

    try {
      await runGit(fixture.repositoryPath, [
        "switch",
        "-c",
        "conflict-side"
      ]);
      await writeFile(
        join(fixture.repositoryPath, "conflict.txt"),
        "side\n",
        "utf8"
      );
      await runGit(fixture.repositoryPath, [
        "add",
        "conflict.txt"
      ]);
      await runGit(fixture.repositoryPath, [
        "commit",
        "-m",
        "Side conflict"
      ]);
      await runGit(fixture.repositoryPath, [
        "switch",
        "main"
      ]);
      await writeFile(
        join(fixture.repositoryPath, "conflict.txt"),
        "main\n",
        "utf8"
      );
      await runGit(fixture.repositoryPath, [
        "add",
        "conflict.txt"
      ]);
      await runGit(fixture.repositoryPath, [
        "commit",
        "-m",
        "Main conflict"
      ]);
      const merge = await runGit(
        fixture.repositoryPath,
        ["merge", "conflict-side"],
        true
      );

      expect(merge.exitCode).not.toBe(0);
      expect(
        await client.readRepositorySnapshot(
          fixture.repositoryPath
        )
      ).toMatchObject({
        conflicted: 1
      });

      await writeFile(
        join(fixture.repositoryPath, "conflict.txt"),
        "resolved\n",
        "utf8"
      );
      await client.stagePaths(fixture.repositoryPath, [
        "conflict.txt"
      ]);

      expect(
        await client.readRepositorySnapshot(
          fixture.repositoryPath
        )
      ).toMatchObject({
        conflicted: 0,
        staged: 1
      });
    } finally {
      await fixture.dispose();
    }
  });
});

interface MutationRepositoryFixture {
  repositoryPath: string;
  dispose(): Promise<void>;
}

async function installCommitGate(
  path: string,
  hookName: "pre-commit" | "post-commit"
): Promise<{ readyPath: string; releasePath: string }> {
  await runGit(path, ["config", "core.hooksPath", ".git/hooks"]);
  const readyPath = join(path, ".git", "hooks", "commit-ready");
  const releasePath = join(path, ".git", "hooks", "commit-release");
  await writeFile(join(path, ".git", "hooks", "commit-gate.cjs"), [
    "const fs = require('node:fs');",
    `fs.writeFileSync(${JSON.stringify(readyPath)}, 'ready');`,
    "const timer = setInterval(() => {",
    `  if (fs.existsSync(${JSON.stringify(releasePath)})) clearInterval(timer);`,
    "}, 10);",
    ""
  ].join("\n"));
  await writeFile(join(path, ".git", "hooks", hookName), [
    "#!/bin/sh",
    `"${process.execPath.replace(/\\/g, "/")}" .git/hooks/commit-gate.cjs`,
    ""
  ].join("\n"), { encoding: "utf8", mode: 0o755 });
  return { readyPath, releasePath };
}

async function waitForFixtureFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await readFile(path);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Fixture hook did not become ready: ${path}`);
}

async function createTrackedStash(
  client: GitCliClient,
  repositoryPath: string
): Promise<{ ref: string; hash: string }> {
  await appendFile(
    join(repositoryPath, "tracked.txt"),
    "stashed change\n",
    "utf8"
  );
  await runGit(repositoryPath, [
    "stash",
    "push",
    "-m",
    "Mutation integration stash"
  ]);
  const [stash] = await client.readStashes(repositoryPath);
  if (!stash) {
    throw new Error("Expected the fixture stash to exist.");
  }
  return { ref: stash.ref, hash: stash.hash };
}

async function createMutationRepository(
  withInitialCommit = true
): Promise<MutationRepositoryFixture> {
  const temporary =
    await createTemporaryDirectoryFixture("mutation");
  const repositoryPath = join(
    temporary.path,
    "repository & unicode 测试"
  );
  await mkdir(repositoryPath, { recursive: true });
  await runGit(temporary.path, [
    "init",
    "--initial-branch=main",
    repositoryPath
  ]);
  await runGit(repositoryPath, [
    "config",
    "user.name",
    "GitNest Mutation Test"
  ]);
  await runGit(repositoryPath, [
    "config",
    "user.email",
    "mutation@example.invalid"
  ]);

  if (withInitialCommit) {
    await writeFile(
      join(repositoryPath, "tracked.txt"),
      "tracked\n",
      "utf8"
    );
    await writeFile(
      join(repositoryPath, "rename me.txt"),
      "rename\n",
      "utf8"
    );
    await writeFile(
      join(repositoryPath, "conflict.txt"),
      "base\n",
      "utf8"
    );
    await runGit(repositoryPath, ["add", "."]);
    await runGit(repositoryPath, [
      "commit",
      "-m",
      "Initial mutation fixture"
    ]);
  }

  return {
    repositoryPath,
    dispose: () => temporary.dispose()
  };
}

async function runGit(
  cwd: string,
  args: readonly string[],
  allowFailure = false
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...args], {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "Never"
      },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      const result = {
        exitCode: exitCode ?? -1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      };

      if (result.exitCode === 0 || allowFailure) {
        resolve(result);
        return;
      }

      reject(
        new Error(
          `Git command failed (${result.exitCode}): ${result.stderr}`
        )
      );
    });
  });
}
