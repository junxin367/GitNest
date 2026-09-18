import { createHash } from "node:crypto";

import type {
  AnalysisConfidence,
  CodeAnalysisScope,
  CodeGraphEdge,
  CodeGraphNode,
  CodeRequestChain,
  ParsedCall,
  ParsedRemoteBoundary,
  ParsedSourceFile
} from "./model";

interface GraphBuildResult {
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  requestChains: CodeRequestChain[];
}

interface RemoteGraphBoundary {
  node: CodeGraphNode;
  boundary: ParsedRemoteBoundary;
}

interface RemoteGraphLink {
  client: RemoteGraphBoundary;
  handler: RemoteGraphBoundary;
  edge: CodeGraphEdge;
  confidence: AnalysisConfidence;
  ambiguous: boolean;
}

export function buildCodeGraph(input: {
  files: ParsedSourceFile[];
  scope: CodeAnalysisScope;
  graphDepth: number;
}): GraphBuildResult {
  const nodes: CodeGraphNode[] = [];
  const edges: CodeGraphEdge[] = [];
  const nodeById = new Map<string, CodeGraphNode>();
  const edgeById = new Map<string, CodeGraphEdge>();
  const symbolNodesByFile = new Map<
    string,
    Map<string, CodeGraphNode>
  >();
  const symbolsByName = new Map<string, CodeGraphNode[]>();
  const symbolsByLocation = new Map<
    string,
    Array<{ line: number; node: CodeGraphNode }>
  >();
  const endpoints: CodeGraphNode[] = [];
  const requests: CodeGraphNode[] = [];
  const rpcClients: RemoteGraphBoundary[] = [];
  const rpcHandlers: RemoteGraphBoundary[] = [];

  const addNode = (node: CodeGraphNode) => {
    if (!nodeById.has(node.id)) {
      nodeById.set(node.id, node);
      nodes.push(node);
    }
    return nodeById.get(node.id) as CodeGraphNode;
  };
  const addEdge = (
    edge: Omit<CodeGraphEdge, "id">
  ): CodeGraphEdge => {
    const id = stableId(
      "edge",
      edge.from,
      edge.to,
      edge.kind,
      edge.label ?? ""
    );
    const existing = edgeById.get(id);
    if (existing) {
      if (
        confidenceRank(edge.confidence) >
        confidenceRank(existing.confidence)
      ) {
        existing.confidence = edge.confidence;
      }
      return existing;
    }
    const value: CodeGraphEdge = { id, ...edge };
    edges.push(value);
    edgeById.set(id, value);
    return value;
  };

  for (const parsed of input.files) {
    const fileNode = addNode({
      id: stableId(
        "file",
        parsed.file.repositoryId,
        parsed.file.worktreeId,
        parsed.file.relativePath
      ),
      kind: "file",
      name: fileName(parsed.file.relativePath),
      qualifiedName: parsed.file.relativePath,
      language: parsed.file.language,
      location: locationFor(parsed, 1),
      changed: parsed.file.changed,
      source: "builtin",
      confidence: "exact",
      metadata: {
        size: parsed.file.size
      }
    });
    const perFile = new Map<string, CodeGraphNode>();
    symbolNodesByFile.set(parsed.file.canonicalPath, perFile);

    for (const symbol of parsed.symbols) {
      const symbolNode = addNode({
        id: stableId(
          "symbol",
          parsed.file.repositoryId,
          parsed.file.worktreeId,
          parsed.file.relativePath,
          symbol.qualifiedName,
          String(symbol.line)
        ),
        kind: symbol.kind,
        name: symbol.name,
        qualifiedName: symbol.qualifiedName,
        language: parsed.file.language,
        location: locationFor(parsed, symbol.line),
        changed: parsed.file.changed,
        source: symbol.source,
        confidence:
          symbol.source === "builtin" ? "probable" : "exact",
        metadata: {
          endLine: symbol.endLine,
          ...(symbol.documentation
            ? { documentation: symbol.documentation }
            : {})
        }
      });
      perFile.set(symbol.qualifiedName, symbolNode);
      addNamedSymbol(symbolNode);
      const byLocation =
        symbolsByLocation.get(parsed.file.canonicalPath) ?? [];
      byLocation.push({
        line: symbol.line,
        node: symbolNode
      });
      symbolsByLocation.set(
        parsed.file.canonicalPath,
        byLocation
      );
      addEdge({
        from: fileNode.id,
        to: symbolNode.id,
        kind: "contains",
        confidence: "exact"
      });
    }

    for (const endpoint of parsed.serverEndpoints) {
      const symbolNode = endpoint.symbolQualifiedName
        ? perFile.get(endpoint.symbolQualifiedName)
        : undefined;
      const endpointNode = symbolNode
        ? convertToEndpoint(symbolNode, endpoint)
        : addNode({
            id: stableId(
              "endpoint",
              parsed.file.repositoryId,
              parsed.file.worktreeId,
              parsed.file.relativePath,
              endpoint.method,
              endpoint.route,
              String(endpoint.line)
            ),
            kind: "server-endpoint",
            name: `${endpoint.method} ${endpoint.route}`,
            qualifiedName: `${endpoint.method} ${endpoint.route}`,
            language: parsed.file.language,
            location: locationFor(parsed, endpoint.line),
            changed: parsed.file.changed,
            source: "builtin",
            confidence: "exact",
            metadata: {
              httpMethod: endpoint.method,
              route: endpoint.route,
              rawRoute: endpoint.rawRoute,
              annotation: endpoint.annotation
            }
          });
      if (!symbolNode) {
        addEdge({
          from: fileNode.id,
          to: endpointNode.id,
          kind: "contains",
          confidence: "exact"
        });
      }
      endpoints.push(endpointNode);
    }

    for (const request of parsed.clientRequests) {
      const container = request.containerQualifiedName
        ? perFile.get(request.containerQualifiedName)
        : undefined;
      const documentation =
        request.documentation ??
        (typeof container?.metadata.documentation === "string"
          ? container.metadata.documentation
          : undefined);
      const requestNode = addNode({
        id: stableId(
          "request",
          parsed.file.repositoryId,
          parsed.file.worktreeId,
          parsed.file.relativePath,
          request.method,
          request.route,
          String(request.line)
        ),
        kind: "client-request",
        name: `${request.method} ${request.route}`,
        qualifiedName: `${request.method} ${request.route}`,
        language: parsed.file.language,
        location: locationFor(parsed, request.line),
        changed: parsed.file.changed,
        source: "builtin",
        confidence: "exact",
        metadata: {
          httpMethod: request.method,
          route: request.route,
          rawRoute: request.rawRoute,
          ...(documentation ? { documentation } : {})
        }
      });
      requests.push(requestNode);
      addEdge({
        from: container?.id ?? fileNode.id,
        to: requestNode.id,
        kind: container ? "calls" : "contains",
        confidence: container ? "exact" : "probable"
      });
    }

    for (const boundary of parsed.remoteBoundaries) {
      const symbolNode = boundary.symbolQualifiedName
        ? perFile.get(boundary.symbolQualifiedName)
        : undefined;
      const boundaryNode = symbolNode
        ? convertToRemoteBoundary(symbolNode, boundary)
        : addNode({
            id: stableId(
              "remote-boundary",
              parsed.file.repositoryId,
              parsed.file.worktreeId,
              parsed.file.relativePath,
              boundary.profileId,
              boundary.role,
              boundary.operationKey,
              String(boundary.line)
            ),
            kind:
              boundary.role === "client"
                ? "rpc-client"
                : "rpc-handler",
            name: boundary.operationName,
            qualifiedName: boundary.operationKey,
            language: parsed.file.language,
            location: locationFor(parsed, boundary.line),
            changed: parsed.file.changed,
            source: "builtin",
            confidence: boundary.confidence,
            metadata: remoteBoundaryMetadata(boundary)
          });
      if (!symbolNode) {
        addNamedSymbol(boundaryNode);
        addEdge({
          from: fileNode.id,
          to: boundaryNode.id,
          kind: "contains",
          confidence: "exact"
        });
      }
      if (boundary.role === "client") {
        rpcClients.push({
          node: boundaryNode,
          boundary
        });
      } else {
        rpcHandlers.push({
          node: boundaryNode,
          boundary
        });
      }
    }
  }

  for (const parsed of input.files) {
    const perFile = symbolNodesByFile.get(
      parsed.file.canonicalPath
    );
    if (!perFile) {
      continue;
    }
    for (const symbol of parsed.symbols) {
      const sourceNode = perFile.get(symbol.qualifiedName);
      if (!sourceNode) {
        continue;
      }
      for (const call of symbol.calls) {
        const resolution = resolveCallTarget(
          call,
          sourceNode,
          parsed,
          perFile,
          symbolsByName,
          symbolsByLocation
        );
        if (!resolution) {
          continue;
        }
        addEdge({
          from: sourceNode.id,
          to: resolution.node.id,
          kind: "calls",
          confidence: resolution.confidence,
          label: call.receiver
            ? `${call.receiver}.${call.name}`
            : call.name
        });
      }
    }
  }

  const rpcLinks: RemoteGraphLink[] = [];
  const ambiguousRpcEdgeIds = new Set<string>();
  for (const client of rpcClients) {
    const matches = rpcHandlers
      .map((handler) => ({
        handler,
        confidence: remoteMatchConfidence(
          client.boundary,
          handler.boundary
        )
      }))
      .filter(
        (
          match
        ): match is {
          handler: RemoteGraphBoundary;
          confidence: AnalysisConfidence;
        } => Boolean(match.confidence)
      );
    const ambiguous = matches.length > 1;
    for (const match of matches) {
      const edge = addEdge({
        from: client.node.id,
        to: match.handler.node.id,
        kind: "rpc-request",
        confidence: match.confidence,
        label: client.boundary.operationName
      });
      if (ambiguous) {
        ambiguousRpcEdgeIds.add(edge.id);
      }
      rpcLinks.push({
        client,
        handler: match.handler,
        edge,
        confidence: match.confidence,
        ambiguous
      });
    }
  }

  const outgoingCalls = buildOutgoingCalls(edges);
  const incomingCalls = buildIncomingCalls(edges);
  const outgoingExecutionRelations =
    buildOutgoingExecutionRelations(edges);
  const requestChains: CodeRequestChain[] = [];
  for (const request of requests) {
    const matches = endpoints
      .map((endpoint) => ({
        endpoint,
        confidence: routeMatchConfidence(request, endpoint)
      }))
      .filter(
        (
          match
        ): match is {
          endpoint: CodeGraphNode;
          confidence: AnalysisConfidence;
        } => Boolean(match.confidence)
      );

    for (const match of matches) {
      const httpEdge = addEdge({
        from: request.id,
        to: match.endpoint.id,
        kind: "http-request",
        confidence: match.confidence,
        label: `${request.metadata.httpMethod} ${request.metadata.route}`
      });
      const reachable = collectReachable(
        match.endpoint.id,
        outgoingExecutionRelations,
        input.graphDepth
      );
      const upstream = collectReachable(
        request.id,
        incomingCalls,
        input.graphDepth,
        "from"
      );
      const nodeIds = unique([
        ...upstream.nodeIds,
        request.id,
        match.endpoint.id,
        ...reachable.nodeIds
      ]);
      const edgeIds = unique([
        ...upstream.edgeIds,
        httpEdge.id,
        ...reachable.edgeIds
      ]);
      requestChains.push({
        id: stableId(
          "chain",
          "web-http",
          request.id,
          match.endpoint.id
        ),
        profileId: "web-http",
        transport: "http",
        operationKey: `${request.metadata.httpMethod} ${request.metadata.route}`,
        method: String(request.metadata.httpMethod),
        route: String(request.metadata.route),
        title: `${request.metadata.httpMethod} ${request.metadata.route}`,
        clientNodeId: request.id,
        endpointNodeId: match.endpoint.id,
        nodeIds,
        edgeIds,
        changed: nodeIds.some(
          (nodeId) => nodeById.get(nodeId)?.changed
        ),
        ambiguous:
          matches.length > 1 ||
          reachable.edgeIds.some((edgeId) =>
            ambiguousRpcEdgeIds.has(edgeId)
          ),
        confidence: match.confidence
      });
    }
  }

  for (const link of rpcLinks) {
    const reachable = collectReachable(
      link.handler.node.id,
      outgoingCalls,
      input.graphDepth
    );
    const upstream = collectReachable(
      link.client.node.id,
      incomingCalls,
      input.graphDepth,
      "from"
    );
    const nodeIds = unique([
      ...upstream.nodeIds,
      link.client.node.id,
      link.handler.node.id,
      ...reachable.nodeIds
    ]);
    const edgeIds = unique([
      ...upstream.edgeIds,
      link.edge.id,
      ...reachable.edgeIds
    ]);
    const rawOperation = link.client.boundary.rawOperation;
    requestChains.push({
      id: stableId(
        "chain",
        link.client.boundary.profileId,
        link.client.node.id,
        link.handler.node.id
      ),
      profileId: link.client.boundary.profileId,
      transport: link.client.boundary.transport,
      operationKey: link.client.boundary.operationKey,
      method: "RPC",
      route: rawOperation,
      title: `RPC ${rawOperation}`,
      clientNodeId: link.client.node.id,
      endpointNodeId: link.handler.node.id,
      nodeIds,
      edgeIds,
      changed: nodeIds.some(
        (nodeId) => nodeById.get(nodeId)?.changed
      ),
      ambiguous: link.ambiguous,
      confidence: link.confidence
    });
  }

  if (input.scope === "changed") {
    return filterChangedGraph({
      nodes,
      edges,
      requestChains
    });
  }

  return {
    nodes,
    edges,
    requestChains
  };

  function addNamedSymbol(node: CodeGraphNode): void {
    for (const name of new Set([
      node.name,
      node.qualifiedName
    ])) {
      const current = symbolsByName.get(name) ?? [];
      current.push(node);
      symbolsByName.set(name, current);
    }
  }

  function convertToEndpoint(
    node: CodeGraphNode,
    endpoint: {
      method: string;
      route: string;
      rawRoute: string;
      annotation: string;
    }
  ): CodeGraphNode {
    node.kind = "server-endpoint";
    node.metadata = {
      ...node.metadata,
      httpMethod: endpoint.method,
      route: endpoint.route,
      rawRoute: endpoint.rawRoute,
      annotation: endpoint.annotation
    };
    return node;
  }

  function convertToRemoteBoundary(
    node: CodeGraphNode,
    boundary: ParsedSourceFile["remoteBoundaries"][number]
  ): CodeGraphNode {
    node.kind =
      boundary.role === "client"
        ? "rpc-client"
        : "rpc-handler";
    node.confidence = strongerConfidence(
      node.confidence,
      boundary.confidence
    );
    node.metadata = {
      ...node.metadata,
      ...remoteBoundaryMetadata(boundary)
    };
    return node;
  }
}

