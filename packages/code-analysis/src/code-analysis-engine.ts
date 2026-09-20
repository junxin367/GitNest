import { resolve } from "node:path";

import {
  AnalysisCache,
  assertCodeAnalysisSnapshotPayloadSize,
  type AnalysisCacheDocument
} from "./analysis-cache";
import { buildCodeGraph } from "./graph-builder";
import { ExternalLanguageServerPool } from "./lsp-client";
import type {
  CodeAnalysisInput,
  CodeAnalysisSnapshot,
  LspDocumentSymbol,
  ParsedSourceFile,
  ParsedSymbol
} from "./model";
import { discoverSourceFiles } from "./source-inventory";
import { parseSourceFile } from "./source-parser";
import { readBoundedSourceFile } from "./source-reader";

interface SourceDocument {
  file: ParsedSourceFile["file"];
  content: string;
}

const MAX_SNAPSHOT_WARNINGS = 100;
const MAX_GRAPH_NODES = 20_000;
const MAX_GRAPH_EDGES = 60_000;
const MAX_REQUEST_CHAINS = 5_000;

export class CodeAnalysisEngine {
  readonly #lspPool: ExternalLanguageServerPool;

  constructor(
    lspPool: ExternalLanguageServerPool =
      new ExternalLanguageServerPool()
  ) {
    this.#lspPool = lspPool;
  }

