import {
  describe,
  expect,
  it
} from "vitest";

import type { AnalysisSourceFile } from "./model";
import { parseSourceFile } from "./source-parser";

describe("parseSourceFile client requests", () => {
  it("recognizes imported request helpers, aliases, generics, and config calls", () => {
    const parsed = parseSourceFile(
      sourceFile("client.ts"),
      [
        "import request, { GET, POST_JSON as saveJson, get, postForm } from '@/api/request';",
        "import { request as nodeRequest } from 'node:http';",
        "",
        "type Result = { id: string };",
        "",
        "export const loadItems = () =>",
        "  GET<Result[]>('/api/items');",
        "",
        "export function saveItems() {",
        "  return saveJson<Result>('/api/items/save', {});",
        "}",
        "",
        "export function loadLegacy() {",
        "  return get('/api/legacy');",
        "}",
        "",
        "export function uploadLegacy() {",
        "  return postForm('/api/upload', {});",
        "}",
        "",
        "export function configured() {",
        "  return request<Result>({",
        "    url: '/api/configured',",
        "    method: 'PATCH',",
        "    data: { nested: true },",
        "  });",
        "}",
        "",
        "export function mobile() {",
        "  return uni.request({",
        "    url: '/api/mobile',",
        "    method: 'POST',",
        "  });",
        "}",
        "",
        "export function ignored(map: Map<string, string>) {",
        "  map.get('/not-a-request');",
        "  nodeRequest({ url: '/also-not-a-browser-request' });",
        "}"
      ].join("\n")
    );

    expect(
      parsed.clientRequests.map((request) => ({
        method: request.method,
        route: request.route,
        container: request.containerQualifiedName
      }))
    ).toEqual([
      {
        method: "GET",
        route: "/api/items",
        container: "loadItems"
      },
      {
        method: "POST",
        route: "/api/items/save",
        container: "saveItems"
      },
      {
        method: "GET",
        route: "/api/legacy",
        container: "loadLegacy"
      },
      {
        method: "POST",
        route: "/api/upload",
        container: "uploadLegacy"
      },
      {
        method: "PATCH",
        route: "/api/configured",
        container: "configured"
      },
      {
        method: "POST",
        route: "/api/mobile",
        container: "mobile"
      }
    ]);
    expect(
      parsed.symbols.find(
        (symbol) => symbol.name === "loadItems"
      )
    ).toMatchObject({
      kind: "function",
      qualifiedName: "loadItems"
    });
  });

  it("keeps supporting receiver and fetch request styles", () => {
    const parsed = parseSourceFile(
      sourceFile("requests.ts"),
      [
        "import apiClient from '@/api/request';",
        "import axios from 'axios';",
        "",
        "export async function load() {",
        "  await apiClient.get<Result>('/api/receiver');",
        "  await fetch('/api/fetch', { method: 'DELETE' });",
        "  return axios({ url: '/api/config', method: 'PUT' });",
        "}",
        "",
        "interface Result { id: string }"
      ].join("\n")
    );

    expect(
      parsed.clientRequests.map((request) => [
        request.method,
        request.route
      ])
    ).toEqual([
      ["GET", "/api/receiver"],
      ["DELETE", "/api/fetch"],
      ["PUT", "/api/config"]
    ]);
  });

  it("parses multiline functions with explicit return types", () => {
    const parsed = parseSourceFile(
      sourceFile("recognition.ts"),
      [
        "import { GET } from '@/api/request';",
        "",
        "export async function getRecognitionList(",
        "  params: { page: number }",
        "): Promise<RequestResult<string[]>> {",
        "  return GET('/api/resource/getRecognitionList');",
        "}",
        "",
        "async function loadRecognitionList(): Promise<void> {",
        "  await getRecognitionList({ page: 1 });",
        "}"
      ].join("\n")
    );

    expect(
      parsed.symbols.map((symbol) => symbol.name)
    ).toEqual(
      expect.arrayContaining([
        "getRecognitionList",
        "loadRecognitionList"
      ])
    );
    expect(parsed.clientRequests).toEqual([
      expect.objectContaining({
        method: "GET",
        route: "/api/resource/getRecognitionList",
        containerQualifiedName: "getRecognitionList"
      })
    ]);
  });

  it("attaches adjacent comments to every supported request style", () => {
    const parsed = parseSourceFile(
      sourceFile("documented-requests.ts"),
      [
        "import request, { GET } from '@/api/request';",
        "import apiClient from '@/api/request';",
        "",
        "export async function loadAll() {",
        "  // Loads the primary user.",
        "  await GET('/api/users/primary');",
        "  /** Creates a user record. */",
        "  await apiClient.post('/api/users', {});",
        "  // Removes the current user.",
        "  await fetch('/api/users/current', { method: 'DELETE' });",
        "  // Updates the current user.",
        "  await request({",
        "    url: '/api/users/current',",
        "    method: 'PATCH',",
        "  });",
        "  // This comment is intentionally separated.",
        "",
        "  await fetch('/api/users/detached');",
        "}"
      ].join("\n")
    );

    const documentationByRequest = new Map(
      parsed.clientRequests.map((request) => [
        `${request.method} ${request.route}`,
        request.documentation
      ])
    );
    expect(documentationByRequest).toEqual(
      new Map([
        [
          "GET /api/users/primary",
          "Loads the primary user."
        ],
        [
          "POST /api/users",
          "Creates a user record."
        ],
        [
          "DELETE /api/users/current",
          "Removes the current user."
        ],
        [
          "PATCH /api/users/current",
          "Updates the current user."
        ],
        ["GET /api/users/detached", undefined]
      ])
    );
  });

  it("recognizes documented requests inside React hook wrappers", () => {
    const parsed = parseSourceFile(
      sourceFile("hooks.tsx", "typescript"),
      [
        "import { GET } from '@/api/request';",
        "",
        "/** Loads the selected user. */",
        "export const loadUser = useCallback(async (id: string) => {",
        "  // Requests the latest user state.",
        "  return GET(`/api/users/${id}`);",
        "}, []);",
        "",
        "/** Preloads the active user. */",
        "export const preloadUser = React.useMemo(",
        "  () => fetch('/api/users/active'),",
        "  []",
        ");"
      ].join("\n")
    );

    expect(
      parsed.symbols.find(
        (symbol) => symbol.name === "loadUser"
      )
    ).toMatchObject({
      documentation: "Loads the selected user.",
      kind: "function"
    });
    expect(
      parsed.symbols.find(
        (symbol) => symbol.name === "preloadUser"
      )
    ).toMatchObject({
      documentation: "Preloads the active user.",
      kind: "function"
    });
    expect(
      parsed.clientRequests.find(
        (request) => request.route === "/api/users/:param"
      )
    ).toMatchObject({
      containerQualifiedName: "loadUser",
      documentation: "Requests the latest user state."
    });
    expect(
      parsed.clientRequests.find(
        (request) => request.route === "/api/users/active"
      )
    ).toMatchObject({
      containerQualifiedName: "preloadUser"
    });
  });
});

