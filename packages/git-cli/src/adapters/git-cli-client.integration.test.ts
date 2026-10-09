import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  rm,
  truncate,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { GitError } from "@gitnest/git-core";
import {
  createGitRepositoryFixture,
  createTemporaryDirectoryFixture,
  type GitRepositoryFixture,
  type TemporaryDirectoryFixture
} from "@gitnest/testkit";

import { GitCliClient } from "./git-cli-client";
import * as processRunner from "../process/git-process-runner";

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
    expect(environment.identity).toEqual(expect.any(Object));
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

  it("starts snapshot stats while upstream reconciliation is still pending", async () => {
    const original = processRunner.runProcess;
    let releaseUpstream!: () => void;
    const upstreamPending = new Promise<void>((resolve) => {
      releaseUpstream = resolve;
    });
    let statsStarted = false;
    const commands = vi.spyOn(processRunner, "runProcess").mockImplementation(async (request) => {
      if (request.args.includes("status")) {
        const result = await original(request);
        return { ...result, stdout: `# branch.upstream origin/main\0${result.stdout}` };
      }
      if (request.args[0] === "for-each-ref") {
        await upstreamPending;
        return { exitCode: 0, stdout: "origin/main\n", stderr: "", durationMs: 0 };
      }
      if (request.args.includes("--numstat")) {
        statsStarted = true;
      }
      return original(request);
    });
    const pending = client.readRepositorySnapshot(fixture.repositoryPath, {
      includeChangeStats: true
    });
    try {
      await vi.waitFor(() => expect(statsStarted).toBe(true));
    } finally {
      releaseUpstream();
      try {
        await expect(pending).resolves.toMatchObject({
          upstream: "origin/main",
          staged: 1,
          unstaged: 1
        });
      } finally {
        commands.mockRestore();
      }
    }
  });

  it("resolves both compared refs before waiting for either result", async () => {
    const original = processRunner.runProcess;
    let releaseLeft!: () => void;
    const leftPending = new Promise<void>((resolve) => {
      releaseLeft = resolve;
    });
    let rightStarted = false;
    const commands = vi.spyOn(processRunner, "runProcess").mockImplementation(async (request) => {
      if (request.args[0] === "rev-parse") {
        if (request.args.includes("refs/heads/main^{commit}")) {
          await leftPending;
        }
        if (request.args.includes("refs/heads/feature/test^{commit}")) {
          rightStarted = true;
        }
      }
      return original(request);
    });
    const pending = client.readCommitHistory(fixture.repositoryPath, {
      scope: {
        kind: "compare",
        leftRef: "refs/heads/main",
        rightRef: "refs/heads/feature/test"
      }
    });
    try {
      await vi.waitFor(() => expect(rightStarted).toBe(true));
    } finally {
      releaseLeft();
      try {
        await expect(pending).resolves.toMatchObject({
          comparison: { leftRef: "refs/heads/main", rightRef: "refs/heads/feature/test" }
        });
      } finally {
        commands.mockRestore();
      }
    }
  });

  it("counts untracked lines across read boundaries and keeps binary detection", async () => {
    const lineFixture = await createTemporaryDirectoryFixture("untracked-line-boundaries");
    try {
      await runGit(lineFixture.path, ["init", "--initial-branch=main", "."]);
      const files = [
        { name: "empty.txt", content: "", additions: 0 },
        { name: "no-newline.txt", content: "x".repeat(131073), additions: 1 },
        { name: "boundary.txt", content: `${"x".repeat(65535)}\n\nlast`, additions: 3 },
        { name: "crlf.txt", content: "x\r\n".repeat(25000), additions: 25000 },
        { name: "dense.txt", content: "\n".repeat(131072), additions: 131072 },
        { name: "binary.bin", content: "prefix\0suffix\n", additions: 0 }
      ];
      await Promise.all(files.map((file) => writeFile(join(lineFixture.path, file.name), file.content)));
      const snapshot = await client.readRepositorySnapshot(lineFixture.path, { includeChangeStats: true });
      for (const file of files) {
        expect(snapshot.changes.find((change) => change.path === file.name)?.untrackedStats)
          .toEqual({ additions: file.additions, deletions: 0 });
      }
    } finally {
      await lineFixture.dispose();
    }
  });

  it.each(["primary", "linked"] as const)(
    "reads %s topology without scanning changes, branches or history",
    async (target) => {
      const path = target === "primary"
        ? fixture.repositoryPath
        : fixture.linkedWorktreePath;
      const full = await client.inspectRepository(path);
      const commands = vi.spyOn(processRunner, "runProcess");
      try {
        const topology = await client.readRepositoryTopology(path);
        expect(topology).toEqual({
          identity: full.identity,
          branch: full.snapshot.branch,
          worktrees: full.worktrees
        });
        expect(commands.mock.calls.map(([command]) => command.args))
          .toEqual(expect.arrayContaining([
            ["worktree", "list", "--porcelain", "-z"]
          ]));
        expect(commands.mock.calls).toHaveLength(5);
        expect(commands.mock.calls.every(([command]) =>
          command.args[0] === "rev-parse" || command.args[0] === "worktree"
        )).toBe(true);
      } finally {
        commands.mockRestore();
      }
    }
  );

  it("reads an unborn branch through topology discovery", async () => {
    const topology = await client.readRepositoryTopology(emptyFixture.path);
    expect(topology.identity.head).toBe("");
    expect(topology.branch).toBe("main");
    expect(topology.worktrees).toEqual([
      expect.objectContaining({ path: emptyFixture.path, branch: "main", primary: true })
    ]);
  });

  it("keeps topology branch names unambiguous and reflects detached HEAD", async () => {
    const local = await createGitRepositoryFixture();
    try {
      await runGit(local.repositoryPath, ["tag", "main"]);
      await runGit(local.repositoryPath, ["switch", "-c", "heads/topic"]);
      await runGit(local.repositoryPath, ["tag", "heads/topic"]);
      expect((await client.readRepositoryTopology(local.repositoryPath)).branch)
        .toBe("heads/topic");
      await runGit(local.repositoryPath, ["switch", "--detach", "HEAD"]);
      const detached = await client.readRepositoryTopology(local.repositoryPath);
      expect(detached.branch).toBeUndefined();
      expect(detached.identity.head).toMatch(/^[a-f0-9]{40,64}$/);
      expect(detached.worktrees.find((worktree) => worktree.path === local.repositoryPath))
        .toMatchObject({ detached: true });
    } finally {
      await local.dispose();
    }
  });

  it("honors cancellation before topology discovery", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.readRepositoryTopology(fixture.repositoryPath, { signal: controller.signal })
    ).rejects.toMatchObject({ code: "COMMAND_CANCELLED" });
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

  it.each(["snapshot", "staged", "unstaged"] as const)(
    "does not invoke repository fsmonitor hooks when reading %s",
    async (mode) => {
      const monitorFixture =
        await createTemporaryDirectoryFixture("fsmonitor-read");

      try {
        await runGit(monitorFixture.path, [
          "init",
          "--initial-branch=main",
          "."
        ]);
        await writeFile(
          join(monitorFixture.path, "tracked.txt"),
          "index\n"
        );
        await runGit(monitorFixture.path, ["add", "tracked.txt"]);
        await writeFile(
          join(monitorFixture.path, "tracked.txt"),
          "worktree\n"
        );
        const markerPath = join(monitorFixture.path, "fsmonitor-marker");
        const hookPath = join(
          monitorFixture.path,
          ".git",
          "hooks",
          "fsmonitor-read"
        );
        const quotedMarker = markerPath
          .replaceAll("\\", "/")
          .replaceAll("'", "'\\''");
        await writeFile(
          hookPath,
          `#!/bin/sh\nprintf 'invoked\\n' >> '${quotedMarker}'\nexit 1\n`,
          { mode: 0o755 }
        );
        await runGit(monitorFixture.path, [
          "config",
          "core.fsmonitor",
          hookPath.replaceAll("\\", "/")
        ]);

        if (mode === "snapshot") {
          const snapshot = await client.readRepositorySnapshot(
            monitorFixture.path,
            { includeChangeStats: true }
          );
          expect(snapshot.changes).toEqual([
            expect.objectContaining({
              path: "tracked.txt",
              stagedStats: { additions: 1, deletions: 0 },
              unstagedStats: { additions: 1, deletions: 1 }
            })
          ]);
        } else {
          const diff = await client.readRepositoryDiff(
            monitorFixture.path,
            { path: "tracked.txt", mode }
          );
          expect(diff.content).toContain(
            mode === "staged" ? "+index" : "+worktree"
          );
        }
        await expect(readFile(markerPath, "utf8")).rejects.toMatchObject({
          code: "ENOENT"
        });

        // Establish that this platform actually executes the configured hook.
        await runGit(monitorFixture.path, ["status", "--porcelain"]);
        expect(await readFile(markerPath, "utf8")).toContain("invoked");
      } finally {
        await monitorFixture.dispose();
      }
    }
  );

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

  it("counts changed content lines that resemble diff file headers", async () => {
    const diffFixture =
      await createTemporaryDirectoryFixture(
        "diff-header-like-content"
      );

    try {
      await runGit(diffFixture.path, [
        "init",
        "--initial-branch=main",
        "."
      ]);
      await runGit(diffFixture.path, [
        "config",
        "user.name",
        "Diff Author"
      ]);
      await runGit(diffFixture.path, [
        "config",
        "user.email",
        "diff@example.invalid"
      ]);
      await writeFile(
        join(diffFixture.path, "header-like.txt"),
        "--- old\nunchanged\n",
        "utf8"
      );
      await runGit(diffFixture.path, [
        "add",
        "header-like.txt"
      ]);
      await runGit(diffFixture.path, [
        "commit",
        "-m",
        "Initial header-like content"
      ]);
      await writeFile(
        join(diffFixture.path, "header-like.txt"),
        "+++ new\nunchanged\n",
        "utf8"
      );

      await expect(
        client.readRepositoryDiff(diffFixture.path, {
          path: "header-like.txt",
          mode: "unstaged"
        })
      ).resolves.toMatchObject({
        additions: 1,
        deletions: 1
      });
    } finally {
      await diffFixture.dispose();
    }
  });

  it("counts a file-to-directory replacement without treating the second patch headers as changes", async () => {
    const diffFixture =
      await createTemporaryDirectoryFixture(
        "diff-file-to-directory"
      );

    try {
      await runGit(diffFixture.path, [
        "init",
        "--initial-branch=main",
        "."
      ]);
      await runGit(diffFixture.path, [
        "config",
        "user.name",
        "Diff Author"
      ]);
      await runGit(diffFixture.path, [
        "config",
        "user.email",
        "diff@example.invalid"
      ]);
      await writeFile(
        join(diffFixture.path, "foo"),
        "old\n",
        "utf8"
      );
      await runGit(diffFixture.path, ["add", "foo"]);
      await runGit(diffFixture.path, [
        "commit",
        "-m",
        "Add file foo"
      ]);

      await rm(join(diffFixture.path, "foo"));
      await mkdir(join(diffFixture.path, "foo"));
      await writeFile(
        join(diffFixture.path, "foo", "bar"),
        "new\n",
        "utf8"
      );
      await runGit(diffFixture.path, ["add", "--all"]);

      await expect(
        client.readRepositoryDiff(diffFixture.path, {
          path: "foo",
          mode: "staged"
        })
      ).resolves.toMatchObject({
        additions: 1,
        deletions: 1
      });
    } finally {
      await diffFixture.dispose();
    }
  });

  it("rejects a missing untracked path instead of returning an empty diff", async () => {
    await expect(
      client.readRepositoryDiff(fixture.repositoryPath, {
        path: "missing untracked file.txt",
        mode: "untracked"
      })
    ).rejects.toMatchObject({
      code: "COMMAND_FAILED"
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

  it("preserves record and field separator bytes in commit subjects", async () => {
    const historyFixture =
      await createTemporaryDirectoryFixture(
        "history-control-characters"
      );
    const subject = "Subject \x1e record \x1f field";

    try {
      await runGit(historyFixture.path, [
        "init",
        "--initial-branch=main",
        "."
      ]);
      await runGit(historyFixture.path, [
        "config",
        "user.name",
        "History Author"
      ]);
      await runGit(historyFixture.path, [
        "config",
        "user.email",
        "history@example.invalid"
      ]);
      await writeFile(
        join(historyFixture.path, "history.txt"),
        "history\n",
        "utf8"
      );
      await runGit(historyFixture.path, ["add", "history.txt"]);
      await runGit(historyFixture.path, [
        "commit",
        "-m",
        subject
      ]);

      await expect(
        client.readCommitHistory(historyFixture.path)
      ).resolves.toMatchObject({
        commits: [
          expect.objectContaining({
            subject
          })
        ]
      });
    } finally {
      await historyFixture.dispose();
    }
  });

  it("preserves commas in decorated ref names", async () => {
    const decorationFixture =
      await createTemporaryDirectoryFixture(
        "history-ref-with-comma"
      );

    try {
      await runGit(decorationFixture.path, [
        "init",
        "--initial-branch=main",
        "."
      ]);
      await runGit(decorationFixture.path, [
        "config",
        "user.name",
        "Decoration Author"
      ]);
      await runGit(decorationFixture.path, [
        "config",
        "user.email",
        "decoration@example.invalid"
      ]);
      await writeFile(
        join(decorationFixture.path, "decorated.txt"),
        "decorated\n",
        "utf8"
      );
      await runGit(decorationFixture.path, [
        "add",
        "decorated.txt"
      ]);
      await runGit(decorationFixture.path, [
        "commit",
        "-m",
        "Decorated commit"
      ]);
      await runGit(decorationFixture.path, [
        "tag",
        "release,one"
      ]);
      const commitHash = (
        await runGit(decorationFixture.path, [
          "rev-parse",
          "HEAD"
        ])
      ).trim();

      const history = await client.readCommitHistory(
        decorationFixture.path
      );
      const details = await client.readCommitDetails(
        decorationFixture.path,
        commitHash
      );

      expect(history.commits[0]?.refs).toContain(
        "tag: release,one"
      );
      expect(details.refs).toContain("tag: release,one");
    } finally {
      await decorationFixture.dispose();
    }
  });

  it("lists stashes and reads their files and per-file patches including untracked files", async () => {
    const stashFixture = await createTemporaryDirectoryFixture(
      "stash-browser"
    );
    const trackedMediaBefore = Buffer.from([0, 1, 2, 3]);
    const trackedMediaAfter = Buffer.from([0, 4, 5, 6]);
    const untrackedMedia = Buffer.from([0, 7, 8, 9]);

    try {
      await runGit(stashFixture.path, [
        "init",
        "--initial-branch=main",
        "."
      ]);
      await runGit(stashFixture.path, [
        "config",
        "user.name",
        "Stash Author"
      ]);
      await runGit(stashFixture.path, [
        "config",
        "user.email",
        "stash@example.com"
      ]);
      await writeFile(
        join(stashFixture.path, "tracked.txt"),
        "before\n",
        "utf8"
      );
      await writeFile(
        join(stashFixture.path, "untouched.txt"),
        "unchanged\n",
        "utf8"
      );
      await writeFile(
        join(stashFixture.path, "tracked.webp"),
        trackedMediaBefore
      );
      await runGit(stashFixture.path, [
        "add",
        "tracked.txt",
        "untouched.txt",
        "tracked.webp"
      ]);
      await runGit(stashFixture.path, [
        "commit",
        "-m",
        "Stash base"
      ]);
      await writeFile(
        join(stashFixture.path, "tracked.txt"),
        "after\n",
        "utf8"
      );
      await writeFile(
        join(stashFixture.path, "untracked.txt"),
        "new file\n",
        "utf8"
      );
      await writeFile(
        join(stashFixture.path, "tracked.webp"),
        trackedMediaAfter
      );
      await writeFile(
        join(stashFixture.path, "untracked.png"),
        untrackedMedia
      );
      await runGit(stashFixture.path, [
        "stash",
        "push",
        "--include-untracked",
        "-m",
        "Saved work"
      ]);

      const stashes = await client.readStashes(
        stashFixture.path
      );

      expect(stashes).toHaveLength(1);
      expect(stashes[0]).toMatchObject({
        ref: "stash@{0}",
        subject: expect.stringContaining("Saved work"),
        authorName: "Stash Author",
        baseHash: expect.stringMatching(/^[0-9a-f]{40,64}$/i)
      });

      await expect(
        client.readStashFiles(
          stashFixture.path,
          "stash@{0}"
        )
      ).resolves.toMatchObject({
        ref: "stash@{0}",
        hash: stashes[0]?.hash,
        additions: 2,
        deletions: 1,
        files: expect.arrayContaining([
          expect.objectContaining({ path: "tracked.txt" }),
          expect.objectContaining({ path: "untracked.txt" }),
          expect.objectContaining({ path: "tracked.webp" }),
          expect.objectContaining({ path: "untracked.png" })
        ])
      });

      await expect(
        client.readStashDiff(stashFixture.path, {
          stashRef: "stash@{0}",
          path: "untracked.txt",
          contextLines: 3
        })
      ).resolves.toMatchObject({
        ref: "stash@{0}",
        path: "untracked.txt",
        content: expect.stringContaining("+new file"),
        additions: 1,
        deletions: 0,
        binary: false
      });

      const [trackedMediaDiff, untrackedMediaDiff] =
        await Promise.all([
          client.readStashDiff(stashFixture.path, {
            stashRef: "stash@{0}",
            path: "tracked.webp",
            includeMedia: true
          }),
          client.readStashDiff(stashFixture.path, {
            stashRef: "stash@{0}",
            path: "untracked.png",
            includeMedia: true
          })
        ]);
      expect(trackedMediaDiff.media).toMatchObject({
        status: "available",
        kind: "image",
        mimeType: "image/webp",
        size: trackedMediaAfter.byteLength
      });
      expect(untrackedMediaDiff.media).toMatchObject({
        status: "available",
        kind: "image",
        mimeType: "image/png",
        size: untrackedMedia.byteLength
      });
      if (
        trackedMediaDiff.media?.status !== "available" ||
        untrackedMediaDiff.media?.status !== "available"
      ) {
        throw new Error(
          "Expected available stash media previews."
        );
      }
      expect(
        Buffer.from(trackedMediaDiff.media.content)
      ).toEqual(trackedMediaAfter);
      expect(
        Buffer.from(untrackedMediaDiff.media.content)
      ).toEqual(untrackedMedia);

      await expect(
        client.readStashDiff(stashFixture.path, {
          stashRef: "stash@{0}",
          path: "untouched.txt",
          contextLines: 3
        })
      ).resolves.toMatchObject({
        ref: "stash@{0}",
        path: "untouched.txt",
        content: "",
        additions: 0,
        deletions: 0,
        binary: false
      });
    } finally {
      await stashFixture.dispose();
    }
  });

  it("rejects arbitrary stash revisions and escaping stash paths", async () => {
    await expect(
      client.readStashFiles(fixture.repositoryPath, "--all")
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    await expect(
      client.readStashDiff(fixture.repositoryPath, {
        stashRef: "stash@{0}",
        path: "../outside.txt"
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
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

  it("keeps a real remote branch ending in HEAD while hiding the symbolic remote HEAD", async () => {
    const remoteFixture = await createGitRepositoryFixture();

    try {
      const head = await client.resolveRevision(remoteFixture.repositoryPath, "HEAD");
      await runGit(remoteFixture.repositoryPath, [
        "update-ref",
        "refs/remotes/origin/feature/HEAD",
        head
      ]);
      await runGit(remoteFixture.repositoryPath, [
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/feature/HEAD"
      ]);

      const branches = await client.readBranches(remoteFixture.repositoryPath);
      expect(branches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fullName: "refs/remotes/origin/feature/HEAD",
            head,
            remote: true
          })
        ])
      );
      expect(branches.some((branch) => branch.fullName === "refs/remotes/origin/HEAD")).toBe(false);
    } finally {
      await remoteFixture.dispose();
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

  it("reads root, normal, and merge commit files and diffs against the first parent", async () => {
    const commitDiffFixture =
      await createTemporaryDirectoryFixture("commit-diff");
    const committedMedia = Buffer.from([0, 1, 2, 3]);

    try {
      await runGit(commitDiffFixture.path, [
        "init",
        "--initial-branch=main",
        "."
      ]);
      await runGit(commitDiffFixture.path, [
        "config",
        "user.name",
        "Commit Diff Author"
      ]);
      await runGit(commitDiffFixture.path, [
        "config",
        "user.email",
        "commit-diff@example.com"
      ]);
      await writeFile(
        join(commitDiffFixture.path, "story.txt"),
        "root\n",
        "utf8"
      );
      await runGit(commitDiffFixture.path, ["add", "story.txt"]);
      await runGit(commitDiffFixture.path, [
        "commit",
        "-m",
        "Root commit"
      ]);
      const rootHash = (
        await runGit(commitDiffFixture.path, [
          "rev-parse",
          "HEAD"
        ])
      ).trim();

      await writeFile(
        join(commitDiffFixture.path, "story.txt"),
        "normal\n",
        "utf8"
      );
      await runGit(commitDiffFixture.path, ["add", "story.txt"]);
      await runGit(commitDiffFixture.path, [
        "commit",
        "-m",
        "Normal commit"
      ]);
      const normalHash = (
        await runGit(commitDiffFixture.path, [
          "rev-parse",
          "HEAD"
        ])
      ).trim();

      await writeFile(
        join(commitDiffFixture.path, "preview.webp"),
        committedMedia
      );
      await runGit(commitDiffFixture.path, [
        "add",
        "preview.webp"
      ]);
      await runGit(commitDiffFixture.path, [
        "commit",
        "-m",
        "Add media"
      ]);
      const mediaHash = (
        await runGit(commitDiffFixture.path, [
          "rev-parse",
          "HEAD"
        ])
      ).trim();

      await runGit(commitDiffFixture.path, [
        "checkout",
        "-b",
        "side"
      ]);
      await writeFile(
        join(commitDiffFixture.path, "side-only.txt"),
        "side\n",
        "utf8"
      );
      await runGit(commitDiffFixture.path, [
        "add",
        "side-only.txt"
      ]);
      await runGit(commitDiffFixture.path, [
        "commit",
        "-m",
        "Side commit"
      ]);
      await runGit(commitDiffFixture.path, [
        "checkout",
        "main"
      ]);
      await writeFile(
        join(commitDiffFixture.path, "main-only.txt"),
        "main\n",
        "utf8"
      );
      await runGit(commitDiffFixture.path, [
        "add",
        "main-only.txt"
      ]);
      await runGit(commitDiffFixture.path, [
        "commit",
        "-m",
        "Main commit"
      ]);
      await runGit(commitDiffFixture.path, [
        "merge",
        "--no-ff",
        "-m",
        "Merge side",
        "side"
      ]);
      const mergeHash = (
        await runGit(commitDiffFixture.path, [
          "rev-parse",
          "HEAD"
        ])
      ).trim();
      await runGit(commitDiffFixture.path, [
        "rm",
        "preview.webp"
      ]);
      await runGit(commitDiffFixture.path, [
        "commit",
        "-m",
        "Remove media"
      ]);
      const removedMediaHash = (
        await runGit(commitDiffFixture.path, [
          "rev-parse",
          "HEAD"
        ])
      ).trim();

      await expect(
        client.readCommitDetails(commitDiffFixture.path, rootHash)
      ).resolves.toMatchObject({
        files: [{ path: "story.txt", additions: 1, deletions: 0, binary: false }],
        additions: 1,
        deletions: 0
      });
      await expect(
        client.readCommitDetails(commitDiffFixture.path, normalHash)
      ).resolves.toMatchObject({
        files: [{ path: "story.txt", additions: 1, deletions: 1, binary: false }],
        additions: 1,
        deletions: 1
      });
      await expect(
        client.readCommitDetails(commitDiffFixture.path, mergeHash)
      ).resolves.toMatchObject({
        files: [{ path: "side-only.txt", additions: 1, deletions: 0, binary: false }],
        additions: 1,
        deletions: 0
      });

      await expect(
        client.readCommitDiff(commitDiffFixture.path, {
          commitHash: rootHash,
          path: "story.txt"
        })
      ).resolves.toMatchObject({
        path: "story.txt",
        content: expect.stringContaining("+root"),
        additions: 1,
        deletions: 0,
        binary: false,
        truncated: false
      });
      await expect(
        client.readCommitDiff(commitDiffFixture.path, {
          commitHash: normalHash,
          path: "story.txt"
        })
      ).resolves.toMatchObject({
        path: "story.txt",
        content: expect.stringMatching(
          /(?:^|\n)-root\r?\n\+normal(?:\r?\n|$)/
        ),
        additions: 1,
        deletions: 1
      });
      await expect(
        client.readCommitDiff(commitDiffFixture.path, {
          commitHash: mergeHash,
          path: "side-only.txt"
        })
      ).resolves.toMatchObject({
        path: "side-only.txt",
        content: expect.stringContaining("+side"),
        additions: 1,
        deletions: 0
      });
      await expect(
        client.readCommitDiff(commitDiffFixture.path, {
          commitHash: mergeHash,
          path: "main-only.txt"
        })
      ).resolves.toMatchObject({
        path: "main-only.txt",
        content: "",
        additions: 0,
        deletions: 0
      });
      const mediaDiff = await client.readCommitDiff(
        commitDiffFixture.path,
        {
          commitHash: mediaHash,
          path: "preview.webp",
          includeMedia: true
        }
      );
      expect(mediaDiff.media).toMatchObject({
        status: "available",
        kind: "image",
        mimeType: "image/webp",
        size: committedMedia.byteLength
      });
      if (mediaDiff.media?.status !== "available") {
        throw new Error(
          "Expected an available commit media preview."
        );
      }
      expect(Buffer.from(mediaDiff.media.content)).toEqual(
        committedMedia
      );
      await expect(
        client.readCommitDiff(commitDiffFixture.path, {
          commitHash: mediaHash,
          path: "preview.webp"
        })
      ).resolves.not.toHaveProperty("media");
      await expect(
        client.readCommitDiff(commitDiffFixture.path, {
          commitHash: removedMediaHash,
          path: "preview.webp",
          includeMedia: true
        })
      ).resolves.toMatchObject({
        media: {
          status: "unavailable",
          kind: "image",
          reason: "missing"
        }
      });

      await writeFile(
        join(commitDiffFixture.path, "large.txt"),
        "large line\n".repeat(300_000),
        "utf8"
      );
      await runGit(commitDiffFixture.path, ["add", "large.txt"]);
      await runGit(commitDiffFixture.path, [
        "commit",
        "-m",
        "Large commit"
      ]);
      const largeHash = (
        await runGit(commitDiffFixture.path, [
          "rev-parse",
          "HEAD"
        ])
      ).trim();
      const largeDiff = await client.readCommitDiff(
        commitDiffFixture.path,
        {
          commitHash: largeHash,
          path: "large.txt"
        }
      );
      expect(largeDiff.truncated).toBe(true);
      expect(
        Buffer.byteLength(largeDiff.content)
      ).toBeLessThanOrEqual(2 * 1024 * 1024);
    } finally {
      await commitDiffFixture.dispose();
    }
  }, 10_000);

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
    await expect(
      client.readCommitDiff(fixture.repositoryPath, {
        commitHash: "HEAD~1",
        path: "README.md"
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    await expect(
      client.readCommitDiff(fixture.repositoryPath, {
        commitHash: "abcdef",
        path: "..\\outside.txt"
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
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
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
      if (exitCode === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
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
