import type {
  GitClient,
  RepositorySnapshot
} from "@gitnest/git-core";
import {
  findTargetEntry,
  getEntryDefaultTarget,
  listWorkspaceTargets,
  repositoryTargetKey,
  repositoryTargetsEqual,
  WorkspaceError,
  type RepositorySnapshotStore,
  type RepositoryStatusSnapshot,
  type RepositoryTarget,
  type Workspace,
  type WorkspaceWatchHandle,
  type WorkspaceWatcher,
  type WorkspaceWatchRegistration
} from "@gitnest/workspace-core";

import { ConcurrencyLimiter } from "../operations/concurrency-limiter";
import type {
  AddWorkspaceEntryInput,
  SetWorkspaceGroupCollapsedInput,
  UpdateWorkspaceEntryInput,
  WorkspaceMutationResult
} from "./workspace-service";

export type WorkspaceOperationState =
  | "queued"
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface WorkspaceOperation {
  id: string;
  kind:
    | "scan"
    | "status"
    | "stage"
    | "unstage"
    | "commit"
    | "fetch"
    | "pull"
    | "push"
    | "switch-branch"
    | "create-branch"
    | "rename-branch"
    | "delete-branch"
    | "worktree-create"
    | "worktree-lock"
    | "worktree-unlock"
    | "worktree-move"
    | "worktree-repair"
    | "worktree-prune"
    | "worktree-remove";
  scope: "workspace" | "repository" | "worktree";
  targetIds: string[];
  state: WorkspaceOperationState;
  progress: number;
  succeeded: number;
  failed: number;
  message: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface WorkspaceMonitorState {
  mode: "inactive" | "watching" | "polling";
  watchedTargets: number;
  message: string;
  lastEventAt?: string;
}

export interface WorkspaceRuntimeState {
  workspace: Workspace;
  snapshots: RepositoryStatusSnapshot[];
  operations: WorkspaceOperation[];
  monitor: WorkspaceMonitorState;
}

export interface WorkspaceOperationStore {
  load(workspaceId: string): Promise<WorkspaceOperation[]>;
  save(
    workspaceId: string,
    operations: WorkspaceOperation[]
  ): Promise<void>;
}

export interface WorkspaceRefreshAccepted {
  operationId: string;
}

export type WorktreeMutationKind =
  | "stage"
  | "unstage"
  | "commit";

export interface WorktreeMutationCompleted<Result> {
  operationId: string;
  result: Result;
}

export type RepositoryOperationKind =
  | "fetch"
  | "pull"
  | "push"
  | "switch-branch"
  | "create-branch"
  | "rename-branch"
  | "delete-branch"
  | "worktree-create"
  | "worktree-lock"
  | "worktree-unlock"
  | "worktree-move"
  | "worktree-repair"
  | "worktree-prune"
  | "worktree-remove";

export interface RepositoryOperationAccepted {
  operationId: string;
}

export interface RepositoryOperationOptions {
  refreshTopology?: boolean;
}

export interface WorkspaceRuntimeOptions {
  concurrency?: number;
  currentTargetDebounceMs?: number;
  backgroundTargetDebounceMs?: number;
  pollingIntervalMs?: number;
  staleAfterMs?: number;
  watcherRegistrationLimit?: number;
  autoRefresh?: boolean;
  operationStore?: WorkspaceOperationStore;
  clock?: () => string;
}

export interface WorkspaceConfigurationService {
  getCurrent(): Promise<Workspace>;
  addEntry(
    input: AddWorkspaceEntryInput
  ): Promise<WorkspaceMutationResult>;
  rescan(): Promise<Workspace>;
  updateEntry(
    input: UpdateWorkspaceEntryInput
  ): Promise<Workspace>;
  setGroupCollapsed(
    input: SetWorkspaceGroupCollapsedInput
  ): Promise<Workspace>;
  selectEntry(entryId: string): Promise<Workspace>;
  selectTarget(target: RepositoryTarget): Promise<Workspace>;
}

type RuntimeListener = (state: WorkspaceRuntimeState) => void;
type RefreshReason =
  | "startup"
  | "manual"
  | "workspace-change"
  | "watcher"
  | "polling"
  | "focus";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_CURRENT_DEBOUNCE_MS = 400;
const DEFAULT_BACKGROUND_DEBOUNCE_MS = 2_000;
const DEFAULT_POLLING_INTERVAL_MS = 60_000;
const DEFAULT_STALE_AFTER_MS = 30_000;
const DEFAULT_WATCHER_REGISTRATION_LIMIT = 96;
const MAX_OPERATIONS = 30;

export class WorkspaceRuntimeService {
  readonly #configuration: WorkspaceConfigurationService;
  readonly #gitClient: GitClient;
  readonly #snapshotStore: RepositorySnapshotStore;
  readonly #watcher: WorkspaceWatcher;
  readonly #operationStore:
    | WorkspaceOperationStore
    | undefined;
  readonly #limiter: ConcurrencyLimiter;
  readonly #clock: () => string;
  readonly #currentTargetDebounceMs: number;
  readonly #backgroundTargetDebounceMs: number;
  readonly #pollingIntervalMs: number;
  readonly #staleAfterMs: number;
  readonly #watcherRegistrationLimit: number;
  readonly #autoRefresh: boolean;
  readonly #listeners = new Set<RuntimeListener>();
  readonly #snapshots = new Map<
    string,
    RepositoryStatusSnapshot
  >();
  readonly #inFlight = new Map<
    string,
    Promise<RepositoryStatusSnapshot>
  >();
  readonly #worktreeMutationTails = new Map<
    string,
    Promise<void>
  >();
  readonly #repositoryMutationTails = new Map<
    string,
    Promise<void>
  >();
  readonly #operationControllers = new Map<
    string,
    AbortController
  >();
  readonly #debounceTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  #workspace: Workspace | undefined;
  #operations: WorkspaceOperation[] = [];
  #monitor: WorkspaceMonitorState = {
    mode: "inactive",
    watchedTargets: 0,
    message: "Workspace 监听尚未启动。"
  };
  #initialization: Promise<void> | undefined;
  #startupRequested = false;
  #workspaceRefreshOperationId: string | undefined;
  #watchHandle: WorkspaceWatchHandle | undefined;
  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #operationSequence = 0;
  #operationPersistenceRequested = false;
  #operationPersistenceTask: Promise<void> | undefined;
  #disposed = false;

  constructor(
    configuration: WorkspaceConfigurationService,
    gitClient: GitClient,
    snapshotStore: RepositorySnapshotStore,
    watcher: WorkspaceWatcher,
    options: WorkspaceRuntimeOptions = {}
  ) {
    this.#configuration = configuration;
    this.#gitClient = gitClient;
    this.#snapshotStore = snapshotStore;
    this.#watcher = watcher;
    this.#operationStore = options.operationStore;
    this.#limiter = new ConcurrencyLimiter(
      options.concurrency ?? DEFAULT_CONCURRENCY
    );
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#currentTargetDebounceMs =
      options.currentTargetDebounceMs ??
      DEFAULT_CURRENT_DEBOUNCE_MS;
    this.#backgroundTargetDebounceMs =
      options.backgroundTargetDebounceMs ??
      DEFAULT_BACKGROUND_DEBOUNCE_MS;
    this.#pollingIntervalMs =
      options.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS;
    this.#staleAfterMs =
      options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.#watcherRegistrationLimit =
      options.watcherRegistrationLimit ??
      DEFAULT_WATCHER_REGISTRATION_LIMIT;
    this.#autoRefresh = options.autoRefresh ?? true;
  }

  subscribe(listener: RuntimeListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async getCurrent(): Promise<Workspace> {
    await this.#ensureInitialized();
    return this.#workspace as Workspace;
  }

  async getState(): Promise<WorkspaceRuntimeState> {
    await this.#ensureInitialized();
    const state = this.#createState();

    if (
      this.#autoRefresh &&
      !this.#startupRequested &&
      (this.#workspace?.entries.length ?? 0) > 0
    ) {
      this.#startupRequested = true;
      this.#beginWorkspaceRefresh("startup");
    }

    return state;
  }

  async addEntry(
    input: AddWorkspaceEntryInput
  ): Promise<WorkspaceMutationResult> {
    await this.#ensureInitialized();
    const result = await this.#configuration.addEntry(input);
    this.#acceptWorkspace(result.workspace);
    this.#startMonitoringAndRefresh("workspace-change");
    return result;
  }

  async rescan(): Promise<Workspace> {
    await this.#ensureInitialized();
    const workspace = await this.#configuration.rescan();
    this.#acceptWorkspace(workspace);
    this.#startMonitoringAndRefresh("workspace-change");
    return workspace;
  }

  async updateEntry(
    input: UpdateWorkspaceEntryInput
  ): Promise<Workspace> {
    await this.#ensureInitialized();
    const workspace = await this.#configuration.updateEntry(input);
    this.#acceptWorkspace(workspace);
    return workspace;
  }

  async setGroupCollapsed(
    input: SetWorkspaceGroupCollapsedInput
  ): Promise<Workspace> {
    await this.#ensureInitialized();
    const workspace =
      await this.#configuration.setGroupCollapsed(input);
    this.#acceptWorkspace(workspace);
    return workspace;
  }

  async selectEntry(entryId: string): Promise<Workspace> {
    await this.#ensureInitialized();
    const workspace =
      await this.#configuration.selectEntry(entryId);
    this.#acceptWorkspace(workspace);
    this.#refreshSelectedTargetIfNeeded();
    return workspace;
  }

  async selectTarget(target: RepositoryTarget): Promise<Workspace> {
    await this.#ensureInitialized();
    const workspace =
      await this.#configuration.selectTarget(target);
    this.#acceptWorkspace(workspace);
    this.#refreshSelectedTargetIfNeeded();
    return workspace;
  }

  async requestWorkspaceRefresh(
    reason: "startup" | "manual" = "manual"
  ): Promise<WorkspaceRefreshAccepted> {
    await this.#ensureInitialized();
    return this.#beginWorkspaceRefresh(reason);
  }

  async runWorktreeMutation<Result>(
    target: RepositoryTarget,
    kind: WorktreeMutationKind,
    action: (worktreePath: string) => Promise<Result>
  ): Promise<WorktreeMutationCompleted<Result>> {
    await this.#ensureInitialized();
    this.#resolveMutationWorktreePath(target);

    const key = repositoryTargetKey(target);
    const operation = this.#createOperation(
      kind,
      [key],
      mutationOperationMessage(kind, "queued"),
      "worktree"
    );

    const blockers = [
      this.#worktreeMutationTails.get(key),
      this.#repositoryMutationTails.get(
        target.repositoryId
      )
    ].filter(
      (blocker): blocker is Promise<void> =>
        Boolean(blocker)
    );
    const run = Promise.all(
      blockers.map((blocker) =>
        blocker.catch(() => undefined)
      )
    ).then(() =>
        this.#executeWorktreeMutation(
          target,
          operation,
          action
        )
      );
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    this.#worktreeMutationTails.set(key, tail);
    this.#repositoryMutationTails.set(
      target.repositoryId,
      tail
    );
    this.#emit();
    void tail.finally(() => {
      if (this.#worktreeMutationTails.get(key) === tail) {
        this.#worktreeMutationTails.delete(key);
      }
      if (
        this.#repositoryMutationTails.get(
          target.repositoryId
        ) === tail
      ) {
        this.#repositoryMutationTails.delete(
          target.repositoryId
        );
      }
    });

    return run;
  }

  async queueRepositoryOperation(
    target: RepositoryTarget,
    kind: RepositoryOperationKind,
    action: (
      worktreePath: string,
      signal: AbortSignal
    ) => Promise<void>,
    options: RepositoryOperationOptions = {}
  ): Promise<RepositoryOperationAccepted> {
    await this.#ensureInitialized();
    this.#resolveMutationWorktreePath(target);

    const repositoryTargets =
      this.#repositoryTargets(target.repositoryId);
    const operation = this.#createOperation(
      kind,
      repositoryTargets.map(repositoryTargetKey),
      repositoryOperationMessage(kind, "queued"),
      "repository"
    );
    const controller = new AbortController();
    const blockers = new Set<Promise<void>>();
    const repositoryTail =
      this.#repositoryMutationTails.get(
        target.repositoryId
      );
    if (repositoryTail) {
      blockers.add(repositoryTail);
    }
    for (const candidate of repositoryTargets) {
      const tail = this.#worktreeMutationTails.get(
        repositoryTargetKey(candidate)
      );
      if (tail) {
        blockers.add(tail);
      }
    }

    const run = Promise.all(
      [...blockers].map((blocker) =>
        blocker.catch(() => undefined)
      )
    ).then(() =>
      this.#executeRepositoryOperation(
        target,
        operation,
        controller,
        action,
        options
      )
    );
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    this.#repositoryMutationTails.set(
      target.repositoryId,
      tail
    );
    this.#operationControllers.set(
      operation.id,
      controller
    );
    this.#emit();
    void run.catch(() => undefined);
    void tail.finally(() => {
      if (
        this.#repositoryMutationTails.get(
          target.repositoryId
        ) === tail
      ) {
        this.#repositoryMutationTails.delete(
          target.repositoryId
        );
      }
      this.#operationControllers.delete(operation.id);
    });

    return { operationId: operation.id };
  }

  async cancelOperation(operationId: string): Promise<void> {
    await this.#ensureInitialized();
    const operation = this.#operations.find(
      (candidate) => candidate.id === operationId
    );
    const controller =
      this.#operationControllers.get(operationId);

    if (
      !operation ||
      !controller ||
      operation.state === "succeeded" ||
      operation.state === "failed" ||
      operation.state === "cancelled" ||
      operation.state === "interrupted"
    ) {
      throw new WorkspaceError(
        "INVALID_REQUEST",
        "The requested operation is not cancellable."
      );
    }

    controller.abort();
    this.#updateOperation(operationId, {
      state: "cancelling",
      message: `${repositoryOperationLabel(
        operation.kind as RepositoryOperationKind
      )}正在取消…`
    });
    this.#emit();
  }

  #beginWorkspaceRefresh(
    reason: "startup" | "manual"
  ): WorkspaceRefreshAccepted {
    if (this.#workspaceRefreshOperationId) {
      return {
        operationId: this.#workspaceRefreshOperationId
      };
    }

    const workspace = this.#workspace as Workspace;
    const operation = this.#createOperation(
      "scan",
      listWorkspaceTargets(workspace).map(repositoryTargetKey),
      reason === "startup"
        ? "正在后台重扫 Workspace…"
        : "正在重新扫描 Workspace…"
    );
    this.#workspaceRefreshOperationId = operation.id;
    void this.#runWorkspaceRefresh(operation, reason);
    return { operationId: operation.id };
  }

  async refreshStaleOnFocus(): Promise<void> {
    await this.#ensureInitialized();

    if (
      (this.#autoRefresh && !this.#startupRequested) ||
      this.#workspaceRefreshOperationId ||
      this.#operations.some(
        (operation) =>
          operation.kind === "status" &&
          (operation.state === "queued" ||
            operation.state === "running")
      )
    ) {
      return;
    }

    const workspace = this.#workspace as Workspace;
    const now = Date.parse(this.#clock());
    const staleTargets = listWorkspaceTargets(workspace).filter(
      (target) => {
        const snapshot = this.#snapshots.get(
          repositoryTargetKey(target)
        );
        const refreshedAt = snapshot
          ? Date.parse(snapshot.refreshedAt)
          : Number.NaN;
        return (
          !snapshot ||
          !Number.isFinite(refreshedAt) ||
          now - refreshedAt >= this.#staleAfterMs
        );
      }
    );

    if (staleTargets.length > 0) {
      void this.#runStatusRefresh(staleTargets, "focus");
    }
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    await this.#stopMonitoring();
    await this.#operationPersistenceTask?.catch(
      () => undefined
    );
    this.#listeners.clear();
  }

  async #ensureInitialized(): Promise<void> {
    if (!this.#initialization) {
      this.#initialization = this.#initialize();
    }

    await this.#initialization;
  }

  async #initialize(): Promise<void> {
    const workspace = await this.#configuration.getCurrent();
    this.#workspace = workspace;

    if (this.#operationStore) {
      try {
        const persisted =
          await this.#operationStore.load(workspace.id);
        const recovered = recoverInterruptedOperations(
          persisted,
          this.#clock()
        );
        this.#operations = recovered.operations.slice(
          0,
          MAX_OPERATIONS
        );
        this.#operationSequence =
          maxOperationSequence(this.#operations);
        if (recovered.changed) {
          this.#queueOperationPersistence();
        }
      } catch (error) {
        this.#monitor = {
          mode: "inactive",
          watchedTargets: 0,
          message: `Operation 恢复记录不可用，将从空记录继续：${getErrorMessage(error)}`
        };
      }
    }

    try {
      const cached = await this.#snapshotStore.load(workspace.id);
      const available = new Set(
        listWorkspaceTargets(workspace).map(repositoryTargetKey)
      );

      for (const snapshot of cached) {
        const key = repositoryTargetKey(snapshot);
        if (available.has(key)) {
          this.#snapshots.set(key, {
            ...snapshot,
            refreshPending: false,
            stale: true
          });
        }
      }
    } catch (error) {
      this.#monitor = {
        mode: "inactive",
        watchedTargets: 0,
        message: `Snapshot 缓存不可用，将从 Git 重新读取：${getErrorMessage(error)}`
      };
    }
  }

  async #runWorkspaceRefresh(
    operation: WorkspaceOperation,
    reason: "startup" | "manual"
  ): Promise<void> {
    this.#updateOperation(operation.id, {
      state: "running",
      startedAt: this.#clock(),
      progress: 0.05
    });
    this.#emit();

    try {
      await this.#stopMonitoring();
      this.#monitor = {
        mode: "inactive",
        watchedTargets: 0,
        message: "全量重扫期间已暂停文件监听。"
      };
      this.#emit();
      const workspace = await this.#configuration.rescan();
      this.#acceptWorkspace(workspace);
      this.#updateOperation(operation.id, {
        state: "succeeded",
        progress: 1,
        succeeded: workspace.entries.length,
        message: `Workspace 重扫完成，共 ${workspace.entries.length} 个顶层条目。`,
        finishedAt: this.#clock()
      });
      this.#emit();
      await this.#restartMonitoring();
      await this.#runStatusRefresh(
        listWorkspaceTargets(workspace),
        reason
      );
    } catch (error) {
      this.#updateOperation(operation.id, {
        state: "failed",
        progress: 1,
        failed: 1,
        message: `Workspace 重扫失败：${getErrorMessage(error)}`,
        finishedAt: this.#clock()
      });
      this.#emit();
      await this.#restartMonitoring();
    } finally {
      this.#workspaceRefreshOperationId = undefined;
    }
  }

  async #runStatusRefresh(
    requestedTargets: RepositoryTarget[],
    reason: RefreshReason
  ): Promise<void> {
    if (this.#disposed || !this.#workspace) {
      return;
    }

    const availableTargets = new Map(
      listWorkspaceTargets(this.#workspace).map((target) => [
        repositoryTargetKey(target),
        target
      ])
    );
    const targets = uniqueTargets(requestedTargets)
      .filter((target) =>
        availableTargets.has(repositoryTargetKey(target))
      )
      .filter(
        (target) =>
          !this.#worktreeMutationTails.has(
            repositoryTargetKey(target)
          ) &&
          !this.#repositoryMutationTails.has(
            target.repositoryId
          )
      )
      .sort((left, right) =>
        repositoryTargetsEqual(
          left,
          this.#workspace?.selectedTarget
        )
          ? -1
          : repositoryTargetsEqual(
                right,
                this.#workspace?.selectedTarget
              )
            ? 1
            : 0
      );

    if (targets.length === 0) {
      return;
    }

    const operation = this.#createOperation(
      "status",
      targets.map(repositoryTargetKey),
      statusOperationMessage(reason, targets.length)
    );
    this.#updateOperation(operation.id, {
      state: "running",
      startedAt: this.#clock()
    });

    for (const target of targets) {
      const key = repositoryTargetKey(target);
      this.#snapshots.set(
        key,
        createPendingSnapshot(
          target,
          this.#workspace,
          this.#snapshots.get(key)
        )
      );
    }
    this.#emit();

    let completed = 0;
    let succeeded = 0;
    let failed = 0;

    await Promise.all(
      targets.map(async (target) => {
        const key = repositoryTargetKey(target);

        try {
          const snapshot = await this.#refreshTarget(target);
          if (this.#targetStillAvailable(target)) {
            this.#snapshots.set(key, snapshot);
          }
          succeeded += 1;
        } catch (error) {
          if (this.#targetStillAvailable(target)) {
            this.#snapshots.set(
              key,
              createFailedSnapshot(
                target,
                this.#workspace as Workspace,
                this.#snapshots.get(key),
                error
              )
            );
          }
          failed += 1;
        } finally {
          completed += 1;
          this.#updateOperation(operation.id, {
            progress: completed / targets.length,
            succeeded,
            failed,
            message:
              failed > 0
                ? `已刷新 ${completed}/${targets.length}，${failed} 个失败。`
                : `已刷新 ${completed}/${targets.length} 个仓库。`
          });
          this.#emit();
        }
      })
    );

    try {
      await this.#snapshotStore.save(
        this.#workspace.id,
        this.#orderedSnapshots()
      );
    } catch (error) {
      failed += 1;
      this.#monitor = {
        ...this.#monitor,
        message: `状态已刷新，但 Snapshot 缓存保存失败：${getErrorMessage(error)}`
      };
    }

    this.#updateOperation(operation.id, {
      state: failed > 0 ? "failed" : "succeeded",
      progress: 1,
      succeeded,
      failed,
      message:
        failed > 0
          ? `状态刷新完成：${succeeded} 个成功，${failed} 个失败。`
          : `状态刷新完成：${succeeded} 个仓库。`,
      finishedAt: this.#clock()
    });
    this.#emit();
  }

  #refreshTarget(
    target: RepositoryTarget
  ): Promise<RepositoryStatusSnapshot> {
    const key = repositoryTargetKey(target);
    const existing = this.#inFlight.get(key);

    if (existing) {
      return existing;
    }

    const promise = this.#limiter
      .run(() => this.#readTargetSnapshot(target))
      .finally(() => {
        this.#inFlight.delete(key);
      });
    this.#inFlight.set(key, promise);
    return promise;
  }

  async #readTargetSnapshot(
    target: RepositoryTarget
  ): Promise<RepositoryStatusSnapshot> {
    const workspace = this.#workspace as Workspace;
    const worktree = workspace.worktrees.find(
      (candidate) =>
        candidate.id === target.worktreeId &&
        candidate.repositoryId === target.repositoryId
    );

    if (!worktree) {
      throw new Error("Workspace target worktree is unavailable.");
    }

    const snapshot =
      await this.#gitClient.readRepositorySnapshot(worktree.path);
    return mapStatusSnapshot(target, snapshot);
  }

  async #executeWorktreeMutation<Result>(
    target: RepositoryTarget,
    operation: WorkspaceOperation,
    action: (worktreePath: string) => Promise<Result>
  ): Promise<WorktreeMutationCompleted<Result>> {
    const key = repositoryTargetKey(target);
    let worktreePath: string;

    try {
      worktreePath =
        this.#resolveMutationWorktreePath(target);
    } catch (error) {
      this.#updateOperation(operation.id, {
        state: "failed",
        progress: 1,
        failed: 1,
        message: `${mutationOperationMessage(
          operation.kind as WorktreeMutationKind,
          "failed"
        )} ${getErrorMessage(error)}`,
        finishedAt: this.#clock()
      });
      this.#emit();
      throw error;
    }

    this.#updateOperation(operation.id, {
      state: "running",
      progress: 0.1,
      startedAt: this.#clock(),
      message: mutationOperationMessage(
        operation.kind as WorktreeMutationKind,
        "running"
      )
    });
    this.#emit();

    await this.#inFlight.get(key)?.catch(() => undefined);

    if (this.#workspace && this.#targetStillAvailable(target)) {
      this.#snapshots.set(
        key,
        createPendingSnapshot(
          target,
          this.#workspace,
          this.#snapshots.get(key)
        )
      );
      this.#emit();
    }

    try {
      const result = await action(worktreePath);
      this.#updateOperation(operation.id, {
        progress: 0.75,
        message: mutationOperationMessage(
          operation.kind as WorktreeMutationKind,
          "refreshing"
        )
      });
      this.#emit();
      const refreshWarning =
        await this.#refreshAfterMutation(target);
      this.#updateOperation(operation.id, {
        state: "succeeded",
        progress: 1,
        succeeded: 1,
        message: refreshWarning
          ? `${mutationOperationMessage(
              operation.kind as WorktreeMutationKind,
              "succeeded"
            )} ${refreshWarning}`
          : mutationOperationMessage(
              operation.kind as WorktreeMutationKind,
              "succeeded"
            ),
        finishedAt: this.#clock()
      });
      this.#emit();
      return {
        operationId: operation.id,
        result
      };
    } catch (error) {
      const refreshWarning =
        await this.#refreshAfterMutation(target);
      this.#updateOperation(operation.id, {
        state: "failed",
        progress: 1,
        failed: 1,
        message: `${mutationOperationMessage(
          operation.kind as WorktreeMutationKind,
          "failed"
        )} ${getErrorMessage(error)}${
          refreshWarning ? ` ${refreshWarning}` : ""
        }`,
        finishedAt: this.#clock()
      });
      this.#emit();
      throw error;
    }
  }

  async #executeRepositoryOperation(
    target: RepositoryTarget,
    operation: WorkspaceOperation,
    controller: AbortController,
    action: (
      worktreePath: string,
      signal: AbortSignal
    ) => Promise<void>,
    options: RepositoryOperationOptions
  ): Promise<void> {
    const kind =
      operation.kind as RepositoryOperationKind;

    if (controller.signal.aborted) {
      this.#updateOperation(operation.id, {
        state: "cancelled",
        progress: 1,
        message: repositoryOperationMessage(
          kind,
          "cancelled"
        ),
        finishedAt: this.#clock()
      });
      this.#emit();
      return;
    }

    let worktreePath: string;
    try {
      worktreePath =
        this.#resolveMutationWorktreePath(target);
    } catch (error) {
      this.#updateOperation(operation.id, {
        state: "failed",
        progress: 1,
        failed: 1,
        message: `${repositoryOperationMessage(
          kind,
          "failed"
        )} ${getErrorMessage(error)}`,
        finishedAt: this.#clock()
      });
      this.#emit();
      return;
    }

    this.#updateOperation(operation.id, {
      state: "running",
      progress: 0.1,
      startedAt: this.#clock(),
      message: repositoryOperationMessage(kind, "running")
    });
    this.#emit();

    const repositoryTargets =
      this.#repositoryTargets(target.repositoryId);
    await Promise.all(
      repositoryTargets.map((candidate) =>
        this.#inFlight
          .get(repositoryTargetKey(candidate))
          ?.catch(() => undefined)
      )
    );

    if (controller.signal.aborted) {
      this.#updateOperation(operation.id, {
        state: "cancelled",
        progress: 1,
        message: repositoryOperationMessage(
          kind,
          "cancelled"
        ),
        finishedAt: this.#clock()
      });
      this.#emit();
      return;
    }

    if (this.#workspace) {
      for (const candidate of repositoryTargets) {
        const key = repositoryTargetKey(candidate);
        this.#snapshots.set(
          key,
          createPendingSnapshot(
            candidate,
            this.#workspace,
            this.#snapshots.get(key)
          )
        );
      }
      this.#emit();
    }

    try {
      await action(worktreePath, controller.signal);
      this.#updateOperation(operation.id, {
        progress: 0.75,
        message: options.refreshTopology
          ? `${repositoryOperationLabel(kind)} 已完成，正在重扫 Worktree 拓扑…`
          : repositoryOperationMessage(
              kind,
              "refreshing"
            )
      });
      this.#emit();
      const refreshWarning = options.refreshTopology
        ? await this.#refreshTopologyAfterRepositoryMutation(
            target.repositoryId
          )
        : await this.#refreshRepositoryAfterMutation(
            target.repositoryId
          );
      this.#updateOperation(operation.id, {
        targetIds: this.#repositoryTargets(
          target.repositoryId
        ).map(repositoryTargetKey)
      });
      this.#updateOperation(operation.id, {
        state: "succeeded",
        progress: 1,
        succeeded: 1,
        message: refreshWarning
          ? `${repositoryOperationMessage(
              kind,
              "succeeded"
            )} ${refreshWarning}`
          : repositoryOperationMessage(
              kind,
              "succeeded"
            ),
        finishedAt: this.#clock()
      });
      this.#emit();
    } catch (error) {
      const refreshWarning = options.refreshTopology
        ? await this.#refreshTopologyAfterRepositoryMutation(
            target.repositoryId
          )
        : await this.#refreshRepositoryAfterMutation(
            target.repositoryId
          );
      this.#updateOperation(operation.id, {
        targetIds: this.#repositoryTargets(
          target.repositoryId
        ).map(repositoryTargetKey)
      });
      const cancelled =
        controller.signal.aborted ||
        getErrorCode(error) === "COMMAND_CANCELLED";
      this.#updateOperation(operation.id, {
        state: cancelled ? "cancelled" : "failed",
        progress: 1,
        failed: cancelled ? 0 : 1,
        message: `${
          cancelled
            ? repositoryOperationMessage(
                kind,
                "cancelled"
              )
            : `${repositoryOperationMessage(
                kind,
                "failed"
              )} ${getErrorMessage(error)}`
        }${refreshWarning ? ` ${refreshWarning}` : ""}`,
        finishedAt: this.#clock()
      });
      this.#emit();
    }
  }

  async #refreshTopologyAfterRepositoryMutation(
    repositoryId: string
  ): Promise<string | undefined> {
    const warnings: string[] = [];

    try {
      await this.#stopMonitoring();
    } catch (error) {
      warnings.push(
        `监听暂停失败：${getErrorMessage(error)}`
      );
    }

    try {
      const workspace = await this.#configuration.rescan();
      this.#acceptWorkspace(workspace);
    } catch (error) {
      warnings.push(
        `Workspace 拓扑重扫失败：${getErrorMessage(error)}`
      );
    }

    try {
      await this.#restartMonitoring();
    } catch (error) {
      warnings.push(
        `监听恢复失败：${getErrorMessage(error)}`
      );
    }

    try {
      const refreshWarning =
        await this.#refreshRepositoryAfterMutation(
          repositoryId
        );
      if (refreshWarning) {
        warnings.push(refreshWarning);
      }
    } catch (error) {
      warnings.push(
        `仓库状态刷新失败：${getErrorMessage(error)}`
      );
    }

    return warnings.length > 0
      ? `拓扑刷新有警告：${warnings[0]}`
      : undefined;
  }

  async #refreshAfterMutation(
    target: RepositoryTarget
  ): Promise<string | undefined> {
    return this.#refreshMutationTargets([target]);
  }

  async #refreshRepositoryAfterMutation(
    repositoryId: string
  ): Promise<string | undefined> {
    return this.#refreshMutationTargets(
      this.#repositoryTargets(repositoryId)
    );
  }

  async #refreshMutationTargets(
    requestedTargets: RepositoryTarget[]
  ): Promise<string | undefined> {
    if (!this.#workspace) {
      return undefined;
    }

    const targets = uniqueTargets(requestedTargets).filter(
      (target) => this.#targetStillAvailable(target)
    );
    if (targets.length === 0) {
      return undefined;
    }

    for (const target of targets) {
      const key = repositoryTargetKey(target);
      const timer = this.#debounceTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        this.#debounceTimers.delete(key);
      }
    }

    const warnings: string[] = [];
    await Promise.all(
      targets.map(async (target) => {
        const key = repositoryTargetKey(target);

        try {
          const snapshot = await this.#limiter.run(() =>
            this.#readTargetSnapshot(target)
          );
          if (this.#targetStillAvailable(target)) {
            this.#snapshots.set(key, snapshot);
          }
        } catch (error) {
          warnings.push(getErrorMessage(error));
          if (
            this.#workspace &&
            this.#targetStillAvailable(target)
          ) {
            this.#snapshots.set(
              key,
              createFailedSnapshot(
                target,
                this.#workspace,
                this.#snapshots.get(key),
                error
              )
            );
          }
        }
      })
    );

    try {
      await this.#snapshotStore.save(
        this.#workspace.id,
        this.#orderedSnapshots()
      );
    } catch (error) {
      const warning = `Snapshot 缓存保存失败：${getErrorMessage(error)}`;
      this.#monitor = {
        ...this.#monitor,
        message: warning
      };
      warnings.push(warning);
    }

    return warnings.length > 0
      ? `状态刷新有警告：${warnings[0]}`
      : undefined;
  }

  #resolveMutationWorktreePath(
    target: RepositoryTarget
  ): string {
    const workspace = this.#workspace as Workspace;
    const key = repositoryTargetKey(target);
    const registered = listWorkspaceTargets(workspace).some(
      (candidate) => repositoryTargetKey(candidate) === key
    );
    const worktree = workspace.worktrees.find(
      (candidate) =>
        candidate.id === target.worktreeId &&
        candidate.repositoryId === target.repositoryId
    );

    if (!registered || !worktree) {
      throw new WorkspaceError(
        "INVALID_REQUEST",
        "Repository mutations require a target registered in the current Workspace."
      );
    }

    if (worktree.isBare) {
      throw new WorkspaceError(
        "INVALID_REQUEST",
        "Repository mutations require a non-bare Worktree."
      );
    }

    return worktree.path;
  }

  #repositoryTargets(
    repositoryId: string
  ): RepositoryTarget[] {
    if (!this.#workspace) {
      return [];
    }

    return listWorkspaceTargets(this.#workspace).filter(
      (target) => target.repositoryId === repositoryId
    );
  }

  #acceptWorkspace(workspace: Workspace): void {
    this.#workspace = workspace;
    const available = new Set(
      listWorkspaceTargets(workspace).map(repositoryTargetKey)
    );

    for (const key of this.#snapshots.keys()) {
      if (!available.has(key)) {
        this.#snapshots.delete(key);
      }
    }

    this.#emit();
  }

  #startMonitoringAndRefresh(reason: RefreshReason): void {
    void this.#restartMonitoring().catch((error) => {
      void this.#switchToPolling(getErrorMessage(error));
    });

    if (this.#workspace) {
      void this.#runStatusRefresh(
        listWorkspaceTargets(this.#workspace),
        reason
      );
    }
  }

  async #restartMonitoring(): Promise<void> {
    await this.#stopMonitoring();

    if (this.#disposed || !this.#workspace) {
      return;
    }

    const registrations = createWatchRegistrations(this.#workspace);

    if (registrations.length === 0) {
      this.#monitor = {
        mode: "inactive",
        watchedTargets: 0,
        message: "当前没有可监听的仓库。"
      };
      this.#emit();
      return;
    }

    if (
      registrations.length > this.#watcherRegistrationLimit
    ) {
      await this.#switchToPolling(
        `监听路径数量 ${registrations.length} 超过上限 ${this.#watcherRegistrationLimit}。`
      );
      return;
    }

    try {
      this.#watchHandle = await this.#watcher.watch(
        registrations,
        (event) => {
          this.#monitor = {
            ...this.#monitor,
            lastEventAt: this.#clock()
          };
          this.#scheduleWatchedRefresh(event.target);
        },
        (error) => {
          void this.#switchToPolling(error.message);
        }
      );
      this.#monitor = {
        mode: "watching",
        watchedTargets: uniqueTargets(
          registrations.map((registration) => registration.target)
        ).length,
        message: `正在监听 ${registrations.length} 个工作目录与 Git 元数据路径。`
      };
      this.#emit();
    } catch (error) {
      await this.#switchToPolling(getErrorMessage(error));
    }
  }

  async #switchToPolling(reason: string): Promise<void> {
    await this.#watchHandle?.close();
    this.#watchHandle = undefined;

    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
    }

    if (this.#disposed) {
      return;
    }

    this.#monitor = {
      mode: "polling",
      watchedTargets: this.#workspace
        ? listWorkspaceTargets(this.#workspace).length
        : 0,
      message: `文件监听不可用，已降级为低频轮询：${reason}`
    };
    this.#pollTimer = setInterval(() => {
      if (this.#workspace) {
        void this.#runStatusRefresh(
          listWorkspaceTargets(this.#workspace),
          "polling"
        );
      }
    }, this.#pollingIntervalMs);
    this.#emit();
  }

  #scheduleWatchedRefresh(target: RepositoryTarget): void {
    const key = repositoryTargetKey(target);
    const existing = this.#debounceTimers.get(key);

    if (existing) {
      clearTimeout(existing);
    }

    const current = repositoryTargetsEqual(
      target,
      this.#workspace?.selectedTarget
    );
    const timer = setTimeout(() => {
      this.#debounceTimers.delete(key);
      void this.#runStatusRefresh([target], "watcher");
    }, current
      ? this.#currentTargetDebounceMs
      : this.#backgroundTargetDebounceMs);
    this.#debounceTimers.set(key, timer);
  }

  #refreshSelectedTargetIfNeeded(): void {
    const target = this.#workspace?.selectedTarget;

    if (!target) {
      return;
    }

    const snapshot = this.#snapshots.get(
      repositoryTargetKey(target)
    );
    if (this.#inFlight.has(repositoryTargetKey(target))) {
      return;
    }
    const refreshedAt = snapshot
      ? Date.parse(snapshot.refreshedAt)
      : Number.NaN;
    const stale =
      !snapshot ||
      snapshot.stale ||
      !Number.isFinite(refreshedAt) ||
      Date.parse(this.#clock()) - refreshedAt >= this.#staleAfterMs;

    if (stale) {
      void this.#runStatusRefresh([target], "focus");
    }
  }

  async #stopMonitoring(): Promise<void> {
    await this.#watchHandle?.close();
    this.#watchHandle = undefined;

    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = undefined;
    }

    for (const timer of this.#debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.#debounceTimers.clear();
  }

  #targetStillAvailable(target: RepositoryTarget): boolean {
    return Boolean(
      this.#workspace &&
      listWorkspaceTargets(this.#workspace).some(
        (candidate) =>
          repositoryTargetKey(candidate) ===
          repositoryTargetKey(target)
      )
    );
  }

  #createOperation(
    kind: WorkspaceOperation["kind"],
    targetIds: string[],
    message: string,
    scope: WorkspaceOperation["scope"] = "workspace"
  ): WorkspaceOperation {
    const operation: WorkspaceOperation = {
      id: `operation_${++this.#operationSequence}_${this.#clock().replace(/[^0-9]/g, "")}`,
      kind,
      scope,
      targetIds,
      state: "queued",
      progress: 0,
      succeeded: 0,
      failed: 0,
      message
    };
    this.#operations = [
      operation,
      ...this.#operations
    ].slice(0, MAX_OPERATIONS);
    return operation;
  }

  #updateOperation(
    operationId: string,
    patch: Partial<WorkspaceOperation>
  ): void {
    this.#operations = this.#operations.map((operation) =>
      operation.id === operationId
        ? { ...operation, ...patch }
        : operation
    );
  }

  #orderedSnapshots(): RepositoryStatusSnapshot[] {
    if (!this.#workspace) {
      return [];
    }

    return listWorkspaceTargets(this.#workspace)
      .map((target) =>
        this.#snapshots.get(repositoryTargetKey(target))
      )
      .filter(
        (snapshot): snapshot is RepositoryStatusSnapshot =>
          Boolean(snapshot)
      );
  }

  #createState(): WorkspaceRuntimeState {
    return structuredClone({
      workspace: this.#workspace as Workspace,
      snapshots: this.#orderedSnapshots(),
      operations: this.#operations,
      monitor: this.#monitor
    });
  }

  #emit(): void {
    if (this.#disposed || !this.#workspace) {
      return;
    }

    this.#queueOperationPersistence();
    const state = this.#createState();
    for (const listener of this.#listeners) {
      try {
        listener(state);
      } catch {
        // A closed renderer must not interrupt refresh or cache persistence.
      }
    }
  }

  #queueOperationPersistence(): void {
    if (
      !this.#operationStore ||
      !this.#workspace ||
      this.#disposed
    ) {
      return;
    }
    this.#operationPersistenceRequested = true;
    if (this.#operationPersistenceTask) {
      return;
    }
    this.#operationPersistenceTask =
      this.#persistOperationsLoop().finally(() => {
        this.#operationPersistenceTask = undefined;
        if (
          this.#operationPersistenceRequested &&
          !this.#disposed
        ) {
          this.#queueOperationPersistence();
        }
      });
  }

  async #persistOperationsLoop(): Promise<void> {
    while (
      this.#operationPersistenceRequested &&
      this.#operationStore &&
      this.#workspace
    ) {
      this.#operationPersistenceRequested = false;
      const workspaceId = this.#workspace.id;
      const operations = structuredClone(this.#operations);
      try {
        await this.#operationStore.save(
          workspaceId,
          operations
        );
      } catch (error) {
        this.#monitor = {
          ...this.#monitor,
          message: `Operation 恢复记录保存失败：${getErrorMessage(error)}`
        };
      }
    }
  }
}

