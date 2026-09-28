import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import {
  basename,
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve
} from "node:path";
import {
  fileURLToPath,
  pathToFileURL
} from "node:url";

import { MAX_CODE_DOCUMENTATION_CHARACTERS } from "./model";
import type {
  AnalysisSourceFile,
  CodeAnalysisLanguage,
  CodeAnalysisSettings,
  LanguageServerCommandSettings,
  LanguageServerLanguage,
  LanguageServerStatus,
  LspAnalysisResult,
  LspCallReference,
  LspDocumentSymbol,
  LspIncomingCallReference,
  LspReferenceLocation,
  LspSemanticRelation
} from "./model";

interface SourceDocument {
  file: AnalysisSourceFile;
  content: string;
}

interface LspDocumentResponse {
  document: SourceDocument;
  uri: string;
  response: unknown;
  failure: string | null;
}

export function orderLanguageServerDocuments<
  Document extends { file: AnalysisSourceFile }
>(
  documents: readonly Document[],
  priorityPaths?: ReadonlySet<string>
): Document[] {
  return [...documents].sort(
    (left, right) =>
      Number(
        priorityPaths?.has(right.file.canonicalPath) ?? false
      ) -
        Number(
          priorityPaths?.has(left.file.canonicalPath) ?? false
        ) ||
      Number(right.file.changed) -
        Number(left.file.changed) ||
      Number(isTestCodePath(left.file.relativePath)) -
        Number(isTestCodePath(right.file.relativePath)) ||
      left.file.canonicalPath.localeCompare(
        right.file.canonicalPath
      )
  );
}

interface PooledSession {
  signature: string;
  client: JsonRpcClient;
  opened: Map<string, { version: number; hash: string }>;
  recoveredJavaWorkspace: boolean;
  hoverSupported: boolean;
  incomingCallHierarchySupported: boolean;
  referencesSupported: boolean;
  typeHierarchySupported: boolean;
  implementationSupported: boolean;
  workspaceSymbolSupported: boolean;
  idleTimer?: NodeJS.Timeout;
}

function isTestCodePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  return (
    normalized.includes("/test/") ||
    normalized.includes("/tests/") ||
    normalized.includes("/__tests__/") ||
    /\.(?:test|spec)\.[^/]+$/.test(normalized)
  );
}

interface JavaDataWorkspace {
  baseDirectory: string;
  generation: number;
  dataDirectory: string;
}

interface LanguageServerLaunchPlan {
  signature: string;
  args: string[];
  rootPath: string;
  workspaceFolders: string[];
  javaDataWorkspace?: JavaDataWorkspace;
}

interface LanguageServerDescriptor {
  language: LanguageServerLanguage;
  displayName: string;
  fileLanguages: readonly CodeAnalysisLanguage[];
  alwaysReport: boolean;
}

const LANGUAGE_SERVER_DESCRIPTORS: readonly LanguageServerDescriptor[] =
  [
    {
      language: "typescript",
      displayName: "TypeScript",
      fileLanguages: ["typescript", "javascript"],
      alwaysReport: true
    },
    {
      language: "vue",
      displayName: "Vue",
      fileLanguages: ["vue"],
      alwaysReport: false
    },
    {
      language: "java",
      displayName: "Java",
      fileLanguages: ["java"],
      alwaysReport: true
    },
    {
      language: "python",
      displayName: "Python",
      fileLanguages: ["python"],
      alwaysReport: false
    },
    {
      language: "go",
      displayName: "Go",
      fileLanguages: ["go"],
      alwaysReport: false
    },
    {
      language: "kotlin",
      displayName: "Kotlin",
      fileLanguages: ["kotlin"],
      alwaysReport: false
    },
    {
      language: "csharp",
      displayName: "C#",
      fileLanguages: ["csharp"],
      alwaysReport: false
    },
    {
      language: "rust",
      displayName: "Rust",
      fileLanguages: ["rust"],
      alwaysReport: false
    }
  ];

const OPTIONAL_LANGUAGE_SERVER_LIMITS = {
  maxDocuments: 120,
  maxSymbolsPerDocument: 5_000,
  maxCallHierarchyRequests: 50,
  maxTypeHierarchyRequests: 50,
  maxReferenceRequests: 50,
  maxDocumentationRequests: 50,
  maxReferencesPerSymbol: 500
} as const;

const OPTIONAL_LANGUAGE_SERVER_DEFAULTS: Readonly<
  Record<
    Exclude<
      LanguageServerLanguage,
      "typescript" | "java"
    >,
    LanguageServerCommandSettings
  >
> = {
  vue: {
    ...OPTIONAL_LANGUAGE_SERVER_LIMITS,
    enabled: true,
    command: "vue-language-server",
    args: ["--stdio"]
  },
  python: {
    ...OPTIONAL_LANGUAGE_SERVER_LIMITS,
    enabled: false,
    command: "pyright-langserver",
    args: ["--stdio"]
  },
  go: {
    ...OPTIONAL_LANGUAGE_SERVER_LIMITS,
    enabled: false,
    command: "gopls",
    args: ["serve"]
  },
  kotlin: {
    ...OPTIONAL_LANGUAGE_SERVER_LIMITS,
    enabled: false,
    command: "kotlin-lsp",
    args: ["--stdio"]
  },
  csharp: {
    ...OPTIONAL_LANGUAGE_SERVER_LIMITS,
    enabled: false,
    command: "csharp-ls",
    args: []
  },
  rust: {
    ...OPTIONAL_LANGUAGE_SERVER_LIMITS,
    enabled: false,
    command: "rust-analyzer",
    args: []
  }
};

const JAVA_WARMUP_TIMEOUT_MS = 120_000;
const JAVA_WORKSPACE_READY_TIMEOUT_MS = 5 * 60_000;
const JAVA_STATUS_DISCOVERY_TIMEOUT_MS = 2_000;
const NON_JAVA_COLD_START_TIMEOUT_MS = 30_000;
const LANGUAGE_SERVER_RECONNECT_DELAY_MS = 250;
const JAVA_DATA_STATE_FILE = "active-generation.json";
const MAX_LSP_HEADER_BYTES = 64 * 1_024;
const MAX_LSP_MESSAGE_BYTES = 16 * 1_024 * 1_024;
const MAX_LSP_BUFFER_BYTES = 32 * 1_024 * 1_024;
const MAX_LSP_QUEUED_WRITE_BYTES = 32 * 1_024 * 1_024;
const MAX_LSP_STATUS_TYPE_CHARACTERS = 128;
const MAX_LSP_STATUS_MESSAGE_CHARACTERS = 2_048;
const DEFAULT_LSP_SYMBOLS_PER_DOCUMENT = 5_000;
const MAX_LSP_SYMBOL_DEPTH = 64;
const MAX_LSP_SYMBOL_NAME_CHARACTERS = 1_024;
const DEFAULT_LSP_REFERENCES_PER_SYMBOL = 500;

interface NotificationWaiter {
  predicate(params: unknown): boolean;
  resolve(value: unknown | undefined): void;
  reject(reason: unknown): void;
}

export class ExternalLanguageServerPool {
  readonly #sessions = new Map<string, PooledSession>();
  readonly #sessionTails = new Map<string, Promise<void>>();
  readonly #idleMs: number;

  constructor(idleMs = 5 * 60_000) {
    this.#idleMs = idleMs;
  }

