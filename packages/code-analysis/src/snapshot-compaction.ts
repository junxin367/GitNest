import type {
  CodeAnalysisDiagnostic,
  CodeAnalysisSnapshot,
  CodeGraphEdge,
  CodeGraphNode,
  CodeRequestChain
} from "./model";
import { MAX_ANALYSIS_SNAPSHOT_PAYLOAD_BYTES } from "./analysis-cache";

export const TARGET_ANALYSIS_SNAPSHOT_PAYLOAD_BYTES =
  MAX_ANALYSIS_SNAPSHOT_PAYLOAD_BYTES -
  4 * 1_024 * 1_024;

const COMPACTION_WARNING =
  "分析结果体积过大，已自动精简以便展示；请求链与关键端点会优先保留。";
const GRAPH_COMPACTION_WARNING =
  "部分低优先级节点、关系或诊断已省略，可缩小分析范围后重新运行以查看完整细节。";
const COMPACTION_STATUS_NOTE =
  "结果已为安全传输进行精简，部分说明文本或低优先级关系可能省略。";
const COMPACTION_DIAGNOSTIC_ID =
  "diagnostic_snapshot-payload-compacted";
const MAX_METADATA_TEXT_CHARACTERS = 512;
const MAX_EDGE_TEXT_CHARACTERS = 256;
const MAX_DIAGNOSTIC_TEXT_CHARACTERS = 512;
const MAX_STATUS_TEXT_CHARACTERS = 1_024;

const KEY_NODE_KINDS = new Set<CodeGraphNode["kind"]>([
  "client-request",
  "server-endpoint",
  "rpc-client",
  "rpc-handler"
]);

export function compactCodeAnalysisSnapshotPayload(
  snapshot: CodeAnalysisSnapshot,
  maximumBytes: number =
    TARGET_ANALYSIS_SNAPSHOT_PAYLOAD_BYTES
): CodeAnalysisSnapshot {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes <= 0
  ) {
    throw new Error(
      "Code analysis snapshot payload limit must be a positive integer."
    );
  }
  if (snapshotPayloadSize(snapshot) <= maximumBytes) {
    return snapshot;
  }

  const textCompacted = compactVerbosePayload(snapshot);
  if (snapshotPayloadSize(textCompacted) <= maximumBytes) {
    return textCompacted;
  }

  const graphCompacted = compactGraphPayload(
    textCompacted,
    maximumBytes
  );
  const compactedSize = snapshotPayloadSize(graphCompacted);
  if (compactedSize > maximumBytes) {
    throw new Error(
      `Code analysis snapshot payload could not be compacted below the ${maximumBytes}-byte safety target.`
    );
  }
  return graphCompacted;
}

function compactVerbosePayload(
  snapshot: CodeAnalysisSnapshot
): CodeAnalysisSnapshot {
  const chainNodeIds = new Set(
    snapshot.requestChains.flatMap((chain) => [
      chain.clientNodeId,
      chain.endpointNodeId,
      ...chain.nodeIds
    ])
  );
  const chainEdgeIds = new Set(
    snapshot.requestChains.flatMap(
      (chain) => chain.edgeIds
    )
  );
  const diagnostics = [
    payloadCompactionDiagnostic(),
    ...(snapshot.diagnostics ?? [])
      .filter(
        (diagnostic) =>
          diagnostic.id !== COMPACTION_DIAGNOSTIC_ID
      )
      .map(compactDiagnosticText)
  ];

  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) => ({
      ...node,
      metadata: compactNodeMetadata(
        node.metadata,
        chainNodeIds.has(node.id) ||
          KEY_NODE_KINDS.has(node.kind)
      )
    })),
    edges: snapshot.edges.map((edge) =>
      compactEdge(
        edge,
        chainEdgeIds.has(edge.id) ||
          edge.kind === "http-request" ||
          edge.kind === "rpc-request"
      )
    ),
    requestChains: snapshot.requestChains.map(
      compactRequestChain
    ),
    languageServers: snapshot.languageServers.map(
      (server) => ({
        ...server,
        message: compactText(
          server.message,
          MAX_DIAGNOSTIC_TEXT_CHARACTERS
        )
      })
    ),
    indexStatus: compactIndexStatus(
      snapshot.indexStatus
    ),
    diagnostics,
    warnings: appendUnique(
      snapshot.warnings.map((warning) =>
        compactText(
          warning,
          MAX_DIAGNOSTIC_TEXT_CHARACTERS
        )
      ),
      COMPACTION_WARNING
    ),
    stats: {
      ...snapshot.stats,
      truncated: true
    }
  };
}

