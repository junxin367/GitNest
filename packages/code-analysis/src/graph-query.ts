import type {
  AnalysisConfidence,
  CodeAnalysisDiagnostic,
  CodeAnalysisDiagnosticKind,
  CodeAnalysisSnapshot,
  CodeGraphEdge,
  CodeGraphEdgeKind,
  CodeGraphNode,
  CodeGraphNodeKind,
  CodeRequestChain
} from "./model";

/**
 * Pure query helpers over an already built snapshot.
 *
 * The desktop renderer and the MCP server both consume these
 * functions so that "what the graph says" has exactly one
 * definition. Nothing here touches the file system, Electron or
 * React, and nothing mutates the snapshot.
 */

export const DEFAULT_SUBGRAPH_DEPTH = 2;
export const DEFAULT_SUBGRAPH_MAX_NODES = 400;
export const DEFAULT_SUBGRAPH_MAX_EDGES = 800;
export const DEFAULT_NODE_SEARCH_LIMIT = 50;
export const DEFAULT_CHAIN_LIMIT = 50;
export const DEFAULT_DIAGNOSTIC_LIMIT = 100;
export const DEFAULT_IMPACT_MAX_NODES = 300;
export const MAX_QUERY_LENGTH = 256;

export type GraphDirection = "out" | "in" | "both";

export type SubgraphTruncationReason =
  | "max-nodes"
  | "max-edges"
  | "max-depth";

export interface SubgraphOptions {
  nodeIds: readonly string[];
  direction?: GraphDirection;
  depth?: number;
  edgeKinds?: readonly CodeGraphEdgeKind[];
  nodeKinds?: readonly CodeGraphNodeKind[];
  maxNodes?: number;
  maxEdges?: number;
}

export interface CodeSubgraph {
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  truncated: boolean;
  truncationReasons: SubgraphTruncationReason[];
  /** Nodes that matched the seed list but were not reachable. */
  unknownNodeIds: string[];
}

export interface NodeSearchFilter {
  query?: string;
  kinds?: readonly CodeGraphNodeKind[];
  languages?: readonly string[];
  changedOnly?: boolean;
  pathPrefix?: string;
  repositoryId?: string;
  limit?: number;
}

export interface NodeSearchResult {
  nodes: CodeGraphNode[];
  truncated: boolean;
  totalMatches: number;
}

export interface RequestChainFilter {
  query?: string;
  method?: string;
  transport?: "http" | "rpc";
  changedOnly?: boolean;
  ambiguousOnly?: boolean;
  limit?: number;
}

export interface RequestChainSearchResult {
  chains: CodeRequestChain[];
  truncated: boolean;
  totalMatches: number;
}

export interface RequestChainReference {
  chainId?: string;
  nodeId?: string;
  route?: string;
  method?: string;
  query?: string;
}

export interface RequestChainResolution {
  chain?: CodeRequestChain;
  /** Populated when the reference matches more than one chain. */
  candidates: CodeRequestChain[];
}

export interface RequestChainStep {
  node: CodeGraphNode;
  /** Edge leading into this node; absent for the first step. */
  incomingEdge?: CodeGraphEdge;
  confidence: AnalysisConfidence;
}

export interface DiagnosticFilter {
  kinds?: readonly CodeAnalysisDiagnosticKind[];
  severity?: "info" | "warning";
  limit?: number;
}

export interface DiagnosticSearchResult {
  diagnostics: CodeAnalysisDiagnostic[];
  truncated: boolean;
  totalMatches: number;
}

export interface ImpactOptions {
  nodeIds?: readonly string[];
  changedPaths?: readonly string[];
  direction?: GraphDirection;
  depth?: number;
  edgeKinds?: readonly CodeGraphEdgeKind[];
  maxNodes?: number;
  maxEdges?: number;
}

