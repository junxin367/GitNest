import type {
  ChangedAnalysisPath,
  CodeAnalysisDiagnostic,
  CodeAnalysisSnapshot,
  LanguageServerStatus
} from "./model";

/**
 * Derives the changed-code view from a full graph produced by an
 * incremental analysis pass. The full snapshot remains available to
 * MCP while the renderer can keep its focused changed view.
 */
export function createChangedAnalysisSnapshot(
  snapshot: CodeAnalysisSnapshot
): CodeAnalysisSnapshot {
  const changedNodeIds = new Set(
    snapshot.nodes
      .filter((node) => node.changed)
      .map((node) => node.id)
  );
  const includedNodeIds = new Set(changedNodeIds);

  for (const chain of snapshot.requestChains) {
    if (!chain.changed) {
      continue;
    }
    for (const nodeId of chain.nodeIds) {
      includedNodeIds.add(nodeId);
    }
  }
  for (const edge of snapshot.edges) {
    if (
      changedNodeIds.has(edge.from) ||
      changedNodeIds.has(edge.to)
    ) {
      includedNodeIds.add(edge.from);
      includedNodeIds.add(edge.to);
    }
  }

  const edges = snapshot.edges.filter(
    (edge) =>
      includedNodeIds.has(edge.from) &&
      includedNodeIds.has(edge.to)
  );
  const edgeIds = new Set(edges.map((edge) => edge.id));
  const nodes = snapshot.nodes.filter((node) =>
    includedNodeIds.has(node.id)
  );
  const requestChains = snapshot.requestChains.filter(
    (chain) =>
      chain.changed &&
      chain.edgeIds.every((edgeId) => edgeIds.has(edgeId))
  );
  const diagnostics = (snapshot.diagnostics ?? []).filter(
    (diagnostic) =>
      (diagnostic.nodeId !== undefined &&
        includedNodeIds.has(diagnostic.nodeId)) ||
      diagnostic.relatedNodeIds.some((nodeId) =>
        includedNodeIds.has(nodeId)
      )
  );

  return {
    ...snapshot,
    scope: "changed",
    nodes,
    edges,
    requestChains,
    diagnostics,
    stats: {
      ...snapshot.stats,
      symbolCount: nodes.filter((node) => node.kind !== "file")
        .length,
      edgeCount: edges.length,
      requestChainCount: requestChains.length
    }
  };
}

/**
 * Applies an incremental workspace graph without discarding semantic
 * data that belongs to unchanged files in the previous full snapshot.
 */
