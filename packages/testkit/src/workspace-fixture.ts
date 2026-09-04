import { spawn } from "node:child_process";
import {
  mkdir,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";

import {
  createTemporaryDirectoryFixture,
  type TemporaryDirectoryFixture
} from "./temporary-directory-fixture";

export interface WorkspaceFixture {
  containerPath: string;
  metaRootPath: string;
  directRepositoryPath: string;
  nestedRepositoryPath: string;
  ignoredRepositoryPath: string;
  directoryRootPath: string;
  directoryRepositoryPath: string;
  standaloneRepositoryPath: string;
  linkedWorktreePath: string;
  emptyDirectoryPath: string;
  dispose(): Promise<void>;
}

export async function createWorkspaceFixture(): Promise<WorkspaceFixture> {
  const temporary =
    await createTemporaryDirectoryFixture("workspace-tree");
  const metaRootPath = join(
    temporary.path,
    "meta root & 元仓库"
  );
  const directRepositoryPath = join(metaRootPath, "core");
  const nestedRepositoryPath = join(
    metaRootPath,
    "svr",
    "ScResSvr"
  );
  const ignoredRepositoryPath = join(
    metaRootPath,
    "node_modules",
    "ignored-repository"
  );
  const directoryRootPath = join(
    temporary.path,
    "directory workspace"
  );
  const directoryRepositoryPath = join(
    directoryRootPath,
    "web",
    "client-app"
  );
  const standaloneRepositoryPath = join(
    temporary.path,
    "ordinary repository"
  );
  const linkedWorktreePath = join(
    temporary.path,
    "linked worktree"
  );
  const emptyDirectoryPath = join(
    temporary.path,
    "empty directory"
  );

  await initializeRepository(metaRootPath, "Meta root");
  await initializeRepository(directRepositoryPath, "Core");
  await initializeRepository(nestedRepositoryPath, "Nested");
  await initializeRepository(ignoredRepositoryPath, "Ignored");
  await initializeRepository(
    directoryRepositoryPath,
    "Directory repository"
  );
  await initializeRepository(
    standaloneRepositoryPath,
    "Standalone"
  );
  await mkdir(emptyDirectoryPath, { recursive: true });
  await runGit(metaRootPath, [
    "worktree",
    "add",
    "-b",
    "linked/test",
    linkedWorktreePath
  ]);

  return {
    containerPath: temporary.path,
    metaRootPath,
    directRepositoryPath,
    nestedRepositoryPath,
    ignoredRepositoryPath,
    directoryRootPath,
    directoryRepositoryPath,
    standaloneRepositoryPath,
    linkedWorktreePath,
    emptyDirectoryPath,
    dispose: () => temporary.dispose()
  };
}

async function initializeRepository(
  path: string,
  subject: string
): Promise<void> {
  await mkdir(path, { recursive: true });
  await runGit(path, ["init", "--initial-branch=main"]);
  await runGit(path, ["config", "user.name", "GitNest Test"]);
  await runGit(path, [
    "config",
    "user.email",
    "gitnest@example.invalid"
  ]);
  await writeFile(
    join(path, "README.md"),
    `# ${subject}\n`,
    "utf8"
  );
  await runGit(path, ["add", "README.md"]);
  await runGit(path, ["commit", "-m", subject]);
}

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
      stdio: ["ignore", "ignore", "pipe"]
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
