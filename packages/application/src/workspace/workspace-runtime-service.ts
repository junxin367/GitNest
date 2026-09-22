import { createHash } from "node:crypto";

import type {
  GitClient,
  RepositorySnapshot
} from "@gitnest/git-core";
import {
  findTargetEntry,
  listWorkspaceTargets,
  repositoryTargetKey,
  repositoryTargetsEqual,
  summarizeWorkspace,
  WorkspaceError,
  type RepositorySnapshotStore,
  type RepositoryStatusSnapshot,
  type RepositoryTarget,
  type Workspace,
  type WorkspaceWatchEvent,
  type WorkspaceWatchHandle,
  type WorkspaceWatcher,
  type WorkspaceWatchRegistration,
  type WorkspaceSummary
} from "@gitnest/workspace-core";

import { ConcurrencyLimiter } from "../operations/concurrency-limiter";
import type {
  CreateWorkspaceInput,
  RenameWorkspaceInput
} from "./workspace-collection-service";
import type {
  AddWorkspaceEntryInput,
  RemoveWorkspaceEntryInput,
  SetWorkspaceGroupCollapsedInput,
  UpdateWorkspaceEntryInput,
  WorkspaceMutationResult
} from "./workspace-service";
import {
  WorkspaceRefreshScheduler,
  type BackgroundRefreshBatchResult,
  type BackgroundRefreshFailure,
  type BackgroundRefreshReason,
  type BackgroundRefreshRequest,
  type WorkspaceRefreshDiagnostic
} from "./workspace-refresh-scheduler";

export type { WorkspaceRefreshDiagnostic };

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
    | "discard"
    | "commit"
    | "stash-apply"
    | "stash-drop"
    | "stash-pop"
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
  workspaces: WorkspaceSummary[];
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
  delete?(workspaceId: string): Promise<void>;
}

export interface WorkspaceRefreshAccepted {
  operationId: string;
}

export type WorktreeMutationKind =
  | "stage"
  | "unstage"
  | "discard"
  | "commit"
  | "stash-apply"
  | "stash-drop"
  | "stash-pop";

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
  currentTargetMinIntervalMs?: number;
  backgroundTargetMinIntervalMs?: number;
  pollingIntervalMs?: number;
  selectedTargetPollingIntervalMs?: number;
  selectedEntryPollingIntervalMs?: number;
  backgroundPollingIntervalMs?: number;
  selectedTargetHeartbeatIntervalMs?: number;
  staleAfterMs?: number;
  watcherRegistrationLimit?: number;
  autoRefresh?: boolean;
  operationStore?: WorkspaceOperationStore;
  clock?: () => string;
  onDiagnostic?(
    diagnostic: WorkspaceRefreshDiagnostic
  ): void | Promise<void>;
}

export interface WorkspaceConfigurationService {
  getCurrent(): Promise<Workspace>;
  listWorkspaces?(): Promise<WorkspaceSummary[]>;
  createWorkspace?(
    input: CreateWorkspaceInput
  ): Promise<Workspace>;
  switchWorkspace?(workspaceId: string): Promise<Workspace>;
  renameWorkspace?(
    input: RenameWorkspaceInput
  ): Promise<Workspace>;
  deleteWorkspace?(workspaceId: string): Promise<Workspace>;
  addEntry(
    input: AddWorkspaceEntryInput
  ): Promise<WorkspaceMutationResult>;
  rescan(signal?: AbortSignal): Promise<Workspace>;
  updateEntry(
    input: UpdateWorkspaceEntryInput
  ): Promise<Workspace>;
  removeEntry(
    input: RemoveWorkspaceEntryInput
  ): Promise<Workspace>;
  setGroupCollapsed(
    input: SetWorkspaceGroupCollapsedInput
  ): Promise<Workspace>;
  selectEntry(entryId: string): Promise<Workspace>;
  selectTarget(target: RepositoryTarget): Promise<Workspace>;
}

