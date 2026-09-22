import { createHash } from "node:crypto";

import type {
  AnalysisConfidence,
  CodeAnalysisDiagnostic,
  CodeAnalysisScope,
  CodeGraphEdge,
  CodeGraphNode,
  CodeRequestChain,
  ParsedCall,
  ParsedReference,
  ParsedRemoteBoundary,
  ParsedSourceFile
} from "./model";

interface GraphBuildResult {
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  requestChains: CodeRequestChain[];
  diagnostics: CodeAnalysisDiagnostic[];
  truncated: boolean;
}

interface GraphBuildLimits {
  maxNodes: number;
  maxEdges: number;
  maxRequestChains: number;
  maxDiagnostics: number;
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

interface HttpEndpointIndex {
  exactByMethodAndShape: Map<string, CodeGraphNode[]>;
  suffixByMethodAndShape: Map<string, CodeGraphNode[]>;
  orderById: Map<string, number>;
}

export function buildCodeGraph(input: {
  files: ParsedSourceFile[];
  scope: CodeAnalysisScope;
  graphDepth: number;
  limits?: Partial<GraphBuildLimits>;
}): GraphBuildResult {
  const limits: GraphBuildLimits = {
    maxNodes:
      input.limits?.maxNodes ??
      Number.MAX_SAFE_INTEGER,
    maxEdges:
      input.limits?.maxEdges ??
      Number.MAX_SAFE_INTEGER,
    maxRequestChains:
      input.limits?.maxRequestChains ??
      Number.MAX_SAFE_INTEGER,
    maxDiagnostics:
      input.limits?.maxDiagnostics ?? 2_000
  };
  const nodes: CodeGraphNode[] = [];
  const edges: CodeGraphEdge[] = [];
  const nodeById = new Map<string, CodeGraphNode>();
  const edgeById = new Map<string, CodeGraphEdge>();
  const diagnostics: CodeAnalysisDiagnostic[] = [];
  const symbolNodesByFile = new Map<
    string,
    Map<string, CodeGraphNode>
  >();
  const symbolsByName = new Map<string, CodeGraphNode[]>();
  const symbolsByLocation = new Map<
    string,
    Array<{ line: number; node: CodeGraphNode }>
  >();
  const fileNodesByPath = new Map<string, CodeGraphNode>();
  const deferredRequestEdges: Array<
    Omit<CodeGraphEdge, "id">
  > = [];
  const deferredStructuralEdges: Array<
    Omit<CodeGraphEdge, "id">
  > = [];
  const endpoints: CodeGraphNode[] = [];
  const requests: CodeGraphNode[] = [];
  const rpcClients: RemoteGraphBoundary[] = [];
  const rpcHandlers: RemoteGraphBoundary[] = [];
  const remoteBoundaryKeys = new Set<string>();
  let truncated = false;

  const addNode = (
    node: CodeGraphNode
  ): CodeGraphNode | undefined => {
    if (!nodeById.has(node.id)) {
      if (nodes.length >= limits.maxNodes) {
        truncated = true;
        return undefined;
      }
      nodeById.set(node.id, node);
      nodes.push(node);
    }
    return nodeById.get(node.id) as CodeGraphNode;
  };
  const addEdge = (
    edge: Omit<CodeGraphEdge, "id">
  ): CodeGraphEdge | undefined => {
    const source = edge.source ?? "builtin";
    const evidence =
      edge.evidence ?? defaultEdgeEvidence(edge);
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
      existing.source = mergeEdgeSource(
        existing.source,
        source
      );
      existing.evidence = mergeEvidence(
        existing.evidence,
        evidence
      );
      return existing;
    }
    if (edges.length >= limits.maxEdges) {
      truncated = true;
      return undefined;
    }
    const value: CodeGraphEdge = {
      id,
      ...edge,
      source,
      evidence
    };
    edges.push(value);
    edgeById.set(id, value);
    return value;
  };
  const addDiagnostic = (
    diagnostic: Omit<CodeAnalysisDiagnostic, "id">
  ): void => {
    if (diagnostics.length >= limits.maxDiagnostics) {
      return;
    }
    const id = stableId(
      "diagnostic",
      diagnostic.kind,
      diagnostic.nodeId ?? "",
      diagnostic.message,
      ...diagnostic.relatedNodeIds
    );
    if (diagnostics.some((item) => item.id === id)) {
      return;
    }
    diagnostics.push({ id, ...diagnostic });
  };

