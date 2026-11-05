import type { WorkspaceRuntimeService } from "@gitnest/application";
import { GitError, type GitRepositoryCommandClient } from "@gitnest/git-core";
import type { AppSettingsService } from "../settings/app-settings";

const FETCH_INTERVAL_MS = 5 * 60_000;
const CHECK_INTERVAL_MS = 30_000;
const REQUEST_DELAY_MS = 500;
const NETWORK_TIMEOUT_MS = 30_000;

type Runtime = Pick<
  WorkspaceRuntimeService,
  "getState" | "getCurrent" | "subscribe" | "queueRepositoryOperation"
>;

interface AutoFetchOptions {
  workspace: Runtime;
  git: Pick<GitRepositoryCommandClient, "readRemotes" | "fetchRemote">;
  settings: Pick<AppSettingsService, "get">;
  onError(error: unknown): void;
  clock?: () => number;
}

/** Fetch only the selected repository; refs are shared by its Worktrees. */
export class RepositoryAutoFetchScheduler {
  readonly #options: AutoFetchOptions;
  readonly #lastAttempt = new Map<string, number>();
  readonly #observedOperations = new Set<string>();
  #interval: ReturnType<typeof setInterval> | undefined;
  #requestTimer: ReturnType<typeof setTimeout> | undefined;
  #unsubscribe: (() => void) | undefined;
  #checking = false;
  #disposed = false;
  #foreground = true;

  constructor(options: AutoFetchOptions) {
    this.#options = options;
  }

  start(): void {
    if (this.#disposed || this.#interval) return;
    this.#unsubscribe = this.#options.workspace.subscribe(state => {
      const liveIds = new Set(state.operations.map(operation => operation.id));
      for (const id of this.#observedOperations) {
        if (!liveIds.has(id)) this.#observedOperations.delete(id);
      }
      for (const operation of state.operations) {
        if (operation.kind !== "fetch" ||
          isActive(operation.state) ||
          this.#observedOperations.has(operation.id)) continue;
        this.#observedOperations.add(operation.id);
        const completedAt = Date.parse(operation.finishedAt ?? "");
        // Manual and background Fetch share the same throttling window.
        if (!Number.isFinite(completedAt)) continue;
        for (const id of operation.targetIds) {
          const repository = state.workspace.repositories.find(candidate =>
            id.startsWith(`${candidate.id}:`));
          if (!repository) continue;
          const key = `${state.workspace.id}:${repository.id}`;
          this.#lastAttempt.set(key, Math.max(
            this.#lastAttempt.get(key) ?? 0,
            Math.min(completedAt, this.#now())
          ));
        }
      }
      this.request();
    });
    this.#interval = setInterval(() => this.request(), CHECK_INTERVAL_MS);
    this.#interval.unref?.();
    this.request();
  }

  setForeground(foreground: boolean): void {
    this.#foreground = foreground;
    if (foreground) this.request();
  }

  request(): void {
    if (this.#disposed || !this.#foreground || this.#requestTimer) return;
    this.#requestTimer = setTimeout(() => {
      this.#requestTimer = undefined;
      void this.#check().catch(error => {
        if (!this.#disposed) this.#options.onError(error);
      });
    }, REQUEST_DELAY_MS);
    this.#requestTimer.unref?.();
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#interval) clearInterval(this.#interval);
    if (this.#requestTimer) clearTimeout(this.#requestTimer);
    this.#unsubscribe?.();
    this.#lastAttempt.clear();
    this.#observedOperations.clear();
  }

  #now(): number {
    return this.#options.clock?.() ?? Date.now();
  }

  async #check(): Promise<void> {
    if (this.#checking || this.#disposed || !this.#foreground) return;
    this.#checking = true;
    try {
      const preferences = await this.#options.settings.get();
      if (this.#disposed || preferences.settings.git.autoFetch === false) return;
      const state = await this.#options.workspace.getState();
      const target = state.workspace.selectedTarget;
      if (this.#disposed || !this.#foreground || !target) return;
      const workspaceId = state.workspace.id;
      const key = `${workspaceId}:${target.repositoryId}`;
      const previous = this.#lastAttempt.get(key);
      if (previous !== undefined && this.#now() - previous < FETCH_INTERVAL_MS) return;
      if (state.operations.some(operation =>
        isActive(operation.state) &&
        (operation.scope === "workspace" ||
          operation.targetIds.some(id => id.startsWith(`${target.repositoryId}:`)))
      )) return;

      this.#lastAttempt.set(key, this.#now());
      try {
        await this.#options.workspace.queueRepositoryOperation(
          { repositoryId: target.repositoryId, worktreeId: target.worktreeId },
          "fetch",
          async (path, signal) => {
            const current = await this.#options.workspace.getCurrent();
            const loaded = await this.#options.settings.get();
            if (this.#disposed || signal.aborted || current.id !== workspaceId) {
              throw new GitError("COMMAND_CANCELLED", "自动 Fetch 已取消。");
            }
            if (loaded.settings.git.autoFetch === false) return;
            const remotes = await this.#options.git.readRemotes(path, { signal });
            let firstFailure: unknown;
            for (const remote of remotes) {
              if (signal.aborted) {
                throw new GitError("COMMAND_CANCELLED", "自动 Fetch 已取消。");
              }
              try {
                await this.#options.git.fetchRemote(path, remote, {
                  prune: true, signal, timeoutMs: NETWORK_TIMEOUT_MS
                });
              } catch (error) {
                // A failing remote must not prevent other remotes from updating.
                firstFailure ??= error;
              }
            }
            if (firstFailure) throw firstFailure;
          },
          { expectedWorkspaceId: workspaceId }
        );
      } catch (error) {
        this.#options.onError(error);
      }
    } finally {
      this.#checking = false;
    }
  }
}

function isActive(state: string): boolean {
  return state === "queued" || state === "running" || state === "cancelling";
}
