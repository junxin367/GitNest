import {
  describe,
  expect,
  it
} from "vitest";

import { buildCodeGraph } from "./graph-builder";
import type {
  AnalysisSourceFile,
  CodeAnalysisLanguage
} from "./model";
import { parseSourceFile } from "./source-parser";

describe("buildCodeGraph request chains", () => {
  it("keeps overloaded Java methods as distinct graph nodes and call sources", () => {
    const parsed = parseSourceFile(
      sourceFile("Overloaded.java", "java"),
      [
        "class Overloaded {",
        "  void run(int value) {",
        "    one();",
        "  }",
        "  void run(String value) {",
        "    two();",
        "  }",
        "  void one() {}",
        "  void two() {}",
        "}"
      ].join("\n")
    );

    const graph = buildCodeGraph({
      files: [parsed],
      scope: "workspace",
      graphDepth: 3
    });
    const runNodes = graph.nodes
      .filter(
        (node) =>
          node.name === "run" &&
          node.location.path === "Overloaded.java"
      )
      .sort(
        (left, right) =>
          left.location.line - right.location.line
      );
    const one = graph.nodes.find(
      (node) => node.name === "one"
    );
    const two = graph.nodes.find(
      (node) => node.name === "two"
    );

    expect(runNodes).toHaveLength(2);
    expect(
      graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.from === runNodes[0]?.id &&
          edge.to === one?.id
      )
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.from === runNodes[1]?.id &&
          edge.to === two?.id
      )
    ).toBe(true);
  });

  it("resolves ambiguous Java references to the unique symbol in the source package", () => {
    const first = parseSourceFile(
      sourceFile("a/Flags.java", "java"),
      [
        "package example.a;",
        "class Flags {",
        "  static int ENABLED = 1;",
        "}"
      ].join("\n")
    );
    const second = parseSourceFile(
      sourceFile("b/Flags.java", "java"),
      [
        "package example.b;",
        "class Flags {",
        "  static int ENABLED = 2;",
        "}"
      ].join("\n")
    );
    const caller = parseSourceFile(
      sourceFile("a/Caller.java", "java"),
      [
        "package example.a;",
        "class Caller {",
        "  int read() { return Flags.ENABLED; }",
        "}"
      ].join("\n")
    );

    const graph = buildCodeGraph({
      files: [first, second, caller],
      scope: "workspace",
      graphDepth: 3
    });
    const source = graph.nodes.find(
      (node) =>
        node.name === "read" &&
        node.location.path === "a/Caller.java"
    );
    const target = graph.nodes.find(
      (node) =>
        node.name === "ENABLED" &&
        node.location.path === "a/Flags.java"
    );

    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: source?.id,
        to: target?.id,
        kind: "references"
      })
    );
  });

  it("emits exact inheritance and override edges from LSP semantic relations", () => {
    const base = parseSourceFile(
      sourceFile("Base.java", "java"),
      [
        "class Base {",
        "  void execute() {}",
        "}"
      ].join("\n")
    );
    const child = parseSourceFile(
      sourceFile("Child.java", "java"),
      [
        "class Child extends Base {",
        "  void execute() {}",
        "}"
      ].join("\n")
    );
    const baseClass = base.symbols.find(
      (symbol) => symbol.name === "Base"
    );
    const baseMethod = base.symbols.find(
      (symbol) => symbol.name === "execute"
    );
    const childClass = child.symbols.find(
      (symbol) => symbol.name === "Child"
    );
    const childMethod = child.symbols.find(
      (symbol) => symbol.name === "execute"
    );
    childClass!.semanticRelations = [
      {
        kind: "extends",
        targetName: "Base",
        targetCanonicalPath: base.file.canonicalPath,
        targetLine: baseClass!.line,
        source: "lsp",
        evidence: "LSP Type Hierarchy supertypes"
      }
    ];
    childMethod!.semanticRelations = [
      {
        kind: "overrides",
        targetName: "execute",
        targetCanonicalPath: base.file.canonicalPath,
        targetLine: baseMethod!.line,
        source: "lsp",
        evidence: "LSP textDocument/implementation"
      }
    ];

    const graph = buildCodeGraph({
      files: [base, child],
      scope: "workspace",
      graphDepth: 3
    });
    const baseClassNode = graph.nodes.find(
      (node) =>
        node.name === "Base" &&
        node.kind === "class"
    );
    const baseMethodNode = graph.nodes.find(
      (node) =>
        node.name === "execute" &&
        node.location.path === "Base.java"
    );
    const childClassNode = graph.nodes.find(
      (node) =>
        node.name === "Child" &&
        node.kind === "class"
    );
    const childMethodNode = graph.nodes.find(
      (node) =>
        node.name === "execute" &&
        node.location.path === "Child.java"
    );

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: childClassNode?.id,
          to: baseClassNode?.id,
          kind: "extends",
          confidence: "exact"
        }),
        expect.objectContaining({
          from: childMethodNode?.id,
          to: baseMethodNode?.id,
          kind: "overrides",
          confidence: "exact"
        })
      ])
    );
  });

  it("connects built-in qualified Java constant usages to nested field symbols", () => {
    const definition = parseSourceFile(
      sourceFile("ScProfDef.java", "java"),
      [
        "public class ScProfDef {",
        "  public static final class Flag {",
        "    public static final int OPEN_GUIDE = 1;",
        "  }",
        "}"
      ].join("\n")
    );
    const caller = parseSourceFile(
      sourceFile("ScProfServiceImpl.java", "java"),
      [
        "public class ScProfServiceImpl {",
        "  public boolean enabled(int flag) {",
        "    return Misc.checkBit(flag, ScProfDef.Flag.OPEN_GUIDE);",
        "  }",
        "}"
      ].join("\n")
    );

    const graph = buildCodeGraph({
      files: [definition, caller],
      scope: "workspace",
      graphDepth: 6
    });
    const source = graph.nodes.find(
      (node) =>
        node.name === "enabled" &&
        node.location.path === "ScProfServiceImpl.java"
    );
    const target = graph.nodes.find(
      (node) =>
        node.qualifiedName ===
        "ScProfDef.Flag.OPEN_GUIDE"
    );

    expect(source).toBeDefined();
    expect(target).toBeDefined();
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: source?.id,
        to: target?.id,
        kind: "references",
        confidence: "probable",
        source: "builtin"
      })
    );
  });

  it("does not map a missing field reference to a nearby class node", () => {
    const definition = parseSourceFile(
      sourceFile("ScProfDef.java", "java"),
      [
        "public class ScProfDef {",
        "  public static final int OPEN_GUIDE = 1;",
        "}"
      ].join("\n")
    );
    const caller = parseSourceFile(
      sourceFile("ScProfServiceImpl.java", "java"),
      [
        "public class ScProfServiceImpl {",
        "  public boolean enabled() {",
        "    return ScProfDef.OPEN_GUIDE == 1;",
        "  }",
        "}"
      ].join("\n")
    );
    const callerMethod = caller.symbols.find(
      (symbol) => symbol.name === "enabled"
    );
    expect(callerMethod).toBeDefined();
    callerMethod!.references = [
      {
        name: "MISSING_FLAG",
        line: 3,
        targetCanonicalPath:
          definition.file.canonicalPath,
        targetLine: 2,
        source: "lsp",
        evidence: "LSP textDocument/references"
      }
    ];

    const graph = buildCodeGraph({
      files: [definition, caller],
      scope: "workspace",
      graphDepth: 3
    });

    expect(
      graph.edges.some(
        (edge) => edge.kind === "references"
      )
    ).toBe(false);
  });

  it("includes frontend callers before the request and backend callees after the endpoint", () => {
    const frontend = parseSourceFile(
      sourceFile("client.ts", "typescript"),
      [
        "import { GET } from '@/api/request';",
        "",
        "export function renderUser() {",
        "  return loadUser('42');",
        "}",
        "",
        "/** Loads a user from the API. */",
        "export const loadUser = (id: string) =>",
        "  GET(`/api/users/${id}`);"
      ].join("\n")
    );
    const controller = parseSourceFile(
      sourceFile("UserController.java", "java"),
      [
        "@RestController",
        '@RequestMapping("/api")',
        "public class UserController {",
        "  /** Returns the requested user. */",
        '  @GetMapping("/users/{id}")',
        "  public User getUser() {",
        "    return userService.findUser();",
        "  }",
        "}"
      ].join("\n")
    );
    const service = parseSourceFile(
      sourceFile("UserService.java", "java"),
      [
        "public class UserService {",
        "  public User findUser() {",
        "    return repository.find();",
        "  }",
        "}"
      ].join("\n")
    );

    const graph = buildCodeGraph({
      files: [frontend, controller, service],
      scope: "workspace",
      graphDepth: 6
    });

    expect(graph.requestChains).toHaveLength(1);
    const chain = graph.requestChains[0];
    expect(chain).toBeDefined();
    const chainNodes = graph.nodes.filter((node) =>
      chain?.nodeIds.includes(node.id)
    );
    expect(
      chainNodes.map((node) => `${node.kind}:${node.name}`)
    ).toEqual(
      expect.arrayContaining([
        "function:renderUser",
        "function:loadUser",
        "client-request:GET /api/users/:param",
        "server-endpoint:getUser",
        "method:findUser"
      ])
    );
    expect(
      chainNodes.find((node) => node.kind === "client-request")
        ?.metadata.documentation
    ).toBe("Loads a user from the API.");
    expect(
      chainNodes.find((node) => node.kind === "server-endpoint")
        ?.metadata.documentation
    ).toBe("Returns the requested user.");

    const chainEdges = graph.edges.filter((edge) =>
      chain?.edgeIds.includes(edge.id)
    );
    const nodeById = new Map(
      graph.nodes.map((node) => [node.id, node])
    );
    expect(
      chainEdges.map(
        (edge) =>
          `${nodeById.get(edge.from)?.name}->${nodeById.get(
            edge.to
          )?.name}:${edge.kind}`
      )
    ).toEqual(
      expect.arrayContaining([
        "renderUser->loadUser:calls",
        "loadUser->GET /api/users/:param:calls",
        "GET /api/users/:param->getUser:http-request",
        "getUser->findUser:calls"
      ])
    );
  });

  it("prefers request-local documentation and falls back to the wrapper documentation", () => {
    const frontend = parseSourceFile(
      sourceFile("hooks.tsx", "typescript"),
      [
        "import { GET } from '@/api/request';",
        "",
        "/** Loads user data for the page. */",
        "export const loadUser = useCallback(async () => {",
        "  // Fetches the primary user record.",
        "  await GET('/api/users/primary');",
        "  return GET('/api/users/fallback');",
        "}, []);"
      ].join("\n")
    );

    const graph = buildCodeGraph({
      files: [frontend],
      scope: "workspace",
      graphDepth: 3
    });
    const primaryRequest = graph.nodes.find(
      (node) =>
        node.kind === "client-request" &&
        node.name === "GET /api/users/primary"
    );
    const fallbackRequest = graph.nodes.find(
      (node) =>
        node.kind === "client-request" &&
        node.name === "GET /api/users/fallback"
    );
    const wrapper = graph.nodes.find(
      (node) =>
        node.kind === "function" &&
        node.name === "loadUser"
    );

    expect(primaryRequest?.metadata.documentation).toBe(
      "Fetches the primary user record."
    );
    expect(fallbackRequest?.metadata.documentation).toBe(
      "Loads user data for the page."
    );
    expect(
      graph.edges.some(
        (edge) =>
          edge.from === wrapper?.id &&
          edge.to === primaryRequest?.id &&
          edge.kind === "calls"
      )
    ).toBe(true);
  });

  it("connects typed Vue callers through TypeScript requests to same-named Java service methods", () => {
    const view = parseSourceFile(
      sourceFile("MaterialRecognitionPanel.vue", "vue"),
      [
        "async function loadRecognitionList(): Promise<void> {",
        "  await getRecognitionList();",
        "}"
      ].join("\n")
    );
    const client = parseSourceFile(
      sourceFile("api/Material/index.ts", "typescript"),
      [
        "import { GET } from '@/api/request';",
        "",
        "export async function getRecognitionList(",
        "): Promise<RequestResult<string[]>> {",
        "  return GET('/api/resource/getRecognitionList');",
        "}"
      ].join("\n")
    );
    const controller = parseSourceFile(
      sourceFile("ScResController.java", "java"),
      [
        "@RestController",
        '@RequestMapping("/api/resource")',
        "public class ScResController {",
        '  @GetMapping("/getRecognitionList")',
        "  public Object getRecognitionList() {",
        "    return scResService.getRecognitionList();",
        "  }",
        "}"
      ].join("\n")
    );
    const service = parseSourceFile(
      sourceFile("ScResService.java", "java"),
      [
        "public class ScResService {",
        "  public Object getRecognitionList() {",
        "    return repository.findAll();",
        "  }",
        "}"
      ].join("\n")
    );

    const graph = buildCodeGraph({
      files: [view, client, controller, service],
      scope: "workspace",
      graphDepth: 8
    });

    expect(graph.requestChains).toHaveLength(1);
    const chain = graph.requestChains[0];
    expect(chain).toBeDefined();
    const chainNodes = graph.nodes.filter((node) =>
      chain?.nodeIds.includes(node.id)
    );
    expect(
      chainNodes.map(
        (node) =>
          `${node.location.path}:${node.kind}:${node.name}`
      )
    ).toEqual(
      expect.arrayContaining([
        "MaterialRecognitionPanel.vue:function:loadRecognitionList",
        "api/Material/index.ts:function:getRecognitionList",
        "api/Material/index.ts:client-request:GET /api/resource/getRecognitionList",
        "ScResController.java:server-endpoint:getRecognitionList",
        "ScResService.java:method:getRecognitionList"
      ])
    );

    const controllerNode = graph.nodes.find(
      (node) =>
        node.location.path === "ScResController.java" &&
        node.name === "getRecognitionList"
    );
    const serviceNode = graph.nodes.find(
      (node) =>
        node.location.path === "ScResService.java" &&
        node.name === "getRecognitionList"
    );
    expect(controllerNode).toBeDefined();
    expect(serviceNode).toBeDefined();
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: controllerNode?.id,
        to: serviceNode?.id,
        kind: "calls"
      })
    );
    expect(
      graph.edges.some(
        (edge) =>
          edge.kind === "calls" && edge.from === edge.to
      )
    ).toBe(false);
  });

  it("preserves complete HTTP chains when noisy LSP symbols exhaust the node budget", () => {
    const noisyView = parseSourceFile(
      sourceFile("aaa/NoisyTemplate.vue", "vue"),
      "<template><div /></template>"
    );
    noisyView.symbols.push(
      ...Array.from({ length: 50 }, (_, index) => ({
        name: `templateProperty${index}`,
        qualifiedName: `templateProperty${index}`,
        kind: "property" as const,
        line: index + 1,
        endLine: index + 1,
        calls: [],
        source: "lsp" as const
      }))
    );
    const view = parseSourceFile(
      sourceFile("MaterialRecognitionPanel.vue", "vue"),
      [
        "async function loadRecognitionList(): Promise<void> {",
        "  await getRecognitionList();",
        "}"
      ].join("\n")
    );
    const client = parseSourceFile(
      sourceFile("api/Material/index.ts", "typescript"),
      [
        "import { GET } from '@/api/request';",
        "export async function getRecognitionList() {",
        "  return GET('/api/resource/getRecognitionList');",
        "}"
      ].join("\n")
    );
    const controller = parseSourceFile(
      sourceFile("zzz/ScResController.java", "java"),
      [
        "@RestController",
        '@RequestMapping("/resource")',
        "public class ScResController {",
        '  @GetMapping("/getRecognitionList")',
        "  public Object getRecognitionList() {",
        "    return scResService.getRecognitionList();",
        "  }",
        "}"
      ].join("\n")
    );
    const service = parseSourceFile(
      sourceFile("zzz/ScResService.java", "java"),
      [
        "public class ScResService {",
        "  public Object getRecognitionList() {",
        "    return repository.findAll();",
        "  }",
        "}"
      ].join("\n")
    );

    const graph = buildCodeGraph({
      files: [
        noisyView,
        view,
        client,
        controller,
        service
      ],
      scope: "workspace",
      graphDepth: 8,
      limits: {
        maxNodes: 12,
        maxEdges: 100,
        maxRequestChains: 10
      }
    });

    expect(graph.truncated).toBe(true);
    expect(graph.nodes).toHaveLength(12);
    expect(
      graph.nodes.filter(
        (node) =>
          node.kind === "property" && node.source === "lsp"
      )
    ).toHaveLength(2);
    expect(graph.requestChains).toHaveLength(1);

    const chain = graph.requestChains[0];
    const chainNodes = graph.nodes.filter((node) =>
      chain?.nodeIds.includes(node.id)
    );
    expect(
      chainNodes.map(
        (node) =>
          `${node.location.path}:${node.kind}:${node.name}`
      )
    ).toEqual(
      expect.arrayContaining([
        "MaterialRecognitionPanel.vue:function:loadRecognitionList",
        "api/Material/index.ts:function:getRecognitionList",
        "api/Material/index.ts:client-request:GET /api/resource/getRecognitionList",
        "zzz/ScResController.java:server-endpoint:getRecognitionList",
        "zzz/ScResService.java:method:getRecognitionList"
      ])
    );
  });

  it("does not connect collection receiver calls to unrelated same-file methods", () => {
    const service = parseSourceFile(
      sourceFile("ScResServiceImpl.java", "java"),
      [
        "public class ScResServiceImpl {",
        "  public int add(Object entity) {",
        "    return repository.add(entity);",
        "  }",
        "",
        "  public Object getRecognitionList() {",
        "    FaiList<Object> resultList = new FaiList<>();",
        "    resultList.add(initRecognitionListItem());",
        "    return resultList;",
        "  }",
        "",
        "  public int addCurrent() {",
        "    return this.add(new Object());",
        "  }",
        "",
        "  private Object initRecognitionListItem() {",
        "    return new Object();",
        "  }",
        "}"
      ].join("\n")
    );

    const graph = buildCodeGraph({
      files: [service],
      scope: "workspace",
      graphDepth: 6
    });
    const caller = graph.nodes.find(
      (node) => node.name === "getRecognitionList"
    );
    const unrelatedAdd = graph.nodes.find(
      (node) => node.name === "add"
    );
    const itemFactory = graph.nodes.find(
      (node) => node.name === "initRecognitionListItem"
    );
    const explicitSelfCaller = graph.nodes.find(
      (node) => node.name === "addCurrent"
    );

    expect(caller).toBeDefined();
    expect(unrelatedAdd).toBeDefined();
    expect(itemFactory).toBeDefined();
    expect(explicitSelfCaller).toBeDefined();
    expect(graph.edges).not.toContainEqual(
      expect.objectContaining({
        from: caller?.id,
        to: unrelatedAdd?.id,
        kind: "calls"
      })
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: caller?.id,
        to: itemFactory?.id,
        kind: "calls"
      })
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: explicitSelfCaller?.id,
        to: unrelatedAdd?.id,
        kind: "calls"
      })
    );
  });

  it("matches receiver names to implementation owners without using bare-name fallback", () => {
    const controller = parseSourceFile(
      sourceFile("ScResController.java", "java"),
      [
        "public class ScResController {",
        "  public Object getRecognitionList() {",
        "    return scResService.getRecognitionList();",
        "  }",
        "}"
      ].join("\n")
    );
    const service = parseSourceFile(
      sourceFile("ScResServiceImpl.java", "java"),
      [
        "public class ScResServiceImpl {",
        "  public Object getRecognitionList() {",
        "    return repository.findAll();",
        "  }",
        "}"
      ].join("\n")
    );

    const graph = buildCodeGraph({
      files: [controller, service],
      scope: "workspace",
      graphDepth: 6
    });
    const caller = graph.nodes.find(
      (node) =>
        node.location.path === "ScResController.java" &&
        node.name === "getRecognitionList"
    );
    const implementation = graph.nodes.find(
      (node) =>
        node.location.path === "ScResServiceImpl.java" &&
        node.name === "getRecognitionList"
    );

    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: caller?.id,
        to: implementation?.id,
        kind: "calls",
        confidence: "probable"
      })
    );
  });

  it("prefers a receiver implementation from the caller's source module", () => {
    const handler = parseSourceFile(
      sourceFile(
        "svr/ScResSvr/src/main/java/fai/svr/ScResSvr/proc/ScResProc.java",
        "java"
      ),
      [
        "public class ScResProc {",
        "  private ScResService scResService;",
        "",
        "  public Object getResList() {",
        "    return scResService.getList();",
        "  }",
        "}"
      ].join("\n")
    );
    const serverService = parseSourceFile(
      sourceFile(
        "svr/ScResSvr/src/main/java/fai/svr/ScResSvr/service/impl/ScResServiceImpl.java",
        "java"
      ),
      [
        "public class ScResServiceImpl {",
        "  public Object getList() {",
        "    return null;",
        "  }",
        "}"
      ].join("\n")
    );
    const webService = parseSourceFile(
      sourceFile(
        "web/scportal/src/main/java/fai/webscportal/service/impl/ScResServiceImpl.java",
        "java"
      ),
      [
        "public class ScResServiceImpl {",
        "  public Object getList() {",
        "    return null;",
        "  }",
        "}"
      ].join("\n")
    );

    const graph = buildCodeGraph({
      files: [handler, serverService, webService],
      scope: "workspace",
      graphDepth: 6
    });
    const caller = graph.nodes.find(
      (node) =>
        node.location.path.endsWith("ScResProc.java") &&
        node.name === "getResList"
    );
    const serverTarget = graph.nodes.find(
      (node) =>
        node.location.path.startsWith("svr/ScResSvr/") &&
        node.name === "getList"
    );
    const webTarget = graph.nodes.find(
      (node) =>
        node.location.path.startsWith("web/scportal/") &&
        node.name === "getList"
    );

    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: caller?.id,
        to: serverTarget?.id,
        kind: "calls",
        confidence: "probable"
      })
    );
    expect(graph.edges).not.toContainEqual(
      expect.objectContaining({
        from: caller?.id,
        to: webTarget?.id,
        kind: "calls"
      })
    );
  });

  it("does not replace an unresolved LSP target with an unrelated local method", () => {
    const service = parseSourceFile(
      sourceFile("ScResServiceImpl.java", "java"),
      [
        "public class ScResServiceImpl {",
        "  public int add(Object entity) {",
        "    return 1;",
        "  }",
        "",
        "  public Object getRecognitionList() {",
        "    resultList.add(new Object());",
        "    return resultList;",
        "  }",
        "}"
      ].join("\n")
    );
    const caller = service.symbols.find(
      (symbol) => symbol.name === "getRecognitionList"
    );
    const collectionCall = caller?.calls.find(
      (call) => call.name === "add"
    );
    expect(collectionCall).toBeDefined();
    if (collectionCall) {
      collectionCall.targetCanonicalPath =
        "c:\\external\\FaiList.java";
      collectionCall.targetLine = 42;
    }

    const graph = buildCodeGraph({
      files: [service],
      scope: "workspace",
      graphDepth: 6
    });
    const callerNode = graph.nodes.find(
      (node) => node.name === "getRecognitionList"
    );
    const unrelatedAdd = graph.nodes.find(
      (node) => node.name === "add"
    );

    expect(graph.edges).not.toContainEqual(
      expect.objectContaining({
        from: callerNode?.id,
        to: unrelatedAdd?.id,
        kind: "calls"
      })
    );
  });

  it("continues HTTP request chains across RPC clients to server handlers", () => {
    const frontend = parseSourceFile(
      sourceFile("resource.ts", "typescript"),
      [
        "import { GET } from '@/api/request';",
        "",
        "export function loadResources() {",
        "  return GET('/api/resources');",
        "}"
      ].join("\n")
    );
    const controller = parseSourceFile(
      sourceFile("ResourceController.java", "java"),
      [
        "@RestController",
        '@RequestMapping("/api")',
        "public class ResourceController {",
        "  private ResourceFacade resourceFacade;",
        "",
        '  @GetMapping("/resources")',
        "  public Object listResources() {",
        "    return resourceFacade.loadResources();",
        "  }",
        "}"
      ].join("\n")
    );
    const facade = parseSourceFile(
      sourceFile("ResourceFacade.java", "java"),
      [
        "public class ResourceFacade {",
        "  private ResourcePort resourcePort;",
        "",
        "  public Object loadResources() {",
        "    return resourcePort.listResources();",
        "  }",
        "}"
      ].join("\n")
    );
    const client = parseSourceFile(
      sourceFile("ResourcePort.java", "java"),
      [
        "package example.client;",
        "import example.protocol.ResourceDef;",
        "public interface ResourcePort {",
        "  @GeneratedOutbound(ResourceDef.Protocol.Cmd.LIST)",
        "  Object listResources();",
        "}"
      ].join("\n")
    );
    const handler = parseSourceFile(
      sourceFile("ResourceProcessor.java", "java"),
      [
        "package example.server;",
        "import example.protocol.ResourceDef;",
        "public class ResourceProcessor {",
        "  private ResourceService resourceService;",
        "",
        "  @InboundDispatch(ResourceDef.Protocol.Cmd.LIST)",
        "  public Object listResources() {",
        "    return resourceService.findAll();",
        "  }",
        "}"
      ].join("\n")
    );
    const service = parseSourceFile(
      sourceFile("ResourceService.java", "java"),
      [
        "public class ResourceService {",
        "  public Object findAll() {",
        "    return repository.findAll();",
        "  }",
        "}"
      ].join("\n")
    );

    const graph = buildCodeGraph({
      files: [
        frontend,
        controller,
        facade,
        client,
        handler,
        service
      ],
      scope: "workspace",
      graphDepth: 6
    });

    const httpChain = graph.requestChains.find(
      (chain) => chain.profileId === "web-http"
    );
    const rpcChain = graph.requestChains.find(
      (chain) => chain.profileId === "fai-cli-rpc"
    );
    expect(httpChain).toBeDefined();
    expect(rpcChain).toBeDefined();

    const nodeById = new Map(
      graph.nodes.map((node) => [node.id, node])
    );
    const httpChainNodes = graph.nodes.filter((node) =>
      httpChain?.nodeIds.includes(node.id)
    );
    expect(
      httpChainNodes.map(
        (node) => `${node.kind}:${node.name}`
      )
    ).toEqual(
      expect.arrayContaining([
        "client-request:GET /api/resources",
        "server-endpoint:listResources",
        "rpc-client:listResources",
        "rpc-handler:listResources",
        "method:findAll"
      ])
    );

    const httpChainEdges = graph.edges.filter((edge) =>
      httpChain?.edgeIds.includes(edge.id)
    );
    expect(
      httpChainEdges.map(
        (edge) =>
          `${nodeById.get(edge.from)?.kind}:${
            nodeById.get(edge.from)?.name
          }->${nodeById.get(edge.to)?.kind}:${
            nodeById.get(edge.to)?.name
          }:${edge.kind}`
      )
    ).toEqual(
      expect.arrayContaining([
        "rpc-client:listResources->rpc-handler:listResources:rpc-request",
        "rpc-handler:listResources->method:findAll:calls"
      ])
    );
  });

  it("links fai-cli-rpc boundaries through a shared protocol constant while preserving wrapper calls", () => {
    const caller = parseSourceFile(
      sourceFile("ResourceFacade.java", "java"),
      [
        "public class ResourceFacade {",
        "  private ResourcePort cli;",
        "",
        "  public Object create() {",
        "    return cli.addResource();",
        "  }",
        "}"
      ].join("\n")
    );
    const client = parseSourceFile(
      sourceFile("ResourcePort.java", "java"),
      [
        "package example.client;",
        "import example.protocol.ResourceDef;",
        "public interface ResourcePort {",
        "  @GeneratedOutbound(ResourceDef.Protocol.Cmd.ADD)",
        "  Object addResource();",
        "}"
      ].join("\n")
    );
    const handler = parseSourceFile(
      sourceFile("ResourceProcessor.java", "java"),
      [
        "package example.server;",
        "import example.protocol.ResourceDef;",
        "public class ResourceProcessor {",
        "  @InboundDispatch(ResourceDef.Protocol.Cmd.ADD)",
        "  public Object save() {",
        "    return resourceService.persist();",
        "  }",
        "}"
      ].join("\n")
    );
    const service = parseSourceFile(
      sourceFile("ResourceService.java", "java"),
      [
        "public class ResourceService {",
        "  public Object persist() {",
        "    return repository.insert();",
        "  }",
        "}"
      ].join("\n")
    );
    const unrelated = parseSourceFile(
      sourceFile("OtherProcessor.java", "java"),
      [
        "package example.server;",
        "import example.protocol.OtherDef;",
        "public class OtherProcessor {",
        "  @AnotherDispatch(OtherDef.Protocol.Cmd.ADD)",
        "  public Object saveOther() {",
        "    return null;",
        "  }",
        "}"
      ].join("\n")
    );

    const graph = buildCodeGraph({
      files: [caller, client, handler, service, unrelated],
      scope: "workspace",
      graphDepth: 6
    });

    expect(graph.requestChains).toHaveLength(1);
    expect(
      caller.symbols
        .find((symbol) => symbol.name === "create")
        ?.calls.find((call) => call.name === "addResource")
    ).toMatchObject({
      receiver: "cli",
      receiverType: "ResourcePort"
    });
    const chain = graph.requestChains[0];
    expect(chain).toMatchObject({
      profileId: "fai-cli-rpc",
      transport: "rpc",
      operationKey:
        "example.protocol.ResourceDef.Protocol.Cmd.ADD",
      method: "RPC",
      route: "ResourceDef.Protocol.Cmd.ADD",
      ambiguous: false,
      confidence: "probable"
    });
    const chainNodes = graph.nodes.filter((node) =>
      chain?.nodeIds.includes(node.id)
    );
    expect(
      chainNodes.map((node) => `${node.kind}:${node.name}`)
    ).toEqual(
      expect.arrayContaining([
        "method:create",
        "rpc-client:addResource",
        "rpc-handler:save",
        "method:persist"
      ])
    );
    const nodeById = new Map(
      graph.nodes.map((node) => [node.id, node])
    );
    const chainEdges = graph.edges.filter((edge) =>
      chain?.edgeIds.includes(edge.id)
    );
    expect(
      chainEdges.map(
        (edge) =>
          `${nodeById.get(edge.from)?.name}->${nodeById.get(
            edge.to
          )?.name}:${edge.kind}`
      )
    ).toEqual(
      expect.arrayContaining([
        "create->addResource:calls",
        "addResource->save:rpc-request",
        "save->persist:calls"
      ])
    );
  });

  it("marks duplicate handlers for one RPC operation as ambiguous", () => {
    const client = parseSourceFile(
      sourceFile("SharedPort.java", "java"),
      [
        "package example.client;",
        "import example.protocol.SharedDef;",
        "public interface SharedPort {",
        "  @Outbound(SharedDef.Protocol.Cmd.GET)",
        "  Object load();",
        "}"
      ].join("\n")
    );
    const firstHandler = parseSourceFile(
      sourceFile("FirstHandler.java", "java"),
      [
        "package example.server;",
        "import example.protocol.SharedDef;",
        "public class FirstHandler {",
        "  @Inbound(SharedDef.Protocol.Cmd.GET)",
        "  public Object first() { return null; }",
        "}"
      ].join("\n")
    );
    const secondHandler = parseSourceFile(
      sourceFile("SecondHandler.java", "java"),
      [
        "package example.server;",
        "import example.protocol.SharedDef;",
        "public class SecondHandler {",
        "  @Inbound(SharedDef.Protocol.Cmd.GET)",
        "  public Object second() { return null; }",
        "}"
      ].join("\n")
    );

    const graph = buildCodeGraph({
      files: [client, firstHandler, secondHandler],
      scope: "workspace",
      graphDepth: 3
    });

    expect(graph.requestChains).toHaveLength(2);
    expect(
      graph.requestChains.every((chain) => chain.ambiguous)
    ).toBe(true);
  });

  it("keeps overloaded RPC clients as distinct request chains with unique ids", () => {
    const client = parseSourceFile(
      sourceFile("ResourcePort.java", "java"),
      [
        "package example.client;",
        "import example.protocol.ResourceDef;",
        "public interface ResourcePort {",
        "  @GeneratedOutbound(ResourceDef.Protocol.Cmd.GET)",
        "  Object getResource(int id);",
        "  @GeneratedOutbound(ResourceDef.Protocol.Cmd.GET)",
        "  Object getResource(int id, boolean create);",
        "}"
      ].join("\n")
    );
    const handler = parseSourceFile(
      sourceFile("ResourceProcessor.java", "java"),
      [
        "package example.server;",
        "import example.protocol.ResourceDef;",
        "public class ResourceProcessor {",
        "  @InboundDispatch(ResourceDef.Protocol.Cmd.GET)",
        "  public Object getResource() { return null; }",
        "}"
      ].join("\n")
    );

    const graph = buildCodeGraph({
      files: [client, handler],
      scope: "workspace",
      graphDepth: 3
    });

    expect(graph.requestChains).toHaveLength(2);
    expect(
      new Set(graph.requestChains.map((chain) => chain.id)).size
    ).toBe(2);
    expect(
      new Set(
        graph.requestChains.map(
          (chain) => chain.clientNodeId
        )
      ).size
    ).toBe(2);
    expect(
      graph.nodes
        .filter(
          (node) =>
            node.kind === "rpc-client" &&
            node.name === "getResource"
        )
        .map((node) => node.location.line)
        .sort((left, right) => left - right)
    ).toEqual([4, 6]);
  });

  it.each([
    {
      clientRoute: "/resource/items",
      controllerPrefix: "/api",
      endpointRoute: "/resource/items"
    },
    {
      clientRoute: "/api/resource/items",
      controllerPrefix: "",
      endpointRoute: "/resource/items"
    }
  ])(
    "indexes heuristic route suffixes in either direction",
    ({ clientRoute, controllerPrefix, endpointRoute }) => {
      const frontend = parseSourceFile(
        sourceFile("client.ts", "typescript"),
        [
          "import { GET } from '@/api/request';",
          `export const load = () => GET('${clientRoute}');`
        ].join("\n")
      );
      const controller = parseSourceFile(
        sourceFile("Controller.java", "java"),
        [
          "@RestController",
          ...(controllerPrefix
            ? [`@RequestMapping("${controllerPrefix}")`]
            : []),
          "public class Controller {",
          `  @GetMapping("${endpointRoute}")`,
          "  public Object list() { return service.list(); }",
          "}"
        ].join("\n")
      );

      const graph = buildCodeGraph({
        files: [frontend, controller],
        scope: "workspace",
        graphDepth: 3
      });

      expect(graph.requestChains).toHaveLength(1);
      expect(graph.requestChains[0]?.confidence).toBe(
        "heuristic"
      );
    }
  );

  it("keeps a typed response getter separate from an unrelated same-named getter", () => {
    const utility = parseSourceFile(
      sourceFile(
        "core/fai-cli-sc/src/ScProfClitUtil.java",
        "java"
      ),
      [
        "class ScProfClitUtil {",
        "  static int getDuration() {",
        "    RemoteStandResult result = cli.getDuration();",
        "    return result.getRt();",
        "  }",
        "}"
      ].join("\n")
    );
    const unrelated = parseSourceFile(
      sourceFile(
        "svr/ScCutSvr/src/ScDigitalHumanBatchQuery.java",
        "java"
      ),
      [
        "class ScDigitalHumanBatchQuery {",
        "  static final class Result {",
        "    int getRt() { return 0; }",
        "  }",
        "  int check(Result result) { return result.getRt(); }",
        "}"
      ].join("\n")
    );
    const graph = buildCodeGraph({
      files: [utility, unrelated],
      scope: "workspace",
      graphDepth: 5
    });
    const duration = graph.nodes.find(
      (node) => node.name === "getDuration"
    );
    const check = graph.nodes.find(
      (node) => node.name === "check"
    );
    const getter = graph.nodes.find(
      (node) => node.name === "getRt"
    );

    expect(graph.edges).not.toContainEqual(
      expect.objectContaining({
        from: duration?.id,
        to: getter?.id,
        kind: "calls"
      })
    );
    expect(graph.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "unresolved-call",
        nodeId: duration?.id,
        message:
          "未找到 RemoteStandResult.getRt 的兼容目标"
      })
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: check?.id,
        to: getter?.id,
        kind: "calls"
      })
    );
  });

  it("continues an HTTP chain through a no-arg factory into a tag RPC", () => {
    const frontend = parseSourceFile(
      sourceFile("web/scportal-web/src/material.ts", "typescript"),
      [
        "import { GET } from '@/api/request';",
        "export function getRecognitionList() {",
        "  return GET('/api/resource/getRecognitionList');",
        "}"
      ].join("\n")
    );
    const controller = parseSourceFile(
      sourceFile("web/scportal/src/ScResController.java", "java"),
      [
        '@RequestMapping("/resource")',
        "class ScResController {",
        "  private ScResService scResService;",
        '  @GetMapping("/getRecognitionList")',
        "  Object getRecognitionList() {",
        "    return scResService.getRecognitionList();",
        "  }",
        "}"
      ].join("\n")
    );
    const service = parseSourceFile(
      sourceFile("web/scportal/src/ScResServiceImpl.java", "java"),
      [
        "class ScResServiceImpl {",
        "  Object getRecognitionList() {",
        "    return ScResTagCliUtil.getVideoTagList();",
        "  }",
        "}"
      ].join("\n")
    );
    const utility = parseSourceFile(
      sourceFile("core/fai-cli-sc/src/ScResTagCliUtil.java", "java"),
      [
        "class ScResTagCliUtil {",
        "  private static ScResTagCli getScResTagCli() {",
        "    return null;",
        "  }",
        "  static int getVideoTagList() {",
        "    return getScResTagCli().getResTagList(1);",
        "  }",
        "}"
      ].join("\n")
    );
    const client = parseSourceFile(
      sourceFile("core/fai-cli-sc/src/ScResTagCli.java", "java"),
      [
        "package example.client;",
        "import example.protocol.ScResTagDef;",
        "interface ScResTagCli {",
        "  @Cmd(ScResTagDef.Protocol.Cmd.GET_RES_TAG_LIST)",
        "  int getResTagList(int aid);",
        "}"
      ].join("\n")
    );
    const handler = parseSourceFile(
      sourceFile("svr/ScResTagSvr/src/ScResTagProc.java", "java"),
      [
        "package example.server;",
        "import example.protocol.ScResTagDef;",
        "class ScResTagProc {",
        "  @HdCmd(ScResTagDef.Protocol.Cmd.GET_RES_TAG_LIST)",
        "  int getResTagList(int aid) { return 0; }",
        "}"
      ].join("\n")
    );
    const graph = buildCodeGraph({
      files: [
        frontend,
        controller,
        service,
        utility,
        client,
        handler
      ],
      scope: "workspace",
      graphDepth: 8
    });
    const utilityNode = graph.nodes.find(
      (node) => node.name === "getVideoTagList"
    );
    const rpcClient = graph.nodes.find(
      (node) => node.kind === "rpc-client" &&
        node.name === "getResTagList"
    );
    const rpcHandler = graph.nodes.find(
      (node) => node.kind === "rpc-handler" &&
        node.name === "getResTagList"
    );
    const httpChain = graph.requestChains.find(
      (chain) => chain.profileId === "web-http"
    );

    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: utilityNode?.id,
        to: rpcClient?.id,
        kind: "calls"
      })
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: rpcClient?.id,
        to: rpcHandler?.id,
        kind: "rpc-request"
      })
    );
    expect(httpChain?.nodeIds).toContain(rpcHandler?.id);
  });

  it("reports meaningful broken links without flagging ordinary library calls", () => {
    const frontend = parseSourceFile(
      sourceFile("client.ts", "typescript"),
      [
        "import { GET } from '@/api/request';",
        "export function loadMissing() {",
        "  console.log('loading');",
        "  return GET('/api/missing');",
        "}"
      ].join("\n")
    );

    const graph = buildCodeGraph({
      files: [frontend],
      scope: "workspace",
      graphDepth: 3
    });

    expect(graph.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "unmatched-request",
        severity: "warning",
        message: "未找到 GET /api/missing 的服务端端点",
        evidence: expect.stringContaining(
          "完整索引中没有"
        )
      })
    );
    expect(
      graph.diagnostics.some(
        (diagnostic) =>
          diagnostic.kind === "unresolved-call" &&
          diagnostic.message.includes("console")
      )
    ).toBe(false);
  });

  it("stops building when a graph budget is exhausted", () => {
    const parsed = parseSourceFile(
      sourceFile("large.ts", "typescript"),
      [
        "export function first() { return 1; }",
        "export function second() { return first(); }"
      ].join("\n")
    );

    const graph = buildCodeGraph({
      files: [parsed],
      scope: "workspace",
      graphDepth: 3,
      limits: {
        maxNodes: 1,
        maxEdges: 1,
        maxRequestChains: 1
      }
    });

    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
    expect(graph.requestChains).toHaveLength(0);
    expect(graph.truncated).toBe(true);
  });
});

function sourceFile(
  relativePath: string,
  language: CodeAnalysisLanguage
): AnalysisSourceFile {
  return {
    absolutePath: `C:\\workspace\\${relativePath}`,
    canonicalPath: `c:\\workspace\\${relativePath.toLocaleLowerCase(
      "en-US"
    )}`,
    relativePath,
    repositoryId: "repository",
    worktreeId: "worktree",
    rootPath: "C:\\workspace",
    language,
    size: 1_024,
    modifiedAtMs: 1,
    fingerprint: relativePath,
    changed: false
  };
}
