import {
  GitError,
  parseCommitHistory,
  type CommitHistoryFilter,
  type CommitHistoryPage
} from "@gitnest/git-core";

import {
  historyOrderArguments,
  historyPageContentArguments
} from "../commands/read-repository";
import { runProcess, type ProcessRequest } from "../process/git-process-runner";

type HistoryCommandOptions = Pick<
  ProcessRequest,
  "executable" | "cwd" | "signal" | "timeoutMs" | "priority"
>;

const INDEX_OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;
const PAGE_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
const MAX_CACHED_INDEXES = 8;
const MAX_CACHED_INDEX_BYTES = 32 * 1024 * 1024;

interface HistoryIndex {
  data: Buffer;
  hashBytes: number;
  length: number;
}

interface PendingHistoryIndex {
  controller: AbortController;
  result: Promise<HistoryIndex>;
  readers: number;
  settled: boolean;
}

export class ChronologicalHistoryReader {
  readonly #indexes = new Map<string, HistoryIndex>();
  readonly #pendingIndexes = new Map<string, PendingHistoryIndex>();
  #cachedBytes = 0;

  async read(
    options: HistoryCommandOptions,
    revisions: readonly string[],
    search: CommitHistoryFilter | undefined,
    limit: number,
    offset: number
  ): Promise<CommitHistoryPage> {
    if (options.signal?.aborted) {
      throw new GitError("COMMAND_CANCELLED", "The Git command was cancelled.");
    }
    const key = JSON.stringify([options.cwd, revisions, search ?? null]);
    let ordered = this.#indexes.get(key);
    if (ordered) {
      this.#indexes.delete(key);
      this.#indexes.set(key, ordered);
    } else {
      ordered = await this.#readIndex(key, options, revisions, search);
    }

    const hashes = Array.from(
      { length: Math.max(0, Math.min(limit, ordered.length - offset)) },
      (_, index) => ordered.data.toString(
        "hex", (offset + index) * ordered.hashBytes, (offset + index + 1) * ordered.hashBytes
      )
    );
    if (!hashes.length) return { commits: [] };
    const result = await runProcess({
      ...options,
      args: historyPageContentArguments(),
      input: hashes.join("\n"),
      outputLimitBytes: PAGE_OUTPUT_LIMIT_BYTES
    });
    const commits = new Map(
      parseCommitHistory(result.stdout).map((commit) => [commit.hash, commit])
    );
    return {
      commits: hashes.map((hash) => {
        const commit = commits.get(hash);
        if (!commit) {
          throw new GitError("INVALID_GIT_OUTPUT", "A history page is missing a requested commit.");
        }
        return commit;
      }),
      ...(offset + limit < ordered.length ? { nextOffset: offset + limit } : {})
    };
  }