export interface ImpactSummary {
  changedNodes: CodeGraphNode[];
  subgraph: CodeSubgraph;
  /** Request chains that contain at least one impacted node. */
  affectedChains: CodeRequestChain[];
  /** Nodes that cross an HTTP or RPC boundary inside the subgraph. */
  crossBoundaryEdges: CodeGraphEdge[];
  upstreamEntries: CodeGraphNode[];
  downstreamTargets: CodeGraphNode[];
}

export function collectSubgraph(
  snapshot: Pick<CodeAnalysisSnapshot, "nodes" | "edges">,
  options: SubgraphOptions
): CodeSubgraph {
  const nodeById = new Map(
    snapshot.nodes.map((node) => [node.id, node])
  );
  const depth = clampInteger(options.depth, DEFAULT_SUBGRAPH_DEPTH, 0, 12);
  const maxNodes = clampInteger(
    options.maxNodes,
    DEFAULT_SUBGRAPH_MAX_NODES,
    1,
    5_000
  );
  const maxEdges = clampInteger(
    options.maxEdges,
    DEFAULT_SUBGRAPH_MAX_EDGES,
    0,
    10_000
  );
  const edgeKindFilter = toKindSet(options.edgeKinds);
  const nodeKindFilter = toKindSet(options.nodeKinds);
  const direction = options.direction ?? "both";
  const adjacency = buildAdjacency(snapshot.edges, direction);

  const unknownNodeIds: string[] = [];
  const visited = new Set<string>();
  const selectedEdges = new Map<string, CodeGraphEdge>();
  const queue: Array<{ id: string; depth: number }> = [];
  let truncated = false;
  let hitDepthLimit = false;

  for (const nodeId of options.nodeIds) {
    const node = nodeById.get(nodeId);
    if (!node) {
      unknownNodeIds.push(nodeId);
      continue;
    }
    if (nodeKindFilter && !nodeKindFilter.has(node.kind)) {
      continue;
    }
    if (visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);
    queue.push({ id: nodeId, depth: 0 });
  }

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current) {
      continue;
    }
    for (const link of adjacency.get(current.id) ?? []) {
      const edge = link.edge;
      if (edgeKindFilter && !edgeKindFilter.has(edge.kind)) {
        continue;
      }
      const neighbour = nodeById.get(link.neighbourId);
      if (!neighbour) {
        continue;
      }
      if (nodeKindFilter && !nodeKindFilter.has(neighbour.kind)) {
        continue;
      }
      if (selectedEdges.size < maxEdges) {
        selectedEdges.set(edge.id, edge);
      } else {
        truncated = true;
      }
      if (visited.has(neighbour.id)) {
        continue;
      }
      if (current.depth >= depth) {
        hitDepthLimit = true;
        truncated = true;
        continue;
      }
      if (visited.size >= maxNodes) {
        truncated = true;
        continue;
      }
      visited.add(neighbour.id);
      queue.push({ id: neighbour.id, depth: current.depth + 1 });
    }
  }

  const reasons: SubgraphTruncationReason[] = [];
  if (visited.size >= maxNodes) {
    reasons.push("max-nodes");
  }
  if (selectedEdges.size >= maxEdges && truncated) {
    reasons.push("max-edges");
  }
  if (hitDepthLimit) {
    reasons.push("max-depth");
  }

  const nodes = snapshot.nodes.filter((node) =>
    visited.has(node.id)
  );
  const edges = [...selectedEdges.values()].filter(
    (edge) => visited.has(edge.from) && visited.has(edge.to)
  );

  return {
    nodes,
    edges,
    truncated: truncated || reasons.length > 0,
    truncationReasons: reasons,
    unknownNodeIds
  };
}

