import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  join,
  resolve
} from "node:path";

import {
  describe,
  expect,
  it,
  afterEach
} from "vitest";

import {
  ExternalLanguageServerPool,
  JsonRpcClient,
  resolveLanguageServerStartupTimeoutMs,
  resolveLanguageServerWorkspaceReadyTimeoutMs,
  resolveLanguageServerWorkspace,
  resolveNodeCommandShim,
  resolveWindowsEditorJdtls
} from "./lsp-client";
import type {
  AnalysisSourceFile,
  CodeAnalysisSettings
} from "./model";

describe("resolveWindowsEditorJdtls", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
  });

  it("uses the newest complete Red Hat Java extension", async () => {
    const extensionRoot = await createExtensionRoot();
    await createJdtlsExtension(
      extensionRoot,
      "redhat.java-1.9.0-win32-x64",
      "17.0.1-win32-x86_64"
    );
    const newest = await createJdtlsExtension(
      extensionRoot,
      "redhat.java-1.54.0-win32-x64",
      "21.0.10-win32-x86_64"
    );

    const launch = await resolveWindowsEditorJdtls(
      ["-data", "C:\\GitNest\\jdtls"],
      [extensionRoot]
    );

    expect(launch).toBeDefined();
    expect(launch?.command).toBe(
      resolve(newest, "jre/21.0.10-win32-x86_64/bin/java.exe")
    );
    expect(launch?.args).toEqual(
      expect.arrayContaining([
        `-Dosgi.sharedConfiguration.area=${resolve(
          newest,
          "server/config_win"
        )}`,
        "-Xms100m",
        "-Xmx2G",
        "-jar",
        resolve(
          newest,
          "server/plugins/org.eclipse.equinox.launcher_1.7.100.jar"
        ),
        "-data",
        "C:\\GitNest\\jdtls"
      ])
    );
  });

  it("skips an incomplete newer extension", async () => {
    const extensionRoot = await createExtensionRoot();
    const complete = await createJdtlsExtension(
      extensionRoot,
      "redhat.java-1.50.0-win32-x64",
      "21.0.8-win32-x86_64"
    );
    await mkdir(
      join(
        extensionRoot,
        "redhat.java-1.60.0-win32-x64",
        "server"
      ),
      { recursive: true }
    );

    const launch = await resolveWindowsEditorJdtls(
      [],
      [extensionRoot]
    );

    expect(launch?.command).toBe(
      resolve(complete, "jre/21.0.8-win32-x86_64/bin/java.exe")
    );
  });

  async function createExtensionRoot(): Promise<string> {
    const directory = await mkdtemp(
      join(tmpdir(), "gitnest-jdtls-")
    );
    directories.push(directory);
    return directory;
  }
});

describe("resolveNodeCommandShim", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
  });

  it("expands the dp0 alias used by current npm shims", async () => {
    if (process.platform !== "win32") {
      return;
    }
    const fixture = await createNodeShimFixture(
      [
        "@ECHO off",
        "GOTO start",
        ":find_dp0",
        "SET dp0=%~dp0",
        "EXIT /b",
        ":start",
        "CALL :find_dp0",
        '"%_prog%" "%dp0%\\..\\typescript-language-server\\lib\\cli.mjs" %*'
      ].join("\r\n")
    );
    directories.push(fixture.root);

    const launch = await resolveNodeCommandShim(
      fixture.shim,
      ["--stdio"]
    );

    expect(launch).toEqual({
      command: resolve(fixture.node),
      args: [resolve(fixture.cli), "--stdio"]
    });
  });

  it("keeps supporting shims that use percent-tilde-dp0 directly", async () => {
    if (process.platform !== "win32") {
      return;
    }
    const fixture = await createNodeShimFixture(
      '"%~dp0node.exe" "%~dp0..\\typescript-language-server\\lib\\cli.mjs" %*'
    );
    directories.push(fixture.root);

    const launch = await resolveNodeCommandShim(
      fixture.shim,
      ["--stdio"]
    );

    expect(launch).toEqual({
      command: resolve(fixture.node),
      args: [resolve(fixture.cli), "--stdio"]
    });
  });

  it("rejects an undeclared dp0 alias", async () => {
    if (process.platform !== "win32") {
      return;
    }
    const fixture = await createNodeShimFixture(
      '"%_prog%" "%dp0%\\..\\typescript-language-server\\lib\\cli.mjs" %*'
    );
    directories.push(fixture.root);

    await expect(
      resolveNodeCommandShim(fixture.shim, ["--stdio"])
    ).resolves.toBeUndefined();
  });
});

