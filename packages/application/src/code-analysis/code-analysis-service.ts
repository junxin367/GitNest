import {
  AnalysisSnapshotCache,
  CodeAnalysisEngine,
  codeAnalysisSnapshotConfigurationKey,
  type CodeAnalysisProgress,
  type CodeAnalysisScope,
  type CodeAnalysisSettings,
  type CodeAnalysisSnapshot,
  type CodeAnalysisSnapshotStore,
  type CodeAnalysisStats
} from "@gitnest/code-analysis";
import {
  readFile as readTextFile,
  realpath,
  stat
} from "node:fs/promises";
import {
  isAbsolute,
  relative,
  resolve,
  sep
} from "node:path";
import type {
  GitClient,
  RepositorySnapshot
} from "@gitnest/git-core";
import {
  WorkspaceError,
  listEntryTargets,
  repositoryTargetKey,
  type Workspace,
  type WorkspaceEntry,
  type WorkspaceWorktree
} from "@gitnest/workspace-core";

interface WorkspaceReader {
  getCurrent(): Promise<Workspace>;
}

export interface CodeAnalysisState {
  state:
    | "idle"
    | "running"
    | "ready"
    | "failed"
    | "cancelled";
  snapshotAvailable: boolean;
  analysisId?: string;
  workspaceId?: string;
  entryId?: string;
  entryName?: string;
  scope?: CodeAnalysisScope;
  progress?: CodeAnalysisProgress;
  generatedAt?: string;
  stats?: CodeAnalysisStats;
  error?: {
    code:
      | "INVALID_REQUEST"
      | "DIRECTORY_UNAVAILABLE"
      | "COMMAND_CANCELLED"
      | "COMMAND_FAILED";
    message: string;
    details: Readonly<
      Record<string, string | number | boolean>
    >;
  };
}

export interface CodeAnalysisAccepted {
  analysisId: string;
}

export interface CodeAnalysisFile {
  nodeId: string;
  path: string;
  language:
    | "typescript"
    | "javascript"
    | "vue"
    | "java";
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
}

export interface CodeAnalysisServiceOptions {
  cacheDirectory: string;
  lspDataDirectory: string;
  settingsProvider(): Promise<CodeAnalysisSettings>;
  idFactory?: () => string;
  engine?: Pick<CodeAnalysisEngine, "analyze" | "dispose">;
  snapshotStore?: CodeAnalysisSnapshotStore;
}

type StateListener = (state: CodeAnalysisState) => void;
const MAX_CODE_FILE_BYTES = 4 * 1_024 * 1_024;
const MAX_CODE_FILE_LINES = 600;

