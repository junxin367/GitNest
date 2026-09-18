import type {
  CodeGraphNodeDto,
  CodeRequestChainDto
} from "@gitnest/contracts";

const SEARCHABLE_NODE_KINDS = new Set([
  "function",
  "method",
  "client-request",
  "server-endpoint",
  "rpc-client",
  "rpc-handler"
]);

export function filterChains(
  chains: CodeRequestChainDto[],
  nodes: CodeGraphNodeDto[],
  query: string,
  method: string
): CodeRequestChainDto[] {
  const normalized = normalizeSearchText(query);
  const nodeById = new Map(
    nodes.map((node) => [node.id, node])
  );
  return chains.filter((chain) => {
    if (method !== "all" && chain.method !== method) {
      return false;
    }
    if (!normalized) {
      return true;
    }
    const searchable = [
      chain.profileId,
      chain.transport,
      chain.operationKey,
      chain.method,
      chain.route,
      chain.title,
      ...chain.nodeIds.flatMap((nodeId) => {
        const node = nodeById.get(nodeId);
        return node
          ? [
              node.name,
              node.qualifiedName,
              node.location.path
            ]
          : [];
      })
    ]
      .join("\0")
      .toLocaleLowerCase("zh-CN");
    return searchable.includes(normalized);
  });
}

export function searchCodeNodes(
  nodes: CodeGraphNodeDto[],
  query: string,
  limit = 120
): CodeGraphNodeDto[] {
  const normalized = normalizeSearchText(query);
  return nodes
    .filter((node) => SEARCHABLE_NODE_KINDS.has(node.kind))
    .map((node, index) => ({
      node,
      index,
      score: nodeSearchScore(node, normalized)
    }))
    .filter((result) => result.score < Number.POSITIVE_INFINITY)
    .sort(
      (left, right) =>
        left.score - right.score ||
        Number(right.node.changed) -
          Number(left.node.changed) ||
        nodeKindRank(left.node) - nodeKindRank(right.node) ||
        left.node.name.localeCompare(
          right.node.name,
          "zh-CN"
        ) ||
        left.node.location.path.localeCompare(
          right.node.location.path,
          "zh-CN"
        ) ||
        left.node.location.line - right.node.location.line ||
        left.index - right.index
    )
    .slice(0, Math.max(0, limit))
    .map((result) => result.node);
}

export function countSearchableCodeNodes(
  nodes: CodeGraphNodeDto[]
): number {
  return nodes.filter((node) =>
    SEARCHABLE_NODE_KINDS.has(node.kind)
  ).length;
}

function nodeSearchScore(
  node: CodeGraphNodeDto,
  query: string
): number {
  if (!query) {
    return node.changed ? 0 : 10;
  }
  const name = normalizeSearchText(node.name);
  const qualifiedName = normalizeSearchText(
    node.qualifiedName
  );
  const path = normalizeSearchText(node.location.path);
  if (name === query) {
    return 0;
  }
  if (name.startsWith(query)) {
    return 1;
  }
  if (name.includes(query)) {
    return 2;
  }
  if (qualifiedName.startsWith(query)) {
    return 3;
  }
  if (qualifiedName.includes(query)) {
    return 4;
  }
  if (path.includes(query)) {
    return 5;
  }
  return Number.POSITIVE_INFINITY;
}

function nodeKindRank(node: CodeGraphNodeDto): number {
  return {
    function: 0,
    method: 1,
    "client-request": 2,
    "rpc-client": 3,
    "server-endpoint": 4,
    "rpc-handler": 5,
    class: 6,
    file: 7
  }[node.kind];
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}
