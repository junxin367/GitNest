import { app, BrowserWindow } from "electron";

import { registerIpcHandlers } from "../ipc/register-ipc";
import { createMainWindow } from "../windows/main-window";
import { registerServices } from "./register-services";

export async function createApplication(): Promise<void> {
  await app.whenReady();

  const services = registerServices();
  registerIpcHandlers(services);
  await createMainWindow(
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

  let shutdownStarted = false;
  let shutdownComplete = false;
  app.on("before-quit", (event) => {
    if (shutdownComplete) {
      return;
    }
    event.preventDefault();
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    void (async () => {
      try {
        const [codeAnalysisResult, workspaceResult] =
          await Promise.allSettled([
            services.codeAnalysis.dispose(),
            services.workspace.dispose()
          ]);
        if (codeAnalysisResult.status === "rejected") {
          await services.diagnostics
            .warning("code-analysis.dispose-failed", {
              error: codeAnalysisResult.reason
            })
            .catch(() => undefined);
        }
        if (workspaceResult.status === "rejected") {
          await services.diagnostics
            .warning("workspace.dispose-failed", {
              error: workspaceResult.reason
            })
            .catch(() => undefined);
        }
        await services.diagnostics
          .info("application.before-quit", {
            windowCount: BrowserWindow.getAllWindows().length
          })
          .catch(() => undefined);
        await services.diagnostics
          .flush()
          .catch(() => undefined);
      } finally {
        shutdownComplete = true;
        app.quit();
      }
    })();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow(
        services.windowState,
        services.diagnostics
      ).catch((error) =>
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
