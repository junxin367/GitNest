import { spawn } from "node:child_process";
import {
  appendFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

export interface GitRepositoryFixture {
  containerPath: string;
  repositoryPath: string;
  linkedWorktreePath: string;
  dispose(): Promise<void>;
}

export async function createGitRepositoryFixture(): Promise<GitRepositoryFixture> {
  const temporaryRoot = tmpdir();
  const containerPath = await mkdtemp(
    join(temporaryRoot, "gitnest-test-")
  );
  const repositoryPath = join(
    containerPath,
    "repository & unicode 测试"
  );
  const linkedWorktreePath = join(
    containerPath,
    "linked worktree"
  );

  await mkdir(repositoryPath, { recursive: true });
  await runFixtureGit(containerPath, [
    "init",
    "--initial-branch=main",
    repositoryPath
  ]);
  await runFixtureGit(repositoryPath, [
    "config",
    "user.name",
    "GitNest Test"
  ]);
  await runFixtureGit(repositoryPath, [
    "config",
    "user.email",
    "gitnest@example.invalid"
  ]);
  await writeFile(
    join(repositoryPath, "README.md"),
    "# GitNest fixture\n",
    "utf8"
  );
  await runFixtureGit(repositoryPath, ["add", "README.md"]);
  await runFixtureGit(repositoryPath, [
    "commit",
    "-m",
    "Initial fixture commit"
  ]);
  await runFixtureGit(repositoryPath, [
    "branch",
    "feature/test"
  ]);
  await runFixtureGit(repositoryPath, [
    "worktree",
    "add",
    linkedWorktreePath,
    "feature/test"
  ]);

  await appendFile(
    join(repositoryPath, "README.md"),
    "\nUnstaged line\n",
    "utf8"
  );
  await writeFile(
    join(repositoryPath, "staged file.txt"),
    "staged\n",
    "utf8"
  );
  await runFixtureGit(repositoryPath, [
    "add",
    "staged file.txt"
  ]);
  await writeFile(
    join(repositoryPath, "未跟踪 file.txt"),
    "untracked\n",
    "utf8"
  );

  return {
    containerPath,
    repositoryPath,
    linkedWorktreePath,
    dispose: async () => {
      assertSafeTemporaryPath(containerPath, temporaryRoot);
      await rm(containerPath, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50
      });
    }
  };
}

async function runFixtureGit(
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

function assertSafeTemporaryPath(
  path: string,
  temporaryRoot: string
): void {
  const relativePath = relative(temporaryRoot, path);

  if (
    !relativePath.startsWith("gitnest-test-") ||
    relativePath.includes("..")
  ) {
    throw new Error(
      `Refusing to remove unsafe fixture path: ${path}`
    );
  }
}
