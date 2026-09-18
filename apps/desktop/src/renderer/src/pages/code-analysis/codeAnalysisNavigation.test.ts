import {
  describe,
  expect,
  it
} from "vitest";

import type { CodeGraphNodeDto } from "@gitnest/contracts";

import {
  countSearchableCodeNodes,
  filterChains,
  searchCodeNodes
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

  it("keeps files out of function results", () => {
    expect(countSearchableCodeNodes(nodes)).toBe(5);
    expect(
      searchCodeNodes(nodes, "").map((result) => result.id)
    ).not.toContain("file");
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