function recoverInterruptedOperations(
  operations: WorkspaceOperation[],
  recoveredAt: string
): {
  operations: WorkspaceOperation[];
  changed: boolean;
} {
  let changed = false;
  const recovered = operations.map((operation) => {
    if (
      operation.state !== "queued" &&
      operation.state !== "running" &&
      operation.state !== "cancelling"
    ) {
      return operation;
    }
    changed = true;
    return {
      ...operation,
      state: "interrupted" as const,
      progress: 1,
      failed: 0,
      message: `${workspaceOperationLabel(operation.kind)} 在上次应用退出时被中断；GitNest 未假定操作成功、失败或已回滚，请以刷新后的仓库状态为准。`,
      finishedAt: recoveredAt
    };
  });
  return { operations: recovered, changed };
}

function maxOperationSequence(
  operations: WorkspaceOperation[]
): number {
  return operations.reduce((maximum, operation) => {
    const match = /^operation_(\d+)_/.exec(operation.id);
    const sequence = match ? Number(match[1]) : 0;
    return Number.isFinite(sequence)
      ? Math.max(maximum, sequence)
      : maximum;
  }, 0);
}

function uniqueTargets(
  targets: RepositoryTarget[]
): RepositoryTarget[] {
  return [
    ...new Map(
      targets.map((target) => [
        repositoryTargetKey(target),
        target
      ])
    ).values()
  ];
}