function compactGraphPayload(
  snapshot: CodeAnalysisSnapshot,
  maximumBytes: number
): CodeAnalysisSnapshot {
  const rankedChains = rankItems(
    snapshot.requestChains,
    requestChainPriority
  );
  const nodeById = new Map(
    snapshot.nodes.map((node) => [node.id, node])
  );
  const rankedEdges = rankItems(
    snapshot.edges,
    (edge) => edgePriority(edge, nodeById)
  );
  const rankedNodes = rankItems(
    snapshot.nodes,
    nodePriority
  );
  const criticalNodeCount = rankedNodes.filter(
    (node) =>
      node.changed || KEY_NODE_KINDS.has(node.kind)
  ).length;

  let chainCount = rankedChains.length;
  let edgeCount = rankedEdges.length;
  let nodeCount = rankedNodes.length;
  let diagnosticCount =
    snapshot.diagnostics?.length ?? 0;

  const build = () =>
    buildGraphSubset(snapshot, {
      rankedChains,
      rankedEdges,
      rankedNodes,
      chainCount,
      edgeCount,
      nodeCount,
      diagnosticCount
    });
  let candidate = build();
  let size = snapshotPayloadSize(candidate);

  if (size > maximumBytes && diagnosticCount > 1) {
    diagnosticCount = 1;
    candidate = build();
    size = snapshotPayloadSize(candidate);
  }
  if (
    size > maximumBytes &&
    nodeCount > criticalNodeCount
  ) {
    nodeCount = criticalNodeCount;
    candidate = build();
    size = snapshotPayloadSize(candidate);
  }
  while (size > maximumBytes && edgeCount > 0) {
    edgeCount = reducedCollectionSize(
      edgeCount,
      size,
      maximumBytes
    );
    candidate = build();
    size = snapshotPayloadSize(candidate);
  }
  if (size > maximumBytes && nodeCount > 0) {
    nodeCount = 0;
    candidate = build();
    size = snapshotPayloadSize(candidate);
  }
  if (size > maximumBytes && diagnosticCount > 0) {
    diagnosticCount = 0;
    candidate = build();
    size = snapshotPayloadSize(candidate);
  }
  while (size > maximumBytes && chainCount > 0) {
    chainCount = reducedCollectionSize(
      chainCount,
      size,
      maximumBytes
    );
    candidate = build();
    size = snapshotPayloadSize(candidate);
  }

  return candidate;
}

interface GraphSubsetSelection {
  rankedChains: CodeRequestChain[];
  rankedEdges: CodeGraphEdge[];
  rankedNodes: CodeGraphNode[];
  chainCount: number;
  edgeCount: number;
  nodeCount: number;
  diagnosticCount: number;
}

