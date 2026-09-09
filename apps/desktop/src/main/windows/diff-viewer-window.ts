import { app, BrowserWindow } from "electron";

import type { OpenDiffViewerRequest } from "@gitnest/contracts";

import { createWindowOptions } from "./window-options";
import {
  resolvePreloadPath,
  resolveRendererPath
} from "./window-paths";

const windows = new Map<string, BrowserWindow>();

export async function openDiffViewerWindow(
  request: OpenDiffViewerRequest
): Promise<void> {
  const key = [
    request.target.repositoryId,
    request.target.worktreeId,
    request.mode,
    request.path
  ].join("\u0001");
  const existing = windows.get(key);

  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) {
      existing.restore();
    }
    existing.show();
    existing.focus();
    return;
  }

  const window = new BrowserWindow({
    ...createWindowOptions(
      resolvePreloadPath(import.meta.dirname)
    ),
    width: 1320,
    height: 820,
    minWidth: 920,
    minHeight: 560,
    title: "GitNest Diff"
  });
  windows.set(key, window);

  window.once("ready-to-show", () => {
    window.show();
  });
  window.once("closed", () => {
    if (windows.get(key) === window) {
      windows.delete(key);
    }
  });
  window.webContents.setWindowOpenHandler(() => ({
    action: "deny"
  }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    const currentUrl = window.webContents.getURL();

    if (targetUrl !== currentUrl) {
      event.preventDefault();
    }
  });

  const query = {
    view: "diff",
    repositoryId: request.target.repositoryId,
    worktreeId: request.target.worktreeId,
    path: request.path,
    mode: request.mode
  };

  try {
    const developmentUrl = process.env.ELECTRON_RENDERER_URL;
    if (!app.isPackaged && developmentUrl) {
      const url = new URL(developmentUrl);
      for (const [name, value] of Object.entries(query)) {
        url.searchParams.set(name, value);
      }
      await window.loadURL(url.href);
    } else {
      await window.loadFile(
        resolveRendererPath(import.meta.dirname),
        { query }
      );
    }
  } catch (error) {
    if (windows.get(key) === window) {
      windows.delete(key);
    }
    if (!window.isDestroyed()) {
      window.destroy();
    }
    throw error;
  }
}