  async analyze(input: {
    sessionPrefix: string;
    workspaceRootPath: string;
    workspaceFolders: string[];
    lspDataDirectory: string;
    settings: CodeAnalysisSettings;
    documents: SourceDocument[];
    priorityPaths?: ReadonlySet<string>;
    signal?: AbortSignal;
  }): Promise<LspAnalysisResult> {
    const symbolsByPath = new Map<
      string,
      LspDocumentSymbol[]
    >();
    const statuses: LanguageServerStatus[] = [];
    const warnings: string[] = [];
    const semanticRelations: LspSemanticRelation[] = [];

    for (const descriptor of LANGUAGE_SERVER_DESCRIPTORS) {
      const language = descriptor.language;
      const sessionKey = `${input.sessionPrefix}:${language}`;
      const documents = input.documents.filter((document) =>
        descriptor.fileLanguages.includes(
          document.file.language
        )
      );
      const commandSettings = languageServerSettings(
        input.settings,
        language
      );
      if (
        documents.length === 0 &&
        !descriptor.alwaysReport
      ) {
        await this.#closeSessionDocuments(
          sessionKey,
          new Set(),
          input.signal
        );
        continue;
      }
      if (!commandSettings.enabled) {
        await this.#closeSessionDocuments(
          sessionKey,
          new Set(),
          input.signal
        );
        statuses.push({
          language,
          state: "disabled",
          command: commandSettings.command,
          message: "已在设置中禁用。",
          symbolCount: 0,
          semanticCoverage:
            documents.length > 0 ? "unavailable" : "complete",
          documentsTotal: documents.length,
          documentsAnalyzed: 0,
          skippedDocuments: documents.length,
          failedDocuments: 0,
          truncatedDocuments: 0,
          requestBudgetExhausted: false,
          enrichmentStoppedEarly: false
        });
        continue;
      }
      if (documents.length === 0) {
        await this.#closeSessionDocuments(
          sessionKey,
          new Set(),
          input.signal
        );
        statuses.push({
          language,
          state: "disabled",
          command: commandSettings.command,
          message: "当前范围没有对应语言文件。",
          symbolCount: 0,
          semanticCoverage: "complete",
          documentsTotal: 0,
          documentsAnalyzed: 0,
          skippedDocuments: 0,
          failedDocuments: 0,
          truncatedDocuments: 0,
          requestBudgetExhausted: false,
          enrichmentStoppedEarly: false
        });
        continue;
      }

      const workspace = resolveLanguageServerWorkspace(
        language,
        documents,
        input.workspaceRootPath,
        input.workspaceFolders
      );
      const requestTimeoutMs = input.settings.lspTimeoutMs;
      const startupTimeoutMs =
        resolveLanguageServerStartupTimeoutMs(
          language,
          requestTimeoutMs
        );
      const workspaceReadyTimeoutMs =
        resolveLanguageServerWorkspaceReadyTimeoutMs(
          language,
          requestTimeoutMs
        );
      const firstDocumentTimeoutMs =
        language === "java"
          ? workspaceReadyTimeoutMs
          : startupTimeoutMs;
      const orderedDocuments = orderLanguageServerDocuments(
        documents,
        input.priorityPaths
      );
      const documentLimit = commandSettings.maxDocuments;
      const selectedDocuments = orderedDocuments.slice(
        0,
        documentLimit
      );
      let releaseSession: (() => void) | undefined;
      try {
        releaseSession = await this.#acquireSession(
          sessionKey,
          input.signal
        );
        const firstDocument = selectedDocuments[0]!;
        const firstDocumentUri = pathToFileURL(
          firstDocument.file.absolutePath
        ).toString();
        let session: PooledSession | undefined;
        let firstDocumentResponse: unknown;
        let sessionReady = false;
        let didReconnect = false;
        let firstConnectionError: unknown;
        const sessionAttempts =
          language === "java" ? 1 : 2;
        for (
          let attempt = 0;
          attempt < sessionAttempts;
          attempt += 1
        ) {
          try {
            session = await this.#getSession({
              key: sessionKey,
              language,
              commandSettings,
              rootPath: workspace.rootPath,
              workspaceFolders:
                workspace.workspaceFolders,
              dataDirectory: input.lspDataDirectory,
              timeoutMs: startupTimeoutMs,
              workspaceReadyTimeoutMs,
              ...(input.signal
                ? { signal: input.signal }
                : {})
            });
            closeUnusedDocuments(
              session,
              new Set(
                selectedDocuments.map((document) =>
                  pathToFileURL(
                    document.file.absolutePath
                  ).toString()
                )
              )
            );
            await openOrUpdateDocument(
              session,
              firstDocumentUri,
              firstDocument,
              requestTimeoutMs,
              input.signal
            );
            firstDocumentResponse =
              await session.client.request(
                "textDocument/documentSymbol",
                {
                  textDocument: {
                    uri: firstDocumentUri
                  }
                },
                firstDocumentTimeoutMs,
                input.signal
              );
            sessionReady = true;
            break;
          } catch (error) {
            const canReconnect =
              attempt + 1 < sessionAttempts &&
              isRecoverableLanguageServerConnectionError(
                error,
                input.signal
              );
            if (!canReconnect) {
              if (didReconnect) {
                throw new Error(
                  "LSP 自动重连后仍失败。" +
                    `首次失败：${errorMessage(
                      firstConnectionError
                    )}；` +
                    `重试失败：${errorMessage(error)}`,
                  { cause: error }
                );
              }
              throw error;
            }
            didReconnect = true;
            firstConnectionError = error;
            await this.#disposeSession(sessionKey);
            await delayWithSignal(
              LANGUAGE_SERVER_RECONNECT_DELAY_MS,
              input.signal
            );
          }
        }
        if (!sessionReady || !session) {
          throw new Error("LSP 会话未能完成首个文档请求。");
        }
        let symbolCount = 0;
        let truncatedSymbolDocuments = 0;
        const preparedDocuments: PreparedLspDocument[] = [];
        const analyzedPaths = new Set<string>();
        const remainingDocumentResults =
          await mapWithConcurrency(
            selectedDocuments.slice(1),
            input.settings.readConcurrency,
            async (document): Promise<LspDocumentResponse> => {
              throwIfAborted(input.signal);
              const uri = pathToFileURL(
                document.file.absolutePath
              ).toString();
              try {
                await openOrUpdateDocument(
                  session,
                  uri,
                  document,
                  requestTimeoutMs,
                  input.signal
                );
                const response =
                  await session.client.request(
                    "textDocument/documentSymbol",
                    {
                      textDocument: { uri }
                    },
                    requestTimeoutMs,
                    input.signal
                  );
                return {
                  document,
                  uri,
                  response,
                  failure: null
                };
              } catch (error) {
                if (input.signal?.aborted) {
                  throw error;
                }
                return {
                  document,
                  uri,
                  response: undefined,
                  failure: errorMessage(error)
                };
              }
            }
          );
        const documentResults: LspDocumentResponse[] = [
          {
            document: firstDocument,
            uri: firstDocumentUri,
            response: firstDocumentResponse,
            failure: null
          },
          ...remainingDocumentResults
        ];
        const failedDocumentMessages: string[] = [];
        for (const result of documentResults) {
          if (result.failure !== null) {
            failedDocumentMessages.push(
              `${result.document.file.relativePath}: ${result.failure}`
            );
            continue;
          }
          const parsedSymbols = parseDocumentSymbols(
            result.response,
            commandSettings.maxSymbolsPerDocument
          );
          const symbols = parsedSymbols.symbols;
          if (parsedSymbols.truncated) {
            truncatedSymbolDocuments += 1;
          }
          symbolCount += countSymbols(symbols);
          symbolsByPath.set(
            result.document.file.canonicalPath,
            symbols
          );
          analyzedPaths.add(
            result.document.file.canonicalPath
          );
          preparedDocuments.push({
            uri: result.uri,
            symbols
          });
        }

        const skippedByLimitCount = Math.max(
          0,
          documents.length - selectedDocuments.length
        );
        const failedDocumentCount =
          failedDocumentMessages.length;
        const uncoveredDocumentCount =
          skippedByLimitCount + failedDocumentCount;
        const workspaceSymbols =
          uncoveredDocumentCount > 0 &&
          session.workspaceSymbolSupported
            ? await enrichWorkspaceSymbols({
                session,
                allowedPaths: new Set(
                  documents.map(
                    (document) =>
                      document.file.canonicalPath
                  )
                ),
                existingPaths: analyzedPaths,
                maxSymbols:
                  commandSettings.maxSymbolsPerDocument,
                timeoutMs: requestTimeoutMs,
                ...(input.signal
                  ? { signal: input.signal }
                  : {})
              })
            : emptyWorkspaceSymbolResult();
        if (
          uncoveredDocumentCount > 0 &&
          session.workspaceSymbolSupported
        ) {
          session.workspaceSymbolSupported =
            workspaceSymbols.supported;
        }
        for (const [
          canonicalPath,
          workspacePathSymbols
        ] of workspaceSymbols.symbolsByPath) {
          symbolsByPath.set(
            canonicalPath,
            workspacePathSymbols
          );
        }
        symbolCount += workspaceSymbols.symbolCount;

        const documentation = session.hoverSupported
          ? await enrichDocumentation({
              session,
              documents: preparedDocuments,
              budget:
                commandSettings.maxDocumentationRequests,
              concurrency: input.settings.readConcurrency,
              timeoutMs: requestTimeoutMs,
              ...(input.signal
                ? { signal: input.signal }
                : {})
            })
          : emptyDocumentationResult();
        session.hoverSupported = documentation.supported;

        const hierarchy = await enrichCallHierarchy({
          session,
          documents: preparedDocuments,
          budget:
            commandSettings.maxCallHierarchyRequests,
          concurrency: input.settings.readConcurrency,
          timeoutMs: requestTimeoutMs,
          ...(input.signal
            ? { signal: input.signal }
            : {})
        });

        const references = session.referencesSupported
          ? await enrichReferences({
              session,
              documents: preparedDocuments,
              budget:
                commandSettings.maxReferenceRequests,
              maxReferencesPerSymbol:
                commandSettings.maxReferencesPerSymbol,
              concurrency: input.settings.readConcurrency,
              timeoutMs: requestTimeoutMs,
              ...(input.signal
                ? { signal: input.signal }
                : {})
            })
          : emptyReferenceResult();
        session.referencesSupported = references.supported;

        const typeRelations = await enrichTypeRelations({
          session,
          documents: preparedDocuments,
          budget:
            commandSettings.maxTypeHierarchyRequests ??
            commandSettings.maxCallHierarchyRequests,
          concurrency: input.settings.readConcurrency,
          timeoutMs: requestTimeoutMs,
          ...(input.signal
            ? { signal: input.signal }
            : {})
        });
        semanticRelations.push(...typeRelations.relations);

        const exhaustedBudgetMessages = [
          documentation.budgetExhausted
            ? `文档请求预算 ${commandSettings.maxDocumentationRequests} 已用尽`
            : undefined,
          hierarchy.budgetExhausted
            ? `调用层级请求预算 ${commandSettings.maxCallHierarchyRequests} 已用尽`
            : undefined,
          typeRelations.budgetExhausted
            ? `类型关系请求预算 ${
                commandSettings.maxTypeHierarchyRequests ??
                commandSettings.maxCallHierarchyRequests
              } 已用尽`
            : undefined,
          references.budgetExhausted
            ? `引用请求预算 ${commandSettings.maxReferenceRequests} 已用尽`
            : undefined
        ].filter(
          (message): message is string =>
            message !== undefined
        );
        const interruptedEnrichments = [
          documentation.stoppedEarly ? "文档" : undefined,
          hierarchy.stoppedEarly ? "调用层级" : undefined,
          typeRelations.stoppedEarly ? "类型关系" : undefined,
          references.stoppedEarly ? "引用" : undefined
        ].filter(
          (name): name is string => name !== undefined
        );
        const requestBudgetExhausted =
          documentation.budgetExhausted ||
          hierarchy.budgetExhausted ||
          typeRelations.budgetExhausted ||
          references.budgetExhausted;
        const enrichmentStoppedEarly =
          documentation.stoppedEarly ||
          hierarchy.stoppedEarly ||
          typeRelations.stoppedEarly ||
          references.stoppedEarly;
        const semanticRequestBudgetExhausted =
          hierarchy.budgetExhausted ||
          typeRelations.budgetExhausted ||
          references.budgetExhausted;
        const semanticEnrichmentStoppedEarly =
          hierarchy.stoppedEarly ||
          typeRelations.stoppedEarly ||
          references.stoppedEarly;
        const requiredSemanticCapabilityMissing =
          !hierarchy.supported ||
          !references.supported ||
          !typeRelations.supported;
        const semanticCoverage =
          uncoveredDocumentCount > 0 ||
          truncatedSymbolDocuments > 0 ||
          semanticRequestBudgetExhausted ||
          semanticEnrichmentStoppedEarly ||
          requiredSemanticCapabilityMissing
            ? "partial"
            : "complete";

        statuses.push({
          language,
          state: "connected",
          command: commandSettings.command,
          message:
            `${
              didReconnect
                ? "已自动重连，"
                : ""
            }${
              language === "java" &&
              session.recoveredJavaWorkspace
                ? "已自动重建 Java 索引，"
                : ""
            }已连接并增强 ${preparedDocuments.length} 个文件，补充 ${documentation.documented} 条文档、${hierarchy.callCount} 条调用关系、${typeRelations.relationCount} 条类型关系、${references.referenceCount} 条引用关系。${
              skippedByLimitCount > 0
                ? ` 另有 ${skippedByLimitCount} 个文件因 maxDocuments=${documentLimit} 未进入 Language Server 增强。`
                : ""
            }${
              failedDocumentCount > 0
                ? ` ${failedDocumentCount} 个文件的 documentSymbol 请求失败（${failedDocumentMessages
                    .slice(0, 3)
                    .join("；")}${
                    failedDocumentCount > 3
                      ? "；其余省略"
                      : ""
                  }），其余文件仍继续分析。`
                : ""
            }${
              truncatedSymbolDocuments > 0
                ? ` ${truncatedSymbolDocuments} 个文件的符号结果达到每文件 ${commandSettings.maxSymbolsPerDocument} 条数量上限或内部结构安全上限。`
                : ""
            }${
              workspaceSymbols.symbolCount > 0
                ? ` Workspace Symbol 另外补充 ${workspaceSymbols.symbolCount} 个未打开文件符号。`
                : ""
            }${
              workspaceSymbols.truncated
                ? ` Workspace Symbol 结果达到 ${commandSettings.maxSymbolsPerDocument} 条安全上限。`
                : ""
            }${
              workspaceSymbols.failed
                ? " Workspace Symbol 补查失败，未影响已完成的文档分析。"
                : ""
            }${
              exhaustedBudgetMessages.length > 0
                ? ` ${exhaustedBudgetMessages.join("；")}。`
                : ""
            }${
              interruptedEnrichments.length > 0
                ? ` ${interruptedEnrichments.join("、")}增强因连续请求失败提前停止，可在下次分析重试。`
                : ""
            }${
              requiredSemanticCapabilityMissing
                ? " Language Server 未提供全部调用、引用或类型关系能力。"
                : ""
            }`,
          symbolCount,
          semanticCoverage,
          documentsTotal: documents.length,
          documentsAnalyzed: preparedDocuments.length,
          skippedDocuments: uncoveredDocumentCount,
          failedDocuments: failedDocumentCount,
          truncatedDocuments:
            truncatedSymbolDocuments +
            Number(workspaceSymbols.truncated),
          requestBudgetExhausted,
          enrichmentStoppedEarly
        });
        this.#scheduleIdle(
          sessionKey,
          session
        );
      } catch (error) {
        if (input.signal?.aborted) {
          const session = this.#sessions.get(sessionKey);
          if (session?.client.alive) {
            this.#scheduleIdle(sessionKey, session);
          } else {
            await this.#disposeSession(sessionKey);
          }
          throwIfAborted(input.signal);
        }
        const unavailable = isCommandUnavailable(error);
        statuses.push({
          language,
          state: unavailable ? "unavailable" : "failed",
          command: commandSettings.command,
          message: errorMessage(error),
          symbolCount: 0,
          semanticCoverage: "unavailable",
          documentsTotal: documents.length,
          documentsAnalyzed: 0,
          skippedDocuments: documents.length,
          failedDocuments: documents.length,
          truncatedDocuments: 0,
          requestBudgetExhausted: false,
          enrichmentStoppedEarly: true
        });
        warnings.push(
          `${descriptor.displayName} LSP ${
            unavailable ? "不可用" : "执行失败"
          }，${
            input.settings.staticFallback
              ? "已使用内置分析器"
              : "内置分析降级已关闭"
          }：${errorMessage(error)}`
        );
        await this.#disposeSession(sessionKey);
      } finally {
        releaseSession?.();
      }
    }

    return {
      symbolsByPath,
      semanticRelations,
      statuses,
      warnings
    };
  }

  async disposeAll(): Promise<void> {
    const keys = [...this.#sessions.keys()];
    await Promise.all(
      keys.map((key) => this.#disposeSession(key))
    );
  }

  async #acquireSession(
    key: string,
    signal?: AbortSignal
  ): Promise<() => void> {
    throwIfAborted(signal);
    const previous =
      this.#sessionTails.get(key) ?? Promise.resolve();
    const predecessor = previous.catch(() => undefined);
    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolvePromise) => {
      releaseGate = resolvePromise;
    });
    const tail = predecessor.then(() => gate);
    this.#sessionTails.set(key, tail);

    try {
      await waitForPromiseWithSignal(predecessor, signal);
    } catch (error) {
      void predecessor.then(() => releaseGate());
      void tail.then(() => {
        if (this.#sessionTails.get(key) === tail) {
          this.#sessionTails.delete(key);
        }
      });
      throw error;
    }

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      releaseGate();
      void tail.then(() => {
        if (this.#sessionTails.get(key) === tail) {
          this.#sessionTails.delete(key);
        }
      });
    };
  }

  async #getSession(input: {
    key: string;
    language: LanguageServerLanguage;
    commandSettings: LanguageServerCommandSettings;
    rootPath: string;
    workspaceFolders: string[];
    dataDirectory: string;
    timeoutMs: number;
    workspaceReadyTimeoutMs: number;
    signal?: AbortSignal;
  }): Promise<PooledSession> {
    const rootPath = resolve(input.rootPath);
    const workspaceFolders = uniqueResolvedPaths(
      input.workspaceFolders
    );
    const configuredArgs = [...input.commandSettings.args];
    const resolvedLaunch = await resolveLaunchCommand(
      input.commandSettings.command,
      configuredArgs
    );
    const managesJavaData =
      input.language === "java" &&
      !hasJavaDataArgument(configuredArgs);
    const javaDataBaseDirectory = managesJavaData
      ? join(
          input.dataDirectory,
          "java",
          stablePathSegment(
            JSON.stringify({
              key: input.key,
              command: resolvedLaunch.command,
              args: resolvedLaunch.args,
              rootPath,
              workspaceFolders: [...workspaceFolders].sort(
                pathComparison
              )
            })
          )
        )
      : undefined;
    const javaDataWorkspace = javaDataBaseDirectory
      ? await readJavaDataWorkspace(javaDataBaseDirectory)
      : undefined;
    const plan = createLanguageServerLaunchPlan({
      command: resolvedLaunch.command,
      resolvedArgs: resolvedLaunch.args,
      configuredArgs,
      rootPath,
      workspaceFolders,
      ...(javaDataWorkspace ? { javaDataWorkspace } : {})
    });
    const existing = this.#sessions.get(input.key);
    if (
      existing &&
      existing.signature === plan.signature &&
      existing.client.alive
    ) {
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer);
        delete existing.idleTimer;
      }
      return existing;
    }
    if (existing) {
      await this.#disposeSession(input.key);
    }

    try {
      const session = await this.#startSession(
        input,
        plan,
        false
      );
      this.#sessions.set(input.key, session);
      return session;
    } catch (error) {
      if (
        !javaDataWorkspace ||
        !isRecoverableJavaStartupError(error, input.signal)
      ) {
        throw error;
      }

      const recoveryWorkspace =
        await advanceJavaDataWorkspace(javaDataWorkspace);
      const recoveryPlan = createLanguageServerLaunchPlan({
        command: resolvedLaunch.command,
        resolvedArgs: resolvedLaunch.args,
        configuredArgs,
        rootPath,
        workspaceFolders,
        javaDataWorkspace: recoveryWorkspace
      });
      try {
        const session = await this.#startSession(
          input,
          recoveryPlan,
          true
        );
        this.#sessions.set(input.key, session);
        return session;
      } catch (recoveryError) {
        if (
          isRecoverableJavaStartupError(
            recoveryError,
            input.signal
          )
        ) {
          await advanceJavaDataWorkspace(recoveryWorkspace);
        }
        throw new Error(
          "Java Language Server 自动重建索引后仍无法启动。" +
            `首次失败：${errorMessage(error)}；` +
            `恢复失败：${errorMessage(recoveryError)}`,
          { cause: recoveryError }
        );
      }
    }
  }

  async #startSession(
    input: {
      language: LanguageServerLanguage;
      commandSettings: LanguageServerCommandSettings;
      timeoutMs: number;
      workspaceReadyTimeoutMs: number;
      signal?: AbortSignal;
    },
    plan: LanguageServerLaunchPlan,
    recoveredJavaWorkspace: boolean
  ): Promise<PooledSession> {
    const client = new JsonRpcClient(
      input.commandSettings.command,
      plan.args,
      plan.rootPath
    );
    let hoverSupported = false;
    let referencesSupported = false;
    let typeHierarchySupported = false;
    let implementationSupported = false;
    let workspaceSymbolSupported = false;
    try {
      await client.start(input.signal);
      const rootUri = pathToFileURL(
        plan.rootPath
      ).toString();
      const initializeResult = await client.request(
        "initialize",
        {
          processId: process.pid,
          clientInfo: {
            name: "GitNest",
            version: "1.0.0"
          },
          rootUri,
          workspaceFolders: plan.workspaceFolders.map(
            (folder) => ({
              uri: pathToFileURL(folder).toString(),
              name: folder.split(/[\\/]/).at(-1) ?? folder
            })
          ),
          capabilities: {
            textDocument: {
              documentSymbol: {
                hierarchicalDocumentSymbolSupport: true
              },
              hover: {
                dynamicRegistration: false,
                contentFormat: ["markdown", "plaintext"]
              },
              callHierarchy: {
                dynamicRegistration: false
              },
              typeHierarchy: {
                dynamicRegistration: false
              },
              implementation: {
                dynamicRegistration: false,
                linkSupport: true
              },
              references: {
                dynamicRegistration: false
              }
            },
            workspace: {
              workspaceFolders: true,
              symbol: {
                resolveSupport: {
                  properties: ["location.range"]
                }
              }
            },
            window: {
              workDoneProgress: true
            }
          }
        },
        input.timeoutMs,
        input.signal
      );
      hoverSupported =
        serverSupportsHover(initializeResult);
      referencesSupported =
        serverSupportsReferences(initializeResult);
      typeHierarchySupported =
        serverSupportsTypeHierarchy(initializeResult);
      implementationSupported =
        serverSupportsImplementation(initializeResult);
      workspaceSymbolSupported =
        serverSupportsWorkspaceSymbols(initializeResult);
      client.notify("initialized", {});
      if (input.language === "java") {
        await client.waitForJavaServiceReady(
          input.workspaceReadyTimeoutMs,
          input.signal
        );
      }
    } catch (error) {
      try {
        await client.terminate();
      } catch (terminationError) {
        throw new LanguageServerTerminationError(
          `${errorMessage(
            error
          )}；LSP 进程未能在重启前退出：${errorMessage(
            terminationError
          )}`,
          { cause: error }
        );
      }
      throw error;
    }
    return {
      signature: plan.signature,
      client,
      opened: new Map(),
      recoveredJavaWorkspace,
      hoverSupported,
      incomingCallHierarchySupported: true,
      referencesSupported,
      typeHierarchySupported,
      implementationSupported,
      workspaceSymbolSupported
    };
  }

  #scheduleIdle(
    key: string,
    session: PooledSession
  ): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
    }
    session.idleTimer = setTimeout(() => {
      void this.#disposeSession(key);
    }, this.#idleMs);
    session.idleTimer.unref();
  }

  async #disposeSession(key: string): Promise<void> {
    const session = this.#sessions.get(key);
    if (!session) {
      return;
    }
    this.#sessions.delete(key);
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
    }
    await session.client.dispose();
  }

  async #closeSessionDocuments(
    key: string,
    retainedUris: ReadonlySet<string>,
    signal?: AbortSignal
  ): Promise<void> {
    if (!this.#sessions.has(key)) {
      return;
    }
    const release = await this.#acquireSession(key, signal);
    try {
      const session = this.#sessions.get(key);
      if (!session) {
        return;
      }
      if (!session.client.alive) {
        await this.#disposeSession(key);
        return;
      }
      try {
        closeUnusedDocuments(session, retainedUris);
        this.#scheduleIdle(key, session);
      } catch {
        await this.#disposeSession(key);
      }
    } finally {
      release();
    }
  }
}

class LanguageServerTerminationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LanguageServerTerminationError";
  }
}

function createLanguageServerLaunchPlan(input: {
  command: string;
  resolvedArgs: string[];
  configuredArgs: string[];
  rootPath: string;
  workspaceFolders: string[];
  javaDataWorkspace?: JavaDataWorkspace;
}): LanguageServerLaunchPlan {
  const args = [...input.configuredArgs];
  if (input.javaDataWorkspace) {
    args.push(
      "-data",
      input.javaDataWorkspace.dataDirectory
    );
  }
  return {
    signature: JSON.stringify({
      command: input.command,
      resolvedArgs: input.resolvedArgs,
      args,
      rootPath: input.rootPath,
      workspaceFolders: input.workspaceFolders,
      dataDirectory:
        input.javaDataWorkspace?.dataDirectory ?? null
    }),
    args,
    rootPath: input.rootPath,
    workspaceFolders: input.workspaceFolders,
    ...(input.javaDataWorkspace
      ? { javaDataWorkspace: input.javaDataWorkspace }
      : {})
  };
}

async function readJavaDataWorkspace(
  baseDirectory: string
): Promise<JavaDataWorkspace> {
  await mkdir(baseDirectory, { recursive: true });
  let generation = 0;
  try {
    const state = JSON.parse(
      await readFile(
        join(baseDirectory, JAVA_DATA_STATE_FILE),
        "utf8"
      )
    ) as { generation?: unknown };
    if (
      typeof state.generation === "number" &&
      Number.isSafeInteger(state.generation) &&
      state.generation >= 0
    ) {
      generation = state.generation;
    }
  } catch {
    // A missing or incomplete state file starts from generation zero.
  }
  const dataDirectory = join(
    baseDirectory,
    `generation-${generation}`
  );
  await mkdir(dataDirectory, { recursive: true });
  await removeInactiveJavaDataWorkspaces(
    baseDirectory,
    generation
  );
  return {
    baseDirectory,
    generation,
    dataDirectory
  };
}

async function advanceJavaDataWorkspace(
  workspace: JavaDataWorkspace
): Promise<JavaDataWorkspace> {
  const generation = workspace.generation + 1;
  const statePath = join(
    workspace.baseDirectory,
    JAVA_DATA_STATE_FILE
  );
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(
    temporaryPath,
    JSON.stringify({ generation }),
    "utf8"
  );
  await rename(temporaryPath, statePath);
  const dataDirectory = join(
    workspace.baseDirectory,
    `generation-${generation}`
  );
  await mkdir(dataDirectory, { recursive: true });
  await removeInactiveJavaDataWorkspaces(
    workspace.baseDirectory,
    generation
  );
  return {
    baseDirectory: workspace.baseDirectory,
    generation,
    dataDirectory
  };
}

async function removeInactiveJavaDataWorkspaces(
  baseDirectory: string,
  activeGeneration: number
): Promise<void> {
  const entries = await readdir(baseDirectory, {
    withFileTypes: true
  }).catch(() => []);
  await Promise.all(
    entries.flatMap((entry) => {
      const match = /^generation-(\d+)$/.exec(entry.name);
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        !match?.[1] ||
        Number(match[1]) === activeGeneration
      ) {
        return [];
      }
      return [
        rm(join(baseDirectory, entry.name), {
          recursive: true,
          force: true,
          maxRetries: 2,
          retryDelay: 50
        }).catch(() => undefined)
      ];
    })
  );
}

function hasJavaDataArgument(args: readonly string[]): boolean {
  return args.some(
    (value) =>
      value === "-data" ||
      value.toLocaleLowerCase("en-US").startsWith("-data=")
  );
}

function isRecoverableJavaStartupError(
  error: unknown,
  signal?: AbortSignal
): boolean {
  if (
    signal?.aborted ||
    error instanceof LanguageServerTerminationError ||
    isCommandUnavailable(error)
  ) {
    return false;
  }
  const message = errorMessage(error);
  return (
    /请求 initialize (?:超时|失败)/i.test(message) ||
    /initialize.*(?:timeout|timed out)/i.test(message) ||
    /项目导入或索引超过/.test(message) ||
    /Java Language Server 初始化失败/.test(message) ||
    /LSP 进程已退出/.test(message)
  );
}

function isRecoverableLanguageServerConnectionError(
  error: unknown,
  signal?: AbortSignal
): boolean {
  if (
    signal?.aborted ||
    error instanceof LanguageServerTerminationError ||
    isCommandUnavailable(error)
  ) {
    return false;
  }
  const message = errorMessage(error);
  if (
    /(?:安全上限|缺少有效的 Content-Length)/i.test(
      message
    ) ||
    isMethodUnsupported(error)
  ) {
    return false;
  }
  return (
    /LSP 请求 .+ 超时/.test(message) ||
    /LSP 进程(?:已退出|当前不可用)/.test(message) ||
    /(?:timed out|timeout|EPIPE|ECONNRESET|broken pipe|write after end)/i.test(
      message
    ) ||
    /(?:ServerNotInitialized|server not initialized|-32002)/i.test(
      message
    )
  );
}

export function resolveLanguageServerWorkspace(
  language: LanguageServerLanguage,
  documents: ReadonlyArray<{ file: AnalysisSourceFile }>,
  fallbackRootPath: string,
  fallbackWorkspaceFolders: string[]
): { rootPath: string; workspaceFolders: string[] } {
  if (language !== "java") {
    return {
      rootPath: fallbackRootPath,
      workspaceFolders: [...fallbackWorkspaceFolders]
    };
  }

  const workspaceFolders = collapseNestedResolvedPaths(
    documents.map((document) => document.file.rootPath)
  );
  if (workspaceFolders.length === 0) {
    return {
      rootPath: fallbackRootPath,
      workspaceFolders: collapseNestedResolvedPaths(
        fallbackWorkspaceFolders
      )
    };
  }
  return {
    rootPath: workspaceFolders[0]!,
    workspaceFolders
  };
}

export function resolveLanguageServerStartupTimeoutMs(
  language: LanguageServerLanguage,
  requestTimeoutMs: number
): number {
  return language === "java"
    ? Math.max(requestTimeoutMs, JAVA_WARMUP_TIMEOUT_MS)
    : Math.max(
        requestTimeoutMs,
        NON_JAVA_COLD_START_TIMEOUT_MS
      );
}

export function resolveLanguageServerWorkspaceReadyTimeoutMs(
  language: LanguageServerLanguage,
  requestTimeoutMs: number
): number {
  return language === "java"
    ? Math.max(
        requestTimeoutMs,
        JAVA_WORKSPACE_READY_TIMEOUT_MS
      )
    : requestTimeoutMs;
}

function uniqueResolvedPaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of paths) {
    const resolvedPath = resolve(path);
    const key =
      process.platform === "win32"
        ? resolvedPath.toLocaleLowerCase("en-US")
        : resolvedPath;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(resolvedPath);
  }
  return unique;
}

function collapseNestedResolvedPaths(
  paths: readonly string[]
): string[] {
  const candidates = uniqueResolvedPaths(paths).sort(
    (left, right) =>
      pathDepth(left) - pathDepth(right) ||
      pathComparison(left, right)
  );
  const roots: string[] = [];
  for (const candidate of candidates) {
    if (
      roots.some((root) =>
        isSameOrDescendantPath(root, candidate)
      )
    ) {
      continue;
    }
    roots.push(candidate);
  }
  return roots;
}

function isSameOrDescendantPath(
  root: string,
  candidate: string
): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") &&
      !isAbsolute(relativePath))
  );
}

function pathDepth(path: string): number {
  return resolve(path).split(/[\\/]+/).filter(Boolean).length;
}

