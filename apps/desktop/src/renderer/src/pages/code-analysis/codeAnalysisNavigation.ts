import type {
  CodeGraphNodeDto,
  CodeRequestChainDto
} from "@gitnest/contracts";

const SEARCHABLE_NODE_KINDS = new Set([
  "file",
  "module",
  "package",
  "class",
  "interface",
  "enum",
  "property",
  "function",
  "method",
  "client-request",
  "server-endpoint",
  "rpc-client",
  "rpc-handler"
]);
const QUALIFIED_NODE_DISPLAY_KINDS = new Set<
  CodeGraphNodeDto["kind"]
>(["class", "interface", "enum", "property"]);
export const MAX_VISIBLE_REQUEST_CHAINS = 250;
export const MAX_VISIBLE_CODE_NODES = 120;
const MAX_CHAIN_FILTER_SCAN = 5_000;
const MAX_CHAIN_SEARCH_NODES = 20_000;
const MAX_CHAIN_NODE_IDS = 64;
const MAX_CHAIN_QUERY_LENGTH = 256;

export interface FilteredCodeChains {
  chains: CodeRequestChainDto[];
  truncated: boolean;
}

export interface FilteredCodeNodes {
  nodes: CodeGraphNodeDto[];
  truncated: boolean;
}

export function codeNodeDisplayName(
  node: Pick<
    CodeGraphNodeDto,
    "kind" | "name" | "qualifiedName"
  >
): string {
  const qualifiedName = node.qualifiedName.trim();
  return QUALIFIED_NODE_DISPLAY_KINDS.has(node.kind) &&
    qualifiedName &&
    qualifiedName !== node.name
    ? qualifiedName
    : node.name;
}

export function deduplicateRequestChains(
  chains: CodeRequestChainDto[]
): CodeRequestChainDto[] {
  const seen = new Set<string>();
  return chains.filter((chain) => {
    if (seen.has(chain.id)) {
      return false;
    }
    seen.add(chain.id);
    return true;
  });
}

export function filterChains(
  chains: CodeRequestChainDto[],
  nodes: CodeGraphNodeDto[],
  query: string,
  method: string,
  limit = MAX_VISIBLE_REQUEST_CHAINS
): CodeRequestChainDto[] {
  return filterChainsWithMetadata(
    chains,
    nodes,
    query,
    method,
    limit
  ).chains;
}

export function filterChainsWithMetadata(
  chains: CodeRequestChainDto[],
  nodes: CodeGraphNodeDto[],
  query: string,
  method: string,
  limit = MAX_VISIBLE_REQUEST_CHAINS
): FilteredCodeChains {
  const normalized = normalizeSearchText(query).slice(
    0,
    MAX_CHAIN_QUERY_LENGTH
  );
  const safeLimit = Math.max(0, limit);
  const nodeById = new Map(
    nodes
      .slice(0, MAX_CHAIN_SEARCH_NODES)
      .map((node) => [node.id, node])
  );
  const filtered: CodeRequestChainDto[] = [];
  const scanCount = Math.min(
    chains.length,
    MAX_CHAIN_FILTER_SCAN
  );
  let truncated = chains.length > scanCount;

  for (let index = 0; index < scanCount; index += 1) {
    const chain = chains[index];
    if (!chain) {
      continue;
    }
    if (method !== "all" && chain.method !== method) {
      continue;
    }
    if (
      normalized &&
      !chainSearchText(chain, nodeById).includes(normalized)
    ) {
      continue;
    }
    if (filtered.length >= safeLimit) {
      truncated = true;
      break;
    }
    filtered.push(chain);
  }

  return {
    chains: filtered,
    truncated
  };
}

export function searchCodeNodes(
  nodes: CodeGraphNodeDto[],
  query: string,
  limit = MAX_VISIBLE_CODE_NODES
): CodeGraphNodeDto[] {
  return searchCodeNodesWithMetadata(nodes, query, limit).nodes;
}

export function searchCodeNodesWithMetadata(
  nodes: CodeGraphNodeDto[],
  query: string,
  limit = MAX_VISIBLE_CODE_NODES
): FilteredCodeNodes {
  const normalized = normalizeSearchText(query);
  const safeLimit = Math.max(0, Math.floor(limit));
  const ranked: NodeSearchResult[] = [];
  let matchCount = 0;

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node || !SEARCHABLE_NODE_KINDS.has(node.kind)) {
      continue;
    }
    const result = {
      node,
      index,
      score: nodeSearchScore(node, normalized)
    };
    if (result.score === Number.POSITIVE_INFINITY) {
      continue;
    }
    matchCount += 1;
    if (safeLimit === 0) {
      continue;
    }

    let low = 0;
    let high = ranked.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const existing = ranked[middle];
      if (
        existing &&
        compareNodeSearchResults(result, existing) >= 0
      ) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    if (low >= safeLimit) {
      continue;
    }
    ranked.splice(low, 0, result);
    if (ranked.length > safeLimit) {
      ranked.pop();
    }
  }

  return {
    nodes: ranked.map((result) => result.node),
    truncated: matchCount > safeLimit
  };
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

interface NodeSearchResult {
  node: CodeGraphNodeDto;
  index: number;
  score: number;
}

function compareNodeSearchResults(
  left: NodeSearchResult,
  right: NodeSearchResult
): number {
  return (
    left.score - right.score ||
    Number(right.node.changed) -
      Number(left.node.changed) ||
    nodeKindRank(left.node) - nodeKindRank(right.node) ||
    left.node.name.localeCompare(right.node.name, "zh-CN") ||
    left.node.location.path.localeCompare(
      right.node.location.path,
      "zh-CN"
    ) ||
    left.node.location.line - right.node.location.line ||
    left.index - right.index
  );
}

function nodeKindRank(node: CodeGraphNodeDto): number {
  return {
    "client-request": 0,
    "server-endpoint": 1,
    "rpc-client": 2,
    "rpc-handler": 3,
    function: 4,
    method: 5,
    class: 6,
    interface: 7,
    enum: 8,
    property: 9,
    module: 10,
    package: 11,
    file: 12
  }[node.kind];
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function chainSearchText(
  chain: CodeRequestChainDto,
  nodeById: ReadonlyMap<string, CodeGraphNodeDto>
): string {
  return [
    chain.profileId,
    chain.transport,
    chain.operationKey,
    chain.method,
    chain.route,
    chain.title,
    ...chain.nodeIds
      .slice(0, MAX_CHAIN_NODE_IDS)
      .flatMap((nodeId) => {
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
}
