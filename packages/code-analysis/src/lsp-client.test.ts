import {
  mkdir,
  mkdtemp,
  link,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  join,
  resolve
} from "node:path";
import { pathToFileURL } from "node:url";

import {
  describe,
  expect,
  it,
  afterEach
} from "vitest";

import {
  ExternalLanguageServerPool as ProductionLanguageServerPool,
  JsonRpcClient,
  orderLanguageServerDocuments,
  parseDocumentSymbols,
  parseIncomingCalls,
  parseReferenceLocations,
  parseWorkspaceSymbols,
  resolveLanguageServerStartupTimeoutMs,
  resolveLanguageServerWorkspaceReadyTimeoutMs,
  resolveLanguageServerWorkspace,
  resolveLspLanguageId,
  resolveNodeCommandShim,
  resolveWindowsEditorJdtls
} from "./lsp-client";
import type {
  AnalysisSourceFile,
  CodeAnalysisSettings,
  LanguageServerCommandSettings,
  LspDocumentSymbol
} from "./model";
import { createLspAnalysisPolicy, lspConfigurationSection } from "./lsp-analysis-policy";
import { AnalysisPathMap, prepareIsolatedAnalysisProject } from "./isolated-analysis-project";
import { spawn, execFileSync } from "node:child_process";

// Protocol fixtures deliberately run without project import. Native isolation
// is exercised separately below; production never selects this adapter.
class ExternalLanguageServerPool extends ProductionLanguageServerPool {
  constructor(idleMs?: number) {
    super(idleMs, async () => undefined);
  }
}

