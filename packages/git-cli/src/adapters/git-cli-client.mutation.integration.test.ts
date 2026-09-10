import { spawn } from "node:child_process";
import {
  appendFile,
  mkdir,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createTemporaryDirectoryFixture,
  type TemporaryDirectoryFixture
} from "@gitnest/testkit";

import { GitCliClient } from "./git-cli-client";

describe("GitCliClient mutation integration", () => {
  const client = new GitCliClient();

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
