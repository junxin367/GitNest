import {
  DEFAULT_DIFF_COMMIT_PANEL_HEIGHT,
  MAX_DIFF_COMMIT_PANEL_HEIGHT,
  MIN_DIFF_COMMIT_PANEL_HEIGHT,
  createDefaultAppSettings,
  type CodeAnalysisSettingsDto,
  type AppSettingsDto,
  type AppSettingsLoadDto,
  type UpdateAppSettingsRequest
} from "@gitnest/contracts";
import { AtomicJsonStore } from "@gitnest/persistence-json";
import { WorkspaceError } from "@gitnest/workspace-core";
import { randomUUID } from "node:crypto";

export const APP_SETTINGS_SCHEMA_VERSION = 3;
const MAX_AI_API_URL_LENGTH = 2_048;
const MAX_AI_MODEL_LENGTH = 256;
const MAX_AI_API_KEY_LENGTH = 8_192;
const MAX_AI_PROMPT_LENGTH = 12_000;
const MAX_APP_SETTINGS_DOCUMENT_BYTES = 2 * 1_024 * 1_024;
const AI_API_KEY_CREDENTIAL_PREFIX = "settings_ai_api_key_";
const LEGACY_AI_API_KEY_CREDENTIAL_REF =
  "settings_ai_api_key_legacy";
type AppSettingsDiffDocument = Omit<
  AppSettingsDto["diff"],
  "commitPanelHeight"
> & {
  commitPanelHeight?: number;
};

export interface InternalAiSettings {
  enabled: boolean;
  apiUrl: string;
  model: string;
  apiKey: string;
  prompt: string;
}

export interface SettingsSecretVault {
  save(credentialRef: string, secret: string): Promise<void>;
  read(credentialRef: string): Promise<string>;
  delete(credentialRef: string): Promise<void>;
}

interface StoredAiSettings {
  enabled: boolean;
  apiUrl: string;
  model: string;
  apiKeyCredentialRef?: string;
  prompt: string;
}

interface LegacyAiSettings {
  enabled: boolean;
  apiUrl: string;
  model: string;
  apiKey: string;
  prompt: string;
}

interface AppSettingsDocument {
  schemaVersion: typeof APP_SETTINGS_SCHEMA_VERSION;
  general: AppSettingsDto["general"];
  appearance: AppSettingsDto["appearance"];
  diff: AppSettingsDiffDocument;
  git: AppSettingsDto["git"];
  ai: StoredAiSettings;
  codeAnalysis: CodeAnalysisSettingsDto;
  navigation: AppSettingsDto["navigation"];
  updatedAt: string;
}

interface AppSettingsDocumentV3Input
  extends Omit<AppSettingsDocument, "ai"> {
  ai: StoredAiSettings & {
    apiKey?: string;
  };
}

interface AppSettingsDocumentV2 {
  schemaVersion: 2;
  general: AppSettingsDto["general"];
  appearance: AppSettingsDto["appearance"];
  diff: AppSettingsDiffDocument;
  git: AppSettingsDto["git"];
  ai: LegacyAiSettings;
  codeAnalysis: CodeAnalysisSettingsDto;
  navigation: AppSettingsDto["navigation"];
  updatedAt: string;
}

interface AppSettingsDocumentV1 {
  schemaVersion: 1;
  general: AppSettingsDto["general"];
  appearance: AppSettingsDto["appearance"];
  diff: AppSettingsDiffDocument;
  git: AppSettingsDto["git"];
  ai: LegacyAiSettings;
  navigation: AppSettingsDto["navigation"];
  updatedAt: string;
}

