import {
  createHash,
  randomUUID
} from "node:crypto";
import {
  mkdir,
  open,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type {
  AnalysisRoot,
  CodeAnalysisScope,
  CodeAnalysisSettings,
  CodeAnalysisSnapshot,
  ParsedSourceFile
} from "./model";
import { BUILTIN_ANALYSIS_PROFILE_VERSIONS } from "./profiles/registry";

const CACHE_SCHEMA_VERSION = 3;
const SNAPSHOT_CACHE_SCHEMA_VERSION = 4;
const SNAPSHOT_POINTER_SCHEMA_VERSION = 1;
const PARSER_VERSION = 12;
const GRAPH_VERSION = 13;
export const MAX_ANALYSIS_INDEX_CACHE_BYTES =
  128 * 1_024 * 1_024;
export const MAX_ANALYSIS_SNAPSHOT_BYTES =
  112 * 1_024 * 1_024;
export const MAX_ANALYSIS_SNAPSHOT_PAYLOAD_BYTES =
  104 * 1_024 * 1_024;
const CACHE_READ_CHUNK_BYTES = 64 * 1_024;

interface CachedFile {
  fingerprint: string;
  parsed: ParsedSourceFile;
}

export interface AnalysisCacheDocument {
  schemaVersion: typeof CACHE_SCHEMA_VERSION;
  settingsKey: string;
  fullIndexComplete: boolean;
  semanticIndexComplete: boolean;
  fullIndexRevisions: Record<string, string>;
  lastFullIndexAt?: string;
  files: Record<string, CachedFile>;
  updatedAt: string;
}

export class AnalysisCache {
  readonly #filePath: string;

  constructor(
    cacheDirectory: string,
    workspaceId: string
  ) {
    this.#filePath = join(
      codeAnalysisWorkspaceCacheDirectory(
        cacheDirectory,
        workspaceId
      ),
      "index.json"
    );
  }

  async load(
    settings: CodeAnalysisSettings,
    roots: AnalysisRoot[]
  ): Promise<AnalysisCacheDocument> {
    const empty = createEmptyCache(settings, roots);
    const raw = await readBoundedTextFile(
      this.#filePath,
      MAX_ANALYSIS_INDEX_CACHE_BYTES
    );
    if (raw === null) {
      return empty;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isCacheDocument(parsed)) {
        return empty;
      }
      if (parsed.settingsKey !== settingsKey(settings, roots)) {
        return empty;
      }
      return parsed;
    } catch {
      return empty;
    }
  }

  async save(document: AnalysisCacheDocument): Promise<void> {
    await mkdir(dirname(this.#filePath), {
      recursive: true
    });
    const temporaryPath = `${this.#filePath}.${process.pid}.tmp`;
    const serialized = JSON.stringify(document);
    assertSerializedSize(
      serialized,
      MAX_ANALYSIS_INDEX_CACHE_BYTES,
      "Code analysis index cache"
    );
    await writeFile(
      temporaryPath,
      serialized,
      "utf8"
    );
    await rm(this.#filePath, { force: true });
    await rename(temporaryPath, this.#filePath);
  }
}

interface AnalysisSnapshotDocument {
  schemaVersion: typeof SNAPSHOT_CACHE_SCHEMA_VERSION;
  workspaceId: string;
  configurationKey: string;
  savedAt: string;
  snapshot: CodeAnalysisSnapshot;
}

interface AnalysisSnapshotPointerDocument {
  schemaVersion: typeof SNAPSHOT_POINTER_SCHEMA_VERSION;
  scope: CodeAnalysisScope;
  savedAt: string;
}

interface LoadedAnalysisSnapshot {
  snapshot: CodeAnalysisSnapshot;
  savedAt: string;
  source: "scoped" | "legacy";
  pointerNeedsRepair: boolean;
}

export interface CodeAnalysisSnapshotStore {
  load(
    workspaceId: string,
    settings: CodeAnalysisSettings,
    roots: AnalysisRoot[],
    scope?: CodeAnalysisScope
  ): Promise<CodeAnalysisSnapshot | null>;
  save(
    snapshot: CodeAnalysisSnapshot,
    settings: CodeAnalysisSettings
  ): Promise<void>;
}

export function assertCodeAnalysisSnapshotPayloadSize(
  snapshot: CodeAnalysisSnapshot
): void {
  assertSerializedSize(
    JSON.stringify(snapshot),
    MAX_ANALYSIS_SNAPSHOT_PAYLOAD_BYTES,
    "Code analysis snapshot payload"
  );
}

export interface AnalysisSnapshotCacheOptions {
  fallbackDirectories?: readonly string[];
}

export class AnalysisSnapshotCache
  implements CodeAnalysisSnapshotStore
{
  readonly #cacheDirectory: string;
  readonly #fallbackDirectories: string[];

  constructor(
    cacheDirectory: string,
    options: AnalysisSnapshotCacheOptions = {}
  ) {
    this.#cacheDirectory = cacheDirectory;
    const primaryDirectory = canonicalPath(cacheDirectory);
    this.#fallbackDirectories = [
      ...new Set(
        (options.fallbackDirectories ?? []).filter(
          (directory) =>
            canonicalPath(directory) !== primaryDirectory
        )
      )
    ];
  }

  async load(
    workspaceId: string,
    settings: CodeAnalysisSettings,
    roots: AnalysisRoot[],
    scope?: CodeAnalysisScope
  ): Promise<CodeAnalysisSnapshot | null> {
    const primary = await loadSnapshotFromDirectory(
      this.#cacheDirectory,
      workspaceId,
      settings,
      roots,
      scope
    );
    if (primary) {
      if (primary.source === "legacy") {
        await saveSnapshotToDirectory(
          this.#cacheDirectory,
          primary.snapshot,
          settings,
          primary.savedAt
        ).catch(() => undefined);
      } else if (
        scope === undefined &&
        primary.pointerNeedsRepair
      ) {
        await saveSnapshotPointer(
          this.#cacheDirectory,
          workspaceId,
          primary.snapshot.scope,
          primary.savedAt
        ).catch(() => undefined);
      }
      return structuredClone(primary.snapshot);
    }

    for (const directory of this.#fallbackDirectories) {
      const fallback = await loadSnapshotFromDirectory(
        directory,
        workspaceId,
        settings,
        roots,
        scope
      );
      if (!fallback) {
        continue;
      }
      await saveSnapshotToDirectory(
        this.#cacheDirectory,
        fallback.snapshot,
        settings,
        fallback.savedAt
      ).catch(() => undefined);
      return structuredClone(fallback.snapshot);
    }
    return null;
  }

  async save(
    snapshot: CodeAnalysisSnapshot,
    settings: CodeAnalysisSettings
  ): Promise<void> {
    await saveSnapshotToDirectory(
      this.#cacheDirectory,
      snapshot,
      settings,
      new Date().toISOString()
    );
  }
}

