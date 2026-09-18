export type CodeAnalysisScope = "changed" | "workspace";

export type CodeAnalysisLanguage =
  | "typescript"
  | "javascript"
  | "vue"
  | "java";

export type CodeAnalysisProfileId =
  | "web-http"
  | "fai-cli-rpc";

export type CodeRequestTransport = "http" | "rpc";

export type CodeGraphNodeKind =
  | "file"
  | "class"
  | "function"
  | "method"
  | "client-request"
  | "server-endpoint"
  | "rpc-client"
  | "rpc-handler";

export type CodeGraphEdgeKind =
  | "contains"
  | "calls"
  | "http-request"
  | "rpc-request"
  | "references";

export type AnalysisConfidence =
  | "exact"
  | "probable"
  | "heuristic";

export interface AnalysisRoot {
  repositoryId: string;
  worktreeId: string;
  name: string;
  path: string;
}

export interface ChangedAnalysisPath {
  repositoryId: string;
  worktreeId: string;
  path: string;
}

export interface LanguageServerCommandSettings {
  enabled: boolean;
  command: string;
  args: string[];
}

export interface CodeAnalysisSettings {
  enabled: boolean;
  staticFallback: boolean;
  maxFiles: number;
  maxFileSizeBytes: number;
  readConcurrency: number;
  graphDepth: number;
  lspTimeoutMs: number;
  ignoreDirectories: string[];
  typescript: LanguageServerCommandSettings;
  java: LanguageServerCommandSettings;
}

export type CodeAnalysisProgressStage =
  | "discovering"
  | "reading"
  | "parsing"
  | "lsp"
  | "linking"
  | "caching";

export interface CodeAnalysisProgress {
  stage: CodeAnalysisProgressStage;
  completed: number;
  total: number;
  message: string;
}

export interface AnalysisSourceFile {
  absolutePath: string;
  canonicalPath: string;
  relativePath: string;
  repositoryId: string;
  worktreeId: string;
  rootPath: string;
  language: CodeAnalysisLanguage;
  size: number;
  modifiedAtMs: number;
  fingerprint: string;
  changed: boolean;
}

export interface ParsedCall {
  name: string;
  receiver?: string;
  receiverType?: string;
  line: number;
  targetCanonicalPath?: string;
  targetLine?: number;
}

export interface ParsedSymbol {
  name: string;
  qualifiedName: string;
  kind: "class" | "function" | "method";
  line: number;
  endLine: number;
  parentQualifiedName?: string;
  documentation?: string;
  calls: ParsedCall[];
  source: "builtin" | "lsp" | "merged";
}

export interface ParsedClientRequest {
  method: string;
  route: string;
  rawRoute: string;
  line: number;
  containerQualifiedName?: string;
  documentation?: string;
}

export interface ParsedServerEndpoint {
  method: string;
  route: string;
  rawRoute: string;
  line: number;
  symbolQualifiedName?: string;
  annotation: string;
}

export interface ParsedRemoteBoundary {
  profileId: CodeAnalysisProfileId;
  transport: CodeRequestTransport;
  role: "client" | "server";
  operationKey: string;
  operationName: string;
  serviceKey: string;
  rawOperation: string;
  wrapperId: string;
  line: number;
  symbolQualifiedName?: string;
  confidence: AnalysisConfidence;
}

export interface ParsedSourceFile {
  file: AnalysisSourceFile;
  symbols: ParsedSymbol[];
  clientRequests: ParsedClientRequest[];
  serverEndpoints: ParsedServerEndpoint[];
  remoteBoundaries: ParsedRemoteBoundary[];
}

export interface CodeGraphLocation {
  repositoryId: string;
  worktreeId: string;
  path: string;
  line: number;
  column: number;
}

export interface CodeGraphNode {
  id: string;
  kind: CodeGraphNodeKind;
  name: string;
  qualifiedName: string;
  language: CodeAnalysisLanguage;
  location: CodeGraphLocation;
  changed: boolean;
  source: "builtin" | "lsp" | "merged";
  confidence: AnalysisConfidence;
  metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface CodeGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: CodeGraphEdgeKind;
  confidence: AnalysisConfidence;
  label?: string;
}

export interface CodeRequestChain {
  id: string;
  profileId: CodeAnalysisProfileId;
  transport: CodeRequestTransport;
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
  confidence: AnalysisConfidence;
}

export type LanguageServerState =
  | "disabled"
  | "connected"
  | "unavailable"
  | "failed";

export interface LanguageServerStatus {
  language: "typescript" | "java";
  state: LanguageServerState;
  command: string;
  message: string;
  symbolCount: number;
}

export interface CodeAnalysisStats {
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

export interface CodeAnalysisSnapshot {
  schemaVersion: 1;
  analysisId: string;
  workspaceId: string;
  entryId: string;
  entryName: string;
  scope: CodeAnalysisScope;
  generatedAt: string;
  roots: AnalysisRoot[];
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  requestChains: CodeRequestChain[];
  languageServers: LanguageServerStatus[];
  warnings: string[];
  stats: CodeAnalysisStats;
}

export interface CodeAnalysisInput {
  analysisId: string;
  workspaceId: string;
  entryId: string;
  entryName: string;
  workspaceRootPath: string;
  roots: AnalysisRoot[];
  scope: CodeAnalysisScope;
  changedPaths: ChangedAnalysisPath[];
  cacheDirectory: string;
  lspDataDirectory: string;
  settings: CodeAnalysisSettings;
  signal?: AbortSignal;
  onProgress?(progress: CodeAnalysisProgress): void;
}

export interface SourceInventoryResult {
  files: AnalysisSourceFile[];
  skippedFiles: number;
  truncated: boolean;
  warnings: string[];
}

export interface LspDocumentSymbol {
  name: string;
  kind: number;
  line: number;
  character: number;
  endLine: number;
  documentation?: string;
  children: LspDocumentSymbol[];
  outgoingCalls: LspCallReference[];
}

export interface LspCallReference {
  name: string;
  line: number;
  targetCanonicalPath?: string;
  targetLine?: number;
}

export interface LspAnalysisResult {
  symbolsByPath: Map<string, LspDocumentSymbol[]>;
  statuses: LanguageServerStatus[];
  warnings: string[];
}
