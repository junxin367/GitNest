import {
  mkdtemp,
  rm
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  afterEach,
  describe,
  expect,
  it
} from "vitest";

import type {
  ExternalTerminalProfile
} from "@gitnest/application";

import {
  WindowsExternalTerminalAdapter,
  buildExternalTerminalLaunch,
  type ExternalTerminalLaunch
} from "./external-terminal.adapter";

const WORKTREE_PATH = "C:\\workspace\\repository & 测试";

describe("buildExternalTerminalLaunch", () => {
  it.each<{
    profile: ExternalTerminalProfile;
    args: string[];
  }>([
    {
      profile: {
        kind: "windows-terminal",
        label: "Windows Terminal",
        executablePath: "C:\\Windows\\wt.exe"
      },
      args: ["-d", WORKTREE_PATH]
    },
    {
      profile: {
        kind: "powershell",
        label: "PowerShell 7",
        executablePath: "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
      },
      args: ["-NoLogo", "-NoExit"]
    },
    {
      profile: {
        kind: "cmd",
        label: "Command Prompt",
        executablePath: "C:\\Windows\\System32\\cmd.exe"
      },
      args: ["/K"]
    },
    {
      profile: {
        kind: "git-bash",
        label: "Git Bash",
        executablePath: "C:\\Program Files\\Git\\bin\\bash.exe"
      },
      args: ["--login", "-i"]
    }
  ])("builds a fixed $profile.kind launch", ({ profile, args }) => {
    expect(
      buildExternalTerminalLaunch(profile, WORKTREE_PATH)
    ).toEqual({
      executable: profile.executablePath,
      args,
      cwd: WORKTREE_PATH
    });
  });
});

describe("WindowsExternalTerminalAdapter", () => {
  const temporaryPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryPaths.map((path) =>
        rm(path, { recursive: true, force: true })
      )
    );
  });

  it("discovers only available fixed terminal profiles", async () => {
    const paths = new Map([
      ["wt.exe", "C:\\WindowsApps\\wt.exe"],
      [
        "pwsh.exe",
        "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
      ],
      ["powershell.exe", "C:\\Windows\\powershell.exe"],
      ["cmd.exe", "C:\\Windows\\System32\\cmd.exe"]
    ]);
    const gitPath = "C:\\Program Files\\Git\\cmd\\git.exe";
    const gitBashPath =
      "C:\\Program Files\\Git\\bin\\bash.exe";
    const adapter = new WindowsExternalTerminalAdapter({
      findExecutable: async (name) => paths.get(name),
      gitExecutablePath: async () => gitPath,
      pathExists: async (path) =>
        paths.has(path) ||
        [...paths.values(), gitBashPath].includes(path)
    });

    await expect(adapter.listAvailable()).resolves.toEqual([
      {
        kind: "windows-terminal",
        label: "Windows Terminal",
        executablePath: "C:\\WindowsApps\\wt.exe"
      },
      {
        kind: "powershell",
        label: "PowerShell 7",
        executablePath:
          "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
      },
      {
        kind: "cmd",
        label: "Command Prompt",
        executablePath: "C:\\Windows\\System32\\cmd.exe"
      },
      {
        kind: "git-bash",
        label: "Git Bash",
        executablePath: gitBashPath
      }
    ]);
  });

  it("launches with an exact executable, argument list, and cwd", async () => {
    const temporary = await mkdtemp(
      join(tmpdir(), "gitnest-terminal-test-")
    );
    temporaryPaths.push(temporary);
    const launches: ExternalTerminalLaunch[] = [];
    const profile: ExternalTerminalProfile = {
      kind: "powershell",
      label: "PowerShell 7",
      executablePath:
        "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
    };
    const adapter = new WindowsExternalTerminalAdapter({
      pathExists: async () => true,
      launch: async (request) => {
        launches.push(request);
      }
    });

    await adapter.launch(profile, temporary);
    expect(launches).toEqual([
      {
        executable: profile.executablePath,
        args: ["-NoLogo", "-NoExit"],
        cwd: temporary
      }
    ]);
  });

  it("rejects untrusted executable and working-directory paths", async () => {
    const launches: ExternalTerminalLaunch[] = [];
    const adapter = new WindowsExternalTerminalAdapter({
      pathExists: async () => false,
      launch: async (request) => {
        launches.push(request);
      }
    });

    await expect(
      adapter.launch(
        {
          kind: "cmd",
          label: "Command Prompt",
          executablePath: "cmd.exe"
        },
        WORKTREE_PATH
      )
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    expect(launches).toEqual([]);
  });
});