async function loadSnapshotFromDirectory(
  cacheDirectory: string,
  workspaceId: string,
  settings: CodeAnalysisSettings,
  roots: AnalysisRoot[],
  requestedScope?: CodeAnalysisScope
): Promise<LoadedAnalysisSnapshot | null> {
  const pointer = requestedScope
    ? null
    : await loadSnapshotPointer(
        cacheDirectory,
        workspaceId
      );
  const scopes = requestedScope
    ? [requestedScope]
    : await orderedSnapshotScopes(
        cacheDirectory,
        workspaceId,
        pointer?.scope
      );

  for (const scope of scopes) {
    const document = await loadSnapshotDocument(
      scopedSnapshotFilePath(
        cacheDirectory,
        workspaceId,
        scope
      ),
      workspaceId,
      settings,
      roots,
      scope
    );
    if (document) {
      return {
        snapshot: document.snapshot,
        savedAt: document.savedAt,
        source: "scoped",
        pointerNeedsRepair:
          requestedScope === undefined &&
          pointer?.scope !== document.snapshot.scope
      };
    }
  }

  const legacy = await loadSnapshotDocument(
    legacySnapshotFilePath(
      cacheDirectory,
      workspaceId
    ),
    workspaceId,
    settings,
    roots,
    requestedScope
  );
  return legacy
    ? {
        snapshot: legacy.snapshot,
        savedAt: legacy.savedAt,
        source: "legacy",
        pointerNeedsRepair: true
      }
    : null;
}

