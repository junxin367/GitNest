import {
  listWorkspaceTargets,
  repositoryTargetKey,
  repositoryTargetsEqual,
  type RepositoryTarget,
  type Workspace
} from "@gitnest/workspace-core";

export type BackgroundRefreshReason =
  | "startup"
  | "workspace-change"
  | "watcher"
  | "focus"
  | "heartbeat"
  | "polling";

export type WorkspaceRefreshPriority =
  | "selected"
  | "background";

export interface BackgroundRefreshRequest {
  target: RepositoryTarget;
  reason: BackgroundRefreshReason;
  forceContentVersion: boolean;
  requestedAt: string;
}

export interface BackgroundRefreshFailure {
  target: RepositoryTarget;
  code: string;
  message: string;
}

export interface BackgroundRefreshBatchResult {
  requested: number;
  succeeded: number;
  failed: number;
  changed: number;
  failures: BackgroundRefreshFailure[];
}

export interface WorkspaceRefreshDiagnostic {
  level: "info" | "warning";
  name:
    | "workspace.refresh-summary"
    | "workspace.refresh-failed"
    | "workspace.monitor-fallback"
    | "workspace.monitor-recovered";
  context: {
    monitorMode: "inactive" | "watching" | "polling";
    reason: string;
    requested: number;
    merged: number;
    executed: number;
    changed: number;
    failed: number;
    activeTargetCount: number;
    pendingTargetCount: number;
    elapsedMs: number;
  };
}

export interface WorkspaceRefreshSchedulerOptions {
  selectedDebounceMs: number;
  backgroundDebounceMs: number;
  selectedMinIntervalMs: number;
  backgroundMinIntervalMs: number;
  heartbeatIntervalMs: number;
  selectedPollingIntervalMs: number;
  backgroundPollingIntervalMs: number;
  clock: () => string;
  execute(
    requests: BackgroundRefreshRequest[]
  ): Promise<BackgroundRefreshBatchResult>;
  isStale(target: RepositoryTarget): boolean;
  onDiagnostic?(
    diagnostic: WorkspaceRefreshDiagnostic
  ): void | Promise<void>;
}

interface ScheduledRefresh {
  target: RepositoryTarget;
  reasons: Set<BackgroundRefreshReason>;
  lastReason: BackgroundRefreshReason;
  forceContentVersion: boolean;
  dueAt: number;
}

interface DiagnosticCounters {
  requested: number;
  merged: number;
  executed: number;
  changed: number;
  failed: number;
  reasons: Set<BackgroundRefreshReason>;
}

const DIAGNOSTIC_SUMMARY_INTERVAL_MS = 60_000;

export class WorkspaceRefreshScheduler {
  readonly #options: WorkspaceRefreshSchedulerOptions;
  readonly #pending = new Map<string, ScheduledRefresh>();
  readonly #inFlight = new Set<string>();
  readonly #lastStartedAt = new Map<string, number>();
  readonly #pollDueAt = new Map<string, number>();
  #workspace: Workspace | undefined;
  #mode: "inactive" | "watching" | "polling" =
    "inactive";
  #foreground = true;
  #wakeTimer: ReturnType<typeof setTimeout> | undefined;
  #heartbeatTimer:
    | ReturnType<typeof setInterval>
    | undefined;
  #disposed = false;
  #diagnosticStartedAt = Date.now();
  #lastDiagnosticAt = Date.now();
  #diagnostics: DiagnosticCounters = createDiagnosticCounters();

  constructor(options: WorkspaceRefreshSchedulerOptions) {
    this.#options = options;
  }

  updateWorkspace(workspace: Workspace): void {
    this.#workspace = workspace;
    const available = new Set(
      listWorkspaceTargets(workspace).map(repositoryTargetKey)
    );

    for (const key of this.#pending.keys()) {
      if (!available.has(key)) {
        this.#pending.delete(key);
      }
    }
    for (const key of this.#lastStartedAt.keys()) {
      if (!available.has(key)) {
        this.#lastStartedAt.delete(key);
      }
    }
    for (const key of this.#pollDueAt.keys()) {
      if (!available.has(key)) {
        this.#pollDueAt.delete(key);
      }
    }

    if (this.#mode === "polling") {
      this.#initializePollingSchedule();
    }
    this.#scheduleWake();
  }