describe("isolated analysis projects", () => {
  it("maps protocol locations without altering code, Markdown, or opaque server data", () => {
    const original = resolve("original");
    const copy = resolve("copy");
    const map = new AnalysisPathMap([{ original, copy }]);
    const uri = pathToFileURL(join(original, "space name.java")).toString();
    const data = { uri, path: join(original, "internal") };
    const input = { uri, text: uri, contents: { uri }, data, textDocument: { uri } };
    const mapped = map.message(input, "toCopy");
    expect(mapped).toEqual({
      uri: pathToFileURL(join(copy, "space name.java")).toString(),
      text: uri, contents: { uri }, data,
      textDocument: { uri: pathToFileURL(join(copy, "space name.java")).toString() }
    });
    expect(map.message(mapped, "toOriginal")).toEqual(input);
    expect(map.path(`${original}-sibling`, "toCopy")).toBe(`${original}-sibling`);
  });

  it("restores project import only with a protected project", () => {
    const policy = createLspAnalysisPolicy("java", "runtime", "project", true);
    expect(lspConfigurationSection(policy.settings, "java.autobuild.enabled")).toBe(true);
    expect(lspConfigurationSection(policy.settings, "java.import.maven.enabled")).toBe(true);
    expect(lspConfigurationSection(policy.settings, "java.import.gradle.enabled")).toBe(true);
    expect(policy.limitation).toBeUndefined();
    expect(createLspAnalysisPolicy("csharp", "runtime", "project", true).unavailableReason).toBeUndefined();
  });

  it("keeps runtime and executable paths outside the admitted project unmapped", () => {
    const workspace = resolve("workspace");
    const source = join(workspace, "repo");
    const copy = resolve("copy");
    const map = new AnalysisPathMap([{ original: workspace, copy }], [source], workspace);
    expect(map.path(workspace, "toCopy")).toBe(copy);
    expect(map.path(join(source, "Source.java"), "toCopy")).toBe(join(copy, "repo", "Source.java"));
    expect(map.path(join(workspace, "runtime", "java.exe"), "toCopy")).toBe(join(workspace, "runtime", "java.exe"));
  });

  it.skipIf(process.platform !== "win32")("refuses overlapping runtime paths and junctions before running a server", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitnest-copy-boundary-"));
    const project = join(root, "project");
    await mkdir(project);
    try {
      const input = { workspaceRootPath: project, workspaceFolders: [project], documents: [] };
      await expect(prepareIsolatedAnalysisProject({ ...input, dataDirectory: join(project, "runtime") }))
        .rejects.toThrow("必须位于原项目目录之外");
      await symlink(project, join(project, "loop"), "junction");
      await expect(prepareIsolatedAnalysisProject({ ...input, dataDirectory: join(root, "runtime") }))
        .rejects.toThrow("符号链接或目录联接");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.skipIf(process.platform !== "win32")("copies working files and prevents parent and child writes to the original", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitnest-native-isolation-"));
    const project = join(root, "project");
    const source = join(project, "Source.java");
    await mkdir(project);
    await writeFile(source, "original");
    let isolated: Awaited<ReturnType<typeof prepareIsolatedAnalysisProject>> | undefined;
    try {
      isolated = await prepareIsolatedAnalysisProject({
        workspaceRootPath: project, workspaceFolders: [project],
        dataDirectory: join(root, "runtime"),
        documents: [{ file: { absolutePath: source }, content: "unsaved snapshot" }]
      });
      expect(await readFile(isolated.toCopy(source), "utf8")).toBe("unsaved snapshot");
      const cache = isolated.environment.GRADLE_USER_HOME!;
      await mkdir(cache, { recursive: true });
      await link(source, join(cache, "linked-original"));
      const script = `
        const fs=require("node:fs"),cp=require("node:child_process");
        const original=${JSON.stringify(source)};
        let denied=false;
        try{fs.writeFileSync(original,"BAD")}catch(e){denied=e.code==="EPERM"||e.code==="EACCES"}
        fs.writeFileSync("own-output","ok");
        fs.writeFileSync("Source.java","modified copy");
        const child=cp.spawnSync(process.execPath,["-e", "require('node:fs').writeFileSync("+JSON.stringify(original)+",'BAD CHILD')"],{encoding:"utf8",timeout:5000});
        console.log(JSON.stringify({denied,childDenied:child.status!==0&&/EPERM|EACCES/.test(child.stderr),cwd:process.cwd()}));
      `;
      const launch = isolated.launch(process.execPath, ["-e", script], project);
      const output = await new Promise<string>((done, reject) => {
        const child = spawn(launch.command, launch.args, {
          cwd: isolated!.toCopy(project), windowsHide: true,
          env: { ...process.env, ...isolated!.environment }, stdio: ["pipe", "pipe", "pipe"]
        });
        let stdout = "", stderr = "";
        child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
        child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
        child.once("error", reject);
        child.once("exit", (code) => code === 0 ? done(stdout) : reject(new Error(stderr)));
      });
      expect(JSON.parse(output)).toEqual({ denied: true, childDenied: true, cwd: isolated.toCopy(project) });
      expect(await readFile(source, "utf8")).toBe("original");
      expect(await readFile(join(isolated.toCopy(project), "own-output"), "utf8")).toBe("ok");
      expect(await readFile(isolated.toCopy(source), "utf8")).toBe("modified copy");
      // MIC protection is a precondition, not an assumption about every disk.
      execFileSync("icacls.exe", [project, "/setintegritylevel", "(OI)(CI)L"], { windowsHide: true, stdio: "pipe" });
      const refused = await new Promise<{ code: number | null; stderr: string }>((done, reject) => {
        const child = spawn(launch.command, launch.args, {
          cwd: isolated!.toCopy(project), windowsHide: true,
          env: { ...process.env, ...isolated!.environment }, stdio: ["pipe", "pipe", "pipe"]
        });
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
        child.once("error", reject);
        child.once("exit", (code) => done({ code, stderr }));
      });
      expect(refused.code).toBe(127);
      expect(refused.stderr).toContain("Original has no Medium write boundary");
      expect(await readFile(source, "utf8")).toBe("original");
    } finally {
      await isolated?.dispose();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it.skipIf(process.platform !== "win32")("terminates detached build descendants when the analysis host is cancelled", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitnest-job-cleanup-"));
    const project = join(root, "project");
    await mkdir(project);
    const isolated = await prepareIsolatedAnalysisProject({
      workspaceRootPath: project, workspaceFolders: [project],
      dataDirectory: join(root, "runtime"), documents: []
    });
    let descendant: number | undefined;
    const script = `
      const child=require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore",detached:true});
      console.log(child.pid);setInterval(()=>{},1000);
    `;
    const launch = isolated.launch(process.execPath, ["-e", script], project);
    const host = spawn(launch.command, launch.args, {
      cwd: isolated.toCopy(project), windowsHide: true,
      env: { ...process.env, ...isolated.environment }, stdio: ["pipe", "pipe", "pipe"]
    });
    const exited = new Promise<void>((done) => host.once("exit", () => done()));
    try {
      descendant = await new Promise<number>((done, reject) => {
        let stdout = "", stderr = "";
        const timer = setTimeout(() => reject(new Error(`Child startup timed out: ${stderr}`)), 5000);
        host.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
          if (stdout.includes("\n")) { clearTimeout(timer); done(Number(stdout.trim())); }
        });
        host.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
        host.once("error", (error) => { clearTimeout(timer); reject(error); });
      });
      expect(Number.isSafeInteger(descendant)).toBe(true);
      const alive = () => { try { process.kill(descendant!, 0); return true; } catch { return false; } };
      expect(alive()).toBe(true);
      host.kill();
      await exited;
      for (let attempt = 0; attempt < 50 && alive(); attempt++) {
        await new Promise<void>((done) => setTimeout(done, 20));
      }
      expect(alive()).toBe(false);
    } finally {
      host.kill();
      await exited;
      if (descendant) { try { process.kill(descendant); } catch { /* Already killed by job. */ } }
      await isolated.dispose();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("analysis-only language server policies", () => {
  it("refuses a custom Java workspace that may contain previously imported build projects", async () => {
    const pool = new ExternalLanguageServerPool();
    try {
      const result = await pool.analyze({
        sessionPrefix: "unsafe-java-data",
        workspaceRootPath: resolve("project"),
        workspaceFolders: [resolve("project")],
        lspDataDirectory: resolve("runtime"),
        settings: analysisSettings("must-not-start.mjs", ["-data", resolve("shared-java-workspace")]),
        documents: [{ file: sourceFile(resolve("project"), "java"), content: "class Source {}" }]
      });
      expect(result.statuses).toContainEqual(expect.objectContaining({
        language: "java", state: "failed", message: expect.stringContaining("请移除自定义 -data")
      }));
    } finally {
      await pool.disposeAll();
    }
  });

  it("keeps Rust build output outside the project and prevents Cargo execution paths", () => {
    const policy = createLspAnalysisPolicy("rust", resolve("runtime/lsp"), resolve("project"));
    expect(policy.initializationOptions).toMatchObject({
      checkOnSave: false,
      cargo: {
        buildScripts: { enable: false, rebuildOnSave: false },
        extraArgs: ["--frozen"]
      },
      procMacro: { enable: false }
    });
    expect(policy.environment.CARGO_TARGET_DIR).toMatch(/runtime[\\/]lsp[\\/]rust[\\/]/);
    expect(lspConfigurationSection(policy.settings, "rust-analyzer.cargo.targetDir"))
      .toBe(policy.environment.CARGO_TARGET_DIR);
    expect(createLspAnalysisPolicy("rust", resolve("runtime/lsp"), resolve("another-project"))
      .environment.CARGO_TARGET_DIR).not.toBe(policy.environment.CARGO_TARGET_DIR);
  });

  it("preserves enforced settings for whole, nested, and unknown configuration sections", () => {
    const { settings } = createLspAnalysisPolicy("java", "runtime", "project");
    expect(lspConfigurationSection(settings, undefined)).toEqual(settings);
    expect(lspConfigurationSection(settings, "java.autobuild.enabled")).toBe(false);
    expect(lspConfigurationSection(settings, "java.import.gradle.enabled")).toBe(false);
    expect(lspConfigurationSection(settings, "java.import.maven.enabled")).toBe(false);
    expect(lspConfigurationSection(settings, "java.import.exclusions")).toEqual(["**"]);
    expect(lspConfigurationSection(settings, "unknown")).toBeNull();
    expect(lspConfigurationSection(settings, "__proto__")).toBeNull();
    expect(createLspAnalysisPolicy("go", "runtime", "project").initializationOptions)
      .toEqual({ buildFlags: ["-mod=readonly"] });
    expect(createLspAnalysisPolicy("typescript", "runtime", "project").initializationOptions)
      .toEqual({ disableAutomaticTypingAcquisition: true });
  });

  it.each(["kotlin", "csharp"] as const)(
    "does not launch %s importers that can write to the project",
    async (language) => {
      const pool = new ExternalLanguageServerPool();
      const settings = optionalLanguageAnalysisSettings("python", "must-not-start.mjs");
      settings.python!.enabled = false;
      settings[language] = serverSettings({
        enabled: true, command: "must-not-start", args: []
      });
      try {
        const result = await pool.analyze({
          sessionPrefix: "blocked-importer",
          workspaceRootPath: resolve("project"),
          workspaceFolders: [resolve("project")],
          lspDataDirectory: resolve("runtime"),
          settings,
          documents: [{ file: sourceFile(resolve("project"), language), content: "source" }]
        });
        expect(result.statuses).toContainEqual(expect.objectContaining({
          language, state: "unavailable", message: expect.stringContaining("尚未隔离其项目写入")
        }));
        expect(result.warnings).toContainEqual(expect.stringContaining("已使用内置分析器"));
      } finally {
        await pool.disposeAll();
      }
    }
  );
});

describe("language server message identity and coverage", () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
  });

  async function serverFixture(mode: string) {
    const root = await mkdtemp(
      join(tmpdir(), "gitnest-lsp-coverage-")
    );
    directories.push(root);
    const serverPath = join(root, "server.cjs");
    await writeFile(serverPath, coverageLanguageServerSource());
    return { root, serverPath, mode };
  }

  it("answers a server request sharing the pending client's numeric id", async () => {
    const fixture = await serverFixture("overlap");
    const client = new JsonRpcClient(
      process.execPath,
      [fixture.serverPath, fixture.mode],
      fixture.root
    );
    try {
      await client.start();
      await expect(
        client.request("initialize", {}, 1_000)
      ).resolves.toMatchObject({
        capabilities: { documentSymbolProvider: true }
      });
    } finally {
      await client.terminate();
    }
  });

  it("decodes fragmented UTF-8 and coalesced responses across buffer growth and reuse", async () => {
    const fixture = await serverFixture("fragmented");
    const client = new JsonRpcClient(
      process.execPath,
      [fixture.serverPath, fixture.mode],
      fixture.root
    );
    try {
      await client.start();
      const responses = await Promise.all([
        client.request("fragmented", {}, 2_000),
        client.request("fragmented", {}, 2_000),
        client.request("fragmented", {}, 2_000)
      ]);
      expect(responses).toEqual([
        "中文🙂".repeat(50_000),
        "second",
        "third"
      ]);
      await expect(
        client.request("initialize", {}, 1_000)
      ).resolves.toHaveProperty("capabilities");
    } finally {
      await client.terminate();
    }
  });

  it("retains an unsupported call hierarchy result throughout a reused session", async () => {
    const fixture = await serverFixture(
      "hierarchy-unsupported"
    );
    const settings = typescriptAnalysisSettings(
      fixture.serverPath
    );
    settings.typescript.args.push(fixture.mode);
    const file = sourceFile(fixture.root, "typescript");
    const pool = new ExternalLanguageServerPool();
    try {
      const names: string[] = [];
      for (let pass = 0; pass < 3; pass += 1) {
        const result = await pool.analyze({
          sessionPrefix: "unsupported",
          workspaceRootPath: fixture.root,
          workspaceFolders: [fixture.root],
          lspDataDirectory: join(fixture.root, "lsp"),
          settings,
          documents: [{ file, content: "function f() {}" }]
        });
        names.push(
          result.symbolsByPath.get(file.canonicalPath)![0]!
            .name
        );
        expect(result.statuses[0]).toMatchObject({
          state: "connected",
          semanticCoverage: "partial",
          enrichmentStoppedEarly: false
        });
      }
      // The server names each document response with its observed probe count.
      expect(names).toEqual([
        "probes-0",
        "probes-1",
        "probes-1"
      ]);
    } finally {
      await pool.disposeAll();
    }
  });

  it.each([
    ["oversized-header", "LSP 消息头超过安全上限"],
    ["missing-length", "LSP 消息缺少有效的 Content-Length"]
  ] as const)("rejects an invalid fragmented %s", async (mode, message) => {
    const fixture = await serverFixture(mode);
    const client = new JsonRpcClient(
      process.execPath,
      [fixture.serverPath, fixture.mode],
      fixture.root
    );
    try {
      await client.start();
      await expect(
        client.request("initialize", {}, 1_000)
      ).rejects.toThrow(message);
    } finally {
      await client.terminate();
    }
  });

  it.each([
    ["reference-error", "partial"],
    ["reference-truncated", "partial"],
    ["incoming-error", "partial"],
    ["incoming-unsupported", "partial"],
    ["type-error", "partial"],
    ["reference-exact", "complete"],
    ["reference-duplicates", "complete"]
  ] as const)(
    "reports semantic coverage for %s",
    async (mode, semanticCoverage) => {
      const fixture = await serverFixture(mode);
      const settings = typescriptAnalysisSettings(
        fixture.serverPath
      );
      settings.typescript.args.push(mode);
      settings.typescript.maxReferencesPerSymbol = 1;
      const pool = new ExternalLanguageServerPool();
      try {
        const input = {
          sessionPrefix: "coverage",
          workspaceRootPath: fixture.root,
          workspaceFolders: [fixture.root],
          lspDataDirectory: join(fixture.root, "lsp"),
          settings,
          documents: [{
            file: sourceFile(fixture.root, "typescript"),
            content: "const VALUE = 1;"
          }]
        };
        for (let pass = 0; pass < 2; pass += 1) {
          const result = await pool.analyze(input);
          expect(
            result.statuses.find(
              (status) => status.language === "typescript"
            )
          ).toMatchObject({
            state: "connected",
            semanticCoverage,
            enrichmentStoppedEarly: false
          });
        }
      } finally {
        await pool.disposeAll();
      }
    }
  );
});

function coverageLanguageServerSource(): string {
  return String.raw`
const mode = process.argv[2];
let buffer = Buffer.alloc(0);
let hierarchyProbes = 0;
const fragmentedIds = [];
const range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 5 }
};
const capabilities = {
  documentSymbolProvider: true,
  referencesProvider: true,
  callHierarchyProvider: true,
  typeHierarchyProvider: true,
  implementationProvider: true
};
function send(message) {
  const body = JSON.stringify({ jsonrpc: "2.0", ...message });
  process.stdout.write(
    "Content-Length: " + Buffer.byteLength(body) + "\r\n\r\n" + body
  );
}
function handle(message) {
  const { id, method, params } = message;
  if (method === "exit") return process.exit(0);
  if (id === undefined) return;
  if (mode === "oversized-header" || mode === "missing-length") {
    const header = mode === "oversized-header"
      ? "X-Test: " + "x".repeat(65537)
      : "X-Test: missing";
    process.stdout.write(header.slice(0, 5));
    setTimeout(() => process.stdout.write(header.slice(5) + "\r\n\r\n"), 5);
    return;
  }
  if (mode === "fragmented" && method === "fragmented") {
    fragmentedIds.push(id);
    if (fragmentedIds.length < 3) return;
    const values = ["中文🙂".repeat(50000), "second", "third"];
    const output = Buffer.concat(fragmentedIds.map((responseId, index) => {
      const body = JSON.stringify({ jsonrpc: "2.0", id: responseId, result: values[index] });
      return Buffer.from("Content-Length: " + Buffer.byteLength(body) + "\r\n\r\n" + body);
    }));
    const sizes = [1, 2, 31, 8191, 3, 65537];
    let offset = 0;
    let part = 0;
    function writePart() {
      const size = sizes[part++ % sizes.length];
      process.stdout.write(output.subarray(offset, offset + size));
      offset += size;
      if (offset < output.length) setImmediate(writePart);
    }
    writePart();
    return;
  }
  if (mode === "overlap" && method === "initialize") {
    return send({
      id, method: "workspace/configuration",
      params: { items: [{ section: "test" }] }
    });
  }
  if (method === "initialize" || (mode === "overlap" && !method)) {
    return send({ id, result: { capabilities } });
  }
  if (method === "textDocument/documentSymbol") {
    return send({ id, result: [{
      name: mode === "hierarchy-unsupported" ? "probes-" + hierarchyProbes : "VALUE",
      kind: mode.startsWith("incoming-") || mode === "hierarchy-unsupported" ? 12 : mode === "type-error" ? 5 : 14,
      range, selectionRange: range
    }] });
  }
  if (mode === "hierarchy-unsupported" && method === "textDocument/prepareCallHierarchy") {
    hierarchyProbes += 1;
    return send({ id, error: { code: -32601, message: "Method not found" } });
  }
  if (
    (mode === "reference-error" && method === "textDocument/references") ||
    (mode.startsWith("incoming-") && method === "callHierarchy/incomingCalls") ||
    (mode === "type-error" && method === "textDocument/prepareTypeHierarchy")
  ) {
    return send({
      id, error: {
        code: mode === "incoming-unsupported" ? -32601 : -32603,
        message: "request failed"
      }
    });
  }
  if (mode.startsWith("incoming-") && method === "textDocument/prepareCallHierarchy") {
    return send({ id, result: [{
      name: "VALUE", kind: 12, uri: params.textDocument.uri,
      range, selectionRange: range
    }] });
  }
  if (method === "textDocument/references") {
    const reference = {
      uri: params.textDocument.uri,
      range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } }
    };
    const second = mode === "reference-duplicates" ? reference : {
      ...reference,
      range: { start: { line: 3, character: 0 }, end: { line: 3, character: 5 } }
    };
    return send({
      id,
      result: mode === "reference-truncated" || mode === "reference-duplicates"
        ? [reference, second] : [reference]
    });
  }
  send({ id, result: null });
}
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const end = buffer.indexOf("\r\n\r\n");
    if (end < 0) return;
    const size = Number(
      buffer.subarray(0, end).toString().match(/Content-Length: (\d+)/i)[1]
    );
    if (buffer.length < end + 4 + size) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + size));
    buffer = buffer.subarray(end + 4 + size);
    handle(message);
  }
});
`;
}

describe("parseDocumentSymbols budgets", () => {
  it("retains detail and the full selection identity used for overloaded symbols", () => {
    const parsed = parseDocumentSymbols([
      {
        ...lspSymbol("run"),
        detail: "void run(String value)",
        selectionRange: {
          start: { line: 4, character: 7 },
          end: { line: 4, character: 10 }
        },
        range: {
          start: { line: 4, character: 2 },
          end: { line: 6, character: 3 }
        }
      }
    ]);

    expect(parsed.symbols[0]).toMatchObject({
      name: "run",
      detail: "void run(String value)",
      line: 5,
      character: 7,
      endLine: 7,
      endCharacter: 3
    });
  });

  it("honors a configured per-document symbol limit", () => {
    const parsed = parseDocumentSymbols(
      Array.from({ length: 12 }, (_, index) =>
        lspSymbol(`symbol-${index}`)
      ),
      10
    );

    expect(parsed.symbols).toHaveLength(10);
    expect(parsed.truncated).toBe(true);
  });

  it("caps symbol count, depth, and retained names", () => {
    const flat = parseDocumentSymbols(
      Array.from({ length: 5_002 }, (_, index) =>
        lspSymbol(`${"x".repeat(1_100)}-${index}`)
      )
    );

    expect(flat.symbols).toHaveLength(5_000);
    expect(flat.truncated).toBe(true);
    expect(flat.symbols[0]?.name).toHaveLength(1_024);

    let nested: Record<string, unknown> =
      lspSymbol("leaf");
    for (let depth = 0; depth < 70; depth += 1) {
      nested = lspSymbol(`level-${depth}`, [nested]);
    }
    const deep = parseDocumentSymbols([nested]);

    expect(countParsedSymbols(deep.symbols)).toBe(65);
    expect(deep.truncated).toBe(true);
  });
});

describe("parseWorkspaceSymbols", () => {
  it("adds only allowed symbols from documents that were not already analyzed", () => {
    const firstPath = resolve(
      "fixtures",
      "workspace-symbols",
      "First.java"
    );
    const secondPath = resolve(
      "fixtures",
      "workspace-symbols",
      "Second.java"
    );
    const canonical = (path: string) =>
      process.platform === "win32"
        ? path.toLocaleLowerCase("en-US")
        : path;
    const parsed = parseWorkspaceSymbols(
      [
        workspaceSymbol("First", firstPath, 0),
        workspaceSymbol("Second", secondPath, 4),
        workspaceSymbol(
          "External",
          resolve("outside", "External.java"),
          0
        )
      ],
      new Set([canonical(firstPath), canonical(secondPath)]),
      new Set([canonical(firstPath)]),
      10
    );

    expect(parsed.symbolCount).toBe(1);
    expect(parsed.truncated).toBe(false);
    expect(
      parsed.symbolsByPath.get(canonical(secondPath))
    ).toEqual([
      expect.objectContaining({
        name: "Second",
        line: 5,
        kind: 5
      })
    ]);
  });

  it("reports truncation when the workspace symbol budget is exhausted", () => {
    const filePath = resolve(
      "fixtures",
      "workspace-symbols",
      "Many.java"
    );
    const canonicalPath =
      process.platform === "win32"
        ? filePath.toLocaleLowerCase("en-US")
        : filePath;
    const parsed = parseWorkspaceSymbols(
      [
        workspaceSymbol("One", filePath, 0),
        workspaceSymbol("Two", filePath, 1)
      ],
      new Set([canonicalPath]),
      new Set(),
      1
    );

    expect(parsed.symbolCount).toBe(1);
    expect(parsed.truncated).toBe(true);
  });
});

describe("parseIncomingCalls", () => {
  it("retains caller identity, declaration, and call-site locations", () => {
    const sourcePath = resolve(
      "fixtures",
      "incoming-calls",
      "Caller.ts"
    );

    expect(
      parseIncomingCalls([
        {
          from: {
            name: "caller",
            uri: pathToFileURL(sourcePath).href,
            range: {
              start: { line: 2, character: 0 },
              end: { line: 9, character: 1 }
            },
            selectionRange: {
              start: { line: 3, character: 16 },
              end: { line: 3, character: 22 }
            }
          },
          fromRanges: [
            {
              start: { line: 7, character: 9 },
              end: { line: 7, character: 15 }
            }
          ]
        }
      ])
    ).toEqual([
      {
        name: "caller",
        line: 8,
        sourceCanonicalPath:
          process.platform === "win32"
            ? sourcePath.toLocaleLowerCase("en-US")
            : sourcePath,
        sourceLine: 4
      }
    ]);
  });
});

describe("parseReferenceLocations", () => {
  it("honors a configured per-symbol reference limit", () => {
    const sourcePath = resolve(
      "fixtures",
      "references",
      "Caller.java"
    );
    const locations = Array.from({ length: 4 }, (_, index) => ({
      uri: pathToFileURL(sourcePath).href,
      range: {
        start: { line: index, character: 3 },
        end: { line: index, character: 8 }
      }
    }));

    expect(parseReferenceLocations(locations, 2)).toHaveLength(2);
  });

  it("normalizes, deduplicates, and rejects malformed locations", () => {
    const sourcePath = resolve(
      "fixtures",
      "references",
      "ProfileServiceImpl.java"
    );
    const location = {
      uri: pathToFileURL(sourcePath).href,
      range: {
        start: { line: 281, character: 37 },
        end: { line: 281, character: 47 }
      }
    };

    expect(
      parseReferenceLocations([
        location,
        location,
        {
          uri: "jdt://contents/runtime/ProfileDef.class",
          range: location.range
        },
        {
          uri: pathToFileURL(sourcePath).href,
          range: {
            start: { line: -1, character: 0 }
          }
        }
      ])
    ).toEqual([
      {
        sourceCanonicalPath:
          process.platform === "win32"
            ? sourcePath.toLocaleLowerCase("en-US")
            : sourcePath,
        line: 282,
        character: 37
      }
    ]);
  });
});

describe("orderLanguageServerDocuments", () => {
  it("prioritizes explicit and changed files, then production paths deterministically", () => {
    const root = resolve("fixtures", "lsp-ordering");
    const document = (
      relativePath: string,
      changed = false
    ) => {
      const file = sourceFile(root, "java");
      const absolutePath = resolve(root, relativePath);
      return {
        content: "",
        file: {
          ...file,
          absolutePath,
          canonicalPath:
            process.platform === "win32"
              ? absolutePath.toLocaleLowerCase("en-US")
              : absolutePath,
          relativePath,
          changed
        }
      };
    };
    const priority = document(
      "web/src/test/java/PriorityTest.java"
    );
    const changed = document(
      "web/src/test/java/ChangedTest.java",
      true
    );
    const productionCore = document(
      "core/src/main/java/ProfileDef.java"
    );
    const productionWeb = document(
      "web/src/main/java/ProfileServiceImpl.java"
    );
    const test = document("web/src/test/java/OtherTest.java");

    expect(
      orderLanguageServerDocuments(
        [
          test,
          productionWeb,
          changed,
          productionCore,
          priority
        ],
        new Set([priority.file.canonicalPath])
      ).map(({ file }) => file.relativePath)
    ).toEqual([
      priority.file.relativePath,
      changed.file.relativePath,
      productionCore.file.relativePath,
      productionWeb.file.relativePath,
      test.file.relativePath
    ]);
  });
});

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
    await mkdir(join(newest, "lombok"));
    await writeFile(join(newest, "lombok/lombok-1.18.9.jar"), "");
    await writeFile(join(newest, "lombok/lombok-1.18.39.jar"), "");

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
        `-javaagent:${join(newest, "lombok/lombok-1.18.39.jar")}`,
        "-Djava.import.generatesMetadataFilesAtProjectRoot=false",
        "-jar",
        resolve(
          newest,
          "server/plugins/org.eclipse.equinox.launcher_1.7.100.jar"
        ),
        "-data",
        "C:\\GitNest\\jdtls"
      ])
    );
    expect(launch!.args.findIndex((arg) => arg.startsWith("-javaagent:")))
      .toBeLessThan(launch!.args.indexOf("-jar"));
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