async function loadSnapshotDocument(
  filePath: string,
  workspaceId: string,
  settings: CodeAnalysisSettings,
  roots: AnalysisRoot[],
  scope?: CodeAnalysisScope
): Promise<AnalysisSnapshotDocument | null> {
  const raw = await readBoundedTextFile(
    filePath,
    MAX_ANALYSIS_SNAPSHOT_BYTES
  );
  if (raw === null) {
    return null;
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (
      !isSnapshotDocument(value) ||
      value.workspaceId !== workspaceId ||
      value.configurationKey !==
        codeAnalysisSnapshotConfigurationKey(
          settings,
          roots
        ) ||
      value.snapshot.workspaceId !== workspaceId ||
      (scope !== undefined &&
        value.snapshot.scope !== scope) ||
      !analysisRootsMatch(value.snapshot.roots, roots)
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

async function loadSnapshotPointer(
  cacheDirectory: string,
  workspaceId: string
): Promise<AnalysisSnapshotPointerDocument | null> {
  const raw = await readBoundedTextFile(
    snapshotPointerFilePath(
      cacheDirectory,
      workspaceId
    ),
    CACHE_READ_CHUNK_BYTES
  );
  if (raw === null) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as unknown;
    return isSnapshotPointerDocument(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

async function orderedSnapshotScopes(
  cacheDirectory: string,
  workspaceId: string,
  latestScope?: CodeAnalysisScope
): Promise<CodeAnalysisScope[]> {
  const scopes: CodeAnalysisScope[] = [
    "workspace",
    "changed"
  ];
  if (latestScope) {
    return [
      latestScope,
      ...scopes.filter((scope) => scope !== latestScope)
    ];
  }
  const candidates = await Promise.all(
    scopes.map(async (scope) => {
      try {
        const details = await stat(
          scopedSnapshotFilePath(
            cacheDirectory,
            workspaceId,
            scope
          )
        );
        return {
          scope,
          modifiedAtMs: details.isFile()
            ? details.mtimeMs
            : Number.NEGATIVE_INFINITY
        };
      } catch {
        return {
          scope,
          modifiedAtMs: Number.NEGATIVE_INFINITY
        };
      }
    })
  );
  return candidates
    .sort(
      (left, right) =>
        right.modifiedAtMs - left.modifiedAtMs
    )
    .map((candidate) => candidate.scope);
}

async function saveSnapshotToDirectory(
  cacheDirectory: string,
  snapshot: CodeAnalysisSnapshot,
  settings: CodeAnalysisSettings,
  savedAt: string
): Promise<void> {
  const filePath = scopedSnapshotFilePath(
    cacheDirectory,
    snapshot.workspaceId,
    snapshot.scope
  );
  const serialized = JSON.stringify({
    schemaVersion: SNAPSHOT_CACHE_SCHEMA_VERSION,
    workspaceId: snapshot.workspaceId,
    configurationKey:
      codeAnalysisSnapshotConfigurationKey(
        settings,
        snapshot.roots
      ),
    savedAt,
    snapshot
  } satisfies AnalysisSnapshotDocument);
  assertSerializedSize(
    serialized,
    MAX_ANALYSIS_SNAPSHOT_BYTES,
    "Code analysis snapshot"
  );
  await writeTextFileAtomically(filePath, serialized);
  await saveSnapshotPointer(
    cacheDirectory,
    snapshot.workspaceId,
    snapshot.scope,
    savedAt
  );
}

async function saveSnapshotPointer(
  cacheDirectory: string,
  workspaceId: string,
  scope: CodeAnalysisScope,
  savedAt: string
): Promise<void> {
  await writeTextFileAtomically(
    snapshotPointerFilePath(
      cacheDirectory,
      workspaceId
    ),
    JSON.stringify({
      schemaVersion: SNAPSHOT_POINTER_SCHEMA_VERSION,
      scope,
      savedAt
    } satisfies AnalysisSnapshotPointerDocument)
  );
}

async function writeTextFileAtomically(
  filePath: string,
  content: string
): Promise<void> {
  await mkdir(dirname(filePath), {
    recursive: true
  });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(
      () => undefined
    );
    throw error;
  }
}

function createEmptyCache(
  settings: CodeAnalysisSettings,
  roots: AnalysisRoot[] = []
): AnalysisCacheDocument {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    settingsKey: settingsKey(settings, roots),
    fullIndexComplete: false,
    semanticIndexComplete: false,
    fullIndexRevisions: {},
    files: {},
    updatedAt: new Date(0).toISOString()
  };
}

function settingsKey(
  settings: CodeAnalysisSettings,
  roots: AnalysisRoot[]
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        parserVersion: PARSER_VERSION,
        profiles: BUILTIN_ANALYSIS_PROFILE_VERSIONS,
        maxTotalSourceBytes: settings.maxTotalSourceBytes,
        maxFiles: settings.maxFiles,
        maxFileSizeBytes: settings.maxFileSizeBytes,
        ignoreDirectories: [...settings.ignoreDirectories].sort(),
        roots: roots
          .map((root) => ({
            repositoryId: root.repositoryId,
            worktreeId: root.worktreeId,
            path: canonicalPath(root.path)
          }))
          .sort((left, right) =>
            `${left.repositoryId}\0${left.worktreeId}\0${left.path}`.localeCompare(
              `${right.repositoryId}\0${right.worktreeId}\0${right.path}`
            )
          )
      })
    )
    .digest("hex");
}