describe("parseSourceFile symbol documentation", () => {
  it("extracts adjacent JSDoc and line comments for TypeScript symbols", () => {
    const parsed = parseSourceFile(
      sourceFile("documented.ts"),
      [
        "/**",
        " * Loads the user profile used by the details page.",
        " * @param id user identifier",
        " */",
        "export async function loadUser(id: string) {",
        "  return id;",
        "}",
        "",
        "// Persists the edited user profile.",
        "// Keeps the cache in sync.",
        "export const saveUser = (id: string) => {",
        "  return id;",
        "};",
        "",
        "class UserService {",
        "  /** Resolves the active user. */",
        "  findActive() {",
        "    return loadUser('active');",
        "  }",
        "}"
      ].join("\n")
    );

    expect(
      parsed.symbols.find((symbol) => symbol.name === "loadUser")
        ?.documentation
    ).toBe("Loads the user profile used by the details page.");
    expect(
      parsed.symbols.find((symbol) => symbol.name === "saveUser")
        ?.documentation
    ).toBe(
      "Persists the edited user profile. Keeps the cache in sync."
    );
    expect(
      parsed.symbols.find((symbol) => symbol.name === "findActive")
        ?.documentation
    ).toBe("Resolves the active user.");
  });

  it("extracts JavaDoc across Spring annotations", () => {
    const parsed = parseSourceFile(
      sourceFile("UserController.java", "java"),
      [
        "/** Coordinates user queries. */",
        "@RestController",
        "public class UserController {",
        "  /**",
        "   * Returns a user by identifier.",
        "   * @return matching user",
        "   */",
        '  @GetMapping("/users/{id}")',
        "  public User getUser() {",
        "    return service.findUser();",
        "  }",
        "}"
      ].join("\n")
    );

    expect(
      parsed.symbols.find(
        (symbol) => symbol.name === "UserController"
      )?.documentation
    ).toBe("Coordinates user queries.");
    expect(
      parsed.symbols.find((symbol) => symbol.name === "getUser")
        ?.documentation
    ).toBe("Returns a user by identifier.");
  });
});