export function searchGraphNodes(
  snapshot: Pick<CodeAnalysisSnapshot, "nodes">,
  filter: NodeSearchFilter = {}
): NodeSearchResult {
  const limit = clampInteger(
    filter.limit,
    DEFAULT_NODE_SEARCH_LIMIT,
    1,
    1_000
  );
  const query = normalizeText(
    (filter.query ?? "").slice(0, MAX_QUERY_LENGTH)
  );
  const pathPrefix = filter.pathPrefix
    ? normalizeText(filter.pathPrefix)
    : "";
  const kindFilter = toKindSet(filter.kinds);
  const languageFilter = filter.languages
    ? new Set(filter.languages.map((value) => value.toLowerCase()))
    : undefined;

  const scored: Array<{ node: CodeGraphNode; score: number }> = [];
  for (const node of snapshot.nodes) {
    if (kindFilter && !kindFilter.has(node.kind)) {
      continue;
    }
    if (
      languageFilter &&
      !languageFilter.has(node.language.toLowerCase())
    ) {
      continue;
    }
    if (filter.changedOnly && !node.changed) {
      continue;
    }
    if (
      filter.repositoryId &&
      node.location.repositoryId !== filter.repositoryId
    ) {
      continue;
    }
    if (
      pathPrefix &&
      !normalizeText(node.location.path).startsWith(pathPrefix)
    ) {
      continue;
    }
    const score = scoreNode(node, query);
    if (score === Number.POSITIVE_INFINITY) {
      continue;
    }
    scored.push({ node, score });
  }

  scored.sort((left, right) => {
    return (
      left.score - right.score ||
      Number(right.node.changed) - Number(left.node.changed) ||
      nodeKindRank(left.node.kind) - nodeKindRank(right.node.kind) ||
      left.node.name.localeCompare(right.node.name, "zh-CN") ||
      left.node.location.path.localeCompare(
        right.node.location.path,
        "zh-CN"
      ) ||
      left.node.location.line - right.node.location.line ||
      left.node.id.localeCompare(right.node.id)
    );
  });

  return {
    nodes: scored.slice(0, limit).map((entry) => entry.node),
    truncated: scored.length > limit,
    totalMatches: scored.length
  };
}

export function findRequestChains(
  snapshot: Pick<CodeAnalysisSnapshot, "nodes" | "requestChains">,
  filter: RequestChainFilter = {}
): RequestChainSearchResult {
  const limit = clampInteger(
    filter.limit,
    DEFAULT_CHAIN_LIMIT,
    1,
    500
  );
  const query = normalizeText(
    (filter.query ?? "").slice(0, MAX_QUERY_LENGTH)
  );
  const nodeById = new Map(
    snapshot.nodes.map((node) => [node.id, node])
  );
  const matched: CodeRequestChain[] = [];

  for (const chain of snapshot.requestChains) {
    if (filter.method && chain.method !== filter.method) {
      continue;
    }
    if (filter.transport && chain.transport !== filter.transport) {
      continue;
    }
    if (filter.changedOnly && !chain.changed) {
      continue;
    }
    if (filter.ambiguousOnly && !chain.ambiguous) {
      continue;
    }
    if (query && !chainSearchText(chain, nodeById).includes(query)) {
      continue;
    }
    matched.push(chain);
  }

  return {
    chains: matched.slice(0, limit),
    truncated: matched.length > limit,
    totalMatches: matched.length
  };
}

export function resolveRequestChain(
  snapshot: Pick<CodeAnalysisSnapshot, "nodes" | "requestChains">,
  reference: RequestChainReference
): RequestChainResolution {
  if (reference.chainId) {
    const chain = snapshot.requestChains.find(
      (candidate) => candidate.id === reference.chainId
    );
    return chain ? { chain, candidates: [] } : { candidates: [] };
  }

  const byNodeId = reference.nodeId
    ? snapshot.requestChains.filter(
        (chain) =>
          chain.clientNodeId === reference.nodeId ||
          chain.endpointNodeId === reference.nodeId ||
          chain.nodeIds.includes(reference.nodeId as string)
      )
    : undefined;
  if (byNodeId) {
    return byNodeId.length === 1
      ? { chain: byNodeId[0] as CodeRequestChain, candidates: [] }
      : { candidates: byNodeId.slice(0, 20) };
  }

  const filter: RequestChainFilter = {};
  const result = findRequestChains(snapshot, {
    ...filter,
    ...(reference.route !== undefined
      ? { query: reference.route }
      : reference.query !== undefined
        ? { query: reference.query }
        : {}),
    ...(reference.method !== undefined
      ? { method: reference.method }
      : {}),
    limit: 20
  });
  if (result.chains.length === 1) {
    return {
      chain: result.chains[0] as CodeRequestChain,
      candidates: []
    };
  }
  return { candidates: result.chains };
}