  const prioritySymbolsByFile = new Map<
    string,
    Set<string>
  >();
  for (const parsed of input.files) {
    const prioritySymbols = new Set<string>();
    for (const endpoint of parsed.serverEndpoints) {
      if (endpoint.symbolQualifiedName) {
        prioritySymbols.add(endpoint.symbolQualifiedName);
      }
    }
    for (const request of parsed.clientRequests) {
      if (request.containerQualifiedName) {
        prioritySymbols.add(request.containerQualifiedName);
      }
    }
    for (const boundary of parsed.remoteBoundaries) {
      if (boundary.symbolQualifiedName) {
        prioritySymbols.add(boundary.symbolQualifiedName);
      }
    }
    prioritySymbolsByFile.set(
      parsed.file.canonicalPath,
      prioritySymbols
    );
  }

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
        size: parsed.file.size,
        testCode: isTestCodePath(
          parsed.file.relativePath
        )
      }
    });
    if (!fileNode) {
      break;
    }
    fileNodesByPath.set(
      parsed.file.canonicalPath,
      fileNode
    );
    const perFile = new Map<string, CodeGraphNode>();
    symbolNodesByFile.set(parsed.file.canonicalPath, perFile);
  }

  const addSymbolNode = (
    parsed: ParsedSourceFile,
    symbol: ParsedSourceFile["symbols"][number]
  ): CodeGraphNode | undefined => {
    const perFile = symbolNodesByFile.get(
      parsed.file.canonicalPath
    );
    if (!perFile) {
      return undefined;
    }
    const symbolIdentity =
      symbol.semanticId ??
      [
        symbol.qualifiedName,
        symbol.kind,
        symbol.signature ?? "",
        String(symbol.line)
      ].join("\0");
    const symbolNode = addNode({
      id: stableId(
        "symbol",
        parsed.file.repositoryId,
        parsed.file.worktreeId,
        parsed.file.relativePath,
        symbolIdentity
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
        testCode: isTestCodePath(parsed.file.relativePath),
        ...(symbol.selectionCharacter !== undefined
          ? {
              selectionCharacter:
                symbol.selectionCharacter
            }
          : {}),
        ...(symbol.packageName
          ? { packageName: symbol.packageName }
          : {}),
        ...(symbol.signature
          ? { signature: symbol.signature }
          : {}),
        ...(symbol.semanticId
          ? { semanticId: symbol.semanticId }
          : {}),
        ...(symbol.documentation
          ? { documentation: symbol.documentation }
          : {})
      }
    });
    if (!symbolNode) {
      return undefined;
    }
    perFile.set(symbolIdentity, symbolNode);
    addNamedSymbol(symbolNode, symbol.packageName);
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
    return symbolNode;
  };
  const findSymbolNodeForDeclaration = (
    parsed: ParsedSourceFile,
    qualifiedName: string,
    line: number
  ): CodeGraphNode | undefined => {
    let closest:
      | {
          distance: number;
          line: number;
          node: CodeGraphNode;
        }
      | undefined;
    for (const candidate of
      symbolsByLocation.get(parsed.file.canonicalPath) ?? []) {
      if (candidate.node.qualifiedName !== qualifiedName) {
        continue;
      }
      const distance = Math.abs(candidate.line - line);
      if (
        !closest ||
        distance < closest.distance ||
        (distance === closest.distance &&
          candidate.line < closest.line)
      ) {
        closest = {
          distance,
          line: candidate.line,
          node: candidate.node
        };
      }
    }
    return (
      closest?.node ??
      [...(
        symbolNodesByFile.get(
          parsed.file.canonicalPath
        )?.values() ?? []
      )].find(
        (node) => node.qualifiedName === qualifiedName
      )
    );
  };
  const findContainingSymbolNode = (
    parsed: ParsedSourceFile,
    qualifiedName: string,
    line: number
  ): CodeGraphNode | undefined => {
    const candidates = (
      symbolsByLocation.get(parsed.file.canonicalPath) ?? []
    )
      .map(({ line: declarationLine, node }) => ({
        declarationLine,
        endLine:
          typeof node.metadata.endLine === "number"
            ? node.metadata.endLine
            : declarationLine,
        node
      }))
      .filter(
        (candidate) =>
          candidate.node.qualifiedName === qualifiedName
      );
    return (
      candidates
        .filter(
          (candidate) =>
            line >= candidate.declarationLine &&
            line <= candidate.endLine
        )
        .sort(
          (left, right) =>
            left.endLine -
              left.declarationLine -
              (right.endLine -
                right.declarationLine) ||
            right.declarationLine -
              left.declarationLine
        )[0]?.node ??
      candidates.sort(
        (left, right) =>
          Math.abs(left.declarationLine - line) -
            Math.abs(right.declarationLine - line) ||
          left.declarationLine - right.declarationLine
      )[0]?.node
    );
  };

  // Reserve graph capacity for remote-call anchors across the
  // whole workspace before optional LSP structure can consume it.
  boundarySymbolLoop: for (const parsed of input.files) {
    if (
      !fileNodesByPath.has(parsed.file.canonicalPath)
    ) {
      continue;
    }
    const prioritySymbols =
      prioritySymbolsByFile.get(
        parsed.file.canonicalPath
      ) ?? new Set<string>();
    for (const symbol of parsed.symbols) {
      if (!prioritySymbols.has(symbol.qualifiedName)) {
        continue;
      }
      if (!addSymbolNode(parsed, symbol)) {
        break boundarySymbolLoop;
      }
    }
  }

  for (const parsed of input.files) {
    const fileNode = fileNodesByPath.get(
      parsed.file.canonicalPath
    );
    const perFile = symbolNodesByFile.get(
      parsed.file.canonicalPath
    );
    if (!fileNode || !perFile) {
      continue;
    }
    for (const endpoint of parsed.serverEndpoints) {
      const symbolNode = endpoint.symbolQualifiedName
        ? findSymbolNodeForDeclaration(
            parsed,
            endpoint.symbolQualifiedName,
            endpoint.line
          )
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
              annotation: endpoint.annotation,
              testCode: isTestCodePath(
                parsed.file.relativePath
              )
            }
          });
      if (!endpointNode) {
        continue;
      }
      if (!symbolNode) {
        deferredStructuralEdges.push({
          from: fileNode.id,
          to: endpointNode.id,
          kind: "contains",
          confidence: "exact",
          source: "builtin",
          evidence: `文件 ${parsed.file.relativePath} 声明服务端端点 ${endpoint.method} ${endpoint.route}`
        });
      }
      endpoints.push(endpointNode);
    }

    for (const request of parsed.clientRequests) {
      const container = request.containerQualifiedName
        ? findContainingSymbolNode(
            parsed,
            request.containerQualifiedName,
            request.line
          )
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
          testCode: isTestCodePath(
            parsed.file.relativePath
          ),
          ...(documentation ? { documentation } : {})
        }
      });
      if (!requestNode) {
        continue;
      }
      requests.push(requestNode);
      const relation: Omit<CodeGraphEdge, "id"> = {
        from: container?.id ?? fileNode.id,
        to: requestNode.id,
        kind: container ? "calls" : "contains",
        confidence: container ? "exact" : "probable",
        source: "builtin",
        evidence: container
          ? `内置 HTTP 规则在 ${container.qualifiedName} 中识别到请求`
          : `内置 HTTP 规则在文件 ${parsed.file.relativePath} 中识别到请求`
      };
      if (container) {
        deferredRequestEdges.push(relation);
      } else {
        deferredStructuralEdges.push(relation);
      }
    }

    for (const boundary of parsed.remoteBoundaries) {
      const symbolNode = boundary.symbolQualifiedName
        ? findSymbolNodeForDeclaration(
            parsed,
            boundary.symbolQualifiedName,
            boundary.line
          )
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
            metadata: {
              ...remoteBoundaryMetadata(boundary),
              testCode: isTestCodePath(
                parsed.file.relativePath
              )
            }
          });
      if (!boundaryNode) {
        continue;
      }
      const graphBoundaryKey = [
        boundary.role,
        boundaryNode.id,
        remoteBoundaryKey(boundary)
      ].join("\0");
      if (remoteBoundaryKeys.has(graphBoundaryKey)) {
        continue;
      }
      remoteBoundaryKeys.add(graphBoundaryKey);
      if (!symbolNode) {
        addNamedSymbol(boundaryNode);
        deferredStructuralEdges.push({
          from: fileNode.id,
          to: boundaryNode.id,
          kind: "contains",
          confidence: "exact",
          source: "builtin",
          evidence: `文件 ${parsed.file.relativePath} 声明 RPC ${boundary.role === "client" ? "客户端" : "处理器"} ${boundary.operationKey}`
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

  callableSymbolLoop: for (const parsed of input.files) {
    if (
      !fileNodesByPath.has(parsed.file.canonicalPath)
    ) {
      continue;
    }
    const prioritySymbols =
      prioritySymbolsByFile.get(
        parsed.file.canonicalPath
      ) ?? new Set<string>();
    for (const symbol of parsed.symbols) {
      if (
        (symbol.kind !== "function" &&
          symbol.kind !== "method") ||
        prioritySymbols.has(symbol.qualifiedName)
      ) {
        continue;
      }
      if (!addSymbolNode(parsed, symbol)) {
        break callableSymbolLoop;
      }
    }
  }

  optionalSymbolLoop: for (const parsed of input.files) {
    if (
      !fileNodesByPath.has(parsed.file.canonicalPath)
    ) {
      continue;
    }
    const prioritySymbols =
      prioritySymbolsByFile.get(
        parsed.file.canonicalPath
      ) ?? new Set<string>();
    for (const symbol of parsed.symbols) {
      if (
        symbol.kind === "function" ||
        symbol.kind === "method" ||
        prioritySymbols.has(symbol.qualifiedName)
      ) {
        continue;
      }
      if (!addSymbolNode(parsed, symbol)) {
        break optionalSymbolLoop;
      }
    }
  }

  for (const requestEdge of deferredRequestEdges) {
    if (!addEdge(requestEdge)) {
      break;
    }
  }

  callFileLoop: for (const parsed of input.files) {
    const perFile = symbolNodesByFile.get(
      parsed.file.canonicalPath
    );
    if (!perFile) {
      continue;
    }
    for (const symbol of parsed.symbols) {
      const sourceNode = findSymbolNodeForDeclaration(
        parsed,
        symbol.qualifiedName,
        symbol.line
      );
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
          const diagnostic = unresolvedCallDiagnostic(
            call,
            sourceNode,
            parsed,
            symbolsByName,
            symbolsByLocation
          );
          if (diagnostic) {
            addDiagnostic(diagnostic);
          }
          continue;
        }
        if (
          !addEdge({
            from: sourceNode.id,
            to: resolution.node.id,
            kind: "calls",
            confidence: resolution.confidence,
            label: call.receiver
              ? `${call.receiver}.${call.name}`
              : call.name,
            source: resolution.source,
            evidence: resolution.evidence
          })
        ) {
          break callFileLoop;
        }
      }
    }
  }

  referenceFileLoop: for (const parsed of input.files) {
    const perFile = symbolNodesByFile.get(
      parsed.file.canonicalPath
    );
    if (!perFile) {
      continue;
    }
    for (const symbol of parsed.symbols) {
      const sourceNode = findSymbolNodeForDeclaration(
        parsed,
        symbol.qualifiedName,
        symbol.line
      );
      if (!sourceNode) {
        continue;
      }
      for (const reference of symbol.references ?? []) {
        const resolution = resolveReferenceTarget(
          reference,
          symbolsByLocation,
          symbolsByName,
          sourceNode
        );
        if (!resolution) {
          continue;
        }
        if (sourceNode.id === resolution.node.id) {
          continue;
        }
        if (
          !addEdge({
            from: sourceNode.id,
            to: resolution.node.id,
            kind: "references",
            confidence: resolution.confidence,
            label: reference.name,
            source: resolution.source,
            evidence: reference.evidence
          })
        ) {
          break referenceFileLoop;
        }
      }
    }
  }

  semanticRelationFileLoop: for (const parsed of input.files) {
    for (const symbol of parsed.symbols) {
      const sourceNode = findSymbolNodeForDeclaration(
        parsed,
        symbol.qualifiedName,
        symbol.line
      );
      if (!sourceNode) {
        continue;
      }
      for (const relation of symbol.semanticRelations ?? []) {
        if (
          !relation.targetCanonicalPath ||
          relation.targetLine === undefined
        ) {
          continue;
        }
        const target = closestSymbolAtLine(
          (
            symbolsByLocation.get(
              relation.targetCanonicalPath
            ) ?? []
          ).filter(
            ({ node }) =>
              node.name === relation.targetName
          ),
          relation.targetLine
        );
        if (!target || target.id === sourceNode.id) {
          continue;
        }
        if (
          !addEdge({
            from: sourceNode.id,
            to: target.id,
            kind: relation.kind,
            confidence: "exact",
            label: relation.targetName,
            source: relation.source,
            evidence: relation.evidence
          })
        ) {
          break semanticRelationFileLoop;
        }
      }
    }
  }

  const rpcHandlersByOperation = new Map<
    string,
    RemoteGraphBoundary[]
  >();
  for (const handler of rpcHandlers) {
    appendMapValue(
      rpcHandlersByOperation,
      remoteBoundaryKey(handler.boundary),
      handler
    );
  }
  const rpcLinks: RemoteGraphLink[] = [];
  const ambiguousRpcEdgeIds = new Set<string>();
  rpcClientLoop: for (const client of rpcClients) {
    const matches = (
      rpcHandlersByOperation.get(
        remoteBoundaryKey(client.boundary)
      ) ?? []
    )
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
    if (matches.length === 0) {
      addDiagnostic({
        kind: "unmatched-rpc",
        severity: "warning",
        message: `未找到 RPC ${client.boundary.operationName} 的服务端处理器`,
        evidence: `Profile ${client.boundary.profileId} 使用操作键 ${client.boundary.operationKey} 匹配，但完整索引中没有兼容的 server 边界。`,
        nodeId: client.node.id,
        relatedNodeIds: []
      });
    } else if (ambiguous) {
      addDiagnostic({
        kind: "ambiguous-target",
        severity: "info",
        message: `RPC ${client.boundary.operationName} 匹配到 ${matches.length} 个候选处理器`,
        evidence: `候选共享操作键 ${client.boundary.operationKey}；GitNest 保留全部目标，未静默选择。`,
        nodeId: client.node.id,
        relatedNodeIds: matches.map(
          (match) => match.handler.node.id
        )
      });
    }
    for (const match of matches) {
      const edge = addEdge({
        from: client.node.id,
        to: match.handler.node.id,
        kind: "rpc-request",
        confidence: match.confidence,
        label: client.boundary.operationName,
        source: "builtin",
        evidence: `Profile ${client.boundary.profileId} 以操作键 ${client.boundary.operationKey} 匹配 RPC 两端`
      });
      if (!edge) {
        break rpcClientLoop;
      }
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
  const requestChainIds = new Set<string>();
  const endpointIndex = buildHttpEndpointIndex(endpoints);
  httpRequestLoop: for (const request of requests) {
    const matches = findHttpEndpointCandidates(
      request,
      endpointIndex
    )
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

    if (matches.length === 0) {
      addDiagnostic({
        kind: "unmatched-request",
        severity: "warning",
        message: `未找到 ${request.name} 的服务端端点`,
        evidence: explainUnmatchedHttpRequest(
          request,
          endpoints
        ),
        nodeId: request.id,
        relatedNodeIds: []
      });
    } else if (matches.length > 1) {
      addDiagnostic({
        kind: "ambiguous-target",
        severity: "info",
        message: `${request.name} 匹配到 ${matches.length} 个候选端点`,
        evidence:
          "HTTP 方法与规范化路由均兼容；GitNest 保留全部候选，需结合仓库和业务上下文确认。",
        nodeId: request.id,
        relatedNodeIds: matches.map(
          (match) => match.endpoint.id
        )
      });
    }
    for (const match of matches) {
      const httpEdge = addEdge({
        from: request.id,
        to: match.endpoint.id,
        kind: "http-request",
        confidence: match.confidence,
        label: `${request.metadata.httpMethod} ${request.metadata.route}`,
        source: "builtin",
        evidence: httpMatchEvidence(
          request,
          match.endpoint,
          match.confidence
        )
      });
      if (!httpEdge) {
        break httpRequestLoop;
      }
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
      const chainId = stableId(
        "chain",
        "web-http",
        request.id,
        match.endpoint.id
      );
      if (requestChainIds.has(chainId)) {
        continue;
      }
      if (
        requestChains.length >= limits.maxRequestChains
      ) {
        truncated = true;
        break httpRequestLoop;
      }
      requestChainIds.add(chainId);
      requestChains.push({
        id: chainId,
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
        confidence: weakestEdgeConfidence(
          edgeIds,
          edgeById,
          match.confidence
        )
      });
    }
  }

  for (const link of rpcLinks) {
    const chainId = stableId(
      "chain",
      link.client.boundary.profileId,
      link.client.boundary.transport,
      link.client.boundary.operationKey,
      link.client.node.id,
      link.handler.node.id
    );
    if (requestChainIds.has(chainId)) {
      continue;
    }
    if (
      requestChains.length >= limits.maxRequestChains
    ) {
      truncated = true;
      break;
    }
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
    requestChainIds.add(chainId);
    requestChains.push({
      id: chainId,
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
      confidence: weakestEdgeConfidence(
        edgeIds,
        edgeById,
        link.confidence
      )
    });
  }

  structuralSymbolEdgeLoop: for (const parsed of input.files) {
    const fileNode = fileNodesByPath.get(
      parsed.file.canonicalPath
    );
    const perFile = symbolNodesByFile.get(
      parsed.file.canonicalPath
    );
    if (!fileNode || !perFile) {
      continue;
    }
    for (const symbol of parsed.symbols) {
      const symbolNode = findSymbolNodeForDeclaration(
        parsed,
        symbol.qualifiedName,
        symbol.line
      );
      if (!symbolNode) {
        continue;
      }
      if (
        !addEdge({
          from:
            (symbol.parentQualifiedName
              ? findContainingSymbolNode(
                  parsed,
                  symbol.parentQualifiedName,
                  symbol.line
                )?.id
              : undefined) ?? fileNode.id,
          to: symbolNode.id,
          kind: "contains",
          confidence: "exact",
          source: symbol.source,
          evidence: symbol.parentQualifiedName
            ? `符号 ${symbol.qualifiedName} 声明在 ${symbol.parentQualifiedName} 内`
            : `文件 ${parsed.file.relativePath} 声明符号 ${symbol.qualifiedName}`
        })
      ) {
        break structuralSymbolEdgeLoop;
      }
    }
  }
  for (const structuralEdge of deferredStructuralEdges) {
    if (!addEdge(structuralEdge)) {
      break;
    }
  }

  if (input.scope === "changed") {
    return filterChangedGraph({
      nodes,
      edges,
      requestChains,
      diagnostics,
      truncated
    });
  }

  return {
    nodes,
    edges,
    requestChains,
    diagnostics,
    truncated
  };

  function addNamedSymbol(
    node: CodeGraphNode,
    packageName =
      typeof node.metadata.packageName === "string"
        ? node.metadata.packageName
        : undefined
  ): void {
    for (const name of new Set([
      node.name,
      node.qualifiedName,
      ...(packageName
        ? [`${packageName}.${node.qualifiedName}`]
        : [])
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
      source: "builtin" | "lsp" | "merged";
      evidence: string;
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
          confidence: "exact",
          source: call.source ?? "lsp",
          evidence:
            call.evidence ??
            `LSP 精确目标 ${call.targetCanonicalPath}:${call.targetLine}`
        };
      }
    }
    if (namedTargets.length === 1) {
      return {
        node: namedTargets[0]?.node as CodeGraphNode,
        confidence: "exact",
        source: call.source ?? "lsp",
        evidence:
          call.evidence ??
          `LSP 精确目标文件 ${call.targetCanonicalPath}`
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
        isCallableNode(candidate) &&
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
        confidence: "probable",
        source: call.source ?? "builtin",
        evidence: mergeEvidence(
          call.evidence,
          `接收者静态类型 ${call.receiverType} 唯一匹配 ${typedMatches[0]?.qualifiedName}`
        )
      };
    }
  }
  if (receiver) {
    const direct = perFile.get(`${receiver}.${name}`);
    if (direct) {
      return {
        node: direct,
        confidence: "exact",
        source: call.source ?? "builtin",
        evidence: mergeEvidence(
          call.evidence,
          `同文件限定名 ${receiver}.${name} 精确匹配`
        )
      };
    }
  }

  const local = [...perFile.values()].filter(
    (node) =>
      node.name === name &&
      isCallableNode(node) &&
      node.id !== sourceNode.id
  );
  if (
    local.length === 1 &&
    allowsLocalNameFallback(receiver, sourceNode)
  ) {
    return {
      node: local[0] as CodeGraphNode,
      confidence: "probable",
      source: call.source ?? "builtin",
      evidence: mergeEvidence(
        call.evidence,
        `同文件唯一可调用符号 ${local[0]?.qualifiedName}`
      )
    };
  }

  const candidates = (symbolsByName.get(name) ?? []).filter(
    (candidate) =>
      candidate.id !== sourceNode.id &&
      isCallableNode(candidate)
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
        confidence: "probable",
        source: call.source ?? "builtin",
        evidence: mergeEvidence(
          call.evidence,
          `接收者 ${receiver} 与所有者 ${symbolOwner(
            receiverMatches[0] as CodeGraphNode
          ) ?? "未知"} 唯一匹配`
        )
      };
    }
    return undefined;
  }
  if (compatibleLanguage.length === 1) {
    return {
      node: compatibleLanguage[0] as CodeGraphNode,
      confidence: "heuristic",
      source: call.source ?? "builtin",
      evidence: mergeEvidence(
        call.evidence,
        `同语言范围内仅有一个名为 ${name} 的可调用符号`
      )
    };
  }
  return undefined;
}

