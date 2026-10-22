import type { RepositoryHistoryPageDto } from "@gitnest/contracts";

type HistoryCommit = RepositoryHistoryPageDto["page"]["commits"][number];

export interface HistoryGraphRow {
  lane: number;
  color: string;
  paths: { d: string; color: string }[];
  boundary: string | undefined;
}

const COLORS = [
  "var(--blue)",
  "var(--purple)",
  "var(--green)",
  "var(--yellow)",
  "var(--accent)",
  "var(--red)"
];

export const HISTORY_GRAPH_ROW_HEIGHT = 32;
const MIDPOINT = HISTORY_GRAPH_ROW_HEIGHT / 2;
const LANE_WIDTH = 16;
const laneX = (lane: number) => 16 + lane * LANE_WIDTH;

/**
 * Reserve lanes for visible neighbours, keeping the first parent in the
 * current lane where possible. Only direct parent relationships form edges.
 * Treating an edge's earlier endpoint as its start also handles clock skew
 * without changing the order or pagination returned by Git.
 */
export function buildHistoryGraph(commits: readonly HistoryCommit[]): {
  rows: HistoryGraphRow[];
  width: number;
} {
  const positions = new Map(commits.map((commit, index) => [commit.hash, index]));
  const neighbours = new Map(commits.map((commit) => [commit.hash, new Set<string>()]));
  for (const commit of commits) {
    for (const parent of commit.parentHashes) {
      if (parent !== commit.hash && positions.has(parent)) {
        neighbours.get(commit.hash)!.add(parent);
        neighbours.get(parent)!.add(commit.hash);
      }
    }
  }

  const lanes: ({ hash: string; color: string } | undefined)[] = [];
  let nextColor = 0;
  let maxLanes = 1;
  const allocateColor = () => COLORS[nextColor++ % COLORS.length]!;
  const availableLane = () => {
    const empty = lanes.findIndex((lane) => !lane);
    return empty < 0 ? lanes.length : empty;
  };
  const rows = commits.map((commit, index): HistoryGraphRow => {
    const incomingLane = lanes.findIndex((lane) => lane?.hash === commit.hash);
    const lane = incomingLane < 0
      ? commit.stashRef ? Math.max(1, availableLane()) : availableLane()
      : incomingLane;
    const color = commit.stashRef
      ? "var(--history-stash-color)"
      : lanes[lane]?.color ?? allocateColor();
    const paths: HistoryGraphRow["paths"] = [];

    lanes.forEach((entry, slot) => {
      if (!entry) return;
      paths.push({
        d: `M ${laneX(slot)} 0 V ${slot === lane ? MIDPOINT : HISTORY_GRAPH_ROW_HEIGHT}`,
        color: entry.color
      });
    });
    lanes[lane] = undefined;

    // Prefer the actual first parent over children that happen to be earlier
    // in date order, so ordinary topological histories keep a straight spine.
    const future = [...neighbours.get(commit.hash)!]
      .filter((hash) => positions.get(hash)! > index)
      .sort((left, right) => {
        const leftParent = commit.parentHashes.indexOf(left);
        const rightParent = commit.parentHashes.indexOf(right);
        return (leftParent < 0 ? Infinity : leftParent)
          - (rightParent < 0 ? Infinity : rightParent);
      });
    future.forEach((hash, parentIndex) => {
      let targetLane = lanes.findIndex((entry) => entry?.hash === hash);
      if (
        !commit.stashRef
        && targetLane > lane
        && !lanes[lane]
        && hash === commit.parentHashes[0]
      ) {
        // When the main line reaches an ancestor already reserved by a
        // side branch, bring that reservation back into the left-hand lane.
        // Keep the side branch's incoming edge and the main line's colour.
        const incoming = paths.find((path) =>
          path.d === `M ${laneX(targetLane)} 0 V ${HISTORY_GRAPH_ROW_HEIGHT}`
        );
        if (incoming) {
          incoming.d = `M ${laneX(targetLane)} 0 V ${MIDPOINT} C ${laneX(targetLane)} 24, ${laneX(lane)} 24, ${laneX(lane)} ${HISTORY_GRAPH_ROW_HEIGHT}`;
        }
        lanes[targetLane] = undefined;
        targetLane = lane;
        lanes[lane] = { hash, color };
      }
      if (targetLane < 0) {
        targetLane = !commit.stashRef && parentIndex === 0 && !lanes[lane] ? lane : availableLane();
        lanes[targetLane] = {
          hash,
          color: !commit.stashRef && parentIndex === 0 ? color : allocateColor()
        };
      }
      const targetColor = commit.stashRef ? color : lanes[targetLane]!.color;
      paths.push({
        d: targetLane === lane
          ? `M ${laneX(lane)} ${MIDPOINT} V ${HISTORY_GRAPH_ROW_HEIGHT}`
          : `M ${laneX(lane)} ${MIDPOINT} C ${laneX(lane)} 24, ${laneX(targetLane)} 24, ${laneX(targetLane)} ${HISTORY_GRAPH_ROW_HEIGHT}`,
        color: targetColor
      });
    });

    const hasMissingParent = commit.parentHashes.some((hash) => !positions.has(hash));
    // A short dashed end denotes a parent outside this page/search. Never
    // connect neighbouring search results merely because they are adjacent.
    const boundary = !hasMissingParent
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
