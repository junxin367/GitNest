export type CodeAnalysisScope = "changed" | "workspace";

export type CodeAnalysisLanguage =
  | "typescript"
  | "javascript"
  | "vue"
  | "java"
  | "python"
  | "go"
  | "kotlin"
  | "csharp"
  | "rust";

export type LanguageServerLanguage = Exclude<
  CodeAnalysisLanguage,
  "javascript"
>;

export type CodeAnalysisProfileId =
  | "web-http"
  | "fai-cli-rpc";

export type CodeRequestTransport = "http" | "rpc";

export type CodeGraphNodeKind =
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

export type CodeGraphEdgeKind =
  | "contains"
  | "calls"
  | "extends"
  | "implements"
  | "overrides"
  | "http-request"
  | "rpc-request"
  | "references";

export type AnalysisConfidence =
  | "exact"
  | "probable"
  | "heuristic";

export const MAX_CODE_DOCUMENTATION_CHARACTERS = 4_000;

export interface AnalysisRoot {
  repositoryId: string;
  worktreeId: string;
  name: string;
  path: string;
  revision?: string;
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
  maxDocuments: number;
  maxSymbolsPerDocument: number;
  maxCallHierarchyRequests: number;
  maxTypeHierarchyRequests?: number;
  maxReferenceRequests: number;
  maxDocumentationRequests: number;
  maxReferencesPerSymbol: number;
}

export interface CodeAnalysisSettings {
  enabled: boolean;
  staticFallback: boolean;
  maxFiles: number;
  maxTotalSourceBytes: number;
  maxGraphNodes: number;
  maxGraphEdges: number;
  maxRequestChains: number;
  maxDiagnostics: number;
  maxFileSizeBytes: number;
  readConcurrency: number;
  graphDepth: number;
  lspTimeoutMs: number;
  ignoreDirectories: string[];
  typescript: LanguageServerCommandSettings;
  java: LanguageServerCommandSettings;
  vue?: LanguageServerCommandSettings;
  python?: LanguageServerCommandSettings;
  go?: LanguageServerCommandSettings;
  kotlin?: LanguageServerCommandSettings;
  csharp?: LanguageServerCommandSettings;
  rust?: LanguageServerCommandSettings;
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
  source?: "builtin" | "lsp" | "merged";
  evidence?: string;
}

export interface ParsedReference {
  name: string;
  line: number;
  targetQualifiedName?: string;
  targetCanonicalPath?: string;
  targetLine?: number;
  source: "builtin" | "lsp" | "merged";
  evidence: string;
}

export type ParsedSemanticRelationKind =
  | "extends"
  | "implements"
  | "overrides";

export interface ParsedSemanticRelation {
  kind: ParsedSemanticRelationKind;
  targetName: string;
  targetCanonicalPath?: string;
  targetLine?: number;
  source: "lsp";
  evidence: string;
}

export interface ParsedSymbol {
  name: string;
  qualifiedName: string;
  kind:
    | "module"
    | "package"
    | "class"
    | "interface"
    | "enum"
    | "property"
    | "function"
    | "method";
  line: number;
  endLine: number;
  selectionCharacter?: number;
  parentQualifiedName?: string;
  packageName?: string;
  signature?: string;
  semanticId?: string;
  documentation?: string;
  calls: ParsedCall[];
  references?: ParsedReference[];
  semanticRelations?: ParsedSemanticRelation[];
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
  source?: "builtin" | "lsp" | "merged";
  evidence?: string;
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

export type CodeAnalysisDiagnosticKind =
  | "partial-index"
  | "unresolved-call"
  | "unmatched-request"
  | "unmatched-rpc"
  | "ambiguous-target";

export interface CodeAnalysisDiagnostic {
  id: string;
  kind: CodeAnalysisDiagnosticKind;
  severity: "info" | "warning";
  message: string;
  evidence: string;
  nodeId?: string;
  relatedNodeIds: string[];
}

export interface CodeAnalysisIndexStatus {
  fullIndexAvailable: boolean;
  resultCompleteness: "complete" | "partial";
  impactCoverage: "confirmed" | "possible-omissions";
  lastFullIndexAt?: string;
  message: string;
}

export type LanguageServerState =
  | "disabled"
  | "connected"
  | "unavailable"
  | "failed";

export interface LanguageServerStatus {
  language: LanguageServerLanguage;
  state: LanguageServerState;
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
  scope: CodeAnalysisScope;
  generatedAt: string;
  roots: AnalysisRoot[];
  sourceState?: {
    worktreeStatuses: Array<{
      repositoryId: string;
      worktreeId: string;
      fingerprint: string;
    }>;
    changedSourceFiles: Array<{
      repositoryId: string;
      worktreeId: string;
      path: string;
      size: number;
      modifiedAtMs: number;
    }>;
  };
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  requestChains: CodeRequestChain[];
  languageServers: LanguageServerStatus[];
  indexStatus?: CodeAnalysisIndexStatus;
  diagnostics?: CodeAnalysisDiagnostic[];
  warnings: string[];
  stats: CodeAnalysisStats;
}

export interface CodeAnalysisInput {
  analysisId: string;
  workspaceId: string;
  workspaceRootPath: string;
  roots: AnalysisRoot[];
  scope: CodeAnalysisScope;
  /**
   * Allows a changed-file discovery pass to emit an updated full
   * workspace graph from the cached complete index.
   */
  resultScope?: CodeAnalysisScope;
  changedPaths: ChangedAnalysisPath[];
  freshnessChangedPaths?: ChangedAnalysisPath[];
  worktreeStatuses?: Array<{
    repositoryId: string;
    worktreeId: string;
    fingerprint: string;
  }>;
  cacheDirectory: string;
  lspDataDirectory: string;
  settings: CodeAnalysisSettings;
  signal?: AbortSignal;
  onProgress?(progress: CodeAnalysisProgress): void;
}

export interface SourceInventoryResult {
  files: AnalysisSourceFile[];
  totalBytes: number;
  skippedFiles: number;
  configuredSkippedFiles: number;
  inspectionFailureCount: number;
  truncated: boolean;
  warnings: string[];
}

export interface LspDocumentSymbol {
  name: string;
  kind: number;
  line: number;
  character: number;
  endLine: number;
  endCharacter?: number;
  detail?: string;
  containerName?: string;
  documentation?: string;
  children: LspDocumentSymbol[];
  outgoingCalls: LspCallReference[];
  incomingCalls: LspIncomingCallReference[];
  references?: LspReferenceLocation[];
}

export interface LspCallReference {
  name: string;
  line: number;
  targetCanonicalPath?: string;
  targetLine?: number;
}

export interface LspIncomingCallReference {
  name: string;
  line: number;
  sourceCanonicalPath?: string;
  sourceLine?: number;
}

export interface LspReferenceLocation {
  sourceCanonicalPath?: string;
  line: number;
  character: number;
}

export interface LspSemanticRelation {
  kind: ParsedSemanticRelationKind;
  sourceName: string;
  sourceCanonicalPath: string;
  sourceLine: number;
  targetName: string;
  targetCanonicalPath: string;
  targetLine: number;
  evidence: string;
}

export interface LspAnalysisResult {
  symbolsByPath: Map<string, LspDocumentSymbol[]>;
  semanticRelations?: LspSemanticRelation[];
  statuses: LanguageServerStatus[];
  warnings: string[];
}
