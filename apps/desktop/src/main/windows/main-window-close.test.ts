import { describe, expect, it, vi } from "vitest";

import {
  createMainWindowCloseCoordinator,
  type MainWindowCloseLifecycle
} from "./main-window-close";

describe("createMainWindowCloseCoordinator", () => {
  it("persists and hides the window when tray behavior is selected", async () => {
    const firstPersistence = deferred<void>();
    const target = createTarget();
    const lifecycle = createLifecycle("tray");
    const coordinator = createMainWindowCloseCoordinator({
      lifecycle,
      persist: vi.fn(() => firstPersistence.promise),
      target
    });
    const event = { preventDefault: vi.fn() };

    coordinator.handleClose(event);
    coordinator.handleClose(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(target.hide).not.toHaveBeenCalled();

    firstPersistence.resolve();
    await vi.waitFor(() => {
      expect(target.hide).toHaveBeenCalledOnce();
    });
    expect(lifecycle.requestQuit).not.toHaveBeenCalled();
    expect(coordinator.isPending()).toBe(false);
  });

  it("requests application shutdown and then allows the final close", async () => {
    const target = createTarget();
    const lifecycle = createLifecycle("quit");
    const coordinator = createMainWindowCloseCoordinator({
      lifecycle,
      persist: vi.fn(async () => undefined),
      target
    });
    const firstEvent = { preventDefault: vi.fn() };

    coordinator.handleClose(firstEvent);
    await vi.waitFor(() => {
      expect(lifecycle.requestQuit).toHaveBeenCalledOnce();
    });

    const finalEvent = { preventDefault: vi.fn() };
    coordinator.handleClose(finalEvent);
    expect(finalEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("defaults to quitting when close behavior cannot be loaded", async () => {
    const target = createTarget();
    const error = new Error("settings unavailable");
    const lifecycle = createLifecycle("tray");
    lifecycle.getCloseBehavior.mockRejectedValue(error);
    const coordinator = createMainWindowCloseCoordinator({
      lifecycle,
      persist: vi.fn(async () => undefined),
      target
    });

    coordinator.handleClose({ preventDefault: vi.fn() });

    await vi.waitFor(() => {
      expect(lifecycle.requestQuit).toHaveBeenCalledOnce();
    });
    expect(
      lifecycle.onCloseBehaviorLoadFailed
    ).toHaveBeenCalledWith(error);
    expect(target.hide).not.toHaveBeenCalled();
  });
});

function createLifecycle(
  closeBehavior: "tray" | "quit"
) {
  return {
    getCloseBehavior: vi.fn(async () => closeBehavior),
    isQuitting: () => false,
    onCloseBehaviorLoadFailed: vi.fn(
      (_error: unknown) => undefined
    ),
    requestQuit: vi.fn(() => undefined)
  } satisfies MainWindowCloseLifecycle;
}

function createTarget() {
  return {
    close: vi.fn(),
    hide: vi.fn(),
    isDestroyed: vi.fn(() => false)
  };
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
