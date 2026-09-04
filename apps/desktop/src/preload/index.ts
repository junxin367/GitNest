import {
  contextBridge,
  ipcRenderer,
  webUtils,
  type IpcRendererEvent
} from "electron";

import { IPC_EVENTS } from "@gitnest/contracts";
import type {
  IpcInvoke,
  WorkspaceRuntimeStateDto
} from "@gitnest/contracts";

import { createGitNestBridge } from "./bridge";

const invoke = ((
  channel: string,
  ...args: unknown[]
) => ipcRenderer.invoke(channel, ...args)) as IpcInvoke;

const bridge = createGitNestBridge(
  invoke,
  (file) => webUtils.getPathForFile(file as never),
  (listener) => {
    const handler = (
      _event: IpcRendererEvent,
      state: WorkspaceRuntimeStateDto
    ) => {
      listener(state);
    };
    ipcRenderer.on(IPC_EVENTS.workspaceStateChanged, handler);
    return () => {
      ipcRenderer.removeListener(
        IPC_EVENTS.workspaceStateChanged,
        handler
      );
    };
  }
);

contextBridge.exposeInMainWorld("gitnest", bridge);