function buildGraphSubset(
  snapshot: CodeAnalysisSnapshot,
  selection: GraphSubsetSelection
): CodeAnalysisSnapshot {
  const selectedChains = selection.rankedChains.slice(
    0,
    selection.chainCount
  );
  const selectedChainIds = new Set(
    selectedChains.map((chain) => chain.id)
  );
  const selectedEdgeIds = new Set(
    selection.rankedEdges
      .slice(0, selection.edgeCount)
      .map((edge) => edge.id)
  );
  const selectedNodeIds = new Set(
    selection.rankedNodes
      .slice(0, selection.nodeCount)
      .map((node) => node.id)
  );
  for (const chain of selectedChains) {
    selectedNodeIds.add(chain.clientNodeId);
    selectedNodeIds.add(chain.endpointNodeId);
    for (const nodeId of chain.nodeIds) {
      selectedNodeIds.add(nodeId);
    }
    for (const edgeId of chain.edgeIds) {
      selectedEdgeIds.add(edgeId);
    }
  }

  const edgeById = new Map(
    snapshot.edges.map((edge) => [edge.id, edge])
  );
  for (const edgeId of selectedEdgeIds) {
    const edge = edgeById.get(edgeId);
    if (!edge) {
      continue;
    }
    selectedNodeIds.add(edge.from);
    selectedNodeIds.add(edge.to);
  }

  const nodes = snapshot.nodes.filter((node) =>
    selectedNodeIds.has(node.id)
  );
  const availableNodeIds = new Set(
    nodes.map((node) => node.id)
  );
  const edges = snapshot.edges.filter(
    (edge) =>
      selectedEdgeIds.has(edge.id) &&
      availableNodeIds.has(edge.from) &&
      availableNodeIds.has(edge.to)
  );
  const availableEdgeIds = new Set(
    edges.map((edge) => edge.id)
  );
  const requestChains = snapshot.requestChains.filter(
    (chain) =>
      selectedChainIds.has(chain.id) &&
      availableNodeIds.has(chain.clientNodeId) &&
      availableNodeIds.has(chain.endpointNodeId) &&
      chain.nodeIds.every((nodeId) =>
        availableNodeIds.has(nodeId)
      ) &&
      chain.edgeIds.every((edgeId) =>
        availableEdgeIds.has(edgeId)
      )
  );
  const graphOmitted =
    nodes.length < snapshot.nodes.length ||
    edges.length < snapshot.edges.length ||
    requestChains.length < snapshot.requestChains.length;
  const diagnostics = (
    snapshot.diagnostics ?? []
  )
    .slice(0, selection.diagnosticCount)
    .map((diagnostic) =>
      retainAvailableDiagnosticReferences(
        diagnostic,
        availableNodeIds
      )
    );
  const indexStatus = graphOmitted
    ? compactIndexStatus(
        snapshot.indexStatus,
        GRAPH_COMPACTION_WARNING
      )
    : snapshot.indexStatus;

  return {
    ...snapshot,
    nodes,
    edges,
    requestChains,
    diagnostics,
    warnings: graphOmitted
      ? appendUnique(
          snapshot.warnings,
          GRAPH_COMPACTION_WARNING
        )
      : snapshot.warnings,
    ...(indexStatus ? { indexStatus } : {}),
    stats: {
      ...snapshot.stats,
      symbolCount: nodes.filter(
        (node) => node.kind !== "file"
      ).length,
      edgeCount: edges.length,
      requestChainCount: requestChains.length,
      truncated: true
    }
  };
}

function compactNodeMetadata(
  metadata: CodeGraphNode["metadata"],
  preserveDocumentation: boolean
): CodeGraphNode["metadata"] {
  const compacted: Record<
    string,
    string | number | boolean
  > = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key === "semanticId") {
      continue;
    }
    if (key === "documentation") {
      if (
        preserveDocumentation &&
        typeof value === "string"
      ) {
        compacted[key] = compactText(
          value,
          MAX_METADATA_TEXT_CHARACTERS
        );
      }
      continue;
    }
    compacted[key] =
      typeof value === "string"
        ? compactText(
            value,
            MAX_METADATA_TEXT_CHARACTERS
          )
        : value;
  }
  return compacted;
}

function compactEdge(
  edge: CodeGraphEdge,
  preserveEvidence: boolean
): CodeGraphEdge {
  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    confidence: edge.confidence,
    ...(edge.label !== undefined
      ? {
          label: compactText(
            edge.label,
            MAX_EDGE_TEXT_CHARACTERS
          )
        }
      : {}),
    ...(edge.source !== undefined
      ? { source: edge.source }
      : {}),
    ...(preserveEvidence && edge.evidence !== undefined
      ? {
          evidence: compactText(
            edge.evidence,
            MAX_EDGE_TEXT_CHARACTERS
          )
        }
      : {})
  };
}

function compactRequestChain(
  chain: CodeRequestChain
): CodeRequestChain {
  return {
    ...chain,
    operationKey: compactText(
      chain.operationKey,
      MAX_METADATA_TEXT_CHARACTERS
    ),
    method: compactText(chain.method, 64),
    route: compactText(
      chain.route,
      MAX_METADATA_TEXT_CHARACTERS
    ),
    title: compactText(
      chain.title,
      MAX_METADATA_TEXT_CHARACTERS
    )
  };
}

function compactDiagnosticText(
  diagnostic: CodeAnalysisDiagnostic
): CodeAnalysisDiagnostic {
  return {
    ...diagnostic,
    message: compactText(
      diagnostic.message,
      MAX_DIAGNOSTIC_TEXT_CHARACTERS
    ),
    evidence: compactText(
      diagnostic.evidence,
      MAX_DIAGNOSTIC_TEXT_CHARACTERS
    )
  };
}

