import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join } from "node:path";

import {
  GitError,
  type GitReadPriority
} from "@gitnest/git-core";

import { runProcess } from "../process/git-process-runner";

export async function findGitExecutable(
  signal?: AbortSignal,
  priority?: GitReadPriority
): Promise<string> {
  const configuredPath = process.env.GITNEST_GIT_PATH;

  if (configuredPath) {
    if (!isAbsolute(configuredPath)) {
      throw new GitError(
        "GIT_NOT_FOUND",
        "GITNEST_GIT_PATH must be an absolute path."
      );
    }

    if (await isExecutableFile(configuredPath)) {
      return normalizeExecutablePath(configuredPath);
    }
  }

  const located = await findOnPath(signal, priority);

  if (located) {
    return located;
  }

  for (const candidate of commonWindowsLocations()) {
    if (await isExecutableFile(candidate)) {
      return normalizeExecutablePath(candidate);
    }
  }

  throw new GitError(
    "GIT_NOT_FOUND",
    "Git for Windows was not found on PATH or in a standard installation location."
  );
}

async function findOnPath(
  signal?: AbortSignal,
  priority?: GitReadPriority
): Promise<string | undefined> {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = await runProcess({
    executable: locator,
    args: ["git"],
    signal,
    priority,
    timeoutMs: 5_000,
    outputLimitBytes: 64 * 1024,
    allowFailure: true
  });

  if (result.exitCode !== 0) {
    return undefined;
  }

  for (const line of result.stdout.split(/\r?\n/)) {
    const candidate = line.trim();

    if (candidate && (await isExecutableFile(candidate))) {
      return normalizeExecutablePath(candidate);
    }
  }

  return undefined;
}

function commonWindowsLocations(): string[] {
  if (process.platform !== "win32") {
    return [];
  }

  return [
    process.env.ProgramFiles
      ? join(process.env.ProgramFiles, "Git", "cmd", "git.exe")
      : undefined,
    process.env["ProgramFiles(x86)"]
      ? join(
          process.env["ProgramFiles(x86)"],
          "Git",
          "cmd",
          "git.exe"
        )
      : undefined,
    process.env.LOCALAPPDATA
      ? join(
          process.env.LOCALAPPDATA,
          "Programs",
          "Git",
          "cmd",
          "git.exe"
        )
      : undefined
  ].filter((value): value is string => Boolean(value));
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function normalizeExecutablePath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}