describe("language server workspace selection", () => {
  it("anchors Java to the first relevant repository root", () => {
    const firstRoot = join("fixtures", "java-one");
    const secondRoot = join("fixtures", "java-two");

    expect(
      resolveLanguageServerWorkspace(
        "java",
        [
          { file: sourceFile(firstRoot, "java") },
          { file: sourceFile(secondRoot, "java") },
          { file: sourceFile(firstRoot, "java") }
        ],
        join("fixtures", "umbrella"),
        [join("fixtures", "unrelated")]
      )
    ).toEqual({
      rootPath: resolve(firstRoot),
      workspaceFolders: [
        resolve(firstRoot),
        resolve(secondRoot)
      ]
    });
  });

  it("keeps the configured workspace for TypeScript", () => {
    const rootPath = join("fixtures", "umbrella");
    const workspaceFolders = [
      join("fixtures", "typescript-one"),
      join("fixtures", "typescript-two")
    ];

    expect(
      resolveLanguageServerWorkspace(
        "typescript",
        [{ file: sourceFile(workspaceFolders[0]!, "typescript") }],
        rootPath,
        workspaceFolders
      )
    ).toEqual({
      rootPath,
      workspaceFolders
    });
  });

  it("removes overlapping Java workspace roots", () => {
    const rootPath = join("fixtures", "java-workspace");
    const nestedRoot = join(rootPath, "core");
    const deeperRoot = join(rootPath, "svr", "example");

    expect(
      resolveLanguageServerWorkspace(
        "java",
        [
          { file: sourceFile(nestedRoot, "java") },
          { file: sourceFile(rootPath, "java") },
          { file: sourceFile(deeperRoot, "java") }
        ],
        rootPath,
        [rootPath, nestedRoot, deeperRoot]
      )
    ).toEqual({
      rootPath: resolve(rootPath),
      workspaceFolders: [resolve(rootPath)]
    });
  });

  it("gives Java startup and warm-up requests more time", () => {
    expect(
      resolveLanguageServerStartupTimeoutMs("java", 8_000)
    ).toBe(120_000);
    expect(
      resolveLanguageServerStartupTimeoutMs("java", 90_000)
    ).toBe(120_000);
    expect(
      resolveLanguageServerStartupTimeoutMs("java", 180_000)
    ).toBe(180_000);
    expect(
      resolveLanguageServerStartupTimeoutMs(
        "typescript",
        8_000
      )
    ).toBe(8_000);
    expect(
      resolveLanguageServerWorkspaceReadyTimeoutMs(
        "java",
        8_000
      )
    ).toBe(300_000);
    expect(
      resolveLanguageServerWorkspaceReadyTimeoutMs(
        "java",
        360_000
      )
    ).toBe(360_000);
    expect(
      resolveLanguageServerWorkspaceReadyTimeoutMs(
        "typescript",
        8_000
      )
    ).toBe(8_000);
  });
});

describe("language server documentation", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
  });

  it("adds Hover documentation to document symbols", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "gitnest-lsp-hover-")
    );
    directories.push(root);
    const projectRoot = join(root, "project");
    const serverPath = join(
      root,
      "hover-language-server.mjs"
    );
    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      serverPath,
      hoverLanguageServerSource(),
      "utf8"
    );
    const absolutePath = join(projectRoot, "Source.ts");
    const file: AnalysisSourceFile = {
      ...sourceFile(projectRoot, "typescript"),
      absolutePath,
      canonicalPath:
        process.platform === "win32"
          ? absolutePath.toLocaleLowerCase("en-US")
          : absolutePath,
      relativePath: "Source.ts"
    };
    const pool = new ExternalLanguageServerPool(1_000);

    try {
      const result = await pool.analyze({
        sessionPrefix: "typescript-hover-test",
        workspaceRootPath: projectRoot,
        workspaceFolders: [projectRoot],
        lspDataDirectory: join(root, "lsp"),
        settings: typescriptAnalysisSettings(serverPath),
        documents: [
          {
            file,
            content:
              "export async function loadUser() {}"
          }
        ]
      });

      expect(
        result.symbolsByPath.get(file.canonicalPath)
      ).toEqual([
        expect.objectContaining({
          name: "loadUser",
          documentation: "Loads the user profile."
        })
      ]);
      expect(result.statuses).toContainEqual(
        expect.objectContaining({
          language: "typescript",
          state: "connected",
          message: expect.stringContaining("补充 1 条文档")
        })
      );
    } finally {
      await pool.disposeAll();
    }
  });
});

