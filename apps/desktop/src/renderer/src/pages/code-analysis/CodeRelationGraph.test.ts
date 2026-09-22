/** @vitest-environment jsdom */

import React, {
  act,
  createElement
} from "react";
import {
  createRoot,
  type Root
} from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import type {
  CodeAnalysisSnapshotDto,
  CodeGraphEdgeDto,
  CodeGraphNodeDto
} from "@gitnest/contracts";

import {
  buildRelationGraphLayout,
  CodeRelationGraph
} from "./CodeRelationGraph";

describe("buildRelationGraphLayout", () => {
  it("places callers left, callees right, and ignores file containment edges", () => {
    const snapshot = createSnapshot(
      [
        node("file", "file", "file"),
        node("a", "callerA"),
        node("d", "callerD"),
        node("b", "focus"),
        node("c", "callee"),
        node("sibling", "sibling")
      ],
      [
        edge("contains-a", "file", "a", "contains"),
        edge("contains-b", "file", "b", "contains"),
        edge(
          "contains-sibling",
          "file",
          "sibling",
          "contains"
        ),
        edge("a-b", "a", "b", "calls"),
        edge("d-b", "d", "b", "calls"),
        edge("b-c", "b", "c", "calls")
      ]
    );

    const layout = buildRelationGraphLayout(
      snapshot,
      null,
      "b"
    );
    expect(
      layout.nodes.map((positioned) => positioned.node.id).sort()
    ).toEqual(["a", "b", "c", "d"]);
    expect(layout.positionById.get("a")?.x).toBeLessThan(
      layout.positionById.get("b")?.x ?? 0
    );
    expect(layout.positionById.get("d")?.x).toBeLessThan(
      layout.positionById.get("b")?.x ?? 0
    );
    expect(layout.positionById.get("c")?.x).toBeGreaterThan(
      layout.positionById.get("b")?.x ?? 0
    );
  });

  it("shows a nested type between its owner and member properties", () => {
    const outerClass = {
      ...node("outer", "ScProfDef", "class"),
      qualifiedName: "ScProfDef",
      language: "java" as const
    };
    const nestedClass = {
      ...node("flag", "Flag", "class"),
      qualifiedName: "ScProfDef.Flag",
      language: "java" as const
    };
    const property = {
      ...node("open-guide", "OPEN_GUIDE", "property"),
      qualifiedName: "ScProfDef.Flag.OPEN_GUIDE",
      language: "java" as const
    };
    const caller = {
      ...node("caller", "enabled", "method"),
      qualifiedName: "ScProfServiceImpl.enabled",
      language: "java" as const
    };
    const snapshot = createSnapshot(
      [outerClass, nestedClass, property, caller],
      [
        edge("outer-flag", "outer", "flag", "contains"),
        edge(
          "flag-open-guide",
          "flag",
          "open-guide",
          "contains"
        ),
        edge(
          "caller-open-guide",
          "caller",
          "open-guide",
          "references"
        )
      ]
    );

    const layout = buildRelationGraphLayout(
      snapshot,
      null,
      "flag"
    );

    expect(
      layout.nodes.map(({ node: graphNode }) => graphNode.id)
    ).toEqual(
      expect.arrayContaining([
        "outer",
        "flag",
        "open-guide",
        "caller"
      ])
    );
    expect(layout.positionById.get("outer")?.x).toBeLessThan(
      layout.positionById.get("flag")?.x ?? 0
    );
    expect(
      layout.positionById.get("open-guide")?.x
    ).toBeGreaterThan(
      layout.positionById.get("flag")?.x ?? 0
    );
    expect(layout.positionById.get("caller")?.x).toBeLessThan(
      layout.positionById.get("flag")?.x ?? 0
    );
    expect(layout.edges.map((graphEdge) => graphEdge.id)).toEqual(
      expect.arrayContaining([
        "outer-flag",
        "flag-open-guide",
        "caller-open-guide"
      ])
    );
  });

  it("places symbols that reference a focused property upstream", () => {
    const snapshot = createSnapshot(
      [
        node("caller", "ScProfServiceImpl.enabled", "method"),
        node("constant", "OPEN_GUIDE", "property")
      ],
      [
        edge(
          "caller-constant",
          "caller",
          "constant",
          "references"
        )
      ]
    );

    const layout = buildRelationGraphLayout(
      snapshot,
      null,
      "constant"
    );

    expect(
      layout.nodes.map(({ node: graphNode }) => graphNode.id)
    ).toEqual(expect.arrayContaining(["caller", "constant"]));
    expect(
      layout.positionById.get("caller")?.x
    ).toBeLessThan(
      layout.positionById.get("constant")?.x ?? 0
    );
  });

  it("deduplicates cyclic call neighborhoods", () => {
    const snapshot = createSnapshot(
      [node("a", "a"), node("b", "b")],
      [
        edge("a-b", "a", "b", "calls"),
        edge("b-a", "b", "a", "calls")
      ]
    );

    const layout = buildRelationGraphLayout(
      snapshot,
      null,
      "a"
    );
    expect(layout.nodes).toHaveLength(2);
    expect(new Set(layout.nodes.map(({ node }) => node.id))).toEqual(
      new Set(["a", "b"])
    );
  });

  it("keeps a branch's only successor on the same horizontal row", () => {
    const snapshot = createSnapshot(
      [
        node("root", "root"),
        node("alpha", "alpha"),
        node("branch", "middleBranch"),
        node("omega", "omega"),
        node("next", "next")
      ],
      [
        edge("root-alpha", "root", "alpha", "calls"),
        edge("root-branch", "root", "branch", "calls"),
        edge("root-omega", "root", "omega", "calls"),
        edge("branch-next", "branch", "next", "calls")
      ]
    );

    const layout = buildRelationGraphLayout(
      snapshot,
      null,
      "root"
    );

    expect(layout.positionById.get("branch")?.y).toBe(
      layout.positionById.get("next")?.y
    );
  });

  it("keeps a branch's only predecessor on the same horizontal row", () => {
    const snapshot = createSnapshot(
      [
        node("focus", "focus"),
        node("alpha", "alpha"),
        node("branch", "middleBranch"),
        node("omega", "omega"),
        node("previous", "previous")
      ],
      [
        edge("alpha-focus", "alpha", "focus", "calls"),
        edge("branch-focus", "branch", "focus", "calls"),
        edge("omega-focus", "omega", "focus", "calls"),
        edge("previous-branch", "previous", "branch", "calls")
      ]
    );

    const layout = buildRelationGraphLayout(
      snapshot,
      null,
      "focus"
    );

    expect(layout.positionById.get("previous")?.y).toBe(
      layout.positionById.get("branch")?.y
    );
  });

  it("keeps sibling nodes on distinct rows", () => {
    const snapshot = createSnapshot(
      [
        node("root", "root"),
        node("alpha", "alpha"),
        node("beta", "beta"),
        node("gamma", "gamma")
      ],
      [
        edge("root-alpha", "root", "alpha", "calls"),
        edge("root-beta", "root", "beta", "calls"),
        edge("root-gamma", "root", "gamma", "calls")
      ]
    );

    const layout = buildRelationGraphLayout(
      snapshot,
      null,
      "root"
    );
    const siblingRows = ["alpha", "beta", "gamma"].map(
      (id) => layout.positionById.get(id)?.y
    );

    expect(new Set(siblingRows).size).toBe(siblingRows.length);
  });

  it("places the deepest downstream branch above shallower branches", () => {
    const snapshot = createSnapshot(
      [
        node("root", "root"),
        node("shallow", "alphaShallow"),
        node("deep", "zetaDeep"),
        node("deep-next", "deepNext"),
        node("deep-leaf", "deepLeaf")
      ],
      [
        edge("root-shallow", "root", "shallow", "calls"),
        edge("root-deep", "root", "deep", "calls"),
        edge("deep-next", "deep", "deep-next", "calls"),
        edge(
          "deep-next-leaf",
          "deep-next",
          "deep-leaf",
          "calls"
        )
      ]
    );

    const layout = buildRelationGraphLayout(
      snapshot,
      null,
      "root"
    );

    expect(layout.positionById.get("deep")?.y).toBeLessThan(
      layout.positionById.get("shallow")?.y ?? 0
    );
    expect(layout.positionById.get("deep-next")?.y).toBe(
      layout.positionById.get("deep")?.y
    );
    expect(layout.positionById.get("deep-leaf")?.y).toBe(
      layout.positionById.get("deep")?.y
    );
  });

  it("places the deepest upstream branch above shallower branches", () => {
    const snapshot = createSnapshot(
      [
        node("focus", "focus"),
        node("shallow", "alphaShallow"),
        node("deep", "zetaDeep"),
        node("deep-previous", "deepPrevious"),
        node("deep-root", "deepRoot")
      ],
      [
        edge("shallow-focus", "shallow", "focus", "calls"),
        edge("deep-focus", "deep", "focus", "calls"),
        edge(
          "deep-previous",
          "deep-previous",
          "deep",
          "calls"
        ),
        edge(
          "deep-root",
          "deep-root",
          "deep-previous",
          "calls"
        )
      ]
    );

    const layout = buildRelationGraphLayout(
      snapshot,
      null,
      "focus"
    );

    expect(layout.positionById.get("deep")?.y).toBeLessThan(
      layout.positionById.get("shallow")?.y ?? 0
    );
    expect(layout.positionById.get("deep-previous")?.y).toBe(
      layout.positionById.get("deep")?.y
    );
    expect(layout.positionById.get("deep-root")?.y).toBe(
      layout.positionById.get("deep")?.y
    );
  });
});