function pathComparison(left: string, right: string): number {
  const normalizedLeft =
    process.platform === "win32"
      ? left.toLocaleLowerCase("en-US")
      : left;
  const normalizedRight =
    process.platform === "win32"
      ? right.toLocaleLowerCase("en-US")
      : right;
  return normalizedLeft.localeCompare(normalizedRight, "en-US");
}

interface PreparedLspDocument {
  uri: string;
  symbols: LspDocumentSymbol[];
}

interface LspSymbolWorkItem {
  uri: string;
  symbol: LspDocumentSymbol;
}

interface BaseEnrichmentResult {
  attempted: number;
  supported: boolean;
  budgetExhausted: boolean;
  stoppedEarly: boolean;
}

interface DocumentationEnrichmentResult
  extends BaseEnrichmentResult {
  documented: number;
}

interface CallHierarchyEnrichmentResult
  extends BaseEnrichmentResult {
  callCount: number;
}

interface ReferenceEnrichmentResult
  extends BaseEnrichmentResult {
  referenceCount: number;
}

interface TypeRelationEnrichmentResult
  extends BaseEnrichmentResult {
  relationCount: number;
  relations: LspSemanticRelation[];
}

interface WorkspaceSymbolResult {
  symbolsByPath: Map<string, LspDocumentSymbol[]>;
  symbolCount: number;
  supported: boolean;
  truncated: boolean;
  failed: boolean;
}

function emptyDocumentationResult(): DocumentationEnrichmentResult {
  return {
    attempted: 0,
    documented: 0,
    supported: false,
    budgetExhausted: false,
    stoppedEarly: false
  };
}

function emptyReferenceResult(): ReferenceEnrichmentResult {
  return {
    attempted: 0,
    referenceCount: 0,
    supported: false,
    budgetExhausted: false,
    stoppedEarly: false
  };
}

function emptyWorkspaceSymbolResult(): WorkspaceSymbolResult {
  return {
    symbolsByPath: new Map(),
    symbolCount: 0,
    supported: false,
    truncated: false,
    failed: false
  };
}

function roundRobinSymbolWorkItems(
  documents: readonly PreparedLspDocument[],
  selectSymbols: (
    symbols: LspDocumentSymbol[]
  ) => LspDocumentSymbol[]
): LspSymbolWorkItem[] {
  const queues = documents.map((document) => ({
    uri: document.uri,
    symbols: selectSymbols(document.symbols)
  }));
  const maxQueueLength = queues.reduce(
    (maximum, queue) =>
      Math.max(maximum, queue.symbols.length),
    0
  );
  const workItems: LspSymbolWorkItem[] = [];
  for (
    let symbolIndex = 0;
    symbolIndex < maxQueueLength;
    symbolIndex += 1
  ) {
    for (const queue of queues) {
      const symbol = queue.symbols[symbolIndex];
      if (symbol) {
        workItems.push({
          uri: queue.uri,
          symbol
        });
      }
    }
  }
  return workItems;
}

