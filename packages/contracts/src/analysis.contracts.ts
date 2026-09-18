import type {
  GitReadErrorDto,
  GitReadResult
} from "./git.contracts";

export type CodeAnalysisScopeDto =
  | "changed"
  | "workspace";

export type CodeAnalysisLanguageDto =
  | "typescript"
  | "javascript"
  | "vue"
  | "java";

export type CodeGraphNodeKindDto =
  | "file"
  | "class"
  | "function"
  | "method"
  | "client-request"
  | "server-endpoint"
  | "rpc-client"
  | "rpc-handler";

export type CodeGraphEdgeKindDto =
  | "contains"
  | "calls"
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
}

export interface CodeAnalysisSettingsDto {
  enabled: boolean;
  defaultScope: CodeAnalysisScopeDto;
  staticFallback: boolean;
  maxFiles: number;
  maxFileSizeKb: number;
  readConcurrency: number;
  graphDepth: number;
  lspTimeoutMs: number;
  ignoreDirectories: string[];
  typescript: LanguageServerCommandSettingsDto;
  java: LanguageServerCommandSettingsDto;
}

export interface UpdateCodeAnalysisSettingsRequest {
  enabled?: boolean;
  defaultScope?: CodeAnalysisScopeDto;
  staticFallback?: boolean;
  maxFiles?: number;
  maxFileSizeKb?: number;
  readConcurrency?: number;
  graphDepth?: number;
  lspTimeoutMs?: number;
  ignoreDirectories?: string[];
  typescript?: Partial<LanguageServerCommandSettingsDto>;
  java?: Partial<LanguageServerCommandSettingsDto>;
}

export interface CodeAnalysisRootDto {
  repositoryId: string;
  worktreeId: string;
  name: string;
  path: string;
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

export type LanguageServerStateDto =
  | "disabled"
  | "connected"
  | "unavailable"
  | "failed";

export interface LanguageServerStatusDto {
  language: "typescript" | "java";
  state: LanguageServerStateDto;
  command: string;
  message: string;
  symbolCount: number;
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
  entryId: string;
  entryName: string;
  scope: CodeAnalysisScopeDto;
  generatedAt: string;
  roots: CodeAnalysisRootDto[];
  nodes: CodeGraphNodeDto[];
  edges: CodeGraphEdgeDto[];
  requestChains: CodeRequestChainDto[];
  languageServers: LanguageServerStatusDto[];
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
  entryId?: string;
  entryName?: string;
  scope?: CodeAnalysisScopeDto;
  progress?: CodeAnalysisProgressDto;
  generatedAt?: string;
  stats?: CodeAnalysisStatsDto;
  error?: GitReadErrorDto;
}

export interface StartCodeAnalysisRequest {
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

export type InstallableLanguageServerDto =
  | "typescript"
  | "java";

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

export function createDefaultCodeAnalysisSettings(): CodeAnalysisSettingsDto {
  return {
    enabled: true,
    defaultScope: "changed",
    staticFallback: true,
    maxFiles: 5_000,
    maxFileSizeKb: 768,
    readConcurrency: 2,
    graphDepth: 6,
    lspTimeoutMs: 8_000,
    ignoreDirectories: [...DEFAULT_CODE_ANALYSIS_IGNORES],
    typescript: {
      enabled: true,
      command: "typescript-language-server",
      args: ["--stdio"]
    },
    java: {
      enabled: true,
      command: "jdtls",
      args: []
    }
  };
}
