import {
  DEFAULT_DIFF_COMMIT_PANEL_HEIGHT,
  MAX_CODE_ANALYSIS_DIAGNOSTICS,
  MAX_CODE_ANALYSIS_GRAPH_EDGES,
  MAX_CODE_ANALYSIS_GRAPH_NODES,
  MAX_CODE_ANALYSIS_REQUEST_CHAINS,
  MAX_CODE_ANALYSIS_TOTAL_SOURCE_MB,
  MAX_LSP_DOCUMENTS,
  MAX_LSP_REFERENCES_PER_SYMBOL,
  MAX_LSP_REQUESTS,
  MAX_LSP_SYMBOLS_PER_DOCUMENT,
  MAX_DIFF_COMMIT_PANEL_HEIGHT,
  MIN_CODE_ANALYSIS_DIAGNOSTICS,
  MIN_CODE_ANALYSIS_GRAPH_EDGES,
  MIN_CODE_ANALYSIS_GRAPH_NODES,
  MIN_CODE_ANALYSIS_REQUEST_CHAINS,
  MIN_CODE_ANALYSIS_TOTAL_SOURCE_MB,
  MIN_LSP_DOCUMENTS,
  MIN_LSP_REFERENCES_PER_SYMBOL,
  MIN_LSP_REQUESTS,
  MIN_LSP_SYMBOLS_PER_DOCUMENT,
  MIN_DIFF_COMMIT_PANEL_HEIGHT,
  LANGUAGE_SERVER_LANGUAGES,
  createDefaultAppSettings,
  createDefaultCodeAnalysisSettings,
  type CodeAnalysisSettingsDto,
  type AppSettingsDto,
  type AppSettingsLoadDto,
  type LanguageServerCommandSettingsDto,
  type LanguageServerLanguageDto,
  type UpdateAppSettingsRequest
} from "@gitnest/contracts";
import { AtomicJsonStore } from "@gitnest/persistence-json";
import { WorkspaceError } from "@gitnest/workspace-core";
import { createHash, randomUUID } from "node:crypto";

import { aiEndpointsMatch } from "../ai/ai-endpoint";

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
  languageServerLaunchApprovals: LanguageServerLaunchApprovals;
  navigation: AppSettingsDto["navigation"];
  updatedAt: string;
}

interface AppSettingsDocumentV3Input
  extends Omit<
    AppSettingsDocument,
    "ai" | "codeAnalysis" | "languageServerLaunchApprovals"
  > {
  ai: StoredAiSettings & {
    apiKey?: string;
  };
  codeAnalysis: StoredCodeAnalysisSettings;
  languageServerLaunchApprovals?: LanguageServerLaunchApprovals;
}

type StoredLanguageServerSettings = Omit<
  LanguageServerCommandSettingsDto,
  | "maxDocuments"
  | "maxSymbolsPerDocument"
  | "maxCallHierarchyRequests"
  | "maxTypeHierarchyRequests"
  | "maxReferenceRequests"
  | "maxDocumentationRequests"
  | "maxReferencesPerSymbol"
> &
  Partial<
    Pick<
      LanguageServerCommandSettingsDto,
      | "maxDocuments"
      | "maxSymbolsPerDocument"
      | "maxCallHierarchyRequests"
      | "maxTypeHierarchyRequests"
      | "maxReferenceRequests"
      | "maxDocumentationRequests"
      | "maxReferencesPerSymbol"
    >
  >;

type StoredCodeAnalysisSettings = Omit<
  CodeAnalysisSettingsDto,
  | "maxTotalSourceMb"
  | "maxGraphNodes"
  | "maxGraphEdges"
  | "maxRequestChains"
  | "maxDiagnostics"
  | LanguageServerLanguageDto
> & {
  maxTotalSourceMb?: number;
  maxGraphNodes?: number;
  maxGraphEdges?: number;
  maxRequestChains?: number;
  maxDiagnostics?: number;
  typescript: StoredLanguageServerSettings;
  java: StoredLanguageServerSettings;
  vue?: StoredLanguageServerSettings;
  python?: StoredLanguageServerSettings;
  go?: StoredLanguageServerSettings;
  kotlin?: StoredLanguageServerSettings;
  csharp?: StoredLanguageServerSettings;
  rust?: StoredLanguageServerSettings;
};

type LanguageServerLaunchApprovals = Partial<
  Record<LanguageServerLanguageDto, string>
>;

