import { spawn } from "node:child_process";
import {
  rm,
  truncate,
  writeFile
} from "node:fs/promises";
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

  it("previews the selected media version from the index or worktree", async () => {
    const mediaFixture =
      await createTemporaryDirectoryFixture("media-preview");
    const mediaPath = join(mediaFixture.path, "preview.webp");
    const svgPath = join(mediaFixture.path, "diagram.svg");
    const stagedBytes = Buffer.from([0, 1, 2, 3]);
    const worktreeBytes = Buffer.from([0, 4, 5, 6]);

    try {
      await runGit(mediaFixture.path, [
        "init",
        "--initial-branch=main",
        "."
      ]);
      await writeFile(mediaPath, stagedBytes);
      await runGit(mediaFixture.path, ["add", "preview.webp"]);
      await writeFile(mediaPath, worktreeBytes);
      await writeFile(
        svgPath,
        '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        "utf8"
      );

      const [staged, unstaged, untracked] =
        await Promise.all([
          client.readRepositoryDiff(mediaFixture.path, {
            path: "preview.webp",
            mode: "staged",
            includeMedia: true
          }),
          client.readRepositoryDiff(mediaFixture.path, {
            path: "preview.webp",
            mode: "unstaged",
            includeMedia: true
          }),
          client.readRepositoryDiff(mediaFixture.path, {
            path: "diagram.svg",
            mode: "untracked",
            includeMedia: true
          })
        ]);

      expect(staged.media).toMatchObject({
        status: "available",
        kind: "image",
        mimeType: "image/webp",
        size: stagedBytes.byteLength
      });
      expect(unstaged.media).toMatchObject({
        status: "available",
        kind: "image",
        mimeType: "image/webp",
        size: worktreeBytes.byteLength
      });
      expect(untracked).toMatchObject({
        binary: false,
        media: {
          status: "available",
          kind: "image",
          mimeType: "image/svg+xml"
        }
      });
      if (
        staged.media?.status !== "available" ||
        unstaged.media?.status !== "available"
      ) {
        throw new Error("Expected available media previews.");
      }
      expect(Buffer.from(staged.media.content)).toEqual(
        stagedBytes
      );
      expect(Buffer.from(unstaged.media.content)).toEqual(
        worktreeBytes
      );

      await rm(mediaPath);
      await expect(
        client.readRepositoryDiff(mediaFixture.path, {
          path: "preview.webp",
          mode: "unstaged",
          includeMedia: true
        })
      ).resolves.toMatchObject({
        media: {
          status: "unavailable",
          reason: "missing"
        }
      });
    } finally {
      await mediaFixture.dispose();
    }
  });

  it("refuses to load media previews larger than 50 MB", async () => {
    const mediaFixture =
      await createTemporaryDirectoryFixture(
        "large-media-preview"
      );
    const mediaPath = join(mediaFixture.path, "oversized.mp4");
    const size = 50 * 1024 * 1024 + 1;

    try {
      await runGit(mediaFixture.path, [
        "init",
        "--initial-branch=main",
        "."
      ]);
      await writeFile(mediaPath, "");
      await truncate(mediaPath, size);

      await expect(
        client.readRepositoryDiff(mediaFixture.path, {
          path: "oversized.mp4",
          mode: "untracked",
          includeMedia: true
        })
      ).resolves.toMatchObject({
        media: {
          status: "unavailable",
          kind: "video",
          mimeType: "video/mp4",
          reason: "too-large",
          size
        }
      });
    } finally {
      await mediaFixture.dispose();
    }
  });

  it("supports requesting enough context to show the whole changed file", async () => {
    const contextFixture =
      await createTemporaryDirectoryFixture("diff-context");
    const originalLines = Array.from(
      { length: 60 },
      (_, index) => `line ${index + 1}`
    );

    try {
      await runGit(contextFixture.path, [
        "init",
        "--initial-branch=main",
        "."
      ]);
      await runGit(contextFixture.path, [
        "config",
        "user.name",
        "GitNest Tests"
      ]);
      await runGit(contextFixture.path, [
        "config",
        "user.email",
        "gitnest@example.invalid"
      ]);
      const filePath = join(contextFixture.path, "context.txt");
      await writeFile(
        filePath,
        `${originalLines.join("\n")}\n`,
        "utf8"
      );
      await runGit(contextFixture.path, ["add", "context.txt"]);
      await runGit(contextFixture.path, [
        "commit",
        "-m",
        "Initial context fixture"
      ]);
      const changedLines = [...originalLines];
      changedLines[30] = "line 31 changed";
      await writeFile(
        filePath,
        `${changedLines.join("\n")}\n`,
        "utf8"
      );

      const compact = await client.readRepositoryDiff(
        contextFixture.path,
        {
          path: "context.txt",
          mode: "unstaged",
          contextLines: 3
        }
      );
      const expanded = await client.readRepositoryDiff(
        contextFixture.path,
        {
          path: "context.txt",
          mode: "unstaged",
          contextLines: 100_000
        }
      );

      expect(compact.content).not.toContain("\n line 1\n");
      expect(expanded.content).toContain("\n line 1\n");
      expect(expanded.content).toContain("\n line 60\n");
    } finally {
      await contextFixture.dispose();
    }
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

  it("marks remote branches merged into the current HEAD", async () => {
    const mergedFixture = await createGitRepositoryFixture();

    try {
      const mainHead = await client.resolveRevision(
        mergedFixture.repositoryPath,
        "HEAD"
      );
      await runGit(mergedFixture.repositoryPath, [
        "update-ref",
        "refs/remotes/origin/merged-feature",
        mainHead
      ]);
      await runGit(mergedFixture.repositoryPath, [
        "switch",
        "-c",
        "active-remote-source"
      ]);
      await writeFile(
        join(
          mergedFixture.repositoryPath,
          "active-remote.txt"
        ),
        "active\n",
        "utf8"
      );
      await runGit(mergedFixture.repositoryPath, [
        "add",
        "active-remote.txt"
      ]);
      await runGit(mergedFixture.repositoryPath, [
        "commit",
        "-m",
        "Active remote branch"
      ]);
      const activeHead = await client.resolveRevision(
        mergedFixture.repositoryPath,
        "HEAD"
      );
      await runGit(mergedFixture.repositoryPath, [
        "update-ref",
        "refs/remotes/origin/active-feature",
        activeHead
      ]);
      await runGit(mergedFixture.repositoryPath, [
        "switch",
        "main"
      ]);

      const branches = await client.readBranches(
        mergedFixture.repositoryPath
      );

      expect(
        branches.find(
          (branch) =>
            branch.fullName ===
            "refs/remotes/origin/merged-feature"
        )
      ).toMatchObject({ merged: true });
      expect(
        branches.find(
          (branch) =>
            branch.fullName ===
            "refs/remotes/origin/active-feature"
        )
      ).toMatchObject({ merged: false });
    } finally {
      await mergedFixture.dispose();
    }
  });

  it("reads one selected ref and compares divergent branch histories", async () => {
    const comparisonFixture =
      await createGitRepositoryFixture();

    try {
      await writeFile(
        join(
          comparisonFixture.repositoryPath,
          "main-only.txt"
        ),
        "main\n",
        "utf8"
      );
      await runGit(comparisonFixture.repositoryPath, [
        "add",
        "main-only.txt"
      ]);
      await runGit(comparisonFixture.repositoryPath, [
        "commit",
        "-m",
        "Main-only commit"
      ]);
      await writeFile(
        join(
          comparisonFixture.linkedWorktreePath,
          "feature-only.txt"
        ),
        "feature\n",
        "utf8"
      );
      await runGit(comparisonFixture.linkedWorktreePath, [
        "add",
        "feature-only.txt"
      ]);
      await runGit(comparisonFixture.linkedWorktreePath, [
        "commit",
        "-m",
        "Feature-only commit"
      ]);

      const selected = await client.readCommitHistory(
        comparisonFixture.repositoryPath,
        {
          scope: {
            kind: "ref",
            ref: "refs/heads/feature/test"
          }
        }
      );
      expect(selected.commits[0]?.subject).toBe(
        "Feature-only commit"
      );

      const comparison = await client.readCommitHistory(
        comparisonFixture.repositoryPath,
        {
          scope: {
            kind: "compare",
            leftRef: "refs/heads/main",
            rightRef: "refs/heads/feature/test"
          }
        }
      );

      expect(comparison.comparison).toMatchObject({
        leftRef: "refs/heads/main",
        rightRef: "refs/heads/feature/test",
        leftOnly: 1,
        rightOnly: 1
      });
      expect(comparison.comparison?.mergeBase).toMatch(
        /^[0-9a-f]{40,64}$/i
      );
      expect(comparison.commits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            subject: "Main-only commit",
            comparisonSide: "left"
          }),
          expect.objectContaining({
            subject: "Feature-only commit",
            comparisonSide: "right"
          }),
          expect.objectContaining({
            subject: "Initial fixture commit",
            comparisonSide: "base"
          })
        ])
      );
    } finally {
      await comparisonFixture.dispose();
    }
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