export class CodeAnalysisService {
  readonly #workspace: WorkspaceReader;
  readonly #git: Pick<GitClient, "readRepositorySnapshot">;
  readonly #cacheDirectory: string;
  readonly #lspDataDirectory: string;
  readonly #settingsProvider: () => Promise<CodeAnalysisSettings>;
  readonly #idFactory: () => string;
  readonly #engine: Pick<
    CodeAnalysisEngine,
    "analyze" | "dispose"
  >;
  readonly #snapshotStore: CodeAnalysisSnapshotStore;
  readonly #listeners = new Set<StateListener>();
  #state: CodeAnalysisState = {
    state: "idle",
    snapshotAvailable: false
  };
  #snapshot: CodeAnalysisSnapshot | null = null;
  #snapshotConfigurationKey = "";
  #runQueue: Promise<void> = Promise.resolve();
  #selectionKey = "";
  #selectionGeneration = 0;
  #hydratedCacheKey = "";
  #restore:
    | {
        cacheKey: string;
        task: Promise<void>;
      }
    | undefined;
  #disposed = false;
  #active:
    | {
        analysisId: string;
        entryKey: string;
        controller: AbortController;
      }
    | undefined;

  constructor(
    workspace: WorkspaceReader,
    git: Pick<GitClient, "readRepositorySnapshot">,
    options: CodeAnalysisServiceOptions
  ) {
    this.#workspace = workspace;
    this.#git = git;
    this.#cacheDirectory = options.cacheDirectory;
    this.#lspDataDirectory = options.lspDataDirectory;
    this.#settingsProvider = options.settingsProvider;
    this.#idFactory =
      options.idFactory ??
      (() =>
        `analysis_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 10)}`);
    this.#engine = options.engine ?? new CodeAnalysisEngine();
    this.#snapshotStore =
      options.snapshotStore ??
      new AnalysisSnapshotCache(options.cacheDirectory);
  }

  async getState(): Promise<CodeAnalysisState> {
    const [workspace, settings] = await Promise.all([
      this.#workspace.getCurrent(),
      this.#settingsProvider()
    ]);
    await this.#ensureSnapshotHydrated(
      workspace,
      settings
    );
    return cloneState(this.#state);
  }

  subscribe(listener: StateListener): () => void {
    this.#listeners.add(listener);
    try {
      listener(cloneState(this.#state));
    } catch {
      // A closed renderer must not interrupt analysis state management.
    }
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async start(
    scope: CodeAnalysisScope
  ): Promise<CodeAnalysisAccepted> {
    const settings = await this.#settingsProvider();
    if (!settings.enabled) {
      throw new WorkspaceError(
        "INVALID_REQUEST",
        "Code analysis is disabled in application settings."
      );
    }
    const workspace = await this.#workspace.getCurrent();
    const context = resolveAnalysisContext(workspace);
    await this.#ensureSnapshotHydrated(
      workspace,
      settings,
      context
    );
    const selectionKey = analysisSelectionKey(
      workspace,
      context
    );

    if (this.#active) {
      this.#active.controller.abort(
        new AnalysisCancelledError(
          "A newer code analysis replaced the running task."
        )
      );
    }

    const analysisId = this.#idFactory();
    const controller = new AbortController();
    this.#active = {
      analysisId,
      entryKey: selectionKey,
      controller
    };
    this.#setState({
      state: "running",
      snapshotAvailable:
        this.#snapshot?.workspaceId === workspace.id &&
        this.#snapshot.entryId === context.entry.id,
      analysisId,
      workspaceId: workspace.id,
      entryId: context.entry.id,
      entryName: context.entry.displayName,
      scope,
      progress: {
        stage: "discovering",
        completed: 0,
        total: 1,
        message: "正在准备代码分析"
      }
    });

    const queuedRun = this.#runQueue
      .catch(() => undefined)
      .then(async () => {
        if (this.#active?.analysisId !== analysisId) {
          return;
        }
        await this.#run({
          analysisId,
          workspace,
          context,
          scope,
          settings,
          selectionKey,
          controller
        });
      });
    this.#runQueue = queuedRun;
    void queuedRun;
    return { analysisId };
  }

  cancel(analysisId: string): void {
    if (
      !this.#active ||
      this.#active.analysisId !== analysisId
    ) {
      throw new WorkspaceError(
        "INVALID_REQUEST",
        "The requested code analysis task is no longer running."
      );
    }
    this.#active.controller.abort(
      new AnalysisCancelledError(
        "Code analysis was cancelled by the user."
      )
    );
  }

  async getSnapshot(): Promise<CodeAnalysisSnapshot | null> {
    const [workspace, settings] = await Promise.all([
      this.#workspace.getCurrent(),
      this.#settingsProvider()
    ]);
    const context = tryResolveAnalysisContext(workspace);
    await this.#ensureSnapshotHydrated(
      workspace,
      settings,
      context
    );
    if (!this.#snapshot) {
      return null;
    }
    if (
      !context ||
      !snapshotMatchesContext(
        this.#snapshot,
        workspace,
        context
      )
    ) {
      return null;
    }
    return structuredClone(this.#snapshot);
  }

  async readFile(nodeId: string): Promise<CodeAnalysisFile> {
    const snapshot = await this.getSnapshot();
    if (!snapshot) {
      throw new WorkspaceError(
        "INVALID_REQUEST",
        "Run code analysis before opening node source."
      );
    }
    const node = snapshot.nodes.find(
      (candidate) => candidate.id === nodeId
    );
    if (!node) {
      throw new WorkspaceError(
        "INVALID_REQUEST",
        "The requested code analysis node is no longer available."
      );
    }
    const root = snapshot.roots.find(
      (candidate) =>
        candidate.repositoryId ===
          node.location.repositoryId &&
        candidate.worktreeId === node.location.worktreeId
    );
    if (!root) {
      throw new WorkspaceError(
        "DIRECTORY_UNAVAILABLE",
        "The Worktree for this code analysis node is unavailable."
      );
    }

    let canonicalRoot: string;
    let canonicalFile: string;
    let fileStats;
    try {
      canonicalRoot = await realpath(root.path);
      canonicalFile = await realpath(
        resolve(root.path, node.location.path)
      );
      fileStats = await stat(canonicalFile);
    } catch (error) {
      throw new WorkspaceError(
        "DIRECTORY_UNAVAILABLE",
        `Unable to read ${node.location.path}.`,
        {
          path: node.location.path,
          reason: filesystemErrorCode(error)
        }
      );
    }

    if (!isWithinPath(canonicalRoot, canonicalFile)) {
      throw new WorkspaceError(
        "INVALID_REQUEST",
        "The requested code file is outside its analyzed Worktree."
      );
    }
    if (!fileStats.isFile()) {
      throw new WorkspaceError(
        "INVALID_REQUEST",
        "The requested code analysis node does not point to a file."
      );
    }
    if (fileStats.size > MAX_CODE_FILE_BYTES) {
      throw new WorkspaceError(
        "INVALID_REQUEST",
        "The requested code file is too large to preview safely.",
        {
          path: node.location.path,
          size: fileStats.size,
          limit: MAX_CODE_FILE_BYTES
        }
      );
    }

    let buffer: Buffer;
    try {
      buffer = await readTextFile(canonicalFile);
    } catch (error) {
      throw new WorkspaceError(
        "DIRECTORY_UNAVAILABLE",
        `Unable to read ${node.location.path}.`,
        {
          path: node.location.path,
          reason: filesystemErrorCode(error)
        }
      );
    }
    if (buffer.includes(0)) {
      throw new WorkspaceError(
        "INVALID_REQUEST",
        "The requested code file is not a text file."
      );
    }

    const preview = createCodeFilePreview(
      buffer.toString("utf8"),
      node.location.line,
      typeof node.metadata.endLine === "number"
        ? node.metadata.endLine
        : node.location.line
    );
    return {
      nodeId: node.id,
      path: node.location.path,
      language: node.language,
      ...preview
    };
  }

  handleWorkspaceChanged(workspace: Workspace): void {
    const context = tryResolveAnalysisContext(workspace);
    this.#acceptWorkspaceSelection(workspace, context);
    void this.#settingsProvider()
      .then((settings) =>
        this.#ensureSnapshotHydrated(
          workspace,
          settings,
          context
        )
      )
      .catch(() => undefined);
  }

  #acceptWorkspaceSelection(
    workspace: Workspace,
    context: AnalysisContext | null
  ): void {
    const entryId =
      context?.entry.id ??
      workspace.selectedEntryId ??
      workspace.entries[0]?.id;
    const selectionKey = context
      ? analysisSelectionKey(workspace, context)
      : `${workspace.id}\0${entryId ?? ""}\0unavailable`;
    const selectionChanged =
      selectionKey !== this.#selectionKey;

    if (
      this.#active &&
      selectionKey !== this.#active.entryKey
    ) {
      const active = this.#active;
      this.#active = undefined;
      active.controller.abort(
        new AnalysisCancelledError(
          "Workspace selection changed during code analysis."
        )
      );
    }

    const snapshotMatches = Boolean(
      context &&
        this.#snapshot &&
        snapshotMatchesContext(
          this.#snapshot,
          workspace,
          context
        )
    );
    if (!snapshotMatches) {
      this.#snapshot = null;
      this.#snapshotConfigurationKey = "";
    }

    if (!selectionChanged) {
      return;
    }

    this.#selectionKey = selectionKey;
    this.#selectionGeneration += 1;
    this.#hydratedCacheKey = "";
    this.#restore = undefined;
    if (!snapshotMatches) {
      this.#setIdleState(workspace, context);
    }
  }

  async #ensureSnapshotHydrated(
    workspace: Workspace,
    settings: CodeAnalysisSettings,
    providedContext?: AnalysisContext | null
  ): Promise<void> {
    const context =
      providedContext === undefined
        ? tryResolveAnalysisContext(workspace)
        : providedContext;
    this.#acceptWorkspaceSelection(workspace, context);
    if (!context || this.#disposed) {
      return;
    }

    const selectionKey = analysisSelectionKey(
      workspace,
      context
    );
    const configurationKey =
      codeAnalysisSnapshotConfigurationKey(
        settings,
        context.roots
      );
    const cacheKey = `${selectionKey}\0${configurationKey}`;

    if (
      this.#snapshot &&
      this.#snapshotConfigurationKey === configurationKey &&
      snapshotMatchesContext(
        this.#snapshot,
        workspace,
        context
      )
    ) {
      this.#hydratedCacheKey = cacheKey;
      return;
    }

    if (
      this.#active?.entryKey === selectionKey ||
      this.#hydratedCacheKey === cacheKey
    ) {
      return;
    }

    if (this.#snapshot) {
      this.#snapshot = null;
      this.#snapshotConfigurationKey = "";
      this.#setIdleState(workspace, context);
    }

    if (this.#restore?.cacheKey === cacheKey) {
      await this.#restore.task;
      return;
    }

    const generation = this.#selectionGeneration;
    const task = (async () => {
      let snapshot: CodeAnalysisSnapshot | null = null;
      try {
        snapshot = await this.#snapshotStore.load(
          workspace.id,
          context.entry.id,
          settings,
          context.roots
        );
      } catch {
        // A missing or invalid cache is equivalent to no prior analysis.
      }

      if (
        this.#disposed ||
        generation !== this.#selectionGeneration ||
        selectionKey !== this.#selectionKey
      ) {
        return;
      }

      this.#hydratedCacheKey = cacheKey;
      if (
        !snapshot ||
        !snapshotMatchesContext(
          snapshot,
          workspace,
          context
        )
      ) {
        return;
      }

      this.#snapshot = snapshot;
      this.#snapshotConfigurationKey = configurationKey;
      if (this.#active?.entryKey === selectionKey) {
        this.#setState({
          ...this.#state,
          snapshotAvailable: true
        });
        return;
      }
      this.#setState(stateFromSnapshot(snapshot));
    })();
    this.#restore = {
      cacheKey,
      task
    };
    try {
      await task;
    } finally {
      if (this.#restore?.task === task) {
        this.#restore = undefined;
      }
    }
  }

  #setIdleState(
    workspace: Workspace,
    context: AnalysisContext | null
  ): void {
    const entry =
      context?.entry ??
      workspace.entries.find(
        (candidate) =>
          candidate.id ===
          (workspace.selectedEntryId ??
            workspace.entries[0]?.id)
      );
    this.#setState({
      state: "idle",
      snapshotAvailable: false,
      workspaceId: workspace.id,
      ...(entry
        ? {
            entryId: entry.id,
            entryName: entry.displayName
          }
        : {})
    });
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#selectionGeneration += 1;
    const active = this.#active;
    this.#active = undefined;
    active?.controller.abort(
      new AnalysisCancelledError("GitNest is shutting down.")
    );
    await this.#runQueue.catch(() => undefined);
    await this.#restore?.task.catch(() => undefined);
    await this.#engine.dispose();
    this.#listeners.clear();
  }

  async #run(input: {
    analysisId: string;
    workspace: Workspace;
    context: AnalysisContext;
    scope: CodeAnalysisScope;
    settings: CodeAnalysisSettings;
    selectionKey: string;
    controller: AbortController;
  }): Promise<void> {
    try {
      const changedPaths =
        input.scope === "changed"
          ? await this.#readChangedPaths(
              input.context.roots,
              input.controller.signal
            )
          : [];
      const snapshot = await this.#engine.analyze({
        analysisId: input.analysisId,
        workspaceId: input.workspace.id,
        entryId: input.context.entry.id,
        entryName: input.context.entry.displayName,
        workspaceRootPath: input.context.entry.path,
        roots: input.context.roots.map((root) => ({
          repositoryId: root.repositoryId,
          worktreeId: root.worktreeId,
          name: root.name,
          path: root.path
        })),
        scope: input.scope,
        changedPaths,
        cacheDirectory: this.#cacheDirectory,
        lspDataDirectory: this.#lspDataDirectory,
        settings: input.settings,
        signal: input.controller.signal,
        onProgress: (progress) => {
          if (this.#active?.analysisId !== input.analysisId) {
            return;
          }
          this.#setState({
            ...this.#state,
            state: "running",
            progress
          });
        }
      });
      if (this.#active?.analysisId !== input.analysisId) {
        return;
      }
      let completedSnapshot = snapshot;
      try {
        await this.#snapshotStore.save(
          snapshot,
          input.settings
        );
      } catch (error) {
        completedSnapshot = {
          ...snapshot,
          warnings: [
            ...snapshot.warnings,
            `无法保存完整分析快照：${errorMessage(error)}`
          ]
        };
      }
      if (this.#active?.analysisId !== input.analysisId) {
        return;
      }
      this.#snapshot = completedSnapshot;
      this.#snapshotConfigurationKey =
        codeAnalysisSnapshotConfigurationKey(
          input.settings,
          completedSnapshot.roots
        );
      this.#hydratedCacheKey = `${input.selectionKey}\0${this.#snapshotConfigurationKey}`;
      this.#active = undefined;
      this.#setState({
        state: "ready",
        snapshotAvailable: true,
        analysisId: input.analysisId,
        workspaceId: input.workspace.id,
        entryId: input.context.entry.id,
        entryName: input.context.entry.displayName,
        scope: input.scope,
        generatedAt: completedSnapshot.generatedAt,
        stats: completedSnapshot.stats
      });
    } catch (error) {
      if (this.#active?.analysisId !== input.analysisId) {
        return;
      }
      this.#active = undefined;
      if (
        input.controller.signal.aborted ||
        error instanceof AnalysisCancelledError
      ) {
        this.#setState({
          state: "cancelled",
          snapshotAvailable:
            this.#snapshot?.workspaceId === input.workspace.id &&
            this.#snapshot.entryId === input.context.entry.id,
          analysisId: input.analysisId,
          workspaceId: input.workspace.id,
          entryId: input.context.entry.id,
          entryName: input.context.entry.displayName,
          scope: input.scope,
          error: {
            code: "COMMAND_CANCELLED",
            message:
              error instanceof Error
                ? error.message
                : "Code analysis was cancelled.",
            details: {}
          }
        });
        return;
      }
      this.#setState({
        state: "failed",
        snapshotAvailable:
          this.#snapshot?.workspaceId === input.workspace.id &&
          this.#snapshot.entryId === input.context.entry.id,
        analysisId: input.analysisId,
        workspaceId: input.workspace.id,
        entryId: input.context.entry.id,
        entryName: input.context.entry.displayName,
        scope: input.scope,
        error: {
          code: errorCode(error),
          message:
            error instanceof Error
              ? error.message
              : "Code analysis failed.",
          details: {}
        }
      });
    }
  }

  async #readChangedPaths(
    roots: AnalysisRootContext[],
    signal: AbortSignal
  ) {
    const changedPaths: Array<{
      repositoryId: string;
      worktreeId: string;
      path: string;
    }> = [];
    for (const root of roots) {
      throwIfAborted(signal);
      const snapshot = await this.#git.readRepositorySnapshot(
        root.path,
        {
          includeChangeStats: false,
          signal
        }
      );
      appendChangedPaths(changedPaths, root, snapshot);
    }
    return changedPaths;
  }

  #setState(state: CodeAnalysisState): void {
    this.#state = cloneState(state);
    const published = cloneState(this.#state);
    for (const listener of this.#listeners) {
      try {
        listener(published);
      } catch {
        // A closed renderer must not interrupt analysis completion.
      }
    }
  }
}

