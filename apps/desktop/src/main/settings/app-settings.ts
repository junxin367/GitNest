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

export const APP_SETTINGS_SCHEMA_VERSION = 2;
const MAX_AI_API_URL_LENGTH = 2_048;
const MAX_AI_MODEL_LENGTH = 256;
const MAX_AI_API_KEY_LENGTH = 8_192;
const MAX_AI_PROMPT_LENGTH = 12_000;
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

interface AppSettingsDocument {
  schemaVersion: typeof APP_SETTINGS_SCHEMA_VERSION;
  general: AppSettingsDto["general"];
  appearance: AppSettingsDto["appearance"];
  diff: AppSettingsDiffDocument;
  git: AppSettingsDto["git"];
  ai: InternalAiSettings;
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
  ai: InternalAiSettings;
  navigation: AppSettingsDto["navigation"];
  updatedAt: string;
}

export class AppSettingsService {
  readonly #store: AtomicJsonStore;
  readonly #clock: () => string;
  #loadPromise: Promise<AppSettingsDocument> | undefined;
  #storageState: AppSettingsLoadDto["storageState"] = "missing";
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(
    filePath: string,
    clock: () => string = () => new Date().toISOString()
  ) {
    this.#store = new AtomicJsonStore(filePath);
    this.#clock = clock;
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
      await this.#store.write(next);
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
      const next: AppSettingsDocument = {
        ...current,
        ai: {
          ...current.ai,
          apiKey: ""
        },
        updatedAt: this.#clock()
      };
      await this.#store.write(next);
      this.#loadPromise = Promise.resolve(next);
      this.#storageState = "persisted";
      return toPublicSettings(next);
    });
  }

  async getInternalAiSettings(): Promise<InternalAiSettings> {
    const document = await this.#load();
    return { ...document.ai };
  }

  async #load(): Promise<AppSettingsDocument> {
    if (!this.#loadPromise) {
      this.#loadPromise = this.#readDocument();
    }
    return this.#loadPromise;
  }

  async #readDocument(): Promise<AppSettingsDocument> {
    const value = await this.#store.read();
    if (value === null) {
      this.#storageState = "missing";
      return createDefaultDocument(this.#clock());
    }
    if (isAppSettingsDocumentV1(value)) {
      const migrated = migrateV1Document(value);
      await this.#store.write(migrated);
      return migrated;
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
    this.#storageState = "persisted";
    return cloneDocument(value);
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
      apiKey: "",
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
    ai: {
      ...current.ai,
      ...patch.ai
    },
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
      apiKeyConfigured: Boolean(document.ai.apiKey)
    },
    codeAnalysis: cloneCodeAnalysisSettings(
      document.codeAnalysis
    ),
    navigation: { ...document.navigation }
  };
}

function cloneDocument(
  document: AppSettingsDocument
): AppSettingsDocument {
  return {
    ...document,
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
      document.codeAnalysis
    ),
    navigation: { ...document.navigation }
  };
}

function isAppSettingsDocument(
  value: unknown
): value is AppSettingsDocument {
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
    isAiSettings(value.ai) &&
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
    ...settings,
    ignoreDirectories: [...settings.ignoreDirectories],
    typescript: {
      ...settings.typescript,
      args: [...settings.typescript.args]
    },
    java: {
      ...settings.java,
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
): AppSettingsDocument {
  const defaults = createDefaultAppSettings();
  return {
    schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
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
