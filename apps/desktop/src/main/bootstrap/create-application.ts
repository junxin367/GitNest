import { app, BrowserWindow } from "electron";

import { registerIpcHandlers } from "../ipc/register-ipc";
import { createMainWindow } from "../windows/main-window";
import { registerServices } from "./register-services";

let mainWindow: BrowserWindow | null = null;

export async function createApplication(): Promise<void> {
  await app.whenReady();

  const services = registerServices();
  registerIpcHandlers(services);
  mainWindow = await createMainWindow(
    services.windowState,
    services.diagnostics
  );
  void services.diagnostics
    .info("application.ready", {
      appVersion: app.getVersion(),
      platform: process.platform,
      packaged: app.isPackaged
    })
    .catch(() => undefined);

  app.on("browser-window-focus", () => {
    void services.workspace
      .refreshStaleOnFocus()
      .catch((error) =>
        services.diagnostics.warning(
          "workspace.focus-refresh-failed",
          { error }
        )
      )
      .catch(() => undefined);
  });

  app.on("before-quit", () => {
    void services.workspace
      .dispose()
      .catch((error) =>
        services.diagnostics.warning(
          "workspace.dispose-failed",
          { error }
        )
      )
      .catch(() => undefined);
    void services.diagnostics
      .info("application.before-quit", {
        windowCount: BrowserWindow.getAllWindows().length
      })
      .then(() => services.diagnostics.flush())
      .catch(() => undefined);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow(
        services.windowState,
        services.diagnostics
      ).then((window) => {
        mainWindow = window;
      }).catch((error) =>
        services.diagnostics.error(
          "window.create-failed",
          { error }
        )
      ).catch(() => undefined);
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