function mapStatusSnapshot(
  target: RepositoryTarget,
  snapshot: RepositorySnapshot
): RepositoryStatusSnapshot {
  return {
    ...target,
    ...(snapshot.branch ? { branch: snapshot.branch } : {}),
    head: snapshot.head,
    ...(snapshot.upstream ? { upstream: snapshot.upstream } : {}),
    ahead: snapshot.ahead,
    behind: snapshot.behind,
    staged: snapshot.staged,
    unstaged: snapshot.unstaged,
    untracked: snapshot.untracked,
    conflicted: snapshot.conflicted,
    refreshPending: false,
    stale: false,
    refreshedAt: snapshot.refreshedAt
  };
}

function createPendingSnapshot(
  target: RepositoryTarget,
  workspace: Workspace,
  existing: RepositoryStatusSnapshot | undefined
): RepositoryStatusSnapshot {
  if (existing) {
    return {
      ...existing,
      refreshPending: true
    };
  }

  const worktree = workspace.worktrees.find(
    (candidate) => candidate.id === target.worktreeId
  );
  return {
    ...target,
    ...(worktree?.branch ? { branch: worktree.branch } : {}),
    head: worktree?.head ?? "",
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    refreshPending: true,
    stale: true,
    refreshedAt: ""
  };
}

