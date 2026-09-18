import {
  createHash,
  randomUUID
} from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type {
  AnalysisRoot,
  CodeAnalysisSettings,
  CodeAnalysisSnapshot,
  ParsedSourceFile
} from "./model";
import { BUILTIN_ANALYSIS_PROFILE_VERSIONS } from "./profiles/registry";

const CACHE_SCHEMA_VERSION = 1;
const SNAPSHOT_CACHE_SCHEMA_VERSION = 2;
const PARSER_VERSION = 8;
const GRAPH_VERSION = 7;

interface CachedFile {
  fingerprint: string;
  parsed: ParsedSourceFile;
}

export interface AnalysisCacheDocument {
  schemaVersion: typeof CACHE_SCHEMA_VERSION;
  settingsKey: string;
  fullIndexComplete: boolean;
  files: Record<string, CachedFile>;
  updatedAt: string;
}

export class AnalysisCache {
  readonly #filePath: string;

  constructor(
    cacheDirectory: string,
    workspaceId: string,
    entryId: string
  ) {
    this.#filePath = join(
      cacheEntryDirectory(
        cacheDirectory,
        workspaceId,
        entryId
      ),
      "index.json"
    );
  }

  async load(
    settings: CodeAnalysisSettings,
    roots: AnalysisRoot[]
  ): Promise<AnalysisCacheDocument> {
    const empty = createEmptyCache(settings, roots);
    let raw: string;
    try {
      raw = await readFile(this.#filePath, "utf8");
    } catch {
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
    await writeFile(
      temporaryPath,
      JSON.stringify(document),
      "utf8"
    );
    await rm(this.#filePath, { force: true });
    await rename(temporaryPath, this.#filePath);
  }
}

interface AnalysisSnapshotDocument {
  schemaVersion: typeof SNAPSHOT_CACHE_SCHEMA_VERSION;
  workspaceId: string;
  entryId: string;
  configurationKey: string;
  savedAt: string;
  snapshot: CodeAnalysisSnapshot;
}

export interface CodeAnalysisSnapshotStore {
  load(
    workspaceId: string,
    entryId: string,
    settings: CodeAnalysisSettings,
    roots: AnalysisRoot[]
  ): Promise<CodeAnalysisSnapshot | null>;
  save(
    snapshot: CodeAnalysisSnapshot,
    settings: CodeAnalysisSettings
  ): Promise<void>;
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
    entryId: string,
    settings: CodeAnalysisSettings,
    roots: AnalysisRoot[]
  ): Promise<CodeAnalysisSnapshot | null> {
    const primary = await loadSnapshotFromDirectory(
      this.#cacheDirectory,
      workspaceId,
      entryId,
      settings,
      roots
    );
    if (primary) {
      return primary;
    }

    for (const directory of this.#fallbackDirectories) {
      const fallback = await loadSnapshotFromDirectory(
        directory,
        workspaceId,
        entryId,
        settings,
        roots
      );
      if (!fallback) {
        continue;
      }
      await this.save(fallback, settings).catch(
        () => undefined
      );
      return fallback;
    }
    return null;
  }

  async save(
    snapshot: CodeAnalysisSnapshot,
    settings: CodeAnalysisSettings
  ): Promise<void> {
    const filePath = snapshotFilePath(
      this.#cacheDirectory,
      snapshot.workspaceId,
      snapshot.entryId
    );
    await mkdir(dirname(filePath), {
      recursive: true
    });
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporaryPath,
        JSON.stringify({
          schemaVersion: SNAPSHOT_CACHE_SCHEMA_VERSION,
          workspaceId: snapshot.workspaceId,
          entryId: snapshot.entryId,
          configurationKey: codeAnalysisSnapshotConfigurationKey(
            settings,
            snapshot.roots
          ),
          savedAt: new Date().toISOString(),
          snapshot
        } satisfies AnalysisSnapshotDocument),
        "utf8"
      );
      await rename(temporaryPath, filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(
        () => undefined
      );
      throw error;
    }
  }
}

async function loadSnapshotFromDirectory(
  cacheDirectory: string,
  workspaceId: string,
  entryId: string,
  settings: CodeAnalysisSettings,
  roots: AnalysisRoot[]
): Promise<CodeAnalysisSnapshot | null> {
  let raw: string;
  try {
    raw = await readFile(
      snapshotFilePath(
        cacheDirectory,
        workspaceId,
        entryId
      ),
      "utf8"
    );
  } catch {
    return null;
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (
      !isSnapshotDocument(value) ||
      value.workspaceId !== workspaceId ||
      value.entryId !== entryId ||
      value.configurationKey !==
        codeAnalysisSnapshotConfigurationKey(
          settings,
          roots
        ) ||
      value.snapshot.workspaceId !== workspaceId ||
      value.snapshot.entryId !== entryId ||
      !analysisRootsMatch(value.snapshot.roots, roots)
    ) {
      return null;
    }
    return structuredClone(value.snapshot);
  } catch {
    return null;
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
        maxFiles: settings.maxFiles,
        maxFileSizeBytes: settings.maxFileSizeBytes,
        ignoreDirectories: [...settings.ignoreDirectories].sort(),
        graphDepth: settings.graphDepth,
        staticFallback: settings.staticFallback,
        lspTimeoutMs: settings.lspTimeoutMs,
        typescript: {
          enabled: settings.typescript.enabled,
          command: settings.typescript.command,
          args: [...settings.typescript.args]
        },
        java: {
          enabled: settings.java.enabled,
          command: settings.java.command,
          args: [...settings.java.args]
        },
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

function canonicalPath(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32"
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
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
          )}`
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

function cacheEntryDirectory(
  cacheDirectory: string,
  workspaceId: string,
  entryId: string
): string {
  const key = createHash("sha256")
    .update(`${workspaceId}\0${entryId}`)
    .digest("hex")
    .slice(0, 24);
  return join(cacheDirectory, key);
}

function snapshotFilePath(
  cacheDirectory: string,
  workspaceId: string,
  entryId: string
): string {
  return join(
    cacheEntryDirectory(
      cacheDirectory,
      workspaceId,
      entryId
    ),
    "snapshot.json"
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
    typeof value.entryId === "string" &&
    typeof value.configurationKey === "string" &&
    typeof value.savedAt === "string" &&
    isCodeAnalysisSnapshot(value.snapshot)
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
    typeof value.entryId === "string" &&
    typeof value.entryName === "string" &&
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
    typeof value.path === "string"
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
      "class",
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
      "java"
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
      "http-request",
      "rpc-request",
      "references"
    ].includes(String(value.kind)) &&
    isAnalysisConfidence(value.confidence) &&
    (value.label === undefined ||
      typeof value.label === "string")
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
    (value.language === "typescript" ||
      value.language === "java") &&
    [
      "disabled",
      "connected",
      "unavailable",
      "failed"
    ].includes(String(value.state)) &&
    typeof value.command === "string" &&
    typeof value.message === "string" &&
    isFiniteNumber(value.symbolCount)
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
      value.language === "java") &&
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
    (value.kind === "class" ||
      value.kind === "function" ||
      value.kind === "method") &&
    isFiniteNumber(value.line) &&
    isFiniteNumber(value.endLine) &&
    (value.parentQualifiedName === undefined ||
      typeof value.parentQualifiedName === "string") &&
    (value.documentation === undefined ||
      typeof value.documentation === "string") &&
    Array.isArray(value.calls) &&
    value.calls.every(isParsedCall) &&
    (value.source === "builtin" ||
      value.source === "lsp" ||
      value.source === "merged")
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
      isFiniteNumber(value.targetLine))
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