function lspSymbol(
  name: string,
  children: Record<string, unknown>[] = []
): Record<string, unknown> {
  return {
    name,
    kind: 12,
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 }
    },
    children
  };
}

function workspaceSymbol(
  name: string,
  path: string,
  line: number
): Record<string, unknown> {
  return {
    name,
    kind: 5,
    containerName: "example",
    location: {
      uri: pathToFileURL(path).href,
      range: {
        start: { line, character: 0 },
        end: { line, character: name.length }
      }
    }
  };
}

function countParsedSymbols(
  symbols: LspDocumentSymbol[]
): number {
  return symbols.reduce(
    (total, symbol) =>
      total + 1 + countParsedSymbols(symbol.children),
    0
  );
}

function serverSettings(
  input: Pick<
    LanguageServerCommandSettings,
    "enabled" | "command" | "args"
  > &
    Partial<LanguageServerCommandSettings>
): LanguageServerCommandSettings {
  return {
    maxDocuments: 120,
    maxSymbolsPerDocument: 5_000,
    maxCallHierarchyRequests: 50,
    maxReferenceRequests: 50,
    maxDocumentationRequests: 50,
    maxReferencesPerSymbol: 500,
    ...input
  };
}

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
  it("uses explicit LSP language ids for every supported source language", () => {
    expect(
      (
        [
          "typescript",
          "javascript",
          "vue",
          "java",
          "python",
          "go",
          "kotlin",
          "csharp",
          "rust"
        ] as const
      ).map((language) => [
        language,
        resolveLspLanguageId(language)
      ])
    ).toEqual([
      ["typescript", "typescript"],
      ["javascript", "javascript"],
      ["vue", "vue"],
      ["java", "java"],
      ["python", "python"],
      ["go", "go"],
      ["kotlin", "kotlin"],
      ["csharp", "csharp"],
      ["rust", "rust"]
    ]);
  });

  it("routes Vue and optional languages to independent servers", async () => {
    const rootPath = resolve("fixtures", "language-routing");
    const disabled = serverSettings({
      enabled: false,
      command: "disabled-language-server",
      args: [] as string[]
    });
    const settings: CodeAnalysisSettings = {
      enabled: true,
      staticFallback: true,
      maxFiles: 100,
      maxTotalSourceBytes: 128 * 1_024 * 1_024,
      maxGraphNodes: 30_000,
      maxGraphEdges: 100_000,
      maxRequestChains: 5_000,
      maxDiagnostics: 2_000,
      maxFileSizeBytes: 256 * 1_024,
      readConcurrency: 1,
      graphDepth: 3,
      lspTimeoutMs: 1_000,
      ignoreDirectories: [],
      typescript: { ...disabled },
      java: { ...disabled },
      vue: { ...disabled },
      python: { ...disabled },
      go: { ...disabled },
      kotlin: { ...disabled },
      csharp: { ...disabled },
      rust: { ...disabled }
    };
    const languages = [
      "typescript",
      "vue",
      "java",
      "python",
      "go",
      "kotlin",
      "csharp",
      "rust"
    ] as const;
    const pool = new ExternalLanguageServerPool(1_000);

    const result = await pool.analyze({
      sessionPrefix: "language-routing-test",
      workspaceRootPath: rootPath,
      workspaceFolders: [rootPath],
      lspDataDirectory: join(rootPath, ".lsp"),
      settings,
      documents: languages.map((language) => ({
        file: sourceFile(
          join(rootPath, language),
          language
        ),
        content: "source"
      }))
    });

    expect(
      result.statuses.map((status) => [
        status.language,
        status.state
      ])
    ).toEqual(
      languages.map((language) => [language, "disabled"])
    );

    const vueOnly = await pool.analyze({
      sessionPrefix: "vue-routing-test",
      workspaceRootPath: rootPath,
      workspaceFolders: [rootPath],
      lspDataDirectory: join(rootPath, ".lsp"),
      settings: {
        ...settings,
        typescript: {
          ...settings.typescript,
          enabled: true,
          command: "must-not-be-started-for-vue",
          args: []
        }
      },
      documents: [
        {
          file: sourceFile(rootPath, "vue"),
          content: "<template />"
        }
      ]
    });

    expect(vueOnly.statuses).toContainEqual(
      expect.objectContaining({
        language: "typescript",
        state: "disabled",
        message: "当前范围没有对应语言文件。"
      })
    );
    expect(vueOnly.statuses).toContainEqual(
      expect.objectContaining({
        language: "vue",
        state: "disabled"
      })
    );
  });

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

  it("gives cold starts and Java workspace imports separate time budgets", () => {
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
    ).toBe(30_000);
    expect(
      resolveLanguageServerStartupTimeoutMs(
        "python",
        45_000
      )
    ).toBe(45_000);
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

  it("requests project references for constant symbols without including declarations", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "gitnest-lsp-references-")
    );
    directories.push(root);
    const projectRoot = join(root, "project");
    const serverPath = join(
      root,
      "references-language-server.mjs"
    );
    const eventsPath = join(root, "events.jsonl");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      serverPath,
      referencesLanguageServerSource(),
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
    const settings = typescriptAnalysisSettings(serverPath);
    settings.typescript.args.push(eventsPath);
    const pool = new ExternalLanguageServerPool(1_000);

    try {
      const result = await pool.analyze({
        sessionPrefix: "typescript-references-test",
        workspaceRootPath: projectRoot,
        workspaceFolders: [projectRoot],
        lspDataDirectory: join(root, "lsp"),
        settings,
        documents: [
          {
            file,
            content: [
              "export const OPEN_GUIDE = 1;",
              "export const enabled = OPEN_GUIDE === 1;"
            ].join("\n")
          }
        ]
      });
      const symbol =
        result.symbolsByPath.get(file.canonicalPath)?.[0];

      expect(symbol).toMatchObject({
        name: "OPEN_GUIDE",
        kind: 14,
        references: [
          {
            sourceCanonicalPath: file.canonicalPath,
            line: 2,
            character: 23
          }
        ]
      });
      expect(result.statuses).toContainEqual(
        expect.objectContaining({
          language: "typescript",
          state: "connected",
          message: expect.stringContaining(
            "1 条引用关系"
          )
        })
      );
      const events = (await readFile(eventsPath, "utf8"))
        .trim()
        .split(/\r?\n/u)
        .map(
          (line) =>
            JSON.parse(line) as {
              method: string;
              includeDeclaration?: boolean;
            }
        );
      expect(events).toContainEqual({
        method: "textDocument/references",
        includeDeclaration: false
      });
    } finally {
      await pool.disposeAll();
    }
  });

  it("continues reference enrichment after one request times out", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "gitnest-lsp-timeout-isolation-")
    );
    directories.push(root);
    const projectRoot = join(root, "project");
    const serverPath = join(
      root,
      "timeout-isolation-language-server.mjs"
    );
    const eventsPath = join(root, "events.jsonl");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      serverPath,
      timeoutIsolationLanguageServerSource(),
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
    const settings = typescriptAnalysisSettings(serverPath);
    settings.lspTimeoutMs = 120;
    settings.typescript.args.push(eventsPath);
    settings.typescript.maxCallHierarchyRequests = 0;
    settings.typescript.maxTypeHierarchyRequests = 10;
    settings.typescript.maxReferenceRequests = 3;
    settings.typescript.maxDocumentationRequests = 0;
    const pool = new ExternalLanguageServerPool(1_000);

    try {
      const result = await pool.analyze({
        sessionPrefix: "typescript-timeout-isolation-test",
        workspaceRootPath: projectRoot,
        workspaceFolders: [projectRoot],
        lspDataDirectory: join(root, "lsp"),
        settings,
        documents: [
          {
            file,
            content: [
              "function first() {}",
              "function second() {}",
              "function third() {}"
            ].join("\n")
          }
        ]
      });
      const symbols =
        result.symbolsByPath.get(file.canonicalPath) ?? [];

      expect(symbols[0]).toMatchObject({
        name: "first",
        references: []
      });
      expect(symbols[1]).toMatchObject({
        name: "second",
        references: [expect.any(Object)]
      });
      expect(symbols[2]).toMatchObject({
        name: "third",
        references: [expect.any(Object)]
      });
      expect(result.statuses).toContainEqual(
        expect.objectContaining({
          language: "typescript",
          state: "connected",
          enrichmentStoppedEarly: false,
          message: expect.stringContaining(
            "2 条引用关系"
          )
        })
      );
      const events = (await readFile(eventsPath, "utf8"))
        .trim()
        .split(/\r?\n/u)
        .map(
          (line) =>
            JSON.parse(line) as {
              method: string;
              line: number;
            }
        );
      expect(events).toEqual([
        {
          method: "textDocument/references",
          line: 0
        },
        {
          method: "textDocument/references",
          line: 1
        },
        {
          method: "textDocument/references",
          line: 2
        }
      ]);
    } finally {
      await pool.disposeAll();
    }
  });

  it("isolates one documentSymbol timeout and requests later documents concurrently", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "gitnest-lsp-document-isolation-")
    );
    directories.push(root);
    const projectRoot = join(root, "project");
    const serverPath = join(
      root,
      "document-isolation-language-server.mjs"
    );
    const eventsPath = join(root, "events.jsonl");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      serverPath,
      documentIsolationLanguageServerSource(),
      "utf8"
    );
    const files = ["A.ts", "B.ts", "C.ts"].map(
      (relativePath): AnalysisSourceFile => {
        const absolutePath = join(
          projectRoot,
          relativePath
        );
        return {
          ...sourceFile(projectRoot, "typescript"),
          absolutePath,
          canonicalPath:
            process.platform === "win32"
              ? absolutePath.toLocaleLowerCase("en-US")
              : absolutePath,
          relativePath
        };
      }
    );
    const settings = typescriptAnalysisSettings(serverPath);
    settings.readConcurrency = 2;
    settings.lspTimeoutMs = 150;
    settings.typescript.args.push(eventsPath);
    settings.typescript.maxCallHierarchyRequests = 0;
    settings.typescript.maxTypeHierarchyRequests = 10;
    settings.typescript.maxReferenceRequests = 0;
    settings.typescript.maxDocumentationRequests = 0;
    const pool = new ExternalLanguageServerPool(1_000);

    try {
      const result = await pool.analyze({
        sessionPrefix: "typescript-document-isolation-test",
        workspaceRootPath: projectRoot,
        workspaceFolders: [projectRoot],
        lspDataDirectory: join(root, "lsp"),
        settings,
        documents: files.map((file) => ({
          file,
          content: `export const ${file.relativePath[0]} = 1;`
        }))
      });

      expect(
        result.symbolsByPath.has(files[0]!.canonicalPath)
      ).toBe(true);
      expect(
        result.symbolsByPath.has(files[1]!.canonicalPath)
      ).toBe(false);
      expect(
        result.symbolsByPath.has(files[2]!.canonicalPath)
      ).toBe(true);
      expect(result.statuses).toContainEqual(
        expect.objectContaining({
          language: "typescript",
          state: "connected",
          semanticCoverage: "partial",
          documentsTotal: 3,
          documentsAnalyzed: 2,
          skippedDocuments: 1,
          failedDocuments: 1,
          message: expect.stringMatching(
            /1 个文件的 documentSymbol 请求失败.*其余文件仍继续分析/u
          )
        })
      );
      const events = (await readFile(eventsPath, "utf8"))
        .trim()
        .split(/\r?\n/u)
        .map(
          (line) =>
            JSON.parse(line) as {
              file: string;
              arrivedWhileBPending: boolean;
            }
        );
      expect(events).toContainEqual({
        file: "C",
        arrivedWhileBPending: true
      });
    } finally {
      await pool.disposeAll();
    }
  });

  it("collects inheritance and override relations from type hierarchy and implementation requests", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "gitnest-lsp-type-relations-")
    );
    directories.push(root);
    const projectRoot = join(root, "project");
    const serverPath = join(
      root,
      "type-relations-language-server.mjs"
    );
    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      serverPath,
      typeRelationsLanguageServerSource(),
      "utf8"
    );
    const createFile = (
      relativePath: string
    ): AnalysisSourceFile => {
      const absolutePath = join(projectRoot, relativePath);
      return {
        ...sourceFile(projectRoot, "typescript"),
        absolutePath,
        canonicalPath:
          process.platform === "win32"
            ? absolutePath.toLocaleLowerCase("en-US")
            : absolutePath,
        relativePath
      };
    };
    const base = createFile("Base.ts");
    const child = createFile("Child.ts");
    const settings = typescriptAnalysisSettings(serverPath);
    settings.typescript.maxCallHierarchyRequests = 0;
    settings.typescript.maxTypeHierarchyRequests = 20;
    settings.typescript.maxReferenceRequests = 0;
    settings.typescript.maxDocumentationRequests = 0;
    const pool = new ExternalLanguageServerPool(1_000);

    try {
      const result = await pool.analyze({
        sessionPrefix: "typescript-type-relations-test",
        workspaceRootPath: projectRoot,
        workspaceFolders: [projectRoot],
        lspDataDirectory: join(root, "lsp"),
        settings,
        documents: [
          {
            file: base,
            content:
              "class Base {\n  execute() {}\n}"
          },
          {
            file: child,
            content:
              "class Child extends Base {\n  execute() {}\n}"
          }
        ]
      });

      expect(result.semanticRelations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "extends",
            sourceCanonicalPath: child.canonicalPath,
            sourceLine: 1,
            targetCanonicalPath: base.canonicalPath,
            targetLine: 1
          }),
          expect.objectContaining({
            kind: "overrides",
            sourceCanonicalPath: child.canonicalPath,
            sourceLine: 2,
            targetCanonicalPath: base.canonicalPath,
            targetLine: 2
          })
        ])
      );
      expect(result.statuses).toContainEqual(
        expect.objectContaining({
          language: "typescript",
          state: "connected",
          message: expect.stringContaining("类型关系")
        })
      );
    } finally {
      await pool.disposeAll();
    }
  });

  it.each([false, true])("shares semantic budgets and continues batches for full projects (%s)", async (completeProject) => {
    const root = await mkdtemp(
      join(tmpdir(), "gitnest-lsp-fair-budget-")
    );
    directories.push(root);
    const projectRoot = join(root, "project");
    const serverPath = join(
      root,
      "fair-budget-language-server.mjs"
    );
    const eventsPath = join(root, "events.jsonl");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      serverPath,
      fairBudgetLanguageServerSource(),
      "utf8"
    );
    const files = ["A.ts", "B.ts", "C.ts"].map(
      (relativePath): AnalysisSourceFile => {
        const absolutePath = join(
          projectRoot,
          relativePath
        );
        return {
          ...sourceFile(projectRoot, "typescript"),
          absolutePath,
          canonicalPath:
            process.platform === "win32"
              ? absolutePath.toLocaleLowerCase("en-US")
              : absolutePath,
          relativePath
        };
      }
    );
    const settings = typescriptAnalysisSettings(serverPath);
    settings.typescript.args.push(eventsPath);
    settings.typescript.maxDocuments = 2;
    settings.typescript.maxSymbolsPerDocument = 10;
    settings.typescript.maxCallHierarchyRequests = 0;
    settings.typescript.maxReferenceRequests = 2;
    settings.typescript.maxDocumentationRequests = 0;
    const pool = new ExternalLanguageServerPool(1_000);

    try {
      const result = await pool.analyze({
        sessionPrefix: "typescript-fair-budget-test",
        workspaceRootPath: projectRoot,
        workspaceFolders: [projectRoot],
        lspDataDirectory: join(root, "lsp"),
        settings,
        completeProject,
        documents: files.map((file) => ({
          file,
          content: "export const FIRST = 1;\nexport const SECOND = 2;"
        }))
      });
      const events = (await readFile(eventsPath, "utf8"))
        .trim()
        .split(/\r?\n/u)
        .map(
          (line) =>
            JSON.parse(line) as {
              method: string;
              uri: string;
              line?: number;
            }
        );
      const referenceEvents = events.filter(
        (event) =>
          event.method === "textDocument/references"
      );
      if (completeProject) {
        expect(referenceEvents).toHaveLength(6);
        expect(new Set(referenceEvents.map((event) => event.uri)).size).toBe(3);
        expect(result.statuses).toContainEqual(expect.objectContaining({
          language: "typescript", state: "connected", documentsAnalyzed: 3, skippedDocuments: 0,
          requestBudgetExhausted: false
        }));
        expect(result.symbolsByPath.get(files[2]!.canonicalPath)?.map((symbol) => symbol.name))
          .toEqual(["FIRST", "SECOND"]);
        return;
      }

      expect(referenceEvents).toEqual([
        {
          method: "textDocument/references",
          uri: pathToFileURL(files[0]!.absolutePath).href,
          line: 0
        },
        {
          method: "textDocument/references",
          uri: pathToFileURL(files[1]!.absolutePath).href,
          line: 0
        }
      ]);
      expect(
        result.symbolsByPath.get(files[2]!.canonicalPath)
      ).toEqual([
        expect.objectContaining({
          name: "THIRD_FILE",
          kind: 14,
          line: 1
        })
      ]);
      expect(result.statuses).toContainEqual(
        expect.objectContaining({
          language: "typescript",
          state: "connected",
          semanticCoverage: "partial",
          documentsTotal: 3,
          documentsAnalyzed: 2,
          skippedDocuments: 1,
          message: expect.stringMatching(
            /另有 1 个文件.*maxDocuments=2.*Workspace Symbol 另外补充 1 个.*引用请求预算 2 已用尽/u
          )
        })
      );
    } finally {
      await pool.disposeAll();
    }
  });
});