function confidenceRank(
  confidence: AnalysisConfidence
): number {
  return {
    heuristic: 0,
    probable: 1,
    exact: 2
  }[confidence];
}

function buildOutgoingCalls(
  edges: CodeGraphEdge[]
): Map<string, CodeGraphEdge[]> {
  const outgoing = new Map<string, CodeGraphEdge[]>();
  for (const edge of edges) {
    if (edge.kind !== "calls") {
      continue;
    }
    const current = outgoing.get(edge.from) ?? [];
    current.push(edge);
    outgoing.set(edge.from, current);
  }
  return outgoing;
}

function buildOutgoingExecutionRelations(
  edges: CodeGraphEdge[]
): Map<string, CodeGraphEdge[]> {
  const outgoing = new Map<string, CodeGraphEdge[]>();
  for (const edge of edges) {
    if (
      edge.kind !== "calls" &&
      edge.kind !== "rpc-request"
    ) {
      continue;
    }
    const current = outgoing.get(edge.from) ?? [];
    current.push(edge);
    outgoing.set(edge.from, current);
  }
  return outgoing;
}

function buildIncomingCalls(
  edges: CodeGraphEdge[]
): Map<string, CodeGraphEdge[]> {
  const incoming = new Map<string, CodeGraphEdge[]>();
  for (const edge of edges) {
    if (edge.kind !== "calls") {
      continue;
    }
    const current = incoming.get(edge.to) ?? [];
    current.push(edge);
    incoming.set(edge.to, current);
  }
  return incoming;
}