async function enrichWorkspaceSymbols(input: {
  session: PooledSession;
  allowedPaths: ReadonlySet<string>;
  existingPaths: ReadonlySet<string>;
  maxSymbols: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<WorkspaceSymbolResult> {
  try {
    const response = await input.session.client.request(
      "workspace/symbol",
      { query: "" },
      input.timeoutMs,
      input.signal
    );
    const parsed = parseWorkspaceSymbols(
      response,
      input.allowedPaths,
      input.existingPaths,
      input.maxSymbols
    );
    return {
      ...parsed,
      supported: true,
      failed: false
    };
  } catch (error) {
    if (input.signal?.aborted) {
      throw error;
    }
    return {
      ...emptyWorkspaceSymbolResult(),
      supported: !isMethodUnsupported(error),
      failed: !isMethodUnsupported(error)
    };
  }
}

async function enrichCallHierarchy(input: {
  session: PooledSession;
  documents: PreparedLspDocument[];
  budget: number;
  concurrency: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<CallHierarchyEnrichmentResult> {
  let attempted = 0;
  let callCount = 0;
  let consecutiveFailures = 0;
  let unsupported = false;
  let stopRequested = false;
  let stoppedEarly = false;
  const workItems = roundRobinSymbolWorkItems(
    input.documents,
    (symbols) =>
      flattenSymbols(symbols).filter(
        (symbol) =>
          symbol.kind === 6 ||
          symbol.kind === 9 ||
          symbol.kind === 12
      )
  );
  const budget = Math.max(0, Math.floor(input.budget));
  await mapWithConcurrency(
    workItems.slice(0, budget),
    input.concurrency,
    async ({ uri, symbol }) => {
      if (stopRequested) {
        return;
      }
      attempted += 1;
      throwIfAborted(input.signal);
      try {
        const prepared = await input.session.client.request(
          "textDocument/prepareCallHierarchy",
          {
            textDocument: { uri },
            position: {
              line: Math.max(0, symbol.line - 1),
              character: Math.max(0, symbol.character)
            }
          },
          input.timeoutMs,
          input.signal
        );
        const items = callHierarchyItems(prepared);
        for (const item of items) {
          const response = await input.session.client.request(
            "callHierarchy/outgoingCalls",
            { item },
            input.timeoutMs,
            input.signal
          );
          const calls = parseOutgoingCalls(response);
          const previousOutgoingCount =
            symbol.outgoingCalls.length;
          symbol.outgoingCalls = mergeCallReferences(
            symbol.outgoingCalls,
            calls
          );
          callCount +=
            symbol.outgoingCalls.length -
            previousOutgoingCount;
          if (
            input.session.incomingCallHierarchySupported
          ) {
            try {
              const incomingResponse =
                await input.session.client.request(
                  "callHierarchy/incomingCalls",
                  { item },
                  input.timeoutMs,
                  input.signal
                );
              const incomingCalls =
                parseIncomingCalls(incomingResponse);
              const previousIncomingCount =
                symbol.incomingCalls.length;
              symbol.incomingCalls =
                mergeIncomingCallReferences(
                  symbol.incomingCalls,
                  incomingCalls
                );
              callCount +=
                symbol.incomingCalls.length -
                previousIncomingCount;
            } catch (error) {
              if (input.signal?.aborted) {
                throw error;
              }
              if (isMethodUnsupported(error)) {
                input.session.incomingCallHierarchySupported =
                  false;
              }
            }
          }
        }
        consecutiveFailures = 0;
      } catch (error) {
        if (input.signal?.aborted) {
          throw error;
        }
        if (isMethodUnsupported(error)) {
          unsupported = true;
          stopRequested = true;
          return;
        }
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3) {
          stoppedEarly = true;
          stopRequested = true;
        }
      }
    }
  );
  return {
    attempted,
    callCount,
    supported: !unsupported,
    budgetExhausted:
      !unsupported &&
      !stoppedEarly &&
      budget < workItems.length &&
      attempted >= Math.min(budget, workItems.length),
    stoppedEarly
  };
}

async function enrichReferences(input: {
  session: PooledSession;
  documents: PreparedLspDocument[];
  budget: number;
  maxReferencesPerSymbol: number;
  concurrency: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ReferenceEnrichmentResult> {
  let attempted = 0;
  let referenceCount = 0;
  let consecutiveFailures = 0;
  let unsupported = false;
  let stopRequested = false;
  let stoppedEarly = false;
  const workItems = roundRobinSymbolWorkItems(
    input.documents,
    (symbols) =>
      flattenSymbols(symbols)
        .filter((symbol) =>
          isReferenceableSymbolKind(symbol.kind)
        )
        .sort(
          (left, right) =>
            referenceSymbolPriority(left.kind) -
              referenceSymbolPriority(right.kind) ||
            left.line - right.line ||
            left.character - right.character
        )
  );
  const budget = Math.max(0, Math.floor(input.budget));
  await mapWithConcurrency(
    workItems.slice(0, budget),
    input.concurrency,
    async ({ uri, symbol }) => {
      if (stopRequested) {
        return;
      }
      attempted += 1;
      throwIfAborted(input.signal);
      const targetCanonicalPath = canonicalPathFromUri(uri);
      try {
        const response = await input.session.client.request(
          "textDocument/references",
          {
            textDocument: { uri },
            position: {
              line: Math.max(0, symbol.line - 1),
              character: Math.max(0, symbol.character)
            },
            context: {
              includeDeclaration: false
            }
          },
          input.timeoutMs,
          input.signal
        );
        const references = parseReferenceLocations(
          response,
          input.maxReferencesPerSymbol
        ).filter(
          (reference) =>
            !(
              targetCanonicalPath &&
              reference.sourceCanonicalPath ===
                targetCanonicalPath &&
              reference.line === symbol.line &&
              reference.character === symbol.character
            )
        );
        symbol.references = references;
        referenceCount += references.length;
        consecutiveFailures = 0;
      } catch (error) {
        if (input.signal?.aborted) {
          throw error;
        }
        if (isMethodUnsupported(error)) {
          unsupported = true;
          stopRequested = true;
          return;
        }
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3) {
          stoppedEarly = true;
          stopRequested = true;
        }
      }
    }
  );
  return {
    attempted,
    referenceCount,
    supported: !unsupported,
    budgetExhausted:
      !unsupported &&
      !stoppedEarly &&
      budget < workItems.length &&
      attempted >= Math.min(budget, workItems.length),
    stoppedEarly
  };
}

async function enrichTypeRelations(input: {
  session: PooledSession;
  documents: PreparedLspDocument[];
  budget: number;
  concurrency: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<TypeRelationEnrichmentResult> {
  const initiallySupported =
    input.session.typeHierarchySupported ||
    input.session.implementationSupported;
  const relations: LspSemanticRelation[] = [];
  const seen = new Set<string>();
  let attempted = 0;
  let consecutiveFailures = 0;
  let stopRequested = false;
  let stoppedEarly = false;
  const workItems = roundRobinSymbolWorkItems(
    input.documents,
    (symbols) =>
      flattenSymbols(symbols).filter(
        (symbol) =>
          isTypeSymbolKind(symbol.kind) ||
          isCallableLspSymbolKind(symbol.kind)
      )
  );
  if (workItems.length === 0) {
    return {
      attempted: 0,
      relationCount: 0,
      relations: [],
      supported: true,
      budgetExhausted: false,
      stoppedEarly: false
    };
  }
  if (!initiallySupported) {
    return {
      attempted: 0,
      relationCount: 0,
      relations: [],
      supported: false,
      budgetExhausted: false,
      stoppedEarly: false
    };
  }

  const addRelation = (
    relation: LspSemanticRelation
  ): void => {
    const key = [
      relation.kind,
      relation.sourceCanonicalPath,
      String(relation.sourceLine),
      relation.targetCanonicalPath,
      String(relation.targetLine)
    ].join("\0");
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    relations.push(relation);
  };

  const budget = Math.max(0, Math.floor(input.budget));
  await mapWithConcurrency(
    workItems.slice(0, budget),
    input.concurrency,
    async ({ uri, symbol }) => {
      if (
        stopRequested ||
        (
          !input.session.typeHierarchySupported &&
          !input.session.implementationSupported
        )
      ) {
        return;
      }
      attempted += 1;
      throwIfAborted(input.signal);
      let symbolSucceeded = false;
      let symbolFailures = 0;

      if (
        input.session.typeHierarchySupported &&
        isTypeSymbolKind(symbol.kind)
      ) {
        try {
          const prepared =
            await input.session.client.request(
              "textDocument/prepareTypeHierarchy",
              {
                textDocument: { uri },
                position: {
                  line: Math.max(0, symbol.line - 1),
                  character: Math.max(
                    0,
                    symbol.character
                  )
                }
              },
              input.timeoutMs,
              input.signal
            );
          const items = parseTypeHierarchyItems(prepared);
          for (const item of items) {
            const supertypesResponse =
              await input.session.client.request(
                "typeHierarchy/supertypes",
                { item: item.raw },
                input.timeoutMs,
                input.signal
              );
            for (const target of parseTypeHierarchyItems(
              supertypesResponse
            )) {
              addRelation({
                kind: typeRelationKind(
                  item.kind,
                  target.kind
                ),
                sourceName: item.name,
                sourceCanonicalPath: item.canonicalPath,
                sourceLine: item.line,
                targetName: target.name,
                targetCanonicalPath: target.canonicalPath,
                targetLine: target.line,
                evidence:
                  "LSP Type Hierarchy supertypes"
              });
            }

            const subtypesResponse =
              await input.session.client.request(
                "typeHierarchy/subtypes",
                { item: item.raw },
                input.timeoutMs,
                input.signal
              );
            for (const source of parseTypeHierarchyItems(
              subtypesResponse
            )) {
              addRelation({
                kind: typeRelationKind(
                  source.kind,
                  item.kind
                ),
                sourceName: source.name,
                sourceCanonicalPath:
                  source.canonicalPath,
                sourceLine: source.line,
                targetName: item.name,
                targetCanonicalPath:
                  item.canonicalPath,
                targetLine: item.line,
                evidence:
                  "LSP Type Hierarchy subtypes"
              });
            }
          }
          symbolSucceeded = true;
        } catch (error) {
          if (input.signal?.aborted) {
            throw error;
          }
          if (isMethodUnsupported(error)) {
            input.session.typeHierarchySupported = false;
          } else {
            symbolFailures += 1;
          }
        }
      }

      if (input.session.implementationSupported) {
        try {
          const response =
            await input.session.client.request(
              "textDocument/implementation",
              {
                textDocument: { uri },
                position: {
                  line: Math.max(0, symbol.line - 1),
                  character: Math.max(
                    0,
                    symbol.character
                  )
                }
              },
              input.timeoutMs,
              input.signal
            );
          const sourcePath = canonicalPathFromUri(uri);
          if (sourcePath) {
            for (const implementation of parseLocationTargets(
              response
            )) {
              addRelation({
                kind: isCallableLspSymbolKind(symbol.kind)
                  ? "overrides"
                  : symbol.kind === 11
                    ? "implements"
                    : "extends",
                sourceName: symbol.name,
                sourceCanonicalPath:
                  implementation.canonicalPath,
                sourceLine: implementation.line,
                targetName: symbol.name,
                targetCanonicalPath: sourcePath,
                targetLine: symbol.line,
                evidence:
                  "LSP textDocument/implementation"
              });
            }
          }
          symbolSucceeded = true;
        } catch (error) {
          if (input.signal?.aborted) {
            throw error;
          }
          if (isMethodUnsupported(error)) {
            input.session.implementationSupported = false;
          } else {
            symbolFailures += 1;
          }
        }
      }

      if (symbolSucceeded) {
        consecutiveFailures = 0;
      } else {
        consecutiveFailures += symbolFailures;
      }
      if (consecutiveFailures >= 3) {
        stoppedEarly = true;
        stopRequested = true;
      }
    }
  );
  const hasTypeWork = workItems.some(({ symbol }) =>
    isTypeSymbolKind(symbol.kind)
  );
  const hasCallableWork = workItems.some(({ symbol }) =>
    isCallableLspSymbolKind(symbol.kind)
  );
  const supported =
    (
      !hasTypeWork ||
      input.session.typeHierarchySupported ||
      input.session.implementationSupported
    ) &&
    (
      !hasCallableWork ||
      input.session.implementationSupported
    );
  return {
    attempted,
    relationCount: relations.length,
    relations,
    supported,
    budgetExhausted:
      !stoppedEarly &&
      budget < workItems.length &&
      attempted >= Math.min(budget, workItems.length),
    stoppedEarly
  };
}

async function enrichDocumentation(input: {
  session: PooledSession;
  documents: PreparedLspDocument[];
  budget: number;
  concurrency: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<DocumentationEnrichmentResult> {
  let attempted = 0;
  let documented = 0;
  let consecutiveFailures = 0;
  let unsupported = false;
  let stopRequested = false;
  let stoppedEarly = false;
  const workItems = roundRobinSymbolWorkItems(
    input.documents,
    (symbols) =>
      flattenSymbols(symbols)
        .filter(
          (symbol) =>
            symbol.kind === 2 ||
            symbol.kind === 3 ||
            symbol.kind === 4 ||
            symbol.kind === 5 ||
            symbol.kind === 6 ||
            symbol.kind === 7 ||
            symbol.kind === 8 ||
            symbol.kind === 10 ||
            symbol.kind === 11 ||
            symbol.kind === 12
        )
        .sort(
          (left, right) =>
            Number(left.kind === 5) -
            Number(right.kind === 5)
        )
  );
  const budget = Math.max(0, Math.floor(input.budget));
  await mapWithConcurrency(
    workItems.slice(0, budget),
    input.concurrency,
    async ({ uri, symbol }) => {
      if (stopRequested) {
        return;
      }
      attempted += 1;
      throwIfAborted(input.signal);
      try {
        const response = await input.session.client.request(
          "textDocument/hover",
          {
            textDocument: { uri },
            position: {
              line: Math.max(0, symbol.line - 1),
              character: Math.max(0, symbol.character)
            }
          },
          input.timeoutMs,
          input.signal
        );
        const documentation =
          parseHoverDocumentation(response);
        consecutiveFailures = 0;
        if (documentation) {
          symbol.documentation = documentation;
          documented += 1;
        }
      } catch (error) {
        if (input.signal?.aborted) {
          throw error;
        }
        if (isMethodUnsupported(error)) {
          unsupported = true;
          stopRequested = true;
          return;
        }
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3) {
          stoppedEarly = true;
          stopRequested = true;
        }
      }
    }
  );
  return {
    attempted,
    documented,
    supported: !unsupported,
    budgetExhausted:
      !unsupported &&
      !stoppedEarly &&
      budget < workItems.length &&
      attempted >= Math.min(budget, workItems.length),
    stoppedEarly
  };
}

function flattenSymbols(
  symbols: LspDocumentSymbol[]
): LspDocumentSymbol[] {
  return symbols.flatMap((symbol) => [
    symbol,
    ...flattenSymbols(symbol.children)
  ]);
}

function isTypeSymbolKind(kind: number): boolean {
  return (
    kind === 5 ||
    kind === 10 ||
    kind === 11 ||
    kind === 23
  );
}

function isCallableLspSymbolKind(kind: number): boolean {
  return kind === 6 || kind === 9 || kind === 12;
}

function isReferenceableSymbolKind(kind: number): boolean {
  return (
    kind === 5 ||
    kind === 6 ||
    kind === 7 ||
    kind === 8 ||
    kind === 9 ||
    kind === 10 ||
    kind === 11 ||
    kind === 12 ||
    kind === 13 ||
    kind === 14 ||
    kind === 22 ||
    kind === 23
  );
}

function referenceSymbolPriority(kind: number): number {
  return kind === 7 ||
    kind === 8 ||
    kind === 13 ||
    kind === 14 ||
    kind === 22
    ? 0
    : kind === 5 ||
        kind === 10 ||
        kind === 11 ||
        kind === 23
      ? 1
      : 2;
}

function callHierarchyItems(
  value: unknown
): Record<string, unknown>[] {
  const candidates = Array.isArray(value) ? value : [value];
  return candidates.filter(isRecord);
}

function mergeCallReferences(
  existing: LspCallReference[],
  incoming: LspCallReference[]
): LspCallReference[] {
  return mergeByKey(
    existing,
    incoming,
    (item) =>
      `${item.name}\0${item.line}\0${
        item.targetCanonicalPath ?? ""
      }\0${item.targetLine ?? ""}`
  );
}

function mergeIncomingCallReferences(
  existing: LspIncomingCallReference[],
  incoming: LspIncomingCallReference[]
): LspIncomingCallReference[] {
  return mergeByKey(
    existing,
    incoming,
    (item) =>
      `${item.name}\0${item.line}\0${
        item.sourceCanonicalPath ?? ""
      }\0${item.sourceLine ?? ""}`
  );
}

function mergeByKey<Item>(
  existing: Item[],
  incoming: Item[],
  keyFor: (item: Item) => string
): Item[] {
  const merged = [...existing];
  const seen = new Set(existing.map(keyFor));
  for (const item of incoming) {
    const key = keyFor(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

interface ParsedTypeHierarchyItem {
  name: string;
  kind: number;
  canonicalPath: string;
  line: number;
  raw: Record<string, unknown>;
}

function parseTypeHierarchyItems(
  value: unknown
): ParsedTypeHierarchyItem[] {
  const candidates = Array.isArray(value) ? value : [value];
  return candidates.flatMap((candidate) => {
    if (!isRecord(candidate)) {
      return [];
    }
    const name = candidate.name;
    const kind = candidate.kind;
    const uri = candidate.uri;
    const range = isRecord(candidate.selectionRange)
      ? candidate.selectionRange
      : isRecord(candidate.range)
        ? candidate.range
        : undefined;
    const start =
      range && isRecord(range.start)
        ? range.start
        : undefined;
    if (
      typeof name !== "string" ||
      !Number.isSafeInteger(kind) ||
      typeof uri !== "string" ||
      !start ||
      !isNonNegativeSafeInteger(start.line)
    ) {
      return [];
    }
    const canonicalPath = canonicalPathFromUri(uri);
    if (!canonicalPath) {
      return [];
    }
    return [
      {
        name,
        kind: kind as number,
        canonicalPath,
        line: start.line + 1,
        raw: candidate
      }
    ];
  });
}

interface ParsedLocationTarget {
  canonicalPath: string;
  line: number;
}

function parseLocationTargets(
  value: unknown
): ParsedLocationTarget[] {
  const candidates = Array.isArray(value) ? value : [value];
  const targets: ParsedLocationTarget[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      continue;
    }
    const uri =
      typeof candidate.targetUri === "string"
        ? candidate.targetUri
        : typeof candidate.uri === "string"
          ? candidate.uri
          : undefined;
    const range = isRecord(candidate.targetSelectionRange)
      ? candidate.targetSelectionRange
      : isRecord(candidate.targetRange)
        ? candidate.targetRange
        : isRecord(candidate.range)
          ? candidate.range
          : undefined;
    const start =
      range && isRecord(range.start)
        ? range.start
        : undefined;
    if (
      !uri ||
      !start ||
      !isNonNegativeSafeInteger(start.line)
    ) {
      continue;
    }
    const canonicalPath = canonicalPathFromUri(uri);
    if (!canonicalPath) {
      continue;
    }
    const line = start.line + 1;
    const key = `${canonicalPath}\0${line}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    targets.push({ canonicalPath, line });
  }
  return targets;
}

function typeRelationKind(
  sourceKind: number,
  targetKind: number
): LspSemanticRelation["kind"] {
  return (
    (
      sourceKind === 5 ||
      sourceKind === 10 ||
      sourceKind === 23
    ) &&
    targetKind === 11
  )
    ? "implements"
    : "extends";
}

function parseOutgoingCalls(
  value: unknown
): LspCallReference[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate) => {
    if (!isRecord(candidate) || !isRecord(candidate.to)) {
      return [];
    }
    const target = candidate.to;
    const name = target.name;
    const uri = target.uri;
    const selectionRange = isRecord(target.selectionRange)
      ? target.selectionRange
      : isRecord(target.range)
        ? target.range
        : undefined;
    const targetStart =
      selectionRange && isRecord(selectionRange.start)
        ? selectionRange.start
        : undefined;
    const sourceRange = Array.isArray(candidate.fromRanges)
      ? candidate.fromRanges.find(isRecord)
      : undefined;
    const sourceStart =
      sourceRange && isRecord(sourceRange.start)
        ? sourceRange.start
        : undefined;
    if (typeof name !== "string") {
      return [];
    }
    const targetCanonicalPath =
      typeof uri === "string"
        ? canonicalPathFromUri(uri)
        : undefined;
    return [
      {
        name,
        line:
          sourceStart && typeof sourceStart.line === "number"
            ? sourceStart.line + 1
            : 1,
        ...(targetCanonicalPath
          ? { targetCanonicalPath }
          : {}),
        ...(targetStart &&
        typeof targetStart.line === "number"
          ? { targetLine: targetStart.line + 1 }
          : {})
      }
    ];
  });
}

export function parseIncomingCalls(
  value: unknown
): LspIncomingCallReference[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate) => {
    if (!isRecord(candidate) || !isRecord(candidate.from)) {
      return [];
    }
    const source = candidate.from;
    const name = source.name;
    const uri = source.uri;
    const selectionRange = isRecord(source.selectionRange)
      ? source.selectionRange
      : isRecord(source.range)
        ? source.range
        : undefined;
    const sourceStart =
      selectionRange && isRecord(selectionRange.start)
        ? selectionRange.start
        : undefined;
    const callRange = Array.isArray(candidate.fromRanges)
      ? candidate.fromRanges.find(isRecord)
      : undefined;
    const callStart =
      callRange && isRecord(callRange.start)
        ? callRange.start
        : undefined;
    if (typeof name !== "string") {
      return [];
    }
    const sourceCanonicalPath =
      typeof uri === "string"
        ? canonicalPathFromUri(uri)
        : undefined;
    return [
      {
        name,
        line:
          callStart && typeof callStart.line === "number"
            ? callStart.line + 1
            : sourceStart &&
                typeof sourceStart.line === "number"
              ? sourceStart.line + 1
              : 1,
        ...(sourceCanonicalPath
          ? { sourceCanonicalPath }
          : {}),
        ...(sourceStart &&
        typeof sourceStart.line === "number"
          ? { sourceLine: sourceStart.line + 1 }
          : {})
      }
    ];
  });
}

export function parseReferenceLocations(
  value: unknown,
  maxReferences = DEFAULT_LSP_REFERENCES_PER_SYMBOL
): LspReferenceLocation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const references: LspReferenceLocation[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      typeof candidate.uri !== "string" ||
      !isRecord(candidate.range) ||
      !isRecord(candidate.range.start)
    ) {
      continue;
    }
    const start = candidate.range.start;
    if (
      !isNonNegativeSafeInteger(start.line) ||
      !isNonNegativeSafeInteger(start.character)
    ) {
      continue;
    }
    const sourceCanonicalPath = canonicalPathFromUri(
      candidate.uri
    );
    if (!sourceCanonicalPath) {
      continue;
    }
    const line = start.line + 1;
    const character = start.character;
    const key = `${sourceCanonicalPath}\0${line}\0${character}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    references.push({
      sourceCanonicalPath,
      line,
      character
    });
    if (
      references.length >= maxReferences
    ) {
      break;
    }
  }
  return references;
}

function canonicalPathFromUri(
  uri: string
): string | undefined {
  try {
    const path = resolve(fileURLToPath(uri));
    return process.platform === "win32"
      ? path.toLocaleLowerCase("en-US")
      : path;
  } catch {
    return undefined;
  }
}

function isMethodUnsupported(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    message.includes("-32601") ||
    /method not found|not supported/i.test(message)
  );
}

function serverSupportsHover(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isRecord(value.capabilities)
  ) {
    return false;
  }
  const provider = value.capabilities.hoverProvider;
  return provider === true || isRecord(provider);
}

function serverSupportsReferences(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isRecord(value.capabilities)
  ) {
    return false;
  }
  const provider = value.capabilities.referencesProvider;
  return provider === true || isRecord(provider);
}

function serverSupportsTypeHierarchy(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isRecord(value.capabilities)
  ) {
    return false;
  }
  const provider = value.capabilities.typeHierarchyProvider;
  return provider === true || isRecord(provider);
}

function serverSupportsImplementation(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isRecord(value.capabilities)
  ) {
    return false;
  }
  const provider = value.capabilities.implementationProvider;
  return provider === true || isRecord(provider);
}

function serverSupportsWorkspaceSymbols(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isRecord(value.capabilities)
  ) {
    return false;
  }
  const provider = value.capabilities.workspaceSymbolProvider;
  return provider === true || isRecord(provider);
}

export class JsonRpcClient {
  readonly #command: string;
  readonly #args: string[];
  readonly #cwd: string;
  #process: ChildProcessWithoutNullStreams | undefined;
  #buffer = Buffer.alloc(0);
  #nextId = 0;
  #pending = new Map<
    number,
    {
      method: string;
      resolve(value: unknown): void;
      reject(reason: unknown): void;
      timer: NodeJS.Timeout;
    }
  >();
  readonly #lastNotifications = new Map<string, unknown>();
  readonly #notificationWaiters = new Map<
    string,
    Set<NotificationWaiter>
  >();
  #expectsJavaServiceReady = false;
  #exitError: Error | undefined;
  #stderr = "";
  #writeTail: Promise<void> = Promise.resolve();
  #queuedWriteBytes = 0;

  constructor(command: string, args: string[], cwd: string) {
    this.#command = command;
    this.#args = args;
    this.#cwd = cwd;
  }

  get alive(): boolean {
    return Boolean(
      this.#process &&
        this.#process.exitCode === null &&
        !this.#process.killed
    );
  }

  async start(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const launch = await resolveLaunchCommand(
      this.#command,
      this.#args
    );
    this.#expectsJavaServiceReady =
      isJdtlsLaunch(this.#command, this.#args) ||
      isJdtlsLaunch(launch.command, launch.args);
    throwIfAborted(signal);
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn(launch.command, launch.args, {
        cwd: this.#cwd,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
      this.#process = child;
      const onAbort = () => {
        child.kill();
        rejectPromise(
          signal?.reason ?? new Error("LSP start cancelled.")
        );
      };
      signal?.addEventListener("abort", onAbort, {
        once: true
      });
      child.once("spawn", () => {
        signal?.removeEventListener("abort", onAbort);
        resolvePromise();
      });
      child.once("error", (error) => {
        this.#exitError = error;
        signal?.removeEventListener("abort", onAbort);
        rejectPromise(error);
      });
      child.stdout.on("data", (chunk: Buffer) =>
        this.#consume(chunk)
      );
      child.stderr.on("data", (chunk: Buffer) => {
        this.#stderr = `${this.#stderr}${chunk.toString(
          "utf8"
        )}`.slice(-2_000);
      });
      child.stdin.on("error", () => {
        // A timed-out or cancelled request can race with process shutdown.
      });
      child.once("exit", (code, exitSignal) => {
        const reason =
          this.#exitError ??
          new Error(
            `LSP 进程已退出（code=${String(
              code
            )}, signal=${String(exitSignal)}）${
              this.#stderr.trim()
                ? `：${this.#stderr.trim()}`
                : ""
            }`
          );
        this.#exitError = reason;
        this.#rejectOutstanding(reason);
      });
    });
  }

  request(
    method: string,
    params: unknown,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<unknown> {
    throwIfAborted(signal);
    if (this.#exitError) {
      return Promise.reject(this.#exitError);
    }
    if (!this.alive) {
      return Promise.reject(
        new Error("LSP 进程当前不可用。")
      );
    }
    const id = ++this.#nextId;
    return new Promise((resolvePromise, rejectPromise) => {
      let timer: NodeJS.Timeout;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.#pending.delete(id);
      };
      const onAbort = () => {
        cleanup();
        this.notify("$/cancelRequest", { id });
        rejectPromise(
          signal?.reason ??
            new Error(`LSP 请求 ${method} 已取消。`)
        );
      };
      timer = setTimeout(() => {
        cleanup();
        this.notify("$/cancelRequest", { id });
        rejectPromise(
          new Error(`LSP 请求 ${method} 超时。`)
        );
      }, timeoutMs);
      signal?.addEventListener("abort", onAbort, {
        once: true
      });
      this.#pending.set(id, {
        method,
        resolve: (value) => {
          cleanup();
          resolvePromise(value);
        },
        reject: (reason) => {
          cleanup();
          rejectPromise(reason);
        },
        timer
      });
      try {
        this.#send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        cleanup();
        rejectPromise(error);
      }
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.alive) {
      return;
    }
    try {
      this.#send({ jsonrpc: "2.0", method, params });
    } catch {
      // Notifications are best effort when the process exits concurrently.
    }
  }

  async waitForJavaServiceReady(
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<void> {
    throwIfAborted(signal);
    if (this.#exitError) {
      throw this.#exitError;
    }
    let status = this.#lastNotifications.get(
      "language/status"
    );
    if (isJavaServiceReadyStatus(status)) {
      return;
    }
    throwIfJavaServiceError(status);

    if (this.#expectsJavaServiceReady) {
      const terminalStatus =
        await this.#waitForJavaServiceTerminalStatus(
          timeoutMs,
          signal
        );
      throwIfJavaServiceError(terminalStatus);
      return;
    }

    if (!this.#lastNotifications.has("language/status")) {
      status = await this.#waitForNotification(
        "language/status",
        isJavaLanguageStatus,
        Math.min(
          JAVA_STATUS_DISCOVERY_TIMEOUT_MS,
          timeoutMs
        ),
        signal
      );
      if (status === undefined) {
        // Non-JDT Java servers may not implement this custom
        // notification. The first document request still receives
        // the longer Java workspace warm-up timeout.
        return;
      }
      if (isJavaServiceReadyStatus(status)) {
        return;
      }
      throwIfJavaServiceError(status);
    }

    const terminalStatus =
      await this.#waitForJavaServiceTerminalStatus(
        timeoutMs,
        signal
      );
    throwIfJavaServiceError(terminalStatus);
  }

  async #waitForJavaServiceTerminalStatus(
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<unknown> {
    const terminalStatus = await this.#waitForNotification(
      "language/status",
      (params) =>
        isJavaServiceReadyStatus(params) ||
        isJavaServiceErrorStatus(params),
      timeoutMs,
      signal
    );
    if (terminalStatus === undefined) {
      throw new Error(
        `Java Language Server 项目导入或索引超过 ${Math.ceil(
          timeoutMs / 1_000
        )} 秒。`
      );
    }
    return terminalStatus;
  }

  async terminate(): Promise<void> {
    const child = this.#process;
    if (!child || child.exitCode !== null) {
      return;
    }
    child.kill();
    if (await waitForChildExit(child, 3_000)) {
      return;
    }
    child.kill("SIGKILL");
    if (!(await waitForChildExit(child, 2_000))) {
      throw new Error("LSP 进程在强制终止后仍未退出。");
    }
  }

  async dispose(): Promise<void> {
    const child = this.#process;
    if (!child || child.exitCode !== null) {
      return;
    }
    if (this.alive) {
      try {
        await this.request("shutdown", null, 1_500);
        this.notify("exit", null);
        if (await waitForChildExit(child, 1_500)) {
          return;
        }
      } catch {
        // The process is terminated below when graceful shutdown fails.
      }
    }
    await this.terminate();
  }

  #send(message: unknown): void {
    if (!this.alive || !this.#process) {
      throw new Error("LSP 进程当前不可用。");
    }
    const body = Buffer.from(
      JSON.stringify(message),
      "utf8"
    );
    if (body.byteLength > MAX_LSP_MESSAGE_BYTES) {
      throw new Error(
        `LSP 消息超过安全上限 ${MAX_LSP_MESSAGE_BYTES} 字节。`
      );
    }
    const header = Buffer.from(
      `Content-Length: ${body.byteLength}\r\n\r\n`,
      "ascii"
    );
    const frame = Buffer.concat([header, body]);
    if (
      this.#queuedWriteBytes + frame.byteLength >
      MAX_LSP_QUEUED_WRITE_BYTES
    ) {
      const error = new Error(
        "LSP 写入队列超过安全上限。"
      );
      this.#failProtocol(error);
      throw error;
    }

    const child = this.#process;
    this.#queuedWriteBytes += frame.byteLength;
    const write = this.#writeTail
      .catch(() => undefined)
      .then(async () => {
        if (
          child.exitCode !== null ||
          child.killed ||
          this.#process !== child
        ) {
          throw (
            this.#exitError ??
            new Error("LSP 进程当前不可用。")
          );
        }
        await writeFrame(child.stdin, frame);
      })
      .finally(() => {
        this.#queuedWriteBytes -= frame.byteLength;
      });
    this.#writeTail = write;
    void write.catch((error) => {
      this.#failProtocol(
        error instanceof Error
          ? error
          : new Error(String(error))
      );
    });
  }

  #consume(chunk: Buffer): void {
    if (
      chunk.byteLength >
      MAX_LSP_BUFFER_BYTES - this.#buffer.byteLength
    ) {
      this.#failProtocol(
        new Error("LSP 输入缓冲区超过安全上限。")
      );
      return;
    }
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    while (true) {
      const headerEnd = this.#buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        if (this.#buffer.byteLength > MAX_LSP_HEADER_BYTES) {
          this.#failProtocol(
            new Error("LSP 消息头超过安全上限。")
          );
        }
        return;
      }
      if (headerEnd > MAX_LSP_HEADER_BYTES) {
        this.#failProtocol(
          new Error("LSP 消息头超过安全上限。")
        );
        return;
      }
      const header = this.#buffer
        .subarray(0, headerEnd)
        .toString("ascii");
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(
        header
      );
      if (!lengthMatch?.[1]) {
        this.#failProtocol(
          new Error("LSP 消息缺少有效的 Content-Length。")
        );
        return;
      }
      const length = Number(lengthMatch[1]);
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_LSP_MESSAGE_BYTES
      ) {
        this.#failProtocol(
          new Error("LSP 消息长度超过安全上限。")
        );
        return;
      }
      const bodyStart = headerEnd + 4;
      if (this.#buffer.length < bodyStart + length) {
        return;
      }
      const body = this.#buffer
        .subarray(bodyStart, bodyStart + length)
        .toString("utf8");
      this.#buffer = this.#buffer.subarray(
        bodyStart + length
      );
      this.#handleMessage(body);
    }
  }

  #failProtocol(error: Error): void {
    if (!this.#exitError) {
      this.#exitError = error;
    }
    this.#buffer = Buffer.alloc(0);
    this.#rejectOutstanding(this.#exitError);
    const child = this.#process;
    if (
      child &&
      child.exitCode === null &&
      !child.killed
    ) {
      child.kill();
    }
  }

  #rejectOutstanding(reason: Error): void {
    for (const pending of [...this.#pending.values()]) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.#pending.clear();
    this.#lastNotifications.clear();
    for (const waiters of this.#notificationWaiters.values()) {
      for (const waiter of [...waiters]) {
        waiter.reject(reason);
      }
    }
    this.#notificationWaiters.clear();
  }

  #handleMessage(body: string): void {
    let message: unknown;
    try {
      message = JSON.parse(body);
    } catch {
      return;
    }
    if (!message || typeof message !== "object") {
      return;
    }
    const input = message as Record<string, unknown>;
    const id = input.id;
    if (id === undefined) {
      if (typeof input.method === "string") {
        this.#handleNotification(
          input.method,
          input.params
        );
      }
      return;
    }
    if (typeof id !== "number" && typeof id !== "string") {
      return;
    }
    const pending =
      typeof id === "number"
        ? this.#pending.get(id)
        : undefined;
    if (pending) {
      clearTimeout(pending.timer);
      this.#pending.delete(id as number);
      if (input.error) {
        pending.reject(
          new Error(
            `LSP 请求 ${pending.method} 失败：${JSON.stringify(
              input.error
            )}`
          )
        );
        return;
      }
      pending.resolve(input.result);
      return;
    }
    if (typeof input.method !== "string") {
      return;
    }
    const response = serverRequestResponse(
      input.method,
      input.params,
      this.#cwd
    );
    try {
      if (response.ok) {
        this.#send({
          jsonrpc: "2.0",
          id,
          result: response.result
        });
      } else {
        this.#send({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Method not supported by GitNest: ${input.method}`
          }
        });
      }
    } catch {
      // The server request raced with process shutdown.
    }
  }

  #handleNotification(
    method: string,
    params: unknown
  ): void {
    if (method === "tsserver/request") {
      const requestId = vueTsserverRequestId(params);
      if (requestId !== undefined) {
        // Vue Language Server 3.x asks an editor-hosted
        // TypeScript plugin for project metadata. GitNest does not
        // host tsserver, so an explicit null response selects the
        // server's standalone language-service fallback instead of
        // leaving the document request pending forever.
        this.notify("tsserver/response", [
          [requestId, null]
        ]);
      }
    }
    if (method === "language/status") {
      const retained = retainJavaLanguageStatus(params);
      if (retained) {
        this.#lastNotifications.set(method, retained);
      }
    }
    const waiters = this.#notificationWaiters.get(method);
    if (!waiters) {
      return;
    }
    for (const waiter of [...waiters]) {
      try {
        if (waiter.predicate(params)) {
          waiter.resolve(params);
        }
      } catch (error) {
        waiter.reject(error);
      }
    }
  }

  #waitForNotification(
    method: string,
    predicate: (params: unknown) => boolean,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<unknown | undefined> {
    throwIfAborted(signal);
    if (this.#exitError) {
      return Promise.reject(this.#exitError);
    }
    if (!this.alive) {
      return Promise.reject(
        new Error("LSP 进程当前不可用。")
      );
    }
    if (
      this.#lastNotifications.has(method) &&
      predicate(this.#lastNotifications.get(method))
    ) {
      return Promise.resolve(
        this.#lastNotifications.get(method)
      );
    }

    return new Promise((resolvePromise, rejectPromise) => {
      let timer: NodeJS.Timeout | undefined;
      const waiters =
        this.#notificationWaiters.get(method) ??
        new Set<NotificationWaiter>();
      this.#notificationWaiters.set(method, waiters);

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
        }
        signal?.removeEventListener("abort", onAbort);
        waiters.delete(waiter);
        if (waiters.size === 0) {
          this.#notificationWaiters.delete(method);
        }
      };
      const onAbort = () => {
        waiter.reject(
          signal?.reason instanceof Error
            ? signal.reason
            : new Error("Code analysis was cancelled.")
        );
      };
      const waiter: NotificationWaiter = {
        predicate,
        resolve: (value) => {
          cleanup();
          resolvePromise(value);
        },
        reject: (reason) => {
          cleanup();
          rejectPromise(reason);
        }
      };
      waiters.add(waiter);
      timer = setTimeout(() => {
        waiter.resolve(undefined);
      }, timeoutMs);
      signal?.addEventListener("abort", onAbort, {
        once: true
      });
    });
  }
}

