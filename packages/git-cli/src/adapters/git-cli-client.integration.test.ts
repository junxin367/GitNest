import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GitError } from "@gitnest/git-core";
import {
  createGitRepositoryFixture,
  createTemporaryDirectoryFixture,
  type GitRepositoryFixture,
  type TemporaryDirectoryFixture
} from "@gitnest/testkit";

import { GitCliClient } from "./git-cli-client";

describe("GitCliClient integration", () => {
  let fixture: GitRepositoryFixture;
  let emptyFixture: TemporaryDirectoryFixture;
  const client = new GitCliClient();

  beforeAll(async () => {
    fixture = await createGitRepositoryFixture();
    emptyFixture = await createTemporaryDirectoryFixture(
      "empty-repository"
    );
    await runGit(emptyFixture.path, [
      "init",
      "--initial-branch=main",
      "."
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      fixture.dispose(),
      emptyFixture.dispose()
    ]);
  });

  it("detects the installed Git environment", async () => {
    const environment = await client.getEnvironment();

    expect(environment.executablePath).toMatch(
      /git(?:\.exe)?$/i
    );
    expect(environment.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(environment.detectedAt).toMatch(/Z$/);
    expect(environment.ssh.command.length).toBeGreaterThan(0);
  });

  it("reads a repository with spaces and shell metacharacters", async () => {
    const inspection = await client.inspectRepository(
      fixture.repositoryPath,
      { historyLimit: 10 }
    );

    expect(inspection.identity.worktreePath).toBe(
      fixture.repositoryPath
    );
    expect(inspection.identity.commonDir).toMatch(/[\\/]\.git$/);
    expect(inspection.snapshot).toMatchObject({
      branch: "main",
      staged: 1,
      unstaged: 1,
      untracked: 1,
      conflicted: 0
    });
    expect(inspection.snapshot.changes.map((change) => change.path)).toEqual(
      expect.arrayContaining([
        "README.md",
        "staged file.txt",
        "未跟踪 file.txt"
      ])
    );
    expect(inspection.branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "main",
          current: true
        }),
        expect.objectContaining({
          name: "feature/test",
          worktreePath: fixture.linkedWorktreePath
        })
      ])
    );
    expect(inspection.commits[0]?.subject).toBe(
      "Initial fixture commit"
    );
    expect(inspection.worktrees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: fixture.repositoryPath,
          branch: "main",
          primary: true
        }),
        expect.objectContaining({
          path: fixture.linkedWorktreePath,
          branch: "feature/test",
          primary: false
        })
      ])
    );
  });

  it("reads a repository snapshot with change stats", async () => {
    const snapshot = await client.readRepositorySnapshot(
      fixture.repositoryPath,
      { includeChangeStats: true }
    );

    expect(snapshot).toMatchObject({
      branch: "main",
      staged: 1,
      unstaged: 1,
      untracked: 1,
      conflicted: 0
    });
    expect(snapshot.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "README.md",
          unstagedStats: {
            additions: 2,
            deletions: 0
          }
        }),
        expect.objectContaining({
          path: "staged file.txt",
          stagedStats: {
            additions: 1,
            deletions: 0
          }
        }),
        expect.objectContaining({
          path: "未跟踪 file.txt",
          untrackedStats: {
            additions: 1,
            deletions: 0
          }
        })
      ])
    );
  });

  it("keeps lightweight snapshots free of per-file stats by default", async () => {
    const snapshot = await client.readRepositorySnapshot(
      fixture.repositoryPath
    );

    for (const change of snapshot.changes) {
      expect(change).not.toHaveProperty("stagedStats");
      expect(change).not.toHaveProperty("unstagedStats");
      expect(change).not.toHaveProperty("untrackedStats");
    }
  });

  it("reports only changed lines for a staged rename", async () => {
    const renamedFixture =
      await createTemporaryDirectoryFixture("renamed-stats");
    const originalContent = `${Array.from(
      { length: 20 },
      (_, index) => `line ${index + 1}`
    ).join("\n")}\n`;

    try {
      await runGit(renamedFixture.path, [
        "init",
        "--initial-branch=main",
        "."
      ]);
      await runGit(renamedFixture.path, [
        "config",
        "user.name",
        "GitNest Tests"
      ]);
      await runGit(renamedFixture.path, [
        "config",
        "user.email",
        "gitnest@example.invalid"
      ]);
      await writeFile(
        join(renamedFixture.path, "before.txt"),
        originalContent,
        "utf8"
      );
      await runGit(renamedFixture.path, ["add", "before.txt"]);
      await runGit(renamedFixture.path, [
        "commit",
        "-m",
        "Initial rename fixture"
      ]);
      await runGit(renamedFixture.path, [
        "mv",
        "before.txt",
        "after.txt"
      ]);
      await writeFile(
        join(renamedFixture.path, "after.txt"),
        `${originalContent}added line\n`,
        "utf8"
      );
      await runGit(renamedFixture.path, ["add", "after.txt"]);

      const snapshot = await client.readRepositorySnapshot(
        renamedFixture.path,
        { includeChangeStats: true }
      );

      expect(snapshot.changes).toEqual([
        expect.objectContaining({
          path: "after.txt",
          originalPath: "before.txt",
          kind: "renamed",
          stagedStats: {
            additions: 1,
            deletions: 0
          }
        })
      ]);
    } finally {
      await renamedFixture.dispose();
    }
  });

  it("filters mixed-line-ending stat changes while retaining real edits", async () => {
    const normalizedFixture =
      await createTemporaryDirectoryFixture(
        "normalized-status"
      );

    try {
      await runGit(normalizedFixture.path, [
        "init",
        "--initial-branch=main",
        "."
      ]);
      await runGit(normalizedFixture.path, [
        "config",
        "core.autocrlf",
        "true"
      ]);
      await runGit(normalizedFixture.path, [
        "config",
        "user.name",
        "GitNest Tests"
      ]);
      await runGit(normalizedFixture.path, [
        "config",
        "user.email",
        "gitnest@example.invalid"
      ]);
      const filePath = join(
        normalizedFixture.path,
        "MixedLineEndings.java"
      );
      await writeFile(
        filePath,
        "first line\nsecond line\nthird line\n",
        "utf8"
      );
      await runGit(normalizedFixture.path, ["add", "--all"]);
      await runGit(normalizedFixture.path, [
        "commit",
        "-m",
        "Initial normalized file"
      ]);

      await writeFile(
        filePath,
        "first line\r\nsecond line\nthird line\r\n",
        "utf8"
      );

      await expect(
        client.readRepositorySnapshot(normalizedFixture.path)
      ).resolves.toMatchObject({
        staged: 0,
        unstaged: 0,
        changes: []
      });

      await writeFile(
        filePath,
        "first line\r\nchanged line\nthird line\r\n",
        "utf8"
      );

      await expect(
        client.readRepositorySnapshot(normalizedFixture.path)
      ).resolves.toMatchObject({
        staged: 0,
        unstaged: 1,
        changes: [
          expect.objectContaining({
            path: "MixedLineEndings.java",
            worktreeStatus: "M"
          })
        ]
      });
    } finally {
      await normalizedFixture.dispose();
    }
  });

  it("reads staged, unstaged, and untracked diffs through bounded pathspec commands", async () => {
    const [unstaged, staged, untracked] = await Promise.all([
      client.readRepositoryDiff(fixture.repositoryPath, {
        path: "README.md",
        mode: "unstaged"
      }),
      client.readRepositoryDiff(fixture.repositoryPath, {
        path: "staged file.txt",
        mode: "staged"
      }),
      client.readRepositoryDiff(fixture.repositoryPath, {
        path: "未跟踪 file.txt",
        mode: "untracked"
      })
    ]);

    expect(unstaged).toMatchObject({
      path: "README.md",
      mode: "unstaged",
      additions: 2,
      truncated: false
    });
    expect(staged).toMatchObject({
      path: "staged file.txt",
      mode: "staged",
      additions: 1,
      truncated: false
    });
    expect(untracked).toMatchObject({
      path: "未跟踪 file.txt",
      mode: "untracked",
      additions: 1,
      truncated: false
    });
  });

  it("reads paged history, commit details, and branches", async () => {
    const history = await client.readCommitHistory(
      fixture.repositoryPath,
      { limit: 1 }
    );
    const commit = history.commits[0];

    expect(commit?.subject).toBe("Initial fixture commit");
    expect(history.nextOffset).toBeUndefined();
    await expect(
      client.readCommitDetails(
        fixture.repositoryPath,
        commit?.hash as string
      )
    ).resolves.toMatchObject({
      subject: "Initial fixture commit",
      files: [
        {
          path: "README.md",
          additions: 1,
          deletions: 0,
          binary: false
        }
      ]
    });
    await expect(
      client.readBranches(fixture.repositoryPath)
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "main",
          current: true
        }),
        expect.objectContaining({
          name: "feature/test"
        })
      ])
    );
  });

  it("returns empty read models for a repository with an unborn HEAD", async () => {
    await expect(
      client.readCommitHistory(emptyFixture.path)
    ).resolves.toEqual({
      commits: []
    });
    await expect(
      client.readBranches(emptyFixture.path)
    ).resolves.toEqual([]);
    await expect(
      client.readRepositorySnapshot(emptyFixture.path)
    ).resolves.toMatchObject({
      branch: "main",
      head: "",
      changes: []
    });
  });

  it("identifies binary untracked diffs without treating them as text changes", async () => {
    await writeFile(
      join(fixture.repositoryPath, "binary file.bin"),
      Buffer.from([0, 1, 2, 255])
    );

    const snapshot = await client.readRepositorySnapshot(
      fixture.repositoryPath,
      { includeChangeStats: true }
    );
    expect(
      snapshot.changes.find(
        (change) => change.path === "binary file.bin"
      )
    ).toMatchObject({
      untrackedStats: {
        additions: 0,
        deletions: 0
      }
    });

    await expect(
      client.readRepositoryDiff(fixture.repositoryPath, {
        path: "binary file.bin",
        mode: "untracked"
      })
    ).resolves.toMatchObject({
      binary: true,
      additions: 0,
      deletions: 0,
      truncated: false
    });
  });

  it("rejects escaping diff paths", async () => {
    await expect(
      client.readRepositoryDiff(fixture.repositoryPath, {
        path: "..\\outside.txt",
        mode: "unstaged"
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
  });

  it("truncates a very large untracked diff without returning unbounded output", async () => {
    await writeFile(
      join(fixture.repositoryPath, "large-diff.txt"),
      "large line\n".repeat(300_000),
      "utf8"
    );
    const diff = await client.readRepositoryDiff(
      fixture.repositoryPath,
      {
        path: "large-diff.txt",
        mode: "untracked"
      }
    );

    expect(diff.truncated).toBe(true);
    expect(Buffer.byteLength(diff.content)).toBeLessThanOrEqual(
      2 * 1024 * 1024
    );
  });

  it("returns a typed error for a non-repository directory", async () => {
    await expect(
      client.inspectRepository(fixture.containerPath)
    ).rejects.toMatchObject({
      code: "NOT_A_REPOSITORY"
    } satisfies Partial<GitError>);
    await expect(
      client.readCommitHistory(fixture.containerPath)
    ).rejects.toMatchObject({
      code: "NOT_A_REPOSITORY"
    } satisfies Partial<GitError>);
  });

  it("honors an already-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.inspectRepository(fixture.repositoryPath, {
        signal: controller.signal
      })
    ).rejects.toMatchObject({
      code: "COMMAND_CANCELLED"
    } satisfies Partial<GitError>);
  });
});

async function runGit(
  cwd: string,
  args: readonly string[]
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
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
    const stderr: Buffer[] = [];

    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Git command failed (${String(exitCode)}): ${Buffer.concat(
            stderr
          ).toString("utf8")}`
        )
      );
    });
  });
}
