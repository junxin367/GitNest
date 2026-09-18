import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  describe,
  expect,
  it
} from "vitest";

import {
  CodeAnalysisEngine,
  ExternalLanguageServerPool,
  type AnalysisRoot,
  type CodeAnalysisInput,
  type CodeAnalysisSettings
} from "./index";
import type { LspDocumentSymbol } from "./model";

describe("CodeAnalysisEngine", () => {
  it("reuses a complete index for changed request chains and invalidates it when roots change", async () => {
    const fixture = await createFixture();
    const engine = new CodeAnalysisEngine();
    try {
      const full = await engine.analyze(
        analysisInput(fixture, {
          analysisId: "full",
          scope: "workspace",
          changedPaths: []
        })
      );

      expect(full.requestChains).toHaveLength(1);
      expect(full.requestChains[0]).toMatchObject({
        method: "GET",
        route: "/api/users/:param",
        changed: false
      });
      expect(
        full.nodes.some(
          (node) =>
            node.name === "findUser" &&
            node.location.path === "UserService.java"
        )
      ).toBe(true);

      await writeFile(
        fixture.frontendFile,
        `${frontendSource()}\n// changed\n`,
        "utf8"
      );
      const changed = await engine.analyze(
        analysisInput(fixture, {
          analysisId: "changed",
          scope: "changed",
          changedPaths: [
            changedPath(fixture.frontendRoot, "client.ts")
          ]
        })
      );

      expect(changed.requestChains).toHaveLength(1);
      expect(changed.requestChains[0]?.changed).toBe(true);
      expect(
        changed.nodes.some(
          (node) =>
            node.name === "findUser" &&
            node.location.path === "UserService.java" &&
            !node.changed
        )
      ).toBe(true);

      const rootsChanged = await engine.analyze({
        ...analysisInput(fixture, {
          analysisId: "roots-changed",
          scope: "changed",
          changedPaths: [
            changedPath(fixture.frontendRoot, "client.ts")
          ]
        }),
        roots: [fixture.frontendRoot]
      });

      expect(rootsChanged.requestChains).toHaveLength(0);
      expect(
        rootsChanged.nodes.every(
          (node) => node.language !== "java"
        )
      ).toBe(true);
      expect(rootsChanged.warnings).toContain(
        "当前没有完整项目索引，变动代码只能展示本次可确定的局部关系。"
      );
    } finally {
      await engine.dispose();
      await fixture.dispose();
    }
  });

  it("fails when a required Language Server is unavailable and fallback is disabled", async () => {
    const fixture = await createFixture();
    const engine = new CodeAnalysisEngine();
    try {
      const settings = defaultSettings();
      settings.staticFallback = false;
      settings.typescript = {
        enabled: true,
        command: join(
          fixture.directory,
          "missing-language-server"
        ),
        args: []
      };

      await expect(
        engine.analyze({
          ...analysisInput(fixture, {
            analysisId: "strict-lsp",
            scope: "changed",
            changedPaths: [
              changedPath(fixture.frontendRoot, "client.ts")
            ]
          }),
          settings
        })
      ).rejects.toThrow("内置分析降级已关闭");
    } finally {
      await engine.dispose();
      await fixture.dispose();
    }
  });

  it("uses Hover documentation for undocumented requests without replacing source comments", async () => {
    const fixture = await createFixture();
    await writeFile(
      fixture.frontendFile,
      [
        "import { GET } from '@/api/request';",
        "",
        "/** Keeps the explicit source documentation. */",
        "export const documented = () => GET('/api/documented');",
        "export const loadUser = (id: string) => GET(`/api/users/${id}`);"
      ].join("\n"),
      "utf8"
    );
    const settings = defaultSettings();
    settings.typescript.enabled = true;
    const engine = new CodeAnalysisEngine(
      new DocumentationLanguageServerPool()
    );

    try {
      const snapshot = await engine.analyze({
        ...analysisInput(fixture, {
          analysisId: "lsp-documentation",
          scope: "workspace",
          changedPaths: []
        }),
        settings
      });
      const nodeByName = new Map(
        snapshot.nodes.map((node) => [node.name, node])
      );

      expect(
        nodeByName.get("documented")?.metadata.documentation
      ).toBe("Keeps the explicit source documentation.");
      expect(
        nodeByName.get("loadUser")?.metadata.documentation
      ).toBe("Loads the user profile from Hover.");
      expect(
        nodeByName.get("GET /api/users/:param")?.metadata
          .documentation
      ).toBe("Loads the user profile from Hover.");
      expect(
        nodeByName.get("GET /api/documented")?.metadata
          .documentation
      ).toBe("Keeps the explicit source documentation.");
    } finally {
      await engine.dispose();
      await fixture.dispose();
    }
  });

  it("connects fai-cli-rpc declarations and handlers across repository roots", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "gitnest-fai-cli-rpc-")
    );
    const clientPath = join(directory, "client");
    const serverPath = join(directory, "server");
    const cacheDirectory = join(directory, "cache");
    const lspDataDirectory = join(directory, "lsp");
    await Promise.all([
      mkdir(clientPath, { recursive: true }),
      mkdir(serverPath, { recursive: true })
    ]);
    await Promise.all([
      writeFile(
        join(clientPath, "ResourcePort.java"),
        [
          "package example.client;",
          "import example.protocol.ResourceDef;",
          "public interface ResourcePort {",
          "  @ClientWrapper(ResourceDef.Protocol.Cmd.ADD)",
          "  Object addResource();",
          "}"
        ].join("\n"),
        "utf8"
      ),
      writeFile(
        join(clientPath, "ResourceFacade.java"),
        [
          "public class ResourceFacade {",
          "  public Object create() {",
          "    return resourcePort.addResource();",
          "  }",
          "}"
        ].join("\n"),
        "utf8"
      ),
      writeFile(
        join(serverPath, "ResourceProc.java"),
        [
          "package example.server;",
          "import example.protocol.ResourceDef;",
          "public class ResourceProc {",
          "  @ServerWrapper(ResourceDef.Protocol.Cmd.ADD)",
          "  public Object save() {",
          "    return resourceService.persist();",
          "  }",
          "}"
        ].join("\n"),
        "utf8"
      ),
      writeFile(
        join(serverPath, "ResourceService.java"),
        [
          "public class ResourceService {",
          "  public Object persist() { return repository.insert(); }",
          "}"
        ].join("\n"),
        "utf8"
      )
    ]);
    const roots: AnalysisRoot[] = [
      {
        repositoryId: "client-repository",
        worktreeId: "client-worktree",
        name: "client",
        path: clientPath
      },
      {
        repositoryId: "server-repository",
        worktreeId: "server-worktree",
        name: "server",
        path: serverPath
      }
    ];
    const engine = new CodeAnalysisEngine();
    try {
      const snapshot = await engine.analyze({
        analysisId: "fai-cli-rpc",
        workspaceId: "workspace",
        entryId: "entry",
        entryName: "RPC fixture",
        workspaceRootPath: directory,
        roots,
        scope: "workspace",
        changedPaths: [],
        cacheDirectory,
        lspDataDirectory,
        settings: defaultSettings()
      });

      expect(snapshot.requestChains).toHaveLength(1);
      expect(snapshot.requestChains[0]).toMatchObject({
        profileId: "fai-cli-rpc",
        transport: "rpc",
        operationKey:
          "example.protocol.ResourceDef.Protocol.Cmd.ADD",
        method: "RPC",
        route: "ResourceDef.Protocol.Cmd.ADD",
        confidence: "exact"
      });
      const kinds = snapshot.nodes
        .filter((node) =>
          snapshot.requestChains[0]?.nodeIds.includes(node.id)
        )
        .map((node) => node.kind);
      expect(kinds).toEqual(
        expect.arrayContaining([
          "method",
          "rpc-client",
          "rpc-handler"
        ])
      );
    } finally {
      await engine.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

interface Fixture {
  directory: string;
  cacheDirectory: string;
  lspDataDirectory: string;
  frontendFile: string;
  frontendRoot: AnalysisRoot;
  backendRoot: AnalysisRoot;
  dispose(): Promise<void>;
}

async function createFixture(): Promise<Fixture> {
  const directory = await mkdtemp(
    join(tmpdir(), "gitnest-code-analysis-")
  );
  const frontendPath = join(directory, "frontend");
  const backendPath = join(directory, "backend");
  await Promise.all([
    mkdir(frontendPath, { recursive: true }),
    mkdir(backendPath, { recursive: true })
  ]);
  const frontendFile = join(frontendPath, "client.ts");
  await Promise.all([
    writeFile(frontendFile, frontendSource(), "utf8"),
    writeFile(
      join(backendPath, "UserController.java"),
      [
        "@RestController",
        '@RequestMapping("/api")',
        "public class UserController {",
        "  private final UserService userService;",
        "",
        '  @GetMapping("/users/{id}")',
        "  public User getUser() {",
        "    return userService.findUser();",
        "  }",
        "}"
      ].join("\n"),
      "utf8"
    ),
    writeFile(
      join(backendPath, "UserService.java"),
      [
        "@Service",
        "public class UserService {",
        "  public User findUser() {",
        "    return repository.find();",
        "  }",
        "}"
      ].join("\n"),
      "utf8"
    )
  ]);
  return {
    directory,
    cacheDirectory: join(directory, "cache"),
    lspDataDirectory: join(directory, "lsp"),
    frontendFile,
    frontendRoot: {
      repositoryId: "frontend-repository",
      worktreeId: "frontend-worktree",
      name: "frontend",
      path: frontendPath
    },
    backendRoot: {
      repositoryId: "backend-repository",
      worktreeId: "backend-worktree",
      name: "backend",
      path: backendPath
    },
    dispose: () =>
      rm(directory, { recursive: true, force: true })
  };
}

function analysisInput(
  fixture: Fixture,
  overrides: Pick<
    CodeAnalysisInput,
    "analysisId" | "scope" | "changedPaths"
  >
): CodeAnalysisInput {
  return {
    ...overrides,
    workspaceId: "workspace",
    entryId: "entry",
    entryName: "Fixture",
    workspaceRootPath: fixture.directory,
    roots: [fixture.frontendRoot, fixture.backendRoot],
    cacheDirectory: fixture.cacheDirectory,
    lspDataDirectory: fixture.lspDataDirectory,
    settings: defaultSettings()
  };
}

function changedPath(root: AnalysisRoot, path: string) {
  return {
    repositoryId: root.repositoryId,
    worktreeId: root.worktreeId,
    path
  };
}

function defaultSettings(): CodeAnalysisSettings {
  return {
    enabled: true,
    staticFallback: true,
    maxFiles: 100,
    maxFileSizeBytes: 256 * 1_024,
    readConcurrency: 2,
    graphDepth: 6,
    lspTimeoutMs: 1_000,
    ignoreDirectories: [".git", "node_modules", "cache", "lsp"],
    typescript: {
      enabled: false,
      command: "typescript-language-server",
      args: ["--stdio"]
    },
    java: {
      enabled: false,
      command: "jdtls",
      args: []
    }
  };
}

function frontendSource(): string {
  return [
    "import { GET } from '@/api/request';",
    "",
    "export const loadUser = (id: string) =>",
    "  GET<User>(`/api/users/${id}`);"
  ].join("\n");
}

class DocumentationLanguageServerPool extends ExternalLanguageServerPool {
  override async analyze(
    input: Parameters<
      ExternalLanguageServerPool["analyze"]
    >[0]
  ) {
    const symbolsByPath = new Map<
      string,
      LspDocumentSymbol[]
    >();
    for (const document of input.documents) {
      if (document.file.language === "java") {
        continue;
      }
      symbolsByPath.set(document.file.canonicalPath, [
        {
          name: "documented",
          kind: 12,
          line: 4,
          character: 13,
          endLine: 4,
          documentation:
            "Hover documentation must not replace source comments.",
          children: [],
          outgoingCalls: []
        },
        {
          name: "loadUser",
          kind: 12,
          line: 5,
          character: 13,
          endLine: 5,
          documentation:
            "Loads the user profile from Hover.",
          children: [],
          outgoingCalls: []
        }
      ]);
    }
    return {
      symbolsByPath,
      statuses: [
        {
          language: "typescript" as const,
          state: "connected" as const,
          command: "test-language-server",
          message: "Connected",
          symbolCount: 2
        },
        {
          language: "java" as const,
          state: "disabled" as const,
          command: "jdtls",
          message: "Disabled",
          symbolCount: 0
        }
      ],
      warnings: []
    };
  }
}
