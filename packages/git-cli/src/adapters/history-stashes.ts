import type {
  CommitHistoryEntry,
  CommitHistoryPage,
  CommitHistoryFilter,
  StashSummary
} from "@gitnest/git-core";

/**
 * Stash records sit immediately before their base commit. They do not consume
 * Git log offsets, and only the first parent belongs in the history graph.
 */
export function attachHistoryStashes(
  page: CommitHistoryPage,
  stashes: readonly StashSummary[],
  includeUnattached = false
): CommitHistoryPage {
  if (!stashes.length) return page;
  const commits: CommitHistoryEntry[] = [];
  const visible = new Set(page.commits.map((commit) => commit.hash));
  const byHash = new Map(stashes.map((stash) => [stash.hash, stash]));
  const byBase = new Map<string, StashSummary[]>();
  for (const stash of stashes) {
    const base = stash.baseHash ?? stash.parentHashes[0];
    if (!base || visible.has(stash.hash)) continue;
    const siblings = byBase.get(base) ?? [];
    siblings.push(stash);
    byBase.set(base, siblings);
  }
  for (const commit of page.commits) {
    for (const stash of byBase.get(commit.hash) ?? []) {
      commits.push({
        hash: stash.hash,
        shortHash: stash.hash.slice(0, 7),
        subject: stash.subject,
        authorName: stash.authorName,
        authorEmail: stash.authorEmail,
        authoredAt: stash.authoredAt,
        parentHashes: [commit.hash],
        refs: [],
        stashRef: stash.ref
      });
    }
    const stash = byHash.get(commit.hash);
    const base = stash?.baseHash ?? stash?.parentHashes[0];
    commits.push(stash && base
      ? { ...commit, parentHashes: [base], stashRef: stash.ref }
      : commit);
  }
  // Search can match a stash without matching its base commit.
  const attached = new Set(commits.map(commit => commit.hash));
  return {
    ...page,
    commits: [
      ...(includeUnattached ? stashes.filter(stash => !attached.has(stash.hash)).map(historyStashEntry) : []),
      ...commits
    ]
  };
}

function historyStashEntry(stash: StashSummary): CommitHistoryEntry {
  const base = stash.baseHash ?? stash.parentHashes[0];
  return {
    hash: stash.hash,
    shortHash: stash.hash.slice(0, 7),
    subject: stash.subject,
    authorName: stash.authorName,
    authorEmail: stash.authorEmail,
    authoredAt: stash.authoredAt,
    parentHashes: base ? [base] : [],
    refs: [],
    stashRef: stash.ref
  };
}

export function stashMatchesHistorySearch(stash: StashSummary, search: CommitHistoryFilter): boolean {
  const author = `${stash.authorName} <${stash.authorEmail}>`.toLowerCase();
  if (search.keyword && !`${stash.subject}\n${author}`.toLowerCase().includes(search.keyword.toLowerCase())) return false;
  if (search.author && !author.includes(search.author.toLowerCase())) return false;
  const timestamp = new Date(stash.authoredAt).getTime();
  if (search.since && timestamp < new Date(`${search.since}T00:00:00`).getTime()) return false;
  if (search.until && timestamp > new Date(`${search.until}T23:59:59.999`).getTime()) return false;
  return true;
}
