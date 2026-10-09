import {
  describe,
  expect,
  it,
  vi
} from "vitest";

import type { CodeGraphNodeDto, CodeRequestChainDto } from "@gitnest/contracts";

import {
  codeNodeDisplayName,
  createCodeChainSearchIndex,
  countSearchableCodeNodes,
  createCodeNodeSearchIndex,
  filterChains,
  filterChainsWithMetadata,
  filterCodeChainIndexWithMetadata,
  getCodeNodeLookup,
  MAX_VISIBLE_CODE_NODES,
  searchCodeNodeIndexWithMetadata,
  searchCodeNodes,
  searchCodeNodesWithMetadata
} from "./codeAnalysisNavigation";

describe("code analysis node search", () => {
  it("shares node selection lookups until the snapshot node array changes", () => {
    const idRead = vi.fn(() => "target");
    const target = node("target", "Target", "function", "src/target.ts");
    Object.defineProperty(target, "id", { get: idRead });
    const nodes = [target];
    const first = getCodeNodeLookup(nodes);
    idRead.mockClear();
    expect(getCodeNodeLookup(nodes)).toBe(first);
    expect(getCodeNodeLookup(nodes).get("target")).toBe(target);
    expect(idRead).not.toHaveBeenCalled();
    const replacement = node("target", "Updated", "function", "src/new.ts");
    expect(getCodeNodeLookup([replacement]).get("target")).toBe(replacement);
  });

  it("reuses chain search text across query edits", () => {
    const chainNodes = Array.from({ length: 20_000 }, (_, index) =>
      node(`node-${index}`, `Node ${index}`, "function", `src/${index}.ts`)
    );
    const chains: CodeRequestChainDto[] = Array.from({ length: 5_000 }, (_, index) => ({
      id: `chain-${index}`,
      profileId: "http",
      transport: "http",
      operationKey: `GET /route/${index}`,
      method: "GET",
      route: `/route/${index}`,
      title: `Route ${index}`,
      clientNodeId: `node-${index}`,
      endpointNodeId: `node-${index + 1}`,
      nodeIds: [`node-${index}`, `node-${index + 1}`],
      edgeIds: [],
      confidence: "exact",
      changed: false,
      ambiguous: false
    }));
    const index = createCodeChainSearchIndex(chains, chainNodes);
    expect(filterCodeChainIndexWithMetadata(index, "", "GET", 3)).toEqual({
      chains: chains.slice(0, 3),
      truncated: true
    });
    expect(index.nodeById).toBeUndefined();
    expect(index.searchText.size).toBe(0);
    const normalization = vi.spyOn(String.prototype, "toLocaleLowerCase");
    filterCodeChainIndexWithMetadata(index, "not-present", "all");
    normalization.mockClear();
    const result = filterCodeChainIndexWithMetadata(index, "node 4999", "all");
    const calls = normalization.mock.calls.length;
    normalization.mockRestore();
    expect(result.chains.map((chain) => chain.id)).toEqual(["chain-4998", "chain-4999"]);
    expect(calls).toBe(1);
    expect(index.searchText.size).toBe(5000);
    expect(filterCodeChainIndexWithMetadata(index, "node 4999", "POST").chains).toEqual([]);
    expect(filterCodeChainIndexWithMetadata(index, "node 4999", "GET", 1)).toEqual({
      chains: [chains[4998]],
      truncated: true
    });
    const refreshedChains = [{ ...chains[0]!, title: "New snapshot content" }];
    expect(filterCodeChainIndexWithMetadata(
      createCodeChainSearchIndex(refreshedChains, chainNodes),
      "new snapshot",
      "all"
    ).chains).toEqual(refreshedChains);
    // One-off public calls do not retain stale text if their input is mutable.
    expect(filterChainsWithMetadata(refreshedChains, chainNodes, "new snapshot", "all").chains).toHaveLength(1);
    refreshedChains[0]!.title = "Changed caller-owned content";
    expect(filterChainsWithMetadata(refreshedChains, chainNodes, "new snapshot", "all").chains).toHaveLength(0);
  });

  const nodes = [
    node("file", "Material.ts", "file", "src/api/Material.ts"),
    node(
      "load",
      "loadMaterial",
      "function",
      "src/api/Material.ts",
      "MaterialApi.loadMaterial"
    ),
    node(
      "save",
      "saveMaterial",
      "method",
      "src/services/MaterialService.ts",
      "MaterialService.saveMaterial"
    ),
    node(
      "endpoint",
      "GET /resource/info",
      "server-endpoint",
      "server/ResourceController.java"
    ),
    node(
      "rpc-client",
      "getResource",
      "rpc-client",
      "core/resource-tag-client/ResourceCli.java",
      "example.client.ResourceCli.getResource"
    ),
    node(
      "rpc-handler",
      "getResource",
      "rpc-handler",
      "svr/ResourceSvr/ResourceProc.java",
      "example.server.ResourceSvr.proc.ResourceProc.getResource"
    )
  ];

  it("matches names, qualified names, and paths case-insensitively", () => {
    expect(searchCodeNodes(nodes, "LOAD")[0]?.id).toBe("load");
    expect(
      searchCodeNodes(nodes, "materialservice")[0]?.id
    ).toBe("save");
    expect(
      searchCodeNodes(nodes, "resourcecontroller")[0]?.id
    ).toBe("endpoint");
  });

  it("reuses precomputed normalized node text while the query changes", () => {
    const searchIndex = createCodeNodeSearchIndex(nodes);
    const normalizeSpy = vi.spyOn(
      String.prototype,
      "toLocaleLowerCase"
    );
    normalizeSpy.mockClear();
    let resultId: string | undefined;
    let normalizationCalls = 0;
    try {
      const result = searchCodeNodeIndexWithMetadata(
        searchIndex,
        "resourcecontroller"
      );
      resultId = result.nodes[0]?.id;
      normalizationCalls = normalizeSpy.mock.calls.length;
    } finally {
      normalizeSpy.mockRestore();
    }

    expect(searchIndex).toHaveLength(nodes.length);
    expect(resultId).toBe("endpoint");
    expect(normalizationCalls).toBe(1);
  });

  it("includes every supported node kind in code-node results", () => {
    expect(countSearchableCodeNodes(nodes)).toBe(6);
    expect(
      searchCodeNodes(nodes, "").map((result) => result.id)
    ).toContain("file");
  });

  it("searches RPC nodes and chain profile metadata", () => {
    expect(
      searchCodeNodes(nodes, "resourcecli")[0]?.id
    ).toBe("rpc-client");

    const rpcChain = {
      id: "rpc-chain",
      profileId: "fai-cli-rpc",
      transport: "rpc" as const,
      operationKey: "ResourceDef.Protocol.GET_RESOURCE",
      method: "RPC",
      route: "ResourceDef.Protocol.GET_RESOURCE",
      title: "Get resource",
      clientNodeId: "rpc-client",
      endpointNodeId: "rpc-handler",
      nodeIds: ["rpc-client", "rpc-handler"],
      edgeIds: ["rpc-request"],
      changed: false,
      ambiguous: false,
      confidence: "exact" as const
    };

    expect(
      filterChains(
        [rpcChain],
        nodes,
        "fai-cli-rpc",
        "all"
      )
    ).toEqual([rpcChain]);
    expect(
      filterChains(
        [rpcChain],
        nodes,
        "get_resource",
        "RPC"
      )
    ).toEqual([rpcChain]);
  });

  it("bounds request-chain rendering and per-chain node search work", () => {
    const chains = Array.from({ length: 300 }, (_, index) => ({
      id: `chain-${index}`,
      profileId: "http",
      transport: "http" as const,
      operationKey: `GET /items/${index}`,
      method: "GET",
      route: `/items/${index}`,
      title: `Item ${index}`,
      clientNodeId: "load",
      endpointNodeId: "endpoint",
      nodeIds: [
        ...Array.from(
          { length: 80 },
          (_, nodeIndex) => `ignored-${nodeIndex}`
        ),
        "save"
      ],
      edgeIds: [],
      changed: false,
      ambiguous: false,
      confidence: "exact" as const
    }));

    const result = filterChainsWithMetadata(
      chains,
      nodes,
      "",
      "all",
      25
    );

    expect(result.chains).toHaveLength(25);
    expect(result.truncated).toBe(true);
    expect(
      filterChains(chains, nodes, "materialservice", "all")
    ).toEqual([]);
  });

  it("finds nested Java symbols by their qualified owner name", () => {
    const nestedField = node(
      "open-guide",
      "OPEN_GUIDE",
      "property",
      "src/main/java/example/app/ProfileDef.java",
      "ProfileDef.Flag.OPEN_GUIDE"
    );

    expect(
      searchCodeNodes(
        [...nodes, nestedField],
        "ProfileDef.Flag"
      ).map((result) => result.id)
    ).toContain("open-guide");
  });

  it("shows qualified owners for nested types and properties", () => {
    expect(
      codeNodeDisplayName(
        node(
          "flag",
          "Flag",
          "class",
          "ProfileDef.java",
          "ProfileDef.Flag"
        )
      )
    ).toBe("ProfileDef.Flag");
    expect(
      codeNodeDisplayName(
        node(
          "open-guide",
          "OPEN_GUIDE",
          "property",
          "ProfileDef.java",
          "ProfileDef.Flag.OPEN_GUIDE"
        )
      )
    ).toBe("ProfileDef.Flag.OPEN_GUIDE");
    expect(
      codeNodeDisplayName(
        node(
          "enabled",
          "enabled",
          "method",
          "ProfileServiceImpl.java",
          "ProfileServiceImpl.enabled"
        )
      )
    ).toBe("enabled");
  });

  it("reports code-node truncation only when the filtered matches exceed the visible limit", () => {
    const manyNodes = Array.from(
      { length: MAX_VISIBLE_CODE_NODES + 1 },
      (_, index) =>
        node(
          `node-${index}`,
          `Node ${index}`,
          "function",
          `src/node-${index}.ts`
        )
    );

    const truncated = searchCodeNodesWithMetadata(
      manyNodes,
      ""
    );
    expect(truncated.nodes).toHaveLength(
      MAX_VISIBLE_CODE_NODES
    );
    expect(truncated.truncated).toBe(true);

    const exact = searchCodeNodesWithMetadata(
      manyNodes.slice(0, MAX_VISIBLE_CODE_NODES),
      ""
    );
    expect(exact.nodes).toHaveLength(
      MAX_VISIBLE_CODE_NODES
    );
    expect(exact.truncated).toBe(false);

    const narrowed = searchCodeNodesWithMetadata(
      manyNodes,
      "node 120"
    );
    expect(narrowed.nodes).toHaveLength(1);
    expect(narrowed.truncated).toBe(false);
  });

});

function node(
  id: string,
  name: string,
  kind: CodeGraphNodeDto["kind"],
  path: string,
  qualifiedName = name
): CodeGraphNodeDto {
  return {
    id,
    kind,
    name,
    qualifiedName,
    language: "typescript",
    location: {
      repositoryId: "repository",
      worktreeId: "worktree",
      path,
      line: 1,
      column: 1
    },
    changed: false,
    source: "builtin",
    confidence: "exact",
    metadata: {}
  };
}
