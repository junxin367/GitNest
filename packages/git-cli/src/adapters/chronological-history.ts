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
  "executable" | "cwd" | "signal" | "timeoutMs"
>;

const INDEX_OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;
const PAGE_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
const MAX_CACHED_INDEXES = 8;
const MAX_CACHED_COMMITS = 250_000;

export class ChronologicalHistoryReader {
  readonly #indexes = new Map<string, readonly string[]>();
  #cachedCommits = 0;

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
      ordered = await readHistoryOrder(options, revisions, search);
      this.#cache(key, ordered);
    }

    const hashes = ordered.slice(offset, offset + limit);
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

  #cache(key: string, hashes: readonly string[]): void {
    if (hashes.length > MAX_CACHED_COMMITS) return;
    const previous = this.#indexes.get(key);
    if (previous) {
      this.#cachedCommits -= previous.length;
      this.#indexes.delete(key);
    }
    while (
      this.#indexes.size >= MAX_CACHED_INDEXES ||
      this.#cachedCommits + hashes.length > MAX_CACHED_COMMITS
    ) {
      const oldest = this.#indexes.keys().next().value;
      if (oldest === undefined) break;
      this.#cachedCommits -= this.#indexes.get(oldest)!.length;
      this.#indexes.delete(oldest);
    }
    this.#indexes.set(key, hashes);
    this.#cachedCommits += hashes.length;
  }
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