type RuntimeListener = (state: WorkspaceRuntimeState) => void;
type RefreshReason = BackgroundRefreshReason | "manual";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_CURRENT_DEBOUNCE_MS = 400;
const DEFAULT_BACKGROUND_DEBOUNCE_MS = 2_000;
const DEFAULT_CURRENT_MIN_INTERVAL_MS = 1_000;
const DEFAULT_BACKGROUND_MIN_INTERVAL_MS = 5_000;
const DEFAULT_SELECTED_TARGET_POLLING_INTERVAL_MS = 15_000;
const DEFAULT_SELECTED_ENTRY_POLLING_INTERVAL_MS = 60_000;
const DEFAULT_BACKGROUND_POLLING_INTERVAL_MS = 180_000;
const DEFAULT_SELECTED_TARGET_HEARTBEAT_INTERVAL_MS = 60_000;
const DEFAULT_STALE_AFTER_MS = 30_000;
const DEFAULT_WATCHER_REGISTRATION_LIMIT = 96;
const BACKGROUND_FAILURE_MERGE_WINDOW_MS = 5 * 60_000;
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
  readonly #staleAfterMs: number;
  readonly #watcherRegistrationLimit: number;
  readonly #autoRefresh: boolean;
  readonly #refreshScheduler: WorkspaceRefreshScheduler;
  readonly #onDiagnostic:
    | ((
        diagnostic: WorkspaceRefreshDiagnostic
      ) => void | Promise<void>)
    | undefined;
  readonly #listeners = new Set<RuntimeListener>();
  readonly #snapshots = new Map<
    string,
    RepositoryStatusSnapshot
  >();
  readonly #snapshotContentSignatures = new Map<
    string,
    string
  >();
  readonly #snapshotChangedPaths = new Map<
    string,
    Set<string>
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
  readonly #backgroundRefreshTasks = new Set<
    Promise<BackgroundRefreshBatchResult>
  >();
  #workspace: Workspace | undefined;
  #workspaces: WorkspaceSummary[] = [];
  #operations: WorkspaceOperation[] = [];
  #monitor: WorkspaceMonitorState = {
    mode: "inactive",
    watchedTargets: 0,
    message: "Workspace 监听尚未启动。"
  };
  #initialization: Promise<void> | undefined;
  #startupRequested = false;
  #workspaceRefreshOperationId: string | undefined;
  #workspaceRefreshTask: Promise<void> | undefined;
  #workspaceRefreshController: AbortController | undefined;
  #watchHandle: WorkspaceWatchHandle | undefined;
  #operationSequence = 0;
  #operationPersistenceRequested = false;
  #operationPersistenceTask: Promise<void> | undefined;
  #snapshotPersistenceTail: Promise<void> = Promise.resolve();
  #workspaceTransitionTail: Promise<void> = Promise.resolve();
  #repositoryRefreshController = new AbortController();
  #monitorGeneration = 0;
  #workspaceGeneration = 0;
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
    this.#staleAfterMs =
      options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.#watcherRegistrationLimit =
      options.watcherRegistrationLimit ??
      DEFAULT_WATCHER_REGISTRATION_LIMIT;
    this.#autoRefresh = options.autoRefresh ?? true;
    this.#onDiagnostic = options.onDiagnostic;
    const compatibilityPollingInterval =
      options.pollingIntervalMs;
    this.#refreshScheduler =
      new WorkspaceRefreshScheduler({
        selectedDebounceMs:
          options.currentTargetDebounceMs ??
          DEFAULT_CURRENT_DEBOUNCE_MS,
        backgroundDebounceMs:
          options.backgroundTargetDebounceMs ??
          DEFAULT_BACKGROUND_DEBOUNCE_MS,
        selectedMinIntervalMs:
          options.currentTargetMinIntervalMs ??
          DEFAULT_CURRENT_MIN_INTERVAL_MS,
        backgroundMinIntervalMs:
          options.backgroundTargetMinIntervalMs ??
          DEFAULT_BACKGROUND_MIN_INTERVAL_MS,
        heartbeatIntervalMs:
          options.selectedTargetHeartbeatIntervalMs ??
          DEFAULT_SELECTED_TARGET_HEARTBEAT_INTERVAL_MS,
        selectedPollingIntervalMs:
          options.selectedTargetPollingIntervalMs ??
          DEFAULT_SELECTED_TARGET_POLLING_INTERVAL_MS,
        selectedEntryPollingIntervalMs:
          options.selectedEntryPollingIntervalMs ??
          compatibilityPollingInterval ??
          DEFAULT_SELECTED_ENTRY_POLLING_INTERVAL_MS,
        backgroundPollingIntervalMs:
          options.backgroundPollingIntervalMs ??
          compatibilityPollingInterval ??
          DEFAULT_BACKGROUND_POLLING_INTERVAL_MS,
        clock: this.#clock,
        execute: (requests) =>
          this.#trackBackgroundRefresh(requests),
        isStale: (target) => this.#isTargetStale(target),
        ...(options.onDiagnostic
          ? { onDiagnostic: options.onDiagnostic }
          : {})
      });
  }

  subscribe(listener: RuntimeListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async getCurrent(): Promise<Workspace> {
    await this.#ensureReady();
    return this.#workspace as Workspace;
  }

  async getState(): Promise<WorkspaceRuntimeState> {
    await this.#ensureReady();
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

  async createWorkspace(
    input: CreateWorkspaceInput
  ): Promise<WorkspaceRuntimeState> {
    await this.#ensureInitialized();
    if (!this.#configuration.createWorkspace) {
      throw multiWorkspaceUnavailable();
    }
    return this.#queueWorkspaceTransition(() =>
      this.#configuration.createWorkspace?.(input) as Promise<Workspace>
    );
  }

  async switchWorkspace(
    workspaceId: string
  ): Promise<WorkspaceRuntimeState> {
    await this.#ensureInitialized();
    if (this.#workspace?.id === workspaceId) {
      await this.#workspaceTransitionTail;
      return this.#createState();
    }
    if (!this.#configuration.switchWorkspace) {
      throw multiWorkspaceUnavailable();
    }
    return this.#queueWorkspaceTransition(() =>
      this.#configuration.switchWorkspace?.(
        workspaceId
      ) as Promise<Workspace>
    );
  }

  async renameWorkspace(
    input: RenameWorkspaceInput
  ): Promise<WorkspaceRuntimeState> {
    await this.#ensureReady();
    if (!this.#configuration.renameWorkspace) {
      throw multiWorkspaceUnavailable();
    }
    const workspace =
      await this.#configuration.renameWorkspace(input);
    await this.#refreshWorkspaceSummaries(workspace);
    this.#acceptWorkspace(workspace);
    return this.#createState();
  }

  async deleteWorkspace(
    workspaceId: string
  ): Promise<WorkspaceRuntimeState> {
    await this.#ensureInitialized();
    if (!this.#configuration.deleteWorkspace) {
      throw multiWorkspaceUnavailable();
    }
    return this.#queueWorkspaceTransition(
      () =>
        this.#configuration.deleteWorkspace?.(
          workspaceId
        ) as Promise<Workspace>,
      workspaceId
    );
  }

  async addEntry(
    input: AddWorkspaceEntryInput
  ): Promise<WorkspaceMutationResult> {
    await this.#ensureReady();
    const result = await this.#configuration.addEntry(input);
    await this.#refreshWorkspaceSummaries(result.workspace);
    this.#acceptWorkspace(result.workspace);
    this.#startMonitoringAndRefresh("workspace-change");
    return result;
  }

  async rescan(): Promise<Workspace> {
    await this.#ensureReady();
    const workspace = await this.#configuration.rescan();
    await this.#refreshWorkspaceSummaries(workspace);
    this.#acceptWorkspace(workspace);
    this.#startMonitoringAndRefresh("workspace-change");
    return workspace;
  }

  async updateEntry(
    input: UpdateWorkspaceEntryInput
  ): Promise<Workspace> {
    await this.#ensureReady();
    const workspace = await this.#configuration.updateEntry(input);
    await this.#refreshWorkspaceSummaries(workspace);
    this.#acceptWorkspace(workspace);
    return workspace;
  }

  async removeEntry(
    input: RemoveWorkspaceEntryInput
  ): Promise<Workspace> {
    await this.#ensureReady();
    const workspace =
      await this.#configuration.removeEntry(input);
    await this.#refreshWorkspaceSummaries(workspace);
    this.#acceptWorkspace(workspace);
    this.#startMonitoringAndRefresh("workspace-change");
    return workspace;
  }

  async setGroupCollapsed(
    input: SetWorkspaceGroupCollapsedInput
  ): Promise<Workspace> {
    await this.#ensureReady();
    const workspace =
      await this.#configuration.setGroupCollapsed(input);
    await this.#refreshWorkspaceSummaries(workspace);
    this.#acceptWorkspace(workspace);
    return workspace;
  }

  async selectEntry(entryId: string): Promise<Workspace> {
    await this.#ensureReady();
    const workspace =
      await this.#configuration.selectEntry(entryId);
    await this.#refreshWorkspaceSummaries(workspace);
    this.#acceptWorkspace(workspace);
    this.#refreshScheduler.requestSelectedIfStale(
      "workspace-change"
    );
    return workspace;
  }

  async selectTarget(target: RepositoryTarget): Promise<Workspace> {
    await this.#ensureReady();
    const workspace =
      await this.#configuration.selectTarget(target);
    await this.#refreshWorkspaceSummaries(workspace);
    this.#acceptWorkspace(workspace);
    this.#refreshScheduler.requestSelectedIfStale(
      "workspace-change"
    );
    return workspace;
  }

  async requestWorkspaceRefresh(
    reason: "startup" | "manual" = "manual"
  ): Promise<WorkspaceRefreshAccepted> {
    await this.#ensureReady();
    return this.#beginWorkspaceRefresh(reason);
  }

  async runWorktreeMutation<Result>(
    target: RepositoryTarget,
    kind: WorktreeMutationKind,
    action: (worktreePath: string) => Promise<Result>
  ): Promise<WorktreeMutationCompleted<Result>> {
    await this.#ensureReady();
    this.#resolveMutationWorktreePath(target);

    const key = repositoryTargetKey(target);
    const operation = this.#createOperation(
      kind,
      [key],
      mutationOperationMessage(kind, "queued"),
      "worktree"
    );

    const blockers: Promise<unknown>[] = [];
    const worktreeTail = this.#worktreeMutationTails.get(key);
    const repositoryTail =
      this.#repositoryMutationTails.get(target.repositoryId);
    const statusRefresh = this.#inFlight.get(
      this.#inFlightKey(target)
    );
    if (worktreeTail) {
      blockers.push(worktreeTail);
    }
    if (repositoryTail) {
      blockers.push(repositoryTail);
    }
    if (statusRefresh) {
      blockers.push(statusRefresh);
    }
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
    await this.#ensureReady();
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
    const blockers = new Set<Promise<unknown>>();
    const repositoryTail =
      this.#repositoryMutationTails.get(
        target.repositoryId
      );
    if (repositoryTail) {
      blockers.add(repositoryTail);
    }
    for (const candidate of repositoryTargets) {
      const key = repositoryTargetKey(candidate);
      const tail = this.#worktreeMutationTails.get(key);
      if (tail) {
        blockers.add(tail);
      }
      const statusRefresh = this.#inFlight.get(
        this.#inFlightKey(candidate)
      );
      if (statusRefresh) {
        blockers.add(statusRefresh);
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
    await this.#ensureReady();
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

    if (reason === "startup") {
      const operationId = `background_refresh_${this.#clock().replace(/[^0-9]/g, "")}`;
      this.#workspaceRefreshOperationId = operationId;
      this.#startWorkspaceRefresh(undefined, reason);
      return { operationId };
    }

    const workspace = this.#workspace as Workspace;
    const operation = this.#createOperation(
      "scan",
      listWorkspaceTargets(workspace).map(repositoryTargetKey),
      "正在重新扫描 Workspace…"
    );
    this.#workspaceRefreshOperationId = operation.id;
    this.#startWorkspaceRefresh(operation, reason);
    return { operationId: operation.id };
  }

  #startWorkspaceRefresh(
    operation: WorkspaceOperation | undefined,
    reason: "startup" | "manual"
  ): void {
    const controller = new AbortController();
    this.#workspaceRefreshController = controller;
    const task = this.#runWorkspaceRefresh(
      operation,
      reason,
      controller.signal,
      this.#workspaceGeneration
    );
    this.#workspaceRefreshTask = task;
    void task
      .finally(() => {
        if (this.#workspaceRefreshTask === task) {
          this.#workspaceRefreshTask = undefined;
        }
        if (
          this.#workspaceRefreshController === controller
        ) {
          this.#workspaceRefreshController = undefined;
        }
      })
      .catch(() => undefined);
  }

  async refreshStaleOnFocus(): Promise<void> {
    await this.#ensureReady();

    if (
      (this.#autoRefresh && !this.#startupRequested) ||
      this.#workspaceRefreshOperationId
    ) {
      return;
    }

    this.#refreshScheduler.requestSelectedIfStale("focus");
  }

  async setForeground(foreground: boolean): Promise<void> {
    await this.#ensureReady();
    this.#refreshScheduler.setForeground(foreground);
    if (foreground && !this.#workspaceRefreshOperationId) {
      this.#refreshScheduler.requestSelectedIfStale("focus");
    }
  }

  async dispose(): Promise<void> {
    await this.#workspaceTransitionTail.catch(
      () => undefined
    );
    this.#workspaceRefreshController?.abort();
    this.#repositoryRefreshController.abort();
    await this.#workspaceRefreshTask?.catch(
      () => undefined
    );
    this.#disposed = true;
    this.#refreshScheduler.dispose();
    await this.#stopMonitoring();
    await Promise.allSettled([
      ...this.#backgroundRefreshTasks
    ]);
    await this.#snapshotPersistenceTail.catch(
      () => undefined
    );
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

  async #ensureReady(): Promise<void> {
    await this.#ensureInitialized();
    await this.#workspaceTransitionTail;
  }

  async #initialize(): Promise<void> {
    const workspace = await this.#configuration.getCurrent();
    await this.#refreshWorkspaceSummaries(workspace);
    await this.#loadRuntimeWorkspace(workspace);
  }

  async #loadRuntimeWorkspace(
    workspace: Workspace
  ): Promise<void> {
    this.#repositoryRefreshController.abort();
    this.#repositoryRefreshController =
      new AbortController();
    this.#workspaceGeneration += 1;
    this.#workspace = workspace;
    this.#refreshScheduler.updateWorkspace(workspace);
    this.#snapshots.clear();
    this.#snapshotContentSignatures.clear();
    this.#snapshotChangedPaths.clear();
    this.#operations = [];
    this.#operationSequence = 0;
    this.#monitor = {
      mode: "inactive",
      watchedTargets: 0,
      message: "Workspace 监听尚未启动。"
    };

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
          maxOperationSequence(persisted);
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

  #queueWorkspaceTransition(
    action: () => Promise<Workspace>,
    deletedWorkspaceId?: string
  ): Promise<WorkspaceRuntimeState> {
    const result = this.#workspaceTransitionTail.then(
      () =>
        this.#performWorkspaceTransition(
          action,
          deletedWorkspaceId
        ),
      () =>
        this.#performWorkspaceTransition(
          action,
          deletedWorkspaceId
        )
    );
    this.#workspaceTransitionTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async #performWorkspaceTransition(
    action: () => Promise<Workspace>,
    deletedWorkspaceId?: string
  ): Promise<WorkspaceRuntimeState> {
    this.#assertWorkspaceTransitionAllowed();
    this.#workspaceGeneration += 1;
    this.#workspaceRefreshController?.abort();
    this.#repositoryRefreshController.abort();
    this.#repositoryRefreshController =
      new AbortController();
    await this.#workspaceRefreshTask?.catch(
      () => undefined
    );
    await this.#stopMonitoring();
    this.#monitor = {
      mode: "inactive",
      watchedTargets: 0,
      message: "正在切换 Workspace…"
    };
    this.#emit();

    await this.#saveSnapshots().catch(() => undefined);
    await this.#snapshotPersistenceTail.catch(
      () => undefined
    );
    this.#queueOperationPersistence();
    await this.#operationPersistenceTask?.catch(
      () => undefined
    );

    let workspace: Workspace;
    try {
      workspace = await action();
    } catch (error) {
      await this.#restartMonitoring();
      throw error;
    }

    const cleanupFailures = deletedWorkspaceId
      ? (
          await Promise.allSettled([
            this.#snapshotStore.delete?.(
              deletedWorkspaceId
            ) ?? Promise.resolve(),
            this.#operationStore?.delete?.(
              deletedWorkspaceId
            ) ?? Promise.resolve()
          ])
        ).filter(
          (
            result
          ): result is PromiseRejectedResult =>
            result.status === "rejected"
        )
      : [];

    this.#operationPersistenceRequested = false;
    this.#operationPersistenceTask = undefined;
    this.#snapshotPersistenceTail = Promise.resolve();
    this.#workspaceRefreshOperationId = undefined;
    this.#startupRequested = false;
    await this.#refreshWorkspaceSummaries(workspace);
    await this.#loadRuntimeWorkspace(workspace);

    await this.#restartMonitoring();
    if (cleanupFailures.length > 0) {
      this.#monitor = {
        ...this.#monitor,
        message:
          "Workspace 已切换，但旧的运行时缓存未能完全清理。"
      };
    }
    if (this.#autoRefresh && workspace.entries.length > 0) {
      this.#refreshScheduler.request(
        listWorkspaceTargets(workspace),
        "workspace-change",
        true
      );
    }
    this.#emit();
    return this.#createState();
  }

  #assertWorkspaceTransitionAllowed(): void {
    if (
      this.#worktreeMutationTails.size > 0 ||
      this.#repositoryMutationTails.size > 0 ||
      this.#operationControllers.size > 0 ||
      this.#operations.some(
        (operation) =>
          operation.state === "queued" ||
          operation.state === "running" ||
          operation.state === "cancelling"
      )
    ) {
      throw new WorkspaceError(
        "INVALID_REQUEST",
        "Wait for the current Workspace operation to finish before switching."
      );
    }
  }

  async #refreshWorkspaceSummaries(
    workspace: Workspace
  ): Promise<void> {
    const listed =
      await this.#configuration.listWorkspaces?.();
    this.#workspaces =
      listed && listed.length > 0
        ? structuredClone(listed)
        : [summarizeWorkspace(workspace)];

    if (
      !this.#workspaces.some(
        (candidate) => candidate.id === workspace.id
      )
    ) {
      this.#workspaces.push(summarizeWorkspace(workspace));
    }
  }

  #trackBackgroundRefresh(
    requests: BackgroundRefreshRequest[]
  ): Promise<BackgroundRefreshBatchResult> {
    const generation = this.#workspaceGeneration;
    const task = this.#runBackgroundRefresh(
      requests,
      generation
    );
    this.#backgroundRefreshTasks.add(task);
    void task
      .finally(() => {
        this.#backgroundRefreshTasks.delete(task);
      })
      .catch(() => undefined);
    return task;
  }

  async #runWorkspaceRefresh(
    operation: WorkspaceOperation | undefined,
    reason: "startup" | "manual",
    signal: AbortSignal,
    generation: number
  ): Promise<void> {
    if (operation) {
      this.#updateOperation(operation.id, {
        state: "running",
        startedAt: this.#clock(),
        progress: 0.05
      });
      this.#emit();
    }

    try {
      await this.#stopMonitoring();
      if (
        signal.aborted ||
        generation !== this.#workspaceGeneration
      ) {
        return;
      }
      this.#monitor = {
        mode: "inactive",
        watchedTargets: 0,
        message: "全量重扫期间已暂停文件监听。"
      };
      this.#emit();
      const workspace =
        await this.#configuration.rescan(signal);
      if (
        signal.aborted ||
        generation !== this.#workspaceGeneration
      ) {
        return;
      }
      await this.#refreshWorkspaceSummaries(workspace);
      this.#acceptWorkspace(workspace);
      await this.#restartMonitoring();

      const targets = sortTargetsByWorkspacePriority(
        workspace,
        listWorkspaceTargets(workspace)
      );
      if (!operation) {
        this.#refreshScheduler.request(
          targets,
          "startup",
          true
        );
        return;
      }

      this.#updateOperation(operation.id, {
        targetIds: targets.map(repositoryTargetKey),
        progress: targets.length > 0 ? 0.2 : 0.95,
        message: `Workspace 拓扑重扫完成，正在刷新 ${targets.length} 个仓库状态…`
      });
      this.#emit();
      const result = await this.#refreshTargets(
        targets.map((target) => ({
          target,
          reason,
          forceContentVersion: true
        })),
        ({ completed, total, succeeded, failed }) => {
          this.#updateOperation(operation.id, {
            progress:
              total > 0
                ? 0.2 + (completed / total) * 0.75
                : 0.95,
            succeeded,
            failed,
            message:
              failed > 0
                ? `正在刷新仓库状态：${completed}/${total}，${failed} 个失败。`
                : `正在刷新仓库状态：${completed}/${total}。`
          });
        },
        generation
      );
      if (
        signal.aborted ||
        generation !== this.#workspaceGeneration
      ) {
        return;
      }
      this.#updateOperation(operation.id, {
        state: result.failed > 0 ? "failed" : "succeeded",
        progress: 1,
        succeeded: result.succeeded,
        failed: result.failed,
        message:
          result.failed > 0
            ? `Workspace 刷新完成：${result.succeeded} 个成功，${result.failed} 个失败。`
            : `Workspace 刷新完成，共 ${result.succeeded} 个仓库。`,
        finishedAt: this.#clock()
      });
      this.#emit();
    } catch (error) {
      if (
        signal.aborted ||
        generation !== this.#workspaceGeneration
      ) {
        return;
      }
      if (operation) {
        this.#updateOperation(operation.id, {
          state: "failed",
          progress: 1,
          failed: 1,
          message: `Workspace 重扫失败：${getErrorMessage(error)}`,
          finishedAt: this.#clock()
        });
        this.#emit();
      } else {
        this.#recordBackgroundFailures("startup", [
          {
            target:
              this.#workspace?.selectedTarget ??
              listWorkspaceTargets(
                this.#workspace as Workspace
              )[0] ?? {
                repositoryId: "workspace",
                worktreeId: "scan"
              },
            code: getErrorCode(error),
            message: safeBackgroundErrorMessage(error)
          }
        ]);
      }
      await this.#restartMonitoring();
    } finally {
      this.#workspaceRefreshOperationId = undefined;
    }
  }

  async #runBackgroundRefresh(
    requests: BackgroundRefreshRequest[],
    generation: number
  ): Promise<BackgroundRefreshBatchResult> {
    if (generation !== this.#workspaceGeneration) {
      return emptyRefreshBatchResult();
    }
    const blockers = new Set<Promise<unknown>>();
    for (const request of requests) {
      const existing = this.#inFlight.get(
        this.#inFlightKey(request.target, generation)
      );
      if (existing) {
        blockers.add(existing);
      }
    }
    if (blockers.size > 0) {
      await Promise.all(
        [...blockers].map((blocker) =>
          blocker.catch(() => undefined)
        )
      );
    }

    if (generation !== this.#workspaceGeneration) {
      return emptyRefreshBatchResult();
    }
    const result = await this.#refreshTargets(
      requests,
      undefined,
      generation
    );
    if (generation !== this.#workspaceGeneration) {
      return emptyRefreshBatchResult();
    }
    if (result.failures.length > 0) {
      const reasonByTarget = new Map(
        requests.map((request) => [
          repositoryTargetKey(request.target),
          request.reason
        ])
      );
      const grouped = new Map<
        BackgroundRefreshReason,
        BackgroundRefreshFailure[]
      >();
      for (const failure of result.failures) {
        const reason =
          reasonByTarget.get(
            repositoryTargetKey(failure.target)
          ) ?? requests[0]?.reason;
        if (!reason) {
          continue;
        }
        const failures = grouped.get(reason) ?? [];
        failures.push(failure);
        grouped.set(reason, failures);
      }
      for (const [reason, failures] of grouped) {
        this.#recordBackgroundFailures(reason, failures);
      }
    }
    return result;
  }

  async #refreshTargets(
    requestedRequests: Array<{
      target: RepositoryTarget;
      reason: RefreshReason;
      forceContentVersion: boolean;
    }>,
    onProgress?: (progress: {
      completed: number;
      total: number;
      succeeded: number;
      failed: number;
    }) => void,
    generation = this.#workspaceGeneration
  ): Promise<BackgroundRefreshBatchResult> {
    if (
      this.#disposed ||
      !this.#workspace ||
      generation !== this.#workspaceGeneration
    ) {
      return emptyRefreshBatchResult();
    }

    const workspace = this.#workspace;
    const availableTargets = new Map(
      listWorkspaceTargets(workspace).map((target) => [
        repositoryTargetKey(target),
        target
      ])
    );
    const requests = uniqueRefreshRequests(requestedRequests)
      .filter((request) =>
        availableTargets.has(
          repositoryTargetKey(request.target)
        )
      )
      .filter(
        (request) =>
          !this.#worktreeMutationTails.has(
            repositoryTargetKey(request.target)
          ) &&
          !this.#repositoryMutationTails.has(
            request.target.repositoryId
          )
      )
      .sort((left, right) =>
        compareTargetPriority(
          workspace,
          left.target,
          right.target
        )
      );

    if (requests.length === 0) {
      return emptyRefreshBatchResult();
    }

    for (const { target } of requests) {
      const key = repositoryTargetKey(target);
      this.#snapshots.set(
        key,
        createPendingSnapshot(
          target,
          workspace,
          this.#snapshots.get(key)
        )
      );
    }
    this.#emit();

    let completed = 0;
    let succeeded = 0;
    let failed = 0;
    let changed = 0;
    const failures: BackgroundRefreshFailure[] = [];

    await Promise.all(
      requests.map(async (request) => {
        const { target } = request;
        const key = repositoryTargetKey(target);
        const previousContentVersion =
          this.#snapshots.get(key)?.contentVersion ?? 0;

        try {
          const snapshot = await this.#refreshTarget(
            target,
            request.forceContentVersion,
            generation,
            workspace
          );
          if (
            generation === this.#workspaceGeneration &&
            this.#targetStillAvailable(target)
          ) {
            this.#snapshots.set(key, snapshot);
          }
          if (
            generation === this.#workspaceGeneration &&
            snapshot.contentVersion !==
            previousContentVersion
          ) {
            changed += 1;
          }
          succeeded += 1;
        } catch (error) {
          if (generation !== this.#workspaceGeneration) {
            return;
          }
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
          failures.push({
            target,
            code: getErrorCode(error),
            message: safeBackgroundErrorMessage(error)
          });
          failed += 1;
        } finally {
          completed += 1;
          onProgress?.({
            completed,
            total: requests.length,
            succeeded,
            failed
          });
          if (
            onProgress &&
            generation === this.#workspaceGeneration
          ) {
            this.#emit();
          }
        }
      })
    );

    if (generation !== this.#workspaceGeneration) {
      return emptyRefreshBatchResult();
    }
    try {
      await this.#saveSnapshots();
    } catch (error) {
      failed += 1;
      this.#monitor = {
        ...this.#monitor,
        message: `状态已刷新，但 Snapshot 缓存保存失败：${getErrorMessage(error)}`
      };
      const target = requests[0]?.target;
      if (target) {
        failures.push({
          target,
          code: "SNAPSHOT_SAVE_FAILED",
          message: "Snapshot 缓存保存失败。"
        });
      }
    }

    this.#emit();
    return {
      requested: requests.length,
      succeeded,
      failed,
      changed,
      failures
    };
  }

  #refreshTarget(
    target: RepositoryTarget,
    forceContentVersion: boolean,
    generation: number,
    workspace: Workspace
  ): Promise<RepositoryStatusSnapshot> {
    const key = this.#inFlightKey(target, generation);
    const existing = this.#inFlight.get(key);
    const signal = this.#repositoryRefreshController.signal;

    if (existing) {
      return existing;
    }

    const promise = this.#limiter
      .run(() => {
        if (generation !== this.#workspaceGeneration) {
          throw new Error(
            "Workspace refresh was superseded."
          );
        }
        return this.#readTargetSnapshot(
          target,
          forceContentVersion,
          generation,
          workspace,
          signal
        );
      })
      .finally(() => {
        this.#inFlight.delete(key);
      });
    this.#inFlight.set(key, promise);
    return promise;
  }

  async #readTargetSnapshot(
    target: RepositoryTarget,
    forceContentVersion: boolean,
    generation = this.#workspaceGeneration,
    workspace = this.#workspace as Workspace,
    signal = this.#repositoryRefreshController.signal
  ): Promise<RepositoryStatusSnapshot> {
    const worktree = workspace.worktrees.find(
      (candidate) =>
        candidate.id === target.worktreeId &&
        candidate.repositoryId === target.repositoryId
    );

    if (!worktree) {
      throw new Error("Workspace target worktree is unavailable.");
    }

    const snapshot =
      await this.#gitClient.readRepositorySnapshot(
        worktree.path,
        {
          signal,
          priority: "background"
        }
      );
    const key = repositoryTargetKey(target);
    const signature = repositorySnapshotContentSignature(snapshot);
    const existingSignature =
      this.#snapshotContentSignatures.get(key);
    const existing = this.#snapshots.get(key);
    const contentVersion =
      existing?.contentVersion ?? 0;
    if (generation !== this.#workspaceGeneration) {
      return mapStatusSnapshot(
        target,
        snapshot,
        contentVersion
      );
    }
    this.#snapshotChangedPaths.set(
      key,
      repositorySnapshotChangedPaths(
        worktree.path,
        snapshot
      )
    );
    const nextContentVersion =
      forceContentVersion || existingSignature !== signature
        ? contentVersion + 1
        : contentVersion;
    this.#snapshotContentSignatures.set(key, signature);
    return mapStatusSnapshot(
      target,
      snapshot,
      nextContentVersion
    );
  }

  #inFlightKey(
    target: RepositoryTarget,
    generation = this.#workspaceGeneration
  ): string {
    return `${generation}:${repositoryTargetKey(target)}`;
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

    await this.#inFlight
      .get(this.#inFlightKey(target))
      ?.catch(() => undefined);

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
      await this.#refreshWorkspaceSummaries(workspace);
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

    this.#refreshScheduler.cancel(targets);

    const warnings: string[] = [];
    await Promise.all(
      targets.map(async (target) => {
        const key = repositoryTargetKey(target);

        try {
          const snapshot = await this.#limiter.run(() =>
            this.#readTargetSnapshot(target, true)
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
      await this.#saveSnapshots();
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
    this.#refreshScheduler.updateWorkspace(workspace);
    const available = new Set(
      listWorkspaceTargets(workspace).map(repositoryTargetKey)
    );

    for (const key of this.#snapshots.keys()) {
      if (!available.has(key)) {
        this.#snapshots.delete(key);
        this.#snapshotContentSignatures.delete(key);
        this.#snapshotChangedPaths.delete(key);
      }
    }

    this.#emit();
  }

  #startMonitoringAndRefresh(
    reason: BackgroundRefreshReason
  ): void {
    void this.#restartMonitoring().then(() => {
      if (!this.#workspace || this.#disposed) {
        return;
      }
      const targets = listWorkspaceTargets(
        this.#workspace
      ).filter((target) => {
        const snapshot = this.#snapshots.get(
          repositoryTargetKey(target)
        );
        return !snapshot || snapshot.stale;
      });
      this.#refreshScheduler.request(targets, reason, true);
    });
  }

  async #restartMonitoring(): Promise<void> {
    const generation = ++this.#monitorGeneration;
    const previousMode = this.#monitor.mode;
    await this.#closeMonitoringResources();

    if (
      generation !== this.#monitorGeneration ||
      this.#disposed ||
      !this.#workspace
    ) {
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
      this.#activatePolling(
        generation,
        `监听路径数量 ${registrations.length} 超过上限 ${this.#watcherRegistrationLimit}。`
      );
      return;
    }

    try {
      const handle = await this.#watcher.watch(
        registrations,
        (event) => {
          if (generation !== this.#monitorGeneration) {
            return;
          }
          const targets = this.#targetsForWatchEvent(event);
          if (targets.length === 0) {
            return;
          }
          const forceContentVersion = targets.some((target) =>
            this.#watchEventMayChangeContent(
              event.path,
              target
            )
          );
          this.#monitor = {
            ...this.#monitor,
            lastEventAt: this.#clock()
          };
          this.#refreshScheduler.request(
            targets,
            "watcher",
            forceContentVersion
          );
        },
        (error) => {
          if (generation === this.#monitorGeneration) {
            void this.#switchToPolling(error.message);
          }
        }
      );
      if (
        generation !== this.#monitorGeneration ||
        this.#disposed
      ) {
        await handle.close();
        return;
      }
      this.#watchHandle = handle;
      this.#monitor = {
        mode: "watching",
        watchedTargets: listWorkspaceTargets(
          this.#workspace
        ).length,
        message: `正在监听 ${registrations.length} 个工作目录与 Git 元数据路径。`
      };
      this.#refreshScheduler.activateWatching();
      if (previousMode === "polling") {
        this.#emitMonitorDiagnostic(
          "workspace.monitor-recovered",
          "info"
        );
      }
      this.#emit();
    } catch (error) {
      if (
        generation === this.#monitorGeneration &&
        !this.#disposed
      ) {
        this.#activatePolling(
          generation,
          getErrorMessage(error)
        );
      }
    }
  }

  async #switchToPolling(reason: string): Promise<void> {
    const generation = ++this.#monitorGeneration;
    await this.#closeMonitoringResources();
    this.#activatePolling(generation, reason);
  }

  #activatePolling(
    generation: number,
    reason: string
  ): void {
    if (
      generation !== this.#monitorGeneration ||
      this.#disposed
    ) {
      return;
    }

    this.#monitor = {
      mode: "polling",
      watchedTargets: this.#workspace
        ? listWorkspaceTargets(this.#workspace).length
        : 0,
      message: `文件监听不可用，已降级为低频轮询：${reason}`
    };
    this.#refreshScheduler.activatePolling();
    this.#emitMonitorDiagnostic(
      "workspace.monitor-fallback",
      "warning"
    );
    this.#emit();
  }

  #targetsForWatchEvent(
    event: WorkspaceWatchEvent
  ): RepositoryTarget[] {
    const workspace = this.#workspace;
    if (!workspace) {
      return [];
    }

    const worktrees = listWorkspaceTargets(workspace)
      .map((target) => ({
        target,
        worktree: workspace.worktrees.find(
          (candidate) =>
            candidate.id === target.worktreeId
        ),
        repository: workspace.repositories.find(
          (candidate) =>
            candidate.id === target.repositoryId
        )
      }))
      .filter(
        (
          candidate
        ): candidate is {
          target: RepositoryTarget;
          worktree: Workspace["worktrees"][number];
          repository:
            | Workspace["repositories"][number]
            | undefined;
        } => Boolean(candidate.worktree)
      );

    if (
      isTransientGitLockPath(
        event.path,
        [
          ...workspace.repositories.map(
            (repository) => repository.commonDir
          ),
          ...workspace.worktrees.map(
            (worktree) => worktree.gitDir
          )
        ]
      )
    ) {
      return [];
    }

    const linkedGitTarget = worktrees
      .filter(
        ({ worktree, repository }) =>
          Boolean(worktree.gitDir) &&
          !pathsEqual(
            worktree.gitDir as string,
            repository?.commonDir
          ) &&
          pathContains(worktree.gitDir as string, event.path)
      )
      .sort(
        (left, right) =>
          (right.worktree.gitDir?.length ?? 0) -
          (left.worktree.gitDir?.length ?? 0)
      )[0];
    if (linkedGitTarget) {
      return [linkedGitTarget.target];
    }

    const commonDirRepository = workspace.repositories
      .filter(
        (repository) =>
          Boolean(repository.commonDir) &&
          pathContains(
            repository.commonDir as string,
            event.path
          )
      )
      .sort(
        (left, right) =>
          (right.commonDir?.length ?? 0) -
          (left.commonDir?.length ?? 0)
      )[0];
    if (commonDirRepository) {
      return this.#repositoryTargets(
        commonDirRepository.id
      );
    }

    const worktreeTarget = worktrees
      .filter(({ worktree }) =>
        pathContains(worktree.path, event.path)
      )
      .sort(
        (left, right) =>
          right.worktree.path.length -
          left.worktree.path.length
      )[0];
    if (worktreeTarget) {
      return [worktreeTarget.target];
    }

    const fallback = listWorkspaceTargets(workspace).find(
      (target) =>
        repositoryTargetsEqual(target, event.target)
    );
    return fallback ? [fallback] : [];
  }

  #watchEventMayChangeContent(
    eventPath: string,
    target: RepositoryTarget
  ): boolean {
    const workspace = this.#workspace;
    if (!workspace) {
      return false;
    }

    const repository = workspace.repositories.find(
      (candidate) =>
        candidate.id === target.repositoryId
    );
    const worktree = workspace.worktrees.find(
      (candidate) =>
        candidate.id === target.worktreeId &&
        candidate.repositoryId === target.repositoryId
    );
    if (
      [repository?.commonDir, worktree?.gitDir].some(
        (root) =>
          Boolean(root) &&
          pathContains(root as string, eventPath)
      )
    ) {
      return true;
    }

    const changedPaths = this.#snapshotChangedPaths.get(
      repositoryTargetKey(target)
    );
    return Boolean(
      changedPaths &&
        [...changedPaths].some((changedPath) =>
          watchPathsOverlap(changedPath, eventPath)
        )
    );
  }

  async #stopMonitoring(): Promise<void> {
    this.#monitorGeneration += 1;
    await this.#closeMonitoringResources();
  }

  async #closeMonitoringResources(): Promise<void> {
    this.#refreshScheduler.pause();
    const handle = this.#watchHandle;
    this.#watchHandle = undefined;
    await handle?.close();
  }

  #isTargetStale(target: RepositoryTarget): boolean {
    const snapshot = this.#snapshots.get(
      repositoryTargetKey(target)
    );
    const refreshedAt = snapshot
      ? Date.parse(snapshot.refreshedAt)
      : Number.NaN;
    return (
      !snapshot ||
      snapshot.stale ||
      !Number.isFinite(refreshedAt) ||
      Date.parse(this.#clock()) - refreshedAt >=
        this.#staleAfterMs
    );
  }

  #recordBackgroundFailures(
    reason: BackgroundRefreshReason,
    failures: BackgroundRefreshFailure[]
  ): void {
    if (failures.length === 0) {
      return;
    }
    const failuresByCode = new Map<
      string,
      BackgroundRefreshFailure[]
    >();
    for (const failure of failures) {
      const code = stableBackgroundErrorCode(failure.code);
      const matching = failuresByCode.get(code) ?? [];
      matching.push(failure);
      failuresByCode.set(code, matching);
    }

    const now = this.#clock();
    const nowMs = Date.parse(now);
    for (const [code, matching] of failuresByCode) {
      const prefix = `${backgroundRefreshReasonLabel(reason)}失败（${code}）`;
      const targetIds = [
        ...new Set(
          matching.map((failure) =>
            repositoryTargetKey(failure.target)
          )
        )
      ];
      const existing = this.#operations.find((operation) => {
        if (
          operation.kind !== "status" ||
          operation.state !== "failed" ||
          !operation.message.startsWith(prefix) ||
          !operation.finishedAt
        ) {
          return false;
        }
        const finishedAt = Date.parse(operation.finishedAt);
        return (
          Number.isFinite(nowMs) &&
          Number.isFinite(finishedAt) &&
          nowMs - finishedAt <=
            BACKGROUND_FAILURE_MERGE_WINDOW_MS
        );
      });
      const latestMessage =
        matching.at(-1)?.message ?? "后台状态读取失败。";

      if (existing) {
        const mergedTargetIds = [
          ...new Set([...existing.targetIds, ...targetIds])
        ];
        this.#updateOperation(existing.id, {
          targetIds: mergedTargetIds,
          progress: 1,
          succeeded: 0,
          failed: mergedTargetIds.length,
          message: `${prefix}：${mergedTargetIds.length} 个目标；${latestMessage}`,
          finishedAt: now
        });
        continue;
      }

      const operation = this.#createOperation(
        "status",
        targetIds,
        `${prefix}：${targetIds.length} 个目标；${latestMessage}`
      );
      this.#updateOperation(operation.id, {
        state: "failed",
        progress: 1,
        failed: targetIds.length,
        finishedAt: now
      });
    }
    this.#emit();
  }

  #emitMonitorDiagnostic(
    name:
      | "workspace.monitor-fallback"
      | "workspace.monitor-recovered",
    level: "info" | "warning"
  ): void {
    const diagnostic: WorkspaceRefreshDiagnostic = {
      name,
      level,
      context: {
        monitorMode: this.#monitor.mode,
        reason:
          name === "workspace.monitor-fallback"
            ? "watcher-unavailable"
            : "watcher-restored",
        requested: 0,
        merged: 0,
        executed: 0,
        changed: 0,
        failed: 0,
        activeTargetCount: this.#workspace
          ? listWorkspaceTargets(this.#workspace).length
          : 0,
        pendingTargetCount: 0,
        elapsedMs: 0
      }
    };
    try {
      void Promise.resolve(
        this.#onDiagnostic?.(diagnostic)
      ).catch(() => undefined);
    } catch {
      // Diagnostics must never change refresh behavior.
    }
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
    this.#queueOperationPersistence();
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
    this.#queueOperationPersistence();
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

  #saveSnapshots(): Promise<void> {
    if (!this.#workspace) {
      return Promise.resolve();
    }

    const workspaceId = this.#workspace.id;
    const snapshots = structuredClone(this.#orderedSnapshots());
    const task = this.#snapshotPersistenceTail
      .catch(() => undefined)
      .then(() =>
        this.#snapshotStore.save(workspaceId, snapshots)
      );
    this.#snapshotPersistenceTail = task.catch(() => undefined);
    return task;
  }

  #createState(): WorkspaceRuntimeState {
    return structuredClone({
      workspace: this.#workspace as Workspace,
      workspaces: this.#workspaces,
      snapshots: this.#orderedSnapshots(),
      operations: this.#operations,
      monitor: this.#monitor
    });
  }

  #emit(): void {
    if (this.#disposed || !this.#workspace) {
      return;
    }

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
  const recovered: WorkspaceOperation[] = [];
  for (const operation of operations) {
    if (
      operation.kind === "status" &&
      (operation.state === "succeeded" ||
        operation.state === "queued" ||
        operation.state === "running" ||
        operation.state === "cancelling")
    ) {
      changed = true;
      continue;
    }
    if (
      operation.state !== "queued" &&
      operation.state !== "running" &&
      operation.state !== "cancelling"
    ) {
      recovered.push(operation);
      continue;
    }
    changed = true;
    recovered.push({
      ...operation,
      state: "interrupted" as const,
      progress: 1,
      failed: 0,
      message: `${workspaceOperationLabel(operation.kind)} 在上次应用退出时被中断；GitNest 未假定操作成功、失败或已回滚，请以刷新后的仓库状态为准。`,
      finishedAt: recoveredAt
    });
  }
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

function uniqueRefreshRequests<
  Request extends {
    target: RepositoryTarget;
    reason: RefreshReason;
    forceContentVersion: boolean;
  }
>(requests: Request[]): Request[] {
  const unique = new Map<string, Request>();
  for (const request of requests) {
    const key = repositoryTargetKey(request.target);
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, request);
      continue;
    }
    unique.set(key, {
      ...request,
      forceContentVersion:
        existing.forceContentVersion ||
        request.forceContentVersion
    });
  }
  return [...unique.values()];
}

