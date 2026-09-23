import { execFile } from "node:child_process";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import {
  loadSnapshotFromDirectory,
  codeAnalysisSnapshotConfigurationKey,
  codeAnalysisWorktreeStatusFingerprint,
  codeAnalysisWorkspaceCacheDirectory,
  codeAnalysisSettingsFromPersisted,
  type PersistedCodeAnalysisSettings,
  type AnalysisRoot,
  type LoadedAnalysisSnapshot,
  type CodeAnalysisScope,
  type CodeAnalysisSettings,
  type CodeAnalysisSnapshot
} from "@gitnest/code-analysis";
import {
  parseCommitNumstat,
  parseStatusPorcelainV2,
  reconcileStatOnlyUnstagedChanges
} from "@gitnest/git-core";
import { migrateWorkspaceDocument } from "@gitnest/persistence-json";
import {
  listWorkspaceTargets,
  repositoryTargetKey,
  type WorkspaceCatalog,
  type Workspace
} from "@gitnest/workspace-core";

const execFileAsync = promisify(execFile);

export const FRESHNESS_ROOT_BUDGET = 200;
export const FRESHNESS_ROOT_TIMEOUT_MS = 5_000;
const MAX_SETTINGS_BYTES = 4 * 1_024 * 1_024;

export type AnalysisFreshness = "fresh" | "stale" | "unknown";

export interface McpServerSettings {
  enabled: boolean;
  allowSourceSnippets: boolean;
  maxResponseKb: number;
}

export interface GitNestDataPaths {
  catalogFilePath: string;
  workspaceDirectory: string;
  settingsFilePath: string;
  snapshotDirectory: string;
  fallbackSnapshotDirectory: string;
}

export function resolveDataPaths(
  dataDirectory: string
): GitNestDataPaths {
  return {
    catalogFilePath: join(
      dataDirectory,
      "workspaces",
      "catalog.json"
    ),
    workspaceDirectory: join(
      dataDirectory,
      "workspaces",
      "items"
    ),
    settingsFilePath: join(
      dataDirectory,
      "settings",
      "app-settings.json"
    ),
    snapshotDirectory: join(
      dataDirectory,
      "gitnest-state",
      "code-analysis"
    ),
    // Snapshots written before the `gitnest-state` layout live in
    // `cache/code-analysis`. GitNest still reads them (and copies
    // them forward on load), so MCP must look here too, otherwise it
    // reports "no snapshot" for a graph the app is showing.
    fallbackSnapshotDirectory: join(
      dataDirectory,
      "cache",
      "code-analysis"
    )
  };
}

export interface AnalysisTarget {
  workspaceId: string;
  workspaceName: string;
  selected: boolean;
  scope: CodeAnalysisScope;
  snapshot: CodeAnalysisSnapshot;
}

export interface ProjectAnalysisMatch {
  workspaceId: string;
  workspaceName: string;
  selected: boolean;
  root: AnalysisRoot;
}

export interface AnalysisTargetSummary {
  workspaceId: string;
  workspaceName: string;
  selected: boolean;
  scope: CodeAnalysisScope;
  generatedAt: string;
  analysisId: string;
  nodeCount: number;
  edgeCount: number;
  requestChainCount: number;
  changedNodeCount: number;
  completeness: "complete" | "partial";
  impactCoverage: "confirmed" | "possible-omissions";
  diagnosticCount: number;
  freshness: AnalysisFreshness;
  roots: AnalysisRoot[];
}

export interface DataAccessOptions {
  dataDirectory: string;
  /** Skips the git probe; used by tests and --self-check. */
  skipFreshness?: boolean;
}

/**
 * One parsed snapshot plus the file signature it was parsed from.
 * A full snapshot is tens of MB and MCP clients often call several
 * tools in a row, so re-parsing on every call is not acceptable.
 */
interface CachedSnapshot {
  signature: string;
  snapshot: CodeAnalysisSnapshot | null;
}

interface WorktreeStatus {
  head: string;
  fingerprint: string;
}

export class DataAccessError extends Error {
  readonly code:
    | "data-unavailable"
    | "snapshot-unavailable"
    | "invalid-workspace"
    | "invalid-project"
    | "project-unmatched";

  constructor(
    code: DataAccessError["code"],
    message: string
  ) {
    super(message);
    this.name = "DataAccessError";
    this.code = code;
  }
}