function resolveCallTarget(
  call: ParsedCall,
  sourceNode: CodeGraphNode,
  parsed: ParsedSourceFile,
  perFile: Map<string, CodeGraphNode>,
  symbolsByName: Map<string, CodeGraphNode[]>,
  symbolsByLocation: Map<
    string,
    Array<{ line: number; node: CodeGraphNode }>
  >
):
  | {
      node: CodeGraphNode;
      confidence: AnalysisConfidence;
    }
  | undefined {
  if (call.targetCanonicalPath) {
    const targetSymbols =
      symbolsByLocation.get(call.targetCanonicalPath) ?? [];
    const namedTargets = targetSymbols.filter(
      ({ node }) => node.name === call.name
    );
    if (call.targetLine !== undefined) {
      const located = closestSymbolAtLine(
        namedTargets.length > 0
          ? namedTargets
          : targetSymbols,
        call.targetLine
      );
      if (located) {
        return {
          node: located,
          confidence: "exact"
        };
      }
    }
    if (namedTargets.length === 1) {
      return {
        node: namedTargets[0]?.node as CodeGraphNode,
        confidence: "exact"
      };
    }
    return undefined;
  }
  const { name, receiver } = call;
  if (receiver && call.receiverType) {
    const typedCandidates = (
      symbolsByName.get(name) ?? []
    ).filter(
      (candidate) =>
        candidate.id !== sourceNode.id &&
        languageFamily(candidate.language) ===
          languageFamily(parsed.file.language)
    );
    const typedMatches = bestReceiverMatches(
      call.receiverType,
      typedCandidates,
      sourceNode
    );
    if (typedMatches.length === 1) {
      return {
        node: typedMatches[0] as CodeGraphNode,
        confidence: "probable"
      };
    }
  }
  if (receiver) {
    const direct = perFile.get(`${receiver}.${name}`);
    if (direct) {
      return { node: direct, confidence: "exact" };
    }
  }

  const local = [...perFile.values()].filter(
    (node) =>
      node.name === name &&
      node.id !== sourceNode.id
  );
  if (
    local.length === 1 &&
    allowsLocalNameFallback(receiver, sourceNode)
  ) {
    return {
      node: local[0] as CodeGraphNode,
      confidence: "probable"
    };
  }

  const candidates = (symbolsByName.get(name) ?? []).filter(
    (candidate) => candidate.id !== sourceNode.id
  );
  const compatibleLanguage = candidates.filter(
    (candidate) =>
      languageFamily(candidate.language) ===
      languageFamily(parsed.file.language)
  );
  if (receiver) {
    const receiverMatches = bestReceiverMatches(
      receiver,
      compatibleLanguage,
      sourceNode
    );
    if (receiverMatches.length === 1) {
      return {
        node: receiverMatches[0] as CodeGraphNode,
        confidence: "probable"
      };
    }
    return undefined;
  }
  if (compatibleLanguage.length === 1) {
    return {
      node: compatibleLanguage[0] as CodeGraphNode,
      confidence: "heuristic"
    };
  }
  return undefined;
}