describe("Java language server readiness", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
  });

  it("waits for JDT LS ServiceReady before requesting document symbols", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "gitnest-jdtls-ready-")
    );
    directories.push(root);
    const projectRoot = join(root, "project");
    const serverPath = join(
      root,
      "fake-jdtls-server.mjs"
    );
    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      serverPath,
      fakeJdtlsServerSource(),
      "utf8"
    );

    const file = sourceFile(projectRoot, "java");
    const pool = new ExternalLanguageServerPool(1_000);
    try {
      const result = await pool.analyze({
        sessionPrefix: "java-ready-test",
        workspaceRootPath: projectRoot,
        workspaceFolders: [projectRoot],
        lspDataDirectory: join(root, "lsp"),
        settings: analysisSettings(serverPath),
        documents: [
          {
            file,
            content: "class Source {}"
          }
        ]
      });

      expect(result.statuses).toContainEqual(
        expect.objectContaining({
          language: "java",
          state: "connected",
          symbolCount: 1
        })
      );
      expect(
        result.symbolsByPath.get(file.canonicalPath)
      ).toEqual([
        expect.objectContaining({
          name: "Source"
        })
      ]);
    } finally {
      await pool.disposeAll();
    }
  });

  it("rebuilds a failed Java data workspace once before retrying", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "gitnest-jdtls-recovery-")
    );
    directories.push(root);
    const projectRoot = join(root, "project");
    const serverPath = join(
      root,
      "recovering-jdtls-server.mjs"
    );
    const statePath = join(root, "attempt.txt");
    const eventsPath = `${statePath}.events`;
    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      serverPath,
      recoveringJdtlsServerSource(),
      "utf8"
    );

    const file = sourceFile(projectRoot, "java");
    const pool = new ExternalLanguageServerPool(1_000);
    try {
      const result = await pool.analyze({
        sessionPrefix: "java-recovery-test",
        workspaceRootPath: projectRoot,
        workspaceFolders: [projectRoot],
        lspDataDirectory: join(root, "lsp"),
        settings: analysisSettings(serverPath, [statePath]),
        documents: [
          {
            file,
            content: "class Source {}"
          }
        ]
      });

      expect(result.statuses).toContainEqual(
        expect.objectContaining({
          language: "java",
          state: "connected",
          message: expect.stringContaining(
            "已自动重建 Java 索引"
          ),
          symbolCount: 1
        })
      );
      const events = (await readFile(eventsPath, "utf8"))
        .trim()
        .split(/\r?\n/)
        .map(
          (line) =>
            JSON.parse(line) as {
              event: string;
              attempt: number;
              data?: string;
            }
        );
      const spawns = events.filter(
        (event) => event.event === "spawn"
      );
      expect(spawns).toHaveLength(2);
      expect(spawns[0]?.data).not.toBe(spawns[1]?.data);
      expect(
        events.findIndex(
          (event) =>
            event.event === "exit" &&
            event.attempt === 1
        )
      ).toBeLessThan(
        events.findIndex(
          (event) =>
            event.event === "spawn" &&
            event.attempt === 2
        )
      );
    } finally {
      await pool.disposeAll();
    }
  });

  it("serializes concurrent analysis for the same Java session", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "gitnest-jdtls-single-flight-")
    );
    directories.push(root);
    const projectRoot = join(root, "project");
    const serverPath = join(
      root,
      "single-flight-jdtls-server.mjs"
    );
    const eventsPath = join(root, "events.jsonl");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      serverPath,
      singleFlightJdtlsServerSource(),
      "utf8"
    );

    const file = sourceFile(projectRoot, "java");
    const pool = new ExternalLanguageServerPool(1_000);
    const input = {
      sessionPrefix: "java-single-flight-test",
      workspaceRootPath: projectRoot,
      workspaceFolders: [projectRoot],
      lspDataDirectory: join(root, "lsp"),
      settings: analysisSettings(serverPath, [eventsPath]),
      documents: [
        {
          file,
          content: "class Source {}"
        }
      ]
    };
    try {
      const results = await Promise.all([
        pool.analyze(input),
        pool.analyze(input)
      ]);

      expect(
        results.every((result) =>
          result.statuses.some(
            (status) =>
              status.language === "java" &&
              status.state === "connected"
          )
        )
      ).toBe(true);
      const events = (await readFile(eventsPath, "utf8"))
        .trim()
        .split(/\r?\n/)
        .map(
          (line) =>
            JSON.parse(line) as { event: string }
        );
      expect(
        events.filter((event) => event.event === "spawn")
      ).toHaveLength(1);
    } finally {
      await pool.disposeAll();
    }
  });

  it("preserves the JDT LS exit reason while waiting for readiness", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "gitnest-jdtls-exit-")
    );
    directories.push(root);
    const serverPath = join(
      root,
      "exiting-jdtls-server.mjs"
    );
    await writeFile(
      serverPath,
      exitingJdtlsServerSource(),
      "utf8"
    );

    const client = new JsonRpcClient(
      process.execPath,
      [serverPath],
      root
    );
    await client.start();
    for (
      let attempt = 0;
      attempt < 100 && client.alive;
      attempt += 1
    ) {
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, 10)
      );
    }

    expect(client.alive).toBe(false);
    await expect(
      client.waitForJavaServiceReady(500)
    ).rejects.toThrow("code=23");
    await client.dispose();
  });
});

