import type {
  GitReadErrorDto,
  GitReadResult
} from "./git.contracts";

export type CodeAnalysisScopeDto =
  | "changed"
  | "workspace";

export const LANGUAGE_SERVER_LANGUAGES = [
  "typescript",
  "vue",
  "java",
  "python",
  "go",
  "kotlin",
  "csharp",
  "rust"
] as const;

export type LanguageServerLanguageDto =
  (typeof LANGUAGE_SERVER_LANGUAGES)[number];

export type CodeAnalysisLanguageDto =
  | LanguageServerLanguageDto
  | "javascript";

export type CodeGraphNodeKindDto =
  | "file"
  | "module"
  | "package"
  | "class"
  | "interface"
  | "enum"
  | "property"
  | "function"
  | "method"
  | "client-request"
  | "server-endpoint"
  | "rpc-client"
  | "rpc-handler";

export type CodeGraphEdgeKindDto =
  | "contains"
  | "calls"
  | "extends"
  | "implements"
  | "overrides"
  | "http-request"
  | "rpc-request"
  | "references";

export type AnalysisConfidenceDto =
  | "exact"
  | "probable"
  | "heuristic";

export interface LanguageServerCommandSettingsDto {
  enabled: boolean;
  command: string;
  args: string[];
  maxDocuments: number;
  maxSymbolsPerDocument: number;
  maxCallHierarchyRequests: number;
  maxTypeHierarchyRequests?: number;
  maxReferenceRequests: number;
  maxDocumentationRequests: number;
  maxReferencesPerSymbol: number;
}

export interface CodeAnalysisSettingsDto {
  enabled: boolean;
  defaultScope: CodeAnalysisScopeDto;
  staticFallback: boolean;
  autoRefresh: CodeAnalysisAutoRefreshSettingsDto;
  mcp: McpServerSettingsDto;
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
  ignoreDirectories: string[];
  typescript: LanguageServerCommandSettingsDto;
  java: LanguageServerCommandSettingsDto;
  vue?: LanguageServerCommandSettingsDto;
  python?: LanguageServerCommandSettingsDto;
  go?: LanguageServerCommandSettingsDto;
  kotlin?: LanguageServerCommandSettingsDto;
  csharp?: LanguageServerCommandSettingsDto;
  rust?: LanguageServerCommandSettingsDto;
}

export interface CodeAnalysisAutoRefreshSettingsDto {
  enabled: boolean;
  debounceMs: number;
}

export interface McpServerSettingsDto {
  enabled: boolean;
  allowSourceSnippets: boolean;
  maxResponseKb: number;
}

export interface UpdateCodeAnalysisSettingsRequest {
  enabled?: boolean;
  defaultScope?: CodeAnalysisScopeDto;
  staticFallback?: boolean;
  autoRefresh?: Partial<CodeAnalysisAutoRefreshSettingsDto>;
  mcp?: Partial<McpServerSettingsDto>;
  maxFiles?: number;
  maxTotalSourceMb?: number;
  maxGraphNodes?: number;
  maxGraphEdges?: number;
  maxRequestChains?: number;
  maxDiagnostics?: number;
  maxFileSizeKb?: number;
  readConcurrency?: number;
  graphDepth?: number;
  lspTimeoutMs?: number;
  ignoreDirectories?: string[];
  typescript?: Partial<LanguageServerCommandSettingsDto>;
  java?: Partial<LanguageServerCommandSettingsDto>;
  vue?: Partial<LanguageServerCommandSettingsDto>;
  python?: Partial<LanguageServerCommandSettingsDto>;
  go?: Partial<LanguageServerCommandSettingsDto>;
  kotlin?: Partial<LanguageServerCommandSettingsDto>;
  csharp?: Partial<LanguageServerCommandSettingsDto>;
  rust?: Partial<LanguageServerCommandSettingsDto>;
}

export interface CodeAnalysisRootDto {
  repositoryId: string;
  worktreeId: string;
  name: string;
  path: string;
  revision?: string;
}

