import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AnalysisSnapshotCache,
  codeAnalysisSettingsFromPersisted,
  codeAnalysisWorktreeStatusFingerprint,
  type CodeAnalysisSettings,
  type CodeAnalysisSnapshot,
  type CodeGraphNode,
  type PersistedCodeAnalysisSettings
} from "@gitnest/code-analysis";
import { GitNestDataAccess } from "./data-access";
import { McpProtocolServer } from "./protocol";
import { parseServerArgs } from "./server";
import { createTools, type ToolSettings } from "./tools";

const WORKSPACE_ID = "workspace-1";
const REPOSITORY_ID = "repo-1";
const WORKTREE_ID = "worktree-1";
const NOW = Date.parse("2026-09-24T02:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;
const git = promisify(execFile);

let root: string;
let repositoryPath: string;
let settings: CodeAnalysisSettings;
let persisted: PersistedCodeAnalysisSettings;

function persistedPreferences(): PersistedCodeAnalysisSettings {
  const languageServer = {
    enabled: false,
    command: "",
    args: [] as string[],
    maxDocuments: 120,
    maxSymbolsPerDocument: 5_000,
    maxCallHierarchyRequests: 50,
    maxTypeHierarchyRequests: 50,
    maxReferenceRequests: 50,
    maxDocumentationRequests: 50,
    maxReferencesPerSymbol: 500
  };
  return {
    enabled: true,
    staticFallback: true,
    mcp: {
      enabled: true,
      allowSourceSnippets: true,
      maxResponseKb: 256,
      maxStaleAgeDays: 7
    },
    maxFiles: 5_000,
    maxTotalSourceMb: 512,
    maxGraphNodes: 50_000,
    maxGraphEdges: 100_000,
    maxRequestChains: 5_000,
    maxDiagnostics: 2_000,
    maxFileSizeKb: 768,
    readConcurrency: 4,
    graphDepth: 8,
    lspTimeoutMs: 8_000,
    ignoreDirectories: ["node_modules"],
    typescript: { ...languageServer },
    java: { ...languageServer, args: [] }
  };
}

function graphNode(
  id: string,
  overrides: Partial<CodeGraphNode> = {}
): CodeGraphNode {
  return {
    id,
    kind: "function",
    name: id,
    qualifiedName: `pkg.${id}`,
    language: "java",
    location: {
      repositoryId: REPOSITORY_ID,
      worktreeId: WORKTREE_ID,
      path: "src/Demo.java",
      line: 3,
      column: 5
    },
    changed: false,
    source: "builtin",
    confidence: "exact",
    metadata: {},
    ...overrides
  };
}

function snapshot(nodeCount = 0): CodeAnalysisSnapshot {
  const nodes: CodeGraphNode[] = [
    graphNode("client", {
      kind: "client-request",
      language: "typescript",
      name: "fetchGroups",
      qualifiedName: "fetchGroups",
      location: {
        repositoryId: REPOSITORY_ID,
        worktreeId: WORKTREE_ID,
        path: "src/api.ts",
        line: 12,
        column: 3
      },
      changed: true
    }),
    graphNode("endpoint", {
      kind: "server-endpoint",
      name: "listGroups",
      qualifiedName: "DemoController.listGroups"
    }),
    graphNode("service", {
      name: "groupService",
      qualifiedName: "GroupService.list"
    }),
    ...Array.from({ length: nodeCount }, (_value, index) =>
      graphNode(`filler-${index}`, { name: `filler node ${index}` })
    )
  ];
  return {
    schemaVersion: 1,
    analysisId: "analysis-1",
    workspaceId: WORKSPACE_ID,
    scope: "workspace",
    generatedAt: "2026-09-23T02:00:00.000Z",
    roots: [
      {
        repositoryId: REPOSITORY_ID,
        worktreeId: WORKTREE_ID,
        name: "core",
        path: repositoryPath,
        revision: "abc123"
      }
    ],
    nodes,
    edges: [
      {
        id: "e1",
        from: "client",
        to: "endpoint",
        kind: "http-request",
        confidence: "exact"
      },
      {
        id: "e2",
        from: "endpoint",
        to: "service",
        kind: "calls",
        confidence: "exact"
      }
    ],
    requestChains: [
      {
        id: "chain-1",
        profileId: "web-http",
        transport: "http",
        operationKey: "GET /api/groups",
        method: "GET",
        route: "/api/groups",
        title: "GET /api/groups",
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
        relatedNodeIds: ["client"],
        id: "d1",
        kind: "unresolved-call",
        severity: "warning",
        message: "unresolved call",
        evidence: "src/api.ts:12"
      }
    ],
    warnings: [],
    stats: {
      discoveredFiles: 1,
      analyzedFiles: 1,
      cachedFiles: 0,
      skippedFiles: 0,
      symbolCount: nodes.length,
      edgeCount: 2,
      requestChainCount: 1,
      truncated: false,
      durationMs: 5
    }
  };
}

async function writeWorkspaceFiles(head = "abc123"): Promise<void> {
  const catalogPath = join(root, "workspaces", "catalog.json");
  const itemsPath = join(root, "workspaces", "items");
  await mkdir(itemsPath, { recursive: true });
  await writeFile(
    catalogPath,
    JSON.stringify({
      schemaVersion: 3,
      activeWorkspaceId: WORKSPACE_ID,
      workspaces: [
        {
          id: WORKSPACE_ID,
          name: "Fixture",
          updatedAt: "2026-09-23T02:00:00.000Z"
        }
      ],
      updatedAt: "2026-09-23T02:00:00.000Z"
    }),
    "utf8"
  );
  await writeFile(
    join(itemsPath, `${WORKSPACE_ID}.workspace.json`),
    JSON.stringify({
      schemaVersion: 2,
      id: WORKSPACE_ID,
      name: "Fixture",
      excludes: [],
      path: root,
      canonicalPath: root.toLowerCase(),
      lastScannedAt: "2026-09-23T02:00:00.000Z",
      groups: [
        {
          id: "group-1",
          name: "core",
          targets: [
            { repositoryId: REPOSITORY_ID, worktreeId: WORKTREE_ID }
          ],
          collapsed: false
        }
      ],
      scanIssues: [],
      repositories: [
        {
          id: REPOSITORY_ID,
          name: "core",
          commonDir: join(repositoryPath, ".git"),
          canonicalCommonDir: join(
            repositoryPath,
            ".git"
          ).toLowerCase(),
          primaryWorktreeId: WORKTREE_ID,
          worktreeIds: [WORKTREE_ID]
        }
      ],
      worktrees: [
        {
          id: WORKTREE_ID,
          repositoryId: REPOSITORY_ID,
          name: "core",
          path: repositoryPath,
          canonicalPath: repositoryPath.toLowerCase(),
          head,
          isPrimary: true,
          isBare: false,
          isDetached: false,
          isLocked: false,
          isPrunable: false
        }
      ],
      selectedTarget: {
        repositoryId: REPOSITORY_ID,
        worktreeId: WORKTREE_ID
      },
      updatedAt: "2026-09-23T02:00:00.000Z"
    }),
    "utf8"
  );
}

async function writeSettings(
  patch: Partial<PersistedCodeAnalysisSettings> = {}
): Promise<void> {
  const settingsDirectory = join(root, "settings");
  await mkdir(settingsDirectory, { recursive: true });
  await writeFile(
    join(settingsDirectory, "app-settings.json"),
    JSON.stringify({
      schemaVersion: 3,
      codeAnalysis: { ...persisted, ...patch }
    }),
    "utf8"
  );
}

async function writeSnapshot(value: CodeAnalysisSnapshot): Promise<void> {
  const cache = new AnalysisSnapshotCache(
    join(root, "gitnest-state", "code-analysis")
  );
  await cache.save(value, settings);
}

async function initializeGitRepository(): Promise<string> {
  await git("git", ["init", "--quiet"], {
    cwd: repositoryPath
  });
  await git("git", ["add", "src/Demo.java"], {
    cwd: repositoryPath
  });
  await git(
    "git",
    [
      "-c",
      "user.name=GitNest Test",
      "-c",
      "user.email=gitnest@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "base"
    ],
    { cwd: repositoryPath }
  );
  const head = (
    await git("git", ["rev-parse", "HEAD"], {
      cwd: repositoryPath
    })
  ).stdout.trim();
  await writeWorkspaceFiles(head);
  return head;
}

async function writeFreshSnapshot(
  generatedAt = "2026-09-23T02:00:00.000Z"
): Promise<void> {
  const head = await initializeGitRepository();
  const analyzed = snapshot();
  analyzed.generatedAt = generatedAt;
  analyzed.roots[0]!.revision = head;
  analyzed.sourceState = {
    worktreeStatuses: [{
      repositoryId: REPOSITORY_ID,
      worktreeId: WORKTREE_ID,
      fingerprint: codeAnalysisWorktreeStatusFingerprint([])
    }],
    changedSourceFiles: []
  };
  await writeSnapshot(analyzed);
}

function createServer(
  options: Partial<ToolSettings> = {},
  skipFreshness = true
): {
  server: McpProtocolServer;
  callTool: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{
    payload: Record<string, unknown>;
    isError: boolean;
    responseBytes: number;
  }>;
} {
  const access = new GitNestDataAccess({
    dataDirectory: root,
    skipFreshness
  });
  const server = new McpProtocolServer({
    info: { name: "gitnest", version: "test" },
    tools: createTools({
      access,
      readSettings: async () => ({
        ...await access.readMcpSettings(),
        ...options
      }),
      now: () => NOW
    })
  });
  const callTool = async (
    name: string,
    args: Record<string, unknown>
  ) => {
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name,
        arguments:
          name === "get_analysis_projects"
            ? args
            : { projectPath: repositoryPath, ...args }
      }
    });
    const result = (
      response as {
        result: {
          content: Array<{ type: "text"; text: string }>;
          isError?: boolean;
        };
      }
    ).result;
    const payload = JSON.parse(
      result.content[0]?.text ?? "{}"
    ) as Record<string, unknown>;
    if (process.env.MCP_DEBUG) {
      // eslint-disable-next-line no-console
      console.log(name, JSON.stringify(payload).slice(0, 400));
    }
    return {
      payload,
      isError: result.isError === true,
      responseBytes: Buffer.byteLength(
        JSON.stringify(response),
        "utf8"
      )
    };
  };
  return { server, callTool };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "gitnest-mcp-"));
  repositoryPath = join(root, "repo");
  await mkdir(join(repositoryPath, "src"), { recursive: true });
  await writeFile(
    join(repositoryPath, "src", "Demo.java"),
    [
      "package demo;",
      "",
      "class Demo {",
      "  void run() {",
      "    helper();",
      "  }",
      "}"
    ].join("\n"),
    "utf8"
  );
  persisted = persistedPreferences();
  settings = codeAnalysisSettingsFromPersisted(persisted);
  await writeWorkspaceFiles();
  await writeSettings();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("MCP tool surface", () => {
  it("reads a snapshot from the pre-gitnest-state fallback directory", async () => {
    // Snapshots written before the `gitnest-state` layout live in
    // `cache/code-analysis`. A user upgrading GitNest without
    // re-analysing still sees that graph in the app, so MCP has to
    // load it too instead of reporting "no snapshot".
    const legacyCache = new AnalysisSnapshotCache(
      join(root, "cache", "code-analysis")
    );
    await legacyCache.save(snapshot(3), settings);

    const { callTool } = createServer();
    const status = await callTool("get_analysis_status", {});
    expect(status.isError).toBe(false);
    const analyses = status.payload.analyses as Array<{
      scope: string;
      nodeCount: number;
    }>;
    const workspace = analyses.find(
      (entry) => entry.scope === "workspace"
    );
    // snapshot(N) adds N filler nodes on top of three fixed nodes.
    expect(workspace?.nodeCount).toBe(6);
  });

  it("re-parses after the snapshot file is rewritten", async () => {
    // The parsed snapshot is cached per process, so a rewritten file
    // (for example by the CA-5 auto-refresh) must invalidate it.
    await writeSnapshot(snapshot(2));
    const { callTool } = createServer();
    const first = await callTool("get_analysis_status", {});
    const firstAnalyses = first.payload.analyses as Array<{
      scope: string;
      nodeCount: number;
    }>;
    expect(
      firstAnalyses.find((entry) => entry.scope === "workspace")
        ?.nodeCount
    ).toBe(5);

    await writeSnapshot(snapshot(5));
    const second = await callTool("get_analysis_status", {});
    const secondAnalyses = second.payload.analyses as Array<{
      scope: string;
      nodeCount: number;
    }>;
    expect(
      secondAnalyses.find(
        (entry) => entry.scope === "workspace"
      )?.nodeCount
    ).toBe(8);
  });

  it("exposes only project discovery, status and call tracing", async () => {
    const { server } = createServer();
    const response = (await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list"
    })) as {
      result: {
        tools: Array<{
          name: string;
          inputSchema: {
            required?: string[];
            properties: Record<string, unknown>;
          };
        }>;
      };
    };
    expect(response.result.tools.map((tool) => tool.name)).toEqual([
      "get_analysis_projects",
      "get_analysis_status",
      "get_call_chain"
    ]);
    expect(response.result.tools[0]?.inputSchema.properties)
      .toEqual({});
    expect(response.result.tools[1]?.inputSchema.required)
      .toContain("projectPath");
    expect(response.result.tools[1]?.inputSchema.properties)
      .not.toHaveProperty("scope");
    expect(response.result.tools[1]?.inputSchema.properties)
      .toHaveProperty("workspaceId");
    expect(response.result.tools[2]?.inputSchema.required)
      .toEqual(["projectPath", "query"]);
    expect(response.result.tools[2]?.inputSchema.properties)
      .toHaveProperty("language");
    const removed = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "read_code_node_source",
        arguments: { nodeId: "endpoint" }
      }
    });
    expect(removed).toMatchObject({
      error: { code: -32602 }
    });
    const renamed = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "trace_call_chain",
        arguments: { projectPath: repositoryPath, query: "client" }
      }
    });
    expect(renamed).toMatchObject({
      error: { code: -32602 }
    });
  });

  it("reports protocol version and server info on initialize", async () => {
    const { server } = createServer();
    const response = (await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {} }
    })) as {
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    expect(response.result.protocolVersion).toBe("2024-11-05");
    expect(response.result.serverInfo.name).toBe("gitnest");
  });

  it("answers pings and rejects unknown methods", async () => {
    const { server } = createServer();
    const pong = (await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "ping"
    })) as { result: unknown };
    expect(pong.result).toEqual({});
    const unknown = (await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "nope"
    })) as { error?: { code: number } };
    expect(unknown.error?.code).toBe(-32_601);
  });

  it("does not respond to notifications", async () => {
    const { server } = createServer();
    await writeSnapshot(snapshot());
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      method: "notifications/initialized"
    });
    expect(response).toBeUndefined();
  });
});

