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
  LanguageServerStatus,
  LspAnalysisResult,
  LspCallReference,
  LspDocumentSymbol
} from "./model";

interface SourceDocument {
  file: AnalysisSourceFile;
  content: string;
}

interface PooledSession {
  signature: string;
  client: JsonRpcClient;
  opened: Map<string, { version: number; hash: string }>;
  recoveredJavaWorkspace: boolean;
  hoverSupported: boolean;
  idleTimer?: NodeJS.Timeout;
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

const JAVA_WARMUP_TIMEOUT_MS = 120_000;
const JAVA_WORKSPACE_READY_TIMEOUT_MS = 5 * 60_000;
const JAVA_STATUS_DISCOVERY_TIMEOUT_MS = 2_000;
const JAVA_DATA_STATE_FILE = "active-generation.json";
const MAX_LSP_HEADER_BYTES = 64 * 1_024;
const MAX_LSP_MESSAGE_BYTES = 16 * 1_024 * 1_024;
const MAX_LSP_BUFFER_BYTES = 32 * 1_024 * 1_024;
const MAX_LSP_QUEUED_WRITE_BYTES = 32 * 1_024 * 1_024;
const MAX_LSP_STATUS_TYPE_CHARACTERS = 128;
const MAX_LSP_STATUS_MESSAGE_CHARACTERS = 2_048;
const MAX_LSP_SYMBOLS_PER_DOCUMENT = 5_000;
const MAX_LSP_SYMBOL_DEPTH = 64;
const MAX_LSP_SYMBOL_NAME_CHARACTERS = 1_024;

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

