import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";

import type {
  CodeAnalysisSnapshotDto,
  CodeGraphEdgeDto,
  CodeGraphNodeDto,
  CodeRequestChainDto
} from "@gitnest/contracts";

import { Icon } from "../../shared/ui/Icon";
import { Button } from "../../shared/ui/Button";
import {
  codeNodeDisplayName,
  getCodeNodeLookup
} from "./codeAnalysisNavigation";

interface CodeRelationGraphProps {
  loading?: boolean;
  error?: string | undefined;
  onRetry?(): void;
  snapshot: CodeAnalysisSnapshotDto;
  chain: CodeRequestChainDto | null;
  focusNodeId: string | null;
  selectedNodeId: string | null;
  onSelectNode(nodeId: string): void;
  onClearSelection(): void;
}

const NODE_WIDTH = 184;
const NODE_HEIGHT = 88;
const NODE_TEXT_INSET = 8;
const NODE_TEXT_TOP = 24;
const NODE_TEXT_BOTTOM_INSET = 6;
const NODE_TEXT_WIDTH = NODE_WIDTH - NODE_TEXT_INSET * 2;
const NODE_TEXT_HEIGHT =
  NODE_HEIGHT - NODE_TEXT_TOP - NODE_TEXT_BOTTOM_INSET;
const COLUMN_GAP = 72;
const ROW_GAP = 24;
const GRAPH_PADDING = 28;
const MAX_GRAPH_NODES = 160;
const MAX_GRAPH_EDGES = 320;
const NODE_GRAPH_DEPTH = 4;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const ZOOM_BUTTON_FACTOR = 1.2;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

interface Position {
  x: number;
  y: number;
}

export interface PositionedCodeNode extends Position {
  node: CodeGraphNodeDto;
  level: number;
}

export interface RelationGraphLayout {
  nodes: PositionedCodeNode[];
  edges: CodeGraphEdgeDto[];
  positionById: Map<string, PositionedCodeNode>;
  width: number;
  height: number;
  truncated: boolean;
}

const EMPTY_LAYOUT: RelationGraphLayout = {
  nodes: [], edges: [], positionById: new Map(),
  width: 0, height: 0, truncated: false
};

interface DirectionalEdges {
  incoming: Map<string, CodeGraphEdgeDto[]>;
  outgoing: Map<string, CodeGraphEdgeDto[]>;
}

const EMPTY_DIRECTIONAL_EDGES: DirectionalEdges = {
  incoming: new Map(),
  outgoing: new Map()
};

interface RelationGraphIndex {
  nodes: CodeGraphNodeDto[];
  edges: CodeGraphEdgeDto[];
  nodeById: ReadonlyMap<string, CodeGraphNodeDto>;
  relationEdges: CodeGraphEdgeDto[];
  outgoingEdgeIndexes: Map<string, number[]>;
  fallbackIds: string[];
  directional?: DirectionalEdges;
  container?: {
    structural: DirectionalEdges;
    semantic: DirectionalEdges;
  };
}

// Snapshots are replaced when analysis changes. Weak keys release indexes with
// their snapshot; array identity also handles replacement on the same object.
// The retained node/edge references and lazy adjacency lists are O(N + E).
const relationGraphIndexes = new WeakMap<
  CodeAnalysisSnapshotDto,
  RelationGraphIndex
>();

function getRelationGraphIndex(
  snapshot: CodeAnalysisSnapshotDto
): RelationGraphIndex {
  const cached = relationGraphIndexes.get(snapshot);
  if (
    cached?.nodes === snapshot.nodes &&
    cached.edges === snapshot.edges
  ) {
    return cached;
  }
  const nodeById = getCodeNodeLookup(snapshot.nodes);
  const relationEdges: CodeGraphEdgeDto[] = [];
  const outgoingEdgeIndexes = new Map<string, number[]>();
  for (const edge of snapshot.edges) {
    if (!isCodeRelation(edge, nodeById)) {
      continue;
    }
    let outgoing = outgoingEdgeIndexes.get(edge.from);
    if (!outgoing) {
      outgoing = [];
      outgoingEdgeIndexes.set(edge.from, outgoing);
    }
    outgoing.push(relationEdges.length);
    relationEdges.push(edge);
  }
  const fallbackIds: string[] = [];
  for (const node of snapshot.nodes) {
    if (node.kind !== "file") {
      fallbackIds.push(node.id);
      if (fallbackIds.length === Math.min(48, MAX_GRAPH_NODES)) {
        break;
      }
    }
  }
  const index: RelationGraphIndex = {
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    nodeById,
    relationEdges,
    outgoingEdgeIndexes,
    fallbackIds
  };
  relationGraphIndexes.set(snapshot, index);
  return index;
}

function edgesWithin(
  index: RelationGraphIndex,
  nodeIds: ReadonlySet<string>,
  edgeIds?: ReadonlySet<string>
): CodeGraphEdgeDto[] {
  const positions: number[] = [];
  for (const nodeId of nodeIds) {
    for (const position of index.outgoingEdgeIndexes.get(nodeId) ?? []) {
      const edge = index.relationEdges[position]!;
      if (
        nodeIds.has(edge.to) &&
        (!edgeIds?.size || edgeIds.has(edge.id))
      ) {
        positions.push(position);
      }
    }
  }
  // Layout and truncation depend on the original snapshot edge order.
  positions.sort((left, right) => left - right);
  return positions.map((position) => index.relationEdges[position]!);
}

function directionalEdges(
  edges: CodeGraphEdgeDto[]
): DirectionalEdges {
  return {
    incoming: edgeAdjacency(edges, "to"),
    outgoing: edgeAdjacency(edges, "from")
  };
}

type GraphDragState =
  | {
      kind: "canvas";
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startPanX: number;
      startPanY: number;
      moved: boolean;
    }
  | {
      kind: "node";
      pointerId: number;
      nodeId: string;
      startClientX: number;
      startClientY: number;
      startX: number;
      startY: number;
      svgWidth: number;
      svgHeight: number;
      moved: boolean;
    };

