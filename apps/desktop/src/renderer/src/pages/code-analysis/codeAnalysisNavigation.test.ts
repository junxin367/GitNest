import {
  describe,
  expect,
  it
} from "vitest";

import type { CodeGraphNodeDto } from "@gitnest/contracts";

import {
  codeNodeDisplayName,
  countSearchableCodeNodes,
  filterChains,
  filterChainsWithMetadata,
  MAX_VISIBLE_CODE_NODES,
  searchCodeNodes,
  searchCodeNodesWithMetadata
} from "./codeAnalysisNavigation";

describe("code analysis node search", () => {
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
      "core/fai-cli-sc/ScResCli.java",
      "fai.cli.ScResCli.getResource"
    ),
    node(
      "rpc-handler",
      "getResource",
      "rpc-handler",
      "svr/ScResSvr/ScResProc.java",
      "fai.svr.ScResSvr.proc.ScResProc.getResource"
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

  it("includes every supported node kind in code-node results", () => {
    expect(countSearchableCodeNodes(nodes)).toBe(6);
    expect(
      searchCodeNodes(nodes, "").map((result) => result.id)
    ).toContain("file");
  });

  it("searches RPC nodes and chain profile metadata", () => {
    expect(
      searchCodeNodes(nodes, "screscli")[0]?.id
    ).toBe("rpc-client");

    const rpcChain = {
      id: "rpc-chain",
      profileId: "fai-cli-rpc",
      transport: "rpc" as const,
      operationKey: "ScResDef.Protocol.GET_RESOURCE",
      method: "RPC",
      route: "ScResDef.Protocol.GET_RESOURCE",
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
      "src/main/java/fai/app/ScProfDef.java",
      "ScProfDef.Flag.OPEN_GUIDE"
    );

    expect(
      searchCodeNodes(
        [...nodes, nestedField],
        "ScProfDef.Flag"
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
          "ScProfDef.java",
          "ScProfDef.Flag"
        )
      )
    ).toBe("ScProfDef.Flag");
    expect(
      codeNodeDisplayName(
        node(
          "open-guide",
          "OPEN_GUIDE",
          "property",
          "ScProfDef.java",
          "ScProfDef.Flag.OPEN_GUIDE"
        )
      )
    ).toBe("ScProfDef.Flag.OPEN_GUIDE");
    expect(
      codeNodeDisplayName(
        node(
          "enabled",
          "enabled",
          "method",
          "ScProfServiceImpl.java",
          "ScProfServiceImpl.enabled"
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
