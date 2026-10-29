import type { BranchDto, RepositoryHistoryPageDto } from "@gitnest/contracts";

type HistoryCommit = RepositoryHistoryPageDto["page"]["commits"][number];

const COLORS = [
  "var(--blue)",
  "var(--purple)",
  "var(--green)",
  "var(--yellow)",
  "var(--accent)",
  "var(--red)"
];

export interface HistoryGraphColors {
  refs: Map<string, number>;
  commits: Map<string, string>;
}

export function createHistoryGraphColors(): HistoryGraphColors {
  return { refs: new Map(), commits: new Map() };
}

export function historyGraphColor(index: number): string {
  // Additional branches get deterministic colours instead of cycling back to
  // a colour already in use. Keep the stash's magenta hue out of this range.
  const hue = ((index - COLORS.length) * 137.508 % 255 + 255) % 255 + 20;
  return COLORS[index] ?? `light-dark(hsl(${hue.toFixed(2)} 70% 36%), hsl(${hue.toFixed(2)} 70% 70%))`;
}

export function historyGraphColorPriority(color: string): number {
  const index = COLORS.indexOf(color);
  return index < 0 ? COLORS.length : index;
}

function refPriority(ref: string): number {
  const main = /^refs\/(?:heads|remotes\/[^/]+)\/(?:main|master|trunk)$/.test(ref);
  return (main ? 0 : 2) + Number(ref.startsWith("refs/remotes/"));
}

function compareRefs(left: string, right: string): number {
  return refPriority(left) - refPriority(right)
    || (left < right ? -1 : Number(left > right));
}

export function historyBranchTipColors(
  commits: readonly HistoryCommit[],
  branches: readonly BranchDto[],
  colors: HistoryGraphColors
): Map<string, string> {
  const visibleHashes = new Set(commits.map((commit) => commit.hash));
  const tips = new Map<string, Set<string>>();
  const refHeads = new Set<string>();
  const fullNames = new Map(branches.flatMap((branch) => [
    [branch.name, branch.fullName],
    [branch.fullName, branch.fullName]
  ] as [string, string][]));
  const add = (hash: string, ref: string) => {
    if (
      !hash ||
      !visibleHashes.has(hash) ||
      ref.endsWith("/HEAD") ||
      refHeads.has(ref)
    ) {
      return;
    }
    refHeads.add(ref);
    const refs = tips.get(hash) ?? new Set<string>();
    refs.add(ref);
    tips.set(hash, refs);
  };
  for (const branch of branches) add(branch.head, branch.fullName);
  for (const commit of commits) {
    if (commit.stashRef) continue;
    for (const decoration of commit.refs ?? []) {
      if (decoration === "HEAD" || /^(?:tag: |refs\/tags\/|stash@)/.test(decoration)) continue;
      const ref = decoration.replace(/^HEAD -> /, "");
      add(commit.hash, fullNames.get(ref) ?? (
        ref.startsWith("refs/") ? ref
          : ref.startsWith("origin/") ? `refs/remotes/${ref}` : `refs/heads/${ref}`
      ));
    }
  }

  const groups = [...tips].map(([hash, refs]) => ({
    hash, refs: [...refs].sort(compareRefs)
  })).sort((left, right) =>
    Number(right.refs.some((ref) => colors.refs.has(ref)))
      - Number(left.refs.some((ref) => colors.refs.has(ref)))
    || compareRefs(left.refs[0]!, right.refs[0]!)
  );
  const used = new Set<number>();
  const result = new Map<string, string>();
  for (const group of groups) {
    let index = group.refs
      .map((ref) => colors.refs.get(ref))
      .find((candidate) => candidate !== undefined && !used.has(candidate));
    if (index === undefined) {
      index = 0;
      while (used.has(index)) index++;
    }
    used.add(index);
    for (const ref of group.refs) colors.refs.set(ref, index);
    result.set(group.hash, historyGraphColor(index));
  }
  return result;
}

const repositoryColors = new Map<string, HistoryGraphColors>();
const storageKey = (repositoryId: string) => `gitnest.history-graph-colors:${repositoryId}`;

export function repositoryHistoryGraphColors(repositoryId: string): HistoryGraphColors {
  const existing = repositoryColors.get(repositoryId);
  if (existing) return existing;
  const colors = createHistoryGraphColors();
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey(repositoryId)) ?? "[]");
    if (Array.isArray(saved)) {
      for (const entry of saved) {
        if (
          Array.isArray(entry) && typeof entry[0] === "string"
          && Number.isSafeInteger(entry[1]) && entry[1] >= 0 && entry[1] < 100_000
        ) colors.refs.set(entry[0], entry[1] as number);
      }
    }
  } catch {
    // The in-memory assignments still remain stable if storage is unavailable.
  }
  repositoryColors.set(repositoryId, colors);
  return colors;
}

export function saveHistoryGraphColors(repositoryId: string, colors: HistoryGraphColors): void {
  try {
    localStorage.setItem(storageKey(repositoryId), JSON.stringify([...colors.refs]));
  } catch {
    // A storage failure must not prevent history rendering.
  }
}