describe("CodeRelationGraph interactions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    Object.defineProperties(Element.prototype, {
      setPointerCapture: {
        configurable: true,
        value: vi.fn()
      },
      hasPointerCapture: {
        configurable: true,
        value: () => true
      },
      releasePointerCapture: {
        configurable: true,
        value: vi.fn()
      }
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("wraps complete node paths inside a compact graph node", () => {
    const longName =
      "UserService.findByIdWithPermissionsAndAuditTrail";
    const longPath =
      "services/user/src/main/java/com/gitnest/user/service/UserService.java";
    const longNode: CodeGraphNodeDto = {
      ...node("service", longName, "method"),
      qualifiedName: `com.gitnest.user.${longName}`,
      location: {
        repositoryId: "repository",
        worktreeId: "worktree",
        path: longPath,
        line: 44,
        column: 1
      },
      metadata: {
        documentation:
          "Loads a user and records the audit trail."
      }
    };
    act(() => {
      root.render(
        createElement(CodeRelationGraph, {
          snapshot: createSnapshot([longNode], []),
          chain: null,
          focusNodeId: longNode.id,
          selectedNodeId: longNode.id,
          onSelectNode: vi.fn(),
          onClearSelection: vi.fn()
        })
      );
    });

    const graphNode = container.querySelector(
      ".analysis-graph-node"
    );
    const copy = graphNode?.querySelector(
      ".analysis-node-copy"
    );
    expect(copy?.getAttribute("x")).toBe("8");
    expect(copy?.getAttribute("y")).toBe("24");
    expect(copy?.getAttribute("width")).toBe("168");
    expect(copy?.getAttribute("height")).toBe("58");
    expect(
      graphNode?.querySelector(".analysis-node-name")
        ?.textContent
    ).toBe(longName);
    expect(
      graphNode?.querySelector(".analysis-node-path")
        ?.textContent
    ).toBe(`${longPath}:44`);
    expect(
      graphNode?.querySelector(
        ".analysis-node-documentation-summary"
      )?.textContent
    ).toBe("Loads a user and records the audit trail.");
    expect(
      graphNode?.querySelector("rect")?.getAttribute("height")
    ).toBe("88");
    expect(
      graphNode?.querySelector("circle")?.getAttribute("cx")
    ).toBe("12");
    expect(
      graphNode
        ?.querySelector(".analysis-node-kind")
        ?.getAttribute("x")
    ).toBe("22");
    expect(graphNode?.querySelector("title")?.textContent).toContain(
      `${longPath}:44`
    );
    expect(graphNode?.querySelector("title")?.textContent).toContain(
      "Loads a user and records the audit trail."
    );
  });

  it("renders qualified names for nested classes and properties", () => {
    const nestedClass = {
      ...node("flag", "Flag", "class"),
      qualifiedName: "ScProfDef.Flag",
      language: "java" as const
    };
    const property = {
      ...node("open-guide", "OPEN_GUIDE", "property"),
      qualifiedName: "ScProfDef.Flag.OPEN_GUIDE",
      language: "java" as const
    };
    act(() => {
      root.render(
        createElement(CodeRelationGraph, {
          snapshot: createSnapshot(
            [nestedClass, property],
            [
              edge(
                "flag-open-guide",
                "flag",
                "open-guide",
                "contains"
              )
            ]
          ),
          chain: null,
          focusNodeId: nestedClass.id,
          selectedNodeId: nestedClass.id,
          onSelectNode: vi.fn(),
          onClearSelection: vi.fn()
        })
      );
    });

    expect(
      container.querySelector(
        '[aria-label="class ScProfDef.Flag"] .analysis-node-name'
      )?.textContent
    ).toBe("ScProfDef.Flag");
    expect(
      container.querySelector(
        '[aria-label="property ScProfDef.Flag.OPEN_GUIDE"] .analysis-node-name'
      )?.textContent
    ).toBe("ScProfDef.Flag.OPEN_GUIDE");
    expect(
      container.querySelector(".edge-contains")
    ).not.toBeNull();
  });

  it("renders RPC request edges and RPC node labels", () => {
    const rpcClient = node(
      "rpc-client",
      "ScResCli.getResource",
      "rpc-client"
    );
    const rpcHandler = node(
      "rpc-handler",
      "ScResProc.getResource",
      "rpc-handler"
    );
    const rpcEdge = edge(
      "rpc-request",
      rpcClient.id,
      rpcHandler.id,
      "rpc-request"
    );
    const snapshot = createSnapshot(
      [rpcClient, rpcHandler],
      [rpcEdge]
    );
    const chain = {
      id: "rpc-chain",
      profileId: "fai-cli-rpc",
      transport: "rpc" as const,
      operationKey: "ScResDef.Protocol.GET_RESOURCE",
      method: "RPC",
      route: "ScResDef.Protocol.GET_RESOURCE",
      title: "RPC ScResDef.Protocol.GET_RESOURCE",
      clientNodeId: rpcClient.id,
      endpointNodeId: rpcHandler.id,
      nodeIds: [rpcClient.id, rpcHandler.id],
      edgeIds: [rpcEdge.id],
      changed: false,
      ambiguous: false,
      confidence: "exact" as const
    };

    act(() => {
      root.render(
        createElement(CodeRelationGraph, {
          snapshot,
          chain,
          focusNodeId: rpcClient.id,
          selectedNodeId: rpcClient.id,
          onSelectNode: vi.fn(),
          onClearSelection: vi.fn()
        })
      );
    });

    expect(
      container.querySelector(".edge-rpc-request")
    ).not.toBeNull();
    expect(
      container.querySelector(".edge-label-rpc-request")
        ?.textContent
    ).toBe("RPC");
    expect(container.textContent).toContain("RPC 客户端");
    expect(container.textContent).toContain("RPC 处理器");
  });

  it("renders reference edges with a distinct label", () => {
    const snapshot = createSnapshot(
      [
        node("caller", "ScProfServiceImpl.enabled", "method"),
        node("constant", "OPEN_GUIDE", "property")
      ],
      [
        edge(
          "caller-constant",
          "caller",
          "constant",
          "references"
        )
      ]
    );

    act(() => {
      root.render(
        createElement(CodeRelationGraph, {
          snapshot,
          chain: null,
          focusNodeId: "constant",
          selectedNodeId: "constant",
          onSelectNode: vi.fn(),
          onClearSelection: vi.fn()
        })
      );
    });

    expect(
      container.querySelector(".edge-references")
    ).not.toBeNull();
    expect(
      container.querySelector(".edge-label-references")
        ?.textContent
    ).toBe("引用");
  });

  it("renders inheritance, implementation, and override edges with distinct labels", () => {
    const cases = [
      ["extends", "继承"],
      ["implements", "实现"],
      ["overrides", "重写"]
    ] as const;

    for (const [kind, label] of cases) {
      const snapshot = createSnapshot(
        [node("source", "Child"), node("target", "Base")],
        [
          edge(
            `source-target-${kind}`,
            "source",
            "target",
            kind
          )
        ]
      );

      act(() => {
        root.render(
          createElement(CodeRelationGraph, {
            snapshot,
            chain: null,
            focusNodeId: "source",
            selectedNodeId: "source",
            onSelectNode: vi.fn(),
            onClearSelection: vi.fn()
          })
        );
      });

      expect(
        container.querySelector(`.edge-${kind}`)
      ).not.toBeNull();
      expect(
        container.querySelector(`.edge-label-${kind}`)
          ?.textContent
      ).toBe(label);
    }
  });

  it("pans the canvas and lets individual nodes be repositioned", () => {
    const snapshot = createSnapshot(
      [node("a", "caller"), node("b", "callee")],
      [edge("a-b", "a", "b", "calls")]
    );
    act(() => {
      root.render(
        createElement(CodeRelationGraph, {
          snapshot,
          chain: null,
          focusNodeId: "a",
          selectedNodeId: "a",
          onSelectNode: vi.fn(),
          onClearSelection: vi.fn()
        })
      );
    });

    const viewport = container.querySelector<HTMLDivElement>(
      ".analysis-graph-scroll"
    );
    const canvas = container.querySelector<HTMLDivElement>(
      ".analysis-graph-canvas"
    );
    expect(viewport).not.toBeNull();
    expect(canvas).not.toBeNull();
    const initialPanX = Number.parseFloat(
      canvas?.style.marginLeft || "0"
    );
    const initialPanY = Number.parseFloat(
      canvas?.style.marginTop || "0"
    );
    act(() => {
      dispatchPointer(viewport as Element, "pointerdown", {
        pointerId: 1,
        clientX: 100,
        clientY: 100
      });
      dispatchPointer(viewport as Element, "pointermove", {
        pointerId: 1,
        clientX: 60,
        clientY: 70
      });
      dispatchPointer(viewport as Element, "pointerup", {
        pointerId: 1,
        clientX: 60,
        clientY: 70
      });
    });
    expect(
      Number.parseFloat(canvas?.style.marginLeft || "0")
    ).toBe(
      initialPanX - 40
    );
    expect(
      Number.parseFloat(canvas?.style.marginTop || "0")
    ).toBe(initialPanY - 30);

    const svg = container.querySelector("svg");
    Object.defineProperty(svg, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 800,
        bottom: 500,
        width: 800,
        height: 500,
        toJSON: () => ({})
      })
    });
    const caller = container.querySelector<SVGGElement>(
      '[aria-label="function caller"]'
    );
    const before = caller?.getAttribute("transform");
    act(() => {
      dispatchPointer(caller as Element, "pointerdown", {
        pointerId: 2,
        clientX: 100,
        clientY: 100
      });
      dispatchPointer(caller as Element, "pointermove", {
        pointerId: 2,
        clientX: 180,
        clientY: 150
      });
      dispatchPointer(caller as Element, "pointerup", {
        pointerId: 2,
        clientX: 180,
        clientY: 150
      });
    });
    expect(caller?.getAttribute("transform")).not.toBe(before);
  });

  it("lets nodes move beyond every original canvas edge without shifting the canvas", () => {
    const snapshot = createSnapshot(
      [node("a", "caller"), node("b", "callee")],
      [edge("a-b", "a", "b", "calls")]
    );
    act(() => {
      root.render(
        createElement(CodeRelationGraph, {
          snapshot,
          chain: null,
          focusNodeId: "a",
          selectedNodeId: "a",
          onSelectNode: vi.fn(),
          onClearSelection: vi.fn()
        })
      );
    });

    const svg = container.querySelector<SVGSVGElement>(
      ".analysis-graph-svg"
    );
    const caller = container.querySelector<SVGGElement>(
      '[aria-label="function caller"]'
    );
    const callee = container.querySelector<SVGGElement>(
      '[aria-label="function callee"]'
    );
    expect(svg).not.toBeNull();
    expect(caller).not.toBeNull();
    expect(callee).not.toBeNull();
    const canvas = container.querySelector<HTMLDivElement>(
      ".analysis-graph-canvas"
    );
    const initialViewBox = parseViewBox(
      svg?.getAttribute("viewBox")
    );
    const initialCanvasPosition = {
      x: canvas?.style.marginLeft,
      y: canvas?.style.marginTop
    };
    Object.defineProperty(svg, "getBoundingClientRect", {
      configurable: true,
      value: () => {
        const width = Number(svg?.getAttribute("width") ?? 0);
        const height = Number(
          svg?.getAttribute("height") ?? 0
        );
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: width,
          bottom: height,
          width,
          height,
          toJSON: () => ({})
        };
      }
    });

    act(() => {
      dispatchPointer(caller as Element, "pointerdown", {
        pointerId: 7,
        clientX: 300,
        clientY: 300
      });
      dispatchPointer(caller as Element, "pointermove", {
        pointerId: 7,
        clientX: -100,
        clientY: -100
      });
      dispatchPointer(caller as Element, "pointerup", {
        pointerId: 7,
        clientX: -100,
        clientY: -100
      });
    });

    const callerPosition = parseTranslate(
      caller?.getAttribute("transform")
    );
    expect(callerPosition.x).toBeLessThan(initialViewBox.x);
    expect(callerPosition.y).toBeLessThan(initialViewBox.y);

    act(() => {
      dispatchPointer(callee as Element, "pointerdown", {
        pointerId: 8,
        clientX: 300,
        clientY: 300
      });
      dispatchPointer(callee as Element, "pointermove", {
        pointerId: 8,
        clientX: 900,
        clientY: 900
      });
      dispatchPointer(callee as Element, "pointerup", {
        pointerId: 8,
        clientX: 900,
        clientY: 900
      });
    });

    const calleePosition = parseTranslate(
      callee?.getAttribute("transform")
    );
    expect(calleePosition.x).toBeGreaterThan(
      initialViewBox.x + initialViewBox.width
    );
    expect(calleePosition.y).toBeGreaterThan(
      initialViewBox.y + initialViewBox.height
    );
    expect(parseViewBox(svg?.getAttribute("viewBox"))).toEqual(
      initialViewBox
    );
    expect(svg?.getAttribute("overflow")).toBe("visible");
    expect(canvas?.style.marginLeft).toBe(
      initialCanvasPosition.x
    );
    expect(canvas?.style.marginTop).toBe(
      initialCanvasPosition.y
    );
  });

  it("zooms continuously around the pointer with the mouse wheel", () => {
    const snapshot = createSnapshot(
      [node("a", "caller"), node("b", "callee")],
      [edge("a-b", "a", "b", "calls")]
    );
    act(() => {
      root.render(
        createElement(CodeRelationGraph, {
          snapshot,
          chain: null,
          focusNodeId: "a",
          selectedNodeId: "a",
          onSelectNode: vi.fn(),
          onClearSelection: vi.fn()
        })
      );
    });

    const scroller = container.querySelector<HTMLDivElement>(
      ".analysis-graph-scroll"
    );
    const svg =
      container.querySelector<SVGSVGElement>(
        ".analysis-graph-svg"
      );
    expect(scroller).not.toBeNull();
    expect(svg).not.toBeNull();
    Object.defineProperty(
      scroller,
      "getBoundingClientRect",
      {
        configurable: true,
        value: () => ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 800,
          bottom: 500,
          width: 800,
          height: 500,
          toJSON: () => ({})
        })
      }
    );
    Object.defineProperty(svg, "getBoundingClientRect", {
      configurable: true,
      value: () => {
        const width = Number(svg?.getAttribute("width") ?? 0);
        const height = Number(
          svg?.getAttribute("height") ?? 0
        );
        return {
          x: 100,
          y: 100,
          top: 100,
          left: 100,
          right: 100 + width,
          bottom: 100 + height,
          width,
          height,
          toJSON: () => ({})
        };
      }
    });
    const initialWidth = Number(
      svg?.getAttribute("width") ?? 0
    );

    act(() => {
      scroller?.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: 240,
          clientY: 180,
          deltaY: -120
        })
      );
    });

    expect(
      Number(svg?.getAttribute("width") ?? 0)
    ).toBeGreaterThan(initialWidth);
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="调整关系图缩放"]'
      )?.value
    ).toBe("120");
  });

  it("keeps pan, zoom, and node positions when only the selected node changes", () => {
    const snapshot = createSnapshot(
      [node("a", "caller"), node("b", "callee")],
      [edge("a-b", "a", "b", "calls")]
    );
    const onSelectNode = vi.fn();
    const onClearSelection = vi.fn();
    const renderGraph = (selectedNodeId: string) =>
      createElement(CodeRelationGraph, {
        snapshot,
        chain: null,
        focusNodeId: "a",
        selectedNodeId,
        onSelectNode,
        onClearSelection
      });
    act(() => root.render(renderGraph("a")));

    const viewport = container.querySelector<HTMLDivElement>(
      ".analysis-graph-scroll"
    );
    const canvas = container.querySelector<HTMLDivElement>(
      ".analysis-graph-canvas"
    );
    const svg =
      container.querySelector<SVGSVGElement>(
        ".analysis-graph-svg"
      );
    Object.defineProperty(
      viewport,
      "getBoundingClientRect",
      {
        configurable: true,
        value: () => ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 800,
          bottom: 500,
          width: 800,
          height: 500,
          toJSON: () => ({})
        })
      }
    );
    Object.defineProperty(svg, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 800,
        bottom: 500,
        width: 800,
        height: 500,
        toJSON: () => ({})
      })
    });

    const caller = container.querySelector<SVGGElement>(
      '[aria-label="function caller"]'
    );
    act(() => {
      dispatchPointer(viewport as Element, "pointerdown", {
        pointerId: 3,
        clientX: 100,
        clientY: 100
      });
      dispatchPointer(viewport as Element, "pointermove", {
        pointerId: 3,
        clientX: 150,
        clientY: 165
      });
      dispatchPointer(viewport as Element, "pointerup", {
        pointerId: 3,
        clientX: 150,
        clientY: 165
      });
      viewport?.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: 240,
          clientY: 180,
          deltaY: -120
        })
      );
      dispatchPointer(caller as Element, "pointerdown", {
        pointerId: 4,
        clientX: 100,
        clientY: 100
      });
      dispatchPointer(caller as Element, "pointermove", {
        pointerId: 4,
        clientX: 140,
        clientY: 130
      });
      dispatchPointer(caller as Element, "pointerup", {
        pointerId: 4,
        clientX: 140,
        clientY: 130
      });
    });

    const viewBefore = {
      panX: canvas?.style.marginLeft,
      panY: canvas?.style.marginTop,
      width: svg?.getAttribute("width"),
      caller: caller?.getAttribute("transform")
    };
    act(() => root.render(renderGraph("b")));

    expect(canvas?.style.marginLeft).toBe(viewBefore.panX);
    expect(canvas?.style.marginTop).toBe(viewBefore.panY);
    expect(svg?.getAttribute("width")).toBe(viewBefore.width);
    expect(caller?.getAttribute("transform")).toBe(
      viewBefore.caller
    );
  });

  it("clears selection on a blank click but not after dragging the canvas", () => {
    const snapshot = createSnapshot(
      [node("a", "caller"), node("b", "callee")],
      [edge("a-b", "a", "b", "calls")]
    );
    const onClearSelection = vi.fn();
    act(() => {
      root.render(
        createElement(CodeRelationGraph, {
          snapshot,
          chain: null,
          focusNodeId: "a",
          selectedNodeId: "a",
          onSelectNode: vi.fn(),
          onClearSelection
        })
      );
    });
    const viewport = container.querySelector<HTMLDivElement>(
      ".analysis-graph-scroll"
    );

    act(() => {
      dispatchPointer(viewport as Element, "pointerdown", {
        pointerId: 5,
        clientX: 100,
        clientY: 100
      });
      dispatchPointer(viewport as Element, "pointerup", {
        pointerId: 5,
        clientX: 100,
        clientY: 100
      });
    });
    expect(onClearSelection).toHaveBeenCalledOnce();

    act(() => {
      dispatchPointer(viewport as Element, "pointerdown", {
        pointerId: 6,
        clientX: 100,
        clientY: 100
      });
      dispatchPointer(viewport as Element, "pointermove", {
        pointerId: 6,
        clientX: 100,
        clientY: 140
      });
      dispatchPointer(viewport as Element, "pointerup", {
        pointerId: 6,
        clientX: 100,
        clientY: 140
      });
    });
    expect(onClearSelection).toHaveBeenCalledOnce();
  });
});