export function mergeIncrementalWorkspaceSnapshot(
  previous: CodeAnalysisSnapshot,
  refreshed: CodeAnalysisSnapshot,
  changedPaths: readonly ChangedAnalysisPath[]
): CodeAnalysisSnapshot {
  if (!snapshotContextsMatch(previous, refreshed)) {
    return refreshed;
  }

  const changedLocationKeys = new Set(
    changedPaths.map(changedPathKey)
  );
  for (const node of refreshed.nodes) {
    if (node.changed) {
      changedLocationKeys.add(nodeLocationKey(node));
    }
  }

  const previousNodesById = new Map(
    previous.nodes.map((node) => [node.id, node])
  );
  const nodes = [];
  const includedNodeIds = new Set<string>();
  for (const node of refreshed.nodes) {
    const locationKey = nodeLocationKey(node);
    const previousNode = previousNodesById.get(node.id);
    const selected =
      !changedLocationKeys.has(locationKey) &&
      previousNode &&
      nodeLocationKey(previousNode) === locationKey
        ? {
            ...previousNode,
            changed: false
          }
        : node;
    nodes.push(selected);
    includedNodeIds.add(selected.id);
  }
  for (const node of previous.nodes) {
    if (
      includedNodeIds.has(node.id) ||
      changedLocationKeys.has(nodeLocationKey(node))
    ) {
      continue;
    }
    nodes.push({
      ...node,
      changed: false
    });
    includedNodeIds.add(node.id);
  }

  const changedNodeIds = new Set(
    nodes
      .filter(
        (node) =>
          node.changed ||
          changedLocationKeys.has(nodeLocationKey(node))
      )
      .map((node) => node.id)
  );
  const previousEdgesById = new Map(
    previous.edges
      .filter((edge) =>
        edgeCanBePreserved(
          edge,
          includedNodeIds,
          changedNodeIds
        )
      )
      .map((edge) => [edge.id, edge])
  );
  const edges = [];
  const includedEdgeIds = new Set<string>();
  for (const edge of refreshed.edges) {
    if (
      !includedNodeIds.has(edge.from) ||
      !includedNodeIds.has(edge.to)
    ) {
      continue;
    }
    const previousEdge = previousEdgesById.get(edge.id);
    const selected =
      !changedNodeIds.has(edge.from) &&
      !changedNodeIds.has(edge.to) &&
      previousEdge?.from === edge.from &&
      previousEdge.to === edge.to
        ? previousEdge
        : edge;
    edges.push(selected);
    includedEdgeIds.add(selected.id);
  }
  for (const edge of previousEdgesById.values()) {
    if (includedEdgeIds.has(edge.id)) {
      continue;
    }
    edges.push(edge);
    includedEdgeIds.add(edge.id);
  }

  const previousChainsById = new Map(
    previous.requestChains
      .filter((chain) =>
        chainCanBePreserved(
          chain,
          includedNodeIds,
          includedEdgeIds,
          changedNodeIds
        )
      )
      .map((chain) => [chain.id, chain])
  );
  const requestChains = [];
  const includedChainIds = new Set<string>();
  for (const chain of refreshed.requestChains) {
    if (
      !chainReferencesAvailable(
        chain,
        includedNodeIds,
        includedEdgeIds
      )
    ) {
      continue;
    }
    const previousChain = previousChainsById.get(chain.id);
    const selected =
      !chain.changed &&
      !chain.nodeIds.some((nodeId) =>
        changedNodeIds.has(nodeId)
      ) &&
      previousChain
        ? {
            ...previousChain,
            changed: false
          }
        : chain;
    requestChains.push(selected);
    includedChainIds.add(selected.id);
  }
  for (const chain of previousChainsById.values()) {
    if (includedChainIds.has(chain.id)) {
      continue;
    }
    requestChains.push({
      ...chain,
      changed: false
    });
    includedChainIds.add(chain.id);
  }

  const currentSemanticProblem =
    refreshed.languageServers.some(
      (server) =>
        (server.documentsTotal ?? 0) > 0 &&
        (
          server.state !== "connected" ||
          server.semanticCoverage === "partial" ||
          server.semanticCoverage === "unavailable"
        )
    );
  const previousIndexStatus = previous.indexStatus;
  const preservePreviousIndexStatus =
    previousIndexStatus !== undefined &&
    !currentSemanticProblem;
  let indexStatus =
    refreshed.indexStatus ?? previousIndexStatus;
  if (preservePreviousIndexStatus) {
    indexStatus = {
      ...previousIndexStatus,
      fullIndexAvailable:
        refreshed.indexStatus?.fullIndexAvailable ??
        previousIndexStatus.fullIndexAvailable,
      ...(refreshed.indexStatus?.lastFullIndexAt
        ? {
            lastFullIndexAt:
              refreshed.indexStatus.lastFullIndexAt
          }
        : {})
    };
  }
  const diagnostics = mergeDiagnostics(
    previous.diagnostics ?? [],
    refreshed.diagnostics ?? [],
    includedNodeIds,
    changedNodeIds,
    preservePreviousIndexStatus
  );
  const analyzedFileCount = nodes.filter(
    (node) => node.kind === "file"
  ).length;
  const fullAnalyzedFileCount =
    analyzedFileCount > 0
      ? analyzedFileCount
      : Math.max(
          previous.stats.analyzedFiles,
          refreshed.stats.analyzedFiles
        );
  const newlyAnalyzedFiles = Math.max(
    0,
    refreshed.stats.analyzedFiles -
      refreshed.stats.cachedFiles
  );

  return {
    ...refreshed,
    scope: "workspace",
    nodes,
    edges,
    requestChains,
    languageServers: mergeLanguageServerStatuses(
      previous.languageServers,
      refreshed.languageServers
    ),
    ...(indexStatus ? { indexStatus } : {}),
    diagnostics,
    warnings: mergeUniqueStrings(
      previous.warnings,
      refreshed.warnings
    ),
    stats: {
      ...refreshed.stats,
      discoveredFiles: fullAnalyzedFileCount,
      analyzedFiles: fullAnalyzedFileCount,
      cachedFiles: Math.max(
        0,
        fullAnalyzedFileCount - newlyAnalyzedFiles
      ),
      skippedFiles: Math.max(
        previous.stats.skippedFiles,
        refreshed.stats.skippedFiles
      ),
      symbolCount: nodes.filter(
        (node) => node.kind !== "file"
      ).length,
      edgeCount: edges.length,
      requestChainCount: requestChains.length,
      truncated:
        previous.stats.truncated ||
        refreshed.stats.truncated
    }
  };
}

function snapshotContextsMatch(
  left: CodeAnalysisSnapshot,
  right: CodeAnalysisSnapshot
): boolean {
  if (
    left.workspaceId !== right.workspaceId ||
    left.scope !== "workspace" ||
    right.scope !== "workspace"
  ) {
    return false;
  }
  const rootKeys = (snapshot: CodeAnalysisSnapshot) =>
    snapshot.roots
      .map(
        (root) =>
          `${root.repositoryId}\0${root.worktreeId}\0${normalizePath(
            root.path
          )}`
      )
      .sort();
  const leftRoots = rootKeys(left);
  const rightRoots = rootKeys(right);
  return (
    leftRoots.length === rightRoots.length &&
    leftRoots.every(
      (root, index) => root === rightRoots[index]
    )
  );
}