function allowsLocalNameFallback(
  receiver: string | undefined,
  sourceNode: CodeGraphNode
): boolean {
  if (!receiver) {
    return true;
  }
  if (receiver === "this" || receiver === "super") {
    return true;
  }
  const owner = symbolOwner(sourceNode);
  return Boolean(
    owner &&
      normalizeSymbolName(receiver) ===
        normalizeSymbolName(owner)
  );
}

function bestReceiverMatches(
  receiver: string,
  candidates: CodeGraphNode[],
  sourceNode: CodeGraphNode
): CodeGraphNode[] {
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      rank: receiverOwnerRank(receiver, symbolOwner(candidate))
    }))
    .filter(({ rank }) => rank > 0);
  const bestRank = Math.max(
    0,
    ...ranked.map(({ rank }) => rank)
  );
  const ownerMatches = ranked
    .filter(({ rank }) => rank === bestRank)
    .map(({ candidate }) => candidate);
  if (ownerMatches.length <= 1) {
    return ownerMatches;
  }
  const sourceModule = sourceModulePath(sourceNode.location.path);
  if (!sourceModule) {
    return ownerMatches;
  }
  const localMatches = ownerMatches.filter(
    (candidate) =>
      candidate.location.repositoryId ===
        sourceNode.location.repositoryId &&
      candidate.location.worktreeId ===
        sourceNode.location.worktreeId &&
      sourceModulePath(candidate.location.path) === sourceModule
  );
  return localMatches.length > 0
    ? localMatches
    : ownerMatches;
}

