import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

import {
  parseGitLfsVersion,
  parseGitVersion,
  type GitEnvironment,
  type GitReadOptions
} from "@gitnest/git-core";

import { runProcess } from "../process/git-process-runner";

export async function readGitEnvironment(
  executablePath: string,
  options: GitReadOptions = {}
): Promise<GitEnvironment> {
  const commandOptions = {
    executable: executablePath,
    signal: options.signal,
    priority: options.priority,
    timeoutMs: options.timeoutMs
  };
  const versionResult = await runProcess({
    ...commandOptions,
    args: ["--version"]
  });
  const [
    lfsResult,
    helpersResult,
    identityNameResult,
    identityEmailResult,
    sshConfigExists
  ] = await Promise.all([
    runProcess({
      ...commandOptions,
      args: ["lfs", "version"],
      allowFailure: true
    }),
    runProcess({
      ...commandOptions,
      args: ["config", "--get-all", "credential.helper"],
      allowFailure: true
    }),
    runProcess({
      ...commandOptions,
      args: ["config", "--global", "--get", "user.name"],
      allowFailure: true
    }),
    runProcess({
      ...commandOptions,
      args: ["config", "--global", "--get", "user.email"],
      allowFailure: true
    }),
    detectSshConfig()
  ]);
  const lfsVersion =
    lfsResult.exitCode === 0
      ? parseGitLfsVersion(lfsResult.stdout)
      : undefined;
  const identityName =
    identityNameResult.exitCode === 0
      ? identityNameResult.stdout.trim()
      : "";
  const identityEmail =
    identityEmailResult.exitCode === 0
      ? identityEmailResult.stdout.trim()
      : "";
  const sshConfigPath = process.env.USERPROFILE
    ? join(process.env.USERPROFILE, ".ssh", "config")
    : undefined;

  return {
    executablePath,
    version: parseGitVersion(versionResult.stdout),
    lfs: {
      available: Boolean(lfsVersion),
      ...(lfsVersion ? { version: lfsVersion } : {})
    },
    identity: {
      ...(identityName ? { name: identityName } : {}),
      ...(identityEmail ? { email: identityEmail } : {})
    },
    credentialHelpers: helpersResult.stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean),
    ssh: {
      command:
        process.env.GIT_SSH_COMMAND ??
        process.env.GIT_SSH ??
        "ssh",
      authSockConfigured: Boolean(process.env.SSH_AUTH_SOCK),
      ...(sshConfigPath ? { configPath: sshConfigPath } : {}),
      configExists: sshConfigExists
    },
    detectedAt: new Date().toISOString()
  };
}

async function detectSshConfig(): Promise<boolean> {
  if (!process.env.USERPROFILE) {
    return false;
  }

  try {
    await access(
      join(process.env.USERPROFILE, ".ssh", "config"),
      constants.F_OK
    );
    return true;
  } catch {
    return false;
  }
}