export class AppSettingsService {
  readonly #store: AtomicJsonStore;
  readonly #secretVault: SettingsSecretVault;
  readonly #clock: () => string;
  readonly #credentialRefFactory: () => string;
  #loadPromise: Promise<AppSettingsDocument> | undefined;
  #storageState: AppSettingsLoadDto["storageState"] = "missing";
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(
    filePath: string,
    secretVault: SettingsSecretVault,
    options: {
      clock?: () => string;
      credentialRefFactory?: () => string;
    } = {}
  ) {
    this.#store = new AtomicJsonStore(filePath, {
      maxBytes: MAX_APP_SETTINGS_DOCUMENT_BYTES
    });
    this.#secretVault = secretVault;
    this.#clock =
      options.clock ?? (() => new Date().toISOString());
    this.#credentialRefFactory =
      options.credentialRefFactory ??
      (() => `${AI_API_KEY_CREDENTIAL_PREFIX}${randomUUID()}`);
  }

  async get(): Promise<AppSettingsLoadDto> {
    const document = await this.#load();
    return {
      settings: toPublicSettings(document),
      storageState: this.#storageState
    };
  }

  update(
    patch: UpdateAppSettingsRequest
  ): Promise<AppSettingsDto> {
    return this.#enqueue(async () => {
      const current = await this.#load();
      const next = mergeSettings(current, patch, this.#clock());
      const apiKey = requestedApiKey(patch);
      let newCredentialRef: string | undefined;

      if (apiKey !== undefined) {
        newCredentialRef = this.#credentialRefFactory();
        assertCredentialRef(newCredentialRef);
        if (
          newCredentialRef ===
          current.ai.apiKeyCredentialRef
        ) {
          throw new WorkspaceError(
            "INVALID_REQUEST",
            "The AI credential reference must be unique."
          );
        }
        await this.#secretVault.save(newCredentialRef, apiKey);
        next.ai = {
          ...next.ai,
          apiKeyCredentialRef: newCredentialRef
        };
      }

      try {
        await this.#store.write(next);
      } catch (error) {
        if (newCredentialRef) {
          await this.#secretVault
            .delete(newCredentialRef)
            .catch(() => undefined);
        }
        throw error;
      }

      const oldCredentialRef =
        current.ai.apiKeyCredentialRef;
      if (
        newCredentialRef &&
        oldCredentialRef &&
        oldCredentialRef !== newCredentialRef
      ) {
        await this.#secretVault
          .delete(oldCredentialRef)
          .catch(() => undefined);
      }
      this.#loadPromise = Promise.resolve(next);
      this.#storageState = "persisted";
      return toPublicSettings(next);
    });
  }

  async clearAiApiKey(
    confirmed: boolean
  ): Promise<AppSettingsDto> {
    if (!confirmed) {
      throw new WorkspaceError(
        "INVALID_REQUEST",
        "Clearing the AI API Key requires explicit confirmation."
      );
    }
    return this.#enqueue(async () => {
      const current = await this.#load();
      const credentialRef =
        current.ai.apiKeyCredentialRef;
      const next: AppSettingsDocument = {
        ...current,
        ai: withoutAiCredential(current.ai),
        updatedAt: this.#clock()
      };
      await this.#store.write(next);
      this.#loadPromise = Promise.resolve(next);
      this.#storageState = "persisted";
      if (credentialRef) {
        await this.#secretVault
          .delete(credentialRef)
          .catch(() => undefined);
      }
      return toPublicSettings(next);
    });
  }

  async getInternalAiSettings(
    options: { includeApiKey?: boolean } = {}
  ): Promise<InternalAiSettings> {
    const document = await this.#load();
    const { apiKeyCredentialRef, ...settings } = document.ai;
    return {
      ...settings,
      apiKey:
        options.includeApiKey !== false &&
        apiKeyCredentialRef
        ? await this.#secretVault.read(apiKeyCredentialRef)
        : ""
    };
  }

  async #load(): Promise<AppSettingsDocument> {
    if (!this.#loadPromise) {
      this.#loadPromise = this.#readDocument();
    }
    const loadPromise = this.#loadPromise;
    try {
      return await loadPromise;
    } catch (error) {
      if (this.#loadPromise === loadPromise) {
        this.#loadPromise = undefined;
      }
      throw error;
    }
  }

  async #readDocument(): Promise<AppSettingsDocument> {
    const value = await this.#store.read();
    if (value === null) {
      this.#storageState = "missing";
      return createDefaultDocument(this.#clock());
    }
    if (isAppSettingsDocumentV1(value)) {
      return this.#migrateLegacyDocument(
        migrateV1Document(value)
      );
    }
    if (isAppSettingsDocumentV2(value)) {
      return this.#migrateLegacyDocument(value);
    }
    if (!isAppSettingsDocument(value)) {
      this.#store.blockWrites(
        "Application settings schema validation failed."
      );
      throw new WorkspaceError(
        "INVALID_PERSISTED_DATA",
        "The persisted application settings are invalid."
      );
    }
    const normalized =
      await this.#normalizeCurrentDocument(value);
    this.#storageState = "persisted";
    return normalized;
  }

  async #normalizeCurrentDocument(
    document: AppSettingsDocumentV3Input
  ): Promise<AppSettingsDocument> {
    let credentialRef = document.ai.apiKeyCredentialRef;
    if (!credentialRef && document.ai.apiKey) {
      credentialRef = LEGACY_AI_API_KEY_CREDENTIAL_REF;
      assertCredentialRef(credentialRef);
      await this.#secretVault.save(
        credentialRef,
        document.ai.apiKey
      );
    }
    const normalized = cloneDocument(
      document,
      credentialRef
    );
    if (!documentsMatch(document, normalized)) {
      await this.#store.write(normalized);
    }
    return normalized;
  }

  async #migrateLegacyDocument(
    document: AppSettingsDocumentV2
  ): Promise<AppSettingsDocument> {
    const apiKey = document.ai.apiKey;
    let credentialRef: string | undefined;
    if (apiKey) {
      credentialRef = LEGACY_AI_API_KEY_CREDENTIAL_REF;
      assertCredentialRef(credentialRef);
      await this.#secretVault.save(credentialRef, apiKey);
    }
    const migrated = migrateV2Document(
      document,
      credentialRef
    );
    await this.#store.write(migrated);
    this.#storageState = "persisted";
    return migrated;
  }

  #enqueue<Value>(action: () => Promise<Value>): Promise<Value> {
    const result = this.#writeQueue.then(action, action);
    this.#writeQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

