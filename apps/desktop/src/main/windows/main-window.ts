import {
  app,
  BrowserWindow,
  screen
} from "electron";

import { IPC_EVENTS } from "@gitnest/contracts";

import type { RotatingDiagnosticLogger } from "../adapters/diagnostic-logger.adapter";
import { createWindowOptions } from "./window-options";
import {
  resolvePreloadPath,
  resolveRendererPath
} from "./window-paths";
import {
  createMainWindowCloseCoordinator,
  type MainWindowCloseLifecycle
} from "./main-window-close";
import {
  clampWindowState,
  type JsonWindowStateStore,
  type PersistedWindowState
} from "./window-state";

export async function createMainWindow(
  stateStore: JsonWindowStateStore,
  diagnostics: RotatingDiagnosticLogger,
  lifecycle?: MainWindowCloseLifecycle
): Promise<BrowserWindow> {
  let restored: PersistedWindowState | null = null;
  try {
    restored = await stateStore.load();
  } catch (error) {
    void diagnostics
      .warning("window.state-load-failed", {
        error
      })
      .catch(() => undefined);
  }
  const clamped = restored
    ? clampWindowState(
        restored,
        screen
          .getAllDisplays()
          .map((display) => display.workArea),
        screen.getPrimaryDisplay().workArea
      )
    : null;
  const window = new BrowserWindow(
    createWindowOptions(
      resolvePreloadPath(import.meta.dirname),
      clamped?.bounds
    )
  );
  let persistenceTimer:
    | ReturnType<typeof setTimeout>
    | undefined;

  const readState = (): PersistedWindowState => ({
    bounds: window.getNormalBounds(),
    maximized: window.isMaximized()
  });
  const persist = async (
    state: PersistedWindowState
  ): Promise<void> => {
    try {
      await stateStore.save(state);
    } catch (error) {
      await diagnostics
        .warning("window.state-save-failed", {
          error
        })
        .catch(() => undefined);
    }
  };
  let closeCoordinator: ReturnType<
    typeof createMainWindowCloseCoordinator
  >;
  const schedulePersistence = () => {
    if (closeCoordinator.isPending()) {
      return;
    }
    if (persistenceTimer) {
      clearTimeout(persistenceTimer);
    }
    persistenceTimer = setTimeout(() => {
      persistenceTimer = undefined;
      void persist(readState());
    }, 250);
  };
  const handleMaximizedChange = () => {
    schedulePersistence();
    if (!window.webContents.isDestroyed()) {
      window.webContents.send(
        IPC_EVENTS.windowMaximizedChanged,
        window.isMaximized()
      );
    }
  };
  closeCoordinator = createMainWindowCloseCoordinator({
    ...(lifecycle ? { lifecycle } : {}),
    persist: async () => {
      if (persistenceTimer) {
        clearTimeout(persistenceTimer);
        persistenceTimer = undefined;
      }
      await persist(readState());
    },
    target: window
  });

  window.once("ready-to-show", () => {
    if (clamped?.maximized) {
      window.maximize();
    }
    window.show();
  });
  window.on("move", schedulePersistence);
  window.on("resize", schedulePersistence);
  window.on("maximize", handleMaximizedChange);
  window.on("unmaximize", handleMaximizedChange);
  window.on("close", (event) => {
    closeCoordinator.handleClose(event);
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    const currentUrl = window.webContents.getURL();

    if (targetUrl !== currentUrl) {
      event.preventDefault();
    }
  });

  const developmentUrl = process.env.ELECTRON_RENDERER_URL;

  if (!app.isPackaged && developmentUrl) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(resolveRendererPath(import.meta.dirname));
  }

  return window;
}
