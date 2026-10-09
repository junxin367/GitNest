import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import {
  searchGraphNodes,
  type CodeAnalysisSnapshot,
  type CodeGraphEdge,
  type CodeGraphNode,
  type NodeSearchResult
} from "@gitnest/code-analysis";

export interface CodeAnalysisNodeQuery {
  query?: string;
  focusNodeId?: string;
  inspectedNodeId?: string;
}

export interface CodeAnalysisNodePage {
  query: string;
  nodeIds: string[];
  totalMatches: number;
  focusNodeId?: string;
  graphTruncated: boolean;
}

const PAGE_SIZE = 120;
const CHUNK_SIZE = 512;
const MAX_GRAPH_NODES = 400;
const MAX_GRAPH_EDGES = 800;

/** One immutable analysis owns its indexes; no full graph is sent to the page. */
export class CodeAnalysisNodeViews {
  readonly #snapshot: CodeAnalysisSnapshot;
  readonly #searches = new Map<string, Promise<NodeSearchResult>>();
  readonly #index: Promise<{
    nodes: Map<string, CodeGraphNode>;
    edges: Map<string, CodeGraphEdge[]>;
  }>;

  constructor(snapshot: CodeAnalysisSnapshot) {
    this.#snapshot = snapshot;
    this.#index = this.#buildIndex();
  }

  async #buildIndex() {
    const nodes = new Map<string, CodeGraphNode>();
    const edges = new Map<string, CodeGraphEdge[]>();
    // Yield before work and between chunks so initial navigation and other IPC
    // requests can complete while the complete index is prepared.
    for (let offset = 0; offset < this.#snapshot.nodes.length; offset += CHUNK_SIZE) {
      await yieldToEventLoop();
      for (const node of this.#snapshot.nodes.slice(offset, offset + CHUNK_SIZE)) {
        nodes.set(node.id, node);
      }
    }
    for (let offset = 0; offset < this.#snapshot.edges.length; offset += CHUNK_SIZE) {
      await yieldToEventLoop();
      for (const edge of this.#snapshot.edges.slice(offset, offset + CHUNK_SIZE)) {
        // Match the relation canvas: file ownership and imports must not consume
        // the neighborhood budget before call/type/reference relationships.
        if (edge.kind === "contains"
          ? !nodes.has(edge.to) || !nodes.has(edge.from) || nodes.get(edge.from)?.kind === "file"
          : !["calls", "extends", "implements", "overrides", "http-request", "rpc-request", "references"].includes(edge.kind)) {
          continue;
        }
        for (const id of new Set([edge.from, edge.to])) {
          const adjacent = edges.get(id) ?? [];
          adjacent.push(edge);
          edges.set(id, adjacent);
        }
      }
    }
    return { nodes, edges };
  }

  search(query: string): Promise<NodeSearchResult> {
    const cached = this.#searches.get(query);
    if (cached) return cached;
    const pending = this.#search(query);
    this.#searches.set(query, pending);
    if (this.#searches.size > 8) {
      this.#searches.delete(this.#searches.keys().next().value!);
    }
    return pending;
  }

  async #search(query: string): Promise<NodeSearchResult> {
    let nodes: CodeGraphNode[] = [];
    let totalMatches = 0;
    for (let offset = 0; offset < this.#snapshot.nodes.length; offset += CHUNK_SIZE) {
      await yieldToEventLoop();
      const batch = searchGraphNodes(
        { nodes: this.#snapshot.nodes.slice(offset, offset + CHUNK_SIZE) },
        { query, limit: PAGE_SIZE }
      );
      totalMatches += batch.totalMatches;
      nodes = searchGraphNodes(
        { nodes: [...nodes, ...batch.nodes] }, { query, limit: PAGE_SIZE }
      ).nodes;
    }
    return { nodes, totalMatches, truncated: totalMatches > PAGE_SIZE };
  }

  async read(request: CodeAnalysisNodeQuery) {
    const query = (request.query ?? "").slice(0, 256).trim();
    const result = await this.search(query);
    const selected = new Map(result.nodes.map(node => [node.id, node]));
    const graphEdges = new Map<string, CodeGraphEdge>();
    let graphTruncated = false;
    if (request.focusNodeId || request.inspectedNodeId) {
      const index = await this.#index;
      const focused = request.focusNodeId ? index.nodes.get(request.focusNodeId) : undefined;
      const visited = new Set<string>();
      const queue: Array<{ id: string; depth: number }> = [];
      if (focused) {
        selected.set(focused.id, focused);
        visited.add(focused.id);
        queue.push({ id: focused.id, depth: 0 });
      }
      // Containers need room for both their members and members' call chains.
      const maxDepth = focused && ["file", "module", "package", "class", "interface", "enum"]
        .includes(focused.kind) ? 8 : 4;
      for (let offset = 0; offset < queue.length; offset += 1) {
        const current = queue[offset]!;
        const adjacent = index.edges.get(current.id) ?? [];
        for (let edgeIndex = 0; edgeIndex < adjacent.length; edgeIndex += 1) {
          if (edgeIndex % CHUNK_SIZE === 0) await yieldToEventLoop();
          const edge = adjacent[edgeIndex]!;
          const neighborId = edge.from === current.id ? edge.to : edge.from;
          const neighbor = index.nodes.get(neighborId);
          if (!neighbor) continue;
          if (!visited.has(neighborId)) {
            if (current.depth >= maxDepth) continue;
            if (visited.size >= MAX_GRAPH_NODES || graphEdges.size >= MAX_GRAPH_EDGES) {
              graphTruncated = true;
              continue;
            }
            visited.add(neighborId);
            selected.set(neighborId, neighbor);
            queue.push({ id: neighborId, depth: current.depth + 1 });
          }
          if (graphEdges.size < MAX_GRAPH_EDGES) graphEdges.set(edge.id, edge);
          else if (!graphEdges.has(edge.id)) graphTruncated = true;
        }
      }
      const inspected = request.inspectedNodeId ? index.nodes.get(request.inspectedNodeId) : undefined;
      if (inspected) selected.set(inspected.id, inspected);
    }
    const nodePage: CodeAnalysisNodePage = {
      query,
      nodeIds: result.nodes.map(node => node.id),
      totalMatches: result.totalMatches,
      ...(request.focusNodeId ? { focusNodeId: request.focusNodeId } : {}),
      graphTruncated
    };
    return {
      ...this.#snapshot,
      nodes: [...selected.values()],
      edges: [...graphEdges.values()],
      requestChains: [],
      nodePage
    };
  }
}
