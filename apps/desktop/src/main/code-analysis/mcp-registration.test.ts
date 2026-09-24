import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MCP_REGISTRATION_NAME,
  McpRegistrationService
} from "./mcp-registration";

describe("McpRegistrationService", () => {
  it("uses the GitNest code analysis registration name", async () => {
    const registration = new McpRegistrationService({
      executablePath: "C:\\GitNest\\GitNest.exe",
      entryScriptPath:
        "C:\\GitNest\\resources\\mcp\\gitnest-mcp.mjs",
      dataDirectory: "C:\\GitNest\\user-data",
      packaged: false,
      codexCommand: process.execPath
    });

    const status = await registration.status();

    expect(MCP_REGISTRATION_NAME).toBe("GitNest_code_lsp");
    expect(status.command).toContain(
      "codex mcp add GitNest_code_lsp"
    );
    expect(status.configSnippet).toContain(
      "[mcp_servers.GitNest_code_lsp]"
    );
    expect(status.configSnippet).toContain(
      "[mcp_servers.GitNest_code_lsp.env]"
    );
  });

  it.runIf(process.platform === "win32")(
    "registers through a Windows command shim without changing arguments",
    async () => {
      const root = await mkdtemp(
        join(tmpdir(), "gitnest-mcp-registration-")
      );
      try {
        const commandDirectory = join(root, "Codex CLI");
        const commandPath = join(
          commandDirectory,
          "codex.cmd"
        );
        const fakeCliPath = join(
          commandDirectory,
          "fake-codex.cjs"
        );
        const logPath = join(commandDirectory, "args.json");
        const executablePath = join(
          root,
          "GitNest & Tools",
          "GitNest.exe"
        );
        const entryScriptPath = join(
          root,
          "GitNest & Tools",
          "resources",
          "mcp",
          "gitnest-mcp.mjs"
        );
        const dataDirectory = join(
          root,
          "User Data (Local)",
          "%TEMP%"
        );

        await mkdir(commandDirectory, { recursive: true });
        await mkdir(dirname(entryScriptPath), {
          recursive: true
        });
        await writeFile(entryScriptPath, "export {};\n");
        await writeFile(
          fakeCliPath,
          [
            'const { existsSync, unlinkSync, writeFileSync } = require("node:fs");',
            'const { join } = require("node:path");',
            "const args = process.argv.slice(2);",
            'const statePath = join(__dirname, "registered");',
            'const logPath = join(__dirname, "args.json");',
            'if (args[0] !== "mcp") process.exit(2);',
            'if (args[1] === "add") {',
            '  writeFileSync(logPath, JSON.stringify(args));',
            '  writeFileSync(statePath, "registered");',
            "  process.exit(0);",
            "}",
            'if (args[1] === "get") {',
            "  if (existsSync(statePath)) {",
            `    process.stdout.write("${MCP_REGISTRATION_NAME}\\n");`,
            "    process.exit(0);",
            "  }",
            "  process.exit(1);",
            "}",
            'if (args[1] === "remove") {',
            "  if (existsSync(statePath)) unlinkSync(statePath);",
            "  process.exit(0);",
            "}",
            "process.exit(2);"
          ].join("\n")
        );
        await writeFile(
          commandPath,
          [
            "@echo off",
            `"${process.execPath}" "%~dp0fake-codex.cjs" %*`,
            ""
          ].join("\r\n")
        );

        const registration = new McpRegistrationService({
          executablePath,
          entryScriptPath,
          dataDirectory,
          packaged: true,
          codexCommand: commandPath
        });

        const status = await registration.setRegistered(true);

        expect(status).toMatchObject({
          registered: true,
          codexAvailable: true,
          serverAvailable: true
        });
        expect(
          JSON.parse(await readFile(logPath, "utf8"))
        ).toEqual([
          "mcp",
          "add",
          MCP_REGISTRATION_NAME,
          "--env",
          "ELECTRON_RUN_AS_NODE=1",
          "--",
          executablePath,
          entryScriptPath,
          "--data-dir",
          dataDirectory
        ]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );
});
