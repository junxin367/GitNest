import type { BrowserWindowConstructorOptions } from "electron";

import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  type WindowBounds
} from "./window-state";

export function createWindowOptions(
  preloadPath: string,
  bounds?: WindowBounds
): BrowserWindowConstructorOptions {
  return {
    ...(bounds
      ? {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height
        }
      : {
          width: 1440,
          height: 900
        }),
    minWidth: Math.min(
      MIN_WINDOW_WIDTH,
      bounds?.width ?? MIN_WINDOW_WIDTH
    ),
    minHeight: Math.min(
      MIN_WINDOW_HEIGHT,
      bounds?.height ?? MIN_WINDOW_HEIGHT
    ),
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: "#0d131b",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  };
}