function compactIndexStatus(
  indexStatus: CodeAnalysisSnapshot["indexStatus"],
  additionalNote?: string
): NonNullable<CodeAnalysisSnapshot["indexStatus"]> {
  const note = additionalNote
    ? `${COMPACTION_STATUS_NOTE} ${additionalNote}`
    : COMPACTION_STATUS_NOTE;
  if (!indexStatus) {
    return {
      fullIndexAvailable: false,
      resultCompleteness: "partial",
      impactCoverage: "possible-omissions",
      message: compactText(
        note,
        MAX_STATUS_TEXT_CHARACTERS
      )
    };
  }
  return {
    ...indexStatus,
    resultCompleteness: "partial",
    impactCoverage: "possible-omissions",
    message: compactText(
      `${indexStatus.message} ${note}`,
      MAX_STATUS_TEXT_CHARACTERS
    )
  };
}

function payloadCompactionDiagnostic(): CodeAnalysisDiagnostic {
  return {
    id: COMPACTION_DIAGNOSTIC_ID,
    kind: "partial-index",
    severity: "warning",
    message: "分析结果已自动精简",
    evidence: COMPACTION_STATUS_NOTE,
    relatedNodeIds: []
  };
}

function retainAvailableDiagnosticReferences(
  diagnostic: CodeAnalysisDiagnostic,
  availableNodeIds: ReadonlySet<string>
): CodeAnalysisDiagnostic {
  const { nodeId, ...diagnosticWithoutNodeId } =
    diagnostic;
  return {
    ...diagnosticWithoutNodeId,
    ...(nodeId && availableNodeIds.has(nodeId)
      ? { nodeId }
      : {}),
    relatedNodeIds: diagnostic.relatedNodeIds.filter(
      (nodeId) => availableNodeIds.has(nodeId)
    )
  };
}

function requestChainPriority(
  chain: CodeRequestChain
): number {
  return (
    Number(chain.changed) * 100 +
    Number(!chain.ambiguous) * 20 +
    confidencePriority(chain.confidence)
  );
}

function edgePriority(
  edge: CodeGraphEdge,
  nodeById: ReadonlyMap<string, CodeGraphNode>
): number {
  const kindPriority = {
    "http-request": 100,
    "rpc-request": 100,
    calls: 80,
    extends: 75,
    implements: 75,
    overrides: 75,
    references: 50,
    contains: 20
  } satisfies Record<CodeGraphEdge["kind"], number>;
  return (
    kindPriority[edge.kind] +
    Number(
      nodeById.get(edge.from)?.changed ||
        nodeById.get(edge.to)?.changed
    ) *
      20 +
    confidencePriority(edge.confidence)
  );
}

function nodePriority(node: CodeGraphNode): number {
  const isCritical =
    node.changed || KEY_NODE_KINDS.has(node.kind);
  const kindPriority = KEY_NODE_KINDS.has(node.kind)
    ? 100
    : node.kind === "function" || node.kind === "method"
      ? 60
      : node.kind === "class" ||
          node.kind === "interface" ||
          node.kind === "enum"
        ? 50
        : node.kind === "file"
          ? 30
          : 40;
  return (
    kindPriority +
    Number(isCritical) * 1_000 +
    confidencePriority(node.confidence)
  );
}

function confidencePriority(
  confidence: CodeGraphNode["confidence"]
): number {
  return confidence === "exact"
    ? 3
    : confidence === "probable"
      ? 2
      : 1;
}

function rankItems<Item>(
  items: readonly Item[],
  priority: (item: Item) => number
): Item[] {
  return items
    .map((item, index) => ({
      item,
      index,
      priority: priority(item)
    }))
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        left.index - right.index
    )
    .map(({ item }) => item);
}

function reducedCollectionSize(
  currentCount: number,
  currentBytes: number,
  maximumBytes: number
): number {
  const proportionalCount = Math.floor(
    currentCount *
      (maximumBytes / currentBytes) *
      0.9
  );
  return Math.max(
    0,
    Math.min(currentCount - 1, proportionalCount)
  );
}

function compactText(
  value: string,
  maximumCharacters: number
): string {
  if (value.length <= maximumCharacters) {
    return value;
  }
  return `${value.slice(
    0,
    Math.max(0, maximumCharacters - 1)
  )}…`;
}

function appendUnique(
  values: readonly string[],
  value: string
): string[] {
  return values.includes(value)
    ? [...values]
    : [...values, value];
}

function snapshotPayloadSize(
  snapshot: CodeAnalysisSnapshot
): number {
  return Buffer.byteLength(
    JSON.stringify(snapshot),
    "utf8"
  );
}
