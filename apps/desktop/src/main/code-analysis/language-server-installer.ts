import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  readFile
} from "node:fs/promises";
import {
  basename,
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
  sep
} from "node:path";

import { resolveWindowsEditorJdtls } from "@gitnest/code-analysis";
import type {
  InstallableLanguageServerDto,
  LanguageServerInstallResultDto
} from "@gitnest/contracts";
import { GitError } from "@gitnest/git-core";

interface CommandLaunch {
  command: string;
  args: string[];
  env?: Readonly<Record<string, string>>;
}

interface CommandRequest extends CommandLaunch {
  cwd: string;
  timeoutMs: number;
}

interface CommandOutput {
  stdout: string;
  stderr: string;
}

type JdtlsLaunch = {
  command: string;
  args: string[];
};

export interface LanguageServerInstallerOptions {
  runtimeDirectory: string;
  updateLanguageServerSettings(
    language: InstallableLanguageServerDto,
    command: string,
    args: string[]
  ): Promise<void>;
  platform?: NodeJS.Platform;
  ensureDirectory?: (path: string) => Promise<void>;
  pathExists?: (path: string) => Promise<boolean>;
  resolveNpmLaunch?: () => Promise<
    CommandLaunch | undefined
  >;
  resolveEditorCliLaunch?: () => Promise<
    CommandLaunch | undefined
  >;
  resolveJdtls?: (
    args: string[]
  ) => Promise<JdtlsLaunch | undefined>;
  runCommand?: (
    request: CommandRequest
  ) => Promise<CommandOutput>;
}

const INSTALL_TIMEOUT_MS = 10 * 60_000;
const TYPESCRIPT_LANGUAGE_SERVER_PACKAGE =
  "typescript-language-server@6";
const TYPESCRIPT_PACKAGE = "typescript@6";
const JAVA_EXTENSION_ID = "redhat.java";

export class LanguageServerInstaller {
  readonly #runtimeDirectory: string;
  readonly #updateLanguageServerSettings: LanguageServerInstallerOptions["updateLanguageServerSettings"];
  readonly #platform: NodeJS.Platform;
  readonly #ensureDirectory: NonNullable<
    LanguageServerInstallerOptions["ensureDirectory"]
  >;
  readonly #pathExists: NonNullable<
    LanguageServerInstallerOptions["pathExists"]
  >;
  readonly #resolveNpmLaunch: NonNullable<
    LanguageServerInstallerOptions["resolveNpmLaunch"]
  >;
  readonly #resolveEditorCliLaunch: NonNullable<
    LanguageServerInstallerOptions["resolveEditorCliLaunch"]
  >;
  readonly #resolveJdtls: NonNullable<
    LanguageServerInstallerOptions["resolveJdtls"]
  >;
  readonly #runCommand: NonNullable<
    LanguageServerInstallerOptions["runCommand"]
  >;
  readonly #installing =
    new Set<InstallableLanguageServerDto>();

  constructor(options: LanguageServerInstallerOptions) {
    this.#runtimeDirectory = resolve(
      options.runtimeDirectory
    );
    this.#updateLanguageServerSettings =
      options.updateLanguageServerSettings;
    this.#platform = options.platform ?? process.platform;
    this.#ensureDirectory =
      options.ensureDirectory ??
      (async (path) => {
        await mkdir(path, { recursive: true });
      });
    this.#pathExists = options.pathExists ?? pathExists;
    this.#resolveNpmLaunch =
      options.resolveNpmLaunch ??
      (() => resolveNpmLaunch(this.#platform));
    this.#resolveEditorCliLaunch =
      options.resolveEditorCliLaunch ??
      (() => resolveEditorCliLaunch(this.#platform));
    this.#resolveJdtls =
      options.resolveJdtls ??
      ((args) => resolveWindowsEditorJdtls(args));
    this.#runCommand = options.runCommand ?? runCommand;
  }

  async install(
    language: InstallableLanguageServerDto
  ): Promise<LanguageServerInstallResultDto> {
    if (this.#installing.has(language)) {
      throw new GitError(
        "INVALID_REQUEST",
        `${
          language === "typescript" ? "TypeScript" : "Java"
        } Language Server 正在安装。`
      );
    }
    this.#installing.add(language);
    try {
      await this.#ensureDirectory(this.#runtimeDirectory);
      return language === "typescript"
        ? await this.#installTypeScript()
        : await this.#installJava();
    } finally {
      this.#installing.delete(language);
    }
  }

  async #installTypeScript(): Promise<LanguageServerInstallResultDto> {
    const npmLaunch = await this.#resolveNpmLaunch();
    if (!npmLaunch) {
      throw new GitError(
        "COMMAND_FAILED",
        "未检测到可安全调用的 Node.js 与 npm。请先安装 Node.js 22.22.2 或更高版本。"
      );
    }

    const installDirectory = join(
      this.#runtimeDirectory,
      "typescript"
    );
    await this.#ensureDirectory(installDirectory);
    await this.#runCommand({
      ...npmLaunch,
      args: [
        ...npmLaunch.args,
        "install",
        "--prefix",
        installDirectory,
        "--no-save",
        "--no-package-lock",
        "--no-audit",
        "--no-fund",
        "--omit=dev",
        TYPESCRIPT_LANGUAGE_SERVER_PACKAGE,
        TYPESCRIPT_PACKAGE
      ],
      cwd: installDirectory,
      timeoutMs: INSTALL_TIMEOUT_MS
    });

    const command = join(
      installDirectory,
      "node_modules",
      ".bin",
      this.#platform === "win32"
        ? "typescript-language-server.cmd"
        : "typescript-language-server"
    );
    if (!(await this.#pathExists(command))) {
      throw new GitError(
        "COMMAND_FAILED",
        "npm 已结束，但 GitNest 未找到 TypeScript Language Server 可执行文件。"
      );
    }

    await this.#updateLanguageServerSettings(
      "typescript",
      command,
      ["--stdio"]
    );
    return {
      language: "typescript",
      status: "installed",
      command,
      message:
        "TypeScript Language Server 已安装到 GitNest 应用数据目录。"
    };
  }