  async analyze(
    input: CodeAnalysisInput
  ): Promise<CodeAnalysisSnapshot> {
    const startedAt = Date.now();
    throwIfAborted(input.signal);
    input.onProgress?.({
      stage: "discovering",
      completed: 0,
      total: 1,
      message:
        input.scope === "changed"
          ? "正在读取 Git 变动文件"
          : "正在发现 Workspace 源文件"
    });
    const inventory = await discoverSourceFiles({
      roots: input.roots,
      changedPaths: input.changedPaths,
      scope: input.scope,
      settings: input.settings,
      ...(input.signal ? { signal: input.signal } : {})
    });
    input.onProgress?.({
      stage: "discovering",
      completed: 1,
      total: 1,
      message: `已发现 ${inventory.files.length} 个可分析文件`
    });

    const cache = new AnalysisCache(
      input.cacheDirectory,
      input.workspaceId,
      input.entryId
    );
    const cacheDocument = await cache.load(
      input.settings,
      input.roots
    );
    const parsedByPath = new Map<string, ParsedSourceFile>();
    const builtinCacheOverrides = new Map<
      string,
      ParsedSourceFile
    >();
    let cachedFiles = 0;
    let completedReads = 0;
    let suppressedWarningCount = Math.max(
      0,
      inventory.warnings.length - MAX_SNAPSHOT_WARNINGS
    );
    const readFailurePaths = new Set<string>();
    const documents: SourceDocument[] = [];
    const warnings = inventory.warnings.slice(
      0,
      MAX_SNAPSHOT_WARNINGS
    );
    const addWarning = (warning: string) => {
      if (warnings.length < MAX_SNAPSHOT_WARNINGS) {
        warnings.push(warning);
      } else {
        suppressedWarningCount += 1;
      }
    };
    const filesToRead = inventory.files.filter((file) => {
      const cached = cacheDocument.files[file.canonicalPath];
      if (cached?.fingerprint === file.fingerprint) {
        parsedByPath.set(file.canonicalPath, {
          ...cached.parsed,
          file: {
            ...cached.parsed.file,
            ...file,
            changed: file.changed
          }
        });
        cachedFiles += 1;
        return false;
      }
      return true;
    });

    input.onProgress?.({
      stage: "reading",
      completed: 0,
      total: filesToRead.length,
      message: "正在读取源文件"
    });
    await runConcurrent(
      filesToRead,
      input.settings.readConcurrency,
      async (file) => {
        throwIfAborted(input.signal);
        try {
          const content = await readBoundedSourceFile(
            file,
            input.settings.maxFileSizeBytes
          );
          documents.push({ file, content });
        } catch (error) {
          readFailurePaths.add(file.canonicalPath);
          addWarning(
            `无法读取源文件 ${file.relativePath}：${errorMessage(
              error
            )}`
          );
        }
        completedReads += 1;
        input.onProgress?.({
          stage: "reading",
          completed: completedReads,
          total: filesToRead.length,
          message: file.relativePath
        });
      }
    );

    input.onProgress?.({
      stage: "parsing",
      completed: 0,
      total: documents.length,
      message: "正在建立内置代码索引"
    });
    for (let index = 0; index < documents.length; index += 1) {
      throwIfAborted(input.signal);
      const document = documents[index];
      if (!document) {
        continue;
      }
      const parsed = parseSourceFile(
        document.file,
        document.content
      );
      parsedByPath.set(
        document.file.canonicalPath,
        parsed
      );
      input.onProgress?.({
        stage: "parsing",
        completed: index + 1,
        total: documents.length,
        message: document.file.relativePath
      });
      if (index % 25 === 0) {
        await yieldToEventLoop();
      }
    }

    let languageServers: CodeAnalysisSnapshot["languageServers"] =
      [];
    if (input.settings.enabled) {
      input.onProgress?.({
        stage: "lsp",
        completed: 0,
        total: 1,
        message: "正在连接 Language Server"
      });
      const lspDocuments = await ensureLspDocuments(
        inventory.files,
        documents,
        input.settings.readConcurrency,
        input.settings.maxFileSizeBytes,
        input.signal,
        (file, error) => {
          readFailurePaths.add(file.canonicalPath);
          addWarning(
            `无法为 Language Server 读取 ${file.relativePath}：${errorMessage(
              error
            )}`
          );
        }
      );
      const lspResult = await this.#lspPool.analyze({
        sessionPrefix: `${input.workspaceId}:${input.entryId}`,
        workspaceRootPath: input.workspaceRootPath,
        workspaceFolders: input.roots.map((root) => root.path),
        lspDataDirectory: input.lspDataDirectory,
        settings: input.settings,
        documents: lspDocuments,
        priorityPaths: new Set(
          [...parsedByPath.values()]
            .filter(
              (parsed) =>
                parsed.clientRequests.length > 0 ||
                parsed.serverEndpoints.length > 0 ||
                parsed.remoteBoundaries.length > 0
            )
            .map((parsed) => parsed.file.canonicalPath)
        ),
        ...(input.signal ? { signal: input.signal } : {})
      });
      languageServers = lspResult.statuses;
      for (const warning of lspResult.warnings) {
        addWarning(warning);
      }
      if (
        !input.settings.staticFallback &&
        languageServers.some(
          (server) =>
            server.state === "unavailable" ||
            server.state === "failed"
        )
      ) {
        const failures = languageServers
          .filter(
            (server) =>
              server.state === "unavailable" ||
              server.state === "failed"
          )
          .map(
            (server) =>
              `${
                server.language === "typescript"
                  ? "TypeScript"
                  : "Java"
              }：${server.message}`
          )
          .join("；");
        throw new Error(
          `Language Server 分析未完成，且内置分析降级已关闭。${failures}`
        );
      }
      for (const [
        canonicalPath,
        lspSymbols
      ] of lspResult.symbolsByPath) {
        const parsed = parsedByPath.get(canonicalPath);
        if (parsed) {
          builtinCacheOverrides.set(
            canonicalPath,
            structuredClone(parsed)
          );
          mergeLspSymbols(parsed, lspSymbols);
        }
      }
      input.onProgress?.({
        stage: "lsp",
        completed: 1,
        total: 1,
        message: "Language Server 增强完成"
      });
    }

    const cacheFiles: AnalysisCacheDocument["files"] =
      input.scope === "workspace"
        ? {}
        : { ...cacheDocument.files };
    if (input.scope === "changed") {
      for (const path of changedCanonicalPaths(input)) {
        if (!parsedByPath.has(path)) {
          delete cacheFiles[path];
        }
      }
    }
    for (const parsed of parsedByPath.values()) {
      const cacheParsed =
        builtinCacheOverrides.get(
          parsed.file.canonicalPath
        ) ?? parsed;
      cacheFiles[parsed.file.canonicalPath] = {
        fingerprint: parsed.file.fingerprint,
        parsed: {
          ...cacheParsed,
          file: {
            ...cacheParsed.file,
            changed: false
          }
        }
      };
    }

    input.onProgress?.({
      stage: "linking",
      completed: 0,
      total: 1,
      message: "正在解析调用关系与请求链"
    });
    const graphFiles = (
      input.scope === "changed"
        ? Object.values(cacheFiles).map((value) => {
            const current = parsedByPath.get(
              value.parsed.file.canonicalPath
            );
            return current ?? value.parsed;
          })
        : [...parsedByPath.values()]
    ).sort((left, right) =>
      left.file.canonicalPath < right.file.canonicalPath
        ? -1
        : left.file.canonicalPath >
            right.file.canonicalPath
          ? 1
          : 0
    );
    if (
      input.scope === "changed" &&
      !cacheDocument.fullIndexComplete
    ) {
      addWarning(
        "当前没有完整项目索引，变动代码只能展示本次可确定的局部关系。"
      );
    }
    const graph = buildCodeGraph({
      files: graphFiles,
      scope: input.scope,
      graphDepth: input.settings.graphDepth,
      limits: {
        maxNodes: MAX_GRAPH_NODES,
        maxEdges: MAX_GRAPH_EDGES,
        maxRequestChains: MAX_REQUEST_CHAINS
      }
    });
    if (graph.truncated) {
      addWarning(
        `关系图达到安全上限（节点 ${MAX_GRAPH_NODES}、边 ${MAX_GRAPH_EDGES}、调用链 ${MAX_REQUEST_CHAINS}），本次结果已截断。`
      );
    }
    input.onProgress?.({
      stage: "linking",
      completed: 1,
      total: 1,
      message: `已生成 ${graph.requestChains.length} 条远程调用链`
    });

    throwIfAborted(input.signal);
    input.onProgress?.({
      stage: "caching",
      completed: 0,
      total: 1,
      message: "正在保存应用侧增量索引"
    });
    try {
      await cache.save({
        schemaVersion: 1,
        settingsKey: cacheDocument.settingsKey,
        fullIndexComplete:
          input.scope === "workspace"
            ? !inventory.truncated &&
              readFailurePaths.size === 0
            : cacheDocument.fullIndexComplete,
        files: cacheFiles,
        updatedAt: new Date().toISOString()
      });
      input.onProgress?.({
        stage: "caching",
        completed: 1,
        total: 1,
        message: "分析缓存已保存到 GitNest 应用数据目录"
      });
    } catch (error) {
      addWarning(
        `无法保存应用侧分析缓存：${errorMessage(error)}`
      );
      input.onProgress?.({
        stage: "caching",
        completed: 1,
        total: 1,
        message: "分析已完成，但缓存保存失败"
      });
    }

    const snapshot: CodeAnalysisSnapshot = {
      schemaVersion: 1,
      analysisId: input.analysisId,
      workspaceId: input.workspaceId,
      entryId: input.entryId,
      entryName: input.entryName,
      scope: input.scope,
      generatedAt: new Date().toISOString(),
      roots: input.roots,
      nodes: graph.nodes,
      edges: graph.edges,
      requestChains: graph.requestChains,
      languageServers,
      warnings:
        suppressedWarningCount > 0
          ? [
              ...warnings,
              `另有 ${suppressedWarningCount} 条分析提示已折叠。`
            ]
          : warnings,
      stats: {
        discoveredFiles: inventory.files.length,
        analyzedFiles: parsedByPath.size,
        cachedFiles,
        skippedFiles:
          inventory.skippedFiles + readFailurePaths.size,
        symbolCount: graph.nodes.filter(
          (node) => node.kind !== "file"
        ).length,
        edgeCount: graph.edges.length,
        requestChainCount: graph.requestChains.length,
        truncated:
          inventory.truncated || graph.truncated,
        durationMs: Date.now() - startedAt
      }
    };
    assertCodeAnalysisSnapshotPayloadSize(snapshot);
    return snapshot;
  }

  dispose(): Promise<void> {
    return this.#lspPool.disposeAll();
  }
}