describe("non-Java language server resilience", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
  });

  it("answers Vue 3 tsserver bridge notifications so document requests complete", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "gitnest-vue-tsserver-bridge-")
    );
    directories.push(root);
    const projectRoot = join(root, "project");
    const serverPath = join(
      root,
      "vue-tsserver-bridge.mjs"
    );
    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      serverPath,
      vueTsserverBridgeLanguageServerSource(),
      "utf8"
    );
    const file = sourceFile(projectRoot, "vue");
    const pool = new ExternalLanguageServerPool(1_000);

    try {
      const result = await pool.analyze({
        sessionPrefix: "vue-tsserver-bridge-test",
        workspaceRootPath: projectRoot,
        workspaceFolders: [projectRoot],
        lspDataDirectory: join(root, "lsp"),
        settings: optionalLanguageAnalysisSettings(
          "vue",
          serverPath
        ),
        documents: [
          {
            file,
            content:
              '<script setup lang="ts">\nconst ready = true\n</script>'
          }
        ]
      });

      expect(result.statuses).toContainEqual(
        expect.objectContaining({
          language: "vue",
          state: "connected",
          symbolCount: 1
        })
      );
      expect(
        result.symbolsByPath.get(file.canonicalPath)
      ).toEqual([
        expect.objectContaining({
          name: "ready"
        })
      ]);
    } finally {
      await pool.disposeAll();
    }
  });

  it("rebuilds a non-Java session once when its first document request exits", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "gitnest-lsp-reconnect-")
    );
    directories.push(root);
    const projectRoot = join(root, "project");
    const serverPath = join(
      root,
      "reconnecting-language-server.mjs"
    );
    const statePath = join(root, "attempt.txt");
    const eventsPath = `${statePath}.events`;
    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      serverPath,
      reconnectingLanguageServerSource(),
      "utf8"
    );
    const file = sourceFile(projectRoot, "python");
    const pool = new ExternalLanguageServerPool(1_000);

    try {
      const result = await pool.analyze({
        sessionPrefix: "python-reconnect-test",
        workspaceRootPath: projectRoot,
        workspaceFolders: [projectRoot],
        lspDataDirectory: join(root, "lsp"),
        settings: optionalLanguageAnalysisSettings(
          "python",
          serverPath,
          [statePath]
        ),
        documents: [
          {
            file,
            content: "ready = True"
          }
        ]
      });

      expect(result.statuses).toContainEqual(
        expect.objectContaining({
          language: "python",
          state: "connected",
          message: expect.stringContaining(
            "已自动重连"
          ),
          symbolCount: 1
        })
      );
      expect(result.warnings).not.toEqual(
        expect.arrayContaining([
          expect.stringContaining("Python LSP")
        ])
      );
      const events = (await readFile(eventsPath, "utf8"))
        .trim()
        .split(/\r?\n/)
        .map(
          (line) =>
            JSON.parse(line) as {
              event: string;
              attempt: number;
            }
        );
      expect(
        events.filter((event) => event.event === "spawn")
      ).toHaveLength(2);
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

  it.each(["empty scope", "disabled server"])("closes documents and stops the session for %s", async (reason) => {
    const root = await mkdtemp(
      join(tmpdir(), "gitnest-lsp-document-lifecycle-")
    );
    directories.push(root);
    const projectRoot = join(root, "project");
    const serverPath = join(
      root,
      "document-lifecycle-language-server.mjs"
    );
    const eventsPath = join(root, "events.jsonl");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      serverPath,
      documentLifecycleLanguageServerSource(),
      "utf8"
    );
    const sourceTemplate = sourceFile(
      projectRoot,
      "typescript"
    );
    const firstPath = join(projectRoot, "First.ts");
    const secondPath = join(projectRoot, "Second.ts");
    const first = {
      ...sourceTemplate,
      absolutePath: firstPath,
      canonicalPath: firstPath.toLocaleLowerCase("en-US"),
      relativePath: "First.ts"
    };
    const second = {
      ...sourceTemplate,
      absolutePath: secondPath,
      canonicalPath: secondPath.toLocaleLowerCase("en-US"),
      relativePath: "Second.ts"
    };
    const settings = typescriptAnalysisSettings(serverPath);
    settings.typescript.args.push(eventsPath);
    const pool = new ExternalLanguageServerPool(5_000);
    const baseInput = {
      sessionPrefix: "typescript-document-lifecycle-test",
      workspaceRootPath: projectRoot,
      workspaceFolders: [projectRoot],
      lspDataDirectory: join(root, "lsp"),
      settings
    };

    try {
      await pool.analyze({
        ...baseInput,
        documents: [
          { file: first, content: "export const first = 1;" },
          { file: second, content: "export const second = 2;" }
        ]
      });
      await pool.analyze({
        ...baseInput,
        documents: [
          { file: second, content: "export const second = 2;" }
        ]
      });
      await pool.analyze({
        ...baseInput,
        settings: reason === "disabled server"
          ? { ...settings, typescript: { ...settings.typescript, enabled: false } }
          : settings,
        documents: reason === "empty scope"
          ? []
          : [{ file: second, content: "export const second = 2;" }]
      });
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, 50)
      );

      const events = (await readFile(eventsPath, "utf8"))
        .trim()
        .split(/\r?\n/u)
        .map(
          (line) =>
            JSON.parse(line) as {
              method: string;
              uri?: string;
            }
        );
      expect(
        events
          .filter(
            (event) =>
              event.method === "textDocument/didClose"
          )
          .map((event) => event.uri)
      ).toEqual([
        pathToFileURL(firstPath).toString(),
        pathToFileURL(secondPath).toString()
      ]);
      expect(events).toContainEqual({ method: "shutdown" });
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

  it("terminates a server that declares an oversized JSON-RPC message", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "gitnest-lsp-message-limit-")
    );
    directories.push(root);
    const serverPath = join(
      root,
      "oversized-lsp-server.mjs"
    );
    await writeFile(
      serverPath,
      [
        'process.stdout.write("Content-Length: 16777217\\r\\n\\r\\n");',
        "process.stdin.resume();",
        "setInterval(() => undefined, 1_000);"
      ].join("\n"),
      "utf8"
    );

    const client = new JsonRpcClient(
      process.execPath,
      [serverPath],
      root
    );
    await client.start();

    await expect(
      client.request("initialize", {}, 1_000)
    ).rejects.toThrow("LSP 消息长度超过安全上限");
    await viWaitForProcessExit(client);
    expect(client.alive).toBe(false);
    await client.dispose();
  });
});