export function codeAnalysisSnapshotConfigurationKey(
  settings: CodeAnalysisSettings,
  roots: AnalysisRoot[]
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        snapshotVersion: SNAPSHOT_CACHE_SCHEMA_VERSION,
        parserVersion: PARSER_VERSION,
        graphVersion: GRAPH_VERSION,
        profiles: BUILTIN_ANALYSIS_PROFILE_VERSIONS,
        maxTotalSourceBytes: settings.maxTotalSourceBytes,
        maxFiles: settings.maxFiles,
        maxFileSizeBytes: settings.maxFileSizeBytes,
        ignoreDirectories: [...settings.ignoreDirectories].sort(),
        graphDepth: settings.graphDepth,
        maxGraphNodes: settings.maxGraphNodes,
        maxGraphEdges: settings.maxGraphEdges,
        maxRequestChains: settings.maxRequestChains,
        maxDiagnostics: settings.maxDiagnostics,
        staticFallback: settings.staticFallback,
        lspTimeoutMs: settings.lspTimeoutMs,
        languageServers:
          codeAnalysisLanguageServerConfiguration(settings),
        roots: roots
          .map((root) => ({
            repositoryId: root.repositoryId,
            worktreeId: root.worktreeId,
            path: canonicalPath(root.path),
            revision: root.revision ?? ""
          }))
          .sort((left, right) =>
            `${left.repositoryId}\0${left.worktreeId}\0${left.path}\0${left.revision}`.localeCompare(
              `${right.repositoryId}\0${right.worktreeId}\0${right.path}\0${right.revision}`
            )
          )
      })
    )
    .digest("hex");
}

function codeAnalysisLanguageServerConfiguration(
  settings: CodeAnalysisSettings
): Record<
  string,
  {
    enabled: boolean;
    command: string;
    args: string[];
    maxDocuments: number;
    maxSymbolsPerDocument: number;
    maxCallHierarchyRequests: number;
    maxTypeHierarchyRequests: number;
    maxReferenceRequests: number;
    maxDocumentationRequests: number;
    maxReferencesPerSymbol: number;
  } | null
> {
  return Object.fromEntries(
    (
      [
        "typescript",
        "vue",
        "java",
        "python",
        "go",
        "kotlin",
        "csharp",
        "rust"
      ] as const
    ).map((language) => {
      const server = settings[language];
      return [
        language,
        server
          ? {
              enabled: server.enabled,
              command: server.command,
              args: [...server.args],
              maxDocuments: server.maxDocuments,
              maxSymbolsPerDocument:
                server.maxSymbolsPerDocument,
              maxCallHierarchyRequests:
                server.maxCallHierarchyRequests,
              maxTypeHierarchyRequests:
                server.maxTypeHierarchyRequests ??
                server.maxCallHierarchyRequests,
              maxReferenceRequests:
                server.maxReferenceRequests,
              maxDocumentationRequests:
                server.maxDocumentationRequests,
              maxReferencesPerSymbol:
                server.maxReferencesPerSymbol
            }
          : null
      ];
    })
  );
}