function sourceModulePath(path: string): string | undefined {
  const normalized = path
    .replaceAll("\\", "/")
    .toLocaleLowerCase("en-US");
  const sourceDirectoryIndex = normalized.indexOf("/src/");
  return sourceDirectoryIndex > 0
    ? normalized.slice(0, sourceDirectoryIndex)
    : undefined;
}

function receiverOwnerRank(
  receiver: string,
  owner: string | undefined
): number {
  if (!owner) {
    return 0;
  }
  const normalizedReceiver = normalizeSymbolName(receiver);
  const normalizedOwner = normalizeSymbolName(owner);
  if (normalizedReceiver === normalizedOwner) {
    return 2;
  }
  return normalizedOwner.endsWith("impl") &&
    normalizedReceiver === normalizedOwner.slice(0, -4)
    ? 1
    : 0;
}

function symbolOwner(
  node: Pick<CodeGraphNode, "qualifiedName">
): string | undefined {
  const separator = node.qualifiedName.lastIndexOf(".");
  if (separator <= 0) {
    return undefined;
  }
  return node.qualifiedName
    .slice(0, separator)
    .split(".")
    .at(-1);
}

function normalizeSymbolName(value: string): string {
  return value
    .replace(/[^A-Za-z0-9_$]/g, "")
    .toLocaleLowerCase("en-US");
}