function changedPathKey(path: ChangedAnalysisPath): string {
  return locationKey(
    path.repositoryId,
    path.worktreeId,
    path.path
  );
}

function nodeLocationKey(
  node: CodeAnalysisSnapshot["nodes"][number]
): string {
  return locationKey(
    node.location.repositoryId,
    node.location.worktreeId,
    node.location.path
  );
}

function locationKey(
  repositoryId: string,
  worktreeId: string,
  path: string
): string {
  return `${repositoryId}\0${worktreeId}\0${normalizePath(path)}`;
}

function normalizePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return process.platform === "win32"
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

function edgeCanBePreserved(
  edge: CodeAnalysisSnapshot["edges"][number],
  includedNodeIds: ReadonlySet<string>,
  changedNodeIds: ReadonlySet<string>
): boolean {
  return (
    includedNodeIds.has(edge.from) &&
    includedNodeIds.has(edge.to) &&
    !changedNodeIds.has(edge.from) &&
    !changedNodeIds.has(edge.to)
  );
}

function chainReferencesAvailable(
  chain: CodeAnalysisSnapshot["requestChains"][number],
  includedNodeIds: ReadonlySet<string>,
  includedEdgeIds: ReadonlySet<string>
): boolean {
  return (
    includedNodeIds.has(chain.clientNodeId) &&
    includedNodeIds.has(chain.endpointNodeId) &&
    chain.nodeIds.every((nodeId) =>
      includedNodeIds.has(nodeId)
    ) &&
    chain.edgeIds.every((edgeId) =>
      includedEdgeIds.has(edgeId)
    )
  );
}

function chainCanBePreserved(
  chain: CodeAnalysisSnapshot["requestChains"][number],
  includedNodeIds: ReadonlySet<string>,
  includedEdgeIds: ReadonlySet<string>,
  changedNodeIds: ReadonlySet<string>
): boolean {
  return (
    chainReferencesAvailable(
      chain,
      includedNodeIds,
      includedEdgeIds
    ) &&
    !chain.nodeIds.some((nodeId) =>
      changedNodeIds.has(nodeId)
    )
  );
}

function mergeLanguageServerStatuses(
  previous: readonly LanguageServerStatus[],
  refreshed: readonly LanguageServerStatus[]
): LanguageServerStatus[] {
  const refreshedByLanguage = new Map(
    refreshed.map((server) => [server.language, server])
  );
  const merged = previous.map((server) => {
    const current = refreshedByLanguage.get(server.language);
    if (!current) {
      return server;
    }
    refreshedByLanguage.delete(server.language);
    return current.state === "disabled" &&
      current.documentsTotal === 0 &&
      current.message.includes("当前范围没有对应语言文件")
      ? server
      : current;
  });
  return [
    ...merged,
    ...refreshedByLanguage.values()
  ];
}

function mergeDiagnostics(
  previous: readonly CodeAnalysisDiagnostic[],
  refreshed: readonly CodeAnalysisDiagnostic[],
  includedNodeIds: ReadonlySet<string>,
  changedNodeIds: ReadonlySet<string>,
  preservePreviousIndexStatus: boolean
): CodeAnalysisDiagnostic[] {
  const merged = new Map<string, CodeAnalysisDiagnostic>();
  for (const diagnostic of previous) {
    if (
      diagnosticReferencesAvailable(
        diagnostic,
        includedNodeIds
      ) &&
      !diagnosticTouchesNodes(
        diagnostic,
        changedNodeIds
      )
    ) {
      merged.set(diagnostic.id, diagnostic);
    }
  }
  for (const diagnostic of refreshed) {
    if (
      preservePreviousIndexStatus &&
      diagnostic.kind === "partial-index" &&
      merged.has(diagnostic.id)
    ) {
      continue;
    }
    if (
      diagnosticReferencesAvailable(
        diagnostic,
        includedNodeIds
      )
    ) {
      merged.set(diagnostic.id, diagnostic);
    }
  }
  return [...merged.values()];
}

function diagnosticReferencesAvailable(
  diagnostic: CodeAnalysisDiagnostic,
  includedNodeIds: ReadonlySet<string>
): boolean {
  return (
    (
      diagnostic.nodeId === undefined ||
      includedNodeIds.has(diagnostic.nodeId)
    ) &&
    diagnostic.relatedNodeIds.every((nodeId) =>
      includedNodeIds.has(nodeId)
    )
  );
}

function diagnosticTouchesNodes(
  diagnostic: CodeAnalysisDiagnostic,
  nodeIds: ReadonlySet<string>
): boolean {
  return (
    (
      diagnostic.nodeId !== undefined &&
      nodeIds.has(diagnostic.nodeId)
    ) ||
    diagnostic.relatedNodeIds.some((nodeId) =>
      nodeIds.has(nodeId)
    )
  );
}

function mergeUniqueStrings(
  left: readonly string[],
  right: readonly string[]
): string[] {
  return [...new Set([...left, ...right])];
}