function resolveReferenceTarget(
  reference: ParsedReference,
  symbolsByLocation: ReadonlyMap<
    string,
    Array<{ line: number; node: CodeGraphNode }>
  >,
  symbolsByName: ReadonlyMap<string, CodeGraphNode[]>,
  sourceNode: CodeGraphNode
):
  | {
      node: CodeGraphNode;
      confidence: AnalysisConfidence;
      source: "builtin" | "lsp" | "merged";
      evidence: string;
    }
  | undefined {
  if (
    reference.targetCanonicalPath &&
    reference.targetLine !== undefined
  ) {
    const namedTargets = (
      symbolsByLocation.get(reference.targetCanonicalPath) ?? []
    ).filter(({ node }) => node.name === reference.name);
    const located = closestSymbolAtLine(
      namedTargets,
      reference.targetLine
    );
    if (located) {
      return {
        node: located,
        confidence: "exact",
        source: reference.source,
        evidence: reference.evidence
      };
    }
  }
  if (reference.targetQualifiedName) {
    const candidates = (
      symbolsByName.get(reference.targetQualifiedName) ?? []
    ).filter(
      (candidate) =>
        candidate.id !== sourceNode.id &&
        languageFamily(candidate.language) ===
          languageFamily(sourceNode.language)
    );
    if (candidates.length === 1) {
      return {
        node: candidates[0] as CodeGraphNode,
        confidence:
          reference.source === "lsp" ? "exact" : "probable",
        source: reference.source,
        evidence: reference.evidence
      };
    }
    const sourcePackage =
      typeof sourceNode.metadata.packageName === "string"
        ? sourceNode.metadata.packageName
        : undefined;
    if (sourcePackage) {
      const samePackageCandidates = candidates.filter(
        (candidate) =>
          candidate.metadata.packageName === sourcePackage
      );
      if (samePackageCandidates.length === 1) {
        return {
          node:
            samePackageCandidates[0] as CodeGraphNode,
          confidence:
            reference.source === "lsp"
              ? "exact"
              : "probable",
          source: reference.source,
          evidence: `${reference.evidence}；同 Java package ${sourcePackage} 内唯一匹配`
        };
      }
    }
  }
  return undefined;
}