  async #installJava(): Promise<LanguageServerInstallResultDto> {
    if (await this.#resolveJdtls([])) {
      await this.#updateLanguageServerSettings(
        "java",
        "jdtls",
        []
      );
      return {
        language: "java",
        status: "already-installed",
        command: "jdtls",
        message:
          "已检测到可用的 Java Language Server，无需重复安装。"
      };
    }

    const editorCli = await this.#resolveEditorCliLaunch();
    if (!editorCli) {
      throw new GitError(
        "COMMAND_FAILED",
        "未检测到 VS Code 或 Cursor 命令行工具，无法自动安装 Java Language Server。"
      );
    }
    await this.#runCommand({
      ...editorCli,
      args: [
        ...editorCli.args,
        "--install-extension",
        JAVA_EXTENSION_ID,
        "--force"
      ],
      cwd: this.#runtimeDirectory,
      timeoutMs: INSTALL_TIMEOUT_MS
    });

    let discovered: JdtlsLaunch | undefined;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      discovered = await this.#resolveJdtls([]);
      if (discovered) {
        break;
      }
      await delay(250);
    }
    if (!discovered) {
      throw new GitError(
        "COMMAND_FAILED",
        "扩展安装命令已完成，但 GitNest 尚未检测到 JDT LS。请重启编辑器后重试。"
      );
    }

    await this.#updateLanguageServerSettings(
      "java",
      "jdtls",
      []
    );
    return {
      language: "java",
      status: "installed",
      command: "jdtls",
      message:
        "Java Language Server 已通过编辑器扩展安装并通过检测。"
    };
  }
}

async function resolveNpmLaunch(
  platform: NodeJS.Platform
): Promise<CommandLaunch | undefined> {
  if (platform !== "win32") {
    const npmCommand = await findCommandOnPath("npm", platform);
    return npmCommand
      ? { command: npmCommand, args: [] }
      : undefined;
  }

  const npmShim = await findCommandOnPath("npm", platform);
  if (!npmShim) {
    return undefined;
  }
  const shimDirectory = dirname(npmShim);
  const npmCliCandidates = [
    join(
      shimDirectory,
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js"
    ),
    process.env.npm_execpath &&
    basename(process.env.npm_execpath).toLocaleLowerCase(
      "en-US"
    ) === "npm-cli.js"
      ? process.env.npm_execpath
      : undefined,
    await npmCliFromShim(npmShim)
  ].filter((value): value is string => Boolean(value));
  const nodeCandidates = [
    join(shimDirectory, "node.exe"),
    process.env.npm_node_execpath,
    await findCommandOnPath("node.exe", platform)
  ].filter((value): value is string => Boolean(value));
  const [npmCli, nodeCommand] = await Promise.all([
    firstExistingPath(npmCliCandidates),
    firstExistingPath(nodeCandidates)
  ]);
  return npmCli && nodeCommand
    ? {
        command: nodeCommand,
        args: [npmCli]
      }
    : undefined;
}

