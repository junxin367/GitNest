import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  access,
  chmod as chmodPath,
  mkdir,
  readFile,
  unlink
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
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";

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

interface InstalledLanguageServer {
  command: string;
  args: string[];
}

type JdtlsLaunch = {
  command: string;
  args: string[];
};

type DownloadFile = (
  url: string,
  destinationPath: string
) => Promise<void>;

type ExtractArchive = (
  archivePath: string,
  destinationPath: string
) => Promise<void>;

type ChangeMode = (
  path: string,
  mode: number
) => Promise<void>;

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
  resolveCommand?: (
    command: string
  ) => Promise<string | undefined>;
  runCommand?: (
    request: CommandRequest
  ) => Promise<CommandOutput>;
  download?: DownloadFile;
  extract?: ExtractArchive;
  arch?: NodeJS.Architecture;
  chmod?: ChangeMode;
}

const INSTALL_TIMEOUT_MS = 10 * 60_000;
const COMMAND_PROBE_TIMEOUT_MS = 30_000;
const JAVA_EXTENSION_ID = "redhat.java";
const KOTLIN_LANGUAGE_SERVER_VERSION = "263.4702.0";
const CSHARP_LANGUAGE_SERVER_VERSION = "0.28.0";

interface LanguageServerStrategyBase {
  language: InstallableLanguageServerDto;
  displayName: string;
  directoryName: string;
  args: string[];
  installedMessage: string;
}

interface NpmLanguageServerStrategy
  extends LanguageServerStrategyBase {
  kind: "npm";
  packages: string[];
  executable: string;
}

interface JavaLanguageServerStrategy
  extends LanguageServerStrategyBase {
  kind: "java";
}

interface GoLanguageServerStrategy
  extends LanguageServerStrategyBase {
  kind: "go";
}

interface KotlinLanguageServerStrategy
  extends LanguageServerStrategyBase {
  kind: "kotlin";
}

interface CSharpLanguageServerStrategy
  extends LanguageServerStrategyBase {
  kind: "csharp";
}

interface RustLanguageServerStrategy
  extends LanguageServerStrategyBase {
  kind: "rust";
}

type LanguageServerStrategy =
  | NpmLanguageServerStrategy
  | JavaLanguageServerStrategy
  | GoLanguageServerStrategy
  | KotlinLanguageServerStrategy
  | CSharpLanguageServerStrategy
  | RustLanguageServerStrategy;

const LANGUAGE_SERVER_STRATEGIES = {
  typescript: {
    kind: "npm",
    language: "typescript",
    displayName: "TypeScript",
    directoryName: "typescript",
    packages: [
      "typescript-language-server@6",
      "typescript@6"
    ],
    executable: "typescript-language-server",
    args: ["--stdio"],
    installedMessage:
      "TypeScript Language Server 已安装到 GitNest 应用数据目录。"
  },
  vue: {
    kind: "npm",
    language: "vue",
    displayName: "Vue",
    directoryName: "vue",
    packages: [
      "@vue/language-server@3",
      "typescript@6"
    ],
    executable: "vue-language-server",
    args: ["--stdio"],
    installedMessage:
      "Vue Language Server 已安装到 GitNest 应用数据目录。"
  },
  java: {
    kind: "java",
    language: "java",
    displayName: "Java",
    directoryName: "java",
    args: [],
    installedMessage:
      "Java Language Server 已通过编辑器扩展安装并通过检测。"
  },
  python: {
    kind: "npm",
    language: "python",
    displayName: "Python",
    directoryName: "python",
    packages: ["pyright@1.1.414"],
    executable: "pyright-langserver",
    args: ["--stdio"],
    installedMessage:
      "Python Language Server 已安装到 GitNest 应用数据目录。"
  },
  go: {
    kind: "go",
    language: "go",
    displayName: "Go",
    directoryName: "go",
    args: ["serve"],
    installedMessage:
      "Go Language Server 已安装到 GitNest 应用数据目录。"
  },
  kotlin: {
    kind: "kotlin",
    language: "kotlin",
    displayName: "Kotlin",
    directoryName: "kotlin",
    args: ["--stdio"],
    installedMessage:
      "Kotlin Language Server 已安装到 GitNest 应用数据目录。"
  },
  csharp: {
    kind: "csharp",
    language: "csharp",
    displayName: "C#",
    directoryName: "csharp",
    args: [],
    installedMessage:
      "C# Language Server 已安装到 GitNest 应用数据目录。"
  },
  rust: {
    kind: "rust",
    language: "rust",
    displayName: "Rust",
    directoryName: "rust",
    args: [],
    installedMessage:
      "Rust Language Server 已通过 rustup 安装并通过检测。"
  }
} satisfies Record<
  InstallableLanguageServerDto,
  LanguageServerStrategy