async function viWaitForProcessExit(
  client: JsonRpcClient
): Promise<void> {
  for (
    let attempt = 0;
    attempt < 100 && client.alive;
    attempt += 1
  ) {
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, 10)
    );
  }
}

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
    maxTotalSourceBytes: 128 * 1_024 * 1_024,
    maxGraphNodes: 30_000,
    maxGraphEdges: 100_000,
    maxRequestChains: 5_000,
    maxDiagnostics: 2_000,
    maxFileSizeBytes: 256 * 1_024,
    readConcurrency: 1,
    graphDepth: 3,
    lspTimeoutMs: 1_000,
    ignoreDirectories: [],
    typescript: serverSettings({
      enabled: false,
      command: "typescript-language-server",
      args: ["--stdio"]
    }),
    java: serverSettings({
      enabled: true,
      command: process.execPath,
      args: [serverPath, ...serverArgs],
      maxDocuments: 80,
      maxCallHierarchyRequests: 40,
      maxReferenceRequests: 1_000,
      maxDocumentationRequests: 40
    })
  };
}

function typescriptAnalysisSettings(
  serverPath: string
): CodeAnalysisSettings {
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
    readConcurrency: 1,
    graphDepth: 3,
    lspTimeoutMs: 1_000,
    ignoreDirectories: [],
    typescript: serverSettings({
      enabled: true,
      command: process.execPath,
      args: [serverPath]
    }),
    java: serverSettings({
      enabled: false,
      command: "jdtls",
      args: [],
      maxDocuments: 80,
      maxCallHierarchyRequests: 40,
      maxReferenceRequests: 1_000,
      maxDocumentationRequests: 40
    })
  };
}