  activateWatching(): void {
    if (this.#disposed) {
      return;
    }
    this.#mode = "watching";
    this.#pollDueAt.clear();
    for (const [key, pending] of this.#pending) {
      if (
        pending.reasons.size === 1 &&
        pending.reasons.has("polling")
      ) {
        this.#pending.delete(key);
      }
    }
    this.#startHeartbeat();
    this.#scheduleWake();
  }

  activatePolling(): void {
    if (this.#disposed) {
      return;
    }
    this.#mode = "polling";
    this.#stopHeartbeat();
    this.#initializePollingSchedule();
    this.#scheduleWake();
  }

  setForeground(foreground: boolean): void {
    if (this.#disposed || this.#foreground === foreground) {
      return;
    }
    this.#foreground = foreground;
    if (foreground) {
      this.#startHeartbeat();
    } else {
      this.#stopHeartbeat();
    }
  }

  requestSelectedIfStale(
    reason: "focus" | "heartbeat" | "workspace-change"
  ): void {
    const target = this.#workspace?.selectedTarget;
    if (!target || !this.#options.isStale(target)) {
      return;
    }
    this.request([target], reason, false);
  }

  request(
    targets: RepositoryTarget[],
    reason: BackgroundRefreshReason,
    forceContentVersion: boolean
  ): void {
    if (this.#disposed || !this.#workspace) {
      return;
    }

    const available = new Set(
      listWorkspaceTargets(this.#workspace).map(
        repositoryTargetKey
      )
    );
    const now = Date.now();
    for (const target of uniqueTargets(targets)) {
      const key = repositoryTargetKey(target);
      if (!available.has(key)) {
        continue;
      }
      this.#diagnostics.requested += 1;
      this.#diagnostics.reasons.add(reason);
      this.#mergeRequest(
        target,
        reason,
        forceContentVersion,
        this.#requestDueAt(target, reason, now)
      );
    }
    this.#scheduleWake();
  }

  cancel(targets: RepositoryTarget[]): void {
    for (const target of targets) {
      this.#pending.delete(repositoryTargetKey(target));
    }
    this.#scheduleWake();
  }

  pause(): void {
    this.#mode = "inactive";
    this.#clearWakeTimer();
    this.#stopHeartbeat();
    this.#pending.clear();
    this.#pollDueAt.clear();
  }

  dispose(): void {
    this.#disposed = true;
    this.pause();
    this.#workspace = undefined;
  }

  #mergeRequest(
    target: RepositoryTarget,
    reason: BackgroundRefreshReason,
    forceContentVersion: boolean,
    dueAt: number
  ): void {
    const key = repositoryTargetKey(target);
    const existing = this.#pending.get(key);
    if (existing) {
      this.#diagnostics.merged += 1;
      const onlyWatcherSignals =
        existing.reasons.size === 1 &&
        existing.reasons.has("watcher") &&
        reason === "watcher";
      existing.reasons.add(reason);
      existing.lastReason = reason;
      existing.forceContentVersion ||= forceContentVersion;
      existing.dueAt = onlyWatcherSignals
        ? Math.max(existing.dueAt, dueAt)
        : Math.min(existing.dueAt, dueAt);
      return;
    }

    if (this.#inFlight.has(key)) {
      this.#diagnostics.merged += 1;
    }
    this.#pending.set(key, {
      target,
      reasons: new Set([reason]),
      lastReason: reason,
      forceContentVersion,
      dueAt
    });
  }

  #requestDueAt(
    target: RepositoryTarget,
    reason: BackgroundRefreshReason,
    now: number
  ): number {
    const priority = this.#priorityOf(target);
    const debounceMs =
      reason === "watcher"
        ? priority === "selected"
          ? this.#options.selectedDebounceMs
          : this.#options.backgroundDebounceMs
        : 0;
    const minimumIntervalMs =
      reason === "watcher"
        ? priority === "selected"
          ? this.#options.selectedMinIntervalMs
          : this.#options.backgroundMinIntervalMs
        : 0;
    return Math.max(
      now + Math.max(0, debounceMs),
      (this.#lastStartedAt.get(repositoryTargetKey(target)) ??
        Number.NEGATIVE_INFINITY) +
        Math.max(0, minimumIntervalMs)
    );
  }

  #scheduleWake(): void {
    this.#clearWakeTimer();
    if (
      this.#disposed ||
      !this.#workspace ||
      this.#mode === "inactive"
    ) {
      return;
    }

    let nextDueAt = Number.POSITIVE_INFINITY;
    for (const [key, pending] of this.#pending) {
      if (!this.#inFlight.has(key)) {
        nextDueAt = Math.min(nextDueAt, pending.dueAt);
      }
    }
    if (this.#mode === "polling") {
      for (const [key, dueAt] of this.#pollDueAt) {
        if (
          !this.#inFlight.has(key) &&
          !this.#pending.has(key)
        ) {
          nextDueAt = Math.min(nextDueAt, dueAt);
        }
      }
    }

    if (!Number.isFinite(nextDueAt)) {
      return;
    }
    this.#wakeTimer = setTimeout(
      () => this.#wake(),
      Math.max(0, nextDueAt - Date.now())
    );
  }

  #wake(): void {
    this.#wakeTimer = undefined;
    if (
      this.#disposed ||
      !this.#workspace ||
      this.#mode === "inactive"
    ) {
      return;
    }

    const now = Date.now();
    if (this.#mode === "polling") {
      this.#enqueueDuePolling(now);
    }

    const due = [...this.#pending.entries()]
      .filter(
        ([key, pending]) =>
          !this.#inFlight.has(key) &&
          pending.dueAt <= now
      )
      .sort(([, left], [, right]) => {
        const priority =
          priorityWeight(this.#priorityOf(left.target)) -
          priorityWeight(this.#priorityOf(right.target));
        return (
          priority ||
          repositoryTargetKey(left.target).localeCompare(
            repositoryTargetKey(right.target)
          )
        );
      });

    if (due.length === 0) {
      this.#scheduleWake();
      return;
    }

    const requests = due.map(([key, pending]) => {
      this.#pending.delete(key);
      this.#inFlight.add(key);
      this.#lastStartedAt.set(key, now);
      if (this.#mode === "polling") {
        this.#pollDueAt.set(
          key,
          now + this.#pollingIntervalFor(pending.target)
        );
      }
      return {
        target: pending.target,
        reason: pending.lastReason,
        forceContentVersion: pending.forceContentVersion,
        requestedAt: this.#options.clock()
      } satisfies BackgroundRefreshRequest;
    });
    this.#diagnostics.executed += requests.length;
    const startedAt = Date.now();

    void Promise.resolve()
      .then(() => this.#options.execute(requests))
      .then((result) => {
        this.#diagnostics.changed += result.changed;
        this.#diagnostics.failed += result.failed;
        this.#emitDiagnostics(
          result.failed > 0,
          requests.map((request) => request.reason),
          Date.now() - startedAt
        );
      })
      .catch(() => {
        this.#diagnostics.failed += requests.length;
        this.#emitDiagnostics(
          true,
          requests.map((request) => request.reason),
          Date.now() - startedAt
        );
      })
      .finally(() => {
        for (const request of requests) {
          this.#inFlight.delete(
            repositoryTargetKey(request.target)
          );
        }
        this.#scheduleWake();
      });
    this.#scheduleWake();
  }

  #enqueueDuePolling(now: number): void {
    if (!this.#workspace) {
      return;
    }
    const targets = new Map(
      listWorkspaceTargets(this.#workspace).map((target) => [
        repositoryTargetKey(target),
        target
      ])
    );
    for (const [key, dueAt] of this.#pollDueAt) {
      if (
        dueAt > now ||
        this.#inFlight.has(key) ||
        this.#pending.has(key)
      ) {
        continue;
      }
      const target = targets.get(key);
      if (!target) {
        this.#pollDueAt.delete(key);
        continue;
      }
      this.#diagnostics.requested += 1;
      this.#diagnostics.reasons.add("polling");
      this.#pending.set(key, {
        target,
        reasons: new Set(["polling"]),
        lastReason: "polling",
        forceContentVersion: true,
        dueAt: now
      });
      this.#pollDueAt.set(
        key,
        now + this.#pollingIntervalFor(target)
      );
    }
  }

  #initializePollingSchedule(): void {
    if (!this.#workspace) {
      return;
    }
    const now = Date.now();
    this.#pollDueAt.clear();
    const groups: Record<
      WorkspaceRefreshPriority,
      RepositoryTarget[]
    > = {
      selected: [],
      background: []
    };
    for (const target of listWorkspaceTargets(this.#workspace)) {
      groups[this.#priorityOf(target)].push(target);
    }

    for (const priority of [
      "selected",
      "background"
    ] as const) {
      const targets = groups[priority].sort((left, right) =>
        repositoryTargetKey(left).localeCompare(
          repositoryTargetKey(right)
        )
      );
      const interval =
        priority === "selected"
          ? this.#options.selectedPollingIntervalMs
          : this.#options.backgroundPollingIntervalMs;
      if (interval <= 0) {
        continue;
      }
      targets.forEach((target, index) => {
        const offset =
          priority === "selected"
            ? 0
            : Math.max(
                1,
                Math.floor(
                  (interval * (index + 1)) /
                    Math.max(1, targets.length)
                )
              );
        this.#pollDueAt.set(
          repositoryTargetKey(target),
          now + offset
        );
      });
    }
  }

  #pollingIntervalFor(target: RepositoryTarget): number {
    const priority = this.#priorityOf(target);
    return Math.max(
      1,
      priority === "selected"
        ? this.#options.selectedPollingIntervalMs
        : this.#options.backgroundPollingIntervalMs
    );
  }

  #priorityOf(
    target: RepositoryTarget
  ): WorkspaceRefreshPriority {
    const workspace = this.#workspace;
    if (
      workspace &&
      repositoryTargetsEqual(target, workspace.selectedTarget)
    ) {
      return "selected";
    }
    return "background";
  }

  #startHeartbeat(): void {
    if (
      this.#disposed ||
      this.#mode !== "watching" ||
      !this.#foreground ||
      this.#heartbeatTimer ||
      this.#options.heartbeatIntervalMs <= 0
    ) {
      return;
    }
    this.#heartbeatTimer = setInterval(() => {
      this.requestSelectedIfStale("heartbeat");
    }, this.#options.heartbeatIntervalMs);
  }

  #stopHeartbeat(): void {
    if (!this.#heartbeatTimer) {
      return;
    }
    clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = undefined;
  }

  #clearWakeTimer(): void {
    if (!this.#wakeTimer) {
      return;
    }
    clearTimeout(this.#wakeTimer);
    this.#wakeTimer = undefined;
  }

  #emitDiagnostics(
    force: boolean,
    reasons: BackgroundRefreshReason[],
    batchElapsedMs: number
  ): void {
    const now = Date.now();
    if (
      !force &&
      now - this.#lastDiagnosticAt <
        DIAGNOSTIC_SUMMARY_INTERVAL_MS
    ) {
      return;
    }
    const reasonSet = new Set([
      ...this.#diagnostics.reasons,
      ...reasons
    ]);
    const context: WorkspaceRefreshDiagnostic["context"] = {
      monitorMode: this.#mode,
      reason:
        reasonSet.size === 1
          ? ([...reasonSet][0] ?? "unknown")
          : "mixed",
      requested: this.#diagnostics.requested,
      merged: this.#diagnostics.merged,
      executed: this.#diagnostics.executed,
      changed: this.#diagnostics.changed,
      failed: this.#diagnostics.failed,
      activeTargetCount: this.#workspace
        ? listWorkspaceTargets(this.#workspace).length
        : 0,
      pendingTargetCount:
        this.#pending.size + this.#inFlight.size,
      elapsedMs: Math.max(
        batchElapsedMs,
        now - this.#diagnosticStartedAt
      )
    };
    const diagnostic: WorkspaceRefreshDiagnostic = {
      level: force ? "warning" : "info",
      name: force
        ? "workspace.refresh-failed"
        : "workspace.refresh-summary",
      context
    };
    try {
      void Promise.resolve(
        this.#options.onDiagnostic?.(diagnostic)
      ).catch(() => undefined);
    } catch {
      // Diagnostics are intentionally best effort.
    }
    this.#diagnostics = createDiagnosticCounters();
    this.#diagnosticStartedAt = now;
    this.#lastDiagnosticAt = now;
  }
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

function priorityWeight(
  priority: WorkspaceRefreshPriority
): number {
  return priority === "selected"
    ? 0
    : 1;
}

function createDiagnosticCounters(): DiagnosticCounters {
  return {
    requested: 0,
    merged: 0,
    executed: 0,
    changed: 0,
    failed: 0,
    reasons: new Set()
  };
}
