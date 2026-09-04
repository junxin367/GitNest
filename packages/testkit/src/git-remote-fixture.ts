import { spawn } from "node:child_process";
import {
  mkdir,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";

import {
  createTemporaryDirectoryFixture
} from "./temporary-directory-fixture";

export interface GitRemoteFixture {
  containerPath: string;
  remotePath: string;
  localPath: string;
  peerPath: string;
  dispose(): Promise<void>;
}

export async function createGitRemoteFixture(): Promise<GitRemoteFixture> {
  const temporary =
    await createTemporaryDirectoryFixture("remote");
  const remotePath = join(temporary.path, "origin.git");
  const localPath = join(
    temporary.path,
    "local & unicode 测试"
  );
  const peerPath = join(temporary.path, "peer clone");

  await mkdir(localPath, { recursive: true });
  await runGit(localPath, [
    "init",
    "--initial-branch=main"
  ]);
  await configureIdentity(localPath, "Local");
  await writeFile(
    join(localPath, "README.md"),
    "# GitNest remote fixture\n",
    "utf8"
  );
  await runGit(localPath, ["add", "README.md"]);
  await runGit(localPath, [
    "commit",
    "-m",
    "Initial remote fixture"
  ]);

  await runGit(temporary.path, [
    "init",
    "--bare",
    "--initial-branch=main",
    remotePath
  ]);
  await runGit(localPath, [
    "remote",
    "add",
    "origin",
    remotePath
  ]);
  await runGit(localPath, [
    "push",
    "--set-upstream",
    "origin",
    "main"
  ]);
  await runGit(temporary.path, [
    "clone",
    "--branch",
    "main",
    remotePath,
    peerPath
  ]);
  await configureIdentity(peerPath, "Peer");

  return {
    containerPath: temporary.path,
    remotePath,
    localPath,
    peerPath,
    dispose: () => temporary.dispose()
  };
}

async function configureIdentity(
  path: string,
  suffix: string
): Promise<void> {
  await runGit(path, [
    "config",
    "user.name",
    `GitNest ${suffix} Test`
  ]);
  await runGit(path, [
    "config",
    "user.email",
    `${suffix.toLocaleLowerCase()}@example.invalid`
  ]);
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
          `Remote fixture Git command failed (${String(exitCode)}): ${Buffer.concat(stderr).toString("utf8")}`
        )
      );
    });
  });
}
