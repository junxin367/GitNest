import type { CodeAnalysisState } from "@gitnest/application";
import type { Workspace } from "@gitnest/workspace-core";

/**
 * Debounced, single-flight scheduler for automatic code-analysis
 * refreshes.
 *
 * Behaviour (CA-5):
 * - only the currently selected entry is refreshed, and only with
 *   the `changed` scope; the full `workspace` scope stays manual;
 * - rapid saves collapse into one run (`debounceMs`, default 1500);
 * - at most one refresh runs at a time, and a new request during a
 *   run supersedes the pending one instead of queueing up;
 * - switching entries or disabling the feature cancels the pending
 *   and the running refresh.
 *
 * The scheduler owns no timers beyond the debounce timer and never
 * writes analysis data itself: it only asks the service to start a
 * run.
 */
export interface AutoRefreshSchedulerOptions {
  debounceMs: number;
  enabled(): Promise<boolean>;
  run(signal: AbortSignal): Promise<void>;
  onError?(error: unknown): void;
}

export class CodeAnalysisAutoRefreshScheduler {
  readonly #options: AutoRefreshSchedulerOptions;
  #timer: NodeJS.Timeout | undefined;
  #debounceMs: number;
  #running = false;
  #pending = false;
  #disposed = false;
  #generation = 0;
  #activeController: AbortController | undefined;

  constructor(options: AutoRefreshSchedulerOptions) {
    this.#options = options;
    this.#debounceMs = options.debounceMs;
  }

  /** Applies the debounce window from application settings. */
  setDebounceMs(debounceMs: number): void {
    if (Number.isFinite(debounceMs) && debounceMs > 0) {
      this.#debounceMs = debounceMs;
    }
  }

  /** Marks the analysis input as changed. */
  request(): void {
    if (this.#disposed) {
      return;
    }
    if (this.#running) {
      this.#pending = true;
      return;
    }
    if (this.#timer) {
      clearTimeout(this.#timer);
    }
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#flush();
    }, this.#debounceMs);
  }

  /** Cancels any pending refresh, e.g. when the entry changes. */
  cancel(): void {
    this.#generation += 1;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    this.#pending = false;
    this.#activeController?.abort();
  }

  /** True while a refresh is executing (not merely debouncing). */
  get running(): boolean {
    return this.#running;
  }

  dispose(): void {
    this.#disposed = true;
    this.cancel();
  }

  async #flush(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    const generation = this.#generation;
    let enabled = false;
    try {
      enabled = await this.#options.enabled();
    } catch {
      enabled = false;
    }
    if (!enabled || this.#disposed || generation !== this.#generation) {
      return;
    }
    this.#running = true;
    const controller = new AbortController();
    this.#activeController = controller;
    try {
      await this.#options.run(controller.signal);
    } catch (error) {
      this.#options.onError?.(error);
    } finally {
      if (this.#activeController === controller) {
        this.#activeController = undefined;
      }
      this.#running = false;
      if (this.#pending) {
        this.#pending = false;
        this.request();
      }
    }
  }
}

export function waitForAnalysisCompletion(
  subscribe: (
    listener: (state: CodeAnalysisState) => void
  ) => () => void,
  analysisId: string,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let unsubscribe: (() => void) | undefined;
    let finished = false;
    const finish = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      signal.removeEventListener("abort", finish);
      unsubscribe?.();
      resolve();
    };
    signal.addEventListener("abort", finish, { once: true });
    unsubscribe = subscribe((state) => {
      if (
        state.analysisId === analysisId &&
        state.state !== "running"
      ) {
        finish();
      }
    });
    if (finished) {
      unsubscribe();
    }
  });
}


/**
 * Stable identity of what the user is currently looking at. A change
 * means the previous auto-refresh target is no longer relevant.
 */
export function analysisSelectionKey(
  workspace: Workspace
): string {
  const target = workspace.selectedTarget;
  return [
    workspace.id,
    target ? `${target.repositoryId}@${target.worktreeId}` : "none"
  ].join("\0");
}

export interface AutoRefreshSource {
  workspace: Workspace;
}

/**
 * True when an automatic `changed` refresh is meaningful for this
 * workspace: it needs at least one group target, otherwise the
 * analysis context is empty and a refresh would do nothing.
 */
export function shouldAutoRefresh(
  workspace: Workspace | undefined
): boolean {
  if (!workspace) {
    return false;
  }
  if (workspace.groups.length === 0) {
    return false;
  }
  return workspace.worktrees.some((worktree) => !worktree.isBare);
}