function sortTargetsByWorkspacePriority(
  workspace: Workspace,
  targets: RepositoryTarget[]
): RepositoryTarget[] {
  return [...targets].sort((left, right) =>
    compareTargetPriority(workspace, left, right)
  );
}

function compareTargetPriority(
  workspace: Workspace,
  left: RepositoryTarget,
  right: RepositoryTarget
): number {
  const priority =
    targetPriorityWeight(workspace, left) -
    targetPriorityWeight(workspace, right);
  return (
    priority ||
    repositoryTargetKey(left).localeCompare(
      repositoryTargetKey(right)
    )
  );
}

function targetPriorityWeight(
  workspace: Workspace,
  target: RepositoryTarget
): number {
  if (repositoryTargetsEqual(target, workspace.selectedTarget)) {
    return 0;
  }
  return findTargetEntry(workspace, target)?.id ===
    workspace.selectedEntryId
    ? 1
    : 2;
}

function emptyRefreshBatchResult(): BackgroundRefreshBatchResult {
  return {
    requested: 0,
    succeeded: 0,
    failed: 0,
    changed: 0,
    failures: []
  };
}

function mapStatusSnapshot(
  target: RepositoryTarget,
  snapshot: RepositorySnapshot,
  contentVersion: number
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
    contentVersion,
    refreshPending: false,
    stale: false,
    refreshedAt: snapshot.refreshedAt
  };
}