function unresolvedCallDiagnostic(
  call: ParsedCall,
  sourceNode: CodeGraphNode,
  parsed: ParsedSourceFile,
  symbolsByName: ReadonlyMap<string, CodeGraphNode[]>,
  symbolsByLocation: ReadonlyMap<
    string,
    Array<{ line: number; node: CodeGraphNode }>
  >
): Omit<CodeAnalysisDiagnostic, "id"> | undefined {
  if (call.targetCanonicalPath) {
    const relatedNodeIds = (
      symbolsByLocation.get(call.targetCanonicalPath) ?? []
    )
      .filter(({ node }) => isCallableNode(node))
      .map(({ node }) => node.id);
    return {
      kind: "unresolved-call",
      severity: "warning",
      message: `LSP 已定位 ${call.name}，但目标符号未进入关系图`,
      evidence:
        call.evidence ??
        `目标位置 ${call.targetCanonicalPath}:${
          call.targetLine ?? "未知行"
        } 可能超出符号预算、文件读取失败或缺少 documentSymbol。`,
      nodeId: sourceNode.id,
      relatedNodeIds
    };
  }
  if (!call.receiverType) {
    return undefined;
  }
  const candidates = (
    symbolsByName.get(call.name) ?? []
  ).filter(
    (candidate) =>
      candidate.id !== sourceNode.id &&
      isCallableNode(candidate) &&
      languageFamily(candidate.language) ===
        languageFamily(parsed.file.language)
  );
  const matches = bestReceiverMatches(
    call.receiverType,
    candidates,
    sourceNode
  );
  if (matches.length === 1) {
    return undefined;
  }
  return {
    kind:
      matches.length > 1
        ? "ambiguous-target"
        : "unresolved-call",
    severity: matches.length > 1 ? "info" : "warning",
    message:
      matches.length > 1
        ? `${call.receiverType}.${call.name} 存在多个候选目标`
        : `未找到 ${call.receiverType}.${call.name} 的兼容目标`,
    evidence: mergeEvidence(
      call.evidence,
      matches.length > 1
        ? "接收者静态类型可以匹配多个同语言符号，未自动选择。"
        : "已知接收者静态类型，但完整符号集合中没有兼容的可调用节点。"
    ),
    nodeId: sourceNode.id,
    relatedNodeIds: matches.map((node) => node.id)
  };
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
): CodeGraphNode["language"] | "javascript-like" {
  return language === "typescript" ||
    language === "javascript" ||
    language === "vue"
    ? "javascript-like"
    : language;
}