function canonicalPath(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32"
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

async function readBoundedTextFile(
  filePath: string,
  maximumBytes: number
): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, "r");
    const details = await handle.stat();
    if (
      !details.isFile() ||
      details.size > maximumBytes
    ) {
      return null;
    }
    const chunk = Buffer.allocUnsafe(
      Math.min(
        CACHE_READ_CHUNK_BYTES,
        maximumBytes + 1
      )
    );
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      const remainingBytes = maximumBytes - totalBytes;
      const { bytesRead } = await handle.read(
        chunk,
        0,
        Math.min(chunk.length, remainingBytes + 1),
        null
      );
      if (bytesRead === 0) {
        break;
      }
      totalBytes += bytesRead;
      if (totalBytes > maximumBytes) {
        return null;
      }
      chunks.push(
        Buffer.from(chunk.subarray(0, bytesRead))
      );
    }
    return Buffer.concat(chunks, totalBytes).toString("utf8");
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function assertSerializedSize(
  serialized: string,
  maximumBytes: number,
  label: string
): void {
  const size = Buffer.byteLength(serialized, "utf8");
  if (size > maximumBytes) {
    throw new Error(
      `${label} exceeded the ${maximumBytes}-byte safety limit.`
    );
  }
}

function analysisRootsMatch(
  left: AnalysisRoot[],
  right: AnalysisRoot[]
): boolean {
  const toKeys = (roots: AnalysisRoot[]) =>
    roots
      .map(
        (root) =>
          `${root.repositoryId}\0${root.worktreeId}\0${canonicalPath(
            root.path
          )}\0${root.revision ?? ""}`
      )
      .sort();
  const leftKeys = toKeys(left);
  const rightKeys = toKeys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (root, index) => root === rightKeys[index]
    )
  );
}

export function codeAnalysisWorkspaceCacheDirectory(
  cacheDirectory: string,
  workspaceId: string
): string {
  const key = createHash("sha256")
    .update(workspaceId)
    .digest("hex")
    .slice(0, 24);
  return join(cacheDirectory, key);
}

function scopedSnapshotFilePath(
  cacheDirectory: string,
  workspaceId: string,
  scope: CodeAnalysisScope
): string {
  return join(
    codeAnalysisWorkspaceCacheDirectory(
      cacheDirectory,
      workspaceId
    ),
    `snapshot-${scope}.json`
  );
}

function legacySnapshotFilePath(
  cacheDirectory: string,
  workspaceId: string
): string {
  return join(
    codeAnalysisWorkspaceCacheDirectory(
      cacheDirectory,
      workspaceId
    ),
    "snapshot.json"
  );
}

function snapshotPointerFilePath(
  cacheDirectory: string,
  workspaceId: string
): string {
  return join(
    codeAnalysisWorkspaceCacheDirectory(
      cacheDirectory,
      workspaceId
    ),
    "snapshot-latest.json"
  );
}

function isCacheDocument(
  value: unknown
): value is AnalysisCacheDocument {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false;
  }
  const input = value as Record<string, unknown>;
  const files = input.files;
  return (
    input.schemaVersion === CACHE_SCHEMA_VERSION &&
    typeof input.settingsKey === "string" &&
    typeof input.fullIndexComplete === "boolean" &&
    typeof input.semanticIndexComplete === "boolean" &&
    isStringRecord(input.fullIndexRevisions) &&
    (input.lastFullIndexAt === undefined ||
      typeof input.lastFullIndexAt === "string") &&
    isRecord(files) &&
    Object.entries(files).every(([path, cached]) =>
      isCachedFile(path, cached)
    ) &&
    typeof input.updatedAt === "string"
  );
}

function isSnapshotDocument(
  value: unknown
): value is AnalysisSnapshotDocument {
  return (
    isRecord(value) &&
    value.schemaVersion === SNAPSHOT_CACHE_SCHEMA_VERSION &&
    typeof value.workspaceId === "string" &&
    typeof value.configurationKey === "string" &&
    typeof value.savedAt === "string" &&
    isCodeAnalysisSnapshot(value.snapshot)
  );
}

function isSnapshotPointerDocument(
  value: unknown
): value is AnalysisSnapshotPointerDocument {
  return (
    isRecord(value) &&
    value.schemaVersion === SNAPSHOT_POINTER_SCHEMA_VERSION &&
    (value.scope === "changed" ||
      value.scope === "workspace") &&
    typeof value.savedAt === "string"
  );
}