async function ensureLspDocuments(
  files: ParsedSourceFile["file"][],
  loadedDocuments: SourceDocument[],
  concurrency: number,
  maxFileSizeBytes: number,
  signal?: AbortSignal,
  onReadError?: (
    file: ParsedSourceFile["file"],
    error: unknown
  ) => void
): Promise<SourceDocument[]> {
  const documents = new Map(
    loadedDocuments.map((document) => [
      document.file.canonicalPath,
      document
    ])
  );
  const missing = files.filter(
    (file) => !documents.has(file.canonicalPath)
  );
  await runConcurrent(
    missing,
    concurrency,
    async (file) => {
      throwIfAborted(signal);
      try {
        documents.set(file.canonicalPath, {
          file,
          content: await readBoundedSourceFile(
            file,
            maxFileSizeBytes
          )
        });
      } catch (error) {
        onReadError?.(file, error);
      }
    }
  );
  return [...documents.values()];
}

function changedCanonicalPaths(
  input: CodeAnalysisInput
): Set<string> {
  const roots = new Map(
    input.roots.map((root) => [
      `${root.repositoryId}\0${root.worktreeId}`,
      root
    ])
  );
  return new Set(
    input.changedPaths.flatMap((changedPath) => {
      const root = roots.get(
        `${changedPath.repositoryId}\0${changedPath.worktreeId}`
      );
      if (!root) {
        return [];
      }
      const path = resolve(root.path, changedPath.path);
      return [
        process.platform === "win32"
          ? path.toLocaleLowerCase("en-US")
          : path
      ];
    })
  );
}