/**
 * Read-only access to GitNest's persisted state.
 *
 * Everything here is `stat`/`readFile` plus a read-only
 * `git rev-parse`. No writes, no analysis, no LSP.
 */
export class GitNestDataAccess {
  readonly #paths: GitNestDataPaths;
  readonly #skipFreshness: boolean;
  readonly #snapshots = new Map<string, CachedSnapshot>();

  constructor(options: DataAccessOptions) {
    this.#paths = resolveDataPaths(options.dataDirectory);
    this.#skipFreshness = options.skipFreshness === true;
  }

  get paths(): GitNestDataPaths {
    return this.#paths;
  }

  async readMcpSettings(): Promise<McpServerSettings> {
    const persisted = await this.readPersistedCodeAnalysis();
    const mcp = persisted.mcp;
    return {
      enabled: mcp?.enabled ?? true,
      allowSourceSnippets: mcp?.allowSourceSnippets ?? true,
      maxResponseKb: mcp?.maxResponseKb ?? 256
    };
  }

  async readPersistedCodeAnalysis(): Promise<PersistedCodeAnalysisSettings> {
    const raw = await readFile(
      this.#paths.settingsFilePath,
      "utf8"
    ).catch(() => null);
    if (!raw) {
      throw new DataAccessError(
        "data-unavailable",
        "未找到 GitNest 设置文件，请先运行 GitNest。"
      );
    }
    if (raw.length > MAX_SETTINGS_BYTES) {
      throw new DataAccessError(
        "data-unavailable",
        "GitNest 设置文件超出可读范围。"
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new DataAccessError(
        "data-unavailable",
        "GitNest 设置文件无法解析。"
      );
    }
    const settings = readCodeAnalysisSettings(parsed);
    if (!settings) {
      throw new DataAccessError(
        "data-unavailable",
        "GitNest 设置中缺少代码分析配置。"
      );
    }
    return settings;
  }

  async readSettings(): Promise<CodeAnalysisSettings> {
    const persisted = await this.readPersistedCodeAnalysis();
    return codeAnalysisSettingsFromPersisted(persisted);
  }

  async listWorkspaces(): Promise<
    Array<{ workspace: Workspace; selected: boolean }>
  > {
    const catalog = await this.#readCatalog();
    if (!catalog) {
      throw new DataAccessError(
        "data-unavailable",
        "未找到 GitNest Workspace 目录，请先运行 GitNest。"
      );
    }
    const workspaces: Array<{
      workspace: Workspace;
      selected: boolean;
    }> = [];
    for (const summary of catalog.workspaces) {
      const workspace = await this.#readWorkspace(summary.id);
      if (!workspace) {
        continue;
      }
      workspaces.push({
        workspace,
        selected: workspace.id === catalog.activeWorkspaceId
      });
    }
    return workspaces;
  }

  async matchProjectPath(
    projectPath: string
  ): Promise<ProjectAnalysisMatch[]> {
    if (!isAbsolute(projectPath)) {
      throw new DataAccessError(
        "invalid-project",
        "projectPath 必须是当前项目的绝对路径。"
      );
    }
    const canonicalProject = await realpath(
      resolve(projectPath)
    ).catch(() => null);
    if (
      !canonicalProject ||
      !(await stat(canonicalProject).catch(() => null))
        ?.isDirectory()
    ) {
      throw new DataAccessError(
        "invalid-project",
        "projectPath 必须是存在且可访问的目录。"
      );
    }

    const matches = new Map<string, ProjectAnalysisMatch>();
    for (const {
      project,
      canonicalRoot
    } of await this.#accessibleProjects()) {
      const relationship = relative(
        canonicalRoot,
        canonicalProject
      );
      if (
        relationship === ".." ||
        relationship.startsWith(`..${sep}`) ||
        isAbsolute(relationship)
      ) {
        continue;
      }
      const best = matches.get(project.workspaceId);
      if (
        !best ||
        project.root.path.length > best.root.path.length
      ) {
        matches.set(project.workspaceId, project);
      }
    }
    return [...matches.values()].sort(
      (left, right) =>
        Number(right.selected) -
          Number(left.selected) ||
        right.root.path.length - left.root.path.length
    );
  }

  async listAnalysisProjects(): Promise<ProjectAnalysisMatch[]> {
    return (await this.#accessibleProjects())
      .map(({ project }) => project)
      .sort(
        (left, right) =>
          Number(right.selected) -
          Number(left.selected)
      );
  }

  async #accessibleProjects(): Promise<
    Array<{
      project: ProjectAnalysisMatch;
      canonicalRoot: string;
    }>
  > {
    const projects: Array<{
      project: ProjectAnalysisMatch;
      canonicalRoot: string;
    }> = [];
    for (const candidate of await this.listWorkspaces()) {
      for (const root of analysisRoots(candidate.workspace)) {
        const canonicalRoot = await realpath(
          root.path
        ).catch(() => null);
        if (!canonicalRoot) {
          continue;
        }
        const rootInfo = await stat(canonicalRoot).catch(
          () => null
        );
        if (!rootInfo?.isDirectory()) {
          continue;
        }
        projects.push({
          project: {
            workspaceId: candidate.workspace.id,
            workspaceName: candidate.workspace.name,
            selected: candidate.selected,
            root
          },
          canonicalRoot
        });
      }
    }
    return projects;
  }

  /**
   * Reads the catalog without `JsonWorkspaceCollectionStore`: its
   * loaders migrate and then write the migrated document back to
   * disk, which would break this process's read-only guarantee.
   * `migrateWorkspaceDocument` is a pure converter, so applying it
   * in memory is enough.
   */
  async #readCatalog(): Promise<WorkspaceCatalog | null> {
    const parsed = await this.#readJson(this.#paths.catalogFilePath);
    if (!isRecord(parsed)) {
      return null;
    }
    const activeWorkspaceId = parsed.activeWorkspaceId;
    if (
      typeof activeWorkspaceId !== "string" ||
      !Array.isArray(parsed.workspaces)
    ) {
      return null;
    }
    const summaries = parsed.workspaces
      .filter(isRecord)
      .map((entry) => ({ id: String(entry.id ?? "") }))
      .filter((entry) => entry.id.length > 0);
    if (summaries.length === 0) {
      return null;
    }
    return {
      activeWorkspaceId,
      workspaces: summaries
    } as unknown as WorkspaceCatalog;
  }

  async #readWorkspace(
    workspaceId: string
  ): Promise<Workspace | null> {
    const parsed = await this.#readJson(
      join(
        this.#paths.workspaceDirectory,
        `${workspaceId}.workspace.json`
      )
    );
    if (parsed === null) {
      return null;
    }
    try {
      const workspace = migrateWorkspaceDocument(parsed);
      return workspace.id === workspaceId ? workspace : null;
    } catch {
      return null;
    }
  }

  async #readJson(filePath: string): Promise<unknown> {
    const raw = await readFile(filePath, "utf8").catch(() => null);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  async resolveTargets(input: {
    workspaceId?: string;
    scope?: CodeAnalysisScope;
  }): Promise<AnalysisTarget[]> {
    const settings = await this.readSettings();
    const workspaces = await this.listWorkspaces();
    const selected = workspaces.filter(
      (candidate) => candidate.selected
    );
    const pool =
      input.workspaceId !== undefined
        ? workspaces.filter(
            (candidate) =>
              candidate.workspace.id === input.workspaceId
          )
        : selected.length > 0
          ? selected
          : workspaces;
    const scopes: CodeAnalysisScope[] = input.scope
      ? [input.scope]
      : ["workspace", "changed"];
    const targets: AnalysisTarget[] = [];

    for (const candidate of pool) {
      const roots = analysisRoots(candidate.workspace);
      if (roots.length === 0) {
        continue;
      }
      for (const scope of scopes) {
        const snapshot = await this.#loadSnapshot(
          candidate.workspace.id,
          settings,
          roots,
          scope
        );
        if (!snapshot) {
          continue;
        }
        targets.push({
          workspaceId: candidate.workspace.id,
          workspaceName: candidate.workspace.name,
          selected: candidate.selected,
          scope,
          snapshot
        });
      }
    }

    if (targets.length === 0) {
      throw new DataAccessError(
        "snapshot-unavailable",
        "当前 Workspace 没有可用的代码分析快照，请在 GitNest 中执行一次代码分析。"
      );
    }
    return targets;
  }
  /**
   * Loads a snapshot, reusing the parsed result while the file on
   * disk is unchanged. The signature is `mtime + size`, so a new
   * analysis written by GitNest (including the CA-5 auto-refresh)
   * invalidates the entry instead of serving a stale parse.
   */
  async #loadSnapshot(
    workspaceId: string,
    settings: CodeAnalysisSettings,
    roots: AnalysisRoot[],
    scope: CodeAnalysisScope
  ): Promise<CodeAnalysisSnapshot | null> {
    const signature = await this.#snapshotSignature(
      workspaceId,
      scope
    );
    const key = [
      workspaceId,
      scope,
      codeAnalysisSnapshotConfigurationKey(settings, roots)
    ].join("\0");
    const cached = this.#snapshots.get(key);
    if (cached && cached.signature === signature) {
      return cached.snapshot;
    }
    // `loadSnapshotFromDirectory` is the read-only half of
    // `AnalysisSnapshotCache.load`: that wrapper also repairs what it
    // read (legacy migration, pointer repair, fallback copy) by writing
    // to disk, which this process must never do. The fallback directory
    // is searched directly instead of being copied forward.
    let loaded: LoadedAnalysisSnapshot | null = null;
    for (const directory of [
      this.#paths.snapshotDirectory,
      this.#paths.fallbackSnapshotDirectory
    ]) {
      loaded = await loadSnapshotFromDirectory(
        directory,
        workspaceId,
        settings,
        roots,
        scope
      ).catch(() => null);
      if (loaded) {
        break;
      }
    }
    const snapshot = loaded ? structuredClone(loaded.snapshot) : null;
    this.#snapshots.set(key, { signature, snapshot });
    if (this.#snapshots.size > 2) {
      const oldest = this.#snapshots.keys().next().value;
      if (oldest !== undefined) {
        this.#snapshots.delete(oldest);
      }
    }
    return snapshot;
  }

  /**
   * `mtime + size` of the scoped snapshot file in both directories,
   * so a rewrite in either place invalidates the cached parse.
   */
  async #snapshotSignature(
    workspaceId: string,
    scope: CodeAnalysisScope
  ): Promise<string> {
    const parts: string[] = [];
    for (const directory of [
      this.#paths.snapshotDirectory,
      this.#paths.fallbackSnapshotDirectory
    ]) {
      const filePath = join(
        codeAnalysisWorkspaceCacheDirectory(
          directory,
          workspaceId
        ),
        `snapshot-${scope}.json`
      );
      const info = await stat(filePath).catch(() => null);
      parts.push(
        info ? `${info.mtimeMs}:${info.size}` : "missing"
      );
    }
    return parts.join("|");
  }

  async pickTarget(input: {
    workspaceId?: string;
    scope?: CodeAnalysisScope;
  }): Promise<AnalysisTarget> {
    const targets = await this.resolveTargets(input);
    if (input.scope) {
      return targets[0] as AnalysisTarget;
    }
    return targets.reduce((latest, candidate) => {
      const difference =
        (Date.parse(candidate.snapshot.generatedAt) || 0) -
        (Date.parse(latest.snapshot.generatedAt) || 0);
      return difference > 0 ||
        (difference === 0 &&
          candidate.scope === "changed" &&
          latest.scope !== "changed")
        ? candidate
        : latest;
    });
  }

  async summarize(
    target: AnalysisTarget,
    probes?: Map<string, Promise<WorktreeStatus | undefined>>
  ): Promise<AnalysisTargetSummary> {
    return {
      workspaceId: target.workspaceId,
      workspaceName: target.workspaceName,
      selected: target.selected,
      scope: target.scope,
      generatedAt: target.snapshot.generatedAt,
      analysisId: target.snapshot.analysisId,
      nodeCount: target.snapshot.nodes.length,
      edgeCount: target.snapshot.edges.length,
      requestChainCount: target.snapshot.requestChains.length,
      changedNodeCount: target.snapshot.nodes.filter(
        (node) => node.changed
      ).length,
      completeness:
        target.snapshot.indexStatus?.resultCompleteness ??
        "complete",
      impactCoverage:
        target.snapshot.indexStatus?.impactCoverage ??
        "confirmed",
      diagnosticCount: target.snapshot.diagnostics?.length ?? 0,
      freshness: await this.freshnessFor(target, probes),
      roots: target.snapshot.roots
    };
  }

  async configurationKey(
    target: AnalysisTarget
  ): Promise<string> {
    const settings = await this.readSettings();
    return codeAnalysisSnapshotConfigurationKey(
      settings,
      target.snapshot.roots
    );
  }

  async freshnessFor(
    target: AnalysisTarget,
    probes = new Map<
      string,
      Promise<WorktreeStatus | undefined>
    >()
  ): Promise<AnalysisFreshness> {
    if (this.#skipFreshness) {
      return "unknown";
    }
    const sourceState = target.snapshot.sourceState;
    const statuses = new Map(
      sourceState?.worktreeStatuses.map((entry) => [
        repositoryTargetKey(entry),
        entry.fingerprint
      ]) ?? []
    );
    const roots = target.snapshot.roots.slice(
      0,
      FRESHNESS_ROOT_BUDGET
    );
    let freshness: AnalysisFreshness = sourceState
      ? "fresh"
      : "unknown";
    for (const root of roots) {
      let probe = probes.get(root.path);
      if (!probe) {
        probe = readWorktreeStatus(root.path);
        probes.set(root.path, probe);
      }
      const current = await probe;
      if (current === undefined) {
        freshness = "unknown";
        continue;
      }
      if (root.revision !== undefined) {
        if (current.head !== root.revision) {
          return "stale";
        }
      } else {
        freshness = "unknown";
      }
      const expected = statuses.get(repositoryTargetKey(root));
      if (expected && expected !== current.fingerprint) {
        return "stale";
      }
      if (!expected) {
        freshness = "unknown";
      }
    }
    if (roots.length < target.snapshot.roots.length) {
      freshness = "unknown";
    }
    const rootsByKey = new Map(
      roots.map((root) => [repositoryTargetKey(root), root])
    );
    for (const file of sourceState?.changedSourceFiles ?? []) {
      const root = rootsByKey.get(repositoryTargetKey(file));
      if (!root) {
        freshness = "unknown";
        continue;
      }
      const absolute = resolve(root.path, file.path);
      const relation = relative(resolve(root.path), absolute);
      if (
        relation === ".." ||
        relation.startsWith(`..${sep}`) ||
        isAbsolute(relation)
      ) {
        freshness = "unknown";
        continue;
      }
      try {
        const current = await lstat(absolute);
        if (
          !current.isFile() ||
          current.size !== file.size ||
          Math.trunc(current.mtimeMs) !==
            Math.trunc(file.modifiedAtMs)
        ) {
          return "stale";
        }
      } catch (error) {
        if (isMissingFile(error)) {
          return "stale";
        }
        freshness = "unknown";
      }
    }
    return freshness;
  }
}

