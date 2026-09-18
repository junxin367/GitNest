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
    const updateSettings = vi.fn(async () => undefined);
    const runCommand = vi.fn(async () => ({
      stdout: "",
      stderr: ""
    }));
    const ensureDirectory = vi.fn(async () => undefined);
    const runtimeDirectory = resolve(
      "C:\\GitNest\\runtime\\lsp\\servers"
    );
    const installer = new LanguageServerInstaller({
      runtimeDirectory,
      platform: "win32",
      ensureDirectory,
      pathExists: async (path) =>
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