async function resolveLaunchCommand(
  command: string,
  args: string[]
): Promise<{ command: string; args: string[] }> {
  if (process.platform !== "win32") {
    return { command, args };
  }
  const commandFromPath = await findWindowsCommand(command);
  if (
    !commandFromPath &&
    isUnqualifiedCommand(command, "jdtls")
  ) {
    const editorJdtls =
      await resolveWindowsEditorJdtls(args);
    if (editorJdtls) {
      return editorJdtls;
    }
  }
  const resolvedCommand = commandFromPath ?? command;
  if (!/\.(?:cmd|bat)$/i.test(resolvedCommand)) {
    return {
      command: resolvedCommand,
      args
    };
  }
  const nodeShim = await resolveNodeCommandShim(
    resolvedCommand,
    args
  );
  if (nodeShim) {
    return nodeShim;
  }
  throw new Error(
    `无法在无 Shell 模式下安全启动 LSP 命令 ${resolvedCommand}。` +
      "请配置实际可执行文件，或显式配置解释器及脚本参数。"
  );
}

function isJdtlsLaunch(
  command: string,
  args: readonly string[]
): boolean {
  return [command, ...args].some((value) =>
    basename(value).toLocaleLowerCase("en-US").includes("jdtls")
  );
}

function isUnqualifiedCommand(
  command: string,
  expectedBasename: string
): boolean {
  return (
    !isAbsolute(command) &&
    !/[\\/]/.test(command) &&
    command.toLocaleLowerCase("en-US") ===
      expectedBasename.toLocaleLowerCase("en-US")
  );
}