describe("parseSourceFile fai-cli-rpc profile", () => {
  it("identifies client and server boundaries by shared protocol identity instead of wrapper names", () => {
    const client = parseSourceFile(
      sourceFile("ResourcePort.java", "java"),
      [
        "package example.client;",
        "",
        "import example.protocol.ResourceDef;",
        "",
        "public interface ResourcePort {",
        "  @GeneratedOutbound(",
        "    operation = ResourceDef.Protocol.Cmd.ADD",
        "  )",
        "  Result addResource(Object entity);",
        "}"
      ].join("\n")
    );
    const server = parseSourceFile(
      sourceFile("ResourceProcessor.java", "java"),
      [
        "package example.server;",
        "",
        "import example.protocol.ResourceDef;",
        "",
        "public class ResourceProcessor {",
        "  @InboundDispatch(command = ResourceDef.Protocol.Cmd.ADD)",
        "  public Result save(Object entity) throws Exception {",
        "    int resultCode = 0;",
        "    return service.persist(entity);",
        "  }",
        "}"
      ].join("\n")
    );

    expect(
      client.symbols.find(
        (symbol) => symbol.qualifiedName === "ResourcePort.addResource"
      )
    ).toMatchObject({
      kind: "method",
      calls: []
    });
    expect(client.remoteBoundaries).toEqual([
      expect.objectContaining({
        profileId: "fai-cli-rpc",
        role: "client",
        operationKey:
          "example.protocol.ResourceDef.Protocol.Cmd.ADD",
        operationName: "ADD",
        serviceKey: "example.protocol.ResourceDef",
        rawOperation: "ResourceDef.Protocol.Cmd.ADD",
        wrapperId: "GeneratedOutbound",
        symbolQualifiedName: "ResourcePort.addResource",
        confidence: "exact"
      })
    ]);
    expect(server.remoteBoundaries).toEqual([
      expect.objectContaining({
        profileId: "fai-cli-rpc",
        role: "server",
        operationKey:
          "example.protocol.ResourceDef.Protocol.Cmd.ADD",
        wrapperId: "InboundDispatch",
        symbolQualifiedName: "ResourceProcessor.save",
        confidence: "exact"
      })
    ]);
  });

  it("does not treat protocol keys or wrapper package names as RPC identities", () => {
    const parsed = parseSourceFile(
      sourceFile("NotRpc.java", "java"),
      [
        "package example;",
        "",
        "import example.protocol.ResourceDef;",
        "import fai.hd.prc.Marker;",
        "",
        "public interface NotRpc {",
        "  @Marker(ResourceDef.Protocol.Key.INFO)",
        "  Result inspect();",
        "}"
      ].join("\n")
    );

    expect(parsed.remoteBoundaries).toEqual([]);
  });
});

function sourceFile(
  relativePath: string,
  language: AnalysisSourceFile["language"] = "typescript"
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