export function analysisRoots(workspace: Workspace): AnalysisRoot[] {
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
  const roots: AnalysisRoot[] = [];
  const seen = new Set<string>();
  for (const target of listWorkspaceTargets(workspace)) {
    const worktree = worktrees.get(repositoryTargetKey(target));
    if (!worktree || worktree.isBare) {
      continue;
    }
    const key = worktree.path.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    roots.push({
      repositoryId: worktree.repositoryId,
      worktreeId: worktree.id,
      name:
        repositories.get(worktree.repositoryId)?.name ??
        worktree.id,
      path: worktree.path,
      ...(worktree.head ? { revision: worktree.head } : {})
    });
  }
  return roots;
}

async function readWorktreeStatus(
  rootPath: string
): Promise<WorktreeStatus | undefined> {
  try {
    const options = {
      cwd: rootPath,
      timeout: FRESHNESS_ROOT_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 16 * 1_024 * 1_024,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0"
      }
    };
    const { stdout } = await execFileAsync(
      "git",
      [
        "-c",
        "core.fsmonitor=false",
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
        "--untracked-files=all"
      ],
      options
    );
    let status = parseStatusPorcelainV2(stdout);
    if (
      status.changes.some(
        (change) =>
          change.kind === "ordinary" &&
          change.worktreeStatus === "M"
      )
    ) {
      const { stdout: diffStats } = await execFileAsync(
        "git",
        [
          "-c",
          "diff.autoRefreshIndex=false",
          "--literal-pathspecs",
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--numstat",
          "--find-renames",
          "-z",
          "--"
        ],
        options
      );
      status = reconcileStatOnlyUnstagedChanges(
        status,
        parseCommitNumstat(diffStats).files.map(
          (file) => file.path
        )
      );
    }
    return {
      head: status.head,
      fingerprint: codeAnalysisWorktreeStatusFingerprint(
        status.changes
      )
    };
  } catch {
    return undefined;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function readCodeAnalysisSettings(
  document: unknown
): PersistedCodeAnalysisSettings | null {
  if (!isRecord(document)) {
    return null;
  }
  const codeAnalysis = document.codeAnalysis;
  if (!isRecord(codeAnalysis)) {
    return null;
  }
  return codeAnalysis as unknown as PersistedCodeAnalysisSettings;
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