function repositorySnapshotContentSignature(
  snapshot: RepositorySnapshot
): string {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify([
      snapshot.branch ?? "",
      snapshot.head,
      snapshot.upstream ?? "",
      snapshot.ahead,
      snapshot.behind,
      snapshot.staged,
      snapshot.unstaged,
      snapshot.untracked,
      snapshot.conflicted
    ])
  );
  const changes = [...snapshot.changes].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      (left.originalPath ?? "").localeCompare(
        right.originalPath ?? ""
      ) ||
      left.indexStatus.localeCompare(right.indexStatus) ||
      left.worktreeStatus.localeCompare(right.worktreeStatus)
  );
  for (const change of changes) {
    hash.update(
      JSON.stringify([
        change.path,
        change.originalPath ?? "",
        change.indexStatus,
        change.worktreeStatus,
        change.kind,
        change.stagedStats?.additions ?? null,
        change.stagedStats?.deletions ?? null,
        change.unstagedStats?.additions ?? null,
        change.unstagedStats?.deletions ?? null,
        change.untrackedStats?.additions ?? null,
        change.untrackedStats?.deletions ?? null
      ])
    );
  }
  return hash.digest("base64url");
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
  const candidates = new Map<
    string,
    WorkspaceWatchRegistration
  >();
  for (const target of listWorkspaceTargets(workspace)) {
    const repository = workspace.repositories.find(
      (candidate) =>
        candidate.id === target.repositoryId
    );
    const worktree = workspace.worktrees.find(
      (candidate) =>
        candidate.id === target.worktreeId &&
        candidate.repositoryId === target.repositoryId
    );
    if (!worktree) {
      continue;
    }

    addRegistration(worktree.path, target);
    if (repository?.commonDir) {
      addRegistration(repository.commonDir, target);
    }
    if (worktree.gitDir) {
      addRegistration(worktree.gitDir, target);
    }
  }

  const registrations: WorkspaceWatchRegistration[] = [];
  for (const candidate of [...candidates.values()].sort(
    (left, right) =>
      normalizeWatchPath(left.path).length -
        normalizeWatchPath(right.path).length ||
      normalizeWatchPath(left.path).localeCompare(
        normalizeWatchPath(right.path)
      )
  )) {
    if (
      registrations.some(
        (registration) =>
          registration.recursive &&
          pathContains(registration.path, candidate.path)
      )
    ) {
      continue;
    }
    registrations.push(candidate);
  }
  return registrations;

  function addRegistration(
    path: string,
    target: RepositoryTarget
  ): void {
    const key = normalizeWatchPath(path);
    if (candidates.has(key)) {
      return;
    }
    candidates.set(key, {
      path,
      target,
      recursive: true
    });
  }
}

