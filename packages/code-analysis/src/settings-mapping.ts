import type {
  CodeAnalysisSettings,
  LanguageServerCommandSettings
} from "./model";

/**
 * Maps persisted, human-facing analysis preferences onto the
 * internal engine settings.
 *
 * Unit conversion (MiB/KiB to bytes) lives here so the desktop
 * main process and the MCP server cannot drift apart: a mismatch
 * changes the snapshot configuration key and would silently hide
 * every existing snapshot.
 *
 * The input is a structural type on purpose: `@gitnest/contracts`
 * owns the DTO shape, and this package must not depend on it.
 */

export interface PersistedLanguageServerSettings {
  enabled: boolean;
  command: string;
  args: readonly string[];
  maxDocuments: number;
  maxSymbolsPerDocument: number;
  maxCallHierarchyRequests: number;
  maxTypeHierarchyRequests?: number;
  maxReferenceRequests: number;
  maxDocumentationRequests: number;
  maxReferencesPerSymbol: number;
}

export interface PersistedCodeAnalysisSettings {
  enabled: boolean;
  staticFallback: boolean;
  mcp?: {
    enabled: boolean;
    allowSourceSnippets: boolean;
    maxResponseKb: number;
  };
  maxFiles: number;
  maxTotalSourceMb: number;
  maxGraphNodes: number;
  maxGraphEdges: number;
  maxRequestChains: number;
  maxDiagnostics: number;
  maxFileSizeKb: number;
  readConcurrency: number;
  graphDepth: number;
  lspTimeoutMs: number;
  ignoreDirectories: readonly string[];
  typescript: PersistedLanguageServerSettings;
  java: PersistedLanguageServerSettings;
  vue?: PersistedLanguageServerSettings;
  python?: PersistedLanguageServerSettings;
  go?: PersistedLanguageServerSettings;
  kotlin?: PersistedLanguageServerSettings;
  csharp?: PersistedLanguageServerSettings;
  rust?: PersistedLanguageServerSettings;
}

export function codeAnalysisSettingsFromPersisted(
  preferences: PersistedCodeAnalysisSettings
): CodeAnalysisSettings {
  return {
    enabled: preferences.enabled,
    staticFallback: preferences.staticFallback,
    maxFiles: preferences.maxFiles,
    maxTotalSourceBytes:
      preferences.maxTotalSourceMb * 1_024 * 1_024,
    maxGraphNodes: preferences.maxGraphNodes,
    maxGraphEdges: preferences.maxGraphEdges,
    maxRequestChains: preferences.maxRequestChains,
    maxDiagnostics: preferences.maxDiagnostics,
    maxFileSizeBytes: preferences.maxFileSizeKb * 1_024,
    readConcurrency: preferences.readConcurrency,
    graphDepth: preferences.graphDepth,
    lspTimeoutMs: preferences.lspTimeoutMs,
    ignoreDirectories: [...preferences.ignoreDirectories],
    typescript: toLanguageServerSettings(
      preferences.typescript
    ),
    java: toLanguageServerSettings(preferences.java),
    ...(preferences.vue
      ? { vue: toLanguageServerSettings(preferences.vue) }
      : {}),
    ...(preferences.python
      ? { python: toLanguageServerSettings(preferences.python) }
      : {}),
    ...(preferences.go
      ? { go: toLanguageServerSettings(preferences.go) }
      : {}),
    ...(preferences.kotlin
      ? { kotlin: toLanguageServerSettings(preferences.kotlin) }
      : {}),
    ...(preferences.csharp
      ? { csharp: toLanguageServerSettings(preferences.csharp) }
      : {}),
    ...(preferences.rust
      ? { rust: toLanguageServerSettings(preferences.rust) }
      : {})
  };
}

function toLanguageServerSettings(
  settings: PersistedLanguageServerSettings
): LanguageServerCommandSettings {
  return {
    enabled: settings.enabled,
    command: settings.command,
    args: [...settings.args],
    maxDocuments: settings.maxDocuments,
    maxSymbolsPerDocument: settings.maxSymbolsPerDocument,
    maxCallHierarchyRequests:
      settings.maxCallHierarchyRequests,
    ...(settings.maxTypeHierarchyRequests !== undefined
      ? {
          maxTypeHierarchyRequests:
            settings.maxTypeHierarchyRequests
        }
      : {}),
    maxReferenceRequests: settings.maxReferenceRequests,
    maxDocumentationRequests:
      settings.maxDocumentationRequests,
    maxReferencesPerSymbol: settings.maxReferencesPerSymbol
  };
}
