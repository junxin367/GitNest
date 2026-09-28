import {
  readFile,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";

import {
  afterEach,
  describe,
  expect,
  it
} from "vitest";

import {
  createTemporaryDirectoryFixture,
  type TemporaryDirectoryFixture
} from "@gitnest/testkit";

import {
  JsonWindowStateStore,
  clampWindowState
} from "./window-state";

const PRIMARY = {
  x: 0,
  y: 0,
  width: 1920,
  height: 1040
};
const SECONDARY = {
  x: -1280,
  y: 0,
  width: 1280,
  height: 1024
};

describe("window state", () => {
  let temporary: TemporaryDirectoryFixture | undefined;

  afterEach(async () => {
    await temporary?.dispose();
    temporary = undefined;
  });

  it("keeps visible bounds on the display with the greatest overlap", () => {
    expect(
      clampWindowState(
        {
          bounds: {
            x: -1200,
            y: 80,
            width: 1180,
            height: 800
          },
          maximized: false
        },
        [PRIMARY, SECONDARY],
        PRIMARY
      )
    ).toEqual({
      bounds: {
        x: -1200,
        y: 80,
        width: 1180,
        height: 800
      },
      maximized: false
    });
  });

  it("moves disconnected or oversized bounds into the primary work area", () => {
    expect(
      clampWindowState(
        {
          bounds: {
            x: 4000,
            y: 2000,
            width: 3000,
            height: 2000
          },
          maximized: true
        },
        [PRIMARY, SECONDARY],
        PRIMARY
      )
    ).toEqual({
      bounds: {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040
      },
      maximized: true
    });
  });

  it("uses the available work area when a display is smaller than the normal minimum", () => {
    expect(
      clampWindowState(
        {
          bounds: {
            x: 0,
            y: 0,
            width: 300,
            height: 200
          },
          maximized: false
        },
        [
          {
            x: 0,
            y: 0,
            width: 1024,
            height: 640
          }
        ],
        {
          x: 0,
          y: 0,
          width: 1024,
          height: 640
        }
      )
    ).toEqual({
      bounds: {
        x: 0,
        y: 0,
        width: 1024,
        height: 640
      },
      maximized: false
    });
  });

  it("migrates v0 state and writes the whitelisted v1 document", async () => {
    temporary =
      await createTemporaryDirectoryFixture(
        "window-state-migration"
      );
    const filePath = join(
      temporary.path,
      "window-state.json"
    );
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 0,
        x: 100,
        y: 120,
        width: 1400,
        height: 860,
        isMaximized: true,
        updatedAt: "2026-09-04T11:00:00.000Z",
        unknown: true
      }),
      "utf8"
    );

    await expect(
      new JsonWindowStateStore(filePath).load()
    ).resolves.toEqual({
      bounds: {
        x: 100,
        y: 120,
        width: 1400,
        height: 860
      },
      maximized: true
    });
    const persisted = JSON.parse(
      await readFile(filePath, "utf8")
    );
    expect(persisted.schemaVersion).toBe(1);
    expect(persisted.unknown).toBeUndefined();
  });

  it("preserves invalid state and blocks later overwrite", async () => {
    temporary =
      await createTemporaryDirectoryFixture(
        "window-state-invalid"
      );
    const filePath = join(
      temporary.path,
      "window-state.json"
    );
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        bounds: {
          x: 0,
          y: 0,
          width: -1,
          height: 900
        },
        maximized: false,
        updatedAt: "2026-09-04T11:00:00.000Z"
      }),
      "utf8"
    );
    const original = await readFile(filePath, "utf8");
    const store = new JsonWindowStateStore(filePath);

    await expect(store.load()).rejects.toMatchObject({
      code: "INVALID_PERSISTED_DATA"
    });
    await expect(
      store.save({
        bounds: {
          x: 0,
          y: 0,
          width: 1440,
          height: 900
        },
        maximized: false
      })
    ).rejects.toMatchObject({
      code: "PERSISTENCE_FAILED"
    });
    await expect(readFile(filePath, "utf8")).resolves.toBe(
      original
    );
  });
});
