import { app, BrowserWindow } from "electron";

import { createApplication } from "./bootstrap/create-application";

if (!app.requestSingleInstanceLock()) {
  if (!app.isPackaged) {
    console.warn(
      "[GitNest] 开发实例未启动：已有 GitNest 正在运行。请先从系统托盘退出 GitNest，再运行 pnpm dev。"
    );
  }
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
