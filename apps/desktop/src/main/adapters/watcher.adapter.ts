import {
  watch,
  type FSWatcher
} from "node:fs";
import { join } from "node:path";

import type {
  WorkspaceWatchHandle,
  WorkspaceWatcher,
  WorkspaceWatchRegistration
} from "@gitnest/workspace-core";

export class NodeWorkspaceWatcher implements WorkspaceWatcher {
  async watch(
    registrations: WorkspaceWatchRegistration[],
    onChange: Parameters<WorkspaceWatcher["watch"]>[1],
    onError: Parameters<WorkspaceWatcher["watch"]>[2]
  ): Promise<WorkspaceWatchHandle> {
    const watchers: FSWatcher[] = [];

    try {
      for (const registration of registrations) {
        const watcher = watch(
          registration.path,
          {
            persistent: false,
            recursive: registration.recursive
          },
          (_eventType, filename) => {
            const relativePath =
              filename === null
                ? ""
                : Buffer.isBuffer(filename)
                  ? filename.toString("utf8")
                  : filename;
            onChange({
              path: relativePath
                ? join(registration.path, relativePath)
                : registration.path,
              target: registration.target
            });
          }
        );
        watcher.on("error", onError);
        watchers.push(watcher);
      }
    } catch (error) {
      for (const watcher of watchers) {
        watcher.close();
      }
      throw error;
    }

    return {
      close: () => {
        for (const watcher of watchers) {
          watcher.close();
        }
      }
    };
  }
}
