import type {
  GitNestBridge,
  GitReadResult,
  RepositoryChangesDto,
  RepositoryTargetDto
} from "@gitnest/contracts";

import { repositoryTargetsMatch } from "./changeSelection";
import { applyRepositoryChangesProgress } from "./progressiveChanges";

type ChangesListener = (value: RepositoryChangesDto, snapshot: boolean) => void;

interface ChangesEntry {
  revision: string | undefined;
  readonly value: RepositoryChangesDto | null;
  readonly progressComplete: boolean;
  result: Promise<GitReadResult<RepositoryChangesDto>>;
  subscribe(listener: ChangesListener): () => void;
  cancel(): void;
}

const MAX_CACHED_TARGETS = 16;

// Navigation detaches the visible consumer; the underlying query continues
// filling its own target's cache until completion, invalidation, or page exit.
export class RepositoryChangesCache {
  readonly #repository: GitNestBridge["repository"];
  readonly #entries = new Map<string, ChangesEntry>();

  constructor(repository: GitNestBridge["repository"]) {
    this.#repository = repository;
  }

  peek(targetKey: string, revision?: string): RepositoryChangesDto | null {
    const entry = this.#entries.get(targetKey);
    return entry && (revision === undefined || entry.revision === revision) ? entry.value : null;
  }

  read(
    target: RepositoryTargetDto,
    revision: string,
    queryId: string,
    reuse: boolean
  ): ChangesEntry {
    const key = `${target.repositoryId}:${target.worktreeId}`;
    const cached = this.#entries.get(key);
    if (reuse && cached?.revision === revision) {
      this.#entries.delete(key);
      this.#entries.set(key, cached);
      return cached;
    }
    this.#discard(key);

    let value: RepositoryChangesDto | null = cached?.value ?? null;
    let progressComplete = false;
    let active = true;
    let pending = true;
    const listeners = new Set<ChangesListener>();
    const unsubscribe = this.#repository.onChangesProgress((progress) => {
      if (
        !active || !pending ||
        progress.queryId !== queryId ||
        !repositoryTargetsMatch(progress.target, target)
      ) {
        return;
      }
      value = applyRepositoryChangesProgress(value, progress);
      progressComplete = progress.completed >= progress.total;
      if (value) {
        for (const listener of listeners) {
          listener(value, progress.kind === "snapshot");
        }
      }
    });
    const entry: ChangesEntry = {
      revision,
      get value() { return value; },
      get progressComplete() { return progressComplete; },
      subscribe(listener) {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
      cancel: () => {
        if (!active) return;
        active = false;
        unsubscribe();
        listeners.clear();
        if (pending) void this.#repository.cancelQuery({ queryId });
      },
      result: Promise.resolve().then(async (): Promise<GitReadResult<RepositoryChangesDto>> => {
        try {
          if (!active) {
            return {
              ok: false,
              error: { code: "COMMAND_CANCELLED", message: "仓库查询已取消。", details: {} }
            };
          }
          const result = await this.#repository.getChanges({
            queryId, target, progressive: true
          });
          if (active && result.ok) {
            value = result.value;
          } else if (entry.revision !== undefined && this.#entries.get(key) === entry) {
            this.#entries.delete(key);
          }
          return result;
        } catch (reason) {
          if (entry.revision !== undefined && this.#entries.get(key) === entry) this.#entries.delete(key);
          throw reason;
        } finally {
          pending = false;
          unsubscribe();
        }
      })
    };
    this.#entries.set(key, entry);
    while (this.#entries.size > MAX_CACHED_TARGETS) {
      this.#discard(this.#entries.keys().next().value!);
    }
    return entry;
  }

  invalidate(targetKey: string): void {
    const entry = this.#entries.get(targetKey);
    if (entry) {
      // Retain visible rows during a mutation/refresh, but force the next read
      // to create a fresh query instead of treating those rows as current.
      entry.revision = undefined;
      entry.cancel();
    }
  }

  #discard(targetKey: string): void {
    this.#entries.get(targetKey)?.cancel();
    this.#entries.delete(targetKey);
  }

  dispose(): void {
    for (const entry of this.#entries.values()) entry.cancel();
    this.#entries.clear();
  }
}