export async function resolveWindowsEditorJdtls(
  args: string[],
  extensionRoots = windowsEditorExtensionRoots()
): Promise<
  { command: string; args: string[] } | undefined
> {
  const extensionDirectories = (
    await Promise.all(
      extensionRoots.map(async (root) => {
        try {
          const entries = await readdir(root, {
            withFileTypes: true
          });
          return entries
            .filter(
              (entry) =>
                entry.isDirectory() &&
                entry.name
                  .toLocaleLowerCase("en-US")
                  .startsWith("redhat.java-")
            )
            .map((entry) => join(root, entry.name));
        } catch {
          return [];
        }
      })
    )
  )
    .flat()
    .sort((left, right) =>
      compareExtensionVersions(right, left)
    );

  for (const extensionDirectory of extensionDirectories) {
    const launch = await resolveJdtlsExtensionLaunch(
      extensionDirectory,
      args
    );
    if (launch) {
      return launch;
    }
  }
  return undefined;
}

function windowsEditorExtensionRoots(): string[] {
  const profile =
    process.env.USERPROFILE ?? process.env.HOME;
  if (!profile) {
    return [];
  }
  return [
    join(profile, ".vscode", "extensions"),
    join(profile, ".vscode-insiders", "extensions"),
    join(profile, ".cursor", "extensions"),
    join(profile, ".windsurf", "extensions")
  ];
}

async function resolveJdtlsExtensionLaunch(
  extensionDirectory: string,
  args: string[]
): Promise<
  { command: string; args: string[] } | undefined
> {
  const serverDirectory = join(
    extensionDirectory,
    "server"
  );
  const configurationDirectory = join(
    serverDirectory,
    "config_win"
  );
  const javaCommand = await findEmbeddedJavaCommand(
    extensionDirectory
  );
  const launcher = await findEquinoxLauncher(
    serverDirectory
  );
  if (
    !javaCommand ||
    !launcher ||
    !(await pathExists(configurationDirectory))
  ) {
    return undefined;
  }

  const javaMajorVersion = embeddedJavaMajorVersion(
    javaCommand
  );
  const compatibilityArgs =
    javaMajorVersion !== undefined &&
    javaMajorVersion >= 24
      ? [
          "-Djdk.xml.maxGeneralEntitySizeLimit=0",
          "-Djdk.xml.totalEntitySizeLimit=0"
        ]
      : [];
  return {
    command: javaCommand,
    args: [
      ...compatibilityArgs,
      "-Declipse.application=org.eclipse.jdt.ls.core.id1",
      "-Dosgi.bundles.defaultStartLevel=4",
      "-Declipse.product=org.eclipse.jdt.ls.core.product",
      "-Dosgi.checkConfiguration=true",
      `-Dosgi.sharedConfiguration.area=${configurationDirectory}`,
      "-Dosgi.sharedConfiguration.area.readOnly=true",
      "-Dosgi.configuration.cascaded=true",
      "-Xms100m",
      "-Xmx2G",
      "--add-modules=ALL-SYSTEM",
      "--add-opens",
      "java.base/java.util=ALL-UNNAMED",
      "--add-opens",
      "java.base/java.lang=ALL-UNNAMED",
      "-jar",
      launcher,
      ...args
    ]
  };
}

async function findEmbeddedJavaCommand(
  extensionDirectory: string
): Promise<string | undefined> {
  const jreDirectory = join(extensionDirectory, "jre");
  const directCandidate = join(
    jreDirectory,
    "bin",
    "java.exe"
  );
  if (await pathExists(directCandidate)) {
    return resolve(directCandidate);
  }
  try {
    const entries = await readdir(jreDirectory, {
      withFileTypes: true
    });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) =>
        compareNumericVersions(right, left)
      );
    for (const directory of directories) {
      const candidate = join(
        jreDirectory,
        directory,
        "bin",
        "java.exe"
      );
      if (await pathExists(candidate)) {
        return resolve(candidate);
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function findEquinoxLauncher(
  serverDirectory: string
): Promise<string | undefined> {
  const pluginsDirectory = join(
    serverDirectory,
    "plugins"
  );
  const directCandidate = join(
    pluginsDirectory,
    "org.eclipse.equinox.launcher.jar"
  );
  if (await pathExists(directCandidate)) {
    return resolve(directCandidate);
  }
  try {
    const entries = await readdir(pluginsDirectory, {
      withFileTypes: true
    });
    const launcher = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          /^org\.eclipse\.equinox\.launcher_.*\.jar$/i.test(
            entry.name
          )
      )
      .map((entry) => entry.name)
      .sort((left, right) =>
        compareNumericVersions(right, left)
      )[0];
    return launcher
      ? resolve(pluginsDirectory, launcher)
      : undefined;
  } catch {
    return undefined;
  }
}

function compareExtensionVersions(
  left: string,
  right: string
): number {
  return compareNumericVersions(
    basename(left).replace(/^redhat\.java-/i, ""),
    basename(right).replace(/^redhat\.java-/i, "")
  );
}

function compareNumericVersions(
  left: string,
  right: string
): number {
  const leftParts = left
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number);
  const rightParts = right
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number);
  const length = Math.max(
    leftParts.length,
    rightParts.length
  );
  for (let index = 0; index < length; index += 1) {
    const difference =
      (leftParts[index] ?? 0) -
      (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.localeCompare(right);
}

function embeddedJavaMajorVersion(
  javaCommand: string
): number | undefined {
  const versionDirectory = basename(
    dirname(dirname(javaCommand))
  );
  const match = /^(\d+)/.exec(versionDirectory);
  return match?.[1] ? Number(match[1]) : undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findWindowsCommand(
  command: string
): Promise<string | undefined> {
  const hasDirectory =
    isAbsolute(command) || /[\\/]/.test(command);
  const directories = hasDirectory
    ? [""]
    : (process.env.PATH ?? "")
        .split(delimiter)
        .map((entry) =>
          entry.trim().replace(/^"(.*)"$/, "$1")
        )
        .filter(Boolean);
  const extensions = extname(command)
    ? [""]
    : (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .map((entry) => entry.trim())
        .filter(Boolean);
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = hasDirectory
        ? `${command}${extension}`
        : join(directory, `${command}${extension}`);
      try {
        await access(candidate);
        return resolve(candidate);
      } catch {
        // Continue with the next PATH/PATHEXT candidate.
      }
    }
  }
  return undefined;
}

export async function resolveNodeCommandShim(
  shimPath: string,
  args: string[]
): Promise<{ command: string; args: string[] } | undefined> {
  let contents: string;
  try {
    contents = await readFile(shimPath, "utf8");
  } catch {
    return undefined;
  }
  const matches = [
    ...contents.matchAll(
      /"([^"\r\n]+\.(?:mjs|cjs|js))"\s+%\*/gi
    )
  ];
  const scriptExpression = matches[0]?.[1];
  if (!scriptExpression) {
    return undefined;
  }
  const shimDirectory = dirname(shimPath);
  const declaresDp0Alias =
    /^\s*SET\s+"?dp0=%~dp0"?\s*$/im.test(contents);
  let expanded = scriptExpression.replace(
    /%~dp0/gi,
    `${shimDirectory}\\`
  );
  if (declaresDp0Alias) {
    expanded = expanded.replace(
      /%dp0%/gi,
      `${shimDirectory}\\`
    );
  }
  if (expanded.includes("%")) {
    return undefined;
  }
  const scriptPath = isAbsolute(expanded)
    ? resolve(expanded)
    : resolve(shimDirectory, expanded);
  try {
    await access(scriptPath);
  } catch {
    return undefined;
  }
  const localNode = join(shimDirectory, "node.exe");
  let nodeCommand: string | undefined;
  try {
    await access(localNode);
    nodeCommand = localNode;
  } catch {
    nodeCommand = await findWindowsCommand("node.exe");
  }
  if (!nodeCommand) {
    return undefined;
  }
  return {
    command: nodeCommand,
    args: [scriptPath, ...args]
  };
}

function serverRequestResponse(
  method: string,
  params: unknown,
  cwd: string
):
  | { ok: true; result: unknown }
  | { ok: false } {
  if (method === "workspace/configuration") {
    const itemCount =
      isRecord(params) && Array.isArray(params.items)
        ? params.items.length
        : 0;
    return {
      ok: true,
      result: Array.from({ length: itemCount }, () => null)
    };
  }
  if (method === "workspace/workspaceFolders") {
    return {
      ok: true,
      result: [
        {
          uri: pathToFileURL(cwd).toString(),
          name: basename(cwd)
        }
      ]
    };
  }
  if (method === "workspace/applyEdit") {
    return {
      ok: true,
      result: {
        applied: false,
        failureReason:
          "GitNest code analysis keeps Workspace source read-only."
      }
    };
  }
  if (
    method === "client/registerCapability" ||
    method === "client/unregisterCapability" ||
    method === "window/workDoneProgress/create" ||
    method === "window/showMessageRequest" ||
    method === "workspace/executeClientCommand" ||
    method === "workspace/semanticTokens/refresh" ||
    method === "workspace/inlayHint/refresh" ||
    method === "workspace/codeLens/refresh" ||
    method === "workspace/diagnostic/refresh"
  ) {
    return { ok: true, result: null };
  }
  return { ok: false };
}

function vueTsserverRequestId(
  params: unknown
): number | string | undefined {
  if (!Array.isArray(params)) {
    return undefined;
  }
  const tuple =
    params.length === 1 && Array.isArray(params[0])
      ? params[0]
      : params;
  const requestId = tuple[0];
  return typeof requestId === "number" ||
    typeof requestId === "string"
    ? requestId
    : undefined;
}

