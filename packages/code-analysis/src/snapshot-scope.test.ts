import { describe, expect, it } from "vitest";

import {
  createChangedAnalysisSnapshot,
  mergeIncrementalWorkspaceSnapshot,
  type CodeAnalysisSnapshot,
  type CodeGraphNode
} from "./index";

describe("createChangedAnalysisSnapshot", () => {
  it("keeps changed nodes, changed-chain members, and adjacent relationships", () => {
    const snapshot = createWorkspaceSnapshot();

    const changed = createChangedAnalysisSnapshot(snapshot);

    expect(changed.scope).toBe("changed");
    expect(changed.nodes.map((node) => node.id)).toEqual([
      "changed-file",
      "changed-function",
      "adjacent-method",
      "chain-client",
      "chain-endpoint"
    ]);
    expect(changed.edges.map((edge) => edge.id)).toEqual([
      "edge-changed",
      "edge-chain",
      "edge-bridge"
    ]);
    expect(
      changed.requestChains.map((chain) => chain.id)
    ).toEqual(["changed-chain"]);
    expect(
      changed.diagnostics?.map((diagnostic) => diagnostic.id)
    ).toEqual(["changed-diagnostic", "related-diagnostic"]);
    expect(changed.stats).toMatchObject({
      symbolCount: 4,
      edgeCount: 3,
      requestChainCount: 1
    });
    expect(snapshot.scope).toBe("workspace");
    expect(snapshot.nodes).toHaveLength(7);
  });

  it("preserves unchanged LSP semantics and connected server state during an incremental workspace refresh", () => {
    const previous = createWorkspaceSnapshot();
    previous.nodes.push({
      ...node("lsp-only-method", "method", false),
      location: {
        repositoryId: "repository",
        worktreeId: "worktree",
        path: "src/semantic.ts",
        line: 5,
        column: 1
      },
      source: "lsp"
    });
    previous.nodes.push(
      node("cached-file-two", "file", false),
      node("cached-file-three", "file", false),
      node("cached-file-four", "file", false)
    );
    previous.languageServers = [
      {
        language: "typescript",
        state: "connected",
        command: "typescript-language-server",
        message: "已连接并增强完整项目。",
        symbolCount: 8,
        semanticCoverage: "complete",
        documentsTotal: 4,
        documentsAnalyzed: 4
      },
      {
        language: "vue",
        state: "connected",
        command: "vue-language-server",
        message: "已连接并增强完整项目。",
        symbolCount: 3,
        semanticCoverage: "partial",
        documentsTotal: 2,
        documentsAnalyzed: 2
      }
    ];
    previous.indexStatus = {
      fullIndexAvailable: true,
      resultCompleteness: "partial",
      impactCoverage: "possible-omissions",
      message: "完整项目的 Vue 语义增强部分可用。"
    };
    previous.stats.analyzedFiles = 4;
    previous.stats.discoveredFiles = 4;

    const refreshed = createWorkspaceSnapshot();
    refreshed.analysisId = "incremental-refresh";
    refreshed.generatedAt = "2026-09-24T09:00:00.000Z";
    refreshed.languageServers = [
      {
        language: "typescript",
        state: "disabled",
        command: "typescript-language-server",
        message: "当前范围没有对应语言文件。",
        symbolCount: 0,
        semanticCoverage: "complete",
        documentsTotal: 0,
        documentsAnalyzed: 0
      },
      {
        language: "java",
        state: "disabled",
        command: "jdtls",
        message: "当前范围没有对应语言文件。",
        symbolCount: 0,
        semanticCoverage: "complete",
        documentsTotal: 0,
        documentsAnalyzed: 0
      }
    ];
    refreshed.indexStatus = {
      fullIndexAvailable: true,
      resultCompleteness: "partial",
      impactCoverage: "possible-omissions",
      message:
        "缓存中的完整项目索引缺少完整的 Language Server 语义增强；请重新运行完整项目分析。"
    };
    refreshed.stats.analyzedFiles = 0;
    refreshed.stats.discoveredFiles = 0;

    const merged = mergeIncrementalWorkspaceSnapshot(
      previous,
      refreshed,
      []
    );

    expect(merged.analysisId).toBe("incremental-refresh");
    expect(
      merged.nodes.find(
        (candidate) => candidate.id === "lsp-only-method"
      )
    ).toMatchObject({
      source: "lsp",
      changed: false
    });
    expect(merged.languageServers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          language: "typescript",
          state: "connected"
        }),
        expect.objectContaining({
          language: "vue",
          state: "connected"
        })
      ])
    );
    expect(merged.indexStatus?.message).toBe(
      "完整项目的 Vue 语义增强部分可用。"
    );
    expect(merged.stats).toMatchObject({
      analyzedFiles: 4,
      discoveredFiles: 4,
      cachedFiles: 4
    });
  });
});