  #readIndex(
    key: string,
    options: HistoryCommandOptions,
    revisions: readonly string[],
    search: CommitHistoryFilter | undefined
  ): Promise<HistoryIndex> {
    let pending = this.#pendingIndexes.get(key);
    if (!pending) {
      const controller = new AbortController();
      const entry: PendingHistoryIndex = {
        controller, readers: 0, settled: false,
        result: Promise.resolve().then(async () => {
          const index = compactHistoryIndex(await readHistoryOrder(
            { ...options, signal: controller.signal }, revisions, search
          ));
          if (!controller.signal.aborted && this.#pendingIndexes.get(key) === entry) {
            this.#cache(key, index);
          }
          return index;
        }).finally(() => {
          entry.settled = true;
          if (this.#pendingIndexes.get(key) === entry) this.#pendingIndexes.delete(key);
        })
      };
      this.#pendingIndexes.set(key, entry);
      pending = entry;
    }
    const entry = pending;
    entry.readers++;
    return new Promise<HistoryIndex>((resolve, reject) => {
      let finished = false;
      const finish = (index?: HistoryIndex, error?: unknown) => {
        if (finished) return;
        finished = true;
        options.signal?.removeEventListener("abort", cancel);
        entry.readers--;
        if (entry.readers === 0 && !entry.settled) {
          if (this.#pendingIndexes.get(key) === entry) this.#pendingIndexes.delete(key);
          entry.controller.abort();
        }
        if (index) resolve(index);
        else reject(error);
      };
      const cancel = () => finish(undefined,
        new GitError("COMMAND_CANCELLED", "The Git command was cancelled."));
      options.signal?.addEventListener("abort", cancel, { once: true });
      entry.result.then(index => finish(index), error => finish(undefined, error));
      if (options.signal?.aborted) cancel();
    });
  }

  #cache(key: string, index: HistoryIndex): void {
    if (index.data.byteLength > MAX_CACHED_INDEX_BYTES) return;
    const previous = this.#indexes.get(key);
    if (previous) {
      this.#cachedBytes -= previous.data.byteLength;
      this.#indexes.delete(key);
    }
    while (
      this.#indexes.size >= MAX_CACHED_INDEXES ||
      this.#cachedBytes + index.data.byteLength > MAX_CACHED_INDEX_BYTES
    ) {
      const oldest = this.#indexes.keys().next().value;
      if (oldest === undefined) break;
      this.#cachedBytes -= this.#indexes.get(oldest)!.data.byteLength;
      this.#indexes.delete(oldest);
    }
    this.#indexes.set(key, index);
    this.#cachedBytes += index.data.byteLength;
  }
}

function compactHistoryIndex(hashes: readonly string[]): HistoryIndex {
  const hashBytes = (hashes[0]?.length ?? 40) / 2;
  const data = Buffer.allocUnsafe(hashes.length * hashBytes);
  for (let index = 0; index < hashes.length; index++) {
    const hash = hashes[index]!;
    if (hash.length !== hashBytes * 2 || (hashBytes !== 20 && hashBytes !== 32)) {
      throw new GitError("INVALID_GIT_OUTPUT", "History contains inconsistent object IDs.");
    }
    data.write(hash, index * hashBytes, hashBytes, "hex");
  }
  return { data, hashBytes, length: hashes.length };
}

async function readHistoryOrder(
  options: HistoryCommandOptions,
  revisions: readonly string[],
  search: CommitHistoryFilter | undefined
): Promise<string[]> {
  const { keyword, since, until, ...filters } = search ?? {};
  const earliest = since ? new Date(`${since}T00:00:00`).getTime() / 1000 : -Infinity;
  const latest = until ? new Date(`${until}T23:59:59.999`).getTime() / 1000 : Infinity;
  const result = await runProcess({
    ...options,
    args: historyOrderArguments(filters),
    input: revisions.join("\n"),
    outputLimitBytes: INDEX_OUTPUT_LIMIT_BYTES
  });
  // Filter the committer timestamps without reordering Git's date-order walk.
  // Parent/child order takes priority when repository clocks disagree.
  const entries = result.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const match = /^([0-9a-f]{40,64})\t(-?\d+)$/.exec(line);
    const timestamp = Number(match?.[2]);
    if (!match || !Number.isSafeInteger(timestamp)) {
      throw new GitError("INVALID_GIT_OUTPUT", "A history ordering record is invalid.");
    }
    return { hash: match[1]!, timestamp };
  }).filter((entry) => entry.timestamp >= earliest && entry.timestamp <= latest);
  const hashes = entries.map((entry) => entry.hash);
  if (!keyword || !hashes.length) return hashes;

  const matches = await Promise.all(
    [`--grep=${keyword}`, `--author=${keyword}`].map(async (criterion) => {
      const found = await runProcess({
        ...options,
        args: [
          "log",
          "--no-walk=unsorted",
          "--format=%H",
          "--fixed-strings",
          "--regexp-ignore-case",
          criterion,
          "--stdin",
          "--"
        ],
        input: hashes.join("\n"),
        outputLimitBytes: INDEX_OUTPUT_LIMIT_BYTES
      });
      return found.stdout.trim().split(/\r?\n/).filter(Boolean);
    })
  );
  const matched = new Set(matches.flat());
  return hashes.filter((hash) => matched.has(hash));
}