function createSnapshot(
  nodes: CodeGraphNodeDto[],
  edges: CodeGraphEdgeDto[]
): CodeAnalysisSnapshotDto {
  return {
    schemaVersion: 1,
    analysisId: "analysis",
    workspaceId: "workspace",
    scope: "workspace",
    generatedAt: "2026-09-17T00:00:00.000Z",
    roots: [],
    nodes,
    edges,
    requestChains: [],
    languageServers: [],
    warnings: [],
    stats: {
      discoveredFiles: 1,
      analyzedFiles: 1,
      cachedFiles: 0,
      skippedFiles: 0,
      symbolCount: nodes.length,
      edgeCount: edges.length,
      requestChainCount: 0,
      truncated: false,
      durationMs: 1
    }
  };
}

function node(
  id: string,
  name: string,
  kind: CodeGraphNodeDto["kind"] = "function"
): CodeGraphNodeDto {
  return {
    id,
    kind,
    name,
    qualifiedName: name,
    language: "typescript",
    location: {
      repositoryId: "repository",
      worktreeId: "worktree",
      path: `${name}.ts`,
      line: 1,
      column: 1
    },
    changed: false,
    source: "builtin",
    confidence: "exact",
    metadata: {}
  };
}

function edge(
  id: string,
  from: string,
  to: string,
  kind: CodeGraphEdgeDto["kind"]
): CodeGraphEdgeDto {
  return {
    id,
    from,
    to,
    kind,
    confidence: "exact"
  };
}

function dispatchPointer(
  target: Element,
  type: string,
  values: {
    pointerId: number;
    clientX: number;
    clientY: number;
  }
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX: values.clientX,
    clientY: values.clientY
  });
  Object.defineProperty(event, "pointerId", {
    configurable: true,
    value: values.pointerId
  });
  target.dispatchEvent(event);
}

function parseViewBox(value: string | null | undefined): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const [
    x = Number.NaN,
    y = Number.NaN,
    width = Number.NaN,
    height = Number.NaN
  ] = (value ?? "").split(/\s+/).map(Number);
  return { x, y, width, height };
}

function parseTranslate(
  value: string | null | undefined
): Position {
  const match = value?.match(
    /translate\(([-\d.]+)\s+([-\d.]+)\)/
  );
  return {
    x: Number(match?.[1]),
    y: Number(match?.[2])
  };
}

interface Position {
  x: number;
  y: number;
}
