import { describe, expect, it } from "vitest";

import type {
  CodeAnalysisSnapshot,
  CodeGraphNode
} from "./model";
import {
  compactCodeAnalysisSnapshotPayload,
  TARGET_ANALYSIS_SNAPSHOT_PAYLOAD_BYTES
} from "./snapshot-compaction";

describe("compactCodeAnalysisSnapshotPayload", () => {
  it("uses a 100 MiB live snapshot target", () => {
    expect(TARGET_ANALYSIS_SNAPSHOT_PAYLOAD_BYTES).toBe(
      100 * 1_024 * 1_024
    );
  });

  it("returns snapshots that already fit without cloning them", () => {
    const snapshot = createSnapshot();

    expect(
      compactCodeAnalysisSnapshotPayload(snapshot, 64 * 1_024)
    ).toBe(snapshot);
  });

  it("keeps request chains and their graph references while trimming oversized optional data", () => {
    const snapshot = createSnapshot();
    snapshot.nodes.push(
      ...Array.from({ length: 80 }, (_, index) =>
        createNode(`optional-${index}`, "function", {
          documentation: "x".repeat(2_000)
        })
      )
    );
    snapshot.edges.push(
      ...snapshot.nodes
        .filter((node) => node.id.startsWith("optional-"))
        .map((node, index) => ({
          id: `optional-edge-${index}`,
          from: "client",
          to: node.id,
          kind: "references" as const,
          confidence: "probable" as const,
          source: "lsp" as const,
          evidence: "e".repeat(1_000)
        }))
    );
    snapshot.stats.symbolCount = snapshot.nodes.length;
    snapshot.stats.edgeCount = snapshot.edges.length;

    const compacted = compactCodeAnalysisSnapshotPayload(
      snapshot,
      8 * 1_024
    );
    const nodeIds = new Set(
      compacted.nodes.map((node) => node.id)
    );
    const edgeIds = new Set(
      compacted.edges.map((edge) => edge.id)
    );

    expect(
      Buffer.byteLength(JSON.stringify(compacted), "utf8")
    ).toBeLessThanOrEqual(8 * 1_024);
    expect(compacted.requestChains).toHaveLength(1);
    expect(nodeIds.has("client")).toBe(true);
    expect(nodeIds.has("endpoint")).toBe(true);
    expect(edgeIds.has("request-edge")).toBe(true);
    expect(
      compacted.edges.every(
        (edge) =>
          nodeIds.has(edge.from) && nodeIds.has(edge.to)
      )
    ).toBe(true);
    expect(
      compacted.requestChains.every(
        (chain) =>
          chain.nodeIds.every((nodeId) =>
            nodeIds.has(nodeId)
          ) &&
          chain.edgeIds.every((edgeId) =>
            edgeIds.has(edgeId)
          )
      )
    ).toBe(true);
    expect(compacted.nodes.length).toBeLessThan(
      snapshot.nodes.length
    );
    expect(compacted.stats).toMatchObject({
      symbolCount: compacted.nodes.filter(
        (node) => node.kind !== "file"
      ).length,
      edgeCount: compacted.edges.length,
      requestChainCount: 1,
      truncated: true
    });
    expect(compacted.indexStatus).toMatchObject({
      resultCompleteness: "partial",
      impactCoverage: "possible-omissions"
    });
    expect(compacted.warnings).toContainEqual(
      expect.stringContaining("已自动精简")
    );
  });
});

function createSnapshot(): CodeAnalysisSnapshot {
  return {
    schemaVersion: 1,
    analysisId: "analysis",
    workspaceId: "workspace",
    scope: "workspace",
    generatedAt: "2026-09-22T00:00:00.000Z",
    roots: [
      {
        repositoryId: "repository",
        worktreeId: "worktree",
        name: "Repository",
        path: "C:\\workspace\\repository",
        revision: "head"
      }
    ],
    nodes: [
      createNode("client", "client-request", {
        httpMethod: "GET",
        route: "/api/users"
      }),
      createNode("endpoint", "server-endpoint", {
        httpMethod: "GET",
        route: "/api/users"
      })
    ],
    edges: [
      {
        id: "request-edge",
        from: "client",
        to: "endpoint",
        kind: "http-request",
        confidence: "exact",
        source: "builtin",
        evidence: "HTTP method and normalized route match"
      }
    ],
    requestChains: [
      {
        id: "chain",
        profileId: "web-http",
        transport: "http",
        operationKey: "GET /api/users",
        method: "GET",
        route: "/api/users",
        title: "GET /api/users",
        clientNodeId: "client",
        endpointNodeId: "endpoint",
        nodeIds: ["client", "endpoint"],
        edgeIds: ["request-edge"],
        changed: true,
        ambiguous: false,
        confidence: "exact"
      }
    ],
    languageServers: [],
    indexStatus: {
      fullIndexAvailable: true,
      resultCompleteness: "complete",
      impactCoverage: "confirmed",
      message: "完整索引"
    },
    diagnostics: [],
    warnings: [],
    stats: {
      discoveredFiles: 82,
      analyzedFiles: 82,
      cachedFiles: 0,
      skippedFiles: 0,
      symbolCount: 2,
      edgeCount: 1,
      requestChainCount: 1,
      truncated: false,
      durationMs: 1
    }
  };
}

function createNode(
  id: string,
  kind: CodeGraphNode["kind"],
  metadata: CodeGraphNode["metadata"]
): CodeGraphNode {
  return {
    id,
    kind,
    name: id,
    qualifiedName: id,
    language: "typescript",
    location: {
      repositoryId: "repository",
      worktreeId: "worktree",
      path: `src/${id}.ts`,
      line: 1,
      column: 1
    },
    changed: id === "client",
    source: "builtin",
    confidence: "exact",
    metadata
  };
}
