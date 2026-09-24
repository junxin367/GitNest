import {
  collectSubgraph,
  searchGraphNodes,
  type CodeAnalysisLanguage,
  type CodeGraphEdge,
  type CodeGraphEdgeKind,
  type CodeGraphNode,
  type CodeGraphNodeKind,
  type CodeRequestChain
} from "@gitnest/code-analysis";

import {
  DataAccessError,
  GitNestDataAccess,
  type AnalysisFreshness,
  type AnalysisTarget,
  type ProjectAnalysisMatch
} from "./data-access";
import {
  ToolFailure,
  textResult,
  type McpToolHandler,
  type McpToolResult
} from "./protocol";

export const DEFAULT_MAX_RESPONSE_KB = 256;
const MIN_MAX_RESPONSE_KB = 64;
const MAX_MAX_RESPONSE_KB = 1_024;
const MAX_TRACE_MATCHES = 12;
const MAX_TRACE_CHAINS = 3;
const MAX_TRACE_NODES = 80;
const MAX_TRACE_EDGES = 120;
const DAY_MS = 24 * 60 * 60 * 1_000;
const TRACE_NODE_KINDS: CodeGraphNodeKind[] = [
  "function",
  "method",
  "client-request",
  "server-endpoint",
  "rpc-client",
  "rpc-handler"
];
const TRACE_EDGE_KINDS: CodeGraphEdgeKind[] = [
  "calls",
  "http-request",
  "rpc-request"
];
const TRACE_LANGUAGES: readonly CodeAnalysisLanguage[] = [
  "typescript",
  "javascript",
  "vue",
  "java",
  "python",
  "go",
  "kotlin",
  "csharp",
  "rust"
];

export interface ToolSettings {
  enabled: boolean;
  maxResponseKb: number;
  maxStaleAgeDays: number;
}

export interface ToolContext {
  access: GitNestDataAccess;
  readSettings(): Promise<ToolSettings>;
  now?(): number;
}

export function createTools(
  context: ToolContext
): McpToolHandler[] {
  return [
    {
      definition: {
        name: "get_analysis_projects",
        title: "GitNest analysis projects",
        description:
          "List existing project/worktree directories registered in GitNest and their workspaceIds. Registration does not guarantee a fresh analysis. Check get_analysis_status with the chosen projectPath before querying a call chain.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      },
      handle: () => runProjects(context)
    },
    {
      definition: {
        name: "get_analysis_status",
        title: "GitNest analysis status",
        description:
          "Check whether GitNest analysis applies to the current project. Stale snapshots remain usable within the configured grace period and are returned with verification warnings. Pass its absolute projectPath and optionally a workspaceId from get_analysis_projects.",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description:
                "Absolute path of the project you are working in (or its current working directory). The server cannot infer your client's cwd."
            },
            workspaceId: {
              type: "string",
              description:
                "Workspace ID returned by get_analysis_projects when the project belongs to multiple workspaces."
            }
          },
          required: ["projectPath"],
          additionalProperties: false
        }
      },
      handle: (args) => runStatus(context, args)
    },
    {
      definition: {
        name: "get_call_chain",
        title: "Get a function or request call chain",
        description:
          "After get_analysis_status returns useMcp=true, query a function, method or route in the same projectPath. Stale-but-allowed results require current-source verification. Set language to restrict matching symbols, not cross-language call-chain nodes.",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description:
                "Absolute path of the current project or working directory, identical to the path checked by get_analysis_status."
            },
            query: {
              type: "string",
              description:
                "Function name, e.g. getRecognitionList, or route, e.g. /api/resource/getRecognitionList."
            },
            pathPrefix: {
              type: "string",
              description:
                "Optional repository-relative file path prefix to narrow same-named functions."
            },
            language: {
              type: "string",
              enum: TRACE_LANGUAGES,
              description:
                "Optional language of the matching function or method. Cross-language nodes in a matched call chain remain visible."
            },
            workspaceId: {
              type: "string",
              description:
                "Workspace ID returned by get_analysis_projects when the project belongs to multiple workspaces."
            },
            scope: {
              type: "string",
              enum: ["workspace", "changed"],
              description:
                "Defaults to workspace. Use changed only when specifically investigating changed code."
            }
          },
          required: ["projectPath", "query"],
          additionalProperties: false
        }
      },
      handle: (args) => runTrace(context, args)
    }
  ];
}

