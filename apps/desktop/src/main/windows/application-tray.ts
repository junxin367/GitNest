import {
  Menu,
  nativeImage,
  Tray
} from "electron";

import trayIconPath from "../../../build/icon.png?asset";

interface ApplicationTrayOptions {
  quitApplication(): void;
  showMainWindow(): void;
}

export function createApplicationTray({
  quitApplication,
  showMainWindow
}: ApplicationTrayOptions): Tray {
  const icon = nativeImage.createFromPath(trayIconPath);
  if (icon.isEmpty()) {
    throw new Error("The application tray icon could not be loaded.");
  }

  const tray = new Tray(icon);
  tray.setToolTip("GitNest");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "显示 GitNest",
        click: showMainWindow
      },
      { type: "separator" },
      {
        label: "退出 GitNest",
        click: quitApplication
      }
    ])
  );
  tray.on("click", showMainWindow);
  return tray;
}