function isCodeAnalysisSnapshot(
  value: unknown
): value is CodeAnalysisSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schemaVersion === 1 &&
    typeof value.analysisId === "string" &&
    typeof value.workspaceId === "string" &&
    (value.scope === "changed" ||
      value.scope === "workspace") &&
    typeof value.generatedAt === "string" &&
    Array.isArray(value.roots) &&
    value.roots.every(isAnalysisRoot) &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isCodeGraphNode) &&
    Array.isArray(value.edges) &&
    value.edges.every(isCodeGraphEdge) &&
    Array.isArray(value.requestChains) &&
    value.requestChains.every(isCodeRequestChain) &&
    Array.isArray(value.languageServers) &&
    value.languageServers.every(isLanguageServerStatus) &&
    (value.indexStatus === undefined ||
      isCodeAnalysisIndexStatus(value.indexStatus)) &&
    (value.diagnostics === undefined ||
      (Array.isArray(value.diagnostics) &&
        value.diagnostics.every(isCodeAnalysisDiagnostic))) &&
    Array.isArray(value.warnings) &&
    value.warnings.every(
      (warning) => typeof warning === "string"
    ) &&
    isCodeAnalysisStats(value.stats)
  );
}

function isAnalysisRoot(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.repositoryId === "string" &&
    typeof value.worktreeId === "string" &&
    typeof value.name === "string" &&
    typeof value.path === "string" &&
    (value.revision === undefined ||
      typeof value.revision === "string")
  );
}

function isCodeGraphNode(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isRecord(value.location) ||
    !isRecord(value.metadata)
  ) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    [
      "file",
      "module",
      "package",
      "class",
      "interface",
      "enum",
      "property",
      "function",
      "method",
      "client-request",
      "server-endpoint",
      "rpc-client",
      "rpc-handler"
    ].includes(String(value.kind)) &&
    typeof value.name === "string" &&
    typeof value.qualifiedName === "string" &&
    [
      "typescript",
      "javascript",
      "vue",
      "java",
      "python",
      "go",
      "kotlin",
      "csharp",
      "rust"
    ].includes(String(value.language)) &&
    isGraphLocation(value.location) &&
    typeof value.changed === "boolean" &&
    ["builtin", "lsp", "merged"].includes(
      String(value.source)
    ) &&
    isAnalysisConfidence(value.confidence) &&
    Object.values(value.metadata).every(
      (metadataValue) =>
        typeof metadataValue === "string" ||
        typeof metadataValue === "number" ||
        typeof metadataValue === "boolean"
    )
  );
}

function isGraphLocation(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.repositoryId === "string" &&
    typeof value.worktreeId === "string" &&
    typeof value.path === "string" &&
    isFiniteNumber(value.line) &&
    isFiniteNumber(value.column)
  );
}

function isCodeGraphEdge(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.from === "string" &&
    typeof value.to === "string" &&
    [
      "contains",
      "calls",
      "extends",
      "implements",
      "overrides",
      "http-request",
      "rpc-request",
      "references"
    ].includes(String(value.kind)) &&
    isAnalysisConfidence(value.confidence) &&
    (value.label === undefined ||
      typeof value.label === "string") &&
    (value.source === undefined ||
      value.source === "builtin" ||
      value.source === "lsp" ||
      value.source === "merged") &&
    (value.evidence === undefined ||
      typeof value.evidence === "string")
  );
}

function isCodeRequestChain(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.profileId === "web-http" ||
      value.profileId === "fai-cli-rpc") &&
    (value.transport === "http" ||
      value.transport === "rpc") &&
    typeof value.operationKey === "string" &&
    typeof value.method === "string" &&
    typeof value.route === "string" &&
    typeof value.title === "string" &&
    typeof value.clientNodeId === "string" &&
    typeof value.endpointNodeId === "string" &&
    Array.isArray(value.nodeIds) &&
    value.nodeIds.every(
      (nodeId) => typeof nodeId === "string"
    ) &&
    Array.isArray(value.edgeIds) &&
    value.edgeIds.every(
      (edgeId) => typeof edgeId === "string"
    ) &&
    typeof value.changed === "boolean" &&
    typeof value.ambiguous === "boolean" &&
    isAnalysisConfidence(value.confidence)
  );
}

function isLanguageServerStatus(value: unknown): boolean {
  return (
    isRecord(value) &&
    [
      "typescript",
      "vue",
      "java",
      "python",
      "go",
      "kotlin",
      "csharp",
      "rust"
    ].includes(String(value.language)) &&
    [
      "disabled",
      "connected",
      "unavailable",
      "failed"
    ].includes(String(value.state)) &&
    typeof value.command === "string" &&
    typeof value.message === "string" &&
    isFiniteNumber(value.symbolCount) &&
    (value.semanticCoverage === undefined ||
      value.semanticCoverage === "complete" ||
      value.semanticCoverage === "partial" ||
      value.semanticCoverage === "unavailable") &&
    isOptionalFiniteNumber(value.documentsTotal) &&
    isOptionalFiniteNumber(value.documentsAnalyzed) &&
    isOptionalFiniteNumber(value.skippedDocuments) &&
    isOptionalFiniteNumber(value.failedDocuments) &&
    isOptionalFiniteNumber(value.truncatedDocuments) &&
    (value.requestBudgetExhausted === undefined ||
      typeof value.requestBudgetExhausted === "boolean") &&
    (value.enrichmentStoppedEarly === undefined ||
      typeof value.enrichmentStoppedEarly === "boolean")
  );
}