async function runProjects(
  context: ToolContext
): Promise<McpToolResult> {
  return guard(context, async () => {
    const projects = await context.access.listAnalysisProjects();
    return {
      totalProjects: projects.length,
      projects: projects.map((project) => ({
        projectPath: project.root.path,
        repositoryName: project.root.name,
        workspaceId: project.workspaceId,
        workspaceName: project.workspaceName,
        selected: project.selected
      })),
      guidance:
        "这些是 GitNest 已登记且路径可访问的工作目录；是否有可用分析，请用 projectPath 调用 get_analysis_status。"
    };
  });
}

async function runStatus(
  context: ToolContext,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  return guard(context, async (settings) => {
    const matches = await matchedProjects(context, args);
    if (matches.length === 0) {
      return {
        projectMatched: false,
        hasWorkspaceAnalysis: false,
        hasChangedAnalysis: false,
        useMcp: false,
        decisionReason: "project-unmatched",
        analyses: [],
        guidance:
          "当前项目不在 GitNest 已登记的分析仓库内；不要使用 GitNest 调用图，请用 rg 检查当前源码。"
      };
    }
    const available = await Promise.all(
      matches.map(async (match) => {
        try {
          return {
            match,
            targets: await context.access.resolveTargets({
              workspaceId: match.workspaceId
            })
          };
        } catch (error) {
          if (
            error instanceof DataAccessError &&
            error.code === "snapshot-unavailable"
          ) {
            return { match, targets: [] as AnalysisTarget[] };
          }
          throw error;
        }
      })
    );
    const chosen =
      available.find((entry) =>
        entry.targets.some(
          (target) => target.scope === "workspace"
        )
      ) ??
      available.find((entry) => entry.targets.length > 0) ??
      available[0]!;
    const { match, targets } = chosen;
    const probes = new Map();
    const summaries = await Promise.all(
      targets.map((target) =>
        context.access.summarize(target, probes)
      )
    );
    const now = context.now?.() ?? Date.now();
    const policies = summaries.map((summary, index) =>
      snapshotUsePolicy(
        targets[index]!,
        summary.freshness,
        settings.maxStaleAgeDays,
        now
      )
    );
    const analyses = summaries.map((summary, index) => ({
      ...summary,
      ...snapshotPolicyPayload(policies[index]!)
    }));
    const workspaceIndex = summaries.findIndex(
      (entry) => entry.scope === "workspace"
    );
    const workspace =
      workspaceIndex >= 0
        ? summaries[workspaceIndex]
        : undefined;
    const workspacePolicy =
      workspaceIndex >= 0
        ? policies[workspaceIndex]
        : undefined;
    const hasWorkspaceAnalysis = workspaceIndex >= 0;
    const hasChangedAnalysis = summaries.some(
      (entry) => entry.scope === "changed"
    );
    const useMcp = workspacePolicy?.usable === true;
    const decisionReason = !hasWorkspaceAnalysis
      ? "workspace-analysis-missing"
      : !workspacePolicy?.usable
        ? "workspace-analysis-expired"
        : workspace?.freshness === "stale"
          ? "workspace-analysis-stale-usable"
          : workspace?.freshness === "unknown"
            ? "workspace-analysis-unverified-usable"
            : "ready";
    const guidance = !hasWorkspaceAnalysis
      ? "项目已在 GitNest 登记，但没有可用的全量代码分析；请先在 GitNest 执行分析，当前用 rg 检查源码。"
      : !workspacePolicy?.usable
        ? `全量快照已超过 ${settings.maxStaleAgeDays} 天陈旧数据期限；请重新分析后再查询。`
        : workspace?.freshness === "stale"
          ? `全量快照与当前代码存在差异，但仍在 ${settings.maxStaleAgeDays} 天容忍期内；可以查询候选关系，行号和关键边必须用当前源码核对。`
          : workspace?.freshness === "unknown"
            ? `无法验证全量快照是否最新，但仍在 ${settings.maxStaleAgeDays} 天容忍期内；可以查询候选关系，结论必须用当前源码核对。`
            : workspace?.completeness === "partial"
              ? "全量快照只覆盖部分源码；可以用 GitNest MCP 查候选关系，未命中和关键关系仍需用 rg 核对。"
              : "可以用 GitNest MCP 查询候选调用图；关键关系仍需用当前源码核对。";
    const target =
      workspaceIndex >= 0
        ? targets[workspaceIndex]
        : targets.length > 0
          ? latestTarget(targets)
          : undefined;
    const targetIndex = target
      ? targets.indexOf(target)
      : -1;
    const body = {
      projectMatched: true,
      matchedRepositoryRoot: match.root.path,
      workspaceId: match.workspaceId,
      workspaceName: match.workspaceName,
      hasWorkspaceAnalysis,
      hasChangedAnalysis,
      useMcp,
      decisionReason,
      analyses,
      guidance
    };
    const summary =
      targetIndex >= 0 ? summaries[targetIndex] : undefined;
    const policy =
      targetIndex >= 0 ? policies[targetIndex] : undefined;
    return target
      ? envelope(
          target,
          summary?.freshness ?? "unknown",
          {
            ...(policy
              ? snapshotPolicyPayload(policy)
              : {}),
            ...body
          }
        )
      : body;
  });
}