function languageFamily(
  language: CodeGraphNode["language"]
): "java" | "javascript-like" {
  return language === "java" ? "java" : "javascript-like";
}

function closestSymbolAtLine(
  candidates: Array<{
    line: number;
    node: CodeGraphNode;
  }>,
  targetLine: number
): CodeGraphNode | undefined {
  return candidates
    .map((candidate) => ({
      ...candidate,
      distance: Math.abs(candidate.line - targetLine)
    }))
    .filter((candidate) => candidate.distance <= 2)
    .sort(
      (left, right) =>
        left.distance - right.distance
    )[0]?.node;
}

function routeMatchConfidence(
  request: CodeGraphNode,
  endpoint: CodeGraphNode
): AnalysisConfidence | undefined {
  const requestMethod = String(
    request.metadata.httpMethod ?? ""
  );
  const endpointMethod = String(
    endpoint.metadata.httpMethod ?? ""
  );
  if (
    endpointMethod !== "ANY" &&
    requestMethod !== endpointMethod
  ) {
    return undefined;
  }
  const requestRoute = String(request.metadata.route ?? "");
  const endpointRoute = String(endpoint.metadata.route ?? "");
  const requestShape = routeShape(requestRoute);
  const endpointShape = routeShape(endpointRoute);
  if (requestShape === endpointShape) {
    return endpointMethod === "ANY" ? "probable" : "exact";
  }
  const requestSegments = routeSegments(requestShape);
  const endpointSegments = routeSegments(endpointShape);
  const shorter =
    requestSegments.length < endpointSegments.length
      ? requestSegments
      : endpointSegments;
  const longer =
    requestSegments.length < endpointSegments.length
      ? endpointSegments
      : requestSegments;
  if (
    shorter.length >= 2 &&
    longer.slice(-shorter.length).join("/") ===
      shorter.join("/")
  ) {
    return "heuristic";
  }
  return undefined;
}