interface AnalysisRootContext {
  repositoryId: string;
  worktreeId: string;
  name: string;
  path: string;
}

interface AnalysisContext {
  entry: WorkspaceEntry;
  roots: AnalysisRootContext[];
}

function tryResolveAnalysisContext(
  workspace: Workspace
): AnalysisContext | null {
  try {
    return resolveAnalysisContext(workspace);
  } catch {
    return null;
  }
}

function resolveAnalysisContext(
  workspace: Workspace
): AnalysisContext {
  const entryId =
    workspace.selectedEntryId ?? workspace.entries[0]?.id;
  const entry = workspace.entries.find(
    (candidate) => candidate.id === entryId
  );
  if (!entry) {
    throw new WorkspaceError(
      "INVALID_REQUEST",
      "Select a Workspace entry before starting code analysis."
    );
  }
  const repositories = new Map(
    workspace.repositories.map((repository) => [
      repository.id,
      repository
    ])
  );
  const worktrees = new Map(
    workspace.worktrees.map((worktree) => [
      repositoryTargetKey({
        repositoryId: worktree.repositoryId,
        worktreeId: worktree.id
      }),
      worktree
    ])
  );
  const roots = listEntryTargets(entry).flatMap((target) => {
    const worktree = worktrees.get(repositoryTargetKey(target));
    if (!worktree || worktree.isBare) {
      return [];
    }
    return [
      toAnalysisRoot(
        worktree,
        repositories.get(target.repositoryId)?.name
      )
    ];
  });
  const unique = new Map(
    roots.map((root) => [
      normalizedPathKey(root.path),
      root
    ])
  );
  if (unique.size === 0) {
    throw new WorkspaceError(
      "DIRECTORY_UNAVAILABLE",
      "The selected Workspace entry has no readable Worktree."
    );
  }
  return {
    entry,
    roots: [...unique.values()]
  };
}