    for (const language of [
      "typescript",
      "java"
    ] as const) {
      const documents = input.documents.filter((document) =>
        belongsToLsp(language, document.file.language)
      );
      const commandSettings =
        language === "typescript"
          ? input.settings.typescript
          : input.settings.java;
      if (!commandSettings.enabled) {
        statuses.push({
          language,
          state: "disabled",
          command: commandSettings.command,
          message: "已在设置中禁用。",
          symbolCount: 0
        });
        continue;
      }
      if (documents.length === 0) {
        statuses.push({
          language,
          state: "disabled",
          command: commandSettings.command,
          message: "当前范围没有对应语言文件。",
          symbolCount: 0
        });
        continue;
      }

      const sessionKey = `${input.sessionPrefix}:${language}`;
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
          : requestTimeoutMs;
      let releaseSession: (() => void) | undefined;
      try {
        releaseSession = await this.#acquireSession(
          sessionKey,
          input.signal
        );
        const session = await this.#getSession({
          key: sessionKey,
          language,
          commandSettings,
          rootPath: workspace.rootPath,
          workspaceFolders: workspace.workspaceFolders,
          dataDirectory: input.lspDataDirectory,
          timeoutMs: startupTimeoutMs,
          workspaceReadyTimeoutMs,
          ...(input.signal ? { signal: input.signal } : {})
        });
        let symbolCount = 0;
        let hierarchyCallCount = 0;
        let documentationCount = 0;
        let truncatedSymbolDocuments = 0;
        let hierarchyRequestBudget =
          language === "java" ? 40 : 50;
        let documentationRequestBudget =
          language === "java" ? 40 : 50;
        let hierarchySupported = true;
        let hoverSupported = session.hoverSupported;
        const documentLimit =
          language === "java" ? 80 : 120;
        const orderedDocuments = [...documents].sort(
          (left, right) =>
            Number(
              input.priorityPaths?.has(
                right.file.canonicalPath
              ) ?? false
            ) -
              Number(
                input.priorityPaths?.has(
                  left.file.canonicalPath
                ) ?? false
              ) ||
            Number(right.file.changed) -
              Number(left.file.changed)
        );
        const selectedDocuments = orderedDocuments.slice(
          0,
          documentLimit
        );
        for (
          let documentIndex = 0;
          documentIndex < selectedDocuments.length;
          documentIndex += 1
        ) {
          const document = selectedDocuments[documentIndex];
          if (!document) {
            continue;
          }
          throwIfAborted(input.signal);
          const uri = pathToFileURL(
            document.file.absolutePath
          ).toString();
          await openOrUpdateDocument(
            session,
            uri,
            document,
            requestTimeoutMs,
            input.signal
          );
          const response = await session.client.request(
            "textDocument/documentSymbol",
            {
              textDocument: { uri }
            },
            documentIndex === 0
              ? firstDocumentTimeoutMs
              : requestTimeoutMs,
            input.signal
          );
          const parsedSymbols =
            parseDocumentSymbols(response);
          const symbols = parsedSymbols.symbols;
          if (parsedSymbols.truncated) {
            truncatedSymbolDocuments += 1;
          }
          if (
            hoverSupported &&
            documentationRequestBudget > 0
          ) {
            const documentation =
              await enrichDocumentation({
                session,
                uri,
                symbols,
                budget: documentationRequestBudget,
                timeoutMs: requestTimeoutMs,
                ...(input.signal
                  ? { signal: input.signal }
                  : {})
              });
            documentationRequestBudget -=
              documentation.attempted;
            documentationCount +=
              documentation.documented;
            hoverSupported = documentation.supported;
            session.hoverSupported =
              documentation.supported;
          }
          if (
            hierarchySupported &&
            hierarchyRequestBudget > 0
          ) {
            const hierarchy = await enrichCallHierarchy({
              session,
              uri,
              symbols,
              budget: hierarchyRequestBudget,
              timeoutMs: requestTimeoutMs,
              ...(input.signal
                ? { signal: input.signal }
                : {})
            });
            hierarchyRequestBudget -= hierarchy.attempted;
            hierarchyCallCount += hierarchy.callCount;
            hierarchySupported = hierarchy.supported;
          }
          symbolCount += countSymbols(symbols);
          symbolsByPath.set(
            document.file.canonicalPath,
            symbols
          );
        }
        statuses.push({
          language,
          state: "connected",
          command: commandSettings.command,
          message:
            `${
              language === "java" &&
              session.recoveredJavaWorkspace
                ? "已自动重建 Java 索引，"
                : ""
            }${
              documents.length > documentLimit
                ? `已连接，按性能上限增强前 ${documentLimit} 个文件，并补充 ${documentationCount} 条文档、${hierarchyCallCount} 条调用关系。`
                : `已连接并完成符号增强，补充 ${documentationCount} 条文档、${hierarchyCallCount} 条调用关系。`
            }${
              truncatedSymbolDocuments > 0
                ? ` ${truncatedSymbolDocuments} 个文件的符号结果达到每文件 ${MAX_LSP_SYMBOLS_PER_DOCUMENT} 条安全上限。`
                : ""
            }`,
          symbolCount
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
          symbolCount: 0
        });
        warnings.push(
          `${language === "typescript" ? "TypeScript" : "Java"} LSP ${
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

    return { symbolsByPath, statuses, warnings };
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
    language: "typescript" | "java";
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
      language: "typescript" | "java";
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
      hoverSupported
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

export function resolveLanguageServerWorkspace(
  language: "typescript" | "java",
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
  language: "typescript" | "java",
  requestTimeoutMs: number
): number {
  return language === "java"
    ? Math.max(requestTimeoutMs, JAVA_WARMUP_TIMEOUT_MS)
    : requestTimeoutMs;
}

export function resolveLanguageServerWorkspaceReadyTimeoutMs(
  language: "typescript" | "java",
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

async function enrichCallHierarchy(input: {
  session: PooledSession;
  uri: string;
  symbols: LspDocumentSymbol[];
  budget: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<{
  attempted: number;
  callCount: number;
  supported: boolean;
}> {
  let attempted = 0;
  let callCount = 0;
  const callableSymbols = flattenSymbols(input.symbols).filter(
    (symbol) => symbol.kind === 6 || symbol.kind === 12
  );
  for (const symbol of callableSymbols) {
    if (attempted >= input.budget) {
      break;
    }
    attempted += 1;
    throwIfAborted(input.signal);
    try {
      const prepared = await input.session.client.request(
        "textDocument/prepareCallHierarchy",
        {
          textDocument: { uri: input.uri },
          position: {
            line: Math.max(0, symbol.line - 1),
            character: Math.max(0, symbol.character)
          }
        },
        input.timeoutMs,
        input.signal
      );
      const item = firstCallHierarchyItem(prepared);
      if (!item) {
        continue;
      }
      const response = await input.session.client.request(
        "callHierarchy/outgoingCalls",
        { item },
        input.timeoutMs,
        input.signal
      );
      const calls = parseOutgoingCalls(response);
      symbol.outgoingCalls = calls;
      callCount += calls.length;
    } catch (error) {
      if (isMethodUnsupported(error)) {
        return {
          attempted,
          callCount,
          supported: false
        };
      }
    }
  }
  return {
    attempted,
    callCount,
    supported: true
  };
}

async function enrichDocumentation(input: {
  session: PooledSession;
  uri: string;
  symbols: LspDocumentSymbol[];
  budget: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<{
  attempted: number;
  documented: number;
  supported: boolean;
}> {
  let attempted = 0;
  let documented = 0;
  let consecutiveFailures = 0;
  const documentableSymbols = flattenSymbols(
    input.symbols
  )
    .filter(
      (symbol) =>
        symbol.kind === 5 ||
        symbol.kind === 6 ||
        symbol.kind === 12
    )
    .sort(
      (left, right) =>
        Number(left.kind === 5) -
        Number(right.kind === 5)
    );
  for (const symbol of documentableSymbols) {
    if (attempted >= input.budget) {
      break;
    }
    attempted += 1;
    throwIfAborted(input.signal);
    try {
      const response = await input.session.client.request(
        "textDocument/hover",
        {
          textDocument: { uri: input.uri },
          position: {
            line: Math.max(0, symbol.line - 1),
            character: Math.max(0, symbol.character)
          }
        },
        Math.min(input.timeoutMs, 2_000),
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
        return {
          attempted,
          documented,
          supported: false
        };
      }
      consecutiveFailures += 1;
      if (
        isRequestTimeout(error, "textDocument/hover") ||
        consecutiveFailures >= 3
      ) {
        return {
          attempted,
          documented,
          supported: false
        };
      }
    }
  }
  return {
    attempted,
    documented,
    supported: true
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

function firstCallHierarchyItem(
  value: unknown
): Record<string, unknown> | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return isRecord(candidate) ? candidate : undefined;
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

function isRequestTimeout(
  error: unknown,
  method: string
): boolean {
  return errorMessage(error).includes(
    `LSP 请求 ${method} 超时`
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
        languageId: languageId(document.file.language),
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

export function parseDocumentSymbols(
  value: unknown
): {
  symbols: LspDocumentSymbol[];
  truncated: boolean;
} {
  const budget = {
    remaining: MAX_LSP_SYMBOLS_PER_DOCUMENT,
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
      children,
      outgoingCalls: []
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

function belongsToLsp(
  lsp: "typescript" | "java",
  language: CodeAnalysisLanguage
): boolean {
  return lsp === "java"
    ? language === "java"
    : language !== "java";
}

function languageId(language: CodeAnalysisLanguage): string {
  return {
    typescript: "typescript",
    javascript: "javascript",
    vue: "vue",
    java: "java"
  }[language];
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