function isCallableNode(
  node: Pick<CodeGraphNode, "kind">
): boolean {
  return (
    node.kind === "function" ||
    node.kind === "method" ||
    node.kind === "server-endpoint" ||
    node.kind === "rpc-client" ||
    node.kind === "rpc-handler"
  );
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

function buildHttpEndpointIndex(
  endpoints: readonly CodeGraphNode[]
): HttpEndpointIndex {
  const exactByMethodAndShape = new Map<
    string,
    CodeGraphNode[]
  >();
  const suffixByMethodAndShape = new Map<
    string,
    CodeGraphNode[]
  >();
  const orderById = new Map<string, number>();
  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];
    if (!endpoint) {
      continue;
    }
    orderById.set(endpoint.id, index);
    const method = String(endpoint.metadata.httpMethod ?? "");
    const segments = routeSegments(
      routeShape(String(endpoint.metadata.route ?? ""))
    );
    const shape = segments.join("/");
    appendMapValue(
      exactByMethodAndShape,
      httpRouteIndexKey(method, shape),
      endpoint
    );
    for (
      let start = 0;
      start <= segments.length - 2;
      start += 1
    ) {
      appendMapValue(
        suffixByMethodAndShape,
        httpRouteIndexKey(
          method,
          segments.slice(start).join("/")
        ),
        endpoint
      );
    }
  }
  return {
    exactByMethodAndShape,
    suffixByMethodAndShape,
    orderById
  };
}