type LanguageServerSettingsSource = Partial<
  Record<
    LanguageServerLanguageDto,
    LanguageServerCommandSettingsDto
  >
>;

export interface LanguageServerLaunchApprovalRequest {
  language: LanguageServerLanguageDto;
  command: string;
  args: string[];
}

export interface AppSettingsUpdateOptions {
  approvedLanguageServerLaunches?: readonly LanguageServerLaunchApprovalRequest[];
}

interface AppSettingsDocumentV2 {
  schemaVersion: 2;
  general: AppSettingsDto["general"];
  appearance: AppSettingsDto["appearance"];
  diff: AppSettingsDiffDocument;
  git: AppSettingsDto["git"];
  ai: LegacyAiSettings;
  codeAnalysis: StoredCodeAnalysisSettings;
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
    patch: UpdateAppSettingsRequest,
    options: AppSettingsUpdateOptions = {}
  ): Promise<AppSettingsDto> {
    return this.#enqueue(async () => {
      const current = await this.#load();
      const next = mergeSettings(current, patch, this.#clock());
      const approvedLanguageServerLaunches =
        options.approvedLanguageServerLaunches ?? [];
      assertApprovedLanguageServerLaunchesMatch(
        next.codeAnalysis,
        approvedLanguageServerLaunches
      );
      next.languageServerLaunchApprovals =
        updateLanguageServerLaunchApprovals(
          current,
          next,
          approvedLanguageServerLaunches
        );
      const apiKey = requestedApiKey(patch);
      const aiEndpointChanged =
        typeof patch.ai?.apiUrl === "string" &&
        !aiEndpointsMatch(
          patch.ai.apiUrl,
          current.ai.apiUrl
        );
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
      } else if (aiEndpointChanged) {
        next.ai = withoutAiCredential(next.ai);
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
        oldCredentialRef &&
        oldCredentialRef !== newCredentialRef &&
        (newCredentialRef !== undefined || aiEndpointChanged)
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

  async languageServerLaunchesRequiringApproval(
    patch: UpdateAppSettingsRequest
  ): Promise<LanguageServerLaunchApprovalRequest[]> {
    if (!patch.codeAnalysis) {
      return [];
    }
    const current = await this.#load();
    const next = mergeSettings(
      current,
      patch,
      current.updatedAt
    );
    return LANGUAGE_SERVER_LANGUAGES.flatMap((language) => {
      const launch = resolvedLanguageServerLaunch(
        next.codeAnalysis,
        language
      );
      if (
        !launch.enabled ||
        isDefaultLanguageServerLaunch(language, launch) ||
        current.languageServerLaunchApprovals[language] ===
          languageServerLaunchFingerprint(language, launch)
      ) {
        return [];
      }
      return [
        {
          language,
          command: launch.command,
          args: [...launch.args]
        }
      ];
    });
  }

  async assertLanguageServerLaunchesApproved(
    settings: LanguageServerSettingsSource
  ): Promise<void> {
    const document = await this.#load();
    for (const language of LANGUAGE_SERVER_LANGUAGES) {
      const launch = resolvedLanguageServerLaunch(
        settings,
        language
      );
      if (
        !launch.enabled ||
        isDefaultLanguageServerLaunch(language, launch) ||
        document.languageServerLaunchApprovals[language] ===
          languageServerLaunchFingerprint(language, launch)
      ) {
        continue;
      }
      throw new WorkspaceError(
        "INVALID_REQUEST",
        `${languageServerLabel(language)} Language Server 的自定义启动命令尚未获得本机确认。请在设置中重新保存并确认后再运行分析。`
      );
    }
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
    languageServerLaunchApprovals: {},
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
    languageServerLaunchApprovals:
      cloneLanguageServerLaunchApprovals(
        document.languageServerLaunchApprovals ?? {}
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
    (value.languageServerLaunchApprovals === undefined ||
      isLanguageServerLaunchApprovals(
        value.languageServerLaunchApprovals
      )) &&
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
): value is StoredCodeAnalysisSettings {
  return (
    isRecord(value) &&
    typeof value.enabled === "boolean" &&
    (value.defaultScope === "changed" ||
      value.defaultScope === "workspace") &&
    typeof value.staticFallback === "boolean" &&
    isIntegerInRange(value.maxFiles, 100, 50_000) &&
    (value.maxTotalSourceMb === undefined ||
      isIntegerInRange(
        value.maxTotalSourceMb,
        MIN_CODE_ANALYSIS_TOTAL_SOURCE_MB,
        MAX_CODE_ANALYSIS_TOTAL_SOURCE_MB
      )) &&
    (value.maxGraphNodes === undefined ||
      isIntegerInRange(
        value.maxGraphNodes,
        MIN_CODE_ANALYSIS_GRAPH_NODES,
        MAX_CODE_ANALYSIS_GRAPH_NODES
      )) &&
    (value.maxGraphEdges === undefined ||
      isIntegerInRange(
        value.maxGraphEdges,
        MIN_CODE_ANALYSIS_GRAPH_EDGES,
        MAX_CODE_ANALYSIS_GRAPH_EDGES
      )) &&
    (value.maxRequestChains === undefined ||
      isIntegerInRange(
        value.maxRequestChains,
        MIN_CODE_ANALYSIS_REQUEST_CHAINS,
        MAX_CODE_ANALYSIS_REQUEST_CHAINS
      )) &&
    (value.maxDiagnostics === undefined ||
      isIntegerInRange(
        value.maxDiagnostics,
        MIN_CODE_ANALYSIS_DIAGNOSTICS,
        MAX_CODE_ANALYSIS_DIAGNOSTICS
      )) &&
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
    isLanguageServerSettings(value.java) &&
    isOptionalLanguageServerSettings(value.vue) &&
    isOptionalLanguageServerSettings(value.python) &&
    isOptionalLanguageServerSettings(value.go) &&
    isOptionalLanguageServerSettings(value.kotlin) &&
    isOptionalLanguageServerSettings(value.csharp) &&
    isOptionalLanguageServerSettings(value.rust)
  );
}

function isOptionalLanguageServerSettings(
  value: unknown
): boolean {
  return (
    value === undefined ||
    isLanguageServerSettings(value)
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
    isStoredStringArray(value.args, 64, 2_048) &&
    isOptionalIntegerInRange(
      value.maxDocuments,
      MIN_LSP_DOCUMENTS,
      MAX_LSP_DOCUMENTS
    ) &&
    isOptionalIntegerInRange(
      value.maxSymbolsPerDocument,
      MIN_LSP_SYMBOLS_PER_DOCUMENT,
      MAX_LSP_SYMBOLS_PER_DOCUMENT
    ) &&
    isOptionalIntegerInRange(
      value.maxCallHierarchyRequests,
      MIN_LSP_REQUESTS,
      MAX_LSP_REQUESTS
    ) &&
    isOptionalIntegerInRange(
      value.maxTypeHierarchyRequests,
      MIN_LSP_REQUESTS,
      MAX_LSP_REQUESTS
    ) &&
    isOptionalIntegerInRange(
      value.maxReferenceRequests,
      MIN_LSP_REQUESTS,
      MAX_LSP_REQUESTS
    ) &&
    isOptionalIntegerInRange(
      value.maxDocumentationRequests,
      MIN_LSP_REQUESTS,
      MAX_LSP_REQUESTS
    ) &&
    isOptionalIntegerInRange(
      value.maxReferencesPerSymbol,
      MIN_LSP_REFERENCES_PER_SYMBOL,
      MAX_LSP_REFERENCES_PER_SYMBOL
    )
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

function isOptionalIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number
): boolean {
  return (
    value === undefined ||
    isIntegerInRange(value, minimum, maximum)
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
  settings: StoredCodeAnalysisSettings
): CodeAnalysisSettingsDto {
  const defaults = createDefaultCodeAnalysisSettings();
  return {
    enabled: settings.enabled,
    defaultScope: settings.defaultScope,
    staticFallback: settings.staticFallback,
    maxFiles: settings.maxFiles,
    maxTotalSourceMb:
      settings.maxTotalSourceMb ??
      defaults.maxTotalSourceMb,
    maxGraphNodes:
      settings.maxGraphNodes ?? defaults.maxGraphNodes,
    maxGraphEdges:
      settings.maxGraphEdges ?? defaults.maxGraphEdges,
    maxRequestChains:
      settings.maxRequestChains ??
      defaults.maxRequestChains,
    maxDiagnostics:
      settings.maxDiagnostics ?? defaults.maxDiagnostics,
    maxFileSizeKb: settings.maxFileSizeKb,
    readConcurrency: settings.readConcurrency,
    graphDepth: settings.graphDepth,
    lspTimeoutMs: settings.lspTimeoutMs,
    ignoreDirectories: [...settings.ignoreDirectories],
    typescript: cloneLanguageServerSettings(
      settings.typescript,
      defaults.typescript
    ),
    java: cloneLanguageServerSettings(
      settings.java,
      defaults.java
    ),
    vue: cloneLanguageServerSettings(
      settings.vue ?? defaults.vue!,
      defaults.vue!
    ),
    python: cloneLanguageServerSettings(
      settings.python ?? defaults.python!,
      defaults.python!
    ),
    go: cloneLanguageServerSettings(
      settings.go ?? defaults.go!,
      defaults.go!
    ),
    kotlin: cloneLanguageServerSettings(
      settings.kotlin ?? defaults.kotlin!,
      defaults.kotlin!
    ),
    csharp: cloneLanguageServerSettings(
      settings.csharp ?? defaults.csharp!,
      defaults.csharp!
    ),
    rust: cloneLanguageServerSettings(
      settings.rust ?? defaults.rust!,
      defaults.rust!
    )
  };
}

function cloneLanguageServerSettings(
  settings: StoredLanguageServerSettings,
  defaults: LanguageServerCommandSettingsDto
): NonNullable<CodeAnalysisSettingsDto["vue"]> {
  return {
    enabled: settings.enabled,
    command: settings.command,
    args: [...settings.args],
    maxDocuments:
      settings.maxDocuments ?? defaults.maxDocuments,
    maxSymbolsPerDocument:
      settings.maxSymbolsPerDocument ??
      defaults.maxSymbolsPerDocument,
    maxCallHierarchyRequests:
      settings.maxCallHierarchyRequests ??
      defaults.maxCallHierarchyRequests,
    maxTypeHierarchyRequests:
      settings.maxTypeHierarchyRequests ??
      defaults.maxTypeHierarchyRequests ??
      defaults.maxCallHierarchyRequests,
    maxReferenceRequests:
      settings.maxReferenceRequests ??
      defaults.maxReferenceRequests,
    maxDocumentationRequests:
      settings.maxDocumentationRequests ??
      defaults.maxDocumentationRequests,
    maxReferencesPerSymbol:
      settings.maxReferencesPerSymbol ??
      defaults.maxReferencesPerSymbol
  };
}

function updateLanguageServerLaunchApprovals(
  current: AppSettingsDocument,
  next: AppSettingsDocument,
  approvedLaunches: readonly LanguageServerLaunchApprovalRequest[]
): LanguageServerLaunchApprovals {
  const approvals = cloneLanguageServerLaunchApprovals(
    current.languageServerLaunchApprovals
  );
  const approvedFingerprints = new Map(
    approvedLaunches.map((launch) => [
      launch.language,
      languageServerLaunchFingerprint(launch.language, launch)
    ])
  );
  for (const language of LANGUAGE_SERVER_LANGUAGES) {
    const currentLaunch = resolvedLanguageServerLaunch(
      current.codeAnalysis,
      language
    );
    const nextLaunch = resolvedLanguageServerLaunch(
      next.codeAnalysis,
      language
    );
    if (isDefaultLanguageServerLaunch(language, nextLaunch)) {
      delete approvals[language];
      continue;
    }
    const nextFingerprint =
      languageServerLaunchFingerprint(language, nextLaunch);
    if (
      approvedFingerprints.get(language) === nextFingerprint
    ) {
      approvals[language] = nextFingerprint;
      continue;
    }
    if (!languageServerLaunchesEqual(currentLaunch, nextLaunch)) {
      delete approvals[language];
    }
  }
  return approvals;
}

function assertApprovedLanguageServerLaunchesMatch(
  settings: LanguageServerSettingsSource,
  approvedLaunches: readonly LanguageServerLaunchApprovalRequest[]
): void {
  for (const approvedLaunch of approvedLaunches) {
    const actualLaunch = resolvedLanguageServerLaunch(
      settings,
      approvedLaunch.language
    );
    if (
      languageServerLaunchFingerprint(
        approvedLaunch.language,
        actualLaunch
      ) ===
      languageServerLaunchFingerprint(
        approvedLaunch.language,
        approvedLaunch
      )
    ) {
      continue;
    }
    throw new WorkspaceError(
      "INVALID_REQUEST",
      `${languageServerLabel(approvedLaunch.language)} Language Server 配置在确认期间发生了变化，请重新检查命令与参数。`
    );
  }
}

function resolvedLanguageServerLaunch(
  settings: LanguageServerSettingsSource,
  language: LanguageServerLanguageDto
): LanguageServerCommandSettingsDto {
  const configured = settings[language];
  if (configured) {
    return {
      ...configured,
      args: [...configured.args]
    };
  }
  const defaults = createDefaultCodeAnalysisSettings();
  const defaultSettings =
    defaults[language] as LanguageServerCommandSettingsDto;
  return cloneLanguageServerSettings(
    defaultSettings,
    defaultSettings
  );
}

function isDefaultLanguageServerLaunch(
  language: LanguageServerLanguageDto,
  launch: LanguageServerCommandSettingsDto
): boolean {
  const defaults = resolvedLanguageServerLaunch(
    createDefaultCodeAnalysisSettings(),
    language
  );
  return languageServerLaunchesEqual(defaults, launch);
}

function languageServerLaunchesEqual(
  left: LanguageServerCommandSettingsDto,
  right: LanguageServerCommandSettingsDto
): boolean {
  return (
    left.command === right.command &&
    left.args.length === right.args.length &&
    left.args.every(
      (argument, index) => argument === right.args[index]
    )
  );
}

function languageServerLaunchFingerprint(
  language: LanguageServerLanguageDto,
  launch: Pick<
    LanguageServerCommandSettingsDto,
    "command" | "args"
  >
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        language,
        command: launch.command,
        args: launch.args
      })
    )
    .digest("hex");
}

function cloneLanguageServerLaunchApprovals(
  approvals: LanguageServerLaunchApprovals
): LanguageServerLaunchApprovals {
  return Object.fromEntries(
    LANGUAGE_SERVER_LANGUAGES.flatMap((language) => {
      const fingerprint = approvals[language];
      return fingerprint
        ? [[language, fingerprint] as const]
        : [];
    })
  );
}

function isLanguageServerLaunchApprovals(
  value: unknown
): value is LanguageServerLaunchApprovals {
  if (!isRecord(value)) {
    return false;
  }
  const supported = new Set<string>(
    LANGUAGE_SERVER_LANGUAGES
  );
  return Object.entries(value).every(
    ([language, fingerprint]) =>
      supported.has(language) &&
      typeof fingerprint === "string" &&
      /^[a-f0-9]{64}$/u.test(fingerprint)
  );
}

function languageServerLabel(
  language: LanguageServerLanguageDto
): string {
  return {
    typescript: "TypeScript",
    vue: "Vue",
    java: "Java",
    python: "Python",
    go: "Go",
    kotlin: "Kotlin",
    csharp: "C#",
    rust: "Rust"
  }[language];
}

function mergeLanguageServerSettings(
  current: NonNullable<CodeAnalysisSettingsDto["vue"]>,
  patch:
    | Partial<
        NonNullable<CodeAnalysisSettingsDto["vue"]>
      >
    | undefined
): NonNullable<CodeAnalysisSettingsDto["vue"]> {
  return {
    ...current,
    ...patch,
    args:
      patch?.args === undefined
        ? [...current.args]
        : [...patch.args]
  };
}

function resolvedAdditionalLanguageServer(
  settings: CodeAnalysisSettingsDto,
  language:
    | "vue"
    | "python"
    | "go"
    | "kotlin"
    | "csharp"
    | "rust"
): NonNullable<CodeAnalysisSettingsDto["vue"]> {
  const defaults = createDefaultCodeAnalysisSettings();
  const current =
    settings[language] ??
    (defaults[language] as NonNullable<
      CodeAnalysisSettingsDto["vue"]
    >);
  return cloneLanguageServerSettings(
    current,
    defaults[language] as NonNullable<
      CodeAnalysisSettingsDto["vue"]
    >
  );
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
    },
    vue: mergeLanguageServerSettings(
      resolvedAdditionalLanguageServer(current, "vue"),
      patch.vue
    ),
    python: mergeLanguageServerSettings(
      resolvedAdditionalLanguageServer(current, "python"),
      patch.python
    ),
    go: mergeLanguageServerSettings(
      resolvedAdditionalLanguageServer(current, "go"),
      patch.go
    ),
    kotlin: mergeLanguageServerSettings(
      resolvedAdditionalLanguageServer(current, "kotlin"),
      patch.kotlin
    ),
    csharp: mergeLanguageServerSettings(
      resolvedAdditionalLanguageServer(current, "csharp"),
      patch.csharp
    ),
    rust: mergeLanguageServerSettings(
      resolvedAdditionalLanguageServer(current, "rust"),
      patch.rust
    )
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
    languageServerLaunchApprovals: {},
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