function analysisSelectionKey(
  workspace: Workspace,
  context: AnalysisContext
): string {
  return [
    workspace.id,
    context.entry.id,
    ...context.roots
      .map(
        (root) =>
          `${root.repositoryId}\0${root.worktreeId}\0${normalizedPathKey(
            root.path
          )}`
      )
      .sort()
  ].join("\0");
}

function snapshotMatchesContext(
  snapshot: CodeAnalysisSnapshot,
  workspace: Workspace,
  context: AnalysisContext
): boolean {
  if (
    snapshot.workspaceId !== workspace.id ||
    snapshot.entryId !== context.entry.id
  ) {
    return false;
  }
  const snapshotRoots = snapshot.roots
    .map(
      (root) =>
        `${root.repositoryId}\0${root.worktreeId}\0${normalizedPathKey(
          root.path
        )}`
    )
    .sort();
  const contextRoots = context.roots
    .map(
      (root) =>
        `${root.repositoryId}\0${root.worktreeId}\0${normalizedPathKey(
          root.path
        )}`
    )
    .sort();
  return (
    snapshotRoots.length === contextRoots.length &&
    snapshotRoots.every(
      (root, index) => root === contextRoots[index]
    )
  );
}

function stateFromSnapshot(
  snapshot: CodeAnalysisSnapshot
): CodeAnalysisState {
  return {
    state: "ready",
    snapshotAvailable: true,
    analysisId: snapshot.analysisId,
    workspaceId: snapshot.workspaceId,
    entryId: snapshot.entryId,
    entryName: snapshot.entryName,
    scope: snapshot.scope,
    generatedAt: snapshot.generatedAt,
    stats: snapshot.stats
  };
}

