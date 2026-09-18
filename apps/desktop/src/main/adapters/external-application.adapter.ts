import { spawn } from "node:child_process";
import {
  access,
  readdir,
  stat
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep
} from "node:path";

import { app, shell } from "electron";

import type {
  ExternalApplicationPort,
  ExternalApplicationProfile,
  ExternalTerminalPort
} from "@gitnest/application";
import { GitError } from "@gitnest/git-core";

type EditorApplicationKind =
  | "vscode"
  | "cursor"
  | "intellij-idea"
  | "sublime-text";

export interface ExternalApplicationLaunch {
  executable: string;
  args: string[];
  cwd: string;
}

export interface WindowsExternalApplicationAdapterOptions {
  resolveExecutable?: (
    kind: EditorApplicationKind
  ) => Promise<string | undefined>;
  pathExists?: (path: string) => Promise<boolean>;
  isDirectory?: (path: string) => Promise<boolean>;
  launch?: (
    request: ExternalApplicationLaunch
  ) => Promise<void>;
  openDirectory?: (path: string) => Promise<string>;
  loadIcon?: (path: string) => Promise<string | undefined>;
  resolveWindowsTerminalIcon?: () => Promise<
    string | undefined
  >;
}

export class WindowsExternalApplicationAdapter
  implements ExternalApplicationPort
{
  readonly #terminal: ExternalTerminalPort;
  readonly #resolveExecutable: NonNullable<
    WindowsExternalApplicationAdapterOptions["resolveExecutable"]
  >;
  readonly #pathExists: NonNullable<
    WindowsExternalApplicationAdapterOptions["pathExists"]
  >;
  readonly #isDirectory: NonNullable<
    WindowsExternalApplicationAdapterOptions["isDirectory"]
  >;
  readonly #launch: NonNullable<
    WindowsExternalApplicationAdapterOptions["launch"]
  >;
  readonly #openDirectory: NonNullable<
    WindowsExternalApplicationAdapterOptions["openDirectory"]
  >;
  readonly #loadIcon: NonNullable<
    WindowsExternalApplicationAdapterOptions["loadIcon"]
  >;
  readonly #resolveWindowsTerminalIcon: NonNullable<
    WindowsExternalApplicationAdapterOptions["resolveWindowsTerminalIcon"]
  >;

  constructor(
    terminal: ExternalTerminalPort,
    options: WindowsExternalApplicationAdapterOptions = {}
  ) {
    this.#terminal = terminal;
    this.#resolveExecutable =
      options.resolveExecutable ??
      resolveWindowsEditorExecutable;
    this.#pathExists = options.pathExists ?? pathExists;
    this.#isDirectory = options.isDirectory ?? isDirectory;
    this.#launch = options.launch ?? launchDetachedApplication;
    this.#openDirectory =
      options.openDirectory ?? ((path) => shell.openPath(path));
    this.#loadIcon =
      options.loadIcon ?? loadWindowsApplicationIcon;
    this.#resolveWindowsTerminalIcon =
      options.resolveWindowsTerminalIcon ??
      findWindowsTerminalIconExecutable;
  }

  async listAvailable(): Promise<
    ExternalApplicationProfile[]
  > {
    const [
      vscode,
      cursor,
      intellijIdea,
      sublimeText,
      terminals
    ] = await Promise.all([
      this.#resolveExecutable("vscode"),
      this.#resolveExecutable("cursor"),
      this.#resolveExecutable("intellij-idea"),
      this.#resolveExecutable("sublime-text"),
      this.#terminal.listAvailable()
    ]);
    const profiles: ExternalApplicationProfile[] = [];

    pushEditorProfile(profiles, "vscode", "VS Code", vscode);
    pushEditorProfile(profiles, "cursor", "Cursor", cursor);
    pushEditorProfile(
      profiles,
      "intellij-idea",
      "IntelliJ IDEA",
      intellijIdea
    );
    pushEditorProfile(
      profiles,
      "sublime-text",
      "Sublime Text",
      sublimeText
    );
    profiles.push({
      kind: "file-explorer",
      label: "File Explorer"
    });

    const terminal = terminals.find(
      (profile) => profile.kind !== "git-bash"
    );
    if (terminal) {
      profiles.push({
        kind: "terminal",
        label: "Terminal",
        executablePath: terminal.executablePath,
        terminalKind: terminal.kind
      });
    }
    const gitBash = terminals.find(
      (profile) => profile.kind === "git-bash"
    );
    if (gitBash) {
      profiles.push({
        kind: "git-bash",
        label: "Git Bash",
        executablePath: gitBash.executablePath,
        terminalKind: gitBash.kind
      });
    }

    return Promise.all(
      profiles.map(async (profile) => {
        const iconPath = await resolveApplicationIconPath(
          profile,
          this.#pathExists,
          this.#resolveWindowsTerminalIcon
        );
        if (!iconPath) {
          return profile;
        }
        const iconDataUrl = await this.#loadIcon(iconPath);
        return iconDataUrl
          ? {
              ...profile,
              iconDataUrl
            }
          : profile;
      })
    );
  }

  async launch(
    profile: ExternalApplicationProfile,
    workingDirectory: string,
    filePath?: string
  ): Promise<void> {
    const cwd = normalize(workingDirectory);
    if (
      !isAbsolute(cwd) ||
      !(await this.#isDirectory(cwd))
    ) {
      throw new GitError(
        "DIRECTORY_UNAVAILABLE",
        "The external application working directory is unavailable."
      );
    }

    const targetPath = filePath
      ? resolveFilePathWithinWorkingDirectory(cwd, filePath)
      : cwd;

    if (profile.kind === "file-explorer") {
      if (filePath && (await this.#pathExists(targetPath))) {
        shell.showItemInFolder(targetPath);
        return;
      }

      const directoryPath = filePath
        ? dirname(targetPath)
        : cwd;
      let openError = await this.#openDirectory(directoryPath);
      if (openError && directoryPath !== cwd) {
        openError = await this.#openDirectory(cwd);
      }
      if (openError) {
        throw new GitError(
          "DIRECTORY_UNAVAILABLE",
          openError
        );
      }
      return;
    }

    if (
      profile.kind === "terminal" ||
      profile.kind === "git-bash"
    ) {
      const terminalWorkingDirectory = filePath
        ? dirname(targetPath)
        : cwd;
      if (
        !profile.terminalKind ||
        !profile.executablePath ||
        !(await this.#isDirectory(terminalWorkingDirectory))
      ) {
        throw new GitError(
          "INVALID_REQUEST",
          "The selected terminal profile is unavailable."
        );
      }
      await this.#terminal.launch(
        {
          kind: profile.terminalKind,
          label: profile.label,
          executablePath: profile.executablePath
        },
        terminalWorkingDirectory
      );
      return;
    }

    if (
      !profile.executablePath ||
      !isAbsolute(profile.executablePath) ||
      !(await this.#pathExists(profile.executablePath))
    ) {
      throw new GitError(
        "INVALID_REQUEST",
        "The selected external application is unavailable."
      );
    }

    await this.#launch(
      buildExternalApplicationLaunch(
        profile.kind,
        profile.executablePath,
        cwd,
        targetPath
      )
    );
  }
}

export function buildExternalApplicationLaunch(
  kind: EditorApplicationKind,
  executablePath: string,
  workingDirectory: string,
  openTarget: string = workingDirectory
): ExternalApplicationLaunch {
  const cwd = normalize(workingDirectory);
  switch (kind) {
    case "vscode":
    case "cursor":
      return {
        executable: executablePath,
        args: ["--reuse-window", openTarget],
        cwd
      };
    case "intellij-idea":
    case "sublime-text":
      return {
        executable: executablePath,
        args: [openTarget],
        cwd
      };
  }
}

function pushEditorProfile(
  profiles: ExternalApplicationProfile[],
  kind: EditorApplicationKind,
  label: string,
  executablePath: string | undefined
): void {
  if (!executablePath) {
    return;
  }
  profiles.push({
    kind,
    label,
    executablePath
  });
}

async function resolveWindowsEditorExecutable(
  kind: EditorApplicationKind
): Promise<string | undefined> {
  const executableName = {
    vscode: "Code.exe",
    cursor: "Cursor.exe",
    "intellij-idea": "idea64.exe",
    "sublime-text": "sublime_text.exe"
  }[kind];
  const pathExecutable = await findExecutableOnPath(
    executableName
  );
  if (pathExecutable && (await pathExists(pathExecutable))) {
    return pathExecutable;
  }

  for (const candidate of knownEditorPaths(kind)) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  if (kind === "intellij-idea") {
    return findIntelliJIdeaExecutable();
  }
  return undefined;
}

async function resolveApplicationIconPath(
  profile: ExternalApplicationProfile,
  pathExists: (path: string) => Promise<boolean>,
  resolveWindowsTerminalIcon: () => Promise<
    string | undefined
  >
): Promise<string | undefined> {
  if (profile.kind === "file-explorer") {
    const windowsDirectory =
      process.env.WINDIR ?? process.env.SystemRoot;
    const explorerPath = windowsDirectory
      ? join(windowsDirectory, "explorer.exe")
      : undefined;
    return explorerPath && (await pathExists(explorerPath))
      ? explorerPath
      : undefined;
  }

  if (!profile.executablePath) {
    return undefined;
  }
  if (
    profile.kind === "terminal" &&
    profile.terminalKind === "windows-terminal" &&
    isWindowsTerminalExecutionAlias(profile.executablePath)
  ) {
    return resolveWindowsTerminalIcon();
  }
  if (profile.kind === "git-bash") {
    const gitBashPath = join(
      dirname(dirname(profile.executablePath)),
      "git-bash.exe"
    );
    if (await pathExists(gitBashPath)) {
      return gitBashPath;
    }
  }
  return profile.executablePath;
}

function isWindowsTerminalExecutionAlias(
  executablePath: string
): boolean {
  return normalize(executablePath)
    .toLocaleLowerCase("en-US")
    .endsWith("\\microsoft\\windowsapps\\wt.exe");
}

async function findWindowsTerminalIconExecutable(): Promise<
  string | undefined
> {
  const programFiles = process.env.ProgramFiles;
  if (!programFiles) {
    return undefined;
  }
  const packagesDirectory = join(programFiles, "WindowsApps");
  let entries;
  try {
    entries = await readdir(packagesDirectory, {
      withFileTypes: true
    });
  } catch {
    return undefined;
  }

  const packages = entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name.startsWith("Microsoft.WindowsTerminal_")
    )
    .sort((left, right) =>
      right.name.localeCompare(left.name, "en-US", {
        numeric: true,
        sensitivity: "base"
      })
    );

  for (const packageDirectory of packages) {
    const executablePath = join(
      packagesDirectory,
      packageDirectory.name,
      "WindowsTerminal.exe"
    );
    if (await pathExists(executablePath)) {
      return executablePath;
    }
  }
  return undefined;
}

async function loadWindowsApplicationIcon(
  executablePath: string
): Promise<string | undefined> {
  try {
    const icon = await app.getFileIcon(executablePath, {
      size: "normal"
    });
    return icon.isEmpty() ? undefined : icon.toDataURL();
  } catch {
    return undefined;
  }
}

function knownEditorPaths(
  kind: EditorApplicationKind
): string[] {
  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const roots = [localAppData, programFiles, programFilesX86].filter(
    (value): value is string => Boolean(value)
  );

  switch (kind) {
    case "vscode":
      return [
        localAppData &&
          join(
            localAppData,
            "Programs",
            "Microsoft VS Code",
            "Code.exe"
          ),
        programFiles &&
          join(programFiles, "Microsoft VS Code", "Code.exe"),
        programFilesX86 &&
          join(
            programFilesX86,
            "Microsoft VS Code",
            "Code.exe"
          )
      ].filter((value): value is string => Boolean(value));
    case "cursor":
      return [
        localAppData &&
          join(localAppData, "Programs", "Cursor", "Cursor.exe"),
        localAppData &&
          join(localAppData, "Programs", "cursor", "Cursor.exe"),
        programFiles &&
          join(programFiles, "Cursor", "Cursor.exe")
      ].filter((value): value is string => Boolean(value));
    case "sublime-text":
      return roots.flatMap((root) => [
        join(root, "Sublime Text", "sublime_text.exe"),
        join(root, "Sublime Text 3", "sublime_text.exe"),
        join(
          root,
          "Programs",
          "Sublime Text",
          "sublime_text.exe"
        )
      ]);
    case "intellij-idea":
      return [
        localAppData &&
          join(
            localAppData,
            "Programs",
            "IntelliJ IDEA Ultimate",
            "bin",
            "idea64.exe"
          ),
        localAppData &&
          join(
            localAppData,
            "Programs",
            "IntelliJ IDEA Community Edition",
            "bin",
            "idea64.exe"
          )
      ].filter((value): value is string => Boolean(value));
  }
}

async function findIntelliJIdeaExecutable(): Promise<
  string | undefined
> {
  const roots = [
    process.env.LOCALAPPDATA &&
      join(
        process.env.LOCALAPPDATA,
        "JetBrains",
        "Toolbox",
        "apps"
      ),
    process.env.ProgramFiles &&
      join(process.env.ProgramFiles, "JetBrains")
  ].filter((value): value is string => Boolean(value));
  const matches: string[] = [];

  for (const root of roots) {
    await collectExecutables(
      root,
      "idea64.exe",
      6,
      matches
    );
  }

  return matches.sort((left, right) =>
    right.localeCompare(left, "en-US", {
      numeric: true,
      sensitivity: "base"
    })
  )[0];
}

async function collectExecutables(
  directory: string,
  executableName: string,
  remainingDepth: number,
  matches: string[]
): Promise<void> {
  if (remainingDepth < 0) {
    return;
  }

  let entries;
  try {
    entries = await readdir(directory, {
      withFileTypes: true
    });
  } catch {
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (
        entry.isFile() &&
        entry.name.toLocaleLowerCase("en-US") ===
          executableName.toLocaleLowerCase("en-US")
      ) {
        matches.push(path);
        return;
      }
      if (entry.isDirectory()) {
        await collectExecutables(
          path,
          executableName,
          remainingDepth - 1,
          matches
        );
      }
    })
  );
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
      resolvePromise(
        Buffer.concat(chunks)
          .toString("utf8")
          .split(/\r?\n/)
          .map((item) => item.trim())
          .find(Boolean)
      );
    });
  });
}

async function launchDetachedApplication(
  request: ExternalApplicationLaunch
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(request.executable, request.args, {
      cwd: request.cwd,
      detached: true,
      shell: false,
      windowsHide: true,
      stdio: "ignore"
    });
    child.once("error", (error) => {
      rejectPromise(
        new GitError(
          "COMMAND_FAILED",
          "Unable to open the external application.",
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

function resolveFilePathWithinWorkingDirectory(
  workingDirectory: string,
  filePath: string
): string {
  if (!filePath || isAbsolute(filePath)) {
    throw new GitError(
      "INVALID_REQUEST",
      "External application file paths must be relative to the Worktree."
    );
  }

  const resolvedPath = resolve(workingDirectory, filePath);
  const pathFromRoot = relative(
    workingDirectory,
    resolvedPath
  );
  if (
    !pathFromRoot ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "External application file paths must stay inside the selected Worktree."
    );
  }

  return resolvedPath;
}