function mergeLspSymbols(
  parsed: ParsedSourceFile,
  lspSymbols: LspDocumentSymbol[]
): void {
  const flattened = flattenLspSymbols(lspSymbols);
  for (const lspSymbol of flattened) {
    const matching = parsed.symbols.find(
      (symbol) =>
        symbol.name === lspSymbol.name &&
        Math.abs(symbol.line - lspSymbol.line) <= 2
    );
    if (matching) {
      matching.source = "merged";
      matching.line = lspSymbol.line;
      matching.endLine = Math.max(
        matching.endLine,
        lspSymbol.endLine
      );
      if (
        !matching.documentation &&
        lspSymbol.documentation
      ) {
        matching.documentation = lspSymbol.documentation;
      }
      matching.calls = mergeCalls(
        matching.calls,
        lspSymbol.outgoingCalls
      );
      continue;
    }
    const kind = lspKind(lspSymbol.kind);
    if (!kind) {
      continue;
    }
    parsed.symbols.push({
      name: lspSymbol.name,
      qualifiedName: lspSymbol.name,
      kind,
      line: lspSymbol.line,
      endLine: lspSymbol.endLine,
      ...(lspSymbol.documentation
        ? { documentation: lspSymbol.documentation }
        : {}),
      calls: mergeCalls([], lspSymbol.outgoingCalls),
      source: "lsp"
    });
  }
}

function mergeCalls(
  existing: ParsedSymbol["calls"],
  lspCalls: LspDocumentSymbol["outgoingCalls"]
): ParsedSymbol["calls"] {
  const calls = [...existing];
  const seen = new Set(
    calls.map(
      (call) =>
        `${call.name}\0${call.targetCanonicalPath ?? ""}\0${
          call.targetLine ?? ""
        }`
    )
  );
  for (const call of lspCalls) {
    const unresolved = calls.find(
      (candidate) =>
        candidate.name === call.name &&
        !candidate.targetCanonicalPath
    );
    if (unresolved && call.targetCanonicalPath) {
      unresolved.line = call.line;
      unresolved.targetCanonicalPath =
        call.targetCanonicalPath;
      if (call.targetLine) {
        unresolved.targetLine = call.targetLine;
      }
      continue;
    }
    const key = `${call.name}\0${
      call.targetCanonicalPath ?? ""
    }\0${call.targetLine ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    calls.push({
      name: call.name,
      line: call.line,
      ...(call.targetCanonicalPath
        ? { targetCanonicalPath: call.targetCanonicalPath }
        : {}),
      ...(call.targetLine
        ? { targetLine: call.targetLine }
        : {})
    });
  }
  return calls;
}

function flattenLspSymbols(
  symbols: LspDocumentSymbol[]
): LspDocumentSymbol[] {
  return symbols.flatMap((symbol) => [
    symbol,
    ...flattenLspSymbols(symbol.children)
  ]);
}

function lspKind(
  kind: number
): ParsedSymbol["kind"] | undefined {
  if (kind === 5) {
    return "class";
  }
  if (kind === 6) {
    return "method";
  }
  if (kind === 12) {
    return "function";
  }
  return undefined;
}

async function runConcurrent<Item>(
  items: Item[],
  concurrency: number,
  worker: (item: Item, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const count = Math.min(
    Math.max(1, concurrency),
    Math.max(items.length, 1)
  );
  await Promise.all(
    Array.from({ length: count }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        const item = items[index];
        if (item === undefined) {
          return;
        }
        await worker(item, index);
      }
    })
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Code analysis was cancelled.");
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolvePromise) =>
    setImmediate(resolvePromise)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
