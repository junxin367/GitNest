import { describe, expect, it } from "vitest";

import {
  analyzeChangeImpact,
  collectSubgraph,
  findRequestChains,
  listGraphDiagnostics,
  resolveRequestChain,
  searchGraphNodes,
  toRequestChainSteps,
  type CodeAnalysisSnapshot,
  type CodeGraphEdge,
  type CodeGraphNode
} from "./index";

function node(
  id: string,
  overrides: Partial<CodeGraphNode> = {}
): CodeGraphNode {
  return {
    id,
    kind: "function",
    name: id,
    qualifiedName: `pkg.${id}`,
    language: "typescript",
    location: {
      repositoryId: "repo-1",
      worktreeId: "worktree-1",
      path: `src/${id}.ts`,
      line: 10,
      column: 1
    },
    changed: false,
    source: "builtin",
    confidence: "exact",
    metadata: {},
    ...overrides
  };
}

function edge(
  id: string,
  from: string,
  to: string,
  kind: CodeGraphEdge["kind"] = "calls"
): CodeGraphEdge {
  return { id, from, to, kind, confidence: "exact" };
}

function snapshot(
  overrides: Partial<CodeAnalysisSnapshot> = {}
): CodeAnalysisSnapshot {
  const nodes = [
    node("client", {
      kind: "client-request",
      name: "fetchUsers",
      changed: true
    }),
    node("endpoint", {
      kind: "server-endpoint",
      name: "listUsers",
      language: "java"
    }),
    node("service", { name: "userService", language: "java" }),
    node("unrelated", { name: "other" })
  ];
  const edges = [
    edge("e1", "client", "endpoint", "http-request"),
    edge("e2", "endpoint", "service")
  ];
  return {
    schemaVersion: 1,
    analysisId: "analysis-1",
    workspaceId: "workspace-1",
    scope: "workspace",
    generatedAt: "2026-09-23T10:00:00.000Z",
    roots: [
      {
        repositoryId: "repo-1",
        worktreeId: "worktree-1",
        name: "repo",
        path: "C:/repo"
      }
    ],
    nodes,
    edges,
    requestChains: [
      {
        id: "chain-1",
        profileId: "web-http",
        transport: "http",
        operationKey: "GET /api/users",
        method: "GET",
        route: "/api/users",
        title: "GET /api/users",
        clientNodeId: "client",
        endpointNodeId: "endpoint",
        nodeIds: ["client", "endpoint", "service"],
        edgeIds: ["e1", "e2"],
        changed: true,
        ambiguous: false,
        confidence: "exact"
      }
    ],
    languageServers: [],
    diagnostics: [
      {
        id: "d1",
        kind: "unresolved-call",
        severity: "warning",
        message: "unresolved",
        evidence: "src/a.ts:10",
        relatedNodeIds: ["client"]
      },
      {
        id: "d2",
        kind: "partial-index",
        severity: "info",
        message: "partial",
        evidence: "src/a.ts",
        relatedNodeIds: []
      }
    ],
    warnings: [],
    stats: {
      discoveredFiles: 4,
      analyzedFiles: 4,
      cachedFiles: 0,
      skippedFiles: 0,
      symbolCount: nodes.length,
      edgeCount: edges.length,
      requestChainCount: 1,
      truncated: false,
      durationMs: 1
    },
    ...overrides
  };
}

describe("searchGraphNodes", () => {
  it("ranks exact names first and respects filters", () => {
    const result = searchGraphNodes(snapshot(), {
      query: "userService"
    });
    expect(result.nodes[0]?.id).toBe("service");
    expect(result.totalMatches).toBeGreaterThan(0);

    const changedOnly = searchGraphNodes(snapshot(), {
      query: "users",
      changedOnly: true
    });
    expect(changedOnly.nodes.map((entry) => entry.id)).toEqual([
      "client"
    ]);

    const byKind = searchGraphNodes(snapshot(), {
      query: "list",
      kinds: ["server-endpoint"]
    });
    expect(byKind.nodes.map((entry) => entry.id)).toEqual([
      "endpoint"
    ]);
  });

  it("reports truncation and rejects non-matches", () => {
    const limited = searchGraphNodes(snapshot(), {
      query: "s",
      limit: 1
    });
    expect(limited.nodes).toHaveLength(1);
    expect(limited.truncated).toBe(true);

    const none = searchGraphNodes(snapshot(), {
      query: "definitely-absent"
    });
    expect(none.totalMatches).toBe(0);
    expect(none.nodes).toEqual([]);
  });
});