describe("parseServerArgs", () => {
  it("treats --version as a request to print and exit", () => {
    // Regression: --version used to be accepted but ignored, which
    // silently started the server instead of printing a version.
    const args = parseServerArgs(["--version"]);
    expect(args.version).toBe(true);
    expect(args.selfCheck).toBe(false);

    expect(parseServerArgs(["-v"]).version).toBe(true);
    expect(parseServerArgs([]).version).toBe(false);
  });

  it("parses --data-dir in both forms", () => {
    expect(parseServerArgs(["--data-dir", "C:/x"]).dataDirectory)
      .toBe("C:/x");
    expect(parseServerArgs(["--data-dir=C:/y"]).dataDirectory)
      .toBe("C:/y");
    expect(parseServerArgs(["--self-check"]).selfCheck).toBe(true);
  });

  it("rejects an unknown flag and a missing --data-dir value", () => {
    expect(() => parseServerArgs(["--nope"])).toThrow();
    expect(() => parseServerArgs(["--data-dir"])).toThrow();
  });
});

describe("MCP tool behaviour", () => {
  it("lists registered existing project paths and workspace IDs", async () => {
    const { callTool } = createServer();
    const list = await callTool("get_analysis_projects", {});
    expect(list.isError).toBe(false);
    expect(list.payload.totalProjects).toBe(1);
    expect(list.payload.projects).toEqual([
      {
        projectPath: repositoryPath,
        repositoryName: "core",
        workspaceId: WORKSPACE_ID,
        workspaceName: "Fixture",
        selected: true
      }
    ]);
    const status = await callTool("get_analysis_status", {
      projectPath: repositoryPath,
      workspaceId: WORKSPACE_ID
    });
    expect(status.payload).toMatchObject({
      projectMatched: true,
      hasWorkspaceAnalysis: false,
      useMcp: false
    });

    await rm(repositoryPath, { recursive: true });
    const inaccessible = await callTool(
      "get_analysis_projects",
      {}
    );
    expect(inaccessible.payload).toMatchObject({
      totalProjects: 0,
      projects: []
    });
    await writeFile(repositoryPath, "not a worktree");
    expect((await callTool(
      "get_analysis_projects",
      {}
    )).payload.projects).toEqual([]);
    expect((await callTool("get_analysis_status", {
      projectPath: repositoryPath
    })).payload.code).toBe("invalid-project");
  });

  it("summarizes the available analysis", async () => {
    await writeSnapshot(snapshot());
    const { callTool } = createServer();
    const { payload } = await callTool("get_analysis_status", {});
    expect(payload.projectMatched).toBe(true);
    expect(payload.matchedRepositoryRoot).toBe(repositoryPath);
    expect(payload.hasWorkspaceAnalysis).toBe(true);
    expect(payload.hasChangedAnalysis).toBe(false);
    expect(payload.useMcp).toBe(true);
    expect(payload.decisionReason).toBe(
      "workspace-analysis-unverified-usable"
    );
    expect(payload).toMatchObject({
      snapshotReliability: "unverified",
      snapshotExpired: false,
      maxStaleAgeDays: 7,
      requiresSourceVerification: true,
      snapshotAgeMs: DAY_MS,
      expiresAt: "2026-09-30T02:00:00.000Z"
    });
    expect(payload.scope).toBe("workspace");
    expect(payload.generatedAt).toBe("2026-09-23T02:00:00.000Z");
    const analyses = payload.analyses as Array<{
      scope: string;
      nodeCount: number;
      requestChainCount: number;
      workspaceName: string;
    }>;
    expect(analyses).toHaveLength(1);
    expect(analyses[0]?.scope).toBe("workspace");
    expect(analyses[0]?.nodeCount).toBe(3);
    expect(analyses[0]?.requestChainCount).toBe(1);
    expect(analyses[0]?.workspaceName).toBe("Fixture");
  });

  it("uses the workspace scope for status and general tracing", async () => {
    await writeSnapshot(snapshot());
    const changed = snapshot();
    changed.scope = "changed";
    changed.analysisId = "analysis-2";
    changed.generatedAt = "2026-09-23T03:00:00.000Z";
    await writeSnapshot(changed);

    const { callTool } = createServer();
    expect((await callTool("get_analysis_status", {})).payload.scope)
      .toBe("workspace");
    expect((await callTool("get_call_chain", {
      query: "groupService"
    })).payload.scope).toBe("workspace");
    expect((await callTool("get_call_chain", {
      query: "groupService",
      scope: "changed"
    })).payload.scope).toBe("changed");
    const status = await callTool("get_analysis_status", {});
    expect(
      (status.payload.analyses as Array<{ scope: string }>)
        .map((entry) => entry.scope)
    ).toEqual(["workspace", "changed"]);
  });

  it("marks freshness as unknown when probing is skipped", async () => {
    await writeSnapshot(snapshot());
    const { callTool } = createServer();
    const { payload } = await callTool("get_call_chain", {
      query: "groupService"
    });
    expect(payload.freshness).toBe("unknown");
    expect(payload).toMatchObject({
      snapshotReliability: "unverified",
      snapshotExpired: false,
      maxStaleAgeDays: 7,
      requiresSourceVerification: true
    });
    expect(typeof payload.freshnessNote).toBe("string");
  });

  it("uses a stale snapshot within seven days with a verification warning", async () => {
    await writeFreshSnapshot("2026-09-20T02:00:00.000Z");
    await writeFile(
      join(repositoryPath, "src", "Demo.java"),
      "class Demo { void changedAfterAnalysis() {} }"
    );
    const { callTool } = createServer({}, false);

    const status = await callTool("get_analysis_status", {});
    expect(status.payload).toMatchObject({
      freshness: "stale",
      useMcp: true,
      decisionReason: "workspace-analysis-stale-usable",
      snapshotReliability: "degraded",
      snapshotExpired: false,
      maxStaleAgeDays: 7,
      requiresSourceVerification: true,
      snapshotAgeMs: 4 * DAY_MS,
      expiresAt: "2026-09-27T02:00:00.000Z"
    });
    expect(String(status.payload.guidance)).toContain(
      "当前源码核对"
    );

    const trace = await callTool("get_call_chain", {
      query: "groupService"
    });
    expect(trace.isError).toBe(false);
    expect(trace.payload).toMatchObject({
      freshness: "stale",
      snapshotReliability: "degraded",
      snapshotExpired: false,
      requiresSourceVerification: true
    });
    expect(String(trace.payload.freshnessNote)).toContain(
      "可能已过期"
    );
  });

  it("rejects a stale snapshot older than seven days", async () => {
    await writeFreshSnapshot("2026-09-16T02:00:00.000Z");
    await writeFile(
      join(repositoryPath, "src", "Demo.java"),
      "class Demo { void changedAfterAnalysis() {} }"
    );
    const { callTool } = createServer({}, false);

    const status = await callTool("get_analysis_status", {});
    expect(status.payload).toMatchObject({
      freshness: "stale",
      useMcp: false,
      decisionReason: "workspace-analysis-expired",
      snapshotReliability: "expired",
      snapshotExpired: true,
      maxStaleAgeDays: 7,
      requiresSourceVerification: true,
      snapshotAgeMs: 8 * DAY_MS,
      expiresAt: "2026-09-23T02:00:00.000Z"
    });

    const trace = await callTool("get_call_chain", {
      query: "groupService"
    });
    expect(trace.isError).toBe(true);
    expect(trace.payload).toMatchObject({
      code: "snapshot-expired",
      useMcp: false
    });
  });

  it("keeps a fresh snapshot usable regardless of its age", async () => {
    await writeFreshSnapshot("2026-01-01T02:00:00.000Z");
    const { callTool } = createServer({}, false);

    const status = await callTool("get_analysis_status", {});
    expect(status.payload).toMatchObject({
      freshness: "fresh",
      useMcp: true,
      decisionReason: "ready",
      snapshotReliability: "current",
      snapshotExpired: false,
      maxStaleAgeDays: 7,
      requiresSourceVerification: false
    });
    const trace = await callTool("get_call_chain", {
      query: "groupService"
    });
    expect(trace.isError).toBe(false);
    expect(trace.payload).toMatchObject({
      freshness: "fresh",
      snapshotReliability: "current",
      snapshotExpired: false,
      requiresSourceVerification: false
    });
  });

  it("allows a stale snapshot at the exact TTL boundary", async () => {
    await writeFreshSnapshot("2026-09-17T02:00:00.000Z");
    await writeFile(
      join(repositoryPath, "src", "Demo.java"),
      "class Demo { void changedAfterAnalysis() {} }"
    );
    const { callTool } = createServer({}, false);

    const status = await callTool("get_analysis_status", {});
    expect(status.payload).toMatchObject({
      freshness: "stale",
      useMcp: true,
      decisionReason: "workspace-analysis-stale-usable",
      snapshotReliability: "degraded",
      snapshotExpired: false,
      snapshotAgeMs: 7 * DAY_MS,
      expiresAt: "2026-09-24T02:00:00.000Z"
    });
    expect((await callTool("get_call_chain", {
      query: "groupService"
    })).isError).toBe(false);
  });

  it("filters mixed-line-ending stat changes during freshness probing", async () => {
    await git("git", ["init", "--quiet"], {
      cwd: repositoryPath
    });
    await git(
      "git",
      ["config", "core.autocrlf", "true"],
      { cwd: repositoryPath }
    );
    await git("git", ["add", "src/Demo.java"], {
      cwd: repositoryPath
    });
    await git(
      "git",
      [
        "-c",
        "user.name=GitNest Test",
        "-c",
        "user.email=gitnest@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "base"
      ],
      { cwd: repositoryPath }
    );
    const head = (
      await git("git", ["rev-parse", "HEAD"], {
        cwd: repositoryPath
      })
    ).stdout.trim();
    await writeWorkspaceFiles(head);
    const sourcePath = join(repositoryPath, "src", "Demo.java");
    await writeFile(
      sourcePath,
      [
        "package demo;\r",
        "\r",
        "class Demo {\r",
        "  void run() {",
        "    helper();\r",
        "  }",
        "}"
      ].join("\n"),
      "utf8"
    );
    const analyzed = snapshot();
    analyzed.roots[0]!.revision = head;
    analyzed.sourceState = {
      worktreeStatuses: [{
        repositoryId: REPOSITORY_ID,
        worktreeId: WORKTREE_ID,
        fingerprint:
          codeAnalysisWorktreeStatusFingerprint([])
      }],
      changedSourceFiles: []
    };
    await writeSnapshot(analyzed);
    const access = new GitNestDataAccess({
      dataDirectory: root
    });
    const target = await access.pickTarget({
      scope: "workspace"
    });

    expect(await access.freshnessFor(target)).toBe("fresh");

    await writeFile(
      sourcePath,
      [
        "package demo;\r",
        "\r",
        "class Demo {\r",
        "  void run() {",
        "    changed();\r",
        "  }",
        "}"
      ].join("\n"),
      "utf8"
    );
    expect(await access.freshnessFor(target)).toBe("stale");
  });

  it("rechecks an already dirty file and HEAD on every query", async () => {
    await git("git", ["init", "--quiet"], { cwd: repositoryPath });
    await git("git", ["add", "src/Demo.java"], {
      cwd: repositoryPath
    });
    await git(
      "git",
      [
        "-c",
        "user.name=GitNest Test",
        "-c",
        "user.email=gitnest@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "base"
      ],
      { cwd: repositoryPath }
    );
    const head = (
      await git("git", ["rev-parse", "HEAD"], {
        cwd: repositoryPath
      })
    ).stdout.trim();
    await writeWorkspaceFiles(head);
    const sourcePath = join(repositoryPath, "src", "Demo.java");
    await writeFile(sourcePath, "class Demo { void before() {} }");
    const before = await stat(sourcePath);
    const change = {
      path: "src/Demo.java",
      indexStatus: ".",
      worktreeStatus: "M",
      kind: "ordinary"
    };
    const analyzed = snapshot();
    analyzed.roots[0]!.revision = head;
    analyzed.indexStatus = {
      fullIndexAvailable: true,
      resultCompleteness: "partial",
      impactCoverage: "possible-omissions",
      message: "部分源码未分析"
    };
    analyzed.sourceState = {
      worktreeStatuses: [{
        repositoryId: REPOSITORY_ID,
        worktreeId: WORKTREE_ID,
        fingerprint: codeAnalysisWorktreeStatusFingerprint([
          change
        ])
      }],
      changedSourceFiles: [{
        repositoryId: REPOSITORY_ID,
        worktreeId: WORKTREE_ID,
        path: "src/Demo.java",
        size: before.size,
        modifiedAtMs: before.mtimeMs
      }]
    };
    await writeSnapshot(analyzed);
    const access = new GitNestDataAccess({
      dataDirectory: root
    });
    const target = await access.pickTarget({ scope: "workspace" });
    expect(await access.freshnessFor(target)).toBe("fresh");
    const server = new McpProtocolServer({
      info: { name: "gitnest", version: "test" },
      tools: createTools({
        access,
        readSettings: () => access.readMcpSettings(),
        now: () => NOW
      })
    });
    const status = async () => {
      const response = await server.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "get_analysis_status",
          arguments: { projectPath: repositoryPath }
        }
      });
      return (
        response as {
          result: {
            structuredContent: Record<string, unknown>;
          };
        }
      ).result.structuredContent;
    };
    expect(await status()).toMatchObject({
      projectMatched: true,
      freshness: "fresh",
      useMcp: true,
      decisionReason: "ready",
      completeness: "partial"
    });
    expect(String((await status()).guidance)).toContain("rg");

    await writeFile(
      sourcePath,
      "class Demo { void afterAnalysisChangedAgain() {} }"
    );
    expect(await access.freshnessFor(target)).toBe("stale");
    expect(await status()).toMatchObject({
      freshness: "stale",
      useMcp: true,
      decisionReason: "workspace-analysis-stale-usable",
      snapshotReliability: "degraded",
      snapshotExpired: false,
      requiresSourceVerification: true
    });

    await git("git", ["add", "src/Demo.java"], {
      cwd: repositoryPath
    });
    await git(
      "git",
      [
        "-c",
        "user.name=GitNest Test",
        "-c",
        "user.email=gitnest@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "next"
      ],
      { cwd: repositoryPath }
    );
    expect(await access.freshnessFor(target)).toBe("stale");
  });

  it("does not claim old snapshots without a status baseline are fresh", async () => {
    await writeSnapshot(snapshot());
    const access = new GitNestDataAccess({ dataDirectory: root });
    const target = await access.pickTarget({});
    expect(await access.freshnessFor(target)).toBe("unknown");
  });

  it("traces a function or route as directed branches with source paths", async () => {
    const branched = snapshot();
    branched.nodes.push(
      graphNode("tag-client", {
        kind: "rpc-client",
        name: "getResTagList"
      }),
      graphNode("tag-handler", {
        kind: "rpc-handler",
        name: "getResTagList"
      }),
      graphNode("duration", { name: "getDuration" })
    );
    branched.edges.push(
      {
        id: "e3",
        from: "service",
        to: "tag-client",
        kind: "calls",
        confidence: "probable",
        evidence: "typed receiver"
      },
      {
        id: "e4",
        from: "tag-client",
        to: "tag-handler",
        kind: "rpc-request",
        confidence: "exact",
        evidence: "shared protocol key"
      },
      {
        id: "e5",
        from: "service",
        to: "duration",
        kind: "calls",
        confidence: "probable"
      }
    );
    branched.requestChains[0]!.nodeIds.push(
      "tag-client",
      "tag-handler",
      "duration"
    );
    branched.requestChains[0]!.edgeIds.push(
      "e3",
      "e4",
      "e5"
    );
    branched.requestChains.push({
      id: "tag-chain",
      profileId: "fai-cli-rpc",
      transport: "rpc",
      operationKey: "GET_RES_TAG_LIST",
      method: "RPC",
      route: "GET_RES_TAG_LIST",
      title: "RPC GET_RES_TAG_LIST",
      clientNodeId: "tag-client",
      endpointNodeId: "tag-handler",
      nodeIds: ["service", "tag-client", "tag-handler"],
      edgeIds: ["e3", "e4"],
      changed: false,
      ambiguous: false,
      confidence: "probable"
    });
    await writeSnapshot(branched);
    const { callTool } = createServer();

    for (const query of ["groupService", "/api/groups"]) {
      const { payload } = await callTool(
        "get_call_chain",
        { query }
      );
      expect(payload.found).toBe(true);
      expect(payload.chainFound).toBe(true);
      expect(payload.scope).toBe("workspace");
      expect(payload.freshness).toBe("unknown");
      expect(payload.totalChains).toBe(1);
      expect(payload.truncated).toBe(false);
      expect(payload).not.toHaveProperty("steps");
      const nodes = payload.nodes as Array<{
        id: string;
        repositoryRoot: string;
        relativePath: string;
      }>;
      const edges = payload.edges as Array<{
        from: string;
        to: string;
        kind: string;
        evidence?: string;
      }>;
      expect(nodes.map((node) => node.id)).toContain(
        "tag-handler"
      );
      expect(nodes[0]?.repositoryRoot).toBe(repositoryPath);
      expect(nodes[0]?.relativePath).toBe("src/api.ts");
      expect(edges).toContainEqual(
        expect.objectContaining({
          from: "tag-client",
          to: "tag-handler",
          kind: "rpc-request",
          evidence: "shared protocol key"
        })
      );
      expect(edges).toContainEqual(
        expect.objectContaining({
          from: "service",
          to: "duration",
          kind: "calls"
        })
      );
    }
    const rpc = await callTool("get_call_chain", {
      query: "getResTagList"
    });
    expect(rpc.payload.totalChains).toBe(1);
    expect(
      (rpc.payload.chains as Array<{ transport: string }>)[0]
        ?.transport
    ).toBe("rpc");
  });

  it("narrows by file path and never treats a graph miss as proof of absence", async () => {
    await writeSnapshot(snapshot());
    const { callTool } = createServer();
    const narrowed = await callTool("get_call_chain", {
      query: "groupService",
      pathPrefix: "src/Demo.java"
    });
    expect(narrowed.payload.totalMatches).toBe(1);
    expect(
      (narrowed.payload.matches as Array<{ id: string }>)[0]?.id
    ).toBe("service");

    const missing = await callTool("get_call_chain", {
      query: "missing-node"
    });
    expect(missing.isError).toBe(false);
    expect(missing.payload.found).toBe(false);
    expect(String(missing.payload.guidance)).toContain("rg");
    expect(missing.payload.freshness).toBe("unknown");
  });

  it("filters matching symbols by language without removing cross-language edges", async () => {
    const graph = snapshot();
    graph.nodes[0]!.name = "sharedMethod";
    graph.nodes[1]!.name = "sharedMethod";
    await writeSnapshot(graph);
    const { callTool } = createServer();

    const typescript = await callTool("get_call_chain", {
      query: "sharedMethod",
      language: "typescript"
    });
    expect(typescript.payload.language).toBe("typescript");
    expect(typescript.payload.totalMatches).toBe(1);
    expect(
      (typescript.payload.matches as Array<{ id: string }>)
        .map((node) => node.id)
    ).toEqual(["client"]);
    expect(
      (typescript.payload.nodes as Array<{ id: string }>)
        .map((node) => node.id)
    ).toContain("endpoint");
    expect(typescript.payload.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "http-request" })
      ])
    );

    const java = await callTool("get_call_chain", {
      query: "sharedMethod",
      language: "java"
    });
    expect(
      (java.payload.matches as Array<{ id: string }>)
        .map((node) => node.id)
    ).toEqual(["endpoint"]);
    expect(java.payload.chainFound).toBe(true);

    const missing = await callTool("get_call_chain", {
      query: "sharedMethod",
      language: "python"
    });
    expect(missing.payload).toMatchObject({
      found: false,
      chainFound: false,
      totalMatches: 0
    });
    expect((await callTool("get_call_chain", {
      query: "/api/groups",
      language: "java"
    })).payload.chainFound).toBe(true);
    expect((await callTool("get_call_chain", {
      query: "/api/groups",
      language: "python"
    })).payload.chainFound).toBe(false);
  });

  it("preserves HTTP and RPC boundaries when one chain exceeds the node limit", async () => {
    const large = snapshot(100);
    large.nodes.push(
      graphNode("rpc-client", { kind: "rpc-client" }),
      graphNode("rpc-handler", { kind: "rpc-handler" })
    );
    const branchEdges = [
      ...Array.from({ length: 100 }, (_value, index) => ({
        id: `branch-${index}`,
        from: "service",
        to: `filler-${index}`,
        kind: "calls" as const,
        confidence: "probable" as const
      })),
      {
        id: "rpc-call",
        from: "service",
        to: "rpc-client",
        kind: "calls" as const,
        confidence: "probable" as const
      },
      {
        id: "rpc-boundary",
        from: "rpc-client",
        to: "rpc-handler",
        kind: "rpc-request" as const,
        confidence: "exact" as const
      }
    ];
    large.edges.push(...branchEdges);
    large.requestChains[0]!.nodeIds.push(
      ...large.nodes
        .filter((node) => node.id.startsWith("filler-"))
        .map((node) => node.id),
      "rpc-client",
      "rpc-handler"
    );
    large.requestChains[0]!.edgeIds.push(
      ...branchEdges.map((edge) => edge.id)
    );
    await writeSnapshot(large);
    const { callTool } = createServer();
    const { payload } = await callTool("get_call_chain", {
      query: "groupService"
    });
    const ids = (
      payload.nodes as Array<{ id: string }>
    ).map((node) => node.id);
    const kinds = (
      payload.edges as Array<{ kind: string }>
    ).map((edge) => edge.kind);

    expect(payload.truncated).toBe(true);
    expect(payload.truncationReasons).toContain("max-nodes");
    expect(ids).toEqual(
      expect.arrayContaining([
        "client",
        "endpoint",
        "rpc-client",
        "rpc-handler"
      ])
    );
    expect(kinds).toContain("http-request");
    expect(kinds).toContain("rpc-request");
    expect(String(payload.guidance)).toContain("rg");
  });

  it("returns a local call neighbourhood when no request chain exists", async () => {
    const isolated = snapshot(2);
    isolated.nodes[3]!.name = "localMethod";
    isolated.edges.push({
      id: "local-edge",
      from: "filler-0",
      to: "filler-1",
      kind: "calls",
      confidence: "probable"
    });
    await writeSnapshot(isolated);
    const { callTool } = createServer();
    const { payload } = await callTool("get_call_chain", {
      query: "localMethod"
    });
    expect(payload.found).toBe(true);
    expect(payload.chainFound).toBe(false);
    expect(payload.edges).toEqual([
      expect.objectContaining({
        from: "filler-0",
        to: "filler-1"
      })
    ]);
  });

  it("requires a bounded query", async () => {
    await writeSnapshot(snapshot());
    const { callTool } = createServer();
    expect((await callTool("get_call_chain", {})).payload.code)
      .toBe("invalid-request");
    expect((await callTool("get_call_chain", {
      query: "汉".repeat(50_000)
    })).payload.code).toBe("invalid-request");
    expect((await callTool("get_call_chain", {
      query: "groupService",
      scope: "unknown"
    })).payload.code).toBe("invalid-request");
    expect((await callTool("get_call_chain", {
      query: "groupService",
      language: "ruby"
    })).payload.code).toBe("invalid-request");
    expect((await callTool("get_call_chain", {
      query: "groupService",
      pathPrefix: "D:\\code\\sc\\workspace"
    })).payload.code).toBe("invalid-request");
  });

  it("matches a nested project directory but not a sibling or parent", async () => {
    await writeSnapshot(snapshot());
    const { callTool } = createServer();
    const nested = await callTool("get_analysis_status", {
      projectPath: join(repositoryPath, "src")
    });
    expect(nested.payload).toMatchObject({
      projectMatched: true,
      matchedRepositoryRoot: repositoryPath,
      hasWorkspaceAnalysis: true
    });
    await mkdir(`${repositoryPath}-other`);
    for (const projectPath of [
      `${repositoryPath}-other`,
      root
    ]) {
      const status = await callTool("get_analysis_status", {
        projectPath
      });
      expect(status.isError).toBe(false);
      expect(status.payload).toMatchObject({
        projectMatched: false,
        hasWorkspaceAnalysis: false,
        useMcp: false,
        decisionReason: "project-unmatched",
        analyses: []
      });
      const trace = await callTool("get_call_chain", {
        projectPath,
        query: "groupService"
      });
      expect(trace.isError).toBe(true);
      expect(trace.payload.code).toBe("project-unmatched");
      expect(trace.payload.useMcp).toBe(false);
    }
  });

  it("never borrows the selected workspace analysis for another project", async () => {
    await writeSnapshot(snapshot());
    const secondPath = join(root, "second-repo");
    await mkdir(secondPath);
    const workspaceDirectory = join(root, "workspaces");
    const first = JSON.parse(
      await readFile(
        join(
          workspaceDirectory,
          "items",
          `${WORKSPACE_ID}.workspace.json`
        ),
        "utf8"
      )
    ) as {
      id: string;
      name: string;
      path: string;
      canonicalPath: string;
      repositories: Array<{
        commonDir: string;
        canonicalCommonDir: string;
      }>;
      worktrees: Array<{
        path: string;
        canonicalPath: string;
      }>;
    };
    first.id = "workspace-2";
    first.name = "Second";
    first.path = secondPath;
    first.canonicalPath = secondPath.toLowerCase();
    first.repositories[0]!.commonDir = join(secondPath, ".git");
    first.repositories[0]!.canonicalCommonDir =
      join(secondPath, ".git").toLowerCase();
    first.worktrees[0]!.path = secondPath;
    first.worktrees[0]!.canonicalPath =
      secondPath.toLowerCase();
    await writeFile(
      join(
        workspaceDirectory,
        "items",
        "workspace-2.workspace.json"
      ),
      JSON.stringify(first)
    );
    const catalogPath = join(
      workspaceDirectory,
      "catalog.json"
    );
    const catalog = JSON.parse(
      await readFile(catalogPath, "utf8")
    ) as {
      workspaces: Array<{ id: string; name: string }>;
    };
    catalog.workspaces.push({
      id: "workspace-2",
      name: "Second"
    });
    await writeFile(catalogPath, JSON.stringify(catalog));

    const { callTool } = createServer();
    const second = await callTool("get_analysis_status", {
      projectPath: secondPath
    });
    expect(second.payload).toMatchObject({
      projectMatched: true,
      workspaceId: "workspace-2",
      hasWorkspaceAnalysis: false,
      useMcp: false
    });
    const projects = await callTool(
      "get_analysis_projects",
      {}
    );
    expect(projects.payload.projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectPath: secondPath,
          workspaceId: "workspace-2",
          selected: false
        })
      ])
    );
    expect((await callTool("get_call_chain", {
      projectPath: secondPath,
      query: "groupService"
    })).payload.code).toBe("snapshot-unavailable");
    const firstStatus = await callTool(
      "get_analysis_status",
      {}
    );
    expect(firstStatus.payload.workspaceId).toBe(WORKSPACE_ID);
  });

  it("requires a valid absolute project path for both tools", async () => {
    await writeSnapshot(snapshot());
    const { callTool } = createServer();
    for (const name of [
      "get_analysis_status",
      "get_call_chain"
    ]) {
      const args = name === "get_call_chain"
        ? { query: "groupService" }
        : {};
      expect((await callTool(name, {
        ...args,
        projectPath: undefined
      })).payload.code).toBe("invalid-request");
      expect((await callTool(name, {
        ...args,
        projectPath: "relative/path"
      })).payload.code).toBe("invalid-project");
      expect((await callTool(name, {
        ...args,
        projectPath: join(root, "missing")
      })).payload.code).toBe("invalid-project");
    }
  });

  it("applies MCP permission changes without restarting the server", async () => {
    await writeSnapshot(snapshot());
    const { callTool } = createServer();
    expect((await callTool("get_call_chain", {
      query: "groupService"
    })).isError).toBe(false);
    await writeSettings({
      mcp: {
        enabled: false,
        allowSourceSnippets: false,
        maxResponseKb: 64
      }
    });
    const trace = await callTool("get_call_chain", {
      query: "groupService"
    });
    expect(trace.isError).toBe(true);
    expect(trace.payload.code).toBe("mcp-disabled");
  });

  it("returns mcp-disabled without analysis data when turned off", async () => {
    await writeSnapshot(snapshot());
    const { callTool } = createServer({ enabled: false });
    const { payload, isError } = await callTool("get_analysis_status", {});
    expect(isError).toBe(true);
    expect(payload.code).toBe("mcp-disabled");
    expect(payload.analyses).toBeUndefined();
    const projects = await callTool(
      "get_analysis_projects",
      {}
    );
    expect(projects.isError).toBe(true);
    expect(projects.payload.code).toBe("mcp-disabled");
    expect(projects.payload.projects).toBeUndefined();
  });

  it("returns snapshot-unavailable when no snapshot exists", async () => {
    const { callTool } = createServer();
    const { payload, isError } = await callTool("get_analysis_status", {});
    expect(isError).toBe(false);
    expect(payload).toMatchObject({
      projectMatched: true,
      hasWorkspaceAnalysis: false,
      hasChangedAnalysis: false,
      useMcp: false,
      decisionReason: "workspace-analysis-missing",
      analyses: []
    });
    const trace = await callTool("get_call_chain", {
      query: "groupService"
    });
    expect(trace.isError).toBe(true);
    expect(trace.payload.code).toBe("snapshot-unavailable");
  });

  it("does not recommend a changed-only graph for general tracing", async () => {
    const changed = snapshot();
    changed.scope = "changed";
    await writeSnapshot(changed);
    const { callTool } = createServer();
    const status = await callTool("get_analysis_status", {});
    expect(status.isError).toBe(false);
    expect(status.payload).toMatchObject({
      projectMatched: true,
      hasWorkspaceAnalysis: false,
      hasChangedAnalysis: true,
      useMcp: false,
      decisionReason: "workspace-analysis-missing"
    });
    const trace = await callTool("get_call_chain", {
      query: "groupService"
    });
    expect(trace.payload.code).toBe("snapshot-unavailable");
  });

  it("does not use an unrelated workspace id", async () => {
    await writeSnapshot(snapshot());
    const { callTool } = createServer();
    const { payload, isError } = await callTool("get_analysis_status", {
      workspaceId: "no-such-workspace"
    });
    expect(isError).toBe(false);
    expect(payload).toMatchObject({
      projectMatched: false,
      useMcp: false,
      analyses: []
    });
    const trace = await callTool("get_call_chain", {
      query: "groupService",
      workspaceId: "no-such-workspace"
    });
    expect(trace.payload.code).toBe("project-unmatched");
  });

  it("returns data-unavailable when the settings file is missing", async () => {
    await writeSnapshot(snapshot());
    await rm(join(root, "settings", "app-settings.json"));
    const { callTool } = createServer();
    const { payload, isError } = await callTool("get_analysis_status", {});
    expect(isError).toBe(true);
    expect(payload.code).toBe("data-unavailable");
  });

  it("keeps every response inside the configured budget", async () => {
    const large = snapshot();
    large.edges[1]!.evidence = "中文关系证据".repeat(8_000);
    await writeSnapshot(large);
    const { callTool } = createServer({ maxResponseKb: 64 });
    const { payload, responseBytes } = await callTool("get_call_chain", {
      query: "groupService"
    });
    expect(payload.truncated).toBe(true);
    expect(payload.truncationReasons).toContain(
      "max-response-size"
    );
    expect(payload.freshness).toBe("unknown");
    expect(payload.completeness).toBe("complete");
    expect(payload.edges).toEqual([]);
    expect(responseBytes).toBeLessThanOrEqual(
      64 * 1_024
    );
  });

  it("bounds an oversized query error", async () => {
    await writeSnapshot(snapshot());
    const { callTool } = createServer({ maxResponseKb: 64 });
    const { payload, isError, responseBytes } = await callTool(
      "get_call_chain",
      { query: "汉".repeat(50_000) }
    );
    expect(isError).toBe(true);
    expect(payload.code).toBe("invalid-request");
    expect(responseBytes).toBeLessThanOrEqual(64 * 1_024);
  });

  it("does not return full node arrays for a whole workspace", async () => {
    await writeSnapshot(snapshot(600));
    const { callTool } = createServer();
    const { payload } = await callTool("get_call_chain", {
      query: "filler"
    });
    expect((payload.matches as unknown[]).length).toBe(12);
    expect(payload.totalMatches).toBe(600);
    expect(payload.truncationReasons).toContain("max-matches");
  });

  it("rejects an mcp settings file whose snapshot key does not match", async () => {
    // A drifted settings mapping (MiB not converted to bytes) would
    // silently hide every existing snapshot; assert it does not.
    await writeSnapshot(snapshot());
    await writeSettings({ maxTotalSourceMb: 256 });
    const { callTool } = createServer();
    const { payload, isError } = await callTool("get_analysis_status", {});
    expect(isError).toBe(false);
    expect(payload).toMatchObject({
      projectMatched: true,
      hasWorkspaceAnalysis: false,
      useMcp: false,
      decisionReason: "workspace-analysis-missing"
    });
  });

  it("does not reuse a parsed snapshot after analysis settings change", async () => {
    await writeSnapshot(snapshot());
    const { callTool } = createServer();
    expect((await callTool("get_analysis_status", {})).isError)
      .toBe(false);

    await writeSettings({ maxTotalSourceMb: 256 });
    const changed = await callTool("get_analysis_status", {});
    expect(changed.isError).toBe(false);
    expect(changed.payload).toMatchObject({
      projectMatched: true,
      hasWorkspaceAnalysis: false,
      useMcp: false,
      decisionReason: "workspace-analysis-missing"
    });
  });
});
