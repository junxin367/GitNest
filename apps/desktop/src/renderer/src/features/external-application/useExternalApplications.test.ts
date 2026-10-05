/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ExternalApplicationProfileDto
} from "@gitnest/contracts";

import {
  selectPreferredExternalApplication,
  useExternalApplications,
  type ExternalApplicationController
} from "./useExternalApplications";
import { rendererPreferenceKeys } from "../../shared/lib/renderer-preferences";
import {
  useExternalTerminals,
  type ExternalTerminalController
} from "../external-terminal/useExternalTerminals";

const PROFILES: ExternalApplicationProfileDto[] = [
  {
    kind: "cursor",
    label: "Cursor"
  },
  {
    kind: "file-explorer",
    label: "File Explorer"
  },
  {
    kind: "git-bash",
    label: "Git Bash"
  }
];

describe("selectPreferredExternalApplication", () => {
  it("keeps an available user preference", () => {
    expect(
      selectPreferredExternalApplication(
        PROFILES,
        "file-explorer"
      )
    ).toEqual(PROFILES[1]);
  });

  it("uses the approved application priority for first use and missing preferences", () => {
    expect(
      selectPreferredExternalApplication(PROFILES, undefined)
    ).toEqual(PROFILES[0]);
    expect(
      selectPreferredExternalApplication(PROFILES, "vscode")
    ).toEqual(PROFILES[0]);
  });
});

