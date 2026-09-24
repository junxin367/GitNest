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
  DEFAULT_CODE_ANALYSIS_PERIODIC_REFRESH_MINUTES,
  DEFAULT_DIFF_COMMIT_PANEL_HEIGHT,
  DEFAULT_MCP_MAX_STALE_AGE_DAYS,
  createDefaultAppSettings,
  type UpdateAppSettingsRequest
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
    expect(initial.settings.codeAnalysis.maxGraphNodes).toBe(
      50_000
    );
    expect(initial.settings.codeAnalysis.maxGraphEdges).toBe(
      100_000
    );
    expect(initial.settings.codeAnalysis.maxTotalSourceMb).toBe(
      128
    );
    expect(initial.settings.codeAnalysis.readConcurrency).toBe(4);
    expect(initial.settings.codeAnalysis.graphDepth).toBe(8);
    expect(
      initial.settings.codeAnalysis.java.maxDocuments
    ).toBe(80);
    expect(
      initial.settings.codeAnalysis.java.maxReferenceRequests
    ).toBe(1_000);
    expect(
      initial.settings.codeAnalysis.java
        .maxTypeHierarchyRequests
    ).toBe(80);
    expect(
      initial.settings.codeAnalysis.autoRefresh
        .periodicEnabled
    ).toBe(true);
    expect(
      initial.settings.codeAnalysis.autoRefresh
        .periodicIntervalMinutes
    ).toBe(
      DEFAULT_CODE_ANALYSIS_PERIODIC_REFRESH_MINUTES
    );
    expect(
      initial.settings.codeAnalysis.mcp.maxStaleAgeDays
    ).toBe(DEFAULT_MCP_MAX_STALE_AGE_DAYS);
    await expect(service.readAiApiKey(false)).resolves.toEqual({
      apiKey: null,
      length: 0
    });

    const updated = await service.update({
      appearance: { theme: "light" },
      git: { pushStrategy: "merge" },
      codeAnalysis: {
        maxGraphNodes: 45_000,
        maxGraphEdges: 120_000,
        autoRefresh: {
          periodicEnabled: false,
          periodicIntervalMinutes: 180
        },
        mcp: {
          maxStaleAgeDays: 30
        },
        java: {
          maxDocuments: 500,
          maxTypeHierarchyRequests: 160,
          maxReferenceRequests: 2_000
        }
      },
      ai: {
        enabled: true,
        apiUrl: "https://ai.example.test/v1",
        model: "test-model",
        apiKey: "plain-text-test-key"
      }
    });

    expect(updated.ai.apiKeyConfigured).toBe(true);
    await expect(service.readAiApiKey(false)).resolves.toEqual({
      apiKey: null,
      length: 19
    });
    await expect(service.readAiApiKey(true)).resolves.toEqual({
      apiKey: "plain-text-test-key",
      length: 19
    });
    expect(updated.git.pushStrategy).toBe("merge");
    expect(updated.codeAnalysis.maxGraphNodes).toBe(45_000);
    expect(updated.codeAnalysis.maxGraphEdges).toBe(120_000);
    expect(updated.codeAnalysis.autoRefresh).toMatchObject({
      periodicEnabled: false,
      periodicIntervalMinutes: 180
    });
    expect(updated.codeAnalysis.mcp.maxStaleAgeDays).toBe(30);
    expect(updated.codeAnalysis.java).toMatchObject({
      maxDocuments: 500,
      maxTypeHierarchyRequests: 160,
      maxReferenceRequests: 2_000
    });
    expect(updated).not.toHaveProperty("ai.apiKey");
    const document = JSON.parse(
      await readFile(filePath, "utf8")
    ) as {
      schemaVersion: number;
      ai: {
        apiKeyCredentialRef?: string;
        apiKey?: string;
      };
      codeAnalysis: {
        maxGraphNodes: number;
        maxGraphEdges: number;
        autoRefresh: {
          periodicEnabled: boolean;
          periodicIntervalMinutes: number;
        };
        mcp: {
          maxStaleAgeDays: number;
        };
        java: {
          maxDocuments: number;
          maxTypeHierarchyRequests: number;
          maxReferenceRequests: number;
        };
      };
    };
    expect(document.schemaVersion).toBe(
      APP_SETTINGS_SCHEMA_VERSION
    );
    expect(document.ai.apiKey).toBeUndefined();
    expect(document.ai.apiKeyCredentialRef).toBe(
      "settings_ai_api_key_test"
    );
    expect(document.codeAnalysis.maxGraphNodes).toBe(45_000);
    expect(document.codeAnalysis.maxGraphEdges).toBe(120_000);
    expect(document.codeAnalysis.autoRefresh).toMatchObject({
      periodicEnabled: false,
      periodicIntervalMinutes: 180
    });
    expect(document.codeAnalysis.mcp.maxStaleAgeDays).toBe(30);
    expect(document.codeAnalysis.java).toMatchObject({
      maxDocuments: 500,
      maxTypeHierarchyRequests: 160,
      maxReferenceRequests: 2_000
    });
    await expect(
      vault.read("settings_ai_api_key_test")
    ).resolves.toBe("plain-text-test-key");
  });

  it("merges partial periodic refresh and MCP updates without resetting sibling settings", async () => {
    const filePath = await createSettingsPath();
    const service = new AppSettingsService(
      filePath,
      new MemorySecretVault()
    );

    await service.update({
      codeAnalysis: {
        autoRefresh: {
          enabled: false,
          debounceMs: 2_500,
          periodicEnabled: false,
          periodicIntervalMinutes: 120
        },
        mcp: {
          enabled: false,
          allowSourceSnippets: false,
          maxResponseKb: 512,
          maxStaleAgeDays: 14
        }
      }
    });

    const updated = await service.update({
      codeAnalysis: {
        autoRefresh: {
          periodicIntervalMinutes: 240
        },
        mcp: {
          maxStaleAgeDays: 21
        }
      }
    });

    expect(updated.codeAnalysis.autoRefresh).toEqual({
      enabled: false,
      debounceMs: 2_500,
      periodicEnabled: false,
      periodicIntervalMinutes: 240
    });
    expect(updated.codeAnalysis.mcp).toEqual({
      enabled: false,
      allowSourceSnippets: false,
      maxResponseKb: 512,
      maxStaleAgeDays: 21
    });

    const persisted = JSON.parse(
      await readFile(filePath, "utf8")
    ) as {
      codeAnalysis: {
        autoRefresh: {
          enabled: boolean;
          debounceMs: number;
          periodicEnabled: boolean;
          periodicIntervalMinutes: number;
        };
        mcp: {
          enabled: boolean;
          allowSourceSnippets: boolean;
          maxResponseKb: number;
          maxStaleAgeDays: number;
        };
      };
    };
    expect(persisted.codeAnalysis.autoRefresh).toEqual(
      updated.codeAnalysis.autoRefresh
    );
    expect(persisted.codeAnalysis.mcp).toEqual(
      updated.codeAnalysis.mcp
    );
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

  it("clears the saved AI key when the API URL changes without a replacement key", async () => {
    const filePath = await createSettingsPath();
    const vault = new MemorySecretVault();
    const service = new AppSettingsService(filePath, vault, {
      credentialRefFactory: () =>
        "settings_ai_api_key_endpoint"
    });

    await service.update({
      ai: {
        apiUrl: "https://first.example.test/v1",
        model: "test-model",
        apiKey: "endpoint-bound-key"
      }
    });

    const updated = await service.update({
      ai: {
        apiUrl: "https://second.example.test/v1"
      }
    });

    expect(updated.ai).toMatchObject({
      apiUrl: "https://second.example.test/v1",
      apiKeyConfigured: false
    });
    await expect(
      service.getInternalAiSettings()
    ).resolves.toMatchObject({
      apiUrl: "https://second.example.test/v1",
      apiKey: ""
    });
    await expect(
      vault.read("settings_ai_api_key_endpoint")
    ).rejects.toMatchObject({ code: "MISSING_SECRET" });
  });

  it("preserves the saved AI key when the API URL resolves to the same endpoint", async () => {
    const filePath = await createSettingsPath();
    const vault = new MemorySecretVault();
    const service = new AppSettingsService(filePath, vault, {
      credentialRefFactory: () =>
        "settings_ai_api_key_equivalent_endpoint"
    });

    await service.update({
      ai: {
        apiUrl: "https://ai.example.test/v1/",
        model: "test-model",
        apiKey: "endpoint-bound-key"
      }
    });

    const updated = await service.update({
      ai: {
        apiUrl:
          "https://ai.example.test/v1/chat/completions/"
      }
    });

    expect(updated.ai).toMatchObject({
      apiUrl:
        "https://ai.example.test/v1/chat/completions/",
      apiKeyConfigured: true
    });
    await expect(
      service.getInternalAiSettings()
    ).resolves.toMatchObject({
      apiKey: "endpoint-bound-key"
    });
  });

  it("requires an explicit main-process approval for custom Language Server launches", async () => {
    const filePath = await createSettingsPath();
    const service = new AppSettingsService(
      filePath,
      new MemorySecretVault()
    );
    const patch: UpdateAppSettingsRequest = {
      codeAnalysis: {
        typescript: {
          enabled: true,
          command: "custom-language-server",
          args: ["--stdio", "--custom"]
        }
      }
    };

    await expect(
      service.languageServerLaunchesRequiringApproval(patch)
    ).resolves.toEqual([
      {
        language: "typescript",
        command: "custom-language-server",
        args: ["--stdio", "--custom"]
      }
    ]);

    const unapproved = await service.update(patch);
    await expect(
      service.assertLanguageServerLaunchesApproved(
        unapproved.codeAnalysis
      )
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });

    const approved = await service.update(patch, {
      approvedLanguageServerLaunches: [
        {
          language: "typescript",
          command: "custom-language-server",
          args: ["--stdio", "--custom"]
        }
      ]
    });
    await expect(
      service.assertLanguageServerLaunchesApproved(
        approved.codeAnalysis
      )
    ).resolves.toBeUndefined();

    const restarted = new AppSettingsService(
      filePath,
      new MemorySecretVault()
    );
    const restored = (await restarted.get()).settings;
    await expect(
      restarted.assertLanguageServerLaunchesApproved(
        restored.codeAnalysis
      )
    ).resolves.toBeUndefined();

    await expect(
      restarted.languageServerLaunchesRequiringApproval({
        codeAnalysis: {
          typescript: {
            maxDocuments: 400,
            maxReferenceRequests: 800
          }
        }
      })
    ).resolves.toEqual([]);
    const budgetChanged = await restarted.update({
      codeAnalysis: {
        typescript: {
          maxDocuments: 400,
          maxReferenceRequests: 800
        }
      }
    });
    await expect(
      restarted.assertLanguageServerLaunchesApproved(
        budgetChanged.codeAnalysis
      )
    ).resolves.toBeUndefined();

    const changed = await restarted.update({
      codeAnalysis: {
        typescript: {
          args: ["--stdio", "--changed"]
        }
      }
    });
    await expect(
      restarted.assertLanguageServerLaunchesApproved(
        changed.codeAnalysis
      )
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
  });

  it("rejects a stale Language Server approval when the command changes before persistence", async () => {
    const filePath = await createSettingsPath();
    const service = new AppSettingsService(
      filePath,
      new MemorySecretVault()
    );
    const approvalPatch: UpdateAppSettingsRequest = {
      codeAnalysis: {
        typescript: {
          enabled: true,
          command: "reviewed-language-server",
          args: ["--stdio"]
        }
      }
    };
    const approvals =
      await service.languageServerLaunchesRequiringApproval(
        approvalPatch
      );

    await service.update({
      codeAnalysis: {
        typescript: {
          command: "changed-language-server",
          args: ["--stdio", "--changed"]
        }
      }
    });

    await expect(
      service.update(
        {
          codeAnalysis: {
            typescript: {
              enabled: true
            }
          }
        },
        {
          approvedLanguageServerLaunches: approvals
        }
      )
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining("发生了变化")
    });
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

    await expect(service.readAiApiKey(true)).rejects.toMatchObject({
      code: "MISSING_SECRET"
    });
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

  it("backfills analysis budgets and optional language-server settings for existing documents", async () => {
    const filePath = await createSettingsPath();
    const defaults = createDefaultAppSettings();
    const legacyCodeAnalysis = structuredClone(
      defaults.codeAnalysis
    ) as unknown as Record<string, unknown>;
    for (const language of [
      "vue",
      "python",
      "go",
      "kotlin",
      "csharp",
      "rust"
    ]) {
      delete legacyCodeAnalysis[language];
    }
    delete legacyCodeAnalysis.maxGraphNodes;
    delete legacyCodeAnalysis.maxTotalSourceMb;
    delete legacyCodeAnalysis.maxGraphEdges;
    delete legacyCodeAnalysis.maxRequestChains;
    delete legacyCodeAnalysis.maxDiagnostics;
    for (const language of ["typescript", "java"]) {
      const server = legacyCodeAnalysis[language] as Record<
        string,
        unknown
      >;
      delete server.maxDocuments;
      delete server.maxSymbolsPerDocument;
      delete server.maxCallHierarchyRequests;
      delete server.maxTypeHierarchyRequests;
      delete server.maxReferenceRequests;
      delete server.maxDocumentationRequests;
      delete server.maxReferencesPerSymbol;
    }
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
        general: defaults.general,
        appearance: defaults.appearance,
        diff: defaults.diff,
        git: defaults.git,
        ai: {
          enabled: defaults.ai.enabled,
          apiUrl: defaults.ai.apiUrl,
          model: defaults.ai.model,
          prompt: defaults.ai.prompt
        },
        codeAnalysis: legacyCodeAnalysis,
        navigation: defaults.navigation,
        updatedAt: "2026-09-19T00:00:00.000Z"
      }),
      "utf8"
    );
    const service = new AppSettingsService(
      filePath,
      new MemorySecretVault()
    );

    const loaded = await service.get();

    expect(loaded.settings.codeAnalysis.vue).toEqual(
      defaults.codeAnalysis.vue
    );
    expect(loaded.settings.codeAnalysis.python).toEqual(
      defaults.codeAnalysis.python
    );
    expect(loaded.settings.codeAnalysis.rust).toEqual(
      defaults.codeAnalysis.rust
    );
    expect(loaded.settings.codeAnalysis.maxGraphNodes).toBe(
      50_000
    );
    expect(loaded.settings.codeAnalysis.maxGraphEdges).toBe(
      defaults.codeAnalysis.maxGraphEdges
    );
    expect(loaded.settings.codeAnalysis.maxTotalSourceMb).toBe(
      defaults.codeAnalysis.maxTotalSourceMb
    );
    expect(loaded.settings.codeAnalysis.java).toEqual(
      defaults.codeAnalysis.java
    );
    expect(
      (
        JSON.parse(await readFile(filePath, "utf8")) as {
          codeAnalysis: { maxGraphNodes: number };
        }
      ).codeAnalysis.maxGraphNodes
    ).toBe(50_000);

    const updated = await service.update({
      codeAnalysis: {
        go: {
          enabled: true,
          command: "custom-gopls",
          args: ["serve"]
        }
      }
    });
    expect(updated.codeAnalysis.go).toMatchObject({
      enabled: true,
      command: "custom-gopls",
      args: ["serve"]
    });
  });

  it("backfills and rewrites periodic refresh and MCP stale-age settings in schema v3 documents", async () => {
    const filePath = await createSettingsPath();
    const defaults = createDefaultAppSettings();
    const legacyCodeAnalysis = structuredClone(
      defaults.codeAnalysis
    ) as unknown as {
      autoRefresh: {
        enabled: boolean;
        debounceMs: number;
        periodicEnabled?: boolean;
        periodicIntervalMinutes?: number;
      };
      mcp: {
        enabled: boolean;
        allowSourceSnippets: boolean;
        maxResponseKb: number;
        maxStaleAgeDays?: number;
      };
    } & Record<string, unknown>;
    legacyCodeAnalysis.autoRefresh.enabled = false;
    legacyCodeAnalysis.autoRefresh.debounceMs = 2_000;
    delete legacyCodeAnalysis.autoRefresh.periodicEnabled;
    delete legacyCodeAnalysis.autoRefresh
      .periodicIntervalMinutes;
    legacyCodeAnalysis.mcp.enabled = false;
    legacyCodeAnalysis.mcp.allowSourceSnippets = false;
    legacyCodeAnalysis.mcp.maxResponseKb = 512;
    delete legacyCodeAnalysis.mcp.maxStaleAgeDays;

    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
        general: defaults.general,
        appearance: defaults.appearance,
        diff: defaults.diff,
        git: defaults.git,
        ai: {
          enabled: defaults.ai.enabled,
          apiUrl: defaults.ai.apiUrl,
          model: defaults.ai.model,
          prompt: defaults.ai.prompt
        },
        codeAnalysis: legacyCodeAnalysis,
        navigation: defaults.navigation,
        updatedAt: "2026-09-23T00:00:00.000Z"
      }),
      "utf8"
    );

    const service = new AppSettingsService(
      filePath,
      new MemorySecretVault()
    );
    const loaded = await service.get();

    expect(loaded.settings.codeAnalysis.autoRefresh).toEqual({
      enabled: false,
      debounceMs: 2_000,
      periodicEnabled: true,
      periodicIntervalMinutes:
        DEFAULT_CODE_ANALYSIS_PERIODIC_REFRESH_MINUTES
    });
    expect(loaded.settings.codeAnalysis.mcp).toEqual({
      enabled: false,
      allowSourceSnippets: false,
      maxResponseKb: 512,
      maxStaleAgeDays: DEFAULT_MCP_MAX_STALE_AGE_DAYS
    });

    const persisted = JSON.parse(
      await readFile(filePath, "utf8")
    ) as {
      schemaVersion: number;
      codeAnalysis: {
        autoRefresh: {
          periodicEnabled: boolean;
          periodicIntervalMinutes: number;
        };
        mcp: {
          maxStaleAgeDays: number;
        };
      };
    };
    expect(persisted.schemaVersion).toBe(3);
    expect(persisted.codeAnalysis.autoRefresh).toMatchObject({
      periodicEnabled: true,
      periodicIntervalMinutes:
        DEFAULT_CODE_ANALYSIS_PERIODIC_REFRESH_MINUTES
    });
    expect(
      persisted.codeAnalysis.mcp.maxStaleAgeDays
    ).toBe(DEFAULT_MCP_MAX_STALE_AGE_DAYS);
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