function optionalLanguageAnalysisSettings(
  language: "vue" | "python",
  serverPath: string,
  serverArgs: string[] = []
): CodeAnalysisSettings {
  const disabled = serverSettings({
    enabled: false,
    command: "disabled-language-server",
    args: [] as string[]
  });
  const settings: CodeAnalysisSettings = {
    enabled: true,
    staticFallback: true,
    maxFiles: 100,
    maxTotalSourceBytes: 128 * 1_024 * 1_024,
    maxGraphNodes: 30_000,
    maxGraphEdges: 100_000,
    maxRequestChains: 5_000,
    maxDiagnostics: 2_000,
    maxFileSizeBytes: 256 * 1_024,
    readConcurrency: 1,
    graphDepth: 3,
    lspTimeoutMs: 1_000,
    ignoreDirectories: [],
    typescript: { ...disabled },
    java: { ...disabled }
  };
  settings[language] = serverSettings({
    enabled: true,
    command: process.execPath,
    args: [serverPath, ...serverArgs]
  });
  return settings;
}

function vueTsserverBridgeLanguageServerSource(): string {
  return String.raw`
let buffer = Buffer.alloc(0);
let pendingDocumentSymbolId;
const bridgeRequestId = 73;

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

function symbol() {
  return {
    name: "ready",
    kind: 13,
    range: {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 18 }
    },
    selectionRange: {
      start: { line: 1, character: 6 },
      end: { line: 1, character: 11 }
    }
  };
}

function handle(message) {
  if (message.method === "initialize") {
    respond(message.id, {
      capabilities: {
        documentSymbolProvider: true,
        hoverProvider: false,
        callHierarchyProvider: false
      }
    });
    return;
  }
  if (message.method === "textDocument/documentSymbol") {
    pendingDocumentSymbolId = message.id;
    send({
      jsonrpc: "2.0",
      method: "tsserver/request",
      params: [[
        bridgeRequestId,
        "_vue:projectInfo",
        {
          file: "Source.vue",
          needFileNameList: false
        }
      ]]
    });
    setTimeout(() => {
      if (pendingDocumentSymbolId !== undefined) {
        process.stderr.write(
          "GitNest did not answer tsserver/request."
        );
        process.exit(24);
      }
    }, 500);
    return;
  }
  if (message.method === "tsserver/response") {
    const expected = JSON.stringify([
      [bridgeRequestId, null]
    ]);
    if (JSON.stringify(message.params) !== expected) {
      process.stderr.write(
        "Unexpected tsserver/response payload: " +
          JSON.stringify(message.params)
      );
      process.exit(25);
      return;
    }
    const requestId = pendingDocumentSymbolId;
    pendingDocumentSymbolId = undefined;
    respond(requestId, [symbol()]);
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
    const header = buffer
      .subarray(0, headerEnd)
      .toString("ascii");
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

function reconnectingLanguageServerSource(): string {
  return String.raw`
import {
  appendFileSync,
  readFileSync,
  writeFileSync
} from "node:fs";

const statePath = process.argv[2];
const eventsPath = statePath + ".events";
let attempt = 0;
try {
  attempt = Number(readFileSync(statePath, "utf8")) || 0;
} catch {}
attempt += 1;
writeFileSync(statePath, String(attempt), "utf8");
function record(event) {
  appendFileSync(
    eventsPath,
    JSON.stringify({ event, attempt }) + "\n",
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
    respond(message.id, {
      capabilities: {
        documentSymbolProvider: true,
        hoverProvider: false,
        callHierarchyProvider: false
      }
    });
    return;
  }
  if (message.method === "textDocument/documentSymbol") {
    if (attempt === 1) {
      process.stderr.write(
        "transient first document failure"
      );
      setTimeout(() => process.exit(23), 20);
      return;
    }
    respond(message.id, [
      {
        name: "ready",
        kind: 13,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 12 }
        },
        selectionRange: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 }
        }
      }
    ]);
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
    const header = buffer
      .subarray(0, headerEnd)
      .toString("ascii");
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