function isCodeAnalysisStats(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.discoveredFiles) &&
    isFiniteNumber(value.analyzedFiles) &&
    isFiniteNumber(value.cachedFiles) &&
    isFiniteNumber(value.skippedFiles) &&
    isFiniteNumber(value.symbolCount) &&
    isFiniteNumber(value.edgeCount) &&
    isFiniteNumber(value.requestChainCount) &&
    typeof value.truncated === "boolean" &&
    isFiniteNumber(value.durationMs)
  );
}

function isAnalysisConfidence(value: unknown): boolean {
  return (
    value === "exact" ||
    value === "probable" ||
    value === "heuristic"
  );
}

function isCachedFile(
  path: string,
  value: unknown
): value is CachedFile {
  if (!isRecord(value) || !isRecord(value.parsed)) {
    return false;
  }
  const parsed = value.parsed;
  return (
    typeof value.fingerprint === "string" &&
    isAnalysisSourceFile(parsed.file, path) &&
    Array.isArray(parsed.symbols) &&
    parsed.symbols.every(isParsedSymbol) &&
    Array.isArray(parsed.clientRequests) &&
    parsed.clientRequests.every(isClientRequest) &&
    Array.isArray(parsed.serverEndpoints) &&
    parsed.serverEndpoints.every(isServerEndpoint) &&
    Array.isArray(parsed.remoteBoundaries) &&
    parsed.remoteBoundaries.every(isRemoteBoundary)
  );
}

function isAnalysisSourceFile(
  value: unknown,
  expectedCanonicalPath: string
): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.absolutePath === "string" &&
    typeof value.canonicalPath === "string" &&
    value.canonicalPath === expectedCanonicalPath &&
    typeof value.relativePath === "string" &&
    typeof value.repositoryId === "string" &&
    typeof value.worktreeId === "string" &&
    typeof value.rootPath === "string" &&
    (value.language === "typescript" ||
      value.language === "javascript" ||
      value.language === "vue" ||
      value.language === "java" ||
      value.language === "python" ||
      value.language === "go" ||
      value.language === "kotlin" ||
      value.language === "csharp" ||
      value.language === "rust") &&
    isFiniteNumber(value.size) &&
    isFiniteNumber(value.modifiedAtMs) &&
    typeof value.fingerprint === "string" &&
    typeof value.changed === "boolean"
  );
}

function isParsedSymbol(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.name === "string" &&
    typeof value.qualifiedName === "string" &&
    (value.kind === "module" ||
      value.kind === "package" ||
      value.kind === "class" ||
      value.kind === "interface" ||
      value.kind === "enum" ||
      value.kind === "property" ||
      value.kind === "function" ||
      value.kind === "method") &&
    isFiniteNumber(value.line) &&
    isFiniteNumber(value.endLine) &&
    (value.selectionCharacter === undefined ||
      isFiniteNumber(value.selectionCharacter)) &&
    (value.parentQualifiedName === undefined ||
      typeof value.parentQualifiedName === "string") &&
    (value.packageName === undefined ||
      typeof value.packageName === "string") &&
    (value.signature === undefined ||
      typeof value.signature === "string") &&
    (value.semanticId === undefined ||
      typeof value.semanticId === "string") &&
    (value.documentation === undefined ||
      typeof value.documentation === "string") &&
    Array.isArray(value.calls) &&
    value.calls.every(isParsedCall) &&
    (value.references === undefined ||
      (Array.isArray(value.references) &&
        value.references.every(isParsedReference))) &&
    (value.semanticRelations === undefined ||
      (Array.isArray(value.semanticRelations) &&
        value.semanticRelations.every(
          isParsedSemanticRelation
        ))) &&
    (value.source === "builtin" ||
      value.source === "lsp" ||
      value.source === "merged")
  );
}

