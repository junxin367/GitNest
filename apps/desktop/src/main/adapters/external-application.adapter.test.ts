import { describe, expect, it } from "vitest";

import type {
  ExternalApplicationKind,
  ExternalApplicationProfile,
  ExternalTerminalPort,
  ExternalTerminalProfile
} from "@gitnest/application";

import {
  WindowsExternalApplicationAdapter,
  buildExternalApplicationLaunch,
  type ExternalApplicationLaunch
} from "./external-application.adapter";

const WORKING_DIRECTORY = "C:\\workspace\\repository";

describe("buildExternalApplicationLaunch", () => {
  it.each<{
    kind: Exclude<
      ExternalApplicationKind,
      "file-explorer" | "terminal" | "git-bash"
    >;
    args: string[];
  }>([
    {
      kind: "vscode",
      args: ["--reuse-window", WORKING_DIRECTORY]
    },
    {
      kind: "cursor",
      args: ["--reuse-window", WORKING_DIRECTORY]
    },
    {
      kind: "intellij-idea",
      args: [WORKING_DIRECTORY]
    },
    {
      kind: "sublime-text",
      args: [WORKING_DIRECTORY]
    }
  ])("builds fixed arguments for $kind", ({ kind, args }) => {
    expect(
      buildExternalApplicationLaunch(
        kind,
        `C:\\Apps\\${kind}.exe`,
        WORKING_DIRECTORY
      )
    ).toEqual({
      executable: `C:\\Apps\\${kind}.exe`,
      args,
      cwd: WORKING_DIRECTORY
    });
  });
});

describe("WindowsExternalApplicationAdapter", () => {
  it("lists only detected applications plus system targets", async () => {
    const terminal = new FakeTerminalPort([
      {
        kind: "windows-terminal",
        label: "Windows Terminal",
        executablePath:
          "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe"
      },
      {
        kind: "git-bash",
        label: "Git Bash",
        executablePath: "C:\\Apps\\bash.exe"
      }
    ]);
    const previousWindowsDirectory = process.env.WINDIR;
    process.env.WINDIR = "C:\\Windows";
    const paths = new Map<ExternalApplicationKind, string>([
      ["vscode", "C:\\Apps\\Code.exe"],
      ["intellij-idea", "C:\\Apps\\idea64.exe"],
      ["sublime-text", "C:\\Apps\\sublime_text.exe"]
    ]);
    const icons: string[] = [];
    const adapter = new WindowsExternalApplicationAdapter(terminal, {
      resolveExecutable: async (kind) => paths.get(kind),
      pathExists: async () => true,
      loadIcon: async (path) => {
        icons.push(path);
        return `data:image/png;base64,${path}`;
      },
      resolveWindowsTerminalIcon: async () =>
        "C:\\Apps\\WindowsTerminal.exe"
    });

    try {
      const profiles = await adapter.listAvailable();
      expect(
        profiles.map(({ kind, iconDataUrl }) => ({
          kind,
          iconDataUrl
        }))
      ).toEqual([
        {
          kind: "vscode",
          iconDataUrl:
            "data:image/png;base64,C:\\Apps\\Code.exe"
        },
        {
          kind: "intellij-idea",
          iconDataUrl:
            "data:image/png;base64,C:\\Apps\\idea64.exe"
        },
        {
          kind: "sublime-text",
          iconDataUrl:
            "data:image/png;base64,C:\\Apps\\sublime_text.exe"
        },
        {
          kind: "file-explorer",
          iconDataUrl:
            "data:image/png;base64,C:\\Windows\\explorer.exe"
        },
        {
          kind: "terminal",
          iconDataUrl:
            "data:image/png;base64,C:\\Apps\\WindowsTerminal.exe"
        },
        {
          kind: "git-bash",
          iconDataUrl:
            "data:image/png;base64,C:\\git-bash.exe"
        }
      ]);
      expect(icons).toHaveLength(6);
    } finally {
      if (previousWindowsDirectory === undefined) {
        delete process.env.WINDIR;
      } else {
        process.env.WINDIR = previousWindowsDirectory;
      }
    }
  });

  it("opens editors, directories, and terminal profiles through fixed adapters", async () => {
    const terminal = new FakeTerminalPort();
    const launches: ExternalApplicationLaunch[] = [];
    const openedDirectories: string[] = [];
    const adapter = new WindowsExternalApplicationAdapter(
      terminal,
      {
        pathExists: async () => true,
        isDirectory: async () => true,
        launch: async (request) => {
          launches.push(request);
        },
        openDirectory: async (path) => {
          openedDirectories.push(path);
          return "";
        }
      }
    );
    const profiles: ExternalApplicationProfile[] = [
      {
        kind: "cursor",
        label: "Cursor",
        executablePath: "C:\\Apps\\Cursor.exe"
      },
      {
        kind: "file-explorer",
        label: "File Explorer"
      },
      {
        kind: "terminal",
        label: "Terminal",
        executablePath: "C:\\Apps\\wt.exe",
        terminalKind: "windows-terminal"
      }
    ];

    for (const profile of profiles) {
      await adapter.launch(profile, WORKING_DIRECTORY);
    }

    expect(launches).toEqual([
      {
        executable: "C:\\Apps\\Cursor.exe",
        args: ["--reuse-window", WORKING_DIRECTORY],
        cwd: WORKING_DIRECTORY
      }
    ]);
    expect(openedDirectories).toEqual([WORKING_DIRECTORY]);
    expect(terminal.launches).toEqual([
      {
        profile: {
          kind: "windows-terminal",
          label: "Terminal",
          executablePath: "C:\\Apps\\wt.exe"
        },
        workingDirectory: WORKING_DIRECTORY
      }
    ]);
  });
});

class FakeTerminalPort implements ExternalTerminalPort {
  readonly profiles: ExternalTerminalProfile[];
  readonly launches: Array<{
    profile: ExternalTerminalProfile;
    workingDirectory: string;
  }> = [];

  constructor(
    profiles: ExternalTerminalProfile[] = [
      {
        kind: "windows-terminal",
        label: "Windows Terminal",
        executablePath: "C:\\Apps\\wt.exe"
      },
      {
        kind: "git-bash",
        label: "Git Bash",
        executablePath: "C:\\Apps\\bash.exe"
      }
    ]
  ) {
    this.profiles = profiles;
  }

  async listAvailable(): Promise<ExternalTerminalProfile[]> {
    return structuredClone(this.profiles);
  }

  async launch(
    profile: ExternalTerminalProfile,
    workingDirectory: string
  ): Promise<void> {
    this.launches.push({
      profile: structuredClone(profile),
      workingDirectory
    });
  }
}