function remoteMatchConfidence(
  client: ParsedRemoteBoundary,
  handler: ParsedRemoteBoundary
): AnalysisConfidence | undefined {
  if (
    client.profileId !== handler.profileId ||
    client.transport !== handler.transport ||
    client.role !== "client" ||
    handler.role !== "server" ||
    client.operationKey !== handler.operationKey
  ) {
    return undefined;
  }
  return client.confidence === "exact" &&
    handler.confidence === "exact"
    ? "exact"
    : "probable";
}

function routeShape(route: string): string {
  return route
    .replace(/:[^/]+/g, ":param")
    .replace(/\{[^/}]+\}/g, ":param")
    .toLocaleLowerCase("en-US");
}

function routeSegments(route: string): string[] {
  return route.split("/").filter(Boolean);
}

function collectReachable(
  rootId: string,
  outgoingCalls: Map<string, CodeGraphEdge[]>,
  depthLimit: number,
  direction: "to" | "from" = "to"
): { nodeIds: string[]; edgeIds: string[] } {
  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  const visited = new Set([rootId]);
  let frontier = [rootId];

  for (
    let depth = 0;
    depth < depthLimit && frontier.length > 0;
    depth += 1
  ) {
    const next: string[] = [];
    for (const source of frontier) {
      for (const edge of outgoingCalls.get(source) ?? []) {
        const target =
          direction === "to" ? edge.to : edge.from;
        if (visited.has(target)) {
          continue;
        }
        visited.add(target);
        next.push(target);
        nodeIds.push(target);
        edgeIds.push(edge.id);
      }
    }
    frontier = next;
  }
  return { nodeIds, edgeIds };
}

function filterChangedGraph(
  graph: GraphBuildResult
): GraphBuildResult {
  const changed = new Set(
    graph.nodes
      .filter((node) => node.changed)
      .map((node) => node.id)
  );
  const included = new Set(changed);
  for (const chain of graph.requestChains) {
    if (chain.changed) {
      for (const nodeId of chain.nodeIds) {
        included.add(nodeId);
      }
    }
  }
  for (const edge of graph.edges) {
    if (changed.has(edge.from) || changed.has(edge.to)) {
      included.add(edge.from);
      included.add(edge.to);
    }
  }
  const edges = graph.edges.filter(
    (edge) =>
      included.has(edge.from) && included.has(edge.to)
  );
  const edgeIds = new Set(edges.map((edge) => edge.id));
  return {
    nodes: graph.nodes.filter((node) => included.has(node.id)),
    edges,
    requestChains: graph.requestChains.filter(
      (chain) =>
        chain.changed &&
        chain.edgeIds.every((edgeId) => edgeIds.has(edgeId))
    )
  };
}

function locationFor(
  parsed: ParsedSourceFile,
  line: number
) {
  return {
    repositoryId: parsed.file.repositoryId,
    worktreeId: parsed.file.worktreeId,
    path: parsed.file.relativePath,
    line,
    column: 1
  };
}

function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function stableId(
  kind: string,
  ...parts: string[]
): string {
  return `${kind}_${createHash("sha256")
    .update(parts.join("\0"))
    .digest("hex")
    .slice(0, 20)}`;
}

function remoteBoundaryMetadata(
  boundary: ParsedSourceFile["remoteBoundaries"][number]
): Readonly<Record<string, string | number | boolean>> {
  return {
    profileId: boundary.profileId,
    transport: boundary.transport,
    role: boundary.role,
    operationKey: boundary.operationKey,
    operationName: boundary.operationName,
    serviceKey: boundary.serviceKey,
    rawOperation: boundary.rawOperation,
    wrapperId: boundary.wrapperId,
    bindingConfidence: boundary.confidence
  };
}

function strongerConfidence(
  left: AnalysisConfidence,
  right: AnalysisConfidence
): AnalysisConfidence {
  return confidenceRank(left) >= confidenceRank(right)
    ? left
    : right;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