async function createJdtlsExtension(
  extensionRoot: string,
  name: string,
  javaVersion: string
): Promise<string> {
  const extensionDirectory = join(extensionRoot, name);
  const javaCommand = join(
    extensionDirectory,
    "jre",
    javaVersion,
    "bin",
    "java.exe"
  );
  const launcher = join(
    extensionDirectory,
    "server",
    "plugins",
    "org.eclipse.equinox.launcher_1.7.100.jar"
  );
  const configuration = join(
    extensionDirectory,
    "server",
    "config_win",
    "config.ini"
  );
  await Promise.all([
    mkdir(join(javaCommand, ".."), { recursive: true }),
    mkdir(join(launcher, ".."), { recursive: true }),
    mkdir(join(configuration, ".."), { recursive: true })
  ]);
  await Promise.all([
    writeFile(javaCommand, "", "utf8"),
    writeFile(launcher, "", "utf8"),
    writeFile(configuration, "", "utf8")
  ]);
  return extensionDirectory;
}

async function createNodeShimFixture(
  contents: string
): Promise<{
  root: string;
  shim: string;
  node: string;
  cli: string;
}> {
  const root = await mkdtemp(
    join(tmpdir(), "gitnest-node-shim-")
  );
  const shim = join(
    root,
    "node_modules",
    ".bin",
    "typescript-language-server.cmd"
  );
  const node = join(dirname(shim), "node.exe");
  const cli = join(
    root,
    "node_modules",
    "typescript-language-server",
    "lib",
    "cli.mjs"
  );
  await Promise.all([
    mkdir(dirname(shim), { recursive: true }),
    mkdir(dirname(cli), { recursive: true })
  ]);
  await Promise.all([
    writeFile(shim, contents, "utf8"),
    writeFile(node, "", "utf8"),
    writeFile(cli, "", "utf8")
  ]);
  return { root, shim, node, cli };
}

function analysisSettings(
  serverPath: string,
  serverArgs: string[] = []
): CodeAnalysisSettings {
  return {
    enabled: true,
    staticFallback: true,
    maxFiles: 100,
    maxFileSizeBytes: 256 * 1_024,
    readConcurrency: 1,
    graphDepth: 3,
    lspTimeoutMs: 1_000,
    ignoreDirectories: [],
    typescript: {
      enabled: false,
      command: "typescript-language-server",
      args: ["--stdio"]
    },
    java: {
      enabled: true,
      command: process.execPath,
      args: [serverPath, ...serverArgs]
    }
  };
}

function typescriptAnalysisSettings(
  serverPath: string
): CodeAnalysisSettings {
  return {
    enabled: true,
    staticFallback: true,
    maxFiles: 100,
    maxFileSizeBytes: 256 * 1_024,
    readConcurrency: 1,
    graphDepth: 3,
    lspTimeoutMs: 1_000,
    ignoreDirectories: [],
    typescript: {
      enabled: true,
      command: process.execPath,
      args: [serverPath]
    },
    java: {
      enabled: false,
      command: "jdtls",
      args: []
    }
  };
}

