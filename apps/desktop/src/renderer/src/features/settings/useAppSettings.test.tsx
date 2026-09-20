/** @vitest-environment jsdom */

import { act } from "react";
import {
  createRoot,
  type Root
} from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import {
  createDefaultAppSettings,
  type AppSettingsDto,
  type GitNestBridge
} from "@gitnest/contracts";

import {
  useAppSettings,
  type AppSettingsController
} from "./useAppSettings";

describe("useAppSettings concurrent activity", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: AppSettingsController | undefined;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("releases saving after reload invalidates an update response", async () => {
    const pendingUpdate = deferred<
      Awaited<
        ReturnType<GitNestBridge["settings"]["update"]>
      >
    >();
    installBridge({
      update: vi.fn(() => pendingUpdate.promise)
    });
    await mountHarness();

    let updatePromise!: Promise<boolean>;
    await act(async () => {
      updatePromise = controller!.update({
        appearance: { theme: "light" }
      });
      await Promise.resolve();
    });
    expect(controller?.saving).toBe(true);

    await act(async () => {
      await controller!.reload();
    });

    await act(async () => {
      pendingUpdate.resolve({
        ok: true as const,
        value: {
          ...createDefaultAppSettings(),
          appearance: { theme: "light" }
        }
      });
      await updatePromise;
    });

    expect(controller?.saving).toBe(false);
  });

  it("releases clearingKey after reload invalidates a clear response", async () => {
    const pendingClear = deferred<
      Awaited<
        ReturnType<
          GitNestBridge["settings"]["clearAiApiKey"]
        >
      >
    >();
    installBridge({
      clearAiApiKey: vi.fn(() => pendingClear.promise)
    });
    await mountHarness();

    let clearPromise!: Promise<boolean>;
    await act(async () => {
      clearPromise = controller!.clearAiApiKey();
      await Promise.resolve();
    });
    expect(controller?.clearingKey).toBe(true);

    await act(async () => {
      await controller!.reload();
    });

    await act(async () => {
      pendingClear.resolve({
        ok: true as const,
        value: createDefaultAppSettings()
      });
      await clearPromise;
    });

    expect(controller?.clearingKey).toBe(false);
  });

  it("applies a settings event and ignores an older reload response", async () => {
    const pendingReload = deferred<
      Awaited<ReturnType<GitNestBridge["settings"]["get"]>>
    >();
    let settingsListener:
      | ((settings: AppSettingsDto) => void)
      | undefined;
    const get = vi
      .fn<GitNestBridge["settings"]["get"]>()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          settings: createDefaultAppSettings(),
          storageState: "persisted"
        }
      })
      .mockReturnValueOnce(pendingReload.promise);
    installBridge({
      get,
      onChanged: (listener) => {
        settingsListener = listener;
        return () => {
          settingsListener = undefined;
        };
      }
    });
    await mountHarness();

    let reloadPromise!: Promise<void>;
    await act(async () => {
      reloadPromise = controller!.reload();
      await Promise.resolve();
    });
    expect(controller?.loading).toBe(true);

    const changed = {
      ...createDefaultAppSettings(),
      appearance: { theme: "light" as const }
    };
    act(() => settingsListener?.(changed));
    expect(controller?.settings).toEqual(changed);
    expect(controller?.loaded).toBe(true);
    expect(controller?.loading).toBe(false);

    pendingReload.resolve({
      ok: true,
      value: {
        settings: createDefaultAppSettings(),
        storageState: "persisted"
      }
    });
    await act(async () => {
      await reloadPromise;
    });

    expect(controller?.settings).toEqual(changed);
  });

  it("keeps a successful update successful when its broadcast arrives first", async () => {
    const pendingUpdate = deferred<
      Awaited<
        ReturnType<GitNestBridge["settings"]["update"]>
      >
    >();
    let settingsListener:
      | ((settings: AppSettingsDto) => void)
      | undefined;
    installBridge({
      update: vi.fn(() => pendingUpdate.promise),
      onChanged: (listener) => {
        settingsListener = listener;
        return () => {
          settingsListener = undefined;
        };
      }
    });
    await mountHarness();
    const changed = {
      ...createDefaultAppSettings(),
      appearance: { theme: "light" as const }
    };

    let updatePromise!: Promise<boolean>;
    await act(async () => {
      updatePromise = controller!.update({
        appearance: { theme: "light" }
      });
      await Promise.resolve();
    });
    act(() => settingsListener?.(changed));
    await act(async () => {
      pendingUpdate.resolve({
        ok: true,
        value: changed
      });
      await updatePromise;
    });

    await expect(updatePromise).resolves.toBe(true);
    expect(controller?.settings).toEqual(changed);
    expect(controller?.saving).toBe(false);
    expect(controller?.notice).toBe("设置已保存。");
  });

  it("reports an update failure after an unrelated settings event", async () => {
    const pendingUpdate = deferred<
      Awaited<
        ReturnType<GitNestBridge["settings"]["update"]>
      >
    >();
    let settingsListener:
      | ((settings: AppSettingsDto) => void)
      | undefined;
    installBridge({
      update: vi.fn(() => pendingUpdate.promise),
      onChanged: (listener) => {
        settingsListener = listener;
        return () => {
          settingsListener = undefined;
        };
      }
    });
    await mountHarness();

    let updatePromise!: Promise<boolean>;
    await act(async () => {
      updatePromise = controller!.update({
        appearance: { theme: "light" }
      });
      await Promise.resolve();
    });
    act(() =>
      settingsListener?.({
        ...createDefaultAppSettings(),
        git: {
          ...createDefaultAppSettings().git,
          fetchMode: "startup"
        }
      })
    );
    await act(async () => {
      pendingUpdate.resolve({
        ok: false,
        error: {
          code: "COMMAND_FAILED",
          message: "write failed",
          details: {}
        }
      });
      await updatePromise;
    });

    await expect(updatePromise).resolves.toBe(false);
    expect(controller?.saving).toBe(false);
    expect(controller?.error?.message).toBe(
      "write failed"
    );
  });

  it("keeps a successful key clear successful when its broadcast arrives first", async () => {
    const pendingClear = deferred<
      Awaited<
        ReturnType<
          GitNestBridge["settings"]["clearAiApiKey"]
        >
      >
    >();
    let settingsListener:
      | ((settings: AppSettingsDto) => void)
      | undefined;
    installBridge({
      clearAiApiKey: vi.fn(() => pendingClear.promise),
      onChanged: (listener) => {
        settingsListener = listener;
        return () => {
          settingsListener = undefined;
        };
      }
    });
    await mountHarness();
    const changed = createDefaultAppSettings();

    let clearPromise!: Promise<boolean>;
    await act(async () => {
      clearPromise = controller!.clearAiApiKey();
      await Promise.resolve();
    });
    act(() => settingsListener?.(changed));
    await act(async () => {
      pendingClear.resolve({
        ok: true,
        value: changed
      });
      await clearPromise;
    });

    await expect(clearPromise).resolves.toBe(true);
    expect(controller?.settings).toEqual(changed);
    expect(controller?.clearingKey).toBe(false);
    expect(controller?.notice).toBe(
      "AI API Key 已清空。"
    );
  });

  it("cleans up a migrated legacy theme when its settings event arrives first", async () => {
    let settingsListener:
      | ((settings: AppSettingsDto) => void)
      | undefined;
    const migrated = {
      ...createDefaultAppSettings(),
      appearance: { theme: "light" as const }
    };
    window.localStorage.setItem("gitnest.theme", "light");
    installBridge({
      get: vi.fn(async () => ({
        ok: true as const,
        value: {
          settings: createDefaultAppSettings(),
          storageState: "missing" as const
        }
      })),
      update: vi.fn(async () => {
        settingsListener?.(migrated);
        return {
          ok: true as const,
          value: migrated
        };
      }),
      onChanged: (listener) => {
        settingsListener = listener;
        return () => {
          settingsListener = undefined;
        };
      }
    });

    await mountHarness();

    expect(controller?.settings).toEqual(migrated);
    expect(
      window.localStorage.getItem("gitnest.theme")
    ).toBeNull();
  });

  it("unsubscribes from settings events on unmount", async () => {
    const unsubscribe = vi.fn();
    installBridge({
      onChanged: vi.fn(() => unsubscribe)
    });
    await mountHarness();

    act(() => root.unmount());

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  async function mountHarness() {
    await act(async () => {
      root.render(
        <Harness onChange={(value) => (controller = value)} />
      );
      await flushAsyncWork();
    });
  }
});

function Harness({
  onChange
}: {
  onChange(controller: AppSettingsController): void;
}) {
  onChange(useAppSettings());
  return null;
}

function installBridge(
  overrides: Partial<GitNestBridge["settings"]>
) {
  const settings = createDefaultAppSettings();
  Object.defineProperty(window, "gitnest", {
    configurable: true,
    value: {
      settings: {
        get: vi.fn(async () => ({
          ok: true as const,
          value: {
            settings,
            storageState: "persisted" as const
          }
        })),
        update: vi.fn(async () => ({
          ok: true as const,
          value: settings
        })),
        clearAiApiKey: vi.fn(async () => ({
          ok: true as const,
          value: settings
        })),
        onChanged: () => () => undefined,
        ...overrides
      }
    } as unknown as GitNestBridge
  });
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