export const CodeRelationGraph = memo(function CodeRelationGraph({
  loading = false,
  error,
  onRetry,
  snapshot,
  chain,
  focusNodeId,
  selectedNodeId,
  onSelectNode,
  onClearSelection
}: CodeRelationGraphProps) {
  const graph = useMemo(
    () => loading || error ? EMPTY_LAYOUT :
      buildRelationGraphLayout(
        snapshot,
        chain,
        focusNodeId
      ),
    [chain, focusNodeId, snapshot, loading, error]
  );
  const [positionOverrides, setPositionOverrides] = useState<
    Record<string, Position>
  >({});
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState<Position>({
    x: 0,
    y: 0
  });
  const [panning, setPanning] = useState(false);
  const [draggingNodeId, setDraggingNodeId] = useState<
    string | null
  >(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<GraphDragState | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panOffsetRef = useRef(panOffset);
  panOffsetRef.current = panOffset;
  const arrowId = useId().replace(/:/g, "");
  const workspaceKey = JSON.stringify([snapshot.workspaceId, snapshot.scope]);
  const contextKey = `${workspaceKey}:${
    chain ? `chain:${chain.id}` : `node:${focusNodeId ?? ""}`
  }`;

  const zoomWorkspaceKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (zoomWorkspaceKeyRef.current === workspaceKey) return;
    zoomWorkspaceKeyRef.current = workspaceKey;
    zoomRef.current = 1;
    setZoom(1);
  }, [workspaceKey]);

  const layoutFocusNodeId =
    focusNodeId ?? chain?.clientNodeId ?? graph.nodes[0]?.node.id;

  const layoutKey = useMemo(() => JSON.stringify([
    graph.nodes.map(({ node, x, y }) => [node.id, x, y]),
    graph.edges.map(edge => [edge.id, edge.from, edge.to])
  ]), [graph]);
  const layoutContextRef = useRef<{ key: string; layout: string; focus: typeof layoutFocusNodeId } | null>(null);
  useLayoutEffect(() => {
    // Commit the completed layout and its centered viewport before painting.
    // A partial graph must never briefly appear while its neighborhood loads.
    if (loading || error) return;
    const previous = layoutContextRef.current;
    if (previous?.key === contextKey && previous.layout === layoutKey && previous.focus === layoutFocusNodeId) return;
    layoutContextRef.current = { key: contextKey, layout: layoutKey, focus: layoutFocusNodeId };
    setPositionOverrides({});
    dragRef.current = null;
    setPanning(false);
    setDraggingNodeId(null);
    const position = layoutFocusNodeId
      ? graph.positionById.get(layoutFocusNodeId)
      : undefined;
    const nextPan = position
      ? panForPosition(graph, position, zoomRef.current)
      : { x: 0, y: 0 };
    panOffsetRef.current = nextPan;
    setPanOffset(nextPan);
  }, [
    contextKey,
    graph,
    layoutKey,
    layoutFocusNodeId,
    loading,
    error
  ]);

  const displayedNodes = useMemo(
    () =>
      graph.nodes.map((positioned) => {
        const override = positionOverrides[positioned.node.id];
        return override ? { ...positioned, ...override } : positioned;
      }),
    [graph.nodes, positionOverrides]
  );
  const displayedPositionById = useMemo(
    () =>
      new Map(
        displayedNodes.map((positioned) => [
          positioned.node.id,
          positioned
        ])
      ),
    [displayedNodes]
  );
  const displayedPositionByIdRef = useRef(displayedPositionById);
  useLayoutEffect(() => {
    displayedPositionByIdRef.current = displayedPositionById;
  }, [displayedPositionById]);
  const zoomAtClientPoint = useCallback(
    (
      nextZoomValue: number,
      clientX: number,
      clientY: number
    ) => {
      const nextZoom = clampZoom(nextZoomValue);
      if (Math.abs(nextZoom - zoomRef.current) < 0.001) {
        return;
      }
      const viewport = viewportRef.current;
      if (viewport) {
        const bounds = viewport.getBoundingClientRect();
        const pointerX =
          clientX - (bounds.left + bounds.width / 2);
        const pointerY =
          clientY - (bounds.top + bounds.height / 2);
        const ratio = nextZoom / zoomRef.current;
        const currentPan = panOffsetRef.current;
        const nextPan = {
          x:
            currentPan.x +
            (pointerX - currentPan.x) * (1 - ratio),
          y:
            currentPan.y +
            (pointerY - currentPan.y) * (1 - ratio)
        };
        panOffsetRef.current = nextPan;
        setPanOffset(nextPan);
      }
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
    },
    []
  );

  const zoomAtViewportCenter = useCallback(
    (nextZoom: number) => {
      const viewport = viewportRef.current;
      if (!viewport) {
        zoomRef.current = clampZoom(nextZoom);
        setZoom(zoomRef.current);
        return;
      }
      const bounds = viewport.getBoundingClientRect();
      zoomAtClientPoint(
        nextZoom,
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2
      );
    },
    [zoomAtClientPoint]
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) {
        return;
      }
      event.preventDefault();
      const delta = normalizeWheelDelta(event, viewport);
      const factor = Math.exp(
        -delta * WHEEL_ZOOM_SENSITIVITY
      );
      zoomAtClientPoint(
        zoomRef.current * factor,
        event.clientX,
        event.clientY
      );
    };
    viewport.addEventListener("wheel", handleWheel, {
      passive: false
    });
    return () =>
      viewport.removeEventListener("wheel", handleWheel);
  }, [graph.nodes.length, zoomAtClientPoint]);

  const handleCanvasPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("[data-graph-node]")
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind: "canvas",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: panOffsetRef.current.x,
      startPanY: panOffsetRef.current.y,
      moved: false
    };
    setPanning(true);
  };

  const handleCanvasPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    const drag = dragRef.current;
    if (
      drag?.kind !== "canvas" ||
      drag.pointerId !== event.pointerId
    ) {
      return;
    }
    event.preventDefault();
    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;
    if (
      !drag.moved &&
      Math.hypot(deltaX, deltaY) >= 3
    ) {
      drag.moved = true;
    }
    if (!drag.moved) {
      return;
    }
    const nextPan = {
      x: drag.startPanX + deltaX,
      y: drag.startPanY + deltaY
    };
    panOffsetRef.current = nextPan;
    setPanOffset(nextPan);
  };

  const endCanvasPan = (
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled = false
  ) => {
    const drag = dragRef.current;
    if (
      drag?.kind !== "canvas" ||
      drag.pointerId !== event.pointerId
    ) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setPanning(false);
    if (!cancelled && !drag.moved) {
      onClearSelection();
    }
  };

  const handleNodePointerDown = useCallback((
    event: ReactPointerEvent<SVGGElement>,
    nodeId: string
  ) => {
    if (event.button !== 0) {
      return;
    }
    const position = displayedPositionByIdRef.current.get(nodeId);
    const svg = event.currentTarget.ownerSVGElement;
    if (!position || !svg) {
      return;
    }
    const bounds = svg.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind: "node",
      pointerId: event.pointerId,
      nodeId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: position.x,
      startY: position.y,
      svgWidth: bounds.width,
      svgHeight: bounds.height,
      moved: false
    };
    setDraggingNodeId(nodeId);
  }, []);

  const handleNodePointerMove = useCallback((
    event: ReactPointerEvent<SVGGElement>,
    nodeId: string
  ) => {
    const drag = dragRef.current;
    if (
      drag?.kind !== "node" ||
      drag.pointerId !== event.pointerId ||
      drag.nodeId !== nodeId
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const clientDeltaX = event.clientX - drag.startClientX;
    const clientDeltaY = event.clientY - drag.startClientY;
    if (
      !drag.moved &&
      Math.hypot(clientDeltaX, clientDeltaY) >= 3
    ) {
      drag.moved = true;
    }
    if (!drag.moved) {
      return;
    }
    const deltaX =
      (clientDeltaX * graph.width) / drag.svgWidth;
    const deltaY =
      (clientDeltaY * graph.height) / drag.svgHeight;
    setPositionOverrides((current) => ({
      ...current,
      [nodeId]: {
        x: drag.startX + deltaX,
        y: drag.startY + deltaY
      }
    }));
  }, [graph.width, graph.height]);

  const endNodeDrag = useCallback((
    event: ReactPointerEvent<SVGGElement>,
    nodeId: string,
    cancelled = false
  ) => {
    const drag = dragRef.current;
    if (
      drag?.kind !== "node" ||
      drag.pointerId !== event.pointerId ||
      drag.nodeId !== nodeId
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDraggingNodeId(null);
    if (!cancelled && !drag.moved) {
      onSelectNode(nodeId);
    }
  }, [onSelectNode]);

  if (loading || error) {
    return (
      <div className="analysis-graph-stage" aria-busy={loading}>
        <div className="analysis-graph-scroll analysis-graph-state">
          <div className="analysis-graph-state-copy" role={error ? "alert" : "status"}>
            <Icon name={error ? "warning" : "refresh"} size={24}
              className={loading ? "is-spinning" : undefined} />
            <strong>{error ? "节点关系加载失败" : "正在加载节点关系…"}</strong>
            <p>{error ?? "正在读取该节点的上下游关系。"}</p>
            {error && onRetry && (
              <Button onClick={onRetry} size="small" type="button">重新加载</Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (graph.nodes.length === 0) {
    return (
      <div className="analysis-graph-empty">
        <strong>当前没有可绘制的调用、引用或类型关系</strong>
        <p>
          搜索并选择代码节点后，这里会同时展示上游调用者、引用位置、类型关系与下游依赖。
        </p>
      </div>
    );
  }

  const resetLayout = () => {
    setPositionOverrides({});
    zoomRef.current = 1;
    setZoom(1);
    const position = layoutFocusNodeId
      ? graph.positionById.get(layoutFocusNodeId)
      : undefined;
    const nextPan = position
      ? panForPosition(graph, position, 1)
      : { x: 0, y: 0 };
    panOffsetRef.current = nextPan;
    setPanOffset(nextPan);
  };

  const centerFocus = () => {
    const targetNodeId =
      selectedNodeId ?? layoutFocusNodeId;
    const position = targetNodeId
      ? displayedPositionById.get(targetNodeId)
      : undefined;
    if (position) {
      const nextPan = panForPosition(
        graph,
        position,
        zoom
      );
      panOffsetRef.current = nextPan;
      setPanOffset(nextPan);
    }
  };

  return (
    <div className="analysis-graph-stage">
      <div
        className={`analysis-graph-scroll${
          panning ? " is-panning" : ""
        }`}
        onPointerCancel={(event) =>
          endCanvasPan(event, true)
        }
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={endCanvasPan}
        ref={viewportRef}
      >
        <div
          className="analysis-graph-canvas"
          style={{
            marginLeft: panOffset.x,
            marginTop: panOffset.y
          }}
        >
          <svg
            aria-label="代码关系图"
            className="analysis-graph-svg"
            height={graph.height * zoom}
            overflow="visible"
            role="group"
            viewBox={`0 0 ${graph.width} ${graph.height}`}
            width={graph.width * zoom}
          >
            <defs>
              <marker
                className="analysis-graph-arrow"
                id={arrowId}
                markerHeight="8"
                markerWidth="8"
                orient="auto"
                refX="7"
                refY="4"
                viewBox="0 0 8 8"
              >
                <path d="M0 0 8 4 0 8z" />
              </marker>
            </defs>
            <RelationGraphEdges
              edges={graph.edges}
              displayedPositionById={displayedPositionById}
              arrowId={arrowId}
            />
            <g className="analysis-graph-nodes">
              {displayedNodes.map(({ node, x, y }) => (
                <RelationGraphNode
                  key={node.id}
                  node={node}
                  x={x}
                  y={y}
                  selected={selectedNodeId === node.id}
                  dragging={draggingNodeId === node.id}
                  onSelectNode={onSelectNode}
                  handleNodePointerDown={handleNodePointerDown}
                  handleNodePointerMove={handleNodePointerMove}
                  endNodeDrag={endNodeDrag}
                />
              ))}
            </g>
          </svg>
        </div>
      </div>

      <div
        aria-label="关系图视图控制"
        className="analysis-graph-controls"
        role="group"
      >
        <button
          aria-label="缩小关系图"
          disabled={zoom <= MIN_ZOOM}
          onClick={() =>
            zoomAtViewportCenter(
              zoomRef.current / ZOOM_BUTTON_FACTOR
            )
          }
          title="缩小"
          type="button"
        >
          <Icon name="minus" size={14} />
        </button>
        <input
          aria-label="调整关系图缩放"
          max={MAX_ZOOM * 100}
          min={MIN_ZOOM * 100}
          onChange={(event) =>
            zoomAtViewportCenter(
              Number(event.currentTarget.value) / 100
            )
          }
          step="1"
          type="range"
          value={Math.round(zoom * 100)}
        />
        <span>{Math.round(zoom * 100)}%</span>
        <button
          aria-label="放大关系图"
          disabled={zoom >= MAX_ZOOM}
          onClick={() =>
            zoomAtViewportCenter(
              zoomRef.current * ZOOM_BUTTON_FACTOR
            )
          }
          title="放大"
          type="button"
        >
          <Icon name="plus" size={14} />
        </button>
        <button
          aria-label="定位当前节点"
          onClick={centerFocus}
          title="定位当前节点"
          type="button"
        >
          <Icon name="eye" size={14} />
        </button>
        <button
          aria-label="重置关系图布局"
          onClick={resetLayout}
          title="重置布局"
          type="button"
        >
          <Icon name="refresh" size={14} />
        </button>
      </div>

      <div className="analysis-graph-direction-hint">
        滚轮缩放 · 任意方向拖动画布 · 点击空白关闭详情
      </div>

      {graph.truncated && (
        <div className="analysis-graph-limit-note" role="status">
          {`关系较多，当前最多展示 ${MAX_GRAPH_NODES} 个节点和 ${MAX_GRAPH_EDGES} 条边；可搜索其他节点查看其上下游。`}
        </div>
      )}
    </div>
  );
});

const RelationGraphNode = memo(function RelationGraphNode({
  node,
  x,
  y,
  selected,
  dragging,
  onSelectNode,
  handleNodePointerDown,
  handleNodePointerMove,
  endNodeDrag
}: {
  node: CodeGraphNodeDto;
  x: number;
  y: number;
  selected: boolean;
  dragging: boolean;
  onSelectNode(nodeId: string): void;
  handleNodePointerDown(
    event: ReactPointerEvent<SVGGElement>,
    nodeId: string
  ): void;
  handleNodePointerMove(
    event: ReactPointerEvent<SVGGElement>,
    nodeId: string
  ): void;
  endNodeDrag(
    event: ReactPointerEvent<SVGGElement>,
    nodeId: string,
    cancelled?: boolean
  ): void;
}) {
  const documentation = nodeDocumentation(node);
  const location = `${node.location.path}:${node.location.line}`;
  const displayName = codeNodeDisplayName(node);
  return (
    <g
      aria-label={`${node.kind} ${node.qualifiedName}`}
      className={`analysis-graph-node node-${node.kind}${
        selected ? " selected" : ""
      }${node.changed ? " changed" : ""}${
        dragging ? " dragging" : ""
      }`}
      data-graph-node="true"
      onKeyDown={(event) => {
        if (
          event.key === "Enter" ||
          event.key === " "
        ) {
          event.preventDefault();
          onSelectNode(node.id);
        }
      }}
      onPointerCancel={(event) =>
        endNodeDrag(event, node.id, true)
      }
      onPointerDown={(event) =>
        handleNodePointerDown(event, node.id)
      }
      onPointerMove={(event) =>
        handleNodePointerMove(event, node.id)
      }
      onPointerUp={(event) =>
        endNodeDrag(event, node.id)
      }
      role="button"
      tabIndex={0}
      transform={`translate(${x} ${y})`}
    >
      <title>
        {[
          node.qualifiedName,
          documentation,
          location
        ]
          .filter(Boolean)
          .join("\n")}
      </title>
      <rect
        height={NODE_HEIGHT}
        rx="9"
        width={NODE_WIDTH}
      />
      <circle cx="12" cy="13" r="5" />
      <text
        className="analysis-node-kind"
        x="22"
        y="17"
      >
        {nodeKindLabel(node)}
      </text>
      <foreignObject
        aria-hidden="true"
        className="analysis-node-copy"
        height={NODE_TEXT_HEIGHT}
        pointerEvents="none"
        width={NODE_TEXT_WIDTH}
        x={NODE_TEXT_INSET}
        y={NODE_TEXT_TOP}
      >
        <div className="analysis-node-copy-inner">
          <strong
            className="analysis-node-name"
            title={node.qualifiedName}
          >
            {displayName}
          </strong>
          {documentation && (
            <span
              className="analysis-node-documentation-summary"
              title={documentation}
            >
              {documentation}
            </span>
          )}
          <span
            className="analysis-node-path"
            title={location}
          >
            {location}
          </span>
        </div>
      </foreignObject>
    </g>
  );
});

const RelationGraphEdges = memo(function RelationGraphEdges({
  edges,
  displayedPositionById,
  arrowId
}: {
  edges: CodeGraphEdgeDto[];
  displayedPositionById: Map<string, PositionedCodeNode>;
  arrowId: string;
}) {
  return (
    <g className="analysis-graph-edges">
      {edges.map((edge) => {
        const from = displayedPositionById.get(
          edge.from
        );
        const to = displayedPositionById.get(edge.to);
        if (!from || !to) {
          return null;
        }
        return (
          <RelationGraphEdge
            key={edge.id}
            edge={edge}
            fromNode={from.node}
            toNode={to.node}
            fromX={from.x}
            fromY={from.y}
            toX={to.x}
            toY={to.y}
            arrowId={arrowId}
          />
        );
      })}
    </g>
  );
});

const RelationGraphEdge = memo(function RelationGraphEdge({
  edge,
  fromNode,
  toNode,
  fromX,
  fromY,
  toX,
  toY,
  arrowId
}: {
  edge: CodeGraphEdgeDto;
  fromNode: CodeGraphNodeDto;
  toNode: CodeGraphNodeDto;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  arrowId: string;
}) {
  const path = edgePath({ x: fromX, y: fromY }, { x: toX, y: toY });
  return (
    <g>
      <title>
        {[
          `${edge.kind}: ${fromNode.qualifiedName} → ${toNode.qualifiedName}`,
          `confidence: ${edge.confidence}`,
          `source: ${edge.source ?? "unknown"}`,
          edge.evidence
        ]
          .filter(Boolean)
          .join("\n")}
      </title>
      <path
        className={`analysis-graph-edge edge-${edge.kind}`}
        d={path.d}
        markerEnd={`url(#${arrowId})`}
      />
      {(edge.kind === "http-request" ||
        edge.kind === "rpc-request" ||
        edge.kind === "references" ||
        edge.kind === "extends" ||
        edge.kind === "implements" ||
        edge.kind === "overrides") && (
        <text
          className={`analysis-graph-edge-label edge-label-${edge.kind}`}
          x={path.labelX}
          y={path.labelY}
        >
          {edge.kind === "rpc-request"
            ? "RPC"
            : edge.kind === "references"
              ? "引用"
              : edge.kind === "extends"
                ? "继承"
                : edge.kind === "implements"
                  ? "实现"
                  : edge.kind === "overrides"
                    ? "重写"
              : "HTTP"}
        </text>
      )}
    </g>
  );
});

export function buildRelationGraphLayout(
  snapshot: CodeAnalysisSnapshotDto,
  chain: CodeRequestChainDto | null,
  focusNodeId: string | null
): RelationGraphLayout {
  const index = getRelationGraphIndex(snapshot);
  const { nodeById, relationEdges } = index;
  let preferredIds: string[];
  let levelById: Map<string, number>;
  let candidateEdges: CodeGraphEdgeDto[];

  if (chain) {
    const chainIds = unique([
      chain.clientNodeId,
      chain.endpointNodeId,
      ...chain.nodeIds
    ]);
    const chainIdSet = new Set(chainIds);
    const chainEdgeIds = new Set(chain.edgeIds);
    candidateEdges = edgesWithin(index, chainIdSet, chainEdgeIds);
    const context = collectDirectionalContext(
      chain.clientNodeId,
      directionalEdges(candidateEdges),
      chainIds,
      Math.max(NODE_GRAPH_DEPTH, chainIds.length)
    );
    preferredIds = unique([
      ...context.nodeIds,
      ...chainIds
    ]);
    levelById = context.levelById;
  } else {
    const focusNode = focusNodeId
      ? nodeById.get(focusNodeId)
      : undefined;
    const context =
      focusNode && isRelationContainer(focusNode)
        ? collectContainerRelationContext(
            focusNode.id,
            (index.container ??= {
              structural: directionalEdges(
                relationEdges.filter(
                  (edge) => edge.kind === "contains"
                )
              ),
              semantic: directionalEdges(
                relationEdges.filter(
                  (edge) => edge.kind !== "contains"
                )
              )
            }),
            NODE_GRAPH_DEPTH
          )
        : collectDirectionalContext(
            focusNodeId,
            focusNodeId
              ? (index.directional ??=
                  directionalEdges(relationEdges))
              : EMPTY_DIRECTIONAL_EDGES,
            index.fallbackIds,
            NODE_GRAPH_DEPTH
          );
    preferredIds = context.nodeIds;
    levelById = context.levelById;
    candidateEdges = relationEdges;
  }

  const limitedIds = preferredIds.slice(0, MAX_GRAPH_NODES);
  const visibleIds = new Set(limitedIds);
  const nodes = limitedIds.flatMap((id) => {
    const node = nodeById.get(id);
    return node ? [node] : [];
  });
  const allVisibleEdges = chain
    ? candidateEdges.filter(
        (edge) =>
          visibleIds.has(edge.from) && visibleIds.has(edge.to)
      )
    : edgesWithin(index, visibleIds);
  const edges = allVisibleEdges.slice(0, MAX_GRAPH_EDGES);

  for (const node of nodes) {
    if (!levelById.has(node.id)) {
      levelById.set(node.id, 0);
    }
  }

  const groups = new Map<number, CodeGraphNodeDto[]>();
  for (const node of nodes) {
    const level = levelById.get(node.id) ?? 0;
    const group = groups.get(level) ?? [];
    group.push(node);
    groups.set(level, group);
  }
  const minLevel = Math.min(0, ...groups.keys());
  const maxLevel = Math.max(0, ...groups.keys());
  const positioned: PositionedCodeNode[] = [];

  for (const group of groups.values()) {
    group.sort(
      (left, right) =>
        Number(right.id === focusNodeId) -
          Number(left.id === focusNodeId) ||
        Number(right.changed) - Number(left.changed) ||
        left.location.path.localeCompare(
          right.location.path,
          "zh-CN"
        ) ||
        left.location.line - right.location.line ||
        left.name.localeCompare(right.name, "zh-CN")
    );
  }
  const branchDepthById = calculateBranchDepths(
    levelById,
    allVisibleEdges
  );
  const rowById = assignGraphRows(
    groups,
    levelById,
    allVisibleEdges,
    branchDepthById,
    minLevel,
    maxLevel
  );

  for (let level = minLevel; level <= maxLevel; level += 1) {
    const group = groups.get(level) ?? [];
    const orderedGroup = [...group].sort(
      (left, right) =>
        (rowById.get(left.id) ?? 0) -
        (rowById.get(right.id) ?? 0)
    );
    for (const node of orderedGroup) {
      if (!node) {
        continue;
      }
      const row = rowById.get(node.id) ?? 0;
      positioned.push({
        node,
        level,
        x:
          GRAPH_PADDING +
          (level - minLevel) * (NODE_WIDTH + COLUMN_GAP),
        y:
          GRAPH_PADDING +
          row * (NODE_HEIGHT + ROW_GAP)
      });
    }
  }

  const rowCount = Math.max(
    1,
    ...[...rowById.values()].map((row) => row + 1)
  );
  const width =
    GRAPH_PADDING * 2 +
    (maxLevel - minLevel + 1) * NODE_WIDTH +
    (maxLevel - minLevel) * COLUMN_GAP;
  const height =
    GRAPH_PADDING * 2 +
    rowCount * NODE_HEIGHT +
    Math.max(0, rowCount - 1) * ROW_GAP;

  return {
    nodes: positioned,
    edges,
    positionById: new Map(
      positioned.map((value) => [value.node.id, value])
    ),
    width,
    height,
    truncated:
      (!chain && snapshot.nodePage?.focusNodeId === focusNodeId &&
        snapshot.nodePage.graphTruncated) ||
      preferredIds.length > MAX_GRAPH_NODES ||
      allVisibleEdges.length > MAX_GRAPH_EDGES
  };
}

function assignGraphRows(
  groups: Map<number, CodeGraphNodeDto[]>,
  levelById: Map<string, number>,
  edges: CodeGraphEdgeDto[],
  branchDepthById: Map<string, number>,
  minLevel: number,
  maxLevel: number
): Map<string, number> {
  const rowById = new Map<string, number>();
  const centerGroup = groups.get(0) ?? [];
  for (let index = 0; index < centerGroup.length; index += 1) {
    const node = centerGroup[index];
    if (node) {
      rowById.set(node.id, index);
    }
  }

  for (let level = 1; level <= maxLevel; level += 1) {
    assignLevelRows(
      level,
      level - 1,
      groups,
      levelById,
      edges,
      branchDepthById,
      rowById
    );
  }
  for (let level = -1; level >= minLevel; level -= 1) {
    assignLevelRows(
      level,
      level + 1,
      groups,
      levelById,
      edges,
      branchDepthById,
      rowById
    );
  }

  for (const group of groups.values()) {
    for (let index = 0; index < group.length; index += 1) {
      const node = group[index];
      if (node && !rowById.has(node.id)) {
        rowById.set(node.id, index);
      }
    }
  }
  return rowById;
}

function assignLevelRows(
  level: number,
  adjacentLevel: number,
  groups: Map<number, CodeGraphNodeDto[]>,
  levelById: Map<string, number>,
  edges: CodeGraphEdgeDto[],
  branchDepthById: Map<string, number>,
  rowById: Map<string, number>
): void {
  const group = groups.get(level);
  if (!group) {
    return;
  }
  const candidates = group.map((node, stableIndex) => {
    const anchorRows = edges.flatMap((edge) => {
      const adjacentNodeId =
        level > 0 && edge.to === node.id
          ? edge.from
          : level < 0 && edge.from === node.id
            ? edge.to
            : null;
      if (
        !adjacentNodeId ||
        levelById.get(adjacentNodeId) !== adjacentLevel
      ) {
        return [];
      }
      const row = rowById.get(adjacentNodeId);
      return row === undefined ? [] : [row];
    });
    return {
      node,
      stableIndex,
      branchDepth: branchDepthById.get(node.id) ?? 0,
      desiredRow:
        anchorRows.length > 0 ? median(anchorRows) : null
    };
  });
  candidates.sort(
    (left, right) =>
      Number(left.desiredRow === null) -
        Number(right.desiredRow === null) ||
      (left.desiredRow ?? 0) - (right.desiredRow ?? 0) ||
      right.branchDepth - left.branchDepth ||
      left.stableIndex - right.stableIndex
  );

  const occupiedRows = new Set<number>();
  for (const candidate of candidates) {
    if (candidate.desiredRow === null) {
      continue;
    }
    const row = nearestAvailableRow(
      candidate.desiredRow,
      occupiedRows
    );
    rowById.set(candidate.node.id, row);
    occupiedRows.add(row);
  }
  let fallbackRow = 0;
  for (const candidate of candidates) {
    if (candidate.desiredRow !== null) {
      continue;
    }
    while (occupiedRows.has(fallbackRow)) {
      fallbackRow += 1;
    }
    rowById.set(candidate.node.id, fallbackRow);
    occupiedRows.add(fallbackRow);
  }
}

function calculateBranchDepths(
  levelById: Map<string, number>,
  edges: CodeGraphEdgeDto[]
): Map<string, number> {
  const outwardById = new Map<string, string[]>();
  const addOutwardNode = (nodeId: string, outwardId: string) => {
    const outwardNodes = outwardById.get(nodeId) ?? [];
    outwardNodes.push(outwardId);
    outwardById.set(nodeId, outwardNodes);
  };

  for (const edge of edges) {
    const fromLevel = levelById.get(edge.from);
    const toLevel = levelById.get(edge.to);
    if (fromLevel === undefined || toLevel === undefined) {
      continue;
    }
    if (fromLevel >= 0 && toLevel === fromLevel + 1) {
      addOutwardNode(edge.from, edge.to);
    }
    if (toLevel <= 0 && fromLevel === toLevel - 1) {
      addOutwardNode(edge.to, edge.from);
    }
  }

  const depthById = new Map<string, number>();
  const calculateDepth = (nodeId: string): number => {
    const cachedDepth = depthById.get(nodeId);
    if (cachedDepth !== undefined) {
      return cachedDepth;
    }
    const depth = Math.max(
      0,
      ...(outwardById.get(nodeId) ?? []).map(
        (outwardId) => calculateDepth(outwardId) + 1
      )
    );
    depthById.set(nodeId, depth);
    return depth;
  };

  for (const nodeId of levelById.keys()) {
    calculateDepth(nodeId);
  }
  return depthById;
}

function nearestAvailableRow(
  desiredRow: number,
  occupiedRows: Set<number>
): number {
  const baseRow = Math.max(0, Math.round(desiredRow));
  if (!occupiedRows.has(baseRow)) {
    return baseRow;
  }
  for (let distance = 1; ; distance += 1) {
    const lowerRow = baseRow + distance;
    if (!occupiedRows.has(lowerRow)) {
      return lowerRow;
    }
    const upperRow = baseRow - distance;
    if (upperRow >= 0 && !occupiedRows.has(upperRow)) {
      return upperRow;
    }
  }
}

function median(values: number[]): number {
  const ordered = [...values].sort(
    (left, right) => left - right
  );
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) {
    return ordered[middle] ?? 0;
  }
  return (
    ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) /
    2
  );
}

function collectContainerRelationContext(
  selectedNodeId: string,
  adjacency: NonNullable<RelationGraphIndex["container"]>,
  depthLimit: number
): {
  nodeIds: string[];
  levelById: Map<string, number>;
} {
  const descendants = traverseDirection(
    selectedNodeId,
    adjacency.structural.outgoing,
    (edge) => edge.to,
    depthLimit
  );
  const ancestors = traverseDirection(
    selectedNodeId,
    adjacency.structural.incoming,
    (edge) => edge.from,
    depthLimit
  );
  const memberIds = new Set(descendants.keys());
  const upstream = traverseDirections(
    [...memberIds],
    adjacency.semantic.incoming,
    (edge) => edge.from,
    depthLimit
  );
  const downstream = traverseDirections(
    [...memberIds],
    adjacency.semantic.outgoing,
    (edge) => edge.to,
    depthLimit
  );
  const levelById = new Map<string, number>([
    [selectedNodeId, 0]
  ]);

  for (const [nodeId, depth] of ancestors) {
    if (nodeId !== selectedNodeId) {
      levelById.set(nodeId, -depth);
    }
  }
  for (const [nodeId, depth] of descendants) {
    if (nodeId !== selectedNodeId) {
      levelById.set(nodeId, depth);
    }
  }
  for (const [nodeId, depth] of upstream) {
    if (
      depth > 0 &&
      !memberIds.has(nodeId) &&
      !levelById.has(nodeId)
    ) {
      levelById.set(nodeId, -depth);
    }
  }
  const memberDepth = maximumDepth(descendants.values());
  for (const [nodeId, depth] of downstream) {
    if (
      depth > 0 &&
      !memberIds.has(nodeId) &&
      !levelById.has(nodeId)
    ) {
      levelById.set(nodeId, memberDepth + depth);
    }
  }

  return {
    nodeIds: [...levelById]
      .sort(
        ([leftId, leftLevel], [rightId, rightLevel]) =>
          Number(rightId === selectedNodeId) -
            Number(leftId === selectedNodeId) ||
          Math.abs(leftLevel) - Math.abs(rightLevel) ||
          leftLevel - rightLevel ||
          leftId.localeCompare(rightId)
      )
      .map(([nodeId]) => nodeId),
    levelById
  };
}

function collectDirectionalContext(
  selectedNodeId: string | null,
  adjacency: DirectionalEdges,
  fallbackIds: string[],
  depthLimit: number
): {
  nodeIds: string[];
  levelById: Map<string, number>;
} {
  if (!selectedNodeId) {
    const nodeIds = fallbackIds.slice(
      0,
      Math.min(48, MAX_GRAPH_NODES)
    );
    return {
      nodeIds,
      levelById: new Map(nodeIds.map((id) => [id, 0]))
    };
  }

  const upstream = traverseDirection(
    selectedNodeId,
    adjacency.incoming,
    (edge) => edge.from,
    depthLimit
  );
  const downstream = traverseDirection(
    selectedNodeId,
    adjacency.outgoing,
    (edge) => edge.to,
    depthLimit
  );
  const levelById = new Map<string, number>([
    [selectedNodeId, 0]
  ]);

  for (const [nodeId, depth] of upstream) {
    if (nodeId !== selectedNodeId) {
      levelById.set(nodeId, -depth);
    }
  }
  for (const [nodeId, depth] of downstream) {
    if (nodeId === selectedNodeId) {
      continue;
    }
    const current = levelById.get(nodeId);
    if (
      current === undefined ||
      depth < Math.abs(current)
    ) {
      levelById.set(nodeId, depth);
    }
  }

  const nodeIds = [selectedNodeId];
  const maxDepth = Math.max(
    maximumDepth(upstream.values()),
    maximumDepth(downstream.values())
  );
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const upstreamIds = [...levelById]
      .filter(([, level]) => level === -depth)
      .map(([nodeId]) => nodeId)
      .sort();
    const downstreamIds = [...levelById]
      .filter(([, level]) => level === depth)
      .map(([nodeId]) => nodeId)
      .sort();
    for (
      let index = 0;
      index <
      Math.max(upstreamIds.length, downstreamIds.length);
      index += 1
    ) {
      const upstreamId = upstreamIds[index];
      const downstreamId = downstreamIds[index];
      if (upstreamId) {
        nodeIds.push(upstreamId);
      }
      if (downstreamId) {
        nodeIds.push(downstreamId);
      }
    }
  }

  return {
    nodeIds: unique(nodeIds),
    levelById
  };
}

function maximumDepth(depths: Iterable<number>): number {
  let maximum = 0;
  for (const depth of depths) {
    maximum = Math.max(maximum, depth);
  }
  return maximum;
}

function traverseDirection(
  rootId: string,
  adjacency: Map<string, CodeGraphEdgeDto[]>,
  targetFor: (edge: CodeGraphEdgeDto) => string,
  depthLimit: number
): Map<string, number> {
  return traverseDirections(
    [rootId],
    adjacency,
    targetFor,
    depthLimit
  );
}

function traverseDirections(
  rootIds: string[],
  adjacency: Map<string, CodeGraphEdgeDto[]>,
  targetFor: (edge: CodeGraphEdgeDto) => string,
  depthLimit: number
): Map<string, number> {
  const depths = new Map<string, number>(
    rootIds.map((rootId) => [rootId, 0])
  );
  let frontier = [...rootIds];
  for (
    let depth = 1;
    depth <= depthLimit && frontier.length > 0;
    depth += 1
  ) {
    const next: string[] = [];
    for (const source of frontier) {
      for (const edge of adjacency.get(source) ?? []) {
        const target = targetFor(edge);
        if (depths.has(target)) {
          continue;
        }
        depths.set(target, depth);
        next.push(target);
      }
    }
    frontier = next;
  }
  return depths;
}

function edgeAdjacency(
  edges: CodeGraphEdgeDto[],
  endpoint: "from" | "to"
): Map<string, CodeGraphEdgeDto[]> {
  const adjacency = new Map<string, CodeGraphEdgeDto[]>();
  for (const edge of edges) {
    const nodeId = edge[endpoint];
    const group = adjacency.get(nodeId) ?? [];
    group.push(edge);
    adjacency.set(nodeId, group);
  }
  return adjacency;
}

function isRelationContainer(node: CodeGraphNodeDto): boolean {
  return (
    node.kind === "module" ||
    node.kind === "package" ||
    node.kind === "class" ||
    node.kind === "interface" ||
    node.kind === "enum"
  );
}

function isCodeRelation(
  edge: CodeGraphEdgeDto,
  nodeById: ReadonlyMap<string, CodeGraphNodeDto>
): boolean {
  if (edge.kind === "contains") {
    const owner = nodeById.get(edge.from);
    return (
      owner !== undefined &&
      owner.kind !== "file" &&
      nodeById.has(edge.to)
    );
  }
  return (
    edge.kind === "calls" ||
    edge.kind === "extends" ||
    edge.kind === "implements" ||
    edge.kind === "overrides" ||
    edge.kind === "http-request" ||
    edge.kind === "rpc-request" ||
    edge.kind === "references"
  );
}

function edgePath(
  from: Position,
  to: Position
): {
  d: string;
  labelX: number;
  labelY: number;
} {
  if (Math.abs(to.x - from.x) < NODE_WIDTH / 2) {
    const downward = to.y >= from.y;
    const startX = from.x + NODE_WIDTH / 2;
    const startY = from.y + (downward ? NODE_HEIGHT : 0);
    const endX = to.x + NODE_WIDTH / 2;
    const endY = to.y + (downward ? 0 : NODE_HEIGHT);
    const bend = downward ? 42 : -42;
    return {
      d: `M ${startX} ${startY} C ${startX + bend} ${
        startY + bend
      }, ${endX + bend} ${endY - bend}, ${endX} ${endY}`,
      labelX: (startX + endX) / 2 + bend,
      labelY: (startY + endY) / 2 - 6
    };
  }

  const forward = to.x > from.x;
  const startX = from.x + (forward ? NODE_WIDTH : 0);
  const startY = from.y + NODE_HEIGHT / 2;
  const endX = to.x + (forward ? 0 : NODE_WIDTH);
  const endY = to.y + NODE_HEIGHT / 2;
  const curve =
    Math.max(36, Math.abs(endX - startX) * 0.45) *
    (forward ? 1 : -1);
  return {
    d: `M ${startX} ${startY} C ${startX + curve} ${startY}, ${
      endX - curve
    } ${endY}, ${endX} ${endY}`,
    labelX: (startX + endX) / 2,
    labelY: (startY + endY) / 2 - 6
  };
}

function panForPosition(
  graph: Pick<RelationGraphLayout, "width" | "height">,
  position: Position,
  zoom: number
): Position {
  return {
    x:
      -(
        position.x +
        NODE_WIDTH / 2 -
        graph.width / 2
      ) * zoom,
    y:
      -(
        position.y +
        NODE_HEIGHT / 2 -
        graph.height / 2
      ) * zoom
  };
}

function clampZoom(value: number): number {
  return Number(
    clamp(value, MIN_ZOOM, MAX_ZOOM).toFixed(3)
  );
}

function normalizeWheelDelta(
  event: WheelEvent,
  container: HTMLElement
): number {
  const multiplier =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? Math.max(container.clientHeight, 1)
        : 1;
  return event.deltaY * multiplier;
}

function clamp(
  value: number,
  minimum: number,
  maximum: number
): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function nodeKindLabel(node: CodeGraphNodeDto): string {
  return {
    file: "文件",
    module: "模块",
    package: "包",
    class: "类",
    interface: "接口",
    enum: "枚举",
    property: "属性",
    function: "函数",
    method: "方法",
    "client-request": "前端请求",
    "server-endpoint": "后端接口",
    "rpc-client": "RPC 客户端",
    "rpc-handler": "RPC 处理器"
  }[node.kind];
}

function nodeDocumentation(
  node: Pick<CodeGraphNodeDto, "metadata">
): string | null {
  const value = node.metadata.documentation;
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}