function hoverLanguageServerSource(): string {
  return String.raw`
let buffer = Buffer.alloc(0);

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(
    "Content-Length: " + body.byteLength + "\r\n\r\n"
  );
  process.stdout.write(body);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function handle(message) {
  if (message.method === "initialize") {
    respond(message.id, {
      capabilities: {
        documentSymbolProvider: true,
        hoverProvider: true,
        callHierarchyProvider: false
      }
    });
    return;
  }
  if (message.method === "textDocument/documentSymbol") {
    respond(message.id, [
      {
        name: "loadUser",
        kind: 12,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 37 }
        },
        selectionRange: {
          start: { line: 0, character: 22 },
          end: { line: 0, character: 30 }
        }
      }
    ]);
    return;
  }
  if (message.method === "textDocument/hover") {
    respond(message.id, {
      contents: [
        {
          language: "typescript",
          value: "function loadUser(): Promise<void>"
        },
        "Loads the user profile.\n\n@param id user identifier"
      ]
    });
    return;
  }
  if (message.method === "textDocument/prepareCallHierarchy") {
    respond(message.id, null);
    return;
  }
  if (message.method === "shutdown") {
    respond(message.id, null);
    return;
  }
  if (message.method === "exit") {
    process.exit(0);
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      return;
    }
    const header = buffer.subarray(0, headerEnd).toString("ascii");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) {
      return;
    }
    const body = buffer
      .subarray(bodyStart, bodyStart + length)
      .toString("utf8");
    buffer = buffer.subarray(bodyStart + length);
    handle(JSON.parse(body));
  }
});
`;
}

function fakeJdtlsServerSource(): string {
  return String.raw`
let buffer = Buffer.alloc(0);
let ready = false;

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(
    "Content-Length: " + body.byteLength + "\r\n\r\n"
  );
  process.stdout.write(body);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function handle(message) {
  if (message.method === "initialize") {
    respond(message.id, {
      capabilities: {
        documentSymbolProvider: true,
        callHierarchyProvider: false
      }
    });
    return;
  }
  if (message.method === "initialized") {
    setTimeout(() => {
      ready = true;
      send({
        jsonrpc: "2.0",
        method: "language/status",
        params: {
          type: "ServiceReady",
          message: "Java workspace ready"
        }
      });
    }, 2200);
    return;
  }
  if (message.method === "textDocument/documentSymbol") {
    if (!ready) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32099,
          message: "Java workspace is not ready"
        }
      });
      return;
    }
    respond(message.id, [
      {
        name: "Source",
        kind: 5,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 15 }
        },
        selectionRange: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 12 }
        }
      }
    ]);
    return;
  }
  if (message.method === "textDocument/prepareCallHierarchy") {
    respond(message.id, null);
    return;
  }
  if (message.method === "shutdown") {
    respond(message.id, null);
    return;
  }
  if (message.method === "exit") {
    process.exit(0);
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      return;
    }
    const header = buffer.subarray(0, headerEnd).toString("ascii");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) {
      return;
    }
    const body = buffer
      .subarray(bodyStart, bodyStart + length)
      .toString("utf8");
    buffer = buffer.subarray(bodyStart + length);
    handle(JSON.parse(body));
  }
});
`;
}

