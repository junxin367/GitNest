import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from "vitest";

import {
  createTemporaryDirectoryFixture,
  type TemporaryDirectoryFixture
} from "@gitnest/testkit";

import { GitCliClient } from "./git-cli-client";

describe("GitCliClient worktree operations integration", () => {
  let fixture: TemporaryDirectoryFixture;
  let repositoryPath: string;
  const client = new GitCliClient();

  beforeEach(async () => {
    fixture = await createTemporaryDirectoryFixture(
      "worktree-operations"
    );
    repositoryPath = join(fixture.path, "repository");
    await mkdir(repositoryPath, { recursive: true });
    await runGit(fixture.path, [
      "init",
      "--initial-branch=main",
      repositoryPath
    ]);
    await runGit(repositoryPath, [
      "config",
      "user.name",
      "GitNest Test"
    ]);
    await runGit(repositoryPath, [
      "config",
      "user.email",
      "gitnest@example.invalid"
    ]);
    await writeFile(
      join(repositoryPath, "README.md"),
      "# Worktree operations\n",
      "utf8"
    );
    await runGit(repositoryPath, ["add", "README.md"]);
    await runGit(repositoryPath, [
      "commit",
      "-m",
      "Initial worktree fixture"
    ]);
    await runGit(repositoryPath, [
      "branch",
      "feature/existing"
    ]);
  });

  afterEach(async () => {
    await fixture.dispose();
  });

  it("creates, locks, moves, repairs, prunes, and safely removes worktrees", async () => {
    const head = await client.resolveRevision(
      repositoryPath,
      "HEAD"
    );
    const existingPath = join(
      fixture.path,
      "existing worktree"
    );
    const movedPath = join(
      fixture.path,
      "moved worktree"
    );
    const newPath = join(
      fixture.path,
      "new worktree 测试"
    );
    const detachedPath = join(
      fixture.path,
      "detached worktree"
    );
    const existingEmptyPath = join(
      fixture.path,
      "existing empty worktree"
    );
    const prunablePath = join(
      fixture.path,
      "prunable worktree"
    );

    await client.createWorktree(
      repositoryPath,
      existingPath,
      {
        startPoint: head,
        branch: "feature/existing",
        createBranch: false,
        detached: false
      }
    );
    await client.createWorktree(repositoryPath, newPath, {
      startPoint: head,
      branch: "feature/新建",
      createBranch: true,
      detached: false
    });
    await client.createWorktree(
      repositoryPath,
      detachedPath,
      {
        startPoint: head,
        createBranch: false,
        detached: true
      }
    );
    await mkdir(existingEmptyPath);
    await client.createWorktree(
      repositoryPath,
      existingEmptyPath,
      {
        startPoint: head,
        branch: "feature/existing-empty",
        createBranch: true,
        detached: false
      }
    );

    expect(
      await client.readWorktrees(repositoryPath)
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: existingPath,
          branch: "feature/existing"
        }),
        expect.objectContaining({
          path: newPath,
          branch: "feature/新建"
        }),
        expect.objectContaining({
          path: detachedPath,
          detached: true
        }),
        expect.objectContaining({
          path: existingEmptyPath,
          branch: "feature/existing-empty"
        })
      ])
    );

    await client.lockWorktree(repositoryPath, newPath, {
      reason: "release validation"
    });
    expect(
      (
        await client.readWorktrees(repositoryPath)
      ).find((worktree) => worktree.path === newPath)
    ).toMatchObject({
      locked: true,
      lockReason: "release validation"
    });
    await client.unlockWorktree(repositoryPath, newPath);

    await client.moveWorktree(
      repositoryPath,
      existingPath,
      movedPath
    );
    expect(
      await client.readWorktrees(repositoryPath)
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: movedPath,
          branch: "feature/existing"
        })
      ])
    );

    await client.repairWorktrees(repositoryPath, [
      movedPath,
      newPath
    ]);

    await client.createWorktree(
      repositoryPath,
      prunablePath,
      {
        startPoint: head,
        branch: "feature/prunable",
        createBranch: true,
        detached: false
      }
    );
    await rm(prunablePath, {
      recursive: true,
      force: true
    });
    expect(
      (
        await client.readWorktrees(repositoryPath)
      ).find((worktree) => worktree.path === prunablePath)
    ).toMatchObject({
      prunable: true
    });
    await expect(
      client.previewPruneWorktrees(repositoryPath)
    ).resolves.toEqual([
      expect.objectContaining({
        path: prunablePath,
        prunable: true
      })
    ]);
    await client.pruneWorktrees(repositoryPath);
    expect(
      (
        await client.readWorktrees(repositoryPath)
      ).some((worktree) => worktree.path === prunablePath)
    ).toBe(false);

    await client.removeWorktree(
      repositoryPath,
      detachedPath
    );
    await client.removeWorktree(
      repositoryPath,
      existingEmptyPath
    );
    expect(
      (
        await client.readWorktrees(repositoryPath)
      ).some((worktree) => worktree.path === detachedPath)
    ).toBe(false);
  }, 30_000);

  it("rejects malformed paths, modes, reasons, and repair sets before mutation", async () => {
    const head = await client.resolveRevision(
      repositoryPath,
      "HEAD"
    );

    await expect(
      client.createWorktree(repositoryPath, "relative", {
        startPoint: head,
        branch: "feature/invalid",
        createBranch: true,
        detached: false
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    await expect(
      client.createWorktree(
        repositoryPath,
        join(fixture.path, "invalid detached"),
        {
          startPoint: head,
          branch: "feature/invalid",
          createBranch: false,
          detached: true
        }
      )
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    await expect(
      client.lockWorktree(
        repositoryPath,
        repositoryPath,
        { reason: "line one\nline two" }
      )
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    await expect(
      client.repairWorktrees(repositoryPath, [])
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });

    expect(await client.readWorktrees(repositoryPath)).toHaveLength(
      1
    );
  });

  it.each(["existing", "new", "detached"] as const)(
    "reports the registered Worktree left by a post-checkout hook failure (%s)",
    async (mode) => {
      const head = await client.resolveRevision(repositoryPath, "HEAD");
      const destination = join(fixture.path, `hook-failure-${mode}`);
      await runGit(repositoryPath, [
        "config", "core.hooksPath", join(repositoryPath, ".git", "hooks")
      ]);
      const hookPath = join(repositoryPath, ".git", "hooks", "post-checkout");
      await writeFile(hookPath, "#!/bin/sh\nexit 1\n", {
        encoding: "utf8",
        mode: 0o755
      });
      const options = {
        startPoint: head,
        ...(mode === "detached"
          ? {}
          : { branch: mode === "new" ? "feature/hook-new" : "feature/existing" }),
        createBranch: mode === "new",
        detached: mode === "detached"
      };

      const failure = await client.createWorktree(
        repositoryPath, destination, options
      ).then(() => undefined, (error: unknown) => error);

      const registered = (await client.readWorktrees(repositoryPath))
        .find((worktree) => worktree.path === destination);
      expect(registered).toMatchObject({
        head,
        detached: mode === "detached"
      });
      expect(await readFile(join(destination, "README.md"), "utf8"))
        .toContain("Worktree operations");
      expect(failure).toMatchObject({
        code: "COMMAND_FAILED",
        message: expect.stringContaining("不要直接重复创建"),
        details: {
          worktreeOutcome: "registered",
          worktreePath: destination,
          worktreeHead: head
        }
      });

      await unlink(hookPath);
      await client.removeWorktree(repositoryPath, destination);
      await client.createWorktree(repositoryPath, destination, {
        ...options,
        createBranch: false
      });
      expect((await client.readWorktrees(repositoryPath))
        .some((worktree) => worktree.path === destination)).toBe(true);
    }
  );
});

it("reads and inspects a linked worktree whose primary repository is bare", async () => {
  const fixture = await createTemporaryDirectoryFixture("bare-linked-worktree");
  const barePath = join(fixture.path, "bare & 裸仓库.git");
  const linkedPath = join(fixture.path, "linked 测试");
  const client = new GitCliClient();

  try {
    await runGit(fixture.path, [
      "init",
      "--bare",
      "--initial-branch=main",
      barePath
    ]);
    await runGit(barePath, [
      "worktree",
      "add",
      "--orphan",
      "-b",
      "linked",
      linkedPath
    ]);

    const worktrees = await client.readWorktrees(linkedPath);
    expect(worktrees).toEqual([
      expect.objectContaining({
        path: barePath,
        head: "",
        bare: true,
        primary: true
      }),
      expect.objectContaining({
        path: linkedPath,
        branch: "linked",
        bare: false,
        primary: false
      })
    ]);
    await expect(
      client.inspectRepository(linkedPath)
    ).resolves.toMatchObject({
      identity: {
        worktreePath: linkedPath,
        commonDir: barePath
      },
      snapshot: { branch: "linked", head: "" },
      worktrees
    });
  } finally {
    await fixture.dispose();
  }
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
          `Fixture Git command failed (${String(exitCode)}): ${Buffer.concat(stderr).toString("utf8")}`
        )
      );
    });
  });
}
