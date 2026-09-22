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
      expect(changed.indexStatus).toMatchObject({
        fullIndexAvailable: true,
        resultCompleteness: "partial",
        impactCoverage: "possible-omissions",
        lastFullIndexAt: full.generatedAt
      });

      const revisionChanged = await engine.analyze({
        ...analysisInput(fixture, {
          analysisId: "revision-changed",
          scope: "changed",
          changedPaths: [
            changedPath(fixture.frontendRoot, "client.ts")
          ]
        }),
        roots: [
          {
            ...fixture.frontendRoot,
            revision: "frontend-head-two"
          },
          fixture.backendRoot
        ]
      });

      expect(revisionChanged.requestChains).toHaveLength(0);
      expect(revisionChanged.indexStatus).toMatchObject({
        fullIndexAvailable: false,
        resultCompleteness: "partial",
        impactCoverage: "possible-omissions",
        lastFullIndexAt: full.generatedAt
      });
      expect(revisionChanged.diagnostics).toContainEqual(
        expect.objectContaining({
          kind: "partial-index"
        })
      );

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

  it("keeps changed analysis partial when the cached workspace semantic index was incomplete", async () => {
    const fixture = await createFixture();
    const engine = new CodeAnalysisEngine(
      new ChangingCoverageLanguageServerPool()
    );
    try {
      const full = await engine.analyze(
        analysisInput(fixture, {
          analysisId: "partial-semantic-full",
          scope: "workspace",
          changedPaths: []
        })
      );
      expect(full.indexStatus).toMatchObject({
        fullIndexAvailable: true,
        resultCompleteness: "partial"
      });

      await writeFile(
        fixture.frontendFile,
        `${frontendSource()}\n// changed\n`,
        "utf8"
      );
      const changed = await engine.analyze(
        analysisInput(fixture, {
          analysisId: "partial-semantic-changed",
          scope: "changed",
          changedPaths: [
            changedPath(fixture.frontendRoot, "client.ts")
          ]
        })
      );

      expect(changed.indexStatus).toMatchObject({
        fullIndexAvailable: true,
        resultCompleteness: "partial",
        impactCoverage: "possible-omissions",
        message:
          "缓存中的完整项目索引缺少完整的 Language Server 语义增强；请重新运行完整项目分析。"
      });
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
        ...settings.typescript,
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

  it("honors the configured relationship graph node limit", async () => {
    const fixture = await createFixture();
    const engine = new CodeAnalysisEngine();
    const settings = defaultSettings();
    settings.maxGraphNodes = 2;
    settings.maxGraphEdges = 123;
    settings.maxRequestChains = 456;

    try {
      const snapshot = await engine.analyze({
        ...analysisInput(fixture, {
          analysisId: "limited-graph",
          scope: "workspace",
          changedPaths: []
        }),
        settings
      });

      expect(snapshot.nodes).toHaveLength(2);
      expect(snapshot.stats.truncated).toBe(true);
      expect(snapshot.warnings).toContain(
        "关系图达到安全上限（节点 2、边 123、调用链 456），本次结果已截断。"
      );
    } finally {
      await engine.dispose();
      await fixture.dispose();
    }
  });

  it("marks a workspace index partial when supported source exceeds the per-file limit", async () => {
    const fixture = await createFixture();
    const engine = new CodeAnalysisEngine();
    const settings = defaultSettings();
    settings.maxFileSizeBytes = 4;

    try {
      const snapshot = await engine.analyze({
        ...analysisInput(fixture, {
          analysisId: "limited-source-files",
          scope: "workspace",
          changedPaths: []
        }),
        settings
      });

      expect(snapshot.indexStatus).toMatchObject({
        fullIndexAvailable: false,
        resultCompleteness: "partial",
        impactCoverage: "possible-omissions"
      });
      expect(snapshot.diagnostics).toContainEqual(
        expect.objectContaining({
          kind: "partial-index",
          evidence: expect.stringContaining(
            "单文件大小限制"
          )
        })
      );
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

  it("uses incoming LSP calls to connect callers to exact cross-file targets", async () => {
    const fixture = await createFixture();
    await Promise.all([
      writeFile(
        join(fixture.frontendRoot.path, "caller.ts"),
        [
          "export function caller() {",
          "  return registry.invoke();",
          "}"
        ].join("\n"),
        "utf8"
      ),
      writeFile(
        join(fixture.frontendRoot.path, "target.ts"),
        [
          "export function target() {",
          "  return 1;",
          "}"
        ].join("\n"),
        "utf8"
      )
    ]);
    const settings = defaultSettings();
    settings.typescript.enabled = true;
    const engine = new CodeAnalysisEngine(
      new IncomingCallLanguageServerPool()
    );
    const cachedEngine = new CodeAnalysisEngine();

    try {
      const snapshot = await engine.analyze({
        ...analysisInput(fixture, {
          analysisId: "lsp-incoming-calls",
          scope: "workspace",
          changedPaths: []
        }),
        settings
      });
      const caller = snapshot.nodes.find(
        (node) =>
          node.name === "caller" &&
          node.location.path === "caller.ts"
      );
      const target = snapshot.nodes.find(
        (node) =>
          node.name === "target" &&
          node.location.path === "target.ts"
      );

      expect(caller).toBeDefined();
      expect(target).toBeDefined();
      expect(snapshot.edges).toContainEqual(
        expect.objectContaining({
          from: caller?.id,
          to: target?.id,
          kind: "calls",
          confidence: "exact"
        })
      );

      const cachedSnapshot = await cachedEngine.analyze(
        analysisInput(fixture, {
          analysisId: "without-lsp-incoming-calls",
          scope: "workspace",
          changedPaths: []
        })
      );
      const cachedCaller = cachedSnapshot.nodes.find(
        (node) =>
          node.name === "caller" &&
          node.location.path === "caller.ts"
      );
      const cachedTarget = cachedSnapshot.nodes.find(
        (node) =>
          node.name === "target" &&
          node.location.path === "target.ts"
      );

      expect(cachedSnapshot.edges).not.toContainEqual(
        expect.objectContaining({
          from: cachedCaller?.id,
          to: cachedTarget?.id,
          kind: "calls"
        })
      );
    } finally {
      await engine.dispose();
      await cachedEngine.dispose();
      await fixture.dispose();
    }
  });

  it("indexes Java nested constants without LSP and upgrades their references when LSP is available", async () => {
    const fixture = await createFixture();
    await Promise.all([
      writeFile(
        join(fixture.backendRoot.path, "ScProfDef.java"),
        [
          "package fai.app;",
          "public class ScProfDef {",
          "  public static final class Flag {",
          "    public static final int OPEN_GUIDE = 1;",
          "  }",
          "}"
        ].join("\n"),
        "utf8"
      ),
      writeFile(
        join(
          fixture.backendRoot.path,
          "ScProfServiceImpl.java"
        ),
        [
          "package fai.app;",
          "public class ScProfServiceImpl {",
          "  public boolean enabled(int flag) {",
          "    return Misc.checkBit(flag, ScProfDef.Flag.OPEN_GUIDE);",
          "  }",
          "}"
        ].join("\n"),
        "utf8"
      )
    ]);
    const builtinEngine = new CodeAnalysisEngine();
    const settings = defaultSettings();
    settings.java.enabled = true;
    const engine = new CodeAnalysisEngine(
      new ReferenceLanguageServerPool()
    );

    try {
      const builtinSnapshot = await builtinEngine.analyze(
        analysisInput(fixture, {
          analysisId: "builtin-field-references",
          scope: "workspace",
          changedPaths: []
        })
      );
      const builtinCaller = builtinSnapshot.nodes.find(
        (node) =>
          node.name === "enabled" &&
          node.location.path === "ScProfServiceImpl.java"
      );
      const builtinTarget = builtinSnapshot.nodes.find(
        (node) =>
          node.qualifiedName ===
          "ScProfDef.Flag.OPEN_GUIDE"
      );

      expect(builtinCaller).toBeDefined();
      expect(builtinTarget).toBeDefined();
      expect(builtinSnapshot.edges).toContainEqual(
        expect.objectContaining({
          from: builtinCaller?.id,
          to: builtinTarget?.id,
          kind: "references",
          confidence: "probable",
          source: "builtin"
        })
      );

      const snapshot = await engine.analyze({
        ...analysisInput(fixture, {
          analysisId: "lsp-field-references",
          scope: "workspace",
          changedPaths: []
        }),
        settings
      });
      const caller = snapshot.nodes.find(
        (node) =>
          node.name === "enabled" &&
          node.location.path === "ScProfServiceImpl.java"
      );
      const target = snapshot.nodes.find(
        (node) =>
          node.name === "OPEN_GUIDE" &&
          node.kind === "property" &&
          node.location.path === "ScProfDef.java"
      );

      expect(caller).toBeDefined();
      expect(target).toBeDefined();
      expect(target?.qualifiedName).toContain(
        "ScProfDef.Flag.OPEN_GUIDE"
      );
      expect(snapshot.edges).toContainEqual(
        expect.objectContaining({
          from: caller?.id,
          to: target?.id,
          kind: "references",
          confidence: "exact",
          source: "merged"
        })
      );
    } finally {
      await builtinEngine.dispose();
      await engine.dispose();
      await fixture.dispose();
    }
  });

  it("merges LSP type hierarchy and implementation relations into exact graph edges", async () => {
    const fixture = await createFixture();
    await Promise.all([
      writeFile(
        join(fixture.backendRoot.path, "Base.java"),
        [
          "package example;",
          "public class Base {",
          "  public void execute() {}",
          "}"
        ].join("\n"),
        "utf8"
      ),
      writeFile(
        join(fixture.backendRoot.path, "Child.java"),
        [
          "package example;",
          "public class Child extends Base {",
          "  @Override",
          "  public void execute() {}",
          "}"
        ].join("\n"),
        "utf8"
      )
    ]);
    const settings = defaultSettings();
    settings.java.enabled = true;
    const engine = new CodeAnalysisEngine(
      new SemanticRelationLanguageServerPool()
    );

    try {
      const snapshot = await engine.analyze({
        ...analysisInput(fixture, {
          analysisId: "semantic-relations",
          scope: "workspace",
          changedPaths: []
        }),
        settings
      });
      const baseClass = snapshot.nodes.find(
        (node) =>
          node.name === "Base" &&
          node.location.path === "Base.java"
      );
      const childClass = snapshot.nodes.find(
        (node) =>
          node.name === "Child" &&
          node.location.path === "Child.java"
      );
      const baseMethod = snapshot.nodes.find(
        (node) =>
          node.name === "execute" &&
          node.location.path === "Base.java"
      );
      const childMethod = snapshot.nodes.find(
        (node) =>
          node.name === "execute" &&
          node.location.path === "Child.java"
      );

      expect(snapshot.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            from: childClass?.id,
            to: baseClass?.id,
            kind: "extends",
            source: "lsp"
          }),
          expect.objectContaining({
            from: childMethod?.id,
            to: baseMethod?.id,
            kind: "overrides",
            source: "lsp"
          })
        ])
      );
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
        confidence: "probable"
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
      path: frontendPath,
      revision: "frontend-head-one"
    },
    backendRoot: {
      repositoryId: "backend-repository",
      worktreeId: "backend-worktree",
      name: "backend",
      path: backendPath,
      revision: "backend-head-one"
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
    maxTotalSourceBytes: 128 * 1_024 * 1_024,
    maxGraphNodes: 30_000,
    maxGraphEdges: 100_000,
    maxRequestChains: 5_000,
    maxDiagnostics: 2_000,
    maxFileSizeBytes: 256 * 1_024,
    readConcurrency: 4,
    graphDepth: 8,
    lspTimeoutMs: 1_000,
    ignoreDirectories: [".git", "node_modules", "cache", "lsp"],
    typescript: {
      enabled: false,
      command: "typescript-language-server",
      args: ["--stdio"],
      maxDocuments: 120,
      maxSymbolsPerDocument: 5_000,
      maxCallHierarchyRequests: 50,
      maxReferenceRequests: 50,
      maxDocumentationRequests: 50,
      maxReferencesPerSymbol: 500
    },
    java: {
      enabled: false,
      command: "jdtls",
      args: [],
      maxDocuments: 80,
      maxSymbolsPerDocument: 5_000,
      maxCallHierarchyRequests: 40,
      maxReferenceRequests: 1_000,
      maxDocumentationRequests: 40,
      maxReferencesPerSymbol: 500
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
          outgoingCalls: [],
          incomingCalls: []
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
          outgoingCalls: [],
          incomingCalls: []
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

class ChangingCoverageLanguageServerPool extends ExternalLanguageServerPool {
  #analysisCount = 0;

  override async analyze(
    input: Parameters<
      ExternalLanguageServerPool["analyze"]
    >[0]
  ) {
    this.#analysisCount += 1;
    const semanticCoverage =
      this.#analysisCount === 1
        ? ("partial" as const)
        : ("complete" as const);
    return {
      symbolsByPath: new Map<
        string,
        LspDocumentSymbol[]
      >(),
      statuses: [
        {
          language: "typescript" as const,
          state: "connected" as const,
          command: "test-language-server",
          message:
            semanticCoverage === "partial"
              ? "Budget exhausted"
              : "Connected",
          symbolCount: 0,
          semanticCoverage,
          documentsTotal: input.documents.length,
          documentsAnalyzed: input.documents.length,
          skippedDocuments: 0,
          failedDocuments: 0,
          truncatedDocuments: 0,
          requestBudgetExhausted:
            semanticCoverage === "partial",
          enrichmentStoppedEarly: false
        }
      ],
      warnings: []
    };
  }
}

class IncomingCallLanguageServerPool extends ExternalLanguageServerPool {
  override async analyze(
    input: Parameters<
      ExternalLanguageServerPool["analyze"]
    >[0]
  ) {
    const symbolsByPath = new Map<
      string,
      LspDocumentSymbol[]
    >();
    const caller = input.documents.find(
      (document) => document.file.relativePath === "caller.ts"
    );
    const target = input.documents.find(
      (document) => document.file.relativePath === "target.ts"
    );
    if (caller && target) {
      symbolsByPath.set(target.file.canonicalPath, [
        {
          name: "target",
          kind: 12,
          line: 1,
          character: 16,
          endLine: 3,
          children: [],
          outgoingCalls: [],
          incomingCalls: [
            {
              name: "caller",
              line: 2,
              sourceCanonicalPath:
                caller.file.canonicalPath,
              sourceLine: 1
            }
          ]
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
          symbolCount: 1
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

class ReferenceLanguageServerPool extends ExternalLanguageServerPool {
  override async analyze(
    input: Parameters<
      ExternalLanguageServerPool["analyze"]
    >[0]
  ) {
    const symbolsByPath = new Map<
      string,
      LspDocumentSymbol[]
    >();
    const definition = input.documents.find(
      (document) =>
        document.file.relativePath === "ScProfDef.java"
    );
    const caller = input.documents.find(
      (document) =>
        document.file.relativePath ===
        "ScProfServiceImpl.java"
    );
    if (definition && caller) {
      symbolsByPath.set(definition.file.canonicalPath, [
        {
          name: "ScProfDef",
          kind: 5,
          line: 2,
          character: 13,
          endLine: 6,
          children: [
            {
              name: "Flag",
              kind: 5,
              line: 3,
              character: 28,
              endLine: 5,
              children: [
                {
                  name: "OPEN_GUIDE",
                  kind: 14,
                  line: 4,
                  character: 28,
                  endLine: 4,
                  children: [],
                  outgoingCalls: [],
                  incomingCalls: [],
                  references: [
                    {
                      sourceCanonicalPath:
                        caller.file.canonicalPath,
                      line: 4,
                      character: 44
                    }
                  ]
                }
              ],
              outgoingCalls: [],
              incomingCalls: [],
              references: []
            }
          ],
          outgoingCalls: [],
          incomingCalls: [],
          references: []
        }
      ]);
    }
    return {
      symbolsByPath,
      statuses: [
        {
          language: "typescript" as const,
          state: "disabled" as const,
          command: "typescript-language-server",
          message: "Disabled",
          symbolCount: 0
        },
        {
          language: "java" as const,
          state: "connected" as const,
          command: "test-language-server",
          message: "Connected",
          symbolCount: 3
        }
      ],
      warnings: []
    };
  }
}

class SemanticRelationLanguageServerPool extends ExternalLanguageServerPool {
  override async analyze(
    input: Parameters<
      ExternalLanguageServerPool["analyze"]
    >[0]
  ) {
    const base = input.documents.find(
      (document) => document.file.relativePath === "Base.java"
    );
    const child = input.documents.find(
      (document) => document.file.relativePath === "Child.java"
    );
    return {
      symbolsByPath: new Map(),
      semanticRelations:
        base && child
          ? [
              {
                kind: "extends" as const,
                sourceName: "Child",
                sourceCanonicalPath:
                  child.file.canonicalPath,
                sourceLine: 2,
                targetName: "Base",
                targetCanonicalPath:
                  base.file.canonicalPath,
                targetLine: 2,
                evidence:
                  "LSP Type Hierarchy supertypes"
              },
              {
                kind: "overrides" as const,
                sourceName: "execute",
                sourceCanonicalPath:
                  child.file.canonicalPath,
                sourceLine: 4,
                targetName: "execute",
                targetCanonicalPath:
                  base.file.canonicalPath,
                targetLine: 3,
                evidence:
                  "LSP textDocument/implementation"
              }
            ]
          : [],
      statuses: [
        {
          language: "typescript" as const,
          state: "disabled" as const,
          command: "typescript-language-server",
          message: "Disabled",
          symbolCount: 0
        },
        {
          language: "java" as const,
          state: "connected" as const,
          command: "test-language-server",
          message: "Connected",
          symbolCount: 0,
          semanticCoverage: "complete" as const
        }
      ],
      warnings: []
    };
  }
}
