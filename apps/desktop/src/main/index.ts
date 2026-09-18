import { app, BrowserWindow } from "electron";

import { createApplication } from "./bootstrap/create-application";

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  });

  void createApplication().catch(() => {
    process.exitCode = 1;
    app.quit();
  });
}