function createWorkspaceSnapshot(): CodeAnalysisSnapshot {
  const nodes = [
    node("changed-file", "file", true),
    node("changed-function", "function", true),
    node("adjacent-method", "method", false),
    node("chain-client", "client-request", false),
    node("chain-endpoint", "server-endpoint", false),
    node("unrelated-method", "method", false),
    node("unrelated-endpoint", "server-endpoint", false)
  ];
  return {
    schemaVersion: 1,
    analysisId: "workspace-analysis",
    workspaceId: "workspace",
    scope: "workspace",
    generatedAt: "2026-09-24T08:00:00.000Z",
    roots: [
      {
        repositoryId: "repository",
        worktreeId: "worktree",
        name: "Repository",
        path: "C:\\workspace\\repository",
        revision: "head"
      }
    ],
    nodes,
    edges: [
      edge(
        "edge-changed",
        "changed-function",
        "adjacent-method"
      ),
      edge("edge-chain", "chain-client", "chain-endpoint"),
      edge("edge-bridge", "adjacent-method", "chain-client"),
      edge(
        "edge-unrelated",
        "unrelated-method",
        "unrelated-endpoint"
      )
    ],
    requestChains: [
      {
        id: "changed-chain",
        profileId: "web-http",
        transport: "http",
        operationKey: "GET /changed",
        method: "GET",
        route: "/changed",
        title: "Changed request",
        clientNodeId: "chain-client",
        endpointNodeId: "chain-endpoint",
        nodeIds: ["chain-client", "chain-endpoint"],
        edgeIds: ["edge-chain"],
        changed: true,
        ambiguous: false,
        confidence: "exact"
      },
      {
        id: "unchanged-chain",
        profileId: "web-http",
        transport: "http",
        operationKey: "GET /unrelated",
        method: "GET",
        route: "/unrelated",
        title: "Unrelated request",
        clientNodeId: "unrelated-method",
        endpointNodeId: "unrelated-endpoint",
        nodeIds: [
          "unrelated-method",
          "unrelated-endpoint"
        ],
        edgeIds: ["edge-unrelated"],
        changed: false,
        ambiguous: false,
        confidence: "exact"
      }
    ],
    languageServers: [],
    diagnostics: [
      {
        id: "changed-diagnostic",
        kind: "unresolved-call",
        severity: "warning",
        message: "Changed node warning",
        evidence: "changed",
        nodeId: "changed-function",
        relatedNodeIds: []
      },
      {
        id: "related-diagnostic",
        kind: "ambiguous-target",
        severity: "info",
        message: "Adjacent node warning",
        evidence: "adjacent",
        relatedNodeIds: ["adjacent-method"]
      },
      {
        id: "unrelated-diagnostic",
        kind: "unresolved-call",
        severity: "warning",
        message: "Unrelated warning",
        evidence: "unrelated",
        nodeId: "unrelated-method",
        relatedNodeIds: []
      },
      {
        id: "global-diagnostic",
        kind: "partial-index",
        severity: "warning",
        message: "Global warning",
        evidence: "global",
        relatedNodeIds: []
      }
    ],
    warnings: [],
    stats: {
      discoveredFiles: 4,
      analyzedFiles: 4,
      cachedFiles: 0,
      skippedFiles: 0,
      symbolCount: 6,
      edgeCount: 4,
      requestChainCount: 2,
      truncated: false,
      durationMs: 20
    }
  };
}

function node(
  id: string,
  kind: CodeGraphNode["kind"],
  changed: boolean
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
    changed,
    source: "builtin",
    confidence: "exact",
    metadata: {}
  };
}

function edge(id: string, from: string, to: string) {
  return {
    id,
    from,
    to,
    kind: "calls" as const,
    confidence: "exact" as const
  };
}
