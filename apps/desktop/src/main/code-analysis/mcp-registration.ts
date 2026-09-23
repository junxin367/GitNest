import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join, win32 } from "node:path";
import { promisify } from "node:util";

import type { McpRegistrationStatusDto } from "@gitnest/contracts";

const execFileAsync = promisify(execFile);

export const MCP_SERVER_NAME = "gitnest";
const CODEX_COMMAND_TIMEOUT_MS = 20_000;
const WINDOWS_SHELL_META_CHARACTERS =
  /([()\][%!^"`<>&|;, *?])/g;

export interface McpRegistrationOptions {
  executablePath: string;
  entryScriptPath: string;
  dataDirectory: string;
  packaged?: boolean;
  /** Overrides `codex` resolution; used by tests. */
  codexCommand?: string;
}

/**
 * Registers the bundled MCP server with the local Codex CLI.
 *
 * Only fixed `mcp add` / `mcp remove` arguments are used: the
 * renderer cannot submit a command, and nothing else in the user's
 * Codex configuration is touched.
 */
export class McpRegistrationService {
  readonly #options: McpRegistrationOptions;

  constructor(options: McpRegistrationOptions) {
    this.#options = options;
  }

  status(): Promise<McpRegistrationStatusDto> {
    return this.#describe(false);
  }

  async setRegistered(
    registered: boolean
  ): Promise<McpRegistrationStatusDto> {
    if (registered && !(await this.#serverAvailable())) {
      return this.#describe(false);
    }
    const codex = await this.#resolveCodex();
    if (!codex.available) {
      return this.#describe(false);
    }
    try {
      if (registered) {
        await this.#runCodexCommand(
          codex.command,
          [
            "mcp",
            "add",
            MCP_SERVER_NAME,
            "--env",
            "ELECTRON_RUN_AS_NODE=1",
            "--",
            this.#options.executablePath,
            this.#options.entryScriptPath,
            "--data-dir",
            this.#options.dataDirectory
          ]
        );
      } else {
        await this.#runCodexCommand(
          codex.command,
          ["mcp", "remove", MCP_SERVER_NAME]
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return {
        ...(await this.#describe(false)),
        message: `注册失败：${message}`
      };
    }
    // Read back through the CLI so the UI never claims success
    // without verification.
    return this.#describe(true);
  }

  async #describe(
    verified: boolean
  ): Promise<McpRegistrationStatusDto> {
    const [codex, serverAvailable] = await Promise.all([
      this.#resolveCodex(),
      this.#serverAvailable()
    ]);
    const registered = codex.available
      ? await this.#readRegistration(codex.command)
      : false;
    const command = [
      "codex mcp add",
      MCP_SERVER_NAME,
      "--env ELECTRON_RUN_AS_NODE=1",
      "--",
      `"${this.#options.executablePath}"`,
      `"${this.#options.entryScriptPath}"`,
      "--data-dir",
      `"${this.#options.dataDirectory}"`
    ].join(" ");
    const configSnippet = [
      "[mcp_servers.gitnest]",
      `command = "${escapeToml(this.#options.executablePath)}"`,
      "args = [",
      `  "${escapeToml(this.#options.entryScriptPath)}",`,
      '  "--data-dir",',
      `  "${escapeToml(this.#options.dataDirectory)}"`,
      "]",
      "",
      "[mcp_servers.gitnest.env]",
      'ELECTRON_RUN_AS_NODE = "1"'
    ].join("\n");
    return {
      executablePath: this.#options.executablePath,
      entryScriptPath: this.#options.entryScriptPath,
      dataDirectory: this.#options.dataDirectory,
      command,
      configSnippet,
      registered,
      codexAvailable: codex.available,
      serverAvailable,
      message: !serverAvailable
        ? this.#options.packaged === false
          ? "开发版不提供可注册的 MCP 入口，请在安装版中注册。"
          : "MCP 入口文件缺失，请重新安装 GitNest 后注册。"
        : !codex.available
        ? "未找到 codex 命令，请先安装 Codex CLI，或手动复制配置片段。"
        : verified
          ? registered
            ? "已注册，重新启动 Codex 后生效。"
            : "已执行注册命令，但未读取到配置。"
          : registered
            ? "已注册到本机 Codex。"
            : "尚未注册。"
    };
  }

  async #serverAvailable(): Promise<boolean> {
    if (this.#options.packaged === false) {
      return false;
    }
    try {
      await access(this.#options.entryScriptPath);
      return true;
    } catch {
      return false;
    }
  }

  async #readRegistration(
    codexCommand: string
  ): Promise<boolean> {
    try {
      const { stdout } = await this.#runCodexCommand(
        codexCommand,
        ["mcp", "get", MCP_SERVER_NAME]
      );
      return stdout.includes(MCP_SERVER_NAME);
    } catch {
      return false;
    }
  }

  async #runCodexCommand(
    command: string,
    args: string[]
  ): Promise<{ stdout: string; stderr: string }> {
    const invocation = buildCodexInvocation(command, args);
    const { stdout, stderr } = await execFileAsync(
      invocation.command,
      invocation.args,
      {
        encoding: "utf8",
        timeout: CODEX_COMMAND_TIMEOUT_MS,
        windowsHide: true,
        windowsVerbatimArguments:
          invocation.windowsVerbatimArguments
      }
    );
    return { stdout, stderr };
  }

  async #resolveCodex(): Promise<{
    available: boolean;
    command: string;
  }> {
    if (this.#options.codexCommand) {
      return {
        available: true,
        command: this.#options.codexCommand
      };
    }
    const candidates = ["codex.cmd", "codex.exe", "codex"];
    for (const candidate of candidates) {
      if (await commandExists(candidate)) {
        return { available: true, command: candidate };
      }
    }
    return { available: false, command: "codex" };
  }
}

async function commandExists(command: string): Promise<boolean> {
  const directories = (process.env.PATH ?? "")
    .split(";")
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
  const extensions = ["", ".cmd", ".exe", ".bat"];
  for (const directory of directories) {
    for (const extension of extensions) {
      try {
        await access(join(directory, `${command}${extension}`));
        return true;
      } catch {
        // Keep looking.
      }
    }
  }
  return false;
}

function buildCodexInvocation(
  command: string,
  args: string[]
): {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
} {
  if (
    process.platform !== "win32" ||
    !/\.(?:cmd|bat)$/i.test(command)
  ) {
    return { command, args };
  }
  const shellCommand = [
    escapeWindowsShellCommand(win32.normalize(command)),
    ...args.map(escapeWindowsShellArgument)
  ].join(" ");
  return {
    command:
      process.env.ComSpec ??
      process.env.COMSPEC ??
      "cmd.exe",
    args: ["/d", "/s", "/c", `"${shellCommand}"`],
    windowsVerbatimArguments: true
  };
}

function escapeWindowsShellCommand(command: string): string {
  return command.replace(
    WINDOWS_SHELL_META_CHARACTERS,
    "^$1"
  );
}

function escapeWindowsShellArgument(value: string): string {
  let escaped = value
    .replace(/(?=(\\+?)?)\1"/g, '$1$1\\"')
    .replace(/(?=(\\+?)?)\1$/, "$1$1");
  escaped = `"${escaped}"`;
  return escaped.replace(
    WINDOWS_SHELL_META_CHARACTERS,
    "^$1"
  );
}

function escapeToml(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
