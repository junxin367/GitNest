import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_DIFF_COMMIT_PANEL_HEIGHT,
  createDefaultAppSettings
} from "@gitnest/contracts";

import {
  APP_SETTINGS_SCHEMA_VERSION,
  AppSettingsService,
  type SettingsSecretVault
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

  it("returns defaults and persists the AI key only in the protected vault", async () => {
    const filePath = await createSettingsPath();
    const vault = new MemorySecretVault();
    const service = new AppSettingsService(
      filePath,
      vault,
      {
        clock: () => "2026-09-10T12:00:00.000Z",
        credentialRefFactory: () =>
          "settings_ai_api_key_test"
      }
    );

    const initial = await service.get();
    expect(initial.storageState).toBe("missing");
    expect(initial.settings.general.restoreLastView).toBe(true);
    expect(initial.settings.git.pushStrategy).toBe("rebase");
    expect(initial.settings.diff.commitPanelHeight).toBe(
      DEFAULT_DIFF_COMMIT_PANEL_HEIGHT
    );
    expect(initial.settings.ai.apiKeyConfigured).toBe(false);
    expect(initial.settings.codeAnalysis.defaultScope).toBe(
      "changed"
    );

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
      ai: {
        apiKeyCredentialRef?: string;
        apiKey?: string;
      };
    };
    expect(document.schemaVersion).toBe(
      APP_SETTINGS_SCHEMA_VERSION
    );
    expect(document.ai.apiKey).toBeUndefined();
    expect(document.ai.apiKeyCredentialRef).toBe(
      "settings_ai_api_key_test"
    );
    await expect(
      vault.read("settings_ai_api_key_test")
    ).resolves.toBe("plain-text-test-key");
  });

  it("preserves an omitted key and requires explicit confirmation before clearing it", async () => {
    const filePath = await createSettingsPath();
    const vault = new MemorySecretVault();
    const service = new AppSettingsService(filePath, vault, {
      credentialRefFactory: () =>
        "settings_ai_api_key_keep"
    });

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
    await expect(
      vault.read("settings_ai_api_key_keep")
    ).rejects.toMatchObject({ code: "MISSING_SECRET" });
  });

  it("can clear a credential reference when the protected secret is already missing", async () => {
    const filePath = await createSettingsPath();
    const vault = new MemorySecretVault();
    const service = new AppSettingsService(filePath, vault, {
      credentialRefFactory: () =>
        "settings_ai_api_key_missing"
    });
    await service.update({
      ai: {
        apiKey: "temporary-secret"
      }
    });
    await vault.delete("settings_ai_api_key_missing");

    await expect(
      service.clearAiApiKey(true)
    ).resolves.toMatchObject({
      ai: { apiKeyConfigured: false }
    });
    const persisted = JSON.parse(
      await readFile(filePath, "utf8")
    ) as {
      ai: { apiKeyCredentialRef?: string };
    };
    expect(persisted.ai.apiKeyCredentialRef).toBeUndefined();
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
    const service = new AppSettingsService(
      filePath,
      new MemorySecretVault()
    );

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

  it("rejects credential references owned by another secret domain", async () => {
    const filePath = await createSettingsPath();
    const defaults = createDefaultAppSettings();
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
        general: defaults.general,
        appearance: defaults.appearance,
        diff: defaults.diff,
        git: defaults.git,
        ai: {
          enabled: true,
          apiUrl: "https://ai.example.test/v1",
          model: "test-model",
          apiKeyCredentialRef: "credential_account_token",
          prompt: defaults.ai.prompt
        },
        codeAnalysis: defaults.codeAnalysis,
        navigation: defaults.navigation,
        updatedAt: "2026-09-19T00:00:00.000Z"
      }),
      "utf8"
    );

    const service = new AppSettingsService(
      filePath,
      new MemorySecretVault()
    );

    await expect(service.get()).rejects.toMatchObject({
      code: "INVALID_PERSISTED_DATA"
    });
  });

  it("migrates residual current-schema keys and removes unknown sensitive fields", async () => {
    const filePath = await createSettingsPath();
    const defaults = createDefaultAppSettings();
    const secret = "current-schema-plain-text-key";
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
        general: {
          ...defaults.general,
          token: secret
        },
        appearance: defaults.appearance,
        diff: defaults.diff,
        git: defaults.git,
        ai: {
          enabled: true,
          apiUrl: "https://ai.example.test/v1",
          model: "test-model",
          apiKey: secret,
          token: secret,
          credential: secret,
          prompt: defaults.ai.prompt
        },
        codeAnalysis: {
          ...defaults.codeAnalysis,
          credential: secret
        },
        navigation: defaults.navigation,
        updatedAt: "2026-09-19T00:00:00.000Z",
        token: secret
      }),
      "utf8"
    );
    const vault = new MemorySecretVault();
    const service = new AppSettingsService(filePath, vault);

    await expect(service.get()).resolves.toMatchObject({
      settings: {
        ai: {
          apiKeyConfigured: true
        }
      }
    });
    await expect(
      vault.read("settings_ai_api_key_legacy")
    ).resolves.toBe(secret);
    const persisted = await readFile(filePath, "utf8");
    expect(persisted).not.toContain(secret);
    const parsed = JSON.parse(persisted) as {
      ai: Record<string, unknown>;
      general: Record<string, unknown>;
      codeAnalysis: Record<string, unknown>;
      token?: string;
    };
    expect(parsed.token).toBeUndefined();
    expect(parsed.general.token).toBeUndefined();
    expect(parsed.ai.apiKey).toBeUndefined();
    expect(parsed.ai.token).toBeUndefined();
    expect(parsed.ai.credential).toBeUndefined();
    expect(parsed.codeAnalysis.credential).toBeUndefined();
    expect(parsed.ai.apiKeyCredentialRef).toBe(
      "settings_ai_api_key_legacy"
    );
  });

  it("backfills the commit panel height for existing schema documents", async () => {
    const filePath = await createSettingsPath();
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
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
    const service = new AppSettingsService(
      filePath,
      new MemorySecretVault()
    );

    const loaded = await service.get();
    expect(loaded.settings.diff.commitPanelHeight).toBe(
      DEFAULT_DIFF_COMMIT_PANEL_HEIGHT
    );
    expect(loaded.settings.codeAnalysis.enabled).toBe(true);

    await service.update({ diff: { wrap: true } });
    const persisted = JSON.parse(
      await readFile(filePath, "utf8")
    ) as {
      diff: { commitPanelHeight: number };
    };
    expect(persisted.diff.commitPanelHeight).toBe(
      DEFAULT_DIFF_COMMIT_PANEL_HEIGHT
    );
    expect(
      JSON.parse(await readFile(filePath, "utf8"))
        .schemaVersion
    ).toBe(APP_SETTINGS_SCHEMA_VERSION);
  });

  it("migrates an existing schema v2 plaintext key into the protected vault", async () => {
    const filePath = await createSettingsPath();
    const defaults = createDefaultAppSettings();
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 2,
        general: defaults.general,
        appearance: defaults.appearance,
        diff: defaults.diff,
        git: defaults.git,
        ai: {
          enabled: true,
          apiUrl: "https://ai.example.test/v1",
          model: "test-model",
          apiKey: "legacy-plain-text-key",
          prompt: defaults.ai.prompt
        },
        codeAnalysis: defaults.codeAnalysis,
        navigation: defaults.navigation,
        updatedAt: "2026-09-19T00:00:00.000Z"
      }),
      "utf8"
    );
    const vault = new MemorySecretVault();
    const service = new AppSettingsService(filePath, vault, {
      credentialRefFactory: () =>
        "settings_ai_api_key_unused"
    });

    const loaded = await service.get();

    expect(loaded.settings.ai.apiKeyConfigured).toBe(true);
    expect(
      (await service.getInternalAiSettings()).apiKey
    ).toBe("legacy-plain-text-key");
    const persisted = JSON.parse(
      await readFile(filePath, "utf8")
    ) as {
      schemaVersion: number;
      ai: {
        apiKey?: string;
        apiKeyCredentialRef?: string;
      };
    };
    expect(persisted.schemaVersion).toBe(
      APP_SETTINGS_SCHEMA_VERSION
    );
    expect(persisted.ai.apiKey).toBeUndefined();
    expect(persisted.ai.apiKeyCredentialRef).toBe(
      "settings_ai_api_key_legacy"
    );
    await expect(
      vault.read("settings_ai_api_key_legacy")
    ).resolves.toBe("legacy-plain-text-key");
  });

  it("retries a legacy migration after a transient vault failure", async () => {
    const filePath = await createSettingsPath();
    const defaults = createDefaultAppSettings();
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 2,
        general: defaults.general,
        appearance: defaults.appearance,
        diff: defaults.diff,
        git: defaults.git,
        ai: {
          enabled: true,
          apiUrl: "https://ai.example.test/v1",
          model: "test-model",
          apiKey: "retry-this-key",
          prompt: defaults.ai.prompt
        },
        codeAnalysis: defaults.codeAnalysis,
        navigation: defaults.navigation,
        updatedAt: "2026-09-19T00:00:00.000Z"
      }),
      "utf8"
    );
    const vault = new MemorySecretVault();
    vault.saveFailuresRemaining = 1;
    const service = new AppSettingsService(filePath, vault);

    await expect(service.get()).rejects.toThrow(
      "Transient vault failure."
    );
    await expect(service.get()).resolves.toMatchObject({
      settings: {
        ai: {
          apiKeyConfigured: true
        }
      }
    });
    expect(vault.saveAttempts).toBe(2);
    await expect(
      vault.read("settings_ai_api_key_legacy")
    ).resolves.toBe("retry-this-key");
  });

  async function createSettingsPath(): Promise<string> {
    testDirectory = await mkdtemp(
      join(tmpdir(), "gitnest-app-settings-")
    );
    return join(testDirectory, "app-settings.json");
  }
});

class MemorySecretVault implements SettingsSecretVault {
  readonly #secrets = new Map<string, string>();
  saveAttempts = 0;
  saveFailuresRemaining = 0;

  async save(
    credentialRef: string,
    secret: string
  ): Promise<void> {
    this.saveAttempts += 1;
    if (this.saveFailuresRemaining > 0) {
      this.saveFailuresRemaining -= 1;
      throw new Error("Transient vault failure.");
    }
    this.#secrets.set(credentialRef, secret);
  }

  async read(credentialRef: string): Promise<string> {
    const secret = this.#secrets.get(credentialRef);
    if (secret === undefined) {
      throw Object.assign(new Error("Secret missing."), {
        code: "MISSING_SECRET"
      });
    }
    return secret;
  }

  async delete(credentialRef: string): Promise<void> {
    this.#secrets.delete(credentialRef);
  }
}
