import { app, BrowserWindow } from "electron";

import { registerIpcHandlers } from "../ipc/register-ipc";
import { runCodeAnalysisCacheMaintenance } from "../storage/cache-maintenance";
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
  const updateCheckTimer =
    app.isPackaged &&
    process.env.GITNEST_DISABLE_UPDATE_CHECK !== "1"
    ? setTimeout(() => {
        void services.applicationUpdate.check("startup");
      }, 10_000)
    : undefined;
  void services.workspace
    .getCurrent()
    .then((workspace) =>
      runCodeAnalysisCacheMaintenance({
        registry: services.dataRegistry,
        workspaceId: workspace.id
      })
    )
    .then((result) =>
      services.diagnostics.info(
        "code-analysis.cache-maintenance",
        result
      )
    )
    .catch((error) =>
      services.diagnostics.warning(
        "code-analysis.cache-maintenance-failed",
        { error }
      )
    )
    .catch(() => undefined);
  void services.diagnostics
    .info("application.ready", {
      appVersion: app.getVersion(),
      platform: process.platform,
      packaged: app.isPackaged
    })
    .catch(() => undefined);

  app.on("browser-window-focus", () => {
    void services.workspace
      .setForeground(true)
      .catch((error) =>
        services.diagnostics.warning(
          "workspace.foreground-update-failed",
          { error }
        )
      )
      .catch(() => undefined);
  });
  app.on("browser-window-blur", () => {
    setTimeout(() => {
      void services.workspace
        .setForeground(
          Boolean(BrowserWindow.getFocusedWindow())
        )
        .catch((error) =>
          services.diagnostics.warning(
            "workspace.foreground-update-failed",
            { error }
          )
        )
        .catch(() => undefined);
    }, 0);
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
    if (updateCheckTimer) {
      clearTimeout(updateCheckTimer);
    }
    services.applicationUpdate.dispose();
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