function createDefaultDocument(now: string): AppSettingsDocument {
  const defaults = createDefaultAppSettings();
  return {
    schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
    general: { ...defaults.general },
    appearance: { ...defaults.appearance },
    diff: { ...defaults.diff },
    git: { ...defaults.git },
    ai: {
      enabled: defaults.ai.enabled,
      apiUrl: defaults.ai.apiUrl,
      model: defaults.ai.model,
      prompt: defaults.ai.prompt
    },
    codeAnalysis: cloneCodeAnalysisSettings(
      defaults.codeAnalysis
    ),
    navigation: { ...defaults.navigation },
    updatedAt: now
  };
}

function mergeSettings(
  current: AppSettingsDocument,
  patch: UpdateAppSettingsRequest,
  updatedAt: string
): AppSettingsDocument {
  const diff = {
    ...current.diff,
    ...patch.diff
  };
  return {
    ...current,
    general: {
      ...current.general,
      ...patch.general
    },
    appearance: {
      ...current.appearance,
      ...patch.appearance
    },
    diff: {
      ...diff,
      commitPanelHeight: normalizeDiffCommitPanelHeight(
        diff.commitPanelHeight
      )
    },
    git: {
      ...current.git,
      ...patch.git
    },
    ai: mergeStoredAiSettings(current.ai, patch.ai),
    codeAnalysis: mergeCodeAnalysisSettings(
      current.codeAnalysis,
      patch.codeAnalysis
    ),
    navigation: {
      ...current.navigation,
      ...patch.navigation
    },
    updatedAt
  };
}

function mergeStoredAiSettings(
  current: StoredAiSettings,
  patch: UpdateAppSettingsRequest["ai"]
): StoredAiSettings {
  if (!patch) {
    return { ...current };
  }
  const {
    apiKey: _apiKey,
    ...persistedPatch
  } = patch;
  return {
    ...current,
    ...persistedPatch
  };
}

function requestedApiKey(
  patch: UpdateAppSettingsRequest
): string | undefined {
  if (!patch.ai || !("apiKey" in patch.ai)) {
    return undefined;
  }
  const apiKey = patch.ai.apiKey?.trim() ?? "";
  if (!apiKey || apiKey.length > MAX_AI_API_KEY_LENGTH) {
    throw new WorkspaceError(
      "INVALID_REQUEST",
      "The AI API Key exceeds the supported bounds."
    );
  }
  return apiKey;
}

function withoutAiCredential(
  settings: StoredAiSettings
): StoredAiSettings {
  const {
    apiKeyCredentialRef: _credentialRef,
    ...remaining
  } = settings;
  return remaining;
}