async function npmCliFromShim(
  shimPath: string
): Promise<string | undefined> {
  try {
    const contents = await readFile(shimPath, "utf8");
    const match =
      /SET\s+"NPM_CLI_JS=%~dp0[\\/]([^"]*npm-cli\.js)"/i.exec(
        contents
      );
    return match?.[1]
      ? resolve(
          dirname(shimPath),
          match[1].replace(/[\\/]/g, sep)
        )
      : undefined;
  } catch {
    return undefined;
  }
}

async function resolveEditorCliLaunch(
  platform: NodeJS.Platform
): Promise<CommandLaunch | undefined> {
  if (platform !== "win32") {
    for (const command of ["code", "cursor"]) {
      const resolved = await findCommandOnPath(
        command,
        platform
      );
      if (resolved) {
        return { command: resolved, args: [] };
      }
    }
    return undefined;
  }

  const candidates = (
    await Promise.all([
      findCommandOnPath("code.cmd", platform),
      findCommandOnPath("cursor.cmd", platform)
    ])
  )
    .filter((value): value is string => Boolean(value))
    .concat(knownEditorCliShims());
  for (const candidate of [...new Set(candidates)]) {
    const launch = await parseEditorCliShim(candidate);
    if (launch) {
      return launch;
    }
  }
  return undefined;
}

function knownEditorCliShims(): string[] {
  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  return [
    localAppData &&
      join(
        localAppData,
        "Programs",
        "Microsoft VS Code",
        "bin",
        "code.cmd"
      ),
    programFiles &&
      join(
        programFiles,
        "Microsoft VS Code",
        "bin",
        "code.cmd"
      ),
    programFilesX86 &&
      join(
        programFilesX86,
        "Microsoft VS Code",
        "bin",
        "code.cmd"
      ),
    localAppData &&
      join(
        localAppData,
        "Programs",
        "Cursor",
        "resources",
        "app",
        "bin",
        "cursor.cmd"
      )
  ].filter((value): value is string => Boolean(value));
}

async function parseEditorCliShim(
  shimPath: string
): Promise<CommandLaunch | undefined> {
  let contents: string;
  try {
    contents = await readFile(shimPath, "utf8");
  } catch {
    return undefined;
  }
  const match =
    /"%~dp0([^"]+\.exe)"\s+"%~dp0([^"]+[\\/]cli\.js)"\s+%\*/i.exec(
      contents
    );
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  const shimDirectory = dirname(shimPath);
  const command = resolve(
    shimDirectory,
    match[1].replace(/[\\/]/g, sep)
  );
  const cliScript = resolve(
    shimDirectory,
    match[2].replace(/[\\/]/g, sep)
  );
  if (
    !(await pathExists(command)) ||
    !(await pathExists(cliScript))
  ) {
    return undefined;
  }
  return {
    command,
    args: [cliScript],
    env: {
      ELECTRON_RUN_AS_NODE: "1"
    }
  };
}

async function findCommandOnPath(
  command: string,
  platform: NodeJS.Platform
): Promise<string | undefined> {
  if (isAbsolute(command) || /[\\/]/.test(command)) {
    return (await pathExists(command))
      ? resolve(command)
      : undefined;
  }
  const directories = (process.env.PATH ?? "")
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
  const extensions =
    platform === "win32" && !extname(command)
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [""];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = join(
        directory,
        `${command}${extension}`
      );
      if (await pathExists(candidate)) {
        return resolve(candidate);
      }
    }
  }
  return undefined;
}

async function firstExistingPath(
  candidates: string[]
): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return resolve(candidate);
    }
  }
  return undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(
  request: CommandRequest
): Promise<CommandOutput> {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: {
        ...process.env,
        ...request.env
      },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const finish = (
      action: () => void
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() =>
        rejectPromise(
          new GitError(
            "COMMAND_TIMEOUT",
            "Language Server 安装超时，请检查网络后重试。"
          )
        )
      );
    }, request.timeoutMs);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendOutput(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendOutput(stderr, chunk);
    });
    child.once("error", (error) => {
      finish(() =>
        rejectPromise(
          new GitError(
            "COMMAND_FAILED",
            "无法启动 Language Server 安装程序。",
            { cause: error.message }
          )
        )
      );
    });
    child.once("close", (exitCode) => {
      finish(() => {
        if (exitCode === 0) {
          resolvePromise({ stdout, stderr });
          return;
        }
        rejectPromise(
          new GitError(
            "COMMAND_FAILED",
            "Language Server 安装失败。",
            {
              exitCode: exitCode ?? -1,
              output:
                stderr.trim() ||
                stdout.trim() ||
                "No installer output."
            }
          )
        );
      });
    });
  });
}

function appendOutput(
  current: string,
  chunk: Buffer
): string {
  return `${current}${chunk.toString("utf8")}`.slice(
    -8_000
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}