>;

export class LanguageServerInstaller {
  readonly #runtimeDirectory: string;
  readonly #updateLanguageServerSettings: LanguageServerInstallerOptions["updateLanguageServerSettings"];
  readonly #platform: NodeJS.Platform;
  readonly #arch: NodeJS.Architecture;
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
  readonly #resolveCommand: NonNullable<
    LanguageServerInstallerOptions["resolveCommand"]
  >;
  readonly #runCommand: NonNullable<
    LanguageServerInstallerOptions["runCommand"]
  >;
  readonly #download: DownloadFile;
  readonly #extract: ExtractArchive;
  readonly #chmod: ChangeMode;
  readonly #installing =
    new Set<InstallableLanguageServerDto>();

  constructor(options: LanguageServerInstallerOptions) {
    this.#runtimeDirectory = resolve(
      options.runtimeDirectory
    );
    this.#updateLanguageServerSettings =
      options.updateLanguageServerSettings;
    this.#platform = options.platform ?? process.platform;
    this.#arch = options.arch ?? process.arch;
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
    this.#resolveCommand =
      options.resolveCommand ??
      ((command) =>
        findCommandOnPath(command, this.#platform));
    this.#runCommand = options.runCommand ?? runCommand;
    this.#download = options.download ?? downloadFile;
    this.#extract =
      options.extract ??
      ((archivePath, destinationPath) =>
        extractArchive({
          archivePath,
          destinationPath,
          platform: this.#platform,
          resolveCommand: this.#resolveCommand,
          runCommand: this.#runCommand
        }));
    this.#chmod =
      options.chmod ??
      (async (path, mode) => {
        await chmodPath(path, mode);
      });
  }

  async install(
    language: InstallableLanguageServerDto
  ): Promise<LanguageServerInstallResultDto> {
    const strategy = LANGUAGE_SERVER_STRATEGIES[language];
    if (this.#installing.has(language)) {
      throw new GitError(
        "INVALID_REQUEST",
        `${strategy.displayName} Language Server 正在安装。`
      );
    }
    this.#installing.add(language);
    try {
      const existing =
        await this.#probeInstalledLanguageServer(strategy);
      if (existing) {
        return await this.#persistResult(
          strategy,
          existing,
          "already-installed"
        );
      }

      await this.#ensureDirectory(this.#runtimeDirectory);
      const installed =
        await this.#installLanguageServer(strategy);
      return await this.#persistResult(
        strategy,
        installed,
        "installed"
      );
    } finally {
      this.#installing.delete(language);
    }
  }

  async #probeInstalledLanguageServer(
    strategy: LanguageServerStrategy
  ): Promise<InstalledLanguageServer | undefined> {
    switch (strategy.kind) {
      case "npm": {
        const installed = await this.#probePath(
          this.#npmExecutablePath(strategy),
          strategy.args
        );
        if (!installed) {
          return undefined;
        }
        const nodeCommand = await this.#resolveCommand(
          this.#platform === "win32" ? "node.exe" : "node"
        );
        return nodeCommand ? installed : undefined;
      }
      case "go":
        return await this.#probePath(
          this.#goExecutablePath(strategy),
          strategy.args
        );
      case "kotlin":
        return await this.#probePath(
          this.#kotlinDistribution(strategy).command,
          strategy.args
        );
      case "csharp":
        return await this.#probePath(
          this.#csharpExecutablePath(strategy),
          strategy.args
        );
      case "rust":
        return await this.#probeRustAnalyzer();
      case "java":
        return (await this.#resolveJdtls([]))
          ? {
              command: "jdtls",
              args: strategy.args
            }
          : undefined;
    }
  }

  async #probePath(
    command: string,
    args: string[]
  ): Promise<InstalledLanguageServer | undefined> {
    return (await this.#pathExists(command))
      ? {
          command,
          args: [...args]
        }
      : undefined;
  }

  async #installLanguageServer(
    strategy: LanguageServerStrategy
  ): Promise<InstalledLanguageServer> {
    switch (strategy.kind) {
      case "npm":
        return await this.#installNpmLanguageServer(
          strategy
        );
      case "java":
        return await this.#installJava(strategy);
      case "go":
        return await this.#installGo(strategy);
      case "kotlin":
        return await this.#installKotlin(strategy);
      case "csharp":
        return await this.#installCSharp(strategy);
      case "rust":
        return await this.#installRust(strategy);
    }
  }

  async #persistResult(
    strategy: LanguageServerStrategy,
    installed: InstalledLanguageServer,
    status: LanguageServerInstallResultDto["status"]
  ): Promise<LanguageServerInstallResultDto> {
    await this.#updateLanguageServerSettings(
      strategy.language,
      installed.command,
      installed.args
    );
    return {
      language: strategy.language,
      status,
      command: installed.command,
      message:
        status === "already-installed"
          ? `已检测到可用的 ${strategy.displayName} Language Server，无需重复安装。`
          : strategy.installedMessage
    };
  }

  async #installNpmLanguageServer(
    strategy: NpmLanguageServerStrategy
  ): Promise<InstalledLanguageServer> {
    const npmLaunch = await this.#resolveNpmLaunch();
    if (!npmLaunch) {
      throw new GitError(
        "COMMAND_FAILED",
        "未检测到可安全调用的 Node.js 与 npm。请先安装 Node.js 22.22.2 或更高版本。"
      );
    }

    const installDirectory = join(
      this.#runtimeDirectory,
      strategy.directoryName
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
        ...strategy.packages
      ],
      cwd: installDirectory,
      timeoutMs: INSTALL_TIMEOUT_MS
    });

    const command = this.#npmExecutablePath(strategy);
    if (!(await this.#pathExists(command))) {
      throw new GitError(
        "COMMAND_FAILED",
        `npm 已结束，但 GitNest 未找到 ${strategy.displayName} Language Server 可执行文件。`
      );
    }
    return {
      command,
      args: [...strategy.args]
    };
  }

  #npmExecutablePath(
    strategy: NpmLanguageServerStrategy
  ): string {
    return join(
      this.#runtimeDirectory,
      strategy.directoryName,
      "node_modules",
      ".bin",
      this.#platform === "win32"
        ? `${strategy.executable}.cmd`
        : strategy.executable
    );
  }

  async #installGo(
    strategy: GoLanguageServerStrategy
  ): Promise<InstalledLanguageServer> {
    const goCommand = await this.#resolveCommand("go");
    if (!goCommand) {
      throw new GitError(
        "COMMAND_FAILED",
        "未检测到 Go 命令行工具，无法安装 gopls。请先安装 Go。"
      );
    }
    const installDirectory = join(
      this.#runtimeDirectory,
      strategy.directoryName
    );
    await this.#ensureDirectory(installDirectory);
    await this.#runCommand({
      command: goCommand,
      args: [
        "install",
        "golang.org/x/tools/gopls@v0.23.0"
      ],
      env: {
        GOBIN: installDirectory
      },
      cwd: installDirectory,
      timeoutMs: INSTALL_TIMEOUT_MS
    });
    const command = this.#goExecutablePath(strategy);
    if (!(await this.#pathExists(command))) {
      throw new GitError(
        "COMMAND_FAILED",
        "go install 已结束，但 GitNest 未找到 gopls 可执行文件。"
      );
    }
    return {
      command,
      args: [...strategy.args]
    };
  }

  #goExecutablePath(
    strategy: GoLanguageServerStrategy
  ): string {
    return join(
      this.#runtimeDirectory,
      strategy.directoryName,
      this.#platform === "win32" ? "gopls.exe" : "gopls"
    );
  }

  async #installKotlin(
    strategy: KotlinLanguageServerStrategy
  ): Promise<InstalledLanguageServer> {
    const distribution = this.#kotlinDistribution(strategy);
    await this.#ensureDirectory(distribution.installDirectory);
    await this.#download(
      distribution.url,
      distribution.archivePath
    );
    await this.#extract(
      distribution.archivePath,
      distribution.installDirectory
    );
    if (!(await this.#pathExists(distribution.command))) {
      throw new GitError(
        "COMMAND_FAILED",
        "Kotlin Language Server 归档已解压，但 GitNest 未找到启动文件。"
      );
    }
    if (this.#platform !== "win32") {
      await this.#chmod(distribution.command, 0o755);
    }
    return {
      command: distribution.command,
      args: [...strategy.args]
    };
  }

  #kotlinDistribution(
    strategy: KotlinLanguageServerStrategy
  ): {
    installDirectory: string;
    archivePath: string;
    command: string;
    url: string;
  } {
    if (this.#arch !== "x64" && this.#arch !== "arm64") {
      throw new GitError(
        "COMMAND_FAILED",
        `Kotlin Language Server 暂不支持当前处理器架构：${this.#arch}。`
      );
    }
    const installDirectory = join(
      this.#runtimeDirectory,
      strategy.directoryName
    );
    const armSuffix =
      this.#arch === "arm64" ? "-aarch64" : "";
    const archiveExtension =
      this.#platform === "win32"
        ? ".win.zip"
        : this.#platform === "darwin"
          ? ".sit"
          : ".tar.gz";
    const archiveName = `kotlin-server-${KOTLIN_LANGUAGE_SERVER_VERSION}${armSuffix}${archiveExtension}`;
    const command =
      this.#platform === "win32"
        ? join(
            installDirectory,
            "bin",
            "intellij-server.exe"
          )
        : join(
            installDirectory,
            `kotlin-server-${KOTLIN_LANGUAGE_SERVER_VERSION}`,
            "kotlin-lsp.sh"
          );
    return {
      installDirectory,
      archivePath: join(installDirectory, archiveName),
      command,
      url:
        `https://download-cdn.jetbrains.com/language-server/kotlin-server/` +
        `${KOTLIN_LANGUAGE_SERVER_VERSION}/${archiveName}`
    };
  }

  async #installCSharp(
    strategy: CSharpLanguageServerStrategy
  ): Promise<InstalledLanguageServer> {
    const dotnetCommand =
      await this.#resolveCommand("dotnet");
    if (!dotnetCommand) {
      throw new GitError(
        "COMMAND_FAILED",
        "未检测到 dotnet 命令行工具，无法安装 C# Language Server。请先安装 .NET SDK 10 或更高版本。"
      );
    }
    const sdkOutput = await this.#runCommand({
      command: dotnetCommand,
      args: ["--list-sdks"],
      cwd: this.#runtimeDirectory,
      timeoutMs: COMMAND_PROBE_TIMEOUT_MS
    });
    if (!hasDotnetSdkMajor(sdkOutput.stdout, 10)) {
      throw new GitError(
        "COMMAND_FAILED",
        "C# Language Server 需要 .NET SDK 10 或更高版本。"
      );
    }
    const installDirectory = join(
      this.#runtimeDirectory,
      strategy.directoryName
    );
    await this.#ensureDirectory(installDirectory);
    await this.#runCommand({
      command: dotnetCommand,
      args: [
        "tool",
        "install",
        "csharp-ls",
        "--tool-path",
        installDirectory,
        "--version",
        CSHARP_LANGUAGE_SERVER_VERSION
      ],
      cwd: installDirectory,
      timeoutMs: INSTALL_TIMEOUT_MS
    });
    const command = this.#csharpExecutablePath(strategy);
    if (!(await this.#pathExists(command))) {
      throw new GitError(
        "COMMAND_FAILED",
        "dotnet tool install 已结束，但 GitNest 未找到 csharp-ls 可执行文件。"
      );
    }
    return {
      command,
      args: [...strategy.args]
    };
  }

  #csharpExecutablePath(
    strategy: CSharpLanguageServerStrategy
  ): string {
    return join(
      this.#runtimeDirectory,
      strategy.directoryName,
      this.#platform === "win32"
        ? "csharp-ls.exe"
        : "csharp-ls"
    );
  }

  async #installRust(
    strategy: RustLanguageServerStrategy
  ): Promise<InstalledLanguageServer> {
    const rustupCommand =
      await this.#resolveCommand("rustup");
    if (!rustupCommand) {
      throw new GitError(
        "COMMAND_FAILED",
        "未检测到 rustup，无法安装 rust-analyzer。请先安装 Rust 与 rustup。"
      );
    }
    await this.#runCommand({
      command: rustupCommand,
      args: ["component", "add", "rust-analyzer"],
      cwd: this.#runtimeDirectory,
      timeoutMs: INSTALL_TIMEOUT_MS
    });
    const installed =
      await this.#resolveRustAnalyzer(rustupCommand);
    if (!installed) {
      throw new GitError(
        "COMMAND_FAILED",
        "rustup 已结束，但 GitNest 未找到 rust-analyzer 可执行文件。"
      );
    }
    return {
      command: installed,
      args: [...strategy.args]
    };
  }

  async #probeRustAnalyzer(): Promise<
    InstalledLanguageServer | undefined
  > {
    const rustupCommand =
      await this.#resolveCommand("rustup");
    if (!rustupCommand) {
      return undefined;
    }
    const command =
      await this.#resolveRustAnalyzer(rustupCommand);
    return command
      ? {
          command,
          args: []
        }
      : undefined;
  }

  async #resolveRustAnalyzer(
    rustupCommand: string
  ): Promise<string | undefined> {
    let output: CommandOutput;
    try {
      output = await this.#runCommand({
        command: rustupCommand,
        args: ["which", "rust-analyzer"],
        cwd: this.#runtimeDirectory,
        timeoutMs: COMMAND_PROBE_TIMEOUT_MS
      });
    } catch {
      return undefined;
    }
    const command = output.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean);
    return command &&
      isAbsolute(command) &&
      (await this.#pathExists(command))
      ? command
      : undefined;
  }

  async #installJava(
    strategy: JavaLanguageServerStrategy
  ): Promise<InstalledLanguageServer> {
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
    return {
      command: "jdtls",
      args: [...strategy.args]
    };
  }
}