export interface CodeGraphLocationDto {
  repositoryId: string;
  worktreeId: string;
  path: string;
  line: number;
  column: number;
}

export interface CodeGraphNodeDto {
  id: string;
  kind: CodeGraphNodeKindDto;
  name: string;
  qualifiedName: string;
  language: CodeAnalysisLanguageDto;
  location: CodeGraphLocationDto;
  changed: boolean;
  source: "builtin" | "lsp" | "merged";
  confidence: AnalysisConfidenceDto;
  metadata: Readonly<
    Record<string, string | number | boolean>
  >;
}

export interface CodeGraphEdgeDto {
  id: string;
  from: string;
  to: string;
  kind: CodeGraphEdgeKindDto;
  confidence: AnalysisConfidenceDto;
  label?: string;
  source?: "builtin" | "lsp" | "merged";
  evidence?: string;
}

export interface CodeRequestChainDto {
  id: string;
  profileId: string;
  transport: "http" | "rpc";
  operationKey: string;
  method: string;
  route: string;
  title: string;
  clientNodeId: string;
  endpointNodeId: string;
  nodeIds: string[];
  edgeIds: string[];
  changed: boolean;
  ambiguous: boolean;
  confidence: AnalysisConfidenceDto;
}

export type CodeAnalysisDiagnosticKindDto =
  | "partial-index"
  | "unresolved-call"
  | "unmatched-request"
  | "unmatched-rpc"
  | "ambiguous-target";

export interface CodeAnalysisDiagnosticDto {
  id: string;
  kind: CodeAnalysisDiagnosticKindDto;
  severity: "info" | "warning";
  message: string;
  evidence: string;
  nodeId?: string;
  relatedNodeIds: string[];
}

export interface CodeAnalysisIndexStatusDto {
  fullIndexAvailable: boolean;
  resultCompleteness: "complete" | "partial";
  impactCoverage: "confirmed" | "possible-omissions";
  lastFullIndexAt?: string;
  message: string;
}

export type LanguageServerStateDto =
  | "disabled"
  | "connected"
  | "unavailable"
  | "failed";

export interface LanguageServerStatusDto {
  language: LanguageServerLanguageDto;
  state: LanguageServerStateDto;
  command: string;
  message: string;
  symbolCount: number;
  semanticCoverage?:
    | "complete"
    | "partial"
    | "unavailable";
  documentsTotal?: number;
  documentsAnalyzed?: number;
  skippedDocuments?: number;
  failedDocuments?: number;
  truncatedDocuments?: number;
  requestBudgetExhausted?: boolean;
  enrichmentStoppedEarly?: boolean;
}

export interface CodeAnalysisStatsDto {
  discoveredFiles: number;
  analyzedFiles: number;
  cachedFiles: number;
  skippedFiles: number;
  symbolCount: number;
  edgeCount: number;
  requestChainCount: number;
  truncated: boolean;
  durationMs: number;
}

export interface CodeAnalysisSnapshotDto {
  schemaVersion: 1;
  analysisId: string;
  workspaceId: string;
  scope: CodeAnalysisScopeDto;
  generatedAt: string;
  roots: CodeAnalysisRootDto[];
  nodes: CodeGraphNodeDto[];
  edges: CodeGraphEdgeDto[];
  requestChains: CodeRequestChainDto[];
  languageServers: LanguageServerStatusDto[];
  indexStatus?: CodeAnalysisIndexStatusDto;
  diagnostics?: CodeAnalysisDiagnosticDto[];
  warnings: string[];
  stats: CodeAnalysisStatsDto;
}

export type CodeAnalysisProgressStageDto =
  | "discovering"
  | "reading"
  | "parsing"
  | "lsp"
  | "linking"
  | "caching";

export interface CodeAnalysisProgressDto {
  stage: CodeAnalysisProgressStageDto;
  completed: number;
  total: number;
  message: string;
}

export type CodeAnalysisRunStateDto =
  | "idle"
  | "running"
  | "ready"
  | "failed"
  | "cancelled";

