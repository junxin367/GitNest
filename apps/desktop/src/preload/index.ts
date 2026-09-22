import {
  contextBridge,
  ipcRenderer,
  type IpcRendererEvent
} from "electron";

import { IPC_EVENTS } from "@gitnest/contracts";
import type {
  ApplicationUpdateStateDto,
  AppSettingsDto,
  CodeAnalysisStateDto,
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
  },
  (listener) => {
    const handler = (
      _event: IpcRendererEvent,
      state: CodeAnalysisStateDto
    ) => {
      listener(state);
    };
    ipcRenderer.on(
      IPC_EVENTS.codeAnalysisStateChanged,
      handler
    );
    return () => {
      ipcRenderer.removeListener(
        IPC_EVENTS.codeAnalysisStateChanged,
        handler
      );
    };
  },
  (listener) => {
    const handler = (
      _event: IpcRendererEvent,
      settings: AppSettingsDto
    ) => {
      listener(settings);
    };
    ipcRenderer.on(IPC_EVENTS.settingsChanged, handler);
    return () => {
      ipcRenderer.removeListener(
        IPC_EVENTS.settingsChanged,
        handler
      );
    };
  },
  (listener) => {
    const handler = (
      _event: IpcRendererEvent,
      state: ApplicationUpdateStateDto
    ) => {
      listener(state);
    };
    ipcRenderer.on(
      IPC_EVENTS.applicationUpdateStateChanged,
      handler
    );
    return () => {
      ipcRenderer.removeListener(
        IPC_EVENTS.applicationUpdateStateChanged,
        handler
      );
    };
  },
  (listener) => {
    const handler = (
      _event: IpcRendererEvent,
      maximized: boolean
    ) => {
      listener(maximized);
    };
    ipcRenderer.on(
      IPC_EVENTS.windowMaximizedChanged,
      handler
    );
    return () => {
      ipcRenderer.removeListener(
        IPC_EVENTS.windowMaximizedChanged,
        handler
      );
    };
  }
);

contextBridge.exposeInMainWorld("gitnest", bridge);