function recoveringJdtlsServerSource(): string {
  return String.raw`
import {
  appendFileSync,
  readFileSync,
  writeFileSync
} from "node:fs";

const attemptPath = process.argv[2];
const eventsPath = attemptPath + ".events";
let attempt = 0;
try {
  attempt = Number(readFileSync(attemptPath, "utf8")) || 0;
} catch {}
attempt += 1;
writeFileSync(attemptPath, String(attempt), "utf8");
const dataIndex = process.argv.indexOf("-data");
const data =
  dataIndex >= 0 ? process.argv[dataIndex + 1] : undefined;
function record(event) {
  appendFileSync(
    eventsPath,
    JSON.stringify({ event, attempt, data }) + "\n",
    "utf8"
  );
}
record("spawn");
process.on("exit", () => record("exit"));

let buffer = Buffer.alloc(0);

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(
    "Content-Length: " + body.byteLength + "\r\n\r\n"
  );
  process.stdout.write(body);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function handle(message) {
  if (message.method === "initialize") {
    if (attempt === 1) {
      process.stderr.write("corrupted Java workspace metadata");
      setTimeout(() => process.exit(23), 25);
      return;
    }
    respond(message.id, {
      capabilities: {
        documentSymbolProvider: true,
        callHierarchyProvider: false
      }
    });
    return;
  }
  if (message.method === "initialized") {
    setTimeout(() => {
      send({
        jsonrpc: "2.0",
        method: "language/status",
        params: {
          type: "ServiceReady",
          message: "Recovered Java workspace"
        }
      });
    }, 25);
    return;
  }
  if (message.method === "textDocument/documentSymbol") {
    respond(message.id, [
      {
        name: "Source",
        kind: 5,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 15 }
        },
        selectionRange: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 12 }
        }
      }
    ]);
    return;
  }
  if (message.method === "textDocument/prepareCallHierarchy") {
    respond(message.id, null);
    return;
  }
  if (message.method === "shutdown") {
    respond(message.id, null);
    return;
  }
  if (message.method === "exit") {
    process.exit(0);
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      return;
    }
    const header = buffer.subarray(0, headerEnd).toString("ascii");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) {
      return;
    }
    const body = buffer
      .subarray(bodyStart, bodyStart + length)
      .toString("utf8");
    buffer = buffer.subarray(bodyStart + length);
    handle(JSON.parse(body));
  }
});
`;
}

function singleFlightJdtlsServerSource(): string {
  return String.raw`
import { appendFileSync } from "node:fs";

const eventsPath = process.argv[2];
appendFileSync(
  eventsPath,
  JSON.stringify({ event: "spawn" }) + "\n",
  "utf8"
);
let buffer = Buffer.alloc(0);

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(
    "Content-Length: " + body.byteLength + "\r\n\r\n"
  );
  process.stdout.write(body);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function handle(message) {
  if (message.method === "initialize") {
    setTimeout(() => {
      respond(message.id, {
        capabilities: {
          documentSymbolProvider: true,
          callHierarchyProvider: false
        }
      });
    }, 150);
    return;
  }
  if (message.method === "initialized") {
    setTimeout(() => {
      send({
        jsonrpc: "2.0",
        method: "language/status",
        params: {
          type: "ServiceReady",
          message: "Java workspace ready"
        }
      });
    }, 25);
    return;
  }
  if (message.method === "textDocument/documentSymbol") {
    setTimeout(() => {
      respond(message.id, [
        {
          name: "Source",
          kind: 5,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 15 }
          },
          selectionRange: {
            start: { line: 0, character: 6 },
            end: { line: 0, character: 12 }
          }
        }
      ]);
    }, 75);
    return;
  }
  if (message.method === "textDocument/prepareCallHierarchy") {
    respond(message.id, null);
    return;
  }
  if (message.method === "shutdown") {
    respond(message.id, null);
    return;
  }
  if (message.method === "exit") {
    process.exit(0);
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      return;
    }
    const header = buffer.subarray(0, headerEnd).toString("ascii");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) {
      return;
    }
    const body = buffer
      .subarray(bodyStart, bodyStart + length)
      .toString("utf8");
    buffer = buffer.subarray(bodyStart + length);
    handle(JSON.parse(body));
  }
});
`;
}

function exitingJdtlsServerSource(): string {
  return String.raw`
function send(message, callback) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(
    "Content-Length: " + body.byteLength + "\r\n\r\n"
  );
  process.stdout.write(body, callback);
}

send(
  {
    jsonrpc: "2.0",
    method: "language/status",
    params: {
      type: "Starting",
      message: "Importing Java projects"
    }
  },
  () => process.exit(23)
);
`;
}

function sourceFile(
  rootPath: string,
  language: AnalysisSourceFile["language"]
): AnalysisSourceFile {
  const absolutePath = join(rootPath, "Source.java");
  return {
    absolutePath,
    canonicalPath: absolutePath.toLocaleLowerCase("en-US"),
    relativePath: "Source.java",
    repositoryId: rootPath,
    worktreeId: rootPath,
    rootPath,
    language,
    size: 1,
    modifiedAtMs: 1,
    fingerprint: "1:1",
    changed: true
  };
}