function hasDotnetSdkMajor(
  output: string,
  minimumMajor: number
): boolean {
  return output
    .split(/\r?\n/u)
    .some((line) => {
      const match = /^\s*(\d+)\./u.exec(line);
      return (
        match?.[1] !== undefined &&
        Number.parseInt(match[1], 10) >= minimumMajor
      );
    });
}

async function downloadFile(
  url: string,
  destinationPath: string
): Promise<void> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS)
    });
    if (!response.ok || !response.body) {
      throw new GitError(
        "COMMAND_FAILED",
        "无法下载 Kotlin Language Server，请检查网络后重试。",
        {
          status: response.status,
          url
        }
      );
    }
    await pipeline(
      Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>
      ),
      createWriteStream(destinationPath)
    );
  } catch (error) {
    await unlink(destinationPath).catch(() => undefined);
    if (error instanceof GitError) {
      throw error;
    }
    throw new GitError(
      "COMMAND_FAILED",
      "无法下载 Kotlin Language Server，请检查网络后重试。",
      {
        cause:
          error instanceof Error
            ? error.message
            : String(error)
      }
    );
  }
}

async function extractArchive(options: {
  archivePath: string;
  destinationPath: string;
  platform: NodeJS.Platform;
  resolveCommand(
    command: string
  ): Promise<string | undefined>;
  runCommand(
    request: CommandRequest
  ): Promise<CommandOutput>;
}): Promise<void> {
  if (options.platform === "win32") {
    const powershell =
      (await options.resolveCommand("powershell.exe")) ??
      (await options.resolveCommand("pwsh.exe"));
    if (!powershell) {
      throw new GitError(
        "COMMAND_FAILED",
        "未检测到 PowerShell，无法解压 Kotlin Language Server。"
      );
    }
    await options.runCommand({
      command: powershell,
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Expand-Archive -LiteralPath $env:GITNEST_KOTLIN_ARCHIVE -DestinationPath $env:GITNEST_KOTLIN_DESTINATION -Force"
      ],
      env: {
        GITNEST_KOTLIN_ARCHIVE: options.archivePath,
        GITNEST_KOTLIN_DESTINATION:
          options.destinationPath
      },
      cwd: options.destinationPath,
      timeoutMs: INSTALL_TIMEOUT_MS
    });
    return;
  }

  const extractorName =
    options.platform === "darwin" ? "ditto" : "tar";
  const extractor =
    await options.resolveCommand(extractorName);
  if (!extractor) {
    throw new GitError(
      "COMMAND_FAILED",
      `未检测到 ${extractorName}，无法解压 Kotlin Language Server。`
    );
  }
  await options.runCommand({
    command: extractor,
    args:
      options.platform === "darwin"
        ? [
            "-x",
            "-k",
            options.archivePath,
            options.destinationPath
          ]
        : [
            "-xzf",
            options.archivePath,
            "-C",
            options.destinationPath
          ],
    cwd: options.destinationPath,
    timeoutMs: INSTALL_TIMEOUT_MS
  });
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