function createFailedSnapshot(
  target: RepositoryTarget,
  workspace: Workspace,
  existing: RepositoryStatusSnapshot | undefined,
  error: unknown
): RepositoryStatusSnapshot {
  const pending = createPendingSnapshot(
    target,
    workspace,
    existing
  );
  return {
    ...pending,
    refreshPending: false,
    stale: true,
    error: {
      code: getErrorCode(error),
      message: getErrorMessage(error)
    }
  };
}

function createWatchRegistrations(
  workspace: Workspace
): WorkspaceWatchRegistration[] {
  const registrations = new Map<
    string,
    WorkspaceWatchRegistration
  >();

  for (const target of listWorkspaceTargets(workspace)) {
    const targetKey = repositoryTargetKey(target);
    const worktree = workspace.worktrees.find(
      (candidate) => candidate.id === target.worktreeId
    );
    const repository = workspace.repositories.find(
      (candidate) => candidate.id === target.repositoryId
    );

    if (!worktree) {
      continue;
    }

    addRegistration(worktree.path, true);
    if (worktree.gitDir) {
      addRegistration(worktree.gitDir, true);
    }
    if (repository?.commonDir) {
      addRegistration(repository.commonDir, true);
    }

    function addRegistration(
      path: string,
      recursive: boolean
    ): void {
      const key = `${targetKey}\0${path.toLocaleLowerCase("en-US")}`;
      registrations.set(key, {
        path,
        target,
        recursive
      });
    }
  }

  return [...registrations.values()];
}