describe("useExternalApplications interaction state", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controllers: ExternalApplicationController[];
  let listApplications: ReturnType<typeof vi.fn>;
  let openApplication: ReturnType<typeof vi.fn>;
  const repositoryContext = {
    scope: "repository" as const,
    target: { repositoryId: "repository", worktreeId: "main" }
  };

  beforeEach(() => {
    (globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    controllers = [];
    listApplications = vi.fn().mockResolvedValue({ ok: true, value: PROFILES });
    openApplication = vi.fn().mockImplementation(async ({ kind }) => ({
      ok: true, value: { kind }
    }));
    vi.stubGlobal("gitnest", {
      system: {
        listExternalApplications: listApplications,
        openExternalApplication: openApplication
      }
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  function Harness({
    context,
    workspaceId = "workspace-a",
    slot = 0
  }: {
    context: Parameters<typeof useExternalApplications>[0];
    workspaceId?: string;
    slot?: number;
  }) {
    controllers[slot] = useExternalApplications(context, workspaceId);
    return null;
  }

  async function renderContext(
    context: Parameters<typeof useExternalApplications>[0] = repositoryContext,
    workspaceId = "workspace-a"
  ) {
    await act(async () => {
      root.render(React.createElement(Harness, { context, workspaceId }));
    });
  }

  it.each([false, true])(
    "synchronizes successful application choices across mounted entry points (storage unavailable: %s)",
    async (storageUnavailable) => {
      if (storageUnavailable) {
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
          throw new Error("Storage unavailable");
        });
      }
      await act(async () => {
        root.render(React.createElement(React.Fragment, null,
          React.createElement(Harness, { context: { scope: "workspace" }, slot: 0 }),
          React.createElement(Harness, { context: repositoryContext, slot: 1 })
        ));
      });
      expect(controllers.map((controller) => controller.preferredProfile?.kind))
        .toEqual(["cursor", "cursor"]);

      await act(async () => { await controllers[1]!.open("file-explorer"); });

      expect(controllers.map((controller) => controller.preferredProfile?.kind))
        .toEqual(["file-explorer", "file-explorer"]);
      await act(async () => { await controllers[0]!.open("git-bash"); });
      expect(controllers.map((controller) => controller.preferredProfile?.kind))
        .toEqual(["git-bash", "git-bash"]);
      if (!storageUnavailable) {
        expect(window.localStorage.getItem(rendererPreferenceKeys.preferredExternalApplication))
          .toBe("git-bash");
      }
    }
  );

  it("updates the preferred application after another renderer changes storage", async () => {
    await renderContext();
    window.localStorage.setItem(rendererPreferenceKeys.preferredExternalApplication, "git-bash");
    act(() => window.dispatchEvent(new StorageEvent("storage", {
      key: rendererPreferenceKeys.preferredExternalApplication,
      newValue: "git-bash",
      storageArea: window.localStorage
    })));
    expect(controllers[0]!.preferredProfile?.kind).toBe("git-bash");
  });

  it.each(["directory", "file"] as const)(
    "blocks a same-tick second %s launch and permits retry after failure",
    async (secondKind) => {
      await renderContext();
      const first = deferred<unknown>();
      openApplication.mockReturnValueOnce(first.promise);
      let firstOpen!: Promise<boolean>;
      let secondOpen!: Promise<boolean>;
      act(() => {
        firstOpen = controllers[0]!.open("cursor");
        secondOpen = secondKind === "file"
          ? controllers[0]!.openFile("file-explorer", "src/index.ts", 12)
          : controllers[0]!.open("file-explorer");
      });
      expect(openApplication).toHaveBeenCalledTimes(1);
      await expect(secondOpen).resolves.toBe(false);
      await act(async () => {
        first.resolve({ ok: false, error: { code: "COMMAND_FAILED", message: "Launch failed" } });
        expect(await firstOpen).toBe(false);
      });
      expect(controllers[0]!.active).toBeNull();
      expect(controllers[0]!.error?.message).toBe("Launch failed");
      await act(async () => {
        expect(await controllers[0]!.open("file-explorer")).toBe(true);
      });
      expect(openApplication).toHaveBeenCalledTimes(2);
      expect(controllers[0]!.error).toBeNull();
    }
  );

  it.each(["success", "failure", "rejection"] as const)(
    "ignores an older application-list %s after a newer reload settles",
    async (outcome) => {
      await renderContext();
      const older = deferred<unknown>();
      const newer = deferred<unknown>();
      listApplications.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
      let oldReload!: Promise<void>;
      let newReload!: Promise<void>;
      act(() => {
        oldReload = controllers[0]!.reload();
        newReload = controllers[0]!.reload();
      });
      const latestProfiles = [{ kind: "vscode", label: "VS Code" }];
      await act(async () => {
        newer.resolve({ ok: true, value: latestProfiles });
        await newReload;
      });
      expect(controllers[0]!.profiles).toEqual(latestProfiles);
      expect(controllers[0]!.loading).toBe(false);

      await act(async () => {
        older.resolve(outcome === "success"
          ? { ok: true, value: PROFILES }
          : outcome === "failure"
            ? { ok: false, error: { code: "COMMAND_FAILED", message: "Stale list error" } }
            : Promise.reject(new Error("Stale transport error")));
        await oldReload;
      });

      expect(controllers[0]!.profiles).toEqual(latestProfiles);
      expect(controllers[0]!.error).toBeNull();
      expect(controllers[0]!.loading).toBe(false);
    }
  );

  it.each(["success", "failure"] as const)(
    "ignores a previous Workspace launch %s without unlocking the new launch",
    async (outcome) => {
      await renderContext({ scope: "workspace" }, "workspace-a");
      const older = deferred<unknown>();
      const newer = deferred<unknown>();
      openApplication.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
      let oldOpen!: Promise<boolean>;
      let newOpen!: Promise<boolean>;
      act(() => { oldOpen = controllers[0]!.open("file-explorer"); });
      await renderContext({ scope: "workspace" }, "workspace-b");
      expect(controllers[0]!.active).toBeNull();
      act(() => { newOpen = controllers[0]!.open("git-bash"); });
      await act(async () => {
        older.resolve(outcome === "success"
          ? { ok: true, value: { kind: "file-explorer" } }
          : { ok: false, error: { code: "COMMAND_FAILED", message: "Old Workspace error" } });
        expect(await oldOpen).toBe(false);
      });
      expect(controllers[0]!.active).toBe("git-bash");
      expect(controllers[0]!.error).toBeNull();
      expect(controllers[0]!.preferredProfile?.kind).toBe("cursor");
      await act(async () => {
        newer.resolve({ ok: true, value: { kind: "git-bash" } });
        expect(await newOpen).toBe(true);
      });
      expect(controllers[0]!.active).toBeNull();
      expect(controllers[0]!.preferredProfile?.kind).toBe("git-bash");
    }
  );

  it("rejects old Workspace callbacks after switching the same workspace scope", async () => {
    await renderContext({ scope: "workspace" }, "workspace-a");
    const previous = controllers[0]!;
    await renderContext({ scope: "workspace" }, "workspace-b");
    listApplications.mockClear();
    await act(async () => {
      expect(await previous.open("cursor")).toBe(false);
      await previous.reload();
    });
    expect(openApplication).not.toHaveBeenCalled();
    expect(listApplications).not.toHaveBeenCalled();
  });
});

describe("external terminal workspace lifecycle", () => {
  let root: Root;
  let container: HTMLDivElement;
  let controller: ExternalTerminalController;
  let openTerminal: ReturnType<typeof vi.fn>;
  const target = { repositoryId: "shared-repository", worktreeId: "main" };

  beforeEach(() => {
    (globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }).IS_REACT_ACT_ENVIRONMENT = true;
    openTerminal = vi.fn().mockResolvedValue({
      ok: true, value: { kind: "powershell", label: "PowerShell" }
    });
    vi.stubGlobal("gitnest", {
      system: {
        listExternalTerminals: vi.fn().mockResolvedValue({
          ok: true, value: [{ kind: "powershell", label: "PowerShell" }]
        }),
        openExternalTerminal: openTerminal
      }
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function Harness({ workspaceId }: { workspaceId: string }) {
    controller = useExternalTerminals(target, workspaceId);
    return null;
  }

  async function renderWorkspace(workspaceId: string) {
    await act(async () => root.render(React.createElement(Harness, { workspaceId })));
  }

  it.each(["success", "failure", "rejection"] as const)(
    "ignores an old Workspace terminal %s without unlocking the new launch",
    async (outcome) => {
      const first = deferred<unknown>();
      const second = deferred<unknown>();
      openTerminal.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      await renderWorkspace("workspace-a");
      let oldLaunch!: Promise<boolean>;
      act(() => { oldLaunch = controller.open("powershell"); });
      await renderWorkspace("workspace-b");
      expect(controller.active).toBeNull();
      let newLaunch!: Promise<boolean>;
      act(() => { newLaunch = controller.open("powershell"); });
      expect(openTerminal).toHaveBeenCalledTimes(2);
      await act(async () => {
        first.resolve(outcome === "success"
          ? { ok: true, value: { kind: "powershell", label: "PowerShell" } }
          : outcome === "failure"
            ? { ok: false, error: { code: "COMMAND_FAILED", message: "old terminal failure" } }
            : Promise.reject(new Error("old terminal transport failure")));
        expect(await oldLaunch).toBe(false);
      });
      expect(controller.active).toBe("powershell");
      expect(controller.error).toBeNull();
      expect(controller.notice).toBeNull();
      await act(async () => {
        second.resolve({ ok: true, value: { kind: "powershell", label: "PowerShell" } });
        expect(await newLaunch).toBe(true);
      });
      expect(controller.active).toBeNull();
      expect(controller.notice).toContain("PowerShell");
    }
  );

  it("blocks duplicate launches before rendering and permits retry after a failure", async () => {
    const pending = deferred<unknown>();
    openTerminal.mockReturnValueOnce(pending.promise);
    await renderWorkspace("workspace-a");
    let first!: Promise<boolean>;
    let duplicate!: Promise<boolean>;
    act(() => {
      first = controller.open("powershell");
      duplicate = controller.open("powershell");
    });
    expect(openTerminal).toHaveBeenCalledTimes(1);
    expect(await duplicate).toBe(false);
    await act(async () => {
      pending.resolve({ ok: false, error: { code: "COMMAND_FAILED", message: "terminal launch failed" } });
      expect(await first).toBe(false);
    });
    expect(controller.active).toBeNull();
    expect(controller.error?.message).toBe("terminal launch failed");
    await act(async () => { expect(await controller.open("powershell")).toBe(true); });
    expect(openTerminal).toHaveBeenCalledTimes(2);
    expect(controller.error).toBeNull();
  });

  it("rejects a terminal callback captured before changing workspace", async () => {
    await renderWorkspace("workspace-a");
    const previous = controller;
    await renderWorkspace("workspace-b");
    await act(async () => { expect(await previous.open("powershell")).toBe(false); });
    expect(openTerminal).not.toHaveBeenCalled();
  });
});

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((settle) => { resolve = settle; });
  return { promise, resolve };
}