export function toRequestChainSteps(
  snapshot: Pick<CodeAnalysisSnapshot, "nodes" | "edges">,
  chain: CodeRequestChain
): RequestChainStep[] {
  const nodeById = new Map(
    snapshot.nodes.map((node) => [node.id, node])
  );
  const edgeById = new Map(
    snapshot.edges.map((edge) => [edge.id, edge])
  );
  const edgeIds = new Set(chain.edgeIds);
  const steps: RequestChainStep[] = [];

  for (const nodeId of chain.nodeIds) {
    const node = nodeById.get(nodeId);
    if (!node) {
      continue;
    }
    const incomingEdge = snapshot.edges.find(
      (edge) =>
        edgeIds.has(edge.id) &&
        edge.to === nodeId &&
        edgeById.has(edge.id)
    );
    steps.push({
      node,
      ...(incomingEdge ? { incomingEdge } : {}),
      confidence: incomingEdge
        ? incomingEdge.confidence
        : chain.confidence
    });
  }

  return steps;
}

export function listGraphDiagnostics(
  snapshot: Pick<CodeAnalysisSnapshot, "diagnostics">,
  filter: DiagnosticFilter = {}
): DiagnosticSearchResult {
  const limit = clampInteger(
    filter.limit,
    DEFAULT_DIAGNOSTIC_LIMIT,
    1,
    1_000
  );
  const kindFilter = filter.kinds ? new Set(filter.kinds) : undefined;
  const matched = (snapshot.diagnostics ?? []).filter(
    (diagnostic) =>
      (!kindFilter || kindFilter.has(diagnostic.kind)) &&
      (!filter.severity || diagnostic.severity === filter.severity)
  );

  return {
    diagnostics: matched.slice(0, limit),
    truncated: matched.length > limit,
    totalMatches: matched.length
  };
}

export function analyzeChangeImpact(
  snapshot: Pick<
    CodeAnalysisSnapshot,
    "nodes" | "edges" | "requestChains"
  >,
  options: ImpactOptions = {}
): ImpactSummary {
  const changedNodes = selectChangedNodes(snapshot.nodes, options);
  const seeds = changedNodes.map((node) => node.id);
  const subgraph = collectSubgraph(snapshot, {
    nodeIds: seeds,
    direction: options.direction ?? "both",
    depth: clampInteger(
      options.depth,
      DEFAULT_SUBGRAPH_DEPTH,
      1,
      6
    ),
    maxNodes: clampInteger(
      options.maxNodes,
      DEFAULT_IMPACT_MAX_NODES,
      1,
      2_000
    ),
    ...(options.edgeKinds ? { edgeKinds: options.edgeKinds } : {})
  });
  const impactedIds = new Set(
    subgraph.nodes.map((node) => node.id)
  );
  const affectedChains = snapshot.requestChains.filter((chain) =>
    chain.nodeIds.some((nodeId) => impactedIds.has(nodeId))
  );
  const crossBoundaryEdges = subgraph.edges.filter(
    (edge) =>
      edge.kind === "http-request" || edge.kind === "rpc-request"
  );
  const hasIncoming = new Set(subgraph.edges.map((edge) => edge.to));
  const hasOutgoing = new Set(subgraph.edges.map((edge) => edge.from));
  const upstreamEntries = subgraph.nodes.filter(
    (node) =>
      hasOutgoing.has(node.id) && !hasIncoming.has(node.id)
  );
  const downstreamTargets = subgraph.nodes.filter(
    (node) =>
      hasIncoming.has(node.id) &&
      !hasOutgoing.has(node.id) &&
      node.kind !== "client-request"
  );

  return {
    changedNodes,
    subgraph,
    affectedChains,
    crossBoundaryEdges,
    upstreamEntries: upstreamEntries.length
      ? upstreamEntries
      : subgraph.nodes.filter((node) =>
          impactedIds.has(node.id)
        ),
    downstreamTargets,
  };
}