function isTransientGitLockPath(
  path: string,
  metadataRoots: Array<string | undefined>
): boolean {
  const normalizedPath = normalizeWatchPath(path);
  if (!normalizedPath.endsWith(".lock")) {
    return false;
  }

  return metadataRoots.some(
    (root): root is string =>
      Boolean(root) && pathContains(root as string, path)
  );
}

function pathsEqual(
  left: string | undefined,
  right: string | undefined
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    normalizeWatchPath(left) === normalizeWatchPath(right)
  );
}

function pathContains(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeWatchPath(root);
  const normalizedCandidate = normalizeWatchPath(candidate);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}\\`)
  );
}

function watchPathsOverlap(
  left: string,
  right: string
): boolean {
  return pathContains(left, right) || pathContains(right, left);
}

function normalizeWatchPath(path: string): string {
  return path
    .replace(/[\\/]+/gu, "\\")
    .replace(/\\+$/u, "")
    .toLocaleLowerCase("en-US");
}

function repositorySnapshotChangedPaths(
  worktreePath: string,
  snapshot: RepositorySnapshot
): Set<string> {
  const result = new Set<string>();
  for (const change of snapshot.changes) {
    result.add(joinWatchPath(worktreePath, change.path));
    if (change.originalPath) {
      result.add(
        joinWatchPath(worktreePath, change.originalPath)
      );
    }
  }
  return result;
}

function joinWatchPath(root: string, path: string): string {
  return normalizeWatchPath(
    `${root.replace(/[\\/]+$/u, "")}\\${path.replace(
      /^[\\/]+/u,
      ""
    )}`
  );
}

function backgroundRefreshReasonLabel(
  reason: BackgroundRefreshReason
): string {
  const labels: Record<BackgroundRefreshReason, string> = {
    startup: "启动后台刷新",
    "workspace-change": "Workspace 变更刷新",
    watcher: "文件变化刷新",
    polling: "低频轮询刷新",
    focus: "窗口聚焦刷新",
    heartbeat: "选中工作目录兜底刷新"
  };
  return labels[reason];
}

function stableBackgroundErrorCode(code: string): string {
  const stable = code
    .toLocaleUpperCase("en-US")
    .replace(/[^A-Z0-9_-]+/gu, "_")
    .slice(0, 64);
  return stable || "COMMAND_FAILED";
}

function safeBackgroundErrorMessage(error: unknown): string {
  return `后台状态读取失败（${stableBackgroundErrorCode(
    getErrorCode(error)
  )}）。`;
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
    discard: {
      queued: "放弃更改操作正在排队。",
      running: "正在放弃所选文件的更改…",
      refreshing: "放弃更改完成，正在刷新仓库状态…",
      succeeded: "所选文件的更改已放弃。",
      failed: "放弃更改失败："
    },
    commit: {
      queued: "提交操作正在排队。",
      running: "正在创建提交并执行 Git Hooks…",
      refreshing: "提交完成，正在刷新仓库状态…",
      succeeded: "提交已创建。",
      failed: "提交失败："
    },
    "stash-apply": {
      queued: "恢复储藏操作正在排队。",
      running: "正在恢复所选储藏…",
      refreshing: "储藏已恢复，正在刷新仓库状态…",
      succeeded: "所选储藏已恢复。",
      failed: "恢复储藏失败："
    },
    "stash-drop": {
      queued: "删除储藏操作正在排队。",
      running: "正在删除所选储藏…",
      refreshing: "储藏已删除，正在刷新仓库状态…",
      succeeded: "所选储藏已删除。",
      failed: "删除储藏失败："
    },
    "stash-pop": {
      queued: "恢复并删除储藏操作正在排队。",
      running: "正在恢复并删除所选储藏…",
      refreshing: "储藏操作完成，正在刷新仓库状态…",
      succeeded: "所选储藏已恢复并删除。",
      failed: "恢复并删除储藏失败："
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
    discard: "放弃更改",
    commit: "提交",
    "stash-apply": "恢复储藏",
    "stash-drop": "删除储藏",
    "stash-pop": "恢复并删除储藏",
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

function multiWorkspaceUnavailable(): WorkspaceError {
  return new WorkspaceError(
    "INVALID_REQUEST",
    "This Workspace configuration does not support multiple Workspaces."
  );
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