function toPublicSettings(
  document: AppSettingsDocument
): AppSettingsDto {
  return {
    general: { ...document.general },
    appearance: { ...document.appearance },
    diff: {
      ...document.diff,
      commitPanelHeight: normalizeDiffCommitPanelHeight(
        document.diff.commitPanelHeight
      )
    },
    git: { ...document.git },
    ai: {
      enabled: document.ai.enabled,
      apiUrl: document.ai.apiUrl,
      model: document.ai.model,
      prompt: document.ai.prompt,
      apiKeyConfigured: Boolean(
        document.ai.apiKeyCredentialRef
      )
    },
    codeAnalysis: cloneCodeAnalysisSettings(
      document.codeAnalysis
    ),
    navigation: { ...document.navigation }
  };
}

function cloneDocument(
  document: AppSettingsDocumentV3Input,
  credentialRef = document.ai.apiKeyCredentialRef
): AppSettingsDocument {
  return {
    schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
    general: {
      restoreLastView: document.general.restoreLastView,
      defaultTerminalKind:
        document.general.defaultTerminalKind
    },
    appearance: {
      theme: document.appearance.theme
    },
    diff: {
      fileView: document.diff.fileView,
      layout: document.diff.layout,
      wrap: document.diff.wrap,
      treeDirectoriesCollapsed:
        document.diff.treeDirectoriesCollapsed,
      commitPanelHeight: normalizeDiffCommitPanelHeight(
        document.diff.commitPanelHeight
      )
    },
    git: {
      fetchMode: document.git.fetchMode,
      pushStrategy: document.git.pushStrategy ?? "rebase"
    },
    ai: {
      enabled: document.ai.enabled,
      apiUrl: document.ai.apiUrl,
      model: document.ai.model,
      ...(credentialRef
        ? { apiKeyCredentialRef: credentialRef }
        : {}),
      prompt: document.ai.prompt
    },
    codeAnalysis: cloneCodeAnalysisSettings(
      document.codeAnalysis
    ),
    navigation: {
      lastContentView: document.navigation.lastContentView,
      workspaceTab: document.navigation.workspaceTab,
      repositoryTab: document.navigation.repositoryTab
    },
    updatedAt: document.updatedAt
  };
}

function isAppSettingsDocument(
  value: unknown
): value is AppSettingsDocumentV3Input {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schemaVersion === APP_SETTINGS_SCHEMA_VERSION &&
    isGeneralSettings(value.general) &&
    isAppearanceSettings(value.appearance) &&
    isDiffSettings(value.diff) &&
    isGitSettings(value.git) &&
    isAiSettings(value.ai) &&
    isCodeAnalysisSettings(value.codeAnalysis) &&
    isNavigationSettings(value.navigation) &&
    typeof value.updatedAt === "string"
  );
}

function isAppSettingsDocumentV1(
  value: unknown
): value is AppSettingsDocumentV1 {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schemaVersion === 1 &&
    isGeneralSettings(value.general) &&
    isAppearanceSettings(value.appearance) &&
    isDiffSettings(value.diff) &&
    isGitSettings(value.git) &&
    isLegacyAiSettings(value.ai) &&
    isNavigationSettings(value.navigation) &&
    typeof value.updatedAt === "string"
  );
}

function isAppSettingsDocumentV2(
  value: unknown
): value is AppSettingsDocumentV2 {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schemaVersion === 2 &&
    isGeneralSettings(value.general) &&
    isAppearanceSettings(value.appearance) &&
    isDiffSettings(value.diff) &&
    isGitSettings(value.git) &&
    isLegacyAiSettings(value.ai) &&
    isCodeAnalysisSettings(value.codeAnalysis) &&
    isNavigationSettings(value.navigation) &&
    typeof value.updatedAt === "string"
  );
}

function isGeneralSettings(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.restoreLastView === "boolean" &&
    (value.defaultTerminalKind === null ||
      isExternalTerminalKind(value.defaultTerminalKind))
  );
}

function isAppearanceSettings(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.theme === "dark" || value.theme === "light")
  );
}

function isDiffSettings(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.fileView === "list" || value.fileView === "tree") &&
    (value.layout === "split" || value.layout === "unified") &&
    typeof value.wrap === "boolean" &&
    typeof value.treeDirectoriesCollapsed === "boolean" &&
    (value.commitPanelHeight === undefined ||
      isValidDiffCommitPanelHeight(value.commitPanelHeight))
  );
}

function isValidDiffCommitPanelHeight(
  value: unknown
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_DIFF_COMMIT_PANEL_HEIGHT &&
    value <= MAX_DIFF_COMMIT_PANEL_HEIGHT
  );
}