async function openOrUpdateDocument(
  session: PooledSession,
  uri: string,
  document: SourceDocument,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<void> {
  const hash = createHash("sha1")
    .update(document.content)
    .digest("hex");
  const previous = session.opened.get(uri);
  if (!previous) {
    session.client.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: resolveLspLanguageId(
          document.file.language
        ),
        version: 1,
        text: document.content
      }
    });
    session.opened.set(uri, { version: 1, hash });
    return;
  }
  if (previous.hash === hash) {
    return;
  }
  throwIfAborted(signal);
  const version = previous.version + 1;
  session.client.notify("textDocument/didChange", {
    textDocument: { uri, version },
    contentChanges: [{ text: document.content }]
  });
  session.opened.set(uri, { version, hash });
  await delayWithSignal(Math.min(timeoutMs, 80), signal);
}

function closeUnusedDocuments(
  session: PooledSession,
  retainedUris: ReadonlySet<string>
): void {
  for (const uri of session.opened.keys()) {
    if (retainedUris.has(uri)) {
      continue;
    }
    session.client.notify("textDocument/didClose", {
      textDocument: { uri }
    });
    session.opened.delete(uri);
  }
}

export function parseDocumentSymbols(
  value: unknown,
  maxSymbols = DEFAULT_LSP_SYMBOLS_PER_DOCUMENT
): {
  symbols: LspDocumentSymbol[];
  truncated: boolean;
} {
  const budget = {
    remaining: maxSymbols,
    truncated: false
  };
  if (!Array.isArray(value)) {
    return { symbols: [], truncated: false };
  }
  const symbols: LspDocumentSymbol[] = [];
  for (const candidate of value) {
    if (budget.remaining <= 0) {
      budget.truncated = true;
      break;
    }
    symbols.push(
      ...parseDocumentSymbol(candidate, budget, 0)
    );
  }
  return {
    symbols,
    truncated: budget.truncated
  };
}

export function parseWorkspaceSymbols(
  value: unknown,
  allowedPaths: ReadonlySet<string>,
  existingPaths: ReadonlySet<string> = new Set(),
  maxSymbols = DEFAULT_LSP_SYMBOLS_PER_DOCUMENT
): {
  symbolsByPath: Map<string, LspDocumentSymbol[]>;
  symbolCount: number;
  truncated: boolean;
} {
  const symbolsByPath = new Map<
    string,
    LspDocumentSymbol[]
  >();
  if (!Array.isArray(value) || maxSymbols <= 0) {
    return {
      symbolsByPath,
      symbolCount: 0,
      truncated: Array.isArray(value) && value.length > 0
    };
  }
  let symbolCount = 0;
  let truncated = false;
  const seen = new Set<string>();
  for (const candidate of value) {
    if (symbolCount >= maxSymbols) {
      truncated = true;
      break;
    }
    if (!isRecord(candidate)) {
      continue;
    }
    const location = isRecord(candidate.location)
      ? candidate.location
      : candidate;
    const uri =
      typeof location.uri === "string"
        ? location.uri
        : undefined;
    const range = isRecord(location.range)
      ? location.range
      : undefined;
    const start =
      range && isRecord(range.start)
        ? range.start
        : undefined;
    const end =
      range && isRecord(range.end)
        ? range.end
        : undefined;
    const name = candidate.name;
    const kind = candidate.kind;
    if (
      typeof name !== "string" ||
      !Number.isSafeInteger(kind) ||
      !uri ||
      !start ||
      !end ||
      !isNonNegativeSafeInteger(start.line) ||
      !isNonNegativeSafeInteger(end.line)
    ) {
      continue;
    }
    const canonicalPath = canonicalPathFromUri(uri);
    if (
      !canonicalPath ||
      !allowedPaths.has(canonicalPath) ||
      existingPaths.has(canonicalPath)
    ) {
      continue;
    }
    const character = isNonNegativeSafeInteger(start.character)
      ? start.character
      : 0;
    const key = `${canonicalPath}\0${name}\0${kind}\0${
      start.line
    }\0${character}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const symbol: LspDocumentSymbol = {
      name: name.slice(0, MAX_LSP_SYMBOL_NAME_CHARACTERS),
      kind: kind as number,
      line: start.line + 1,
      character,
      endLine: end.line + 1,
      ...(isNonNegativeSafeInteger(end.character)
        ? { endCharacter: end.character }
        : {}),
      ...(typeof candidate.containerName === "string" &&
      candidate.containerName
        ? {
            containerName: candidate.containerName.slice(
              0,
              MAX_LSP_SYMBOL_NAME_CHARACTERS
            )
          }
        : {}),
      children: [],
      outgoingCalls: [],
      incomingCalls: [],
      references: []
    };
    const existing = symbolsByPath.get(canonicalPath) ?? [];
    existing.push(symbol);
    symbolsByPath.set(canonicalPath, existing);
    symbolCount += 1;
  }
  return { symbolsByPath, symbolCount, truncated };
}

function parseDocumentSymbol(
  value: unknown,
  budget: {
    remaining: number;
    truncated: boolean;
  },
  depth: number
): LspDocumentSymbol[] {
  if (
    budget.remaining <= 0 ||
    depth > MAX_LSP_SYMBOL_DEPTH
  ) {
    budget.truncated = true;
    return [];
  }
  budget.remaining -= 1;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return [];
  }
  const input = value as Record<string, unknown>;
  const name = input.name;
  const kind = input.kind;
  const detail =
    typeof input.detail === "string"
      ? input.detail.slice(
          0,
          MAX_LSP_SYMBOL_NAME_CHARACTERS
        )
      : undefined;
  const range = isRecord(input.range)
    ? input.range
    : isRecord(input.location) &&
        isRecord(input.location.range)
      ? input.location.range
      : undefined;
  const selectionRange = isRecord(input.selectionRange)
    ? input.selectionRange
    : undefined;
  const start =
    selectionRange && isRecord(selectionRange.start)
      ? selectionRange.start
      : range && isRecord(range.start)
        ? range.start
        : undefined;
  const end =
    range && isRecord(range.end) ? range.end : undefined;
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    typeof kind !== "number" ||
    !Number.isSafeInteger(kind) ||
    !start ||
    !end ||
    !isNonNegativeSafeInteger(start.line) ||
    !isNonNegativeSafeInteger(end.line)
  ) {
    return [];
  }
  const children: LspDocumentSymbol[] = [];
  if (Array.isArray(input.children)) {
    for (const child of input.children) {
      if (budget.remaining <= 0) {
        budget.truncated = true;
        break;
      }
      children.push(
        ...parseDocumentSymbol(
          child,
          budget,
          depth + 1
        )
      );
    }
  }
  return [
    {
      name: name.slice(0, MAX_LSP_SYMBOL_NAME_CHARACTERS),
      kind,
      line: start.line + 1,
      character:
        isNonNegativeSafeInteger(start.character)
          ? start.character
          : 0,
      endLine: end.line + 1,
      ...(isNonNegativeSafeInteger(end.character)
        ? { endCharacter: end.character }
        : {}),
      ...(detail ? { detail } : {}),
      children,
      outgoingCalls: [],
      incomingCalls: [],
      references: []
    }
  ];
}

function isNonNegativeSafeInteger(
  value: unknown
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function parseHoverDocumentation(
  value: unknown
): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const contents = value.contents;
  const entries = Array.isArray(contents)
    ? contents
    : [contents];
  const fragments = entries.flatMap((entry) => {
    if (typeof entry === "string") {
      return [entry];
    }
    if (!isRecord(entry)) {
      return [];
    }
    if (
      typeof entry.language === "string" &&
      typeof entry.value === "string"
    ) {
      return [];
    }
    return typeof entry.value === "string"
      ? [entry.value]
      : [];
  });
  const normalized = fragments
    .map(normalizeHoverDocumentation)
    .filter(
      (fragment): fragment is string =>
        Boolean(fragment)
    );
  if (normalized.length === 0) {
    return undefined;
  }
  return [...new Set(normalized)]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CODE_DOCUMENTATION_CHARACTERS);
}

function normalizeHoverDocumentation(
  value: string
): string | undefined {
  const withoutCode = value
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  const rawLines = withoutCode.split(/\r?\n/);
  const separatorIndex = rawLines.findIndex((line) =>
    /^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(line)
  );
  const lines =
    separatorIndex >= 0
      ? rawLines.slice(separatorIndex + 1)
      : rawLines;
  const description: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine
      .trim()
      .replace(
        /\[([^\]]+)\]\((?:[^()]|\([^()]*\))+\)/g,
        "$1"
      )
      .replace(/^[#>*+-]+\s*/, "")
      .replace(/[`*_~]/g, "")
      .trim();
    if (!line) {
      if (description.length > 0) {
        break;
      }
      continue;
    }
    if (line.startsWith("@") && description.length > 0) {
      break;
    }
    description.push(line);
  }
  const documentation = description
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    !documentation ||
    /^(?:function|class|interface|enum)\s+[\w$]+(?:<[^>]+>)?\s*(?:\([^)]*\))?(?:\s*:\s*.+)?$/.test(
      documentation
    )
  ) {
    return undefined;
  }
  return documentation.slice(
    0,
    MAX_CODE_DOCUMENTATION_CHARACTERS
  );
}

function countSymbols(symbols: LspDocumentSymbol[]): number {
  return symbols.reduce(
    (total, symbol) =>
      total + 1 + countSymbols(symbol.children),
    0
  );
}

export function resolveLspLanguageId(
  language: CodeAnalysisLanguage
): string {
  return {
    typescript: "typescript",
    javascript: "javascript",
    vue: "vue",
    java: "java",
    python: "python",
    go: "go",
    kotlin: "kotlin",
    csharp: "csharp",
    rust: "rust"
  }[language];
}

function languageServerSettings(
  settings: CodeAnalysisSettings,
  language: LanguageServerLanguage
): LanguageServerCommandSettings {
  if (language === "typescript") {
    return settings.typescript;
  }
  if (language === "java") {
    return settings.java;
  }
  return (
    settings[language] ??
    OPTIONAL_LANGUAGE_SERVER_DEFAULTS[language]
  );
}

function stablePathSegment(value: string): string {
  return createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, 24);
}

function isCommandUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return Boolean(
    value && typeof value === "object" && !Array.isArray(value)
  );
}

function isJavaLanguageStatus(
  value: unknown
): value is Record<string, unknown> & { type: string } {
  return isRecord(value) && typeof value.type === "string";
}

function retainJavaLanguageStatus(
  value: unknown
): Record<string, unknown> | undefined {
  if (!isJavaLanguageStatus(value)) {
    return undefined;
  }
  return {
    type: value.type.slice(0, MAX_LSP_STATUS_TYPE_CHARACTERS),
    ...(typeof value.message === "string"
      ? {
          message: value.message.slice(
            0,
            MAX_LSP_STATUS_MESSAGE_CHARACTERS
          )
        }
      : {})
  };
}

function isJavaServiceReadyStatus(
  value: unknown
): boolean {
  return (
    isJavaLanguageStatus(value) &&
    value.type === "ServiceReady"
  );
}

function isJavaServiceErrorStatus(
  value: unknown
): value is Record<string, unknown> & { type: "Error" } {
  return (
    isJavaLanguageStatus(value) && value.type === "Error"
  );
}

function throwIfJavaServiceError(value: unknown): void {
  if (!isJavaServiceErrorStatus(value)) {
    return;
  }
  const detail =
    typeof value.message === "string" && value.message.trim()
      ? `：${value.message.trim()}`
      : "";
  throw new Error(
    `Java Language Server 初始化失败${detail}`
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Code analysis was cancelled.");
  }
}

function waitForPromiseWithSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  throwIfAborted(signal);
  if (!signal) {
    return promise;
  }
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      rejectPromise(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("Code analysis was cancelled.")
      );
    };
    signal.addEventListener("abort", onAbort, {
      once: true
    });
    void promise.then(
      (value) => {
        cleanup();
        resolvePromise(value);
      },
      (error) => {
        cleanup();
        rejectPromise(error);
      }
    );
  });
}

function waitForChildExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number
): Promise<boolean> {
  if (
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolvePromise) => {
    const onExit = () => {
      clearTimeout(timer);
      resolvePromise(true);
    };
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolvePromise(
        child.exitCode !== null ||
          child.signalCode !== null
      );
    }, timeoutMs);
    timer.unref();
    child.once("exit", onExit);
  });
}

function writeFrame(
  stdin: ChildProcessWithoutNullStreams["stdin"],
  frame: Buffer
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    stdin.write(frame, (error) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise();
    });
  });
}

function delayWithSignal(
  milliseconds: number,
  signal?: AbortSignal
): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolvePromise, rejectPromise) => {
    let timer: NodeJS.Timeout;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      rejectPromise(
        signal?.reason ?? new Error("Operation cancelled.")
      );
    };
    timer = setTimeout(() => {
      cleanup();
      resolvePromise();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, {
      once: true
    });
  });
}

async function mapWithConcurrency<Item, Result>(
  items: readonly Item[],
  requestedConcurrency: number,
  worker: (item: Item, index: number) => Promise<Result>
): Promise<Result[]> {
  if (items.length === 0) {
    return [];
  }
  const concurrency = Math.min(
    items.length,
    Math.max(
      1,
      Number.isSafeInteger(requestedConcurrency)
        ? requestedConcurrency
        : 1
    )
  );
  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        const item = items[index];
        if (item === undefined) {
          continue;
        }
        results[index] = await worker(item, index);
      }
    })
  );
  return results;
}