function toAnalysisRoot(
  worktree: WorkspaceWorktree,
  repositoryName?: string
): AnalysisRootContext {
  return {
    repositoryId: worktree.repositoryId,
    worktreeId: worktree.id,
    name: repositoryName ?? worktree.name,
    path: worktree.path
  };
}

function appendChangedPaths(
  target: Array<{
    repositoryId: string;
    worktreeId: string;
    path: string;
  }>,
  root: AnalysisRootContext,
  snapshot: RepositorySnapshot
): void {
  for (const change of snapshot.changes) {
    for (const path of new Set([
      change.path,
      ...(change.originalPath ? [change.originalPath] : [])
    ])) {
      target.push({
        repositoryId: root.repositoryId,
        worktreeId: root.worktreeId,
        path
      });
    }
  }
}

function normalizedPathKey(path: string): string {
  return process.platform === "win32"
    ? path.toLocaleLowerCase("en-US")
    : path;
}

function isWithinPath(rootPath: string, filePath: string): boolean {
  const relativePath = relative(rootPath, filePath);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}

function createCodeFilePreview(
  content: string,
  requestedStartLine: number,
  requestedEndLine: number
): Pick<
  CodeAnalysisFile,
  | "content"
  | "startLine"
  | "endLine"
  | "totalLines"
  | "truncated"