function normalizeDiffCommitPanelHeight(
  value: unknown
): number {
  return isValidDiffCommitPanelHeight(value)
    ? value
    : DEFAULT_DIFF_COMMIT_PANEL_HEIGHT;
}

function isGitSettings(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.fetchMode === "manual" ||
      value.fetchMode === "startup") &&
    (value.pushStrategy === undefined ||
      value.pushStrategy === "rebase" ||
      value.pushStrategy === "merge")
  );
}

function isAiSettings(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.enabled === "boolean" &&
    isBoundedStoredString(
      value.apiUrl,
      MAX_AI_API_URL_LENGTH
    ) &&
    isBoundedStoredString(value.model, MAX_AI_MODEL_LENGTH) &&
    (value.apiKeyCredentialRef === undefined ||
      isCredentialRef(value.apiKeyCredentialRef)) &&
    (value.apiKey === undefined ||
      isBoundedStoredString(
        value.apiKey,
        MAX_AI_API_KEY_LENGTH
      )) &&
    isBoundedStoredString(
      value.prompt,
      MAX_AI_PROMPT_LENGTH
    )
  );
}

function isLegacyAiSettings(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.enabled === "boolean" &&
    isBoundedStoredString(
      value.apiUrl,
      MAX_AI_API_URL_LENGTH
    ) &&
    isBoundedStoredString(value.model, MAX_AI_MODEL_LENGTH) &&
    isBoundedStoredString(
      value.apiKey,
      MAX_AI_API_KEY_LENGTH
    ) &&
    isBoundedStoredString(
      value.prompt,
      MAX_AI_PROMPT_LENGTH
    )
  );
}

function isCredentialRef(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(AI_API_KEY_CREDENTIAL_PREFIX) &&
    value.length > 0 &&
    value.length <= 512 &&
    /^[a-zA-Z0-9_-]+$/.test(value)
  );
}

function assertCredentialRef(value: string): void {
  if (!isCredentialRef(value)) {
    throw new WorkspaceError(
      "INVALID_REQUEST",
      "The AI credential reference is invalid."
    );
  }
}

function isCodeAnalysisSettings(
  value: unknown
): value is CodeAnalysisSettingsDto {
  return (
    isRecord(value) &&
    typeof value.enabled === "boolean" &&
    (value.defaultScope === "changed" ||
      value.defaultScope === "workspace") &&
    typeof value.staticFallback === "boolean" &&
    isIntegerInRange(value.maxFiles, 100, 50_000) &&
    isIntegerInRange(value.maxFileSizeKb, 64, 4_096) &&
    isIntegerInRange(value.readConcurrency, 1, 4) &&
    isIntegerInRange(value.graphDepth, 1, 12) &&
    isIntegerInRange(value.lspTimeoutMs, 1_000, 60_000) &&
    isStoredStringArray(
      value.ignoreDirectories,
      100,
      255
    ) &&
    isLanguageServerSettings(value.typescript) &&
    isLanguageServerSettings(value.java)
  );
}

function isLanguageServerSettings(
  value: unknown
): boolean {
  return (
    isRecord(value) &&
    typeof value.enabled === "boolean" &&
    isBoundedStoredString(value.command, 2_048) &&
    Boolean(value.command.trim()) &&
    isStoredStringArray(value.args, 64, 2_048)
  );
}

function isNavigationSettings(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.lastContentView === "workspace" ||
      value.lastContentView === "repository") &&
    isWorkspaceTab(value.workspaceTab) &&
    isRepositoryTab(value.repositoryTab)
  );
}

function isExternalTerminalKind(
  value: unknown
): boolean {
  return (
    value === "windows-terminal" ||
    value === "powershell" ||
    value === "cmd" ||
    value === "git-bash"
  );
}

function isWorkspaceTab(value: unknown): boolean {
  return (
    value === "overview" ||
    value === "repositories" ||
    value === "activity" ||
    value === "worktrees"
  );
}

function isRepositoryTab(value: unknown): boolean {
  return (
    value === "overview" ||
    value === "changes" ||
    value === "history" ||
    value === "branches" ||
    value === "worktrees"
  );
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return Boolean(
    value && typeof value === "object" && !Array.isArray(value)
  );
}

function isBoundedStoredString(
  value: unknown,
  maximumLength: number
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximumLength &&
    !value.includes("\0")
  );
}

function isIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isStoredStringArray(
  value: unknown,
  maximumItems: number,
  maximumItemLength: number
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximumItems &&
    value.every(
      (item) =>
        isBoundedStoredString(item, maximumItemLength) &&
        Boolean(item.trim())
    )
  );
}

function cloneCodeAnalysisSettings(
  settings: CodeAnalysisSettingsDto
): CodeAnalysisSettingsDto {
  return {
    enabled: settings.enabled,
    defaultScope: settings.defaultScope,
    staticFallback: settings.staticFallback,
    maxFiles: settings.maxFiles,
    maxFileSizeKb: settings.maxFileSizeKb,
    readConcurrency: settings.readConcurrency,
    graphDepth: settings.graphDepth,
    lspTimeoutMs: settings.lspTimeoutMs,
    ignoreDirectories: [...settings.ignoreDirectories],
    typescript: {
      enabled: settings.typescript.enabled,
      command: settings.typescript.command,
      args: [...settings.typescript.args]
    },
    java: {
      enabled: settings.java.enabled,
      command: settings.java.command,
      args: [...settings.java.args]
    }
  };
}

function mergeCodeAnalysisSettings(
  current: CodeAnalysisSettingsDto,
  patch: UpdateAppSettingsRequest["codeAnalysis"]
): CodeAnalysisSettingsDto {
  if (!patch) {
    return cloneCodeAnalysisSettings(current);
  }
  return {
    ...current,
    ...patch,
    ignoreDirectories:
      patch.ignoreDirectories === undefined
        ? [...current.ignoreDirectories]
        : [...patch.ignoreDirectories],
    typescript: {
      ...current.typescript,
      ...patch.typescript,
      args:
        patch.typescript?.args === undefined
          ? [...current.typescript.args]
          : [...patch.typescript.args]
    },
    java: {
      ...current.java,
      ...patch.java,
      args:
        patch.java?.args === undefined
          ? [...current.java.args]
          : [...patch.java.args]
    }
  };
}

function migrateV1Document(
  document: AppSettingsDocumentV1
): AppSettingsDocumentV2 {
  const defaults = createDefaultAppSettings();
  return {
    schemaVersion: 2,
    general: { ...document.general },
    appearance: { ...document.appearance },
    diff: {
      ...document.diff,
      commitPanelHeight: normalizeDiffCommitPanelHeight(
        document.diff.commitPanelHeight
      )
    },
    git: {
      ...document.git,
      pushStrategy: document.git.pushStrategy ?? "rebase"
    },
    ai: { ...document.ai },
    codeAnalysis: cloneCodeAnalysisSettings(
      defaults.codeAnalysis
    ),
    navigation: { ...document.navigation },
    updatedAt: document.updatedAt
  };
}

function migrateV2Document(
  document: AppSettingsDocumentV2,
  credentialRef?: string
): AppSettingsDocument {
  const {
    apiKey: _apiKey,
    ...storedAiSettings
  } = document.ai;
  return {
    schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
    general: {
      restoreLastView: document.general.restoreLastView,
      defaultTerminalKind:
        document.general.defaultTerminalKind
    },
    appearance: {
      theme: document.appearance.theme
    },
    diff: {
      fileView: document.diff.fileView,
      layout: document.diff.layout,
      wrap: document.diff.wrap,
      treeDirectoriesCollapsed:
        document.diff.treeDirectoriesCollapsed,
      commitPanelHeight: normalizeDiffCommitPanelHeight(
        document.diff.commitPanelHeight
      )
    },
    git: {
      fetchMode: document.git.fetchMode,
      pushStrategy: document.git.pushStrategy ?? "rebase"
    },
    ai: {
      enabled: storedAiSettings.enabled,
      apiUrl: storedAiSettings.apiUrl,
      model: storedAiSettings.model,
      ...(credentialRef
        ? { apiKeyCredentialRef: credentialRef }
        : {}),
      prompt: storedAiSettings.prompt
    },
    codeAnalysis: cloneCodeAnalysisSettings(
      document.codeAnalysis
    ),
    navigation: {
      lastContentView: document.navigation.lastContentView,
      workspaceTab: document.navigation.workspaceTab,
      repositoryTab: document.navigation.repositoryTab
    },
    updatedAt: document.updatedAt
  };
}

function documentsMatch(
  value: unknown,
  normalized: AppSettingsDocument
): boolean {
  return JSON.stringify(value) === JSON.stringify(normalized);
}