function isParsedSemanticRelation(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.kind === "extends" ||
      value.kind === "implements" ||
      value.kind === "overrides") &&
    typeof value.targetName === "string" &&
    (value.targetCanonicalPath === undefined ||
      typeof value.targetCanonicalPath === "string") &&
    (value.targetLine === undefined ||
      isFiniteNumber(value.targetLine)) &&
    value.source === "lsp" &&
    typeof value.evidence === "string"
  );
}

function isParsedCall(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    (value.receiver === undefined ||
      typeof value.receiver === "string") &&
    (value.receiverType === undefined ||
      typeof value.receiverType === "string") &&
    isFiniteNumber(value.line) &&
    (value.targetCanonicalPath === undefined ||
      typeof value.targetCanonicalPath === "string") &&
    (value.targetLine === undefined ||
      isFiniteNumber(value.targetLine)) &&
    (value.source === undefined ||
      value.source === "builtin" ||
      value.source === "lsp" ||
      value.source === "merged") &&
    (value.evidence === undefined ||
      typeof value.evidence === "string")
  );
}

function isParsedReference(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const hasQualifiedTarget =
    typeof value.targetQualifiedName === "string";
  const hasLocationTarget =
    typeof value.targetCanonicalPath === "string" &&
    isFiniteNumber(value.targetLine);
  return (
    typeof value.name === "string" &&
    isFiniteNumber(value.line) &&
    (value.targetQualifiedName === undefined ||
      typeof value.targetQualifiedName === "string") &&
    (value.targetCanonicalPath === undefined ||
      typeof value.targetCanonicalPath === "string") &&
    (value.targetLine === undefined ||
      isFiniteNumber(value.targetLine)) &&
    (hasQualifiedTarget || hasLocationTarget) &&
    (value.source === "builtin" ||
      value.source === "lsp" ||
      value.source === "merged") &&
    typeof value.evidence === "string"
  );
}

function isCodeAnalysisIndexStatus(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.fullIndexAvailable === "boolean" &&
    (value.resultCompleteness === "complete" ||
      value.resultCompleteness === "partial") &&
    (value.impactCoverage === "confirmed" ||
      value.impactCoverage === "possible-omissions") &&
    (value.lastFullIndexAt === undefined ||
      typeof value.lastFullIndexAt === "string") &&
    typeof value.message === "string"
  );
}

function isCodeAnalysisDiagnostic(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    [
      "partial-index",
      "unresolved-call",
      "unmatched-request",
      "unmatched-rpc",
      "ambiguous-target"
    ].includes(String(value.kind)) &&
    (value.severity === "info" ||
      value.severity === "warning") &&
    typeof value.message === "string" &&
    typeof value.evidence === "string" &&
    (value.nodeId === undefined ||
      typeof value.nodeId === "string") &&
    Array.isArray(value.relatedNodeIds) &&
    value.relatedNodeIds.every(
      (nodeId) => typeof nodeId === "string"
    )
  );
}

function isClientRequest(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.method === "string" &&
    typeof value.route === "string" &&
    typeof value.rawRoute === "string" &&
    isFiniteNumber(value.line) &&
    (value.containerQualifiedName === undefined ||
      typeof value.containerQualifiedName === "string") &&
    (value.documentation === undefined ||
      typeof value.documentation === "string")
  );
}

function isServerEndpoint(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.method === "string" &&
    typeof value.route === "string" &&
    typeof value.rawRoute === "string" &&
    isFiniteNumber(value.line) &&
    (value.symbolQualifiedName === undefined ||
      typeof value.symbolQualifiedName === "string") &&
    typeof value.annotation === "string"
  );
}

function isRemoteBoundary(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.profileId === "fai-cli-rpc" &&
    value.transport === "rpc" &&
    (value.role === "client" || value.role === "server") &&
    typeof value.operationKey === "string" &&
    typeof value.operationName === "string" &&
    typeof value.serviceKey === "string" &&
    typeof value.rawOperation === "string" &&
    typeof value.wrapperId === "string" &&
    isFiniteNumber(value.line) &&
    (value.symbolQualifiedName === undefined ||
      typeof value.symbolQualifiedName === "string") &&
    isAnalysisConfidence(value.confidence)
  );
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return Boolean(
    value && typeof value === "object" && !Array.isArray(value)
  );
}

function isStringRecord(
  value: unknown
): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (item) => typeof item === "string"
    )
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}