async function runTrace(
  context: ToolContext,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  return guard(
    context,
    async (settings) => {
      const query = requireString(args.query, "query");
      const language = readLanguage(args.language);
      if (query.length > 256) {
        throw new ToolFailure("query 不得超过 256 个字符。");
      }
      const pathPrefix = optionalString(args.pathPrefix)
        ?.replaceAll("\\", "/")
        .replace(/^\.\//, "")
        .toLocaleLowerCase("en-US");
      if (pathPrefix && pathPrefix.length > 1_024) {
        throw new ToolFailure(
          "pathPrefix 不得超过 1024 个字符。"
        );
      }
      if (
        pathPrefix &&
        (
          pathPrefix.startsWith("/") ||
          /^[a-z]:\//i.test(pathPrefix) ||
          pathPrefix.split("/").includes("..")
        )
      ) {
        throw new ToolFailure(
          "pathPrefix 必须是仓库内的相对路径。"
        );
      }
      const matches = await matchedProjects(context, args);
      if (matches.length === 0) {
        throw new DataAccessError(
          "project-unmatched",
          "当前项目不属于 GitNest 已登记的分析仓库；请用 rg 检查当前源码。"
        );
      }
      const scope = targetSelector(args).scope ?? "workspace";
      let target: AnalysisTarget | undefined;
      let match: ProjectAnalysisMatch | undefined;
      for (const candidate of matches) {
        try {
          target = await context.access.pickTarget({
            workspaceId: candidate.workspaceId,
            scope
          });
          match = candidate;
          break;
        } catch (error) {
          if (
            !(error instanceof DataAccessError) ||
            error.code !== "snapshot-unavailable"
          ) {
            throw error;
          }
        }
      }
      if (!target || !match) {
        throw new DataAccessError(
          "snapshot-unavailable",
          "当前项目没有可用的代码分析快照；请先在 GitNest 执行分析，当前用 rg 检查源码。"
        );
      }
      const freshness =
        await context.access.freshnessFor(target);
      const policy = snapshotUsePolicy(
        target,
        freshness,
        settings.maxStaleAgeDays,
        context.now?.() ?? Date.now()
      );
      if (!policy.usable) {
        throw new DataAccessError(
          "snapshot-expired",
          `代码分析快照已超过 ${settings.maxStaleAgeDays} 天陈旧数据期限；请重新分析后再查询。`
        );
      }
      return envelope(
        target,
        freshness,
        {
          ...snapshotPolicyPayload(policy),
          projectMatched: true,
          matchedRepositoryRoot: match.root.path,
          ...traceGraph(target, query, pathPrefix, language)
        }
      );
    }
  );
}

async function matchedProjects(
  context: ToolContext,
  args: Record<string, unknown>
): Promise<ProjectAnalysisMatch[]> {
  const projectPath = requireString(
    args.projectPath,
    "projectPath"
  );
  const workspaceId = optionalString(args.workspaceId);
  const matches = await context.access.matchProjectPath(
    projectPath
  );
  return workspaceId
    ? matches.filter(
        (match) => match.workspaceId === workspaceId
      )
    : matches;
}

function latestTarget(
  targets: AnalysisTarget[]
): AnalysisTarget {
  return targets.reduce((latest, candidate) => {
    const difference =
      (Date.parse(candidate.snapshot.generatedAt) || 0) -
      (Date.parse(latest.snapshot.generatedAt) || 0);
    return difference > 0 ||
      (difference === 0 &&
        candidate.scope === "changed" &&
        latest.scope !== "changed")
      ? candidate
      : latest;
  });
}

function traceGraph(
  target: AnalysisTarget,
  query: string,
  pathPrefix?: string,
  language?: CodeAnalysisLanguage
): Record<string, unknown> {
  const snapshot = target.snapshot;
  const search = searchGraphNodes(snapshot, {
    query,
    kinds: TRACE_NODE_KINDS,
    ...(language ? { languages: [language] } : {}),
    ...(pathPrefix ? { pathPrefix } : {}),
    limit: MAX_TRACE_MATCHES
  });
  const matchedNodeIds = new Set(
    search.nodes.map((node) => node.id)
  );
  const nodeById = new Map(
    snapshot.nodes.map((node) => [node.id, node])
  );
  const route = /^(?:(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+)?(\/\S+)$/i.exec(
    query
  );
  const relatedChains = snapshot.requestChains
    .filter((chain) => {
      if (route) {
        const method = route[1];
        const path = route[2];
        if (
          !path ||
          chain.route.toLocaleLowerCase("en-US") !==
            path.toLocaleLowerCase("en-US") ||
          (method && chain.method !== method.toUpperCase()) ||
          (
            language &&
            ![chain.clientNodeId, chain.endpointNodeId].some(
              (nodeId) =>
                nodeById.get(nodeId)?.language === language
            )
          )
        ) {
          return false;
        }
        return (
          !pathPrefix ||
          chain.nodeIds.some((nodeId) =>
            nodeById
              .get(nodeId)
              ?.location.path.replaceAll("\\", "/")
              .toLocaleLowerCase("en-US")
              .startsWith(pathPrefix)
          )
        );
      }
      return chain.nodeIds.some((nodeId) =>
        matchedNodeIds.has(nodeId)
      );
    })
    .sort(
      (left, right) =>
        Number(right.transport === "http") -
          Number(left.transport === "http") ||
        left.title.localeCompare(right.title)
    );
  const anchoredChains = relatedChains.filter(
    (chain) =>
      matchedNodeIds.has(chain.clientNodeId) ||
      matchedNodeIds.has(chain.endpointNodeId)
  );
  const matchingChains =
    route || anchoredChains.length > 0
      ? route
        ? relatedChains
        : anchoredChains
      : relatedChains.some(
            (chain) => chain.transport === "http"
          )
        ? relatedChains.filter(
            (chain) => chain.transport === "http"
          )
        : relatedChains;
  const chains = matchingChains.slice(0, MAX_TRACE_CHAINS);
  const chainEdgeIds = new Set(
    chains.flatMap((chain) => chain.edgeIds)
  );
  const chainEdges = snapshot.edges.filter(
    (edge) => chainEdgeIds.has(edge.id)
  );
  const boundaryEdges = chainEdges.filter(
    (edge) =>
      edge.kind === "http-request" ||
      edge.kind === "rpc-request"
  );
  const priorityNodeIds = [
    ...new Set([
      ...chains.flatMap((chain) => [
        chain.clientNodeId,
        chain.endpointNodeId
      ]),
      ...boundaryEdges.flatMap((edge) => [
        edge.from,
        edge.to
      ]),
      ...chains.flatMap((chain) => chain.nodeIds)
    ])
  ];
  const local =
    chains.length === 0 && search.nodes.length > 0
      ? collectSubgraph(snapshot, {
          nodeIds: search.nodes
            .slice(0, MAX_TRACE_CHAINS)
            .map((node) => node.id),
          direction: "both",
          depth: 2,
          edgeKinds: TRACE_EDGE_KINDS,
          maxNodes: MAX_TRACE_NODES,
          maxEdges: MAX_TRACE_EDGES
        })
      : undefined;
  const graphNodes = local?.nodes ??
    priorityNodeIds
      .map((nodeId) => nodeById.get(nodeId))
      .filter(
        (node): node is CodeGraphNode =>
          node !== undefined
      );
  const graphEdges = local?.edges ??
    [
      ...boundaryEdges,
      ...chainEdges.filter(
        (edge) =>
          edge.kind !== "http-request" &&
          edge.kind !== "rpc-request"
      )
    ];
  const nodes = graphNodes.slice(0, MAX_TRACE_NODES);
  const includedIds = new Set(
    nodes.map((node) => node.id)
  );
  const connectedEdges = graphEdges.filter(
    (edge) =>
      includedIds.has(edge.from) &&
      includedIds.has(edge.to)
  );
  const edges = connectedEdges.slice(0, MAX_TRACE_EDGES);
  const truncationReasons = [
    ...(search.truncated ? ["max-matches"] : []),
    ...(matchingChains.length > chains.length
      ? ["max-chains"]
      : []),
    ...(graphNodes.length > nodes.length
      ? ["max-nodes"]
      : []),
    ...(graphEdges.length > edges.length
      ? ["max-edges"]
      : []),
    ...(local?.truncationReasons ?? [])
  ];
  const found =
    search.totalMatches > 0 ||
    matchingChains.length > 0;
  const guidance = !found
    ? "快照中未找到匹配项，这不表示源码不存在；请用 rg 核对当前文件。"
    : chains.length === 0
      ? "未建立跨端请求链；这里只返回局部调用关系，请用源码核对。"
      : truncationReasons.length > 0
        ? graphNodes.length > nodes.length ||
          graphEdges.length > edges.length
          ? "调用图超出安全上限；已优先保留跨端边界，可从更具体的函数继续查询并用 rg 核对。"
          : "候选链过多；可用 pathPrefix 缩小到具体项目或文件。"
        : undefined;

  return {
    found,
    chainFound: chains.length > 0,
    query,
    ...(language ? { language } : {}),
    totalMatches: search.totalMatches,
    totalChains: matchingChains.length,
    matches: search.nodes.map((node) =>
      summarizeNode(target, node)
    ),
    chains: chains.map(summarizeChain),
    nodes: nodes.map((node) =>
      summarizeNode(target, node)
    ),
    edges: edges.map(summarizeEdge),
    truncated: truncationReasons.length > 0,
    truncationReasons: [...new Set(truncationReasons)],
    ...(target.snapshot.indexStatus?.resultCompleteness ===
    "partial"
      ? {
          coverageNote:
            target.snapshot.indexStatus.message
        }
      : {}),
    ...(guidance ? { guidance } : {})
  };
}

function summarizeNode(
  target: AnalysisTarget,
  node: CodeGraphNode
): Record<string, unknown> {
  const root = target.snapshot.roots.find(
    (candidate) =>
      candidate.repositoryId === node.location.repositoryId &&
      candidate.worktreeId === node.location.worktreeId
  );
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    qualifiedName: node.qualifiedName,
    repositoryName: root?.name,
    repositoryRoot: root?.path,
    relativePath: node.location.path,
    line: node.location.line,
    language: node.language,
    changed: node.changed
  };
}

function summarizeEdge(
  edge: CodeGraphEdge
): Record<string, unknown> {
  return {
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    confidence: edge.confidence,
    source: edge.source ?? "builtin",
    ...(edge.label ? { label: edge.label } : {}),
    ...(edge.evidence ? { evidence: edge.evidence } : {})
  };
}

function summarizeChain(
  chain: CodeRequestChain
): Record<string, unknown> {
  return {
    id: chain.id,
    transport: chain.transport,
    method: chain.method,
    route: chain.route,
    clientNodeId: chain.clientNodeId,
    endpointNodeId: chain.endpointNodeId,
    changed: chain.changed,
    ambiguous: chain.ambiguous,
    confidence: chain.confidence
  };
}

type SnapshotReliability =
  | "current"
  | "degraded"
  | "unverified"
  | "expired";

interface SnapshotUsePolicy {
  usable: boolean;
  reliability: SnapshotReliability;
  maxStaleAgeDays: number;
  requiresSourceVerification: boolean;
  snapshotAgeMs?: number;
  expiresAt?: string;
  clockSkewDetected?: boolean;
}

function snapshotUsePolicy(
  target: AnalysisTarget,
  freshness: AnalysisFreshness,
  maxStaleAgeDays: number,
  now: number
): SnapshotUsePolicy {
  const generatedAt = Date.parse(
    target.snapshot.generatedAt
  );
  const validGeneratedAt = Number.isFinite(generatedAt);
  const snapshotAgeMs = validGeneratedAt
    ? Math.max(0, now - generatedAt)
    : undefined;
  const clockSkewDetected =
    validGeneratedAt && generatedAt > now;

  if (freshness === "fresh") {
    return {
      usable: true,
      reliability: "current",
      maxStaleAgeDays,
      requiresSourceVerification: false,
      ...(snapshotAgeMs !== undefined ? { snapshotAgeMs } : {}),
      ...(clockSkewDetected ? { clockSkewDetected } : {})
    };
  }
  if (!validGeneratedAt) {
    return {
      usable: false,
      reliability: "expired",
      maxStaleAgeDays,
      requiresSourceVerification: true
    };
  }

  const expiresAtMs =
    generatedAt + maxStaleAgeDays * DAY_MS;
  const usable = now <= expiresAtMs;
  return {
    usable,
    reliability: usable
      ? freshness === "stale"
        ? "degraded"
        : "unverified"
      : "expired",
    maxStaleAgeDays,
    requiresSourceVerification: true,
    snapshotAgeMs: Math.max(0, now - generatedAt),
    expiresAt: new Date(expiresAtMs).toISOString(),
    ...(clockSkewDetected ? { clockSkewDetected } : {})
  };
}

function snapshotPolicyPayload(
  policy: SnapshotUsePolicy
): Record<string, unknown> {
  return {
    snapshotReliability: policy.reliability,
    snapshotExpired: !policy.usable,
    maxStaleAgeDays: policy.maxStaleAgeDays,
    requiresSourceVerification:
      policy.requiresSourceVerification,
    ...(policy.snapshotAgeMs !== undefined
      ? { snapshotAgeMs: policy.snapshotAgeMs }
      : {}),
    ...(policy.expiresAt
      ? { expiresAt: policy.expiresAt }
      : {}),
    ...(policy.clockSkewDetected
      ? { clockSkewDetected: true }
      : {})
  };
}

async function guard(
  context: ToolContext,
  run: (
    settings: ToolSettings
  ) => Promise<Record<string, unknown>>
): Promise<McpToolResult> {
  let maxResponseKb = DEFAULT_MAX_RESPONSE_KB;
  try {
    const settings = await context.readSettings();
    maxResponseKb = settings.maxResponseKb;
    if (!settings.enabled) {
      return textResult(
        {
          code: "mcp-disabled",
          useMcp: false,
          guidance:
            "GitNest 设置中的 MCP 服务已关闭。请在 GitNest 的代码分析设置中启用后重试。"
        },
        { isError: true }
      );
    }
    const body = await run(settings);
    return textResult(
      limitPayload(body, settings.maxResponseKb)
    );
  } catch (error) {
    if (error instanceof DataAccessError) {
      return textResult(
        limitPayload(
          {
            code: error.code,
            useMcp: false,
            guidance: error.message
          },
          maxResponseKb
        ),
        { isError: true }
      );
    }
    if (error instanceof ToolFailure) {
      return textResult(
        limitPayload(
          {
            code: "invalid-request",
            useMcp: false,
            guidance: error.message
          },
          maxResponseKb
        ),
        { isError: true }
      );
    }
    const message =
      error instanceof Error ? error.message : String(error);
    return textResult(
      limitPayload(
        {
          code: "internal-error",
          useMcp: false,
          guidance: message
        },
        maxResponseKb
      ),
      { isError: true }
    );
  }
}

function envelope(
  target: AnalysisTarget,
  freshness: "fresh" | "stale" | "unknown",
  body: Record<string, unknown>
): Record<string, unknown> {
  const snapshot = target.snapshot;
  return {
    analysisId: snapshot.analysisId,
    workspaceId: target.workspaceId,
    workspaceName: target.workspaceName,
    scope: target.scope,
    generatedAt: snapshot.generatedAt,
    completeness:
      snapshot.indexStatus?.resultCompleteness ?? "complete",
    impactCoverage:
      snapshot.indexStatus?.impactCoverage ?? "confirmed",
    freshness,
    ...(freshness === "fresh"
      ? {}
      : {
          freshnessNote:
            freshness === "stale"
              ? "快照早于当前仓库状态，行号与关系可能已过期。"
              : "无法验证快照是否最新。"
        }),
    ...body
  };
}

function limitPayload(
  payload: Record<string, unknown>,
  maxResponseKb: number
): Record<string, unknown> {
  const limit = Math.min(
    Math.max(maxResponseKb, MIN_MAX_RESPONSE_KB),
    MAX_MAX_RESPONSE_KB
  ) * 1_024;
  if (responseBytes(payload) <= limit) {
    return payload;
  }
  const reduced: Record<string, unknown> = {
    ...payload,
    truncated: true,
    truncationReasons: ["max-response-size"]
  };
  if (Array.isArray(payload.edges)) {
    reduced.nodes = [];
    reduced.edges = [];
    reduced.chains = [];
    reduced.matches = Array.isArray(payload.matches)
      ? payload.matches.slice(0, 5)
      : [];
    reduced.guidance =
      "调用关系超过响应上限；请缩小查询、从更具体的函数继续追踪，或提高 MCP 响应上限。";
    if (responseBytes(reduced) <= limit) {
      return reduced;
    }
  } else if (Array.isArray(payload.analyses)) {
    let count = payload.analyses.length;
    while (count > 0 && responseBytes(reduced) > limit) {
      count = Math.floor(count / 2);
      reduced.analyses = payload.analyses.slice(0, count);
    }
    if (responseBytes(reduced) <= limit) {
      return reduced;
    }
  } else if (Array.isArray(payload.projects)) {
    let count = payload.projects.length;
    while (count > 0 && responseBytes(reduced) > limit) {
      count = Math.floor(count / 2);
      reduced.projects = payload.projects.slice(0, count);
    }
    if (responseBytes(reduced) <= limit) {
      return reduced;
    }
  }
  const minimal = {
    ...(typeof payload.analysisId === "string"
      ? { analysisId: payload.analysisId }
      : {}),
    ...(typeof payload.workspaceId === "string"
      ? { workspaceId: payload.workspaceId }
      : {}),
    ...(typeof payload.scope === "string"
      ? { scope: payload.scope }
      : {}),
    ...(typeof payload.generatedAt === "string"
      ? { generatedAt: payload.generatedAt }
      : {}),
    ...(typeof payload.completeness === "string"
      ? { completeness: payload.completeness }
      : {}),
    ...(typeof payload.freshness === "string"
      ? { freshness: payload.freshness }
      : {}),
    ...(typeof payload.projectMatched === "boolean"
      ? { projectMatched: payload.projectMatched }
      : {}),
    ...(typeof payload.useMcp === "boolean"
      ? { useMcp: payload.useMcp }
      : {}),
    code: typeof payload.code === "string"
      ? payload.code
      : "response-too-large",
    truncated: true,
    truncationReasons: ["max-response-size"],
    guidance:
      "结果超过响应上限；请缩小查询范围后重试。"
  };
  return responseBytes(minimal) <= limit
    ? minimal
    : {
        code: "response-too-large",
        truncated: true,
        truncationReasons: ["max-response-size"]
      };
}

function responseBytes(
  payload: Record<string, unknown>
): number {
  return Buffer.byteLength(
    JSON.stringify(textResult(payload)),
    "utf8"
  );
}

function targetSelector(
  args: Record<string, unknown>
): {
  workspaceId?: string;
  scope?: "workspace" | "changed";
} {
  const workspaceId = optionalString(args.workspaceId);
  const scope = readScope(args.scope);
  if (args.scope !== undefined && !scope) {
    throw new ToolFailure(
      "scope 只能是 workspace 或 changed。"
    );
  }
  return {
    ...(workspaceId ? { workspaceId } : {}),
    ...(scope ? { scope } : {})
  };
}

function requireString(
  value: unknown,
  name: string
): string {
  const text = optionalString(value);
  if (!text) {
    throw new ToolFailure(`缺少参数 ${name}。`);
  }
  return text;
}

function optionalString(
  value: unknown
): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function readScope(
  value: unknown
): "workspace" | "changed" | undefined {
  return value === "workspace" || value === "changed"
    ? value
    : undefined;
}

function readLanguage(
  value: unknown
): CodeAnalysisLanguage | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value === "string" &&
    TRACE_LANGUAGES.some(
      (candidate) => candidate === value
    )
  ) {
    return value as CodeAnalysisLanguage;
  }
  throw new ToolFailure(
    `language 只能是 ${TRACE_LANGUAGES.join("、")}。`
  );
}
