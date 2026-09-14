import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_DIFF_COMMIT_PANEL_HEIGHT } from "@gitnest/contracts";

import {
  APP_SETTINGS_SCHEMA_VERSION,
  AppSettingsService
} from "./app-settings";

describe("AppSettingsService", () => {
  let testDirectory = "";

  afterEach(async () => {
    if (
      testDirectory &&
      resolve(testDirectory).startsWith(resolve(tmpdir()))
    ) {
      await rm(testDirectory, {
        recursive: true,
        force: true
      });
    }
    testDirectory = "";
  });

  it("returns defaults for missing storage and persists a plaintext AI key only in the internal document", async () => {
    const filePath = await createSettingsPath();
    const service = new AppSettingsService(
      filePath,
      () => "2026-09-10T12:00:00.000Z"
    );

    const initial = await service.get();
    expect(initial.storageState).toBe("missing");
    expect(initial.settings.general.restoreLastView).toBe(true);
    expect(initial.settings.git.pushStrategy).toBe("rebase");
    expect(initial.settings.diff.commitPanelHeight).toBe(
      DEFAULT_DIFF_COMMIT_PANEL_HEIGHT
    );
    expect(initial.settings.ai.apiKeyConfigured).toBe(false);

    const updated = await service.update({
      appearance: { theme: "light" },
      git: { pushStrategy: "merge" },
      ai: {
        enabled: true,
        apiUrl: "https://ai.example.test/v1",
        model: "test-model",
        apiKey: "plain-text-test-key"
      }
    });

    expect(updated.ai.apiKeyConfigured).toBe(true);
    expect(updated.git.pushStrategy).toBe("merge");
    expect(updated).not.toHaveProperty("ai.apiKey");
    const document = JSON.parse(
      await readFile(filePath, "utf8")
    ) as {
      schemaVersion: number;
      ai: { apiKey: string };
    };
    expect(document.schemaVersion).toBe(
      APP_SETTINGS_SCHEMA_VERSION
    );
    expect(document.ai.apiKey).toBe("plain-text-test-key");
  });

  it("preserves an omitted key and requires explicit confirmation before clearing it", async () => {
    const filePath = await createSettingsPath();
    const service = new AppSettingsService(filePath);

    await service.update({
      ai: {
        apiUrl: "https://ai.example.test/v1",
        model: "test-model",
        apiKey: "keep-this-key"
      }
    });
    await service.update({
      diff: { layout: "split", wrap: true }
    });

    expect(
      (await service.getInternalAiSettings()).apiKey
    ).toBe("keep-this-key");
    await expect(
      service.clearAiApiKey(false)
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });

    const cleared = await service.clearAiApiKey(true);
    expect(cleared.ai.apiKeyConfigured).toBe(false);
    expect(
      (await service.getInternalAiSettings()).apiKey
    ).toBe("");
  });

  it("blocks writes when persisted settings fail schema validation", async () => {
    const filePath = await createSettingsPath();
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
        ai: { apiKey: "do-not-overwrite" }
      }),
      "utf8"
    );
    const service = new AppSettingsService(filePath);

    await expect(service.get()).rejects.toMatchObject({
      code: "INVALID_PERSISTED_DATA"
    });
    await expect(
      service.update({ appearance: { theme: "light" } })
    ).rejects.toBeDefined();
    expect(
      JSON.parse(await readFile(filePath, "utf8"))
    ).toEqual({
      schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
      ai: { apiKey: "do-not-overwrite" }
    });
  });

  it("backfills the commit panel height for existing schema documents", async () => {
    const filePath = await createSettingsPath();
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
        general: {
          restoreLastView: true,
          defaultTerminalKind: null
        },
        appearance: { theme: "dark" },
        diff: {
          fileView: "list",
          layout: "unified",
          wrap: false,
          treeDirectoriesCollapsed: false
        },
        git: { fetchMode: "manual" },
        ai: {
          enabled: false,
          apiUrl: "",
          model: "",
          apiKey: "",
          prompt: "existing prompt"
        },
        navigation: {
          lastContentView: "workspace",
          workspaceTab: "overview",
          repositoryTab: "overview"
        },
        updatedAt: "2026-09-14T00:00:00.000Z"
      }),
      "utf8"
    );
    const service = new AppSettingsService(filePath);

    const loaded = await service.get();
    expect(loaded.settings.diff.commitPanelHeight).toBe(
      DEFAULT_DIFF_COMMIT_PANEL_HEIGHT
    );

    await service.update({ diff: { wrap: true } });
    const persisted = JSON.parse(
      await readFile(filePath, "utf8")
    ) as {
      diff: { commitPanelHeight: number };
    };
    expect(persisted.diff.commitPanelHeight).toBe(
      DEFAULT_DIFF_COMMIT_PANEL_HEIGHT
    );
  });

  async function createSettingsPath(): Promise<string> {
    testDirectory = await mkdtemp(
      join(tmpdir(), "gitnest-app-settings-")
    );
    return join(testDirectory, "app-settings.json");
  }
});
