import { Menu, nativeImage, screen, Tray } from "electron";

import type { RotatingDiagnosticLogger } from "../adapters/diagnostic-logger.adapter";
import { createTrayMenu } from "./tray-menu";
import { resolveTrayMenuPreloadPath } from "./window-paths";
import trayIconPath from "../../../build/icon.png?asset";

interface ApplicationTrayOptions {
  diagnostics?: Pick<RotatingDiagnosticLogger, "info" | "warning">;
  quitApplication(): void;
  showMainWindow(): void;
}

interface ApplicationTray {
  destroy(): void;
}

export function createApplicationTray({
  diagnostics,
  quitApplication,
  showMainWindow
}: ApplicationTrayOptions): ApplicationTray {
  const icon = nativeImage.createFromPath(trayIconPath);
  if (icon.isEmpty()) {
    throw new Error("The application tray icon could not be loaded.");
  }

  const tray = new Tray(icon);
  tray.setToolTip("GitNest");
  const popup = process.platform === "win32"
    ? createTrayMenu({
        preloadPath: resolveTrayMenuPreloadPath(import.meta.dirname),
        ...(diagnostics ? { diagnostics } : {}),
        quitApplication,
        showMainWindow
      })
    : undefined;
  if (popup) {
    tray.on("right-click", () => popup.show(screen.getCursorScreenPoint(), tray.getBounds()));
  } else {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "显示 GitNest", click: showMainWindow },
      { type: "separator" },
      { label: "退出 GitNest", click: quitApplication }
    ]));
  }
  tray.on("click", () => {
    popup?.hide("tray-click");
    showMainWindow();
  });
  void diagnostics?.info("tray.ready", {
    strategy: popup ? "window-no-animation" : "native",
    platform: process.platform
  }).catch(() => undefined);
  return {
    destroy() {
      popup?.destroy();
      if (!tray.isDestroyed()) {
        tray.destroy();
      }
    }
  };
}
