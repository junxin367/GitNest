import { spawn } from "node:child_process";
import {
  access,
  stat
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  normalize
} from "node:path";

import {
  type ExternalTerminalPort,
  type ExternalTerminalProfile
} from "@gitnest/application";
import { GitError } from "@gitnest/git-core";

export interface ExternalTerminalLaunch {
  executable: string;
  args: string[];
  cwd: string;
}

export interface WindowsExternalTerminalAdapterOptions {
  findExecutable?: (
    executable: string
  ) => Promise<string | undefined>;
  gitExecutablePath?: () => Promise<string | undefined>;
  pathExists?: (path: string) => Promise<boolean>;
  launch?: (request: ExternalTerminalLaunch) => Promise<void>;
}

export class WindowsExternalTerminalAdapter
  implements ExternalTerminalPort
{
  readonly #findExecutable: NonNullable<
    WindowsExternalTerminalAdapterOptions["findExecutable"]
  >;
  readonly #gitExecutablePath:
    | NonNullable<
        WindowsExternalTerminalAdapterOptions["gitExecutablePath"]
      >
    | undefined;
  readonly #pathExists: NonNullable<
    WindowsExternalTerminalAdapterOptions["pathExists"]
  >;
  readonly #launch: NonNullable<
    WindowsExternalTerminalAdapterOptions["launch"]
  >;

  constructor(
    options: WindowsExternalTerminalAdapterOptions = {}
  ) {
    this.#findExecutable =
      options.findExecutable ?? findExecutableOnPath;
    this.#gitExecutablePath = options.gitExecutablePath;
    this.#pathExists = options.pathExists ?? pathExists;
    this.#launch = options.launch ?? launchDetachedTerminal;
  }

  async listAvailable(): Promise<ExternalTerminalProfile[]> {
    const [
      windowsTerminal,
      powerShellCore,
      windowsPowerShell,
      commandPrompt,
      gitExecutable
    ] = await Promise.all([
      this.#findExecutable("wt.exe"),
      this.#findExecutable("pwsh.exe"),
      this.#findExecutable("powershell.exe"),
      resolveCommandPrompt(
        this.#findExecutable,
        this.#pathExists
      ),
      resolveGitExecutable(
        this.#findExecutable,
        this.#gitExecutablePath
      )
    ]);
    const profiles: ExternalTerminalProfile[] = [];

    if (windowsTerminal) {
      profiles.push({
        kind: "windows-terminal",
        label: "Windows Terminal",
        executablePath: windowsTerminal
      });
    }
    const powerShell = powerShellCore ?? windowsPowerShell;
    if (powerShell) {
      profiles.push({
        kind: "powershell",
        label: powerShellCore
          ? "PowerShell 7"
          : "Windows PowerShell",
        executablePath: powerShell
      });
    }
    if (commandPrompt) {
      profiles.push({
        kind: "cmd",
        label: "Command Prompt",
        executablePath: commandPrompt
      });
    }
    if (gitExecutable) {
      const gitBash = join(
        dirname(dirname(gitExecutable)),
        "bin",
        "bash.exe"
      );
      if (await this.#pathExists(gitBash)) {
        profiles.push({
          kind: "git-bash",
          label: "Git Bash",
          executablePath: gitBash
        });
      }
    }

    return profiles;
  }

  async launch(
    profile: ExternalTerminalProfile,
    workingDirectory: string
  ): Promise<void> {
    if (
      !isAbsolute(profile.executablePath) ||
      !(await this.#pathExists(profile.executablePath))
    ) {
      throw new GitError(
        "INVALID_REQUEST",
        "The selected terminal executable is unavailable."
      );
    }
    if (
      !isAbsolute(workingDirectory) ||
      !(await isDirectory(workingDirectory))
    ) {
      throw new GitError(
        "DIRECTORY_UNAVAILABLE",
        "The terminal working directory is unavailable."
      );
    }

    await this.#launch(
      buildExternalTerminalLaunch(profile, workingDirectory)
    );
  }
}

export function buildExternalTerminalLaunch(
  profile: ExternalTerminalProfile,
  workingDirectory: string
): ExternalTerminalLaunch {
  const cwd = normalize(workingDirectory);
  switch (profile.kind) {
    case "windows-terminal":
      return {
        executable: profile.executablePath,
        args: ["-d", cwd],
        cwd
      };
    case "powershell":
      return {
        executable: profile.executablePath,
        args: ["-NoLogo", "-NoExit"],
        cwd
      };
    case "cmd":
      return {
        executable: profile.executablePath,
        args: ["/K"],
        cwd
      };
    case "git-bash":
      return {
        executable: profile.executablePath,
        args: ["--login", "-i"],
        cwd
      };
  }
}

async function resolveCommandPrompt(
  findExecutable: (
    executable: string
  ) => Promise<string | undefined>,
  exists: (path: string) => Promise<boolean>
): Promise<string | undefined> {
  const configured = process.env.COMSPEC;
  if (
    configured &&
    isAbsolute(configured) &&
    (await exists(configured))
  ) {
    return configured;
  }
  return findExecutable("cmd.exe");
}

async function resolveGitExecutable(
  findExecutable: (
    executable: string
  ) => Promise<string | undefined>,
  configured:
    | (() => Promise<string | undefined>)
    | undefined
): Promise<string | undefined> {
  return (await configured?.()) ??
    findExecutable("git.exe");
}

async function findExecutableOnPath(
  executable: string
): Promise<string | undefined> {
  return new Promise((resolvePromise) => {
    const child = spawn("where.exe", [executable], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    child.once("error", () => resolvePromise(undefined));
    child.once("close", (exitCode) => {
      if (exitCode !== 0) {
        resolvePromise(undefined);
        return;
      }
      const first = Buffer.concat(chunks)
        .toString("utf8")
        .split(/\r?\n/)
        .map((item) => item.trim())
        .find(Boolean);
      resolvePromise(first);
    });
  });
}

async function launchDetachedTerminal(
  request: ExternalTerminalLaunch
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(request.executable, request.args, {
      cwd: request.cwd,
      detached: true,
      shell: false,
      windowsHide: false,
      stdio: "ignore"
    });
    child.once("error", (error) => {
      rejectPromise(
        new GitError(
          "COMMAND_FAILED",
          "Unable to open the external terminal.",
          { cause: error.message }
        )
      );
    });
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