export interface CodeAnalysisStateDto {
  state: CodeAnalysisRunStateDto;
  snapshotAvailable: boolean;
  analysisId?: string;
  workspaceId?: string;
  scope?: CodeAnalysisScopeDto;
  startedAt?: string;
  progress?: CodeAnalysisProgressDto;
  generatedAt?: string;
  stats?: CodeAnalysisStatsDto;
  error?: GitReadErrorDto;
}

export interface StartCodeAnalysisRequest {
  scope: CodeAnalysisScopeDto;
}

export interface RestoreCodeAnalysisSnapshotRequest {
  scope: CodeAnalysisScopeDto;
}

export interface CodeAnalysisAcceptedDto {
  analysisId: string;
}

export interface CancelCodeAnalysisRequest {
  analysisId: string;
}

export interface ReadCodeAnalysisFileRequest {
  nodeId: string;
}

export interface CodeAnalysisFileDto {
  nodeId: string;
  path: string;
  language: CodeAnalysisLanguageDto;
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
}

export interface McpRegistrationStatusDto {
  executablePath: string;
  entryScriptPath: string;
  dataDirectory: string;
  command: string;
  configSnippet: string;
  registered: boolean;
  codexAvailable: boolean;
  serverAvailable: boolean;
  message: string;
}

export interface SetMcpRegistrationRequest {
  registered: boolean;
}

export type InstallableLanguageServerDto =
  LanguageServerLanguageDto;

export interface InstallLanguageServerRequest {
  language: InstallableLanguageServerDto;
}

export interface LanguageServerInstallResultDto {
  language: InstallableLanguageServerDto;
  status: "installed" | "already-installed";
  command: string;
  message: string;
}

export type CodeAnalysisSnapshotResultDto = GitReadResult<
  CodeAnalysisSnapshotDto | null
>;

export const DEFAULT_CODE_ANALYSIS_IGNORES = [
  ".git",
  ".idea",
  ".vscode",
  ".pnpm",
  "node_modules",
  "target",
  "dist",
  "build",
  "out",
  "temp",
  "test-results",
  "coverage",
  ".cache"
] as const;

export const MIN_CODE_ANALYSIS_TOTAL_SOURCE_MB = 16;
export const DEFAULT_CODE_ANALYSIS_TOTAL_SOURCE_MB = 128;
export const MAX_CODE_ANALYSIS_TOTAL_SOURCE_MB = 1_024;

export const MIN_CODE_ANALYSIS_GRAPH_NODES = 5_000;
export const DEFAULT_CODE_ANALYSIS_GRAPH_NODES = 50_000;
export const MAX_CODE_ANALYSIS_GRAPH_NODES = 200_000;

export const MIN_CODE_ANALYSIS_GRAPH_EDGES = 10_000;
export const DEFAULT_CODE_ANALYSIS_GRAPH_EDGES = 100_000;
export const MAX_CODE_ANALYSIS_GRAPH_EDGES = 400_000;

export const MIN_CODE_ANALYSIS_REQUEST_CHAINS = 100;
export const DEFAULT_CODE_ANALYSIS_REQUEST_CHAINS = 5_000;
export const MAX_CODE_ANALYSIS_REQUEST_CHAINS = 50_000;

export const MIN_CODE_ANALYSIS_DIAGNOSTICS = 100;
export const DEFAULT_CODE_ANALYSIS_DIAGNOSTICS = 2_000;
export const MAX_CODE_ANALYSIS_DIAGNOSTICS = 20_000;