function findHttpEndpointCandidates(
  request: CodeGraphNode,
  index: HttpEndpointIndex
): CodeGraphNode[] {
  const method = String(request.metadata.httpMethod ?? "");
  const segments = routeSegments(
    routeShape(String(request.metadata.route ?? ""))
  );
  const shape = segments.join("/");
  const candidates = new Map<string, CodeGraphNode>();
  for (const endpointMethod of unique([method, "ANY"])) {
    for (const endpoint of [
      ...(index.exactByMethodAndShape.get(
        httpRouteIndexKey(endpointMethod, shape)
      ) ?? [])
    ]) {
      candidates.set(endpoint.id, endpoint);
    }
    for (const endpoint of [
      ...(index.suffixByMethodAndShape.get(
        httpRouteIndexKey(endpointMethod, shape)
      ) ?? [])
    ]) {
      candidates.set(endpoint.id, endpoint);
    }
    for (
      let start = 0;
      start <= segments.length - 2;
      start += 1
    ) {
      const suffix = segments.slice(start).join("/");
      for (const endpoint of [
        ...(index.exactByMethodAndShape.get(
          httpRouteIndexKey(endpointMethod, suffix)
        ) ?? [])
      ]) {
        candidates.set(endpoint.id, endpoint);
      }
    }
  }
  return [...candidates.values()].sort(
    (left, right) =>
      (index.orderById.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (index.orderById.get(right.id) ?? Number.MAX_SAFE_INTEGER)
  );
}

function httpRouteIndexKey(method: string, shape: string): string {
  return `${method}\0${shape}`;
}

function remoteBoundaryKey(
  boundary: ParsedRemoteBoundary
): string {
  return `${boundary.profileId}\0${boundary.transport}\0${boundary.operationKey}`;
}

function appendMapValue<Key, Value>(
  map: Map<Key, Value[]>,
  key: Key,
  value: Value
): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
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
    ),
    diagnostics: graph.diagnostics.filter(
      (diagnostic) =>
        (diagnostic.nodeId !== undefined &&
          included.has(diagnostic.nodeId)) ||
        diagnostic.relatedNodeIds.some((nodeId) =>
          included.has(nodeId)
        )
    ),
    truncated: graph.truncated
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