describe("findRequestChains / resolveRequestChain", () => {
  it("filters by transport, changed flag and text", () => {
    const all = findRequestChains(snapshot(), {});
    expect(all.totalMatches).toBe(1);
    expect(findRequestChains(snapshot(), { query: "users" }).totalMatches)
      .toBe(1);
    expect(
      findRequestChains(snapshot(), { transport: "rpc" }).totalMatches
    ).toBe(0);
    expect(
      findRequestChains(snapshot(), { changedOnly: true }).totalMatches
    ).toBe(1);
  });

  it("resolves by chain id, node id and route", () => {
    const base = snapshot();
    expect(resolveRequestChain(base, { chainId: "chain-1" }).chain?.id)
      .toBe("chain-1");
    expect(resolveRequestChain(base, { nodeId: "service" }).chain?.id)
      .toBe("chain-1");
    expect(resolveRequestChain(base, { route: "/api/users" }).chain?.id)
      .toBe("chain-1");
    expect(resolveRequestChain(base, { chainId: "missing" }).chain)
      .toBeUndefined();
  });

  it("returns candidates instead of guessing when ambiguous", () => {
    const chain = snapshot().requestChains[0]!;
    const ambiguous = snapshot({
      requestChains: [
        chain,
        { ...chain, id: "chain-2", route: "/api/users" }
      ]
    });
    const resolution = resolveRequestChain(ambiguous, {
      nodeId: "endpoint"
    });
    expect(resolution.chain).toBeUndefined();
    expect(resolution.candidates).toHaveLength(2);
  });

  it("builds ordered steps with incoming edges", () => {
    const steps = toRequestChainSteps(snapshot(), {
      ...snapshot().requestChains[0]!
    });
    expect(steps.map((step) => step.node.id)).toEqual([
      "client",
      "endpoint",
      "service"
    ]);
    expect(steps[0]?.incomingEdge).toBeUndefined();
    expect(steps[1]?.incomingEdge?.kind).toBe("http-request");
    expect(steps[2]?.incomingEdge?.kind).toBe("calls");
  });
});

describe("collectSubgraph", () => {
  it("expands by direction and depth and reports unknown seeds", () => {
    const base = snapshot();
    const out = collectSubgraph(base, {
      nodeIds: ["client"],
      direction: "out",
      depth: 2
    });
    expect(out.nodes.map((entry) => entry.id).sort()).toEqual([
      "client",
      "endpoint",
      "service"
    ]);
    expect(out.unknownNodeIds).toEqual([]);

    const incoming = collectSubgraph(base, {
      nodeIds: ["service"],
      direction: "in",
      depth: 1
    });
    expect(incoming.nodes.map((entry) => entry.id).sort()).toEqual([
      "endpoint",
      "service"
    ]);

    const missing = collectSubgraph(base, {
      nodeIds: ["nope"],
      depth: 1
    });
    expect(missing.nodes).toEqual([]);
    expect(missing.unknownNodeIds).toEqual(["nope"]);
  });

  it("truncates on node and depth budgets", () => {
    const limited = collectSubgraph(snapshot(), {
      nodeIds: ["client"],
      direction: "out",
      depth: 2,
      maxNodes: 2
    });
    expect(limited.truncated).toBe(true);
    expect(limited.nodes.length).toBeLessThanOrEqual(2);
    expect(limited.truncationReasons).toContain("max-nodes");

    const shallow = collectSubgraph(snapshot(), {
      nodeIds: ["client"],
      direction: "out",
      depth: 1
    });
    expect(shallow.truncationReasons).toContain("max-depth");
  });

  it("filters by edge kind", () => {
    const callsOnly = collectSubgraph(snapshot(), {
      nodeIds: ["client"],
      direction: "out",
      depth: 3,
      edgeKinds: ["calls"]
    });
    expect(callsOnly.nodes.map((entry) => entry.id)).toEqual(["client"]);
  });
});

describe("analyzeChangeImpact", () => {
  it("collects changed nodes, chains and cross-boundary edges", () => {
    const impact = analyzeChangeImpact(snapshot(), {
      changedPaths: ["src/client.ts"],
      depth: 2
    });
    expect(impact.changedNodes.map((entry) => entry.id)).toEqual([
      "client"
    ]);
    expect(impact.affectedChains).toHaveLength(1);
    expect(impact.crossBoundaryEdges.map((entry) => entry.id)).toEqual([
      "e1"
    ]);
    expect(
      impact.downstreamTargets.map((entry) => entry.id)
    ).toContain("service");
  });

  it("accepts explicit node ids and returns empty when nothing matches", () => {
    const byNode = analyzeChangeImpact(snapshot(), {
      nodeIds: ["service"],
      direction: "in",
      depth: 1
    });
    expect(byNode.changedNodes.map((entry) => entry.id)).toEqual([
      "service"
    ]);

    const none = analyzeChangeImpact(snapshot(), {
      changedPaths: ["src/absent.ts"]
    });
    expect(none.changedNodes).toEqual([]);
    expect(none.subgraph.nodes).toEqual([]);
  });
});

describe("listGraphDiagnostics", () => {
  it("filters by kind and severity with truncation", () => {
    const warnings = listGraphDiagnostics(snapshot(), {
      severity: "warning"
    });
    expect(warnings.totalMatches).toBe(1);
    expect(warnings.diagnostics[0]?.kind).toBe("unresolved-call");

    const kinds = listGraphDiagnostics(snapshot(), {
      kinds: ["partial-index"]
    });
    expect(kinds.totalMatches).toBe(1);

    const limited = listGraphDiagnostics(snapshot(), { limit: 1 });
    expect(limited.truncated).toBe(true);
    expect(limited.diagnostics).toHaveLength(1);
  });

  it("tolerates a snapshot without diagnostics", () => {
    const withoutDiagnostics = snapshot();
    delete withoutDiagnostics.diagnostics;
    const result = listGraphDiagnostics(withoutDiagnostics, {});
    expect(result.totalMatches).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });
});