export const MIN_LSP_DOCUMENTS = 1;
export const MAX_LSP_DOCUMENTS = 5_000;
export const MIN_LSP_SYMBOLS_PER_DOCUMENT = 100;
export const DEFAULT_LSP_SYMBOLS_PER_DOCUMENT = 5_000;
export const MAX_LSP_SYMBOLS_PER_DOCUMENT = 20_000;
export const MIN_LSP_REQUESTS = 0;
export const MAX_LSP_REQUESTS = 10_000;
export const MIN_LSP_REFERENCES_PER_SYMBOL = 1;
export const MIN_MCP_MAX_RESPONSE_KB = 64;
export const MIN_CODE_ANALYSIS_AUTO_REFRESH_DEBOUNCE_MS = 200;
export const DEFAULT_CODE_ANALYSIS_AUTO_REFRESH_DEBOUNCE_MS = 1_500;
export const MAX_CODE_ANALYSIS_AUTO_REFRESH_DEBOUNCE_MS = 30_000;
export const DEFAULT_MCP_MAX_RESPONSE_KB = 256;
export const MAX_MCP_MAX_RESPONSE_KB = 1_024;
export const DEFAULT_LSP_REFERENCES_PER_SYMBOL = 500;
export const MAX_LSP_REFERENCES_PER_SYMBOL = 5_000;

export function createDefaultCodeAnalysisSettings(): CodeAnalysisSettingsDto {
  return {
    enabled: true,
    defaultScope: "changed",
    staticFallback: true,
    autoRefresh: {
      enabled: true,
      debounceMs: DEFAULT_CODE_ANALYSIS_AUTO_REFRESH_DEBOUNCE_MS
    },
    mcp: {
      enabled: true,
      allowSourceSnippets: true,
      maxResponseKb: DEFAULT_MCP_MAX_RESPONSE_KB
    },
    maxFiles: 5_000,
    maxTotalSourceMb: DEFAULT_CODE_ANALYSIS_TOTAL_SOURCE_MB,
    maxGraphNodes: DEFAULT_CODE_ANALYSIS_GRAPH_NODES,
    maxGraphEdges: DEFAULT_CODE_ANALYSIS_GRAPH_EDGES,
    maxRequestChains: DEFAULT_CODE_ANALYSIS_REQUEST_CHAINS,
    maxDiagnostics: DEFAULT_CODE_ANALYSIS_DIAGNOSTICS,
    maxFileSizeKb: 768,
    readConcurrency: 4,
    graphDepth: 8,
    lspTimeoutMs: 8_000,
    ignoreDirectories: [...DEFAULT_CODE_ANALYSIS_IGNORES],
    typescript: languageServerSettings({
      enabled: true,
      command: "typescript-language-server",
      args: ["--stdio"]
    }),
    java: languageServerSettings({
      enabled: true,
      command: "jdtls",
      args: [],
      java: true
    }),
    vue: languageServerSettings({
      enabled: true,
      command: "vue-language-server",
      args: ["--stdio"]
    }),
    python: languageServerSettings({
      enabled: false,
      command: "pyright-langserver",
      args: ["--stdio"]
    }),
    go: languageServerSettings({
      enabled: false,
      command: "gopls",
      args: ["serve"]
    }),
    kotlin: languageServerSettings({
      enabled: false,
      command: "kotlin-lsp",
      args: ["--stdio"]
    }),
    csharp: languageServerSettings({
      enabled: false,
      command: "csharp-ls",
      args: []
    }),
    rust: languageServerSettings({
      enabled: false,
      command: "rust-analyzer",
      args: []
    })
  };
}

function languageServerSettings(input: {
  enabled: boolean;
  command: string;
  args: string[];
  java?: boolean;
}): LanguageServerCommandSettingsDto {
  return {
    enabled: input.enabled,
    command: input.command,
    args: [...input.args],
    maxDocuments: input.java ? 80 : 120,
    maxSymbolsPerDocument:
      DEFAULT_LSP_SYMBOLS_PER_DOCUMENT,
    maxCallHierarchyRequests: input.java ? 40 : 50,
    maxTypeHierarchyRequests: input.java ? 80 : 50,
    maxReferenceRequests: input.java ? 1_000 : 50,
    maxDocumentationRequests: input.java ? 40 : 50,
    maxReferencesPerSymbol:
      DEFAULT_LSP_REFERENCES_PER_SYMBOL
  };
}