function selectChangedNodes(
  nodes: readonly CodeGraphNode[],
  options: ImpactOptions
): CodeGraphNode[] {
  if (options.nodeIds && options.nodeIds.length > 0) {
    const wanted = new Set(options.nodeIds);
    return nodes.filter((node) => wanted.has(node.id));
  }
  const pathFilter = options.changedPaths
    ?.map((value) => normalizeText(value))
    .filter(Boolean);
  if (pathFilter && pathFilter.length > 0) {
    return nodes.filter((node) => {
      if (!node.changed) {
        return false;
      }
      const path = normalizeText(node.location.path);
      return pathFilter.some((candidate) => path.endsWith(candidate));
    });
  }
  return nodes.filter((node) => node.changed);
}

function buildAdjacency(
  edges: readonly CodeGraphEdge[],
  direction: GraphDirection
): Map<string, Array<{ edge: CodeGraphEdge; neighbourId: string }>> {
  const adjacency = new Map<
    string,
    Array<{ edge: CodeGraphEdge; neighbourId: string }>
  >();
  const push = (
    from: string,
    edge: CodeGraphEdge,
    neighbourId: string
  ): void => {
    const list = adjacency.get(from);
    if (list) {
      list.push({ edge, neighbourId });
      return;
    }
    adjacency.set(from, [{ edge, neighbourId }]);
  };

  for (const edge of edges) {
    if (direction === "out" || direction === "both") {
      push(edge.from, edge, edge.to);
    }
    if (direction === "in" || direction === "both") {
      push(edge.to, edge, edge.from);
    }
  }
  return adjacency;
}

function scoreNode(node: CodeGraphNode, query: string): number {
  if (!query) {
    return node.changed ? 0 : 10;
  }
  const name = normalizeText(node.name);
  const qualified = normalizeText(node.qualifiedName);
  const path = normalizeText(node.location.path);
  if (name === query) {
    return 0;
  }
  if (name.startsWith(query)) {
    return 1;
  }
  if (name.includes(query)) {
    return 2;
  }
  if (qualified.startsWith(query)) {
    return 3;
  }
  if (qualified.includes(query)) {
    return 4;
  }
  if (path.includes(query)) {
    return 5;
  }
  return Number.POSITIVE_INFINITY;
}

function chainSearchText(
  chain: CodeRequestChain,
  nodeById: ReadonlyMap<string, CodeGraphNode>
): string {
  const nodeParts: string[] = [];
  for (const nodeId of chain.nodeIds.slice(0, 64)) {
    const node = nodeById.get(nodeId);
    if (!node) {
      continue;
    }
    nodeParts.push(
      node.name,
      node.qualifiedName,
      node.location.path
    );
  }
  return normalizeText(
    [
      chain.profileId,
      chain.transport,
      chain.operationKey,
      chain.method,
      chain.route,
      chain.title,
      ...nodeParts
    ].join("\0")
  );
}

function nodeKindRank(kind: CodeGraphNodeKind): number {
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
  }[kind];
}

function toKindSet<T extends string>(
  values: readonly T[] | undefined
): Set<T> | undefined {
  return values && values.length > 0 ? new Set(values) : undefined;
}

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value);
  return Math.min(Math.max(rounded, min), max);
}
