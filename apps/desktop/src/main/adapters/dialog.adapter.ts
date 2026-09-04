import {
  dialog,
  type BrowserWindow
} from "electron";

import type {
  WorkspaceDirectorySelectionDto
} from "@gitnest/contracts";

export async function selectWorkspaceDirectory(
  window: BrowserWindow
): Promise<WorkspaceDirectorySelectionDto> {
  const result = await dialog.showOpenDialog(window, {
    title: "添加 Workspace 目录",
    buttonLabel: "添加目录",
    properties: ["openDirectory"]
  });
  const path = result.filePaths[0];

  return result.canceled || !path
    ? { cancelled: true }
    : { cancelled: false, path };
}

export async function selectWorktreeDirectory(
  window: BrowserWindow
): Promise<WorkspaceDirectorySelectionDto> {
  const result = await dialog.showOpenDialog(window, {
    title: "选择 Worktree 目标目录或父目录",
    buttonLabel: "授权此目录",
    properties: ["openDirectory", "createDirectory"]
  });
  const path = result.filePaths[0];

  return result.canceled || !path
    ? { cancelled: true }
    : { cancelled: false, path };
}