function typeRelationsLanguageServerSource(): string {
  return String.raw`
let buffer = Buffer.alloc(0);
let baseUri = "";
let childUri = "";

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

function item(name, uri, line, kind) {
  return {
    name,
    kind,
    uri,
    range: {
      start: { line, character: 0 },
      end: { line, character: name.length }
    },
    selectionRange: {
      start: { line, character: 0 },
      end: { line, character: name.length }
    }
  };
}

function documentSymbols(uri) {
  const className = uri === baseUri ? "Base" : "Child";
  return [
    {
      ...item(className, uri, 0, 5),
      range: {
        start: { line: 0, character: 0 },
        end: { line: 2, character: 1 }
      },
      children: [
        {
          ...item("execute", uri, 1, 6),
          detail: "execute(): void"
        }
      ]
    }
  ];
}

function handle(message) {
  if (message.method === "initialize") {
    respond(message.id, {
      capabilities: {
        documentSymbolProvider: true,
        hoverProvider: false,
        callHierarchyProvider: false,
        referencesProvider: false,
        typeHierarchyProvider: true,
        implementationProvider: true,
        workspaceSymbolProvider: false
      }
    });
    return;
  }
  if (message.method === "textDocument/didOpen") {
    const uri = message.params?.textDocument?.uri ?? "";
    if (uri.endsWith("Base.ts")) {
      baseUri = uri;
    } else if (uri.endsWith("Child.ts")) {
      childUri = uri;
    }
    return;
  }
  if (message.method === "textDocument/documentSymbol") {
    respond(
      message.id,
      documentSymbols(message.params?.textDocument?.uri ?? "")
    );
    return;
  }
  if (message.method === "textDocument/prepareTypeHierarchy") {
    const uri = message.params?.textDocument?.uri ?? "";
    respond(
      message.id,
      [item(uri === baseUri ? "Base" : "Child", uri, 0, 5)]
    );
    return;
  }
  if (message.method === "typeHierarchy/supertypes") {
    respond(
      message.id,
      message.params?.item?.name === "Child"
        ? [item("Base", baseUri, 0, 5)]
        : []
    );
    return;
  }
  if (message.method === "typeHierarchy/subtypes") {
    respond(
      message.id,
      message.params?.item?.name === "Base"
        ? [item("Child", childUri, 0, 5)]
        : []
    );
    return;
  }
  if (message.method === "textDocument/implementation") {
    const uri = message.params?.textDocument?.uri ?? "";
    const line = message.params?.position?.line ?? 0;
    respond(
      message.id,
      uri === baseUri
        ? [
            {
              uri: childUri,
              range: {
                start: { line, character: 0 },
                end: { line, character: 1 }
              }
            }
          ]
        : []
    );
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

function timeoutIsolationLanguageServerSource(): string {
  return String.raw`
import { appendFileSync } from "node:fs";

const eventsPath = process.argv[2];
let buffer = Buffer.alloc(0);
let documentUri = "";

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

function symbol(name, line) {
  return {
    name,
    kind: 6,
    range: {
      start: { line, character: 0 },
      end: { line, character: 20 }
    },
    selectionRange: {
      start: { line, character: 9 },
      end: { line, character: 9 + name.length }
    }
  };
}

function handle(message) {
  if (message.method === "initialize") {
    respond(message.id, {
      capabilities: {
        documentSymbolProvider: true,
        hoverProvider: false,
        callHierarchyProvider: false,
        referencesProvider: true,
        typeHierarchyProvider: false,
        implementationProvider: false,
        workspaceSymbolProvider: false
      }
    });
    return;
  }
  if (message.method === "textDocument/didOpen") {
    documentUri = message.params?.textDocument?.uri ?? "";
    return;
  }
  if (message.method === "textDocument/documentSymbol") {
    respond(message.id, [
      symbol("first", 0),
      symbol("second", 1),
      symbol("third", 2)
    ]);
    return;
  }
  if (message.method === "textDocument/references") {
    const line = message.params?.position?.line ?? 0;
    appendFileSync(
      eventsPath,
      JSON.stringify({
        method: message.method,
        line
      }) + "\n",
      "utf8"
    );
    if (line === 0) {
      return;
    }
    respond(message.id, [
      {
        uri: documentUri,
        range: {
          start: { line: line + 10, character: 2 },
          end: { line: line + 10, character: 8 }
        }
      }
    ]);
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

function documentIsolationLanguageServerSource(): string {
  return String.raw`
import { appendFileSync } from "node:fs";

const eventsPath = process.argv[2];
let buffer = Buffer.alloc(0);
let bPending = false;

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

function record(event) {
  appendFileSync(
    eventsPath,
    JSON.stringify(event) + "\n",
    "utf8"
  );
}

function handle(message) {
  if (message.method === "initialize") {
    respond(message.id, {
      capabilities: {
        documentSymbolProvider: true,
        hoverProvider: false,
        callHierarchyProvider: false,
        referencesProvider: false,
        typeHierarchyProvider: false,
        implementationProvider: false,
        workspaceSymbolProvider: false
      }
    });
    return;
  }
  if (message.method === "textDocument/documentSymbol") {
    const uri = message.params?.textDocument?.uri ?? "";
    const file = /\/([ABC])\.ts$/u.exec(uri)?.[1] ?? "";
    record({
      file,
      arrivedWhileBPending: bPending
    });
    if (file === "B") {
      bPending = true;
      setTimeout(() => {
        bPending = false;
      }, 80);
      return;
    }
    respond(message.id, [
      {
        name: file,
        kind: 14,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 20 }
        },
        selectionRange: {
          start: { line: 0, character: 13 },
          end: { line: 0, character: 14 }
        }
      }
    ]);
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

function referencesLanguageServerSource(): string {
  return String.raw`
import { appendFileSync } from "node:fs";

const eventsPath = process.argv[2];
let buffer = Buffer.alloc(0);
let documentUri = "";

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
        hoverProvider: false,
        callHierarchyProvider: false,
        referencesProvider: true
      }
    });
    return;
  }
  if (message.method === "textDocument/didOpen") {
    documentUri = message.params?.textDocument?.uri ?? "";
    return;
  }
  if (message.method === "textDocument/documentSymbol") {
    respond(message.id, [
      {
        name: "OPEN_GUIDE",
        kind: 14,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 28 }
        },
        selectionRange: {
          start: { line: 0, character: 13 },
          end: { line: 0, character: 23 }
        }
      }
    ]);
    return;
  }
  if (message.method === "textDocument/references") {
    appendFileSync(
      eventsPath,
      JSON.stringify({
        method: message.method,
        includeDeclaration:
          message.params?.context?.includeDeclaration
      }) + "\n",
      "utf8"
    );
    respond(message.id, [
      {
        uri: documentUri,
        range: {
          start: { line: 1, character: 23 },
          end: { line: 1, character: 33 }
        }
      },
      {
        uri: documentUri,
        range: {
          start: { line: 1, character: 23 },
          end: { line: 1, character: 33 }
        }
      }
    ]);
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

function fairBudgetLanguageServerSource(): string {
  return String.raw`
import { appendFileSync } from "node:fs";

const eventsPath = process.argv[2];
let buffer = Buffer.alloc(0);
let firstDocumentUri = "";

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

function record(event) {
  appendFileSync(
    eventsPath,
    JSON.stringify(event) + "\n",
    "utf8"
  );
}

function handle(message) {
  if (message.method === "initialize") {
    respond(message.id, {
      capabilities: {
        documentSymbolProvider: true,
        hoverProvider: false,
        callHierarchyProvider: false,
        referencesProvider: true,
        workspaceSymbolProvider: true
      }
    });
    return;
  }
  if (message.method === "textDocument/didOpen") {
    firstDocumentUri ||= message.params?.textDocument?.uri ?? "";
    return;
  }
  if (message.method === "textDocument/documentSymbol") {
    const uri = message.params?.textDocument?.uri ?? "";
    record({ method: message.method, uri });
    respond(message.id, [
      {
        name: "FIRST",
        kind: 14,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 23 }
        },
        selectionRange: {
          start: { line: 0, character: 13 },
          end: { line: 0, character: 18 }
        }
      },
      {
        name: "SECOND",
        kind: 14,
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 24 }
        },
        selectionRange: {
          start: { line: 1, character: 13 },
          end: { line: 1, character: 19 }
        }
      }
    ]);
    return;
  }
  if (message.method === "textDocument/references") {
    record({
      method: message.method,
      uri: message.params?.textDocument?.uri ?? "",
      line: message.params?.position?.line
    });
    respond(message.id, []);
    return;
  }
  if (message.method === "workspace/symbol") {
    const uri = firstDocumentUri.replace(
      /A\.ts$/u,
      "C.ts"
    );
    record({ method: message.method, uri });
    respond(message.id, [
      {
        name: "THIRD_FILE",
        kind: 14,
        location: {
          uri,
          range: {
            start: { line: 0, character: 13 },
            end: { line: 0, character: 23 }
          }
        }
      }
    ]);
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

function documentLifecycleLanguageServerSource(): string {
  return String.raw`
import { appendFileSync } from "node:fs";

const eventsPath = process.argv[2];
let buffer = Buffer.alloc(0);

function record(message) {
  if (
    message.method === "textDocument/didOpen" ||
    message.method === "textDocument/didClose" ||
    message.method === "shutdown"
  ) {
    appendFileSync(
      eventsPath,
      JSON.stringify({
        method: message.method,
        uri: message.params?.textDocument?.uri
      }) + "\n",
      "utf8"
    );
  }
}

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
  record(message);
  if (message.method === "initialize") {
    respond(message.id, {
      capabilities: {
        documentSymbolProvider: true,
        hoverProvider: false,
        callHierarchyProvider: false
      }
    });
    return;
  }
  if (message.method === "textDocument/documentSymbol") {
    respond(message.id, []);
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
let policyReady = false;
let configurationReceived = false;

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
  if (message.method === "workspace/didChangeConfiguration") {
    configurationReceived = message.params?.settings?.java?.autobuild?.enabled === false;
    return;
  }
  if (message.id === "policy" && !message.method) {
    policyReady = message.result?.[0]?.autobuild?.enabled === false &&
      message.result?.[1] === false && message.result?.[2] === null;
    return;
  }
  if (message.method === "initialize") {
    const java = message.params?.initializationOptions?.settings?.java;
    if (java?.autobuild?.enabled !== false ||
        java?.import?.gradle?.enabled !== false ||
        java?.import?.maven?.enabled !== false ||
        java?.import?.exclusions?.[0] !== "**" ||
        !process.env.JAVA_TOOL_OPTIONS?.includes("-Djava.import.generatesMetadataFilesAtProjectRoot=false")) {
      send({ jsonrpc: "2.0", id: message.id,
        error: { code: -32001, message: "Unsafe Java initialization" } });
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
    send({ jsonrpc: "2.0", id: "policy", method: "workspace/configuration",
      params: { items: [
        { section: "java" }, { section: "java.autobuild.enabled" }, { section: "unknown" }
      ] } });
    setTimeout(() => {
      ready = policyReady && configurationReceived;
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
  const extension = {
    typescript: "ts",
    javascript: "js",
    vue: "vue",
    java: "java",
    python: "py",
    go: "go",
    kotlin: "kt",
    csharp: "cs",
    rust: "rs"
  }[language];
  const relativePath = `Source.${extension}`;
  const absolutePath = join(rootPath, relativePath);
  return {
    absolutePath,
    canonicalPath: absolutePath.toLocaleLowerCase("en-US"),
    relativePath,
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