function statusOperationMessage(
  reason: RefreshReason,
  count: number
): string {
  const labels: Record<RefreshReason, string> = {
    startup: "启动后台刷新",
    manual: "手动刷新",
    "workspace-change": "Workspace 变更刷新",
    watcher: "文件变化刷新",
    polling: "低频轮询刷新",
    focus: "窗口聚焦刷新"
  };
  return `${labels[reason]}：${count} 个仓库。`;
}

function mutationOperationMessage(
  kind: WorktreeMutationKind,
  state:
    | "queued"
    | "running"
    | "refreshing"
    | "succeeded"
    | "failed"
): string {
  const labels: Record<
    WorktreeMutationKind,
    Record<typeof state, string>
  > = {
    stage: {
      queued: "暂存操作正在排队。",
      running: "正在暂存所选路径…",
      refreshing: "暂存完成，正在刷新仓库状态…",
      succeeded: "所选路径已暂存。",
      failed: "暂存失败："
    },
    unstage: {
      queued: "取消暂存操作正在排队。",
      running: "正在取消暂存所选路径…",
      refreshing: "取消暂存完成，正在刷新仓库状态…",
      succeeded: "所选路径已取消暂存。",
      failed: "取消暂存失败："
    },
    commit: {
      queued: "提交操作正在排队。",
      running: "正在创建提交并执行 Git Hooks…",
      refreshing: "提交完成，正在刷新仓库状态…",
      succeeded: "提交已创建。",
      failed: "提交失败："
    }
  };
  return labels[kind][state];
}

