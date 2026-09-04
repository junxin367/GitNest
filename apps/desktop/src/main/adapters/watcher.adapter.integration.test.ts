import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createTemporaryDirectoryFixture,
  type TemporaryDirectoryFixture
} from "@gitnest/testkit";

import { NodeWorkspaceWatcher } from "./watcher.adapter";

describe("NodeWorkspaceWatcher", () => {
  let temporary: TemporaryDirectoryFixture | undefined;

  afterEach(async () => {
    await temporary?.dispose();
    temporary = undefined;
  });

  it("forwards a file-system change with its exact repository target", async () => {
    temporary =
      await createTemporaryDirectoryFixture("watcher");
    const target = {
      repositoryId: "repository",
      worktreeId: "worktree"
    };
    let close: (() => void | Promise<void>) | undefined;
    const changed = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Watcher event timed out.")),
        3_000
      );

      void new NodeWorkspaceWatcher()
        .watch(
          [
            {
              path: temporary?.path as string,
              target,
              recursive: false
            }
          ],
          (event) => {
            clearTimeout(timeout);
            expect(event.target).toEqual(target);
            resolve(event.path);
          },
          reject
        )
        .then((handle) => {
          close = () => handle.close();
        }, reject);
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    const filePath = join(temporary.path, "changed.txt");
    await writeFile(filePath, "changed", "utf8");

    await expect(changed).resolves.toBe(filePath);
    await close?.();
  });
});