function weakestEdgeConfidence(
  edgeIds: readonly string[],
  edgeById: ReadonlyMap<string, CodeGraphEdge>,
  fallback: AnalysisConfidence
): AnalysisConfidence {
  return edgeIds.reduce<AnalysisConfidence>(
    (weakest, edgeId) => {
      const edge = edgeById.get(edgeId);
      return edge &&
        confidenceRank(edge.confidence) <
          confidenceRank(weakest)
        ? edge.confidence
        : weakest;
    },
    fallback
  );
}

function defaultEdgeEvidence(
  edge: Pick<CodeGraphEdge, "kind" | "label">
): string {
  return {
    contains: "源码声明范围包含关系",
    calls: edge.label
      ? `静态调用匹配 ${edge.label}`
      : "静态调用匹配",
    extends: edge.label
      ? `类型继承 ${edge.label}`
      : "Language Server 类型继承关系",
    implements: edge.label
      ? `类型实现 ${edge.label}`
      : "Language Server 类型实现关系",
    overrides: edge.label
      ? `方法重写 ${edge.label}`
      : "Language Server 方法重写关系",
    "http-request": edge.label
      ? `HTTP 方法与规范化路由匹配 ${edge.label}`
      : "HTTP 方法与规范化路由匹配",
    "rpc-request": edge.label
      ? `RPC Profile 操作键匹配 ${edge.label}`
      : "RPC Profile 操作键匹配",
    references: "Language Server 引用关系"
  }[edge.kind];
}

