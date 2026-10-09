import { app, BrowserWindow } from "electron";

import { registerIpcHandlers } from "../ipc/register-ipc";
import { runCodeAnalysisCacheMaintenance } from "../storage/cache-maintenance";
import { createApplicationTray } from "../windows/application-tray";
import { createMainWindow } from "../windows/main-window";
import { registerServices } from "./register-services";

export async function createApplication(): Promise<void> {
  await app.whenReady();

  const services = registerServices();
  registerIpcHandlers(services);
  let shutdownStarted = false;
  let shutdownComplete = false;
  let mainWindow: BrowserWindow | undefined;
  let applicationTray:
    | ReturnType<typeof createApplicationTray>
    | undefined;
  const createOrShowMainWindow =
    async (): Promise<BrowserWindow | undefined> => {
      if (shutdownStarted) {
        return undefined;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
        return mainWindow;
      }

      const window = await createMainWindow(
        services.windowState,
        services.diagnostics,
        {
          getCloseBehavior: async () => {
            const loaded = await services.settings.get();
            return applicationTray &&
              loaded.settings.general.closeBehavior === "tray"
              ? "tray"
              : "quit";
          },
          isQuitting: () => shutdownStarted,
          onCloseBehaviorLoadFailed: (error) => {
            void services.diagnostics
              .warning("window.close-behavior-load-failed", {
                error
              })
              .catch(() => undefined);
          },
          requestQuit: () => app.quit()
        }
      );
      mainWindow = window;
      window.once("closed", () => {
        if (mainWindow === window) {
          mainWindow = undefined;
        }
      });
      return window;
    };
  const reportWindowCreationFailure = (error: unknown) =>
    services.diagnostics
      .error("window.create-failed", { error })
      .catch(() => undefined);

  await createOrShowMainWindow();
  applicationTray = createApplicationTray({
    diagnostics: services.diagnostics,
    quitApplication: () => app.quit(),
    showMainWindow: () => {
      void createOrShowMainWindow().catch(
        reportWindowCreationFailure
      );
    }
  });
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

  app.on("browser-window-focus", (_event, window) => {
    if (!(window instanceof BrowserWindow)) {
      return;
    }
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

  app.on("before-quit", (event) => {
    if (shutdownComplete) {
      return;
    }
    event.preventDefault();
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    applicationTray?.destroy();
    applicationTray = undefined;
    if (updateCheckTimer) {
      clearTimeout(updateCheckTimer);
    }
    services.applicationUpdate.dispose();
    services.codeAnalysisRefresh.dispose();
    void (async () => {
      try {
        const [codeAnalysisResult, workspaceResult, repositoryCreationResult] =
          await Promise.allSettled([
            services.codeAnalysis.dispose(),
            services.workspace.dispose(),
            services.repositoryManagement.dispose()
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
        if (repositoryCreationResult.status === "rejected") {
          await services.diagnostics.warning("repository-creation.dispose-failed", {
            error: repositoryCreationResult.reason
          }).catch(() => undefined);
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
    void createOrShowMainWindow().catch(
      reportWindowCreationFailure
    );
  });

  app.on("window-all-closed", () => {
    if (
      shutdownStarted ||
      (process.platform !== "darwin" && !applicationTray)
    ) {
      app.quit();
    }
  });
}
