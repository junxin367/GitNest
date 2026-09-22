import { join, resolve } from "node:path";

import {
  describe,
  expect,
  it,
  vi
} from "vitest";

import { LanguageServerInstaller } from "./language-server-installer";

describe("LanguageServerInstaller", () => {
  it("installs TypeScript into the managed runtime and persists its command", async () => {
    let installed = false;
    const updateSettings = vi.fn(async () => undefined);
    const runCommand = vi.fn(async () => {
      installed = true;
      return {
        stdout: "",
        stderr: ""
      };
    });
    const ensureDirectory = vi.fn(async () => undefined);
    const runtimeDirectory = resolve(
      "C:\\GitNest\\runtime\\lsp\\servers"
    );
    const installer = new LanguageServerInstaller({
      runtimeDirectory,
      platform: "win32",
      ensureDirectory,
      pathExists: async (path) =>
        installed &&
        path.endsWith("typescript-language-server.cmd"),
      resolveNpmLaunch: async () => ({
        command: "C:\\Node\\node.exe",
        args: ["C:\\Node\\node_modules\\npm\\bin\\npm-cli.js"]
      }),
      resolveEditorCliLaunch: async () => undefined,
      resolveJdtls: async () => undefined,
      runCommand,
      updateLanguageServerSettings: updateSettings
    });

    const result = await installer.install("typescript");
    const installDirectory = join(
      runtimeDirectory,
      "typescript"
    );
    const command = join(
      installDirectory,
      "node_modules",
      ".bin",
      "typescript-language-server.cmd"
    );

    expect(result).toMatchObject({
      language: "typescript",
      status: "installed",
      command
    });
    expect(ensureDirectory).toHaveBeenCalledWith(
      runtimeDirectory
    );
    expect(ensureDirectory).toHaveBeenCalledWith(
      installDirectory
    );
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "C:\\Node\\node.exe",
        args: expect.arrayContaining([
          "install",
          "--prefix",
          installDirectory,
          "typescript-language-server@6",
          "typescript@6"
        ]),
        cwd: installDirectory
      })
    );
    expect(updateSettings).toHaveBeenCalledWith(
      "typescript",
      command,
      ["--stdio"]
    );
  });

  it("installs Vue into the managed runtime and persists its command", async () => {
    let installed = false;
    const updateSettings = vi.fn(async () => undefined);
    const runCommand = vi.fn(async () => {
      installed = true;
      return {
        stdout: "",
        stderr: ""
      };
    });
    const ensureDirectory = vi.fn(async () => undefined);
    const runtimeDirectory = resolve(
      "C:\\GitNest\\runtime\\lsp\\servers"
    );
    const installer = new LanguageServerInstaller({
      runtimeDirectory,
      platform: "win32",
      ensureDirectory,
      pathExists: async (path) =>
        installed &&
        path.endsWith("vue-language-server.cmd"),
      resolveNpmLaunch: async () => ({
        command: "C:\\Node\\node.exe",
        args: ["C:\\Node\\node_modules\\npm\\bin\\npm-cli.js"]
      }),
      resolveEditorCliLaunch: async () => undefined,
      resolveJdtls: async () => undefined,
      runCommand,
      updateLanguageServerSettings: updateSettings
    });

    const result = await installer.install("vue");
    const installDirectory = join(runtimeDirectory, "vue");
    const command = join(
      installDirectory,
      "node_modules",
      ".bin",
      "vue-language-server.cmd"
    );

    expect(result).toMatchObject({
      language: "vue",
      status: "installed",
      command
    });
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "C:\\Node\\node.exe",
        args: expect.arrayContaining([
          "install",
          "--prefix",
          installDirectory,
          "@vue/language-server@3",
          "typescript@6"
        ]),
        cwd: installDirectory
      })
    );
    expect(updateSettings).toHaveBeenCalledWith(
      "vue",
      command,
      ["--stdio"]
    );
  });

  it("installs Python through the shared managed npm strategy", async () => {
    let installed = false;
    const updateSettings = vi.fn(async () => undefined);
    const runCommand = vi.fn(async () => {
      installed = true;
      return { stdout: "", stderr: "" };
    });
    const runtimeDirectory = resolve(
      "C:\\GitNest\\runtime\\lsp\\servers"
    );
    const installer = new LanguageServerInstaller({
      runtimeDirectory,
      platform: "win32",
      ensureDirectory: async () => undefined,
      pathExists: async (path) =>
        installed &&
        path.endsWith("pyright-langserver.cmd"),
      resolveNpmLaunch: async () => ({
        command: "C:\\Node\\node.exe",
        args: ["C:\\Node\\npm-cli.js"]
      }),
      runCommand,
      updateLanguageServerSettings: updateSettings
    });

    const result = await installer.install("python");
    const installDirectory = join(
      runtimeDirectory,
      "python"
    );
    const command = join(
      installDirectory,
      "node_modules",
      ".bin",
      "pyright-langserver.cmd"
    );

    expect(result).toMatchObject({
      language: "python",
      status: "installed",
      command
    });
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([
          "install",
          "--prefix",
          installDirectory,
          "pyright@1.1.414"
        ])
      })
    );
    expect(updateSettings).toHaveBeenCalledWith(
      "python",
      command,
      ["--stdio"]
    );
  });

  it("installs gopls with a managed GOBIN", async () => {
    let installed = false;
    const runtimeDirectory = resolve(
      "C:\\GitNest\\runtime\\lsp\\servers"
    );
    const installDirectory = join(runtimeDirectory, "go");
    const command = join(installDirectory, "gopls.exe");
    const updateSettings = vi.fn(async () => undefined);
    const runCommand = vi.fn(async () => {
      installed = true;
      return { stdout: "", stderr: "" };
    });
    const installer = new LanguageServerInstaller({
      runtimeDirectory,
      platform: "win32",
      ensureDirectory: async () => undefined,
      pathExists: async (path) =>
        installed && path === command,
      resolveCommand: async (requested) =>
        requested === "go" ? "C:\\Go\\bin\\go.exe" : undefined,
      runCommand,
      updateLanguageServerSettings: updateSettings
    });

    await expect(
      installer.install("go")
    ).resolves.toMatchObject({
      language: "go",
      status: "installed",
      command
    });
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "C:\\Go\\bin\\go.exe",
        args: [
          "install",
          "golang.org/x/tools/gopls@v0.23.0"
        ],
        env: {
          GOBIN: installDirectory
        }
      })
    );
    expect(updateSettings).toHaveBeenCalledWith(
      "go",
      command,
      ["serve"]
    );
  });

  it("downloads the official Kotlin Windows arm64 archive and persists its executable", async () => {
    let extracted = false;
    const runtimeDirectory = resolve(
      "C:\\GitNest\\runtime\\lsp\\servers"
    );
    const installDirectory = join(
      runtimeDirectory,
      "kotlin"
    );
    const archivePath = join(
      installDirectory,
      "kotlin-server-263.4702.0-aarch64.win.zip"
    );
    const command = join(
      installDirectory,
      "bin",
      "intellij-server.exe"
    );
    const download = vi.fn(async () => undefined);
    const extract = vi.fn(async () => {
      extracted = true;
    });
    const chmod = vi.fn(async () => undefined);
    const updateSettings = vi.fn(async () => undefined);
    const installer = new LanguageServerInstaller({
      runtimeDirectory,
      platform: "win32",
      arch: "arm64",
      ensureDirectory: async () => undefined,
      pathExists: async (path) =>
        extracted && path === command,
      download,
      extract,
      chmod,
      updateLanguageServerSettings: updateSettings
    });

    await expect(
      installer.install("kotlin")
    ).resolves.toMatchObject({
      language: "kotlin",
      status: "installed",
      command
    });
    expect(download).toHaveBeenCalledWith(
      "https://download-cdn.jetbrains.com/language-server/kotlin-server/263.4702.0/kotlin-server-263.4702.0-aarch64.win.zip",
      archivePath
    );
    expect(extract).toHaveBeenCalledWith(
      archivePath,
      installDirectory
    );
    expect(chmod).not.toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalledWith(
      "kotlin",
      command,
      ["--stdio"]
    );
  });

  it("passes Kotlin archive paths through the PowerShell environment", async () => {
    let extracted = false;
    const runtimeDirectory = resolve(
      "C:\\GitNest Runtime\\lsp\\servers"
    );
    const installDirectory = join(
      runtimeDirectory,
      "kotlin"
    );
    const archivePath = join(
      installDirectory,
      "kotlin-server-263.4702.0.win.zip"
    );
    const command = join(
      installDirectory,
      "bin",
      "intellij-server.exe"
    );
    const powershell =
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    const runCommand = vi.fn(async () => {
      extracted = true;
      return { stdout: "", stderr: "" };
    });
    const installer = new LanguageServerInstaller({
      runtimeDirectory,
      platform: "win32",
      arch: "x64",
      ensureDirectory: async () => undefined,
      pathExists: async (path) =>
        extracted && path === command,
      resolveCommand: async (requested) =>
        requested === "powershell.exe"
          ? powershell
          : undefined,
      download: async () => undefined,
      runCommand,
      updateLanguageServerSettings: async () => undefined
    });

    await expect(
      installer.install("kotlin")
    ).resolves.toMatchObject({
      language: "kotlin",
      command
    });
    expect(runCommand).toHaveBeenCalledWith({
      command: powershell,
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Expand-Archive -LiteralPath $env:GITNEST_KOTLIN_ARCHIVE -DestinationPath $env:GITNEST_KOTLIN_DESTINATION -Force"
      ],
      env: {
        GITNEST_KOTLIN_ARCHIVE: archivePath,
        GITNEST_KOTLIN_DESTINATION: installDirectory
      },
      cwd: installDirectory,
      timeoutMs: 10 * 60_000
    });
  });

  it("requires .NET SDK 10 and installs csharp-ls into the managed directory", async () => {
    let installed = false;
    const runtimeDirectory = resolve(
      "C:\\GitNest\\runtime\\lsp\\servers"
    );
    const installDirectory = join(
      runtimeDirectory,
      "csharp"
    );
    const command = join(
      installDirectory,
      "csharp-ls.exe"
    );
    const updateSettings = vi.fn(async () => undefined);
    const runCommand = vi.fn(async (request) => {
      if (request.args[0] === "--list-sdks") {
        return {
          stdout:
            "9.0.300 [C:\\dotnet\\sdk]\n10.0.100 [C:\\dotnet\\sdk]",
          stderr: ""
        };
      }
      installed = true;
      return { stdout: "", stderr: "" };
    });
    const installer = new LanguageServerInstaller({
      runtimeDirectory,
      platform: "win32",
      ensureDirectory: async () => undefined,
      pathExists: async (path) =>
        installed && path === command,
      resolveCommand: async (requested) =>
        requested === "dotnet"
          ? "C:\\dotnet\\dotnet.exe"
          : undefined,
      runCommand,
      updateLanguageServerSettings: updateSettings
    });

    await expect(
      installer.install("csharp")
    ).resolves.toMatchObject({
      language: "csharp",
      status: "installed",
      command
    });
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          "tool",
          "install",
          "csharp-ls",
          "--tool-path",
          installDirectory,
          "--version",
          "0.28.0"
        ]
      })
    );
    expect(updateSettings).toHaveBeenCalledWith(
      "csharp",
      command,
      []
    );
  });

  it("installs rust-analyzer through rustup and persists the resolved absolute path", async () => {
    let installed = false;
    const runtimeDirectory = resolve(
      "C:\\GitNest\\runtime\\lsp\\servers"
    );
    const command =
      "C:\\Rust\\.rustup\\toolchains\\stable\\bin\\rust-analyzer.exe";
    const updateSettings = vi.fn(async () => undefined);
    const runCommand = vi.fn(async (request) => {
      if (
        request.args[0] === "which" &&
        !installed
      ) {
        throw new Error("component is not installed");
      }
      if (request.args[0] === "component") {
        installed = true;
        return { stdout: "", stderr: "" };
      }
      return {
        stdout: `${command}\n`,
        stderr: ""
      };
    });
    const installer = new LanguageServerInstaller({
      runtimeDirectory,
      platform: "win32",
      ensureDirectory: async () => undefined,
      pathExists: async (path) => path === command,
      resolveCommand: async (requested) =>
        requested === "rustup"
          ? "C:\\Rust\\.cargo\\bin\\rustup.exe"
          : undefined,
      runCommand,
      updateLanguageServerSettings: updateSettings
    });

    await expect(
      installer.install("rust")
    ).resolves.toMatchObject({
      language: "rust",
      status: "installed",
      command
    });
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["component", "add", "rust-analyzer"]
      })
    );
    expect(updateSettings).toHaveBeenCalledWith(
      "rust",
      command,
      []
    );
  });

  it.each([
    [
      "go" as const,
      "未检测到 Go 命令行工具"
    ],
    [
      "rust" as const,
      "未检测到 rustup"
    ]
  ])(
    "reports a clear prerequisite error when %s tooling is missing",
    async (language, expectedMessage) => {
      const installer = new LanguageServerInstaller({
        runtimeDirectory: "C:\\GitNest\\runtime\\lsp",
        ensureDirectory: async () => undefined,
        pathExists: async () => false,
        resolveCommand: async () => undefined,
        updateLanguageServerSettings: async () => undefined
      });

      await expect(
        installer.install(language)
      ).rejects.toThrow(expectedMessage);
    }
  );

  it("rejects C# installation when only an older .NET SDK is available", async () => {
    const runCommand = vi.fn(async (request) => {
      if (request.args[0] === "--list-sdks") {
        return {
          stdout: "9.0.300 [C:\\dotnet\\sdk]",
          stderr: ""
        };
      }
      return { stdout: "", stderr: "" };
    });
    const installer = new LanguageServerInstaller({
      runtimeDirectory: "C:\\GitNest\\runtime\\lsp",
      ensureDirectory: async () => undefined,
      pathExists: async () => false,
      resolveCommand: async (requested) =>
        requested === "dotnet"
          ? "C:\\dotnet\\dotnet.exe"
          : undefined,
      runCommand,
      updateLanguageServerSettings: async () => undefined
    });

    await expect(
      installer.install("csharp")
    ).rejects.toThrow(
      "C# Language Server 需要 .NET SDK 10 或更高版本"
    );
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it("returns already-installed before invoking an installer when a managed artifact exists", async () => {
    const runtimeDirectory = resolve(
      "C:\\GitNest\\runtime\\lsp\\servers"
    );
    const command = join(
      runtimeDirectory,
      "typescript",
      "node_modules",
      ".bin",
      "typescript-language-server.cmd"
    );
    const ensureDirectory = vi.fn(async () => undefined);
    const resolveNpmLaunch = vi.fn(async () => ({
      command: "node",
      args: ["npm-cli.js"]
    }));
    const runCommand = vi.fn(async () => ({
      stdout: "",
      stderr: ""
    }));
    const updateSettings = vi.fn(async () => undefined);
    const installer = new LanguageServerInstaller({
      runtimeDirectory,
      platform: "win32",
      ensureDirectory,
      pathExists: async (path) => path === command,
      resolveCommand: async (requested) =>
        requested === "node.exe"
          ? "C:\\Node\\node.exe"
          : undefined,
      resolveNpmLaunch,
      runCommand,
      updateLanguageServerSettings: updateSettings
    });

    await expect(
      installer.install("typescript")
    ).resolves.toMatchObject({
      language: "typescript",
      status: "already-installed",
      command
    });
    expect(ensureDirectory).not.toHaveBeenCalled();
    expect(resolveNpmLaunch).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalledWith(
      "typescript",
      command,
      ["--stdio"]
    );
  });

  it("does not enable a stale npm shim when the Node.js runtime is missing", async () => {
    const runtimeDirectory = resolve(
      "C:\\GitNest\\runtime\\lsp\\servers"
    );
    const command = join(
      runtimeDirectory,
      "python",
      "node_modules",
      ".bin",
      "pyright-langserver.cmd"
    );
    const updateSettings = vi.fn(async () => undefined);
    const installer = new LanguageServerInstaller({
      runtimeDirectory,
      platform: "win32",
      ensureDirectory: async () => undefined,
      pathExists: async (path) => path === command,
      resolveCommand: async () => undefined,
      resolveNpmLaunch: async () => undefined,
      updateLanguageServerSettings: updateSettings
    });

    await expect(
      installer.install("python")
    ).rejects.toThrow(
      "未检测到可安全调用的 Node.js 与 npm"
    );
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("does not reinstall Java when an editor JDT LS is already available", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "",
      stderr: ""
    }));
    const updateSettings = vi.fn(async () => undefined);
    const installer = new LanguageServerInstaller({
      runtimeDirectory: "C:\\GitNest\\runtime\\lsp",
      ensureDirectory: async () => undefined,
      resolveJdtls: async () => ({
        command: "C:\\Java\\bin\\java.exe",
        args: []
      }),
      resolveEditorCliLaunch: async () => undefined,
      resolveNpmLaunch: async () => undefined,
      runCommand,
      updateLanguageServerSettings: updateSettings
    });

    await expect(installer.install("java")).resolves.toMatchObject({
      language: "java",
      status: "already-installed"
    });
    expect(runCommand).not.toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalledWith(
      "java",
      "jdtls",
      []
    );
  });

  it("installs the Red Hat Java extension and verifies JDT LS discovery", async () => {
    let installed = false;
    const updateSettings = vi.fn(async () => undefined);
    const runCommand = vi.fn(async () => {
      installed = true;
      return { stdout: "", stderr: "" };
    });
    const installer = new LanguageServerInstaller({
      runtimeDirectory: "C:\\GitNest\\runtime\\lsp",
      ensureDirectory: async () => undefined,
      resolveJdtls: async () =>
        installed
          ? {
              command: "C:\\Java\\bin\\java.exe",
              args: []
            }
          : undefined,
      resolveEditorCliLaunch: async () => ({
        command: "C:\\Program Files\\Microsoft VS Code\\Code.exe",
        args: ["C:\\Program Files\\Microsoft VS Code\\cli.js"],
        env: {
          ELECTRON_RUN_AS_NODE: "1"
        }
      }),
      resolveNpmLaunch: async () => undefined,
      runCommand,
      updateLanguageServerSettings: updateSettings
    });

    const result = await installer.install("java");

    expect(result).toMatchObject({
      language: "java",
      status: "installed",
      command: "jdtls"
    });
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          "C:\\Program Files\\Microsoft VS Code\\cli.js",
          "--install-extension",
          "redhat.java",
          "--force"
        ],
        env: {
          ELECTRON_RUN_AS_NODE: "1"
        }
      })
    );
    expect(updateSettings).toHaveBeenCalledWith(
      "java",
      "jdtls",
      []
    );
  });

  it("rejects concurrent installation for the same language", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    const installer = new LanguageServerInstaller({
      runtimeDirectory: "C:\\GitNest\\runtime\\lsp",
      ensureDirectory: async () => undefined,
      pathExists: async () => true,
      resolveNpmLaunch: async () => ({
        command: "node",
        args: ["npm-cli.js"]
      }),
      resolveEditorCliLaunch: async () => undefined,
      resolveJdtls: async () => undefined,
      runCommand: async () => {
        await pending;
        return { stdout: "", stderr: "" };
      },
      updateLanguageServerSettings: async () => undefined
    });

    const first = installer.install("typescript");
    await expect(
      installer.install("typescript")
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    release?.();
    await first;
  });
});