function mergeEdgeSource(
  existing: CodeGraphEdge["source"],
  next: NonNullable<CodeGraphEdge["source"]>
): NonNullable<CodeGraphEdge["source"]> {
  if (!existing) {
    return next;
  }
  return existing === next ? existing : "merged";
}

function mergeEvidence(
  existing: string | undefined,
  next: string
): string {
  if (!existing) {
    return next;
  }
  return existing.includes(next)
    ? existing
    : `${existing}；${next}`;
}

function httpMatchEvidence(
  request: CodeGraphNode,
  endpoint: CodeGraphNode,
  confidence: AnalysisConfidence
): string {
  const requestMethod = String(
    request.metadata.httpMethod ?? ""
  );
  const endpointMethod = String(
    endpoint.metadata.httpMethod ?? ""
  );
  const requestRoute = String(
    request.metadata.route ?? ""
  );
  const endpointRoute = String(
    endpoint.metadata.route ?? ""
  );
  return confidence === "exact"
    ? `HTTP 方法 ${requestMethod} 与规范化路由 ${routeShape(
        requestRoute
      )} 精确匹配端点 ${endpointMethod} ${endpointRoute}`
    : confidence === "probable"
      ? `端点使用 ANY 方法，规范化路由 ${routeShape(
          requestRoute
        )} 匹配 ${endpointRoute}`
      : `请求与端点的规范化路由后缀兼容：${requestRoute} ↔ ${endpointRoute}`;
}

function explainUnmatchedHttpRequest(
  request: CodeGraphNode,
  endpoints: readonly CodeGraphNode[]
): string {
  const requestMethod = String(
    request.metadata.httpMethod ?? ""
  );
  const requestShape = routeShape(
    String(request.metadata.route ?? "")
  );
  const routeMatches = endpoints.filter(
    (endpoint) =>
      routeShape(String(endpoint.metadata.route ?? "")) ===
      requestShape
  );
  if (routeMatches.length > 0) {
    const methods = unique(
      routeMatches.map((endpoint) =>
        String(endpoint.metadata.httpMethod ?? "ANY")
      )
    );
    return `规范化路由 ${requestShape} 存在端点，但方法不兼容：请求为 ${requestMethod}，候选为 ${methods.join(
      "、"
    )}。`;
  }
  return `完整索引中没有与 ${requestMethod} ${requestShape} 兼容的 Spring/HTTP 端点；也可能是动态路由、未识别框架或局部索引造成。`;
}

function isTestCodePath(path: string): boolean {
  const normalized = `/${path
    .replaceAll("\\", "/")
    .toLocaleLowerCase("en-US")}`;
  return (
    /\/(?:test|tests|__tests__|spec|specs)\//.test(
      normalized
    ) ||
    /\/src\/test\//.test(normalized) ||
    /\.(?:test|spec)\.[^/]+$/.test(normalized) ||
    /(?:^|\/)test_[^/]+\.py$/.test(normalized) ||
    /_test\.go$/.test(normalized)
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