> {
  const lines = content.split(/\r\n|\n|\r/);
  const totalLines = Math.max(1, lines.length);
  const focusStart = Math.min(
    totalLines,
    Math.max(1, Math.trunc(requestedStartLine))
  );
  const focusEnd = Math.min(
    totalLines,
    Math.max(
      focusStart,
      Number.isFinite(requestedEndLine)
        ? Math.trunc(requestedEndLine)
        : focusStart
    )
  );
  const focusSpan = focusEnd - focusStart + 1;
  let startLine = 1;
  let endLine = totalLines;

  if (totalLines > MAX_CODE_FILE_LINES) {
    const contextBefore =
      focusSpan >= MAX_CODE_FILE_LINES
        ? 0
        : Math.floor(
            (MAX_CODE_FILE_LINES - focusSpan) / 3
          );
    startLine = Math.max(1, focusStart - contextBefore);
    endLine = Math.min(
      totalLines,
      startLine + MAX_CODE_FILE_LINES - 1
    );
    startLine = Math.max(
      1,
      endLine - MAX_CODE_FILE_LINES + 1
    );
  }

  return {
    content: lines.slice(startLine - 1, endLine).join("\n"),
    startLine,
    endLine,
    totalLines,
    truncated: startLine > 1 || endLine < totalLines
  };
}

function filesystemErrorCode(error: unknown): string {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
}

function cloneState(state: CodeAnalysisState): CodeAnalysisState {
  return structuredClone(state);
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown persistence error.";
}

function errorCode(
  error: unknown
): "INVALID_REQUEST" | "DIRECTORY_UNAVAILABLE" | "COMMAND_FAILED" {
  if (error instanceof WorkspaceError) {
    if (
      error.code === "INVALID_REQUEST" ||
      error.code === "DIRECTORY_UNAVAILABLE"
    ) {
      return error.code;
    }
  }
  return "COMMAND_FAILED";
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new AnalysisCancelledError(
          "Code analysis was cancelled."
        );
  }
}

class AnalysisCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisCancelledError";
  }
}
