import type { BranchDto, RepositoryHistoryPageDto } from "@gitnest/contracts";
import {
  createHistoryGraphColors,
  historyBranchTipColors,
  historyGraphColor,
  historyGraphColorPriority,
  type HistoryGraphColors
} from "./historyGraphColors";

type HistoryCommit = RepositoryHistoryPageDto["page"]["commits"][number];

export interface HistoryGraphRow {
  lane: number;
  color: string;
  paths: { d: string; color: string }[];
  boundary: string | undefined;
}

export const HISTORY_GRAPH_ROW_HEIGHT = 32;
const MIDPOINT = HISTORY_GRAPH_ROW_HEIGHT / 2;
const LANE_WIDTH = 16;
const laneX = (lane: number) => 16 + lane * LANE_WIDTH;

/**
 * Git date-order supplies children before parents. Keep each first-parent
 * line in its lane until its parent arrives, then reuse the released lanes.
 * Only actual parent hashes form edges, including continuations into pages
 * that have not been loaded yet.
 */
export function buildHistoryGraph(
  commits: readonly HistoryCommit[],
  colors: HistoryGraphColors = createHistoryGraphColors(),
  branches: readonly BranchDto[] = [],
  options: { continueOutsidePage?: boolean } = {}
): {
  rows: HistoryGraphRow[];
  width: number;
} {
  const positions = new Map(commits.map((commit, index) => [commit.hash, index]));
  const tipColors = historyBranchTipColors(commits, branches, colors);
  const reservedColors = new Set(tipColors.values());
  const neighbours = new Map(commits.map((commit) => [commit.hash, new Set<string>()]));
  for (const commit of commits) {
    for (const parent of commit.parentHashes) {
      if (parent === commit.hash) continue;
      if (positions.has(parent)) {
        neighbours.get(commit.hash)!.add(parent);
        neighbours.get(parent)!.add(commit.hash);
      } else if (options.continueOutsidePage) {
        neighbours.get(commit.hash)!.add(parent);
      }
    }
  }

  const lanes: ({ hash: string; color: string; stash?: boolean } | undefined)[] = [];
  let maxLanes = 1;
  const allocateColor = (hash: string, sourceColor?: string) => {
    const used = new Set(lanes.flatMap((entry) => entry ? [entry.color] : []));
    if (sourceColor) used.add(sourceColor);
    const saved = tipColors.get(hash) ?? colors.commits.get(hash);
    if (saved && !used.has(saved)) return saved;
    for (const color of reservedColors) used.add(color);
    for (let index = 0; ; index++) {
      const color = historyGraphColor(index);
      if (!used.has(color)) {
        colors.commits.set(hash, color);
        return color;
      }
    }
  };
  const availableLane = (minimum = 0) => {
    for (let lane = minimum; lane < lanes.length; lane++) {
      if (!lanes[lane]) return lane;
    }
    return Math.max(minimum, lanes.length);
  };
  const rows = commits.map((commit, index): HistoryGraphRow => {
    const preferred = tipColors.get(commit.hash) ?? colors.commits.get(commit.hash);
    const branchLane = lanes.map((entry, slot) => ({ entry, slot }))
      .filter(({ entry }) => entry?.hash === commit.hash && !entry.stash)
      .sort((left, right) =>
        Number(right.entry!.color === preferred) - Number(left.entry!.color === preferred)
        || historyGraphColorPriority(left.entry!.color) - historyGraphColorPriority(right.entry!.color)
      )[0]?.slot ?? -1;
    const incomingLane = branchLane >= 0
      ? branchLane
      : lanes.findIndex((entry) => entry?.hash === commit.hash);
    const lane = incomingLane < 0
      ? availableLane(commit.stashRef ? 1 : 0)
      : !commit.stashRef && branchLane < 0
        ? Math.min(incomingLane, availableLane())
        : incomingLane;
    const color = commit.stashRef
      ? "var(--history-stash-color)"
      : branchLane >= 0 ? lanes[branchLane]!.color : allocateColor(commit.hash);
    if (!commit.stashRef) colors.commits.set(commit.hash, color);
    const paths: HistoryGraphRow["paths"] = [];

    lanes.forEach((entry, slot) => {
      if (!entry) return;
      const arrives = entry.hash === commit.hash;
      paths.push({
        d: arrives && slot !== lane
          ? `M ${laneX(slot)} 0 V 8 C ${laneX(slot)} 12, ${laneX(lane)} 12, ${laneX(lane)} ${MIDPOINT}`
          : `M ${laneX(slot)} 0 V ${arrives ? MIDPOINT : HISTORY_GRAPH_ROW_HEIGHT}`,
        color: entry.color
      });
      if (arrives) lanes[slot] = undefined;
    });

    const future = [...neighbours.get(commit.hash)!]
      .filter((hash) => !positions.has(hash) || positions.get(hash)! > index)
      .sort((left, right) => {
        const leftParent = commit.parentHashes.indexOf(left);
        const rightParent = commit.parentHashes.indexOf(right);
        return (leftParent < 0 ? Infinity : leftParent)
          - (rightParent < 0 ? Infinity : rightParent);
      });
    future.forEach((hash) => {
      const firstParent = hash === commit.parentHashes[0];
      const reversedFirstParent = commits[positions.get(hash)!]?.parentHashes[0] === commit.hash
        && (colors.commits.get(hash) ?? tipColors.get(hash)) === color;
      const continuesLane = (firstParent || reversedFirstParent) && !lanes[lane];
      let targetLane = continuesLane
        ? lane
        : commit.stashRef ? -1
          : lanes.findIndex((entry) => entry?.hash === hash && !entry.stash);
      if (continuesLane) {
        lanes[targetLane] = { hash, color, stash: Boolean(commit.stashRef) };
      }
      if (targetLane < 0) {
        targetLane = availableLane();
        lanes[targetLane] = {
          hash,
          color: commit.stashRef || reversedFirstParent ? color : allocateColor(hash, color),
          stash: Boolean(commit.stashRef)
        };
      }
      paths.push({
        d: targetLane === lane
          ? `M ${laneX(lane)} ${MIDPOINT} V ${HISTORY_GRAPH_ROW_HEIGHT}`
          : `M ${laneX(lane)} ${MIDPOINT} C ${laneX(lane)} 24, ${laneX(targetLane)} 24, ${laneX(targetLane)} ${HISTORY_GRAPH_ROW_HEIGHT}`,
        color: commit.stashRef ? color : lanes[targetLane]!.color
      });
    });

    const hasMissingParent = commit.parentHashes.some((hash) => !positions.has(hash));
    const boundary = !hasMissingParent || options.continueOutsidePage
      ? undefined
      : future.length
        ? `M ${laneX(lane)} ${MIDPOINT} Q ${laneX(lane) + 8} 20, ${laneX(lane) + 8} 30`
        : `M ${laneX(lane)} ${MIDPOINT} V 30`;
    maxLanes = Math.max(maxLanes, lanes.length, lane + (boundary && future.length ? 2 : 1));
    while (lanes.length && !lanes.at(-1)) lanes.pop();
    return { lane, color, paths, boundary };
  });

  return { rows, width: Math.max(64, laneX(maxLanes - 1) + 20) };
}

export function equalHistoryGraphRows(left: HistoryGraphRow, right: HistoryGraphRow): boolean {
  return left.lane === right.lane
    && left.color === right.color
    && left.boundary === right.boundary
    && left.paths.length === right.paths.length
    && left.paths.every((path, index) =>
      path.d === right.paths[index]!.d && path.color === right.paths[index]!.color
    );
}
