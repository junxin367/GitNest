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
  LspSemanticRelation,
  ParsedSourceFile,
  ParsedSymbol
} from "./model";
import { discoverSourceFiles } from "./source-inventory";
import { parseSourceFile } from "./source-parser";
import { readBoundedSourceFile } from "./source-reader";
import {
  compactCodeAnalysisSnapshotPayload,
  TARGET_ANALYSIS_SNAPSHOT_PAYLOAD_BYTES
} from "./snapshot-compaction";

interface SourceDocument {
  file: ParsedSourceFile["file"];
  content: string;
}

const MAX_SNAPSHOT_WARNINGS = 100;

export interface CodeAnalysisEngineOptions {
  maximumSnapshotPayloadBytes?: number;
}

export class CodeAnalysisEngine {
  readonly #lspPool: ExternalLanguageServerPool;
  readonly #maximumSnapshotPayloadBytes: number;

  constructor(
    lspPool: ExternalLanguageServerPool =
      new ExternalLanguageServerPool(),
    options: CodeAnalysisEngineOptions = {}
  ) {
    this.#lspPool = lspPool;
    this.#maximumSnapshotPayloadBytes =
      Math.min(
        options.maximumSnapshotPayloadBytes ??
          TARGET_ANALYSIS_SNAPSHOT_PAYLOAD_BYTES,
        TARGET_ANALYSIS_SNAPSHOT_PAYLOAD_BYTES
      );
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
      input.workspaceId
    );
    const cacheDocument = await cache.load(
      input.settings,
      input.roots
    );
    const currentRootRevisions =
      rootRevisionRecord(input.roots);
    const cacheRevisionMatches = rootRevisionsMatch(
      cacheDocument.fullIndexRevisions,
      currentRootRevisions
    );
    const completeIndexUsable =
      cacheDocument.fullIndexComplete &&
      cacheRevisionMatches;
    const completeSemanticIndexUsable =
      completeIndexUsable &&
      cacheDocument.semanticIndexComplete;
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
      const cached =
        input.scope === "changed" &&
        !cacheRevisionMatches
          ? undefined
          : cacheDocument.files[file.canonicalPath];
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
        sessionPrefix: input.workspaceId,
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
              `${languageServerLabel(
                server.language
              )}：${server.message}`
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
      mergeLspIncomingCalls(
        parsedByPath,
        lspResult.symbolsByPath,
        builtinCacheOverrides
      );
      mergeLspReferences(
        parsedByPath,
        lspResult.symbolsByPath,
        builtinCacheOverrides
      );
      mergeLspSemanticRelations(
        parsedByPath,
        lspResult.semanticRelations ?? [],
        builtinCacheOverrides
      );
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
        : cacheRevisionMatches
          ? { ...cacheDocument.files }
          : {};
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
      !completeIndexUsable
    ) {
      addWarning(
        cacheDocument.fullIndexComplete &&
          !cacheRevisionMatches
          ? "仓库版本已变化，旧完整索引未被复用；变动代码只能展示本次可确定的局部关系。"
          : "当前没有完整项目索引，变动代码只能展示本次可确定的局部关系。"
      );
    }
    const graph = buildCodeGraph({
      files: graphFiles,
      scope: input.scope,
      graphDepth: input.settings.graphDepth,
      limits: {
        maxNodes: input.settings.maxGraphNodes,
        maxEdges: input.settings.maxGraphEdges,
        maxRequestChains: input.settings.maxRequestChains,
        maxDiagnostics: input.settings.maxDiagnostics
      }
    });
    if (graph.truncated) {
      addWarning(
        `关系图达到安全上限（节点 ${input.settings.maxGraphNodes}、边 ${input.settings.maxGraphEdges}、调用链 ${input.settings.maxRequestChains}），本次结果已截断。`
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
    const generatedAt = new Date().toISOString();
    const analyzedSourceSetComplete =
      !inventory.truncated &&
      inventory.configuredSkippedFiles === 0 &&
      inventory.inspectionFailureCount === 0 &&
      readFailurePaths.size === 0;
    const fullIndexAvailable =
      input.scope === "workspace"
        ? analyzedSourceSetComplete
        : completeIndexUsable &&
          analyzedSourceSetComplete;
    const incompleteLanguageServers =
      languageServers.filter(
        (server) =>
          server.state === "unavailable" ||
          server.state === "failed" ||
          server.semanticCoverage === "partial" ||
          server.semanticCoverage === "unavailable"
      );
    const currentSemanticAnalysisComplete =
      !input.settings.enabled ||
      incompleteLanguageServers.length === 0;
    const semanticAnalysisComplete =
      currentSemanticAnalysisComplete &&
      (
        input.scope === "workspace" ||
        completeSemanticIndexUsable
      );
    const resultComplete =
      fullIndexAvailable &&
      !graph.truncated &&
      semanticAnalysisComplete;
    const lastFullIndexAt =
      input.scope === "workspace" &&
      fullIndexAvailable
        ? generatedAt
        : cacheDocument.lastFullIndexAt;
    try {
      await cache.save({
        schemaVersion: 3,
        settingsKey: cacheDocument.settingsKey,
        fullIndexComplete: fullIndexAvailable,
        semanticIndexComplete:
          fullIndexAvailable &&
          semanticAnalysisComplete,
        fullIndexRevisions: currentRootRevisions,
        ...(lastFullIndexAt ? { lastFullIndexAt } : {}),
        files: cacheFiles,
        updatedAt: generatedAt
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

    const indexMessage = resultComplete
      ? input.scope === "workspace"
        ? "当前结果基于本次建立的完整项目索引。"
        : "当前结果已复用与 Worktree HEAD 一致的完整项目索引。"
      : cacheDocument.fullIndexComplete &&
          !cacheRevisionMatches
        ? "Worktree HEAD 已变化，旧完整索引未复用；结果可能遗漏未出现在本次变动列表中的关系。"
        : inventory.truncated
          ? "文件发现达到性能上限，当前结果来自局部索引。"
          : inventory.configuredSkippedFiles > 0
            ? "部分受支持源码超过配置的单文件大小限制，当前结果可能遗漏相关调用关系。"
            : inventory.inspectionFailureCount > 0
              ? "部分目录或源码无法检查，当前结果可能遗漏相关调用关系。"
              : readFailurePaths.size > 0
                ? "部分源码读取失败，当前结果可能遗漏相关调用关系。"
                : graph.truncated
                  ? "关系图达到性能上限，当前结果可能遗漏较远的调用关系。"
                  : !semanticAnalysisComplete
                    ? incompleteLanguageServers.length > 0
                      ? `Language Server 语义增强不完整：${incompleteLanguageServers
                          .map(
                            (server) =>
                              `${languageServerLabel(
                                server.language
                              )} ${server.message}`
                          )
                          .join("；")}`
                      : "缓存中的完整项目索引缺少完整的 Language Server 语义增强；请重新运行完整项目分析。"
                    : "尚未建立可用于当前 Worktree 版本的完整项目索引。";
    const diagnostics = [...graph.diagnostics];
    if (!resultComplete) {
      diagnostics.unshift({
        id: "diagnostic_partial-index",
        kind: "partial-index",
        severity: "warning",
        message: "影响范围可能不完整",
        evidence: indexMessage,
        relatedNodeIds: []
      });
    }
    const snapshot = compactCodeAnalysisSnapshotPayload(
      {
        schemaVersion: 1,
        analysisId: input.analysisId,
        workspaceId: input.workspaceId,
        scope: input.scope,
        generatedAt,
        roots: input.roots,
        nodes: graph.nodes,
        edges: graph.edges,
        requestChains: graph.requestChains,
        languageServers,
        indexStatus: {
          fullIndexAvailable,
          resultCompleteness: resultComplete
            ? "complete"
            : "partial",
          impactCoverage: resultComplete
            ? "confirmed"
            : "possible-omissions",
          ...(lastFullIndexAt ? { lastFullIndexAt } : {}),
          message: indexMessage
        },
        diagnostics,
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
            inventory.skippedFiles +
            readFailurePaths.size,
          symbolCount: graph.nodes.filter(
            (node) => node.kind !== "file"
          ).length,
          edgeCount: graph.edges.length,
          requestChainCount:
            graph.requestChains.length,
          truncated:
            inventory.truncated || graph.truncated,
          durationMs: Date.now() - startedAt
        }
      },
      this.#maximumSnapshotPayloadBytes
    );
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

function rootRevisionRecord(
  roots: CodeAnalysisInput["roots"]
): Record<string, string> {
  return Object.fromEntries(
    roots.map((root) => [
      `${root.repositoryId}\0${root.worktreeId}`,
      root.revision ?? ""
    ])
  );
}

function rootRevisionsMatch(
  cached: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>
): boolean {
  const cachedEntries = Object.entries(cached).sort(
    ([left], [right]) => left.localeCompare(right)
  );
  const currentEntries = Object.entries(current).sort(
    ([left], [right]) => left.localeCompare(right)
  );
  return (
    cachedEntries.length === currentEntries.length &&
    cachedEntries.every(
      ([key, revision], index) =>
        currentEntries[index]?.[0] === key &&
        currentEntries[index]?.[1] === revision
    )
  );
}

function mergeLspSymbols(
  parsed: ParsedSourceFile,
  lspSymbols: LspDocumentSymbol[]
): void {
  const packageName = parsed.symbols.find(
    (symbol) => symbol.kind === "package"
  )?.qualifiedName;
  const matchedSymbols = new Set<ParsedSymbol>();
  const visit = (
    symbols: LspDocumentSymbol[],
    parentQualifiedName?: string
  ) => {
    for (const lspSymbol of symbols) {
      const kind = lspKind(lspSymbol.kind);
      const effectiveParentQualifiedName =
        parentQualifiedName ??
        normalizedLspContainerName(
          lspSymbol.containerName,
          packageName
        );
      const matching = kind
        ? findBestLspSymbolMatch(
            parsed.symbols,
            lspSymbol,
            kind,
            effectiveParentQualifiedName,
            matchedSymbols
          )
        : undefined;
      const qualifiedName = effectiveParentQualifiedName
        ? `${effectiveParentQualifiedName}.${lspSymbol.name}`
        : lspSymbol.name;
      const signature = lspSymbolSignature(lspSymbol);
      if (matching) {
        matchedSymbols.add(matching);
        matching.source = "merged";
        matching.line = lspSymbol.line;
        matching.endLine = Math.max(
          matching.endLine,
          lspSymbol.endLine
        );
        matching.selectionCharacter = lspSymbol.character;
        if (!matching.packageName && packageName) {
          matching.packageName = packageName;
        }
        if (!matching.signature && signature) {
          matching.signature = signature;
        }
        matching.semanticId = lspSymbolSemanticId(
          parsed.file.canonicalPath,
          lspSymbol
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
        visit(
          lspSymbol.children,
          matching.kind === "package" ||
            matching.kind === "module"
            ? parentQualifiedName
            : matching.qualifiedName
        );
        continue;
      }
      if (!kind) {
        visit(
          lspSymbol.children,
          effectiveParentQualifiedName
        );
        continue;
      }
      parsed.symbols.push({
        name: lspSymbol.name,
        qualifiedName,
        kind,
        line: lspSymbol.line,
        endLine: lspSymbol.endLine,
        selectionCharacter: lspSymbol.character,
        ...(effectiveParentQualifiedName
          ? {
              parentQualifiedName:
                effectiveParentQualifiedName
            }
          : {}),
        ...(packageName ? { packageName } : {}),
        ...(signature
          ? { signature }
          : {}),
        semanticId: lspSymbolSemanticId(
          parsed.file.canonicalPath,
          lspSymbol
        ),
        ...(lspSymbol.documentation
          ? { documentation: lspSymbol.documentation }
          : {}),
        calls: mergeCalls([], lspSymbol.outgoingCalls),
        source: "lsp"
      });
      visit(
        lspSymbol.children,
        kind === "package" || kind === "module"
          ? parentQualifiedName
          : qualifiedName
      );
    }
  };
  visit(lspSymbols);
}

function findBestLspSymbolMatch(
  symbols: ParsedSymbol[],
  lspSymbol: LspDocumentSymbol,
  kind: ParsedSymbol["kind"],
  parentQualifiedName: string | undefined,
  matchedSymbols: ReadonlySet<ParsedSymbol>
): ParsedSymbol | undefined {
  const lspSignature = lspSymbolSignature(lspSymbol);
  return symbols
    .filter(
      (symbol) =>
        !matchedSymbols.has(symbol) &&
        symbol.name === lspSymbol.name &&
        symbol.kind === kind &&
        (
          parentQualifiedName === undefined ||
          symbol.parentQualifiedName ===
            parentQualifiedName
        ) &&
        (
          (lspSymbol.line >= symbol.line &&
            lspSymbol.line <= symbol.endLine) ||
          Math.abs(symbol.line - lspSymbol.line) <= 4
        )
    )
    .sort(
      (left, right) =>
        Number(
          Boolean(lspSignature) &&
            right.signature === lspSignature
        ) -
          Number(
            Boolean(lspSignature) &&
              left.signature === lspSignature
          ) ||
        Number(
          !(
            lspSymbol.line >= left.line &&
            lspSymbol.line <= left.endLine
          )
        ) -
          Number(
            !(
              lspSymbol.line >= right.line &&
              lspSymbol.line <= right.endLine
            )
          ) ||
        Math.abs(left.line - lspSymbol.line) -
          Math.abs(right.line - lspSymbol.line) ||
        left.endLine -
          left.line -
          (right.endLine - right.line)
    )[0];
}

function lspSymbolSignature(
  symbol: LspDocumentSymbol
): string | undefined {
  if (!isCallableLspKind(symbol.kind)) {
    return undefined;
  }
  const detail = symbol.detail?.trim();
  return detail
    ? `${symbol.name}:${detail}`
    : undefined;
}

function lspSymbolSemanticId(
  canonicalPath: string,
  symbol: LspDocumentSymbol
): string {
  return [
    "lsp",
    canonicalPath,
    String(symbol.kind),
    String(symbol.line),
    String(symbol.character),
    symbol.detail ?? symbol.name
  ].join("\0");
}

function normalizedLspContainerName(
  containerName: string | undefined,
  packageName: string | undefined
): string | undefined {
  const normalized = containerName?.trim();
  if (!normalized) {
    return undefined;
  }
  if (packageName && normalized === packageName) {
    return undefined;
  }
  if (
    packageName &&
    normalized.startsWith(`${packageName}.`)
  ) {
    return normalized.slice(packageName.length + 1);
  }
  return normalized;
}

function mergeCalls(
  existing: ParsedSymbol["calls"],
  lspCalls: LspDocumentSymbol["outgoingCalls"],
  evidence = "LSP Call Hierarchy outgoingCalls"
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
      unresolved.source =
        unresolved.source === "builtin"
          ? "merged"
          : "lsp";
      unresolved.evidence = mergeEvidence(
        unresolved.evidence,
        evidence
      );
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
        : {}),
      source: "lsp",
      evidence
    });
  }
  return calls;
}

function mergeLspIncomingCalls(
  parsedByPath: ReadonlyMap<string, ParsedSourceFile>,
  symbolsByPath: ReadonlyMap<
    string,
    LspDocumentSymbol[]
  >,
  builtinCacheOverrides: Map<string, ParsedSourceFile>
): void {
  for (const [targetPath, symbols] of symbolsByPath) {
    for (const target of flattenLspSymbols(symbols)) {
      for (const incoming of target.incomingCalls ?? []) {
        if (!incoming.sourceCanonicalPath) {
          continue;
        }
        const source = parsedByPath.get(
          incoming.sourceCanonicalPath
        );
        if (!source) {
          continue;
        }
        const caller = findIncomingCaller(
          source.symbols,
          incoming.name,
          incoming.sourceLine,
          incoming.line
        );
        if (!caller) {
          continue;
        }
        if (
          !builtinCacheOverrides.has(
            incoming.sourceCanonicalPath
          )
        ) {
          builtinCacheOverrides.set(
            incoming.sourceCanonicalPath,
            structuredClone(source)
          );
        }
        caller.calls = mergeCalls(caller.calls, [
          {
            name: target.name,
            line: incoming.line,
            targetCanonicalPath: targetPath,
            targetLine: target.line
          }
        ], "LSP Call Hierarchy incomingCalls");
      }
    }
  }
}

function mergeLspReferences(
  parsedByPath: ReadonlyMap<string, ParsedSourceFile>,
  symbolsByPath: ReadonlyMap<
    string,
    LspDocumentSymbol[]
  >,
  builtinCacheOverrides: Map<string, ParsedSourceFile>
): void {
  for (const [targetPath, symbols] of symbolsByPath) {
    for (const target of flattenLspSymbols(symbols)) {
      for (const reference of target.references ?? []) {
        if (!reference.sourceCanonicalPath) {
          continue;
        }
        if (
          reference.sourceCanonicalPath === targetPath &&
          reference.line === target.line &&
          reference.character === target.character
        ) {
          continue;
        }
        const source = parsedByPath.get(
          reference.sourceCanonicalPath
        );
        if (!source) {
          continue;
        }
        const owner = findReferenceOwner(
          source.symbols,
          reference.line
        );
        if (!owner) {
          continue;
        }
        if (
          !builtinCacheOverrides.has(
            reference.sourceCanonicalPath
          )
        ) {
          builtinCacheOverrides.set(
            reference.sourceCanonicalPath,
            structuredClone(source)
          );
        }
        const references = owner.references ?? [];
        const duplicate = references.some(
          (candidate) =>
            candidate.line === reference.line &&
            candidate.name === target.name &&
            candidate.targetCanonicalPath === targetPath &&
            candidate.targetLine === target.line
        );
        if (duplicate) {
          continue;
        }
        references.push({
          name: target.name,
          line: reference.line,
          targetCanonicalPath: targetPath,
          targetLine: target.line,
          source: "lsp",
          evidence: `LSP textDocument/references 定位 ${reference.sourceCanonicalPath}:${reference.line}`
        });
        owner.references = references;
      }
    }
  }
}

function mergeLspSemanticRelations(
  parsedByPath: ReadonlyMap<string, ParsedSourceFile>,
  relations: readonly LspSemanticRelation[],
  builtinCacheOverrides: Map<string, ParsedSourceFile>
): void {
  for (const relation of relations) {
    const sourceFile = parsedByPath.get(
      relation.sourceCanonicalPath
    );
    if (!sourceFile) {
      continue;
    }
    const source = findSymbolAtLocation(
      sourceFile.symbols,
      relation.sourceLine,
      relation.sourceName
    );
    if (!source) {
      continue;
    }
    if (
      !builtinCacheOverrides.has(
        relation.sourceCanonicalPath
      )
    ) {
      builtinCacheOverrides.set(
        relation.sourceCanonicalPath,
        structuredClone(sourceFile)
      );
    }
    const semanticRelations =
      source.semanticRelations ?? [];
    const duplicate = semanticRelations.some(
      (candidate) =>
        candidate.kind === relation.kind &&
        candidate.targetCanonicalPath ===
          relation.targetCanonicalPath &&
        candidate.targetLine === relation.targetLine
    );
    if (duplicate) {
      continue;
    }
    semanticRelations.push({
      kind: relation.kind,
      targetName: relation.targetName,
      targetCanonicalPath:
        relation.targetCanonicalPath,
      targetLine: relation.targetLine,
      source: "lsp",
      evidence: relation.evidence
    });
    source.semanticRelations = semanticRelations;
  }
}

function findSymbolAtLocation(
  symbols: ParsedSymbol[],
  line: number,
  preferredName?: string
): ParsedSymbol | undefined {
  return symbols
    .filter(
      (symbol) =>
        line === symbol.line ||
        (line >= symbol.line && line <= symbol.endLine)
    )
    .sort(
      (left, right) =>
        Number(right.name === preferredName) -
          Number(left.name === preferredName) ||
        Number(right.line === line) -
          Number(left.line === line) ||
        left.endLine -
          left.line -
          (right.endLine - right.line) ||
        right.line - left.line
    )[0];
}

function findIncomingCaller(
  symbols: ParsedSymbol[],
  name: string,
  sourceLine: number | undefined,
  callLine: number
): ParsedSymbol | undefined {
  return symbols
    .filter(
      (symbol) =>
        isCallableSymbolKind(symbol.kind) &&
        (
          (sourceLine !== undefined &&
            Math.abs(symbol.line - sourceLine) <= 2) ||
          (callLine >= symbol.line &&
            callLine <= symbol.endLine)
        )
    )
    .sort(
      (left, right) =>
        Number(right.name === name) -
          Number(left.name === name) ||
        Math.abs(left.line - (sourceLine ?? callLine)) -
          Math.abs(right.line - (sourceLine ?? callLine)) ||
        left.endLine -
          left.line -
          (right.endLine - right.line)
    )[0];
}

function findReferenceOwner(
  symbols: ParsedSymbol[],
  referenceLine: number
): ParsedSymbol | undefined {
  return symbols
    .filter(
      (symbol) =>
        referenceLine >= symbol.line &&
        referenceLine <= symbol.endLine
    )
    .sort(
      (left, right) =>
        Number(isCallableSymbolKind(right.kind)) -
          Number(isCallableSymbolKind(left.kind)) ||
        left.endLine -
          left.line -
          (right.endLine - right.line) ||
        right.line - left.line
    )[0];
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
  return {
    2: "module",
    3: "module",
    4: "package",
    5: "class",
    6: "method",
    7: "property",
    8: "property",
    9: "method",
    10: "enum",
    11: "interface",
    12: "function",
    13: "property",
    14: "property",
    22: "property",
    23: "class"
  }[kind] as ParsedSymbol["kind"] | undefined;
}

function isCallableLspKind(kind: number): boolean {
  return kind === 6 || kind === 9 || kind === 12;
}

function isCallableSymbolKind(
  kind: ParsedSymbol["kind"]
): boolean {
  return kind === "function" || kind === "method";
}

function mergeEvidence(
  existing: string | undefined,
  next: string
): string {
  if (!existing) {
    return next;
  }
  return existing.includes(next)
    ? existing
    : `${existing}；${next}`;
}

function languageServerLabel(
  language: CodeAnalysisSnapshot["languageServers"][number]["language"]
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