function repositoryOperationLabel(
  kind: RepositoryOperationKind
): string {
  return {
    fetch: "Fetch",
    pull: "Pull",
    push: "Push",
    "switch-branch": "切换分支",
    "create-branch": "创建分支",
    "rename-branch": "重命名分支",
    "delete-branch": "删除分支",
    "worktree-create": "创建 Worktree",
    "worktree-lock": "锁定 Worktree",
    "worktree-unlock": "解锁 Worktree",
    "worktree-move": "移动 Worktree",
    "worktree-repair": "修复 Worktree 登记",
    "worktree-prune": "裁剪 Worktree 登记",
    "worktree-remove": "移除 Worktree"
  }[kind];
}

function workspaceOperationLabel(
  kind: WorkspaceOperation["kind"]
): string {
  return {
    scan: "Workspace 扫描",
    status: "仓库状态刷新",
    stage: "暂存",
    unstage: "取消暂存",
    commit: "提交",
    fetch: "Fetch",
    pull: "Pull",
    push: "Push",
    "switch-branch": "切换分支",
    "create-branch": "创建分支",
    "rename-branch": "重命名分支",
    "delete-branch": "删除分支",
    "worktree-create": "创建 Worktree",
    "worktree-lock": "锁定 Worktree",
    "worktree-unlock": "解锁 Worktree",
    "worktree-move": "移动 Worktree",
    "worktree-repair": "修复 Worktree 登记",
    "worktree-prune": "裁剪 Worktree 登记",
    "worktree-remove": "移除 Worktree"
  }[kind];
}

function repositoryOperationMessage(
  kind: RepositoryOperationKind,
  state:
    | "queued"
    | "running"
    | "refreshing"
    | "succeeded"
    | "failed"
    | "cancelled"
): string {
  const label = repositoryOperationLabel(kind);

  return {
    queued: `${label} 操作正在排队。`,
    running: `正在执行 ${label}…`,
    refreshing: `${label} 已完成，正在刷新仓库状态…`,
    succeeded: `${label} 已完成。`,
    failed: `${label} 失败：`,
    cancelled: `${label} 已取消。`
  }[state];
}

function getErrorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "COMMAND_FAILED";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "未知错误。";
}
