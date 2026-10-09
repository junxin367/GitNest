import {
  mkdir,
  mkdtemp,
  open,
  rm,
  symlink,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CodeAnalysisSettings } from "./model";
import { discoverSourceFiles } from "./source-inventory";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

describe("discoverSourceFiles budgets", () => {
  let directory = "";

  afterEach(async () => {
    if (
      directory &&
      resolve(directory).startsWith(resolve(tmpdir()))
    ) {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
    directory = "";
  });

  it("caps aggregate source bytes while walking a workspace", async () => {
    directory = await mkdtemp(
      join(tmpdir(), "gitnest-source-budget-")
    );
    const sourceDirectory = join(directory, "src");
    await mkdir(sourceDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        join(sourceDirectory, "first.ts"),
        "12345678",
        "utf8"
      ),
      writeFile(
        join(sourceDirectory, "second.ts"),
        "abcdefgh",
        "utf8"
      )
    ]);

    const result = await discoverSourceFiles({
      roots: [
        {
          repositoryId: "repository",
          worktreeId: "worktree",
          name: "Repository",
          path: directory
        }
      ],
      changedPaths: [],
      scope: "workspace",
      settings: settings(),
      maxTotalSizeBytes: 10
    });

    expect(result.files).toHaveLength(1);
    expect(result.totalBytes).toBe(8);
    expect(result.truncated).toBe(true);
    expect(result.warnings[0]).toContain(
      "源码读取总量达到安全上限"
    );
  });

  it("uses the configured aggregate source byte limit", async () => {
    directory = await mkdtemp(
      join(tmpdir(), "gitnest-configured-source-budget-")
    );
    await Promise.all([
      writeFile(join(directory, "first.ts"), "12345678", "utf8"),
      writeFile(join(directory, "second.ts"), "abcdefgh", "utf8")
    ]);

    const result = await discoverSourceFiles({
      roots: [
        {
          repositoryId: "repository",
          worktreeId: "worktree",
          name: "Repository",
          path: directory
        }
      ],
      changedPaths: [],
      scope: "workspace",
      settings: {
        ...settings(),
        maxTotalSourceBytes: 10
      }
    });

    expect(result.files).toHaveLength(1);
    expect(result.totalBytes).toBe(8);
    expect(result.truncated).toBe(true);
  });

  it("applies the file-count budget to changed scope", async () => {
    directory = await mkdtemp(
      join(tmpdir(), "gitnest-changed-budget-")
    );
    await Promise.all([
      writeFile(join(directory, "first.ts"), "1", "utf8"),
      writeFile(join(directory, "second.ts"), "2", "utf8")
    ]);

    const result = await discoverSourceFiles({
      roots: [
        {
          repositoryId: "repository",
          worktreeId: "worktree",
          name: "Repository",
          path: directory
        }
      ],
      changedPaths: [
        {
          repositoryId: "repository",
          worktreeId: "worktree",
          path: "first.ts"
        },
        {
          repositoryId: "repository",
          worktreeId: "worktree",
          path: "second.ts"
        }
      ],
      scope: "changed",
      settings: {
        ...settings(),
        maxFiles: 1
      }
    });

    expect(result.files).toHaveLength(1);
    expect(result.truncated).toBe(true);
    expect(result.warnings).toContain(
      "文件数量达到上限 1，本次结果已截断。"
    );
  });

  it("accepts an in-root directory whose name begins with two dots", async () => {
    directory = await mkdtemp(
      join(tmpdir(), "gitnest-dot-directory-")
    );
    const sourceDirectory = join(directory, "..safe");
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(
      join(sourceDirectory, "source.ts"),
      "export const safe = true;",
      "utf8"
    );

    const result = await discoverSourceFiles({
      roots: [
        {
          repositoryId: "repository",
          worktreeId: "worktree",
          name: "Repository",
          path: directory
        }
      ],
      changedPaths: [
        {
          repositoryId: "repository",
          worktreeId: "worktree",
          path: "..safe/source.ts"
        }
      ],
      scope: "changed",
      settings: settings()
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.relativePath).toBe(
      "..safe/source.ts"
    );
  });

  it("discovers every supported language without treating it as JavaScript", async () => {
    directory = await mkdtemp(
      join(tmpdir(), "gitnest-source-languages-")
    );
    const fixtures = [
      ["source.ts", "typescript"],
      ["source.js", "javascript"],
      ["source.vue", "vue"],
      ["Source.java", "java"],
      ["source.py", "python"],
      ["source.go", "go"],
      ["source.kt", "kotlin"],
      ["source.cs", "csharp"],
      ["source.rs", "rust"]
    ] as const;
    await Promise.all(
      fixtures.map(([path]) =>
        writeFile(join(directory, path), "source", "utf8")
      )
    );

    const result = await discoverSourceFiles({
      roots: [
        {
          repositoryId: "repository",
          worktreeId: "worktree",
          name: "Repository",
          path: directory
        }
      ],
      changedPaths: [],
      scope: "workspace",
      settings: settings()
    });

    expect(
      result.files
        .map((file) => ({
          path: file.relativePath,
          language: file.language
        }))
        .sort((left, right) =>
          left.path.localeCompare(right.path, "en-US")
        )
    ).toEqual(
      fixtures
        .map(([path, language]) => ({
          path,
          language
        }))
        .sort((left, right) =>
          left.path.localeCompare(right.path, "en-US")
        )
    );
  });

  it("uses content SHA-256 when size and modified time are unchanged", async () => {
    directory = await mkdtemp(
      join(tmpdir(), "gitnest-source-fingerprint-")
    );
    const path = join(directory, "source.ts");
    const fixedTime = new Date(
      "2026-09-01T00:00:00.000Z"
    );
    await writeFile(path, "aaaa", "utf8");
    await utimes(path, fixedTime, fixedTime);

    const first = await discoverSourceFiles({
      roots: [
        {
          repositoryId: "repository",
          worktreeId: "worktree",
          name: "Repository",
          path: directory
        }
      ],
      changedPaths: [],
      scope: "workspace",
      settings: settings()
    });
    await writeFile(path, "bbbb", "utf8");
    await utimes(path, fixedTime, fixedTime);
    const second = await discoverSourceFiles({
      roots: [
        {
          repositoryId: "repository",
          worktreeId: "worktree",
          name: "Repository",
          path: directory
        }
      ],
      changedPaths: [],
      scope: "workspace",
      settings: settings()
    });

    expect(first.files[0]?.size).toBe(second.files[0]?.size);
    expect(first.files[0]?.modifiedAtMs).toBe(
      second.files[0]?.modifiedAtMs
    );
    expect(first.files[0]?.fingerprint).toMatch(
      /^sha256:[a-f0-9]{64}$/
    );
    expect(second.files[0]?.fingerprint).not.toBe(
      first.files[0]?.fingerprint
    );
  });

  it("reports supported source files skipped by the per-file size limit", async () => {
    directory = await mkdtemp(
      join(tmpdir(), "gitnest-source-file-limit-")
    );
    await writeFile(
      join(directory, "large.ts"),
      "export const value = true;",
      "utf8"
    );

    const result = await discoverSourceFiles({
      roots: [
        {
          repositoryId: "repository",
          worktreeId: "worktree",
          name: "Repository",
          path: directory
        }
      ],
      changedPaths: [],
      scope: "workspace",
      settings: {
        ...settings(),
        maxFileSizeBytes: 4
      }
    });

    expect(result.files).toHaveLength(0);
    expect(result.skippedFiles).toBe(1);
    expect(result.configuredSkippedFiles).toBe(1);
    expect(result.inspectionFailureCount).toBe(0);
  });

  it("reports an unreadable workspace root as an inventory failure", async () => {
    directory = await mkdtemp(
      join(tmpdir(), "gitnest-source-missing-root-")
    );
    const missingRoot = join(directory, "missing");

    const result = await discoverSourceFiles({
      roots: [
        {
          repositoryId: "repository",
          worktreeId: "worktree",
          name: "Repository",
          path: missingRoot
        }
      ],
      changedPaths: [],
      scope: "workspace",
      settings: settings()
    });

    expect(result.files).toHaveLength(0);
    expect(result.configuredSkippedFiles).toBe(0);
    expect(result.inspectionFailureCount).toBe(1);
    expect(result.warnings[0]).toContain("无法读取目录");
  });

  it("preserves changed-path order, byte budgets and verified content with parallel reads", async () => {
    directory = await mkdtemp(join(tmpdir(), "gitnest-source-parallel-"));
    const paths = ["third.ts", "first.ts", "second.ts", "last.ts"];
    await Promise.all(paths.map((path, index) =>
      writeFile(join(directory, path), `${index}`.repeat(16), "utf8")
    ));
    const input = {
      roots: [{ repositoryId: "repository", worktreeId: "worktree", name: "Repository", path: directory }],
      changedPaths: [...paths, paths[0]!].map((path) => ({
        repositoryId: "repository", worktreeId: "worktree", path
      })),
      scope: "changed" as const,
      settings: { ...settings(), maxTotalSourceBytes: 48, maxFileSizeBytes: 16 }
    };
    const serial = await discoverSourceFiles(input);
    const consumed: string[] = [];
    const parallel = await discoverSourceFiles({
      ...input,
      settings: { ...input.settings, readConcurrency: 4 },
      onSourceFile: (file, content) => {
        consumed.push(file.relativePath);
        expect(content.toString("utf8")).toBe(`${paths.indexOf(file.relativePath)}`.repeat(16));
      }
    });
    expect(parallel).toEqual(serial);
    expect(consumed).toEqual(paths.slice(0, 3));
  });

  it("bounds fingerprint reads to the discovered size when a file keeps growing", async () => {
    directory = await mkdtemp(join(tmpdir(), "gitnest-source-growing-"));
    const path = join(directory, "source.ts");
    const size = 64 * 1_024;
    await writeFile(path, "a".repeat(size));
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let bytesRead = 0;
    vi.mocked(open).mockImplementation(async (...args) => {
      const handle = await actual.open(...args);
      handle.read = new Proxy(handle.read, {
        apply: async (target, thisArgument, argumentsList) => {
          const result = await Reflect.apply(target, thisArgument, argumentsList);
          bytesRead += result.bytesRead;
          await actual.appendFile(path, "b".repeat(size));
          return result;
        }
      });
      return handle;
    });
    try {
      const result = await discoverSourceFiles({
        roots: [{ repositoryId: "repository", worktreeId: "worktree", name: "Repository", path: directory }],
        changedPaths: [],
        scope: "workspace",
        settings: { ...settings(), maxFileSizeBytes: size }
      });
      expect(bytesRead).toBe(size);
      expect(result.files).toHaveLength(0);
      expect(result.inspectionFailureCount).toBe(1);
      expect(result.warnings[0]).toContain("changed while");
    } finally {
      vi.mocked(open).mockImplementation(actual.open);
    }
  });

  it("drains a concurrent batch and stops consuming sources after cancellation", async () => {
    directory = await mkdtemp(join(tmpdir(), "gitnest-source-cancel-"));
    await Promise.all(["first.ts", "second.ts", "third.ts"].map((path) =>
      writeFile(join(directory, path), "export const value = 1;")
    ));
    const controller = new AbortController();
    const consumed: string[] = [];
    await expect(discoverSourceFiles({
      roots: [{ repositoryId: "repository", worktreeId: "worktree", name: "Repository", path: directory }],
      changedPaths: [],
      scope: "workspace",
      settings: { ...settings(), readConcurrency: 3 },
      signal: controller.signal,
      onSourceFile: (file) => {
        consumed.push(file.relativePath);
        controller.abort(new Error("cancelled by test"));
      }
    })).rejects.toThrow("cancelled by test");
    expect(consumed).toHaveLength(1);
  });

  it("closes every in-flight file before rejecting cancellation during reads", async () => {
    directory = await mkdtemp(join(tmpdir(), "gitnest-source-read-cancel-"));
    const paths = ["first.ts", "second.ts", "third.ts"];
    await Promise.all(paths.map((path) =>
      writeFile(join(directory, path), "x".repeat(128 * 1_024))
    ));
    const controller = new AbortController();
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let opened = 0;
    let closed = 0;
    vi.mocked(open).mockImplementation(async (...args) => {
      const handle = await actual.open(...args);
      opened += 1;
      handle.read = new Proxy(handle.read, {
        apply: async (target, thisArgument, argumentsList) => {
          const result = await Reflect.apply(target, thisArgument, argumentsList);
          controller.abort(new Error("cancelled during read"));
          return result;
        }
      });
      handle.close = new Proxy(handle.close, {
        apply: async (target, thisArgument, argumentsList) => {
          await Reflect.apply(target, thisArgument, argumentsList);
          closed += 1;
        }
      });
      return handle;
    });
    try {
      await expect(discoverSourceFiles({
        roots: [{ repositoryId: "repository", worktreeId: "worktree", name: "Repository", path: directory }],
        changedPaths: [],
        scope: "workspace",
        settings: { ...settings(), readConcurrency: 3, maxFileSizeBytes: 256 * 1_024 },
        signal: controller.signal
      })).rejects.toThrow("cancelled during read");
      expect(opened).toBeGreaterThan(0);
      expect(closed).toBe(opened);
    } finally {
      vi.mocked(open).mockImplementation(actual.open);
    }
  });

  it("does not follow directory links while walking a workspace", async () => {
    directory = await mkdtemp(join(tmpdir(), "gitnest-source-links-"));
    const repository = join(directory, "repository");
    const outside = join(directory, "outside");
    await mkdir(repository);
    await mkdir(outside);
    await writeFile(join(repository, "inside.ts"), "export const inside = 1;");
    await writeFile(join(outside, "outside.ts"), "export const outside = 1;");
    await symlink(outside, join(repository, "linked"), "junction");
    const result = await discoverSourceFiles({
      roots: [{ repositoryId: "repository", worktreeId: "worktree", name: "Repository", path: repository }],
      changedPaths: [],
      scope: "workspace",
      settings: { ...settings(), readConcurrency: 4 }
    });
    expect(result.files.map((file) => file.relativePath)).toEqual(["inside.ts"]);
  });

  it("rejects an equal-size rewrite during hashing even when mtime is restored", async () => {
    directory = await mkdtemp(join(tmpdir(), "gitnest-source-rewrite-"));
    const path = join(directory, "source.ts");
    const size = 128 * 1_024;
    const fixedTime = new Date("2026-09-01T00:00:00.000Z");
    await writeFile(path, "a".repeat(size));
    await utimes(path, fixedTime, fixedTime);
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let rewritten = false;
    vi.mocked(open).mockImplementation(async (...args) => {
      const handle = await actual.open(...args);
      handle.read = new Proxy(handle.read, {
        apply: async (target, thisArgument, argumentsList) => {
          const result = await Reflect.apply(target, thisArgument, argumentsList);
          if (!rewritten) {
            rewritten = true;
            // Separate ctime updates even on filesystems with millisecond precision.
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
            await writeFile(path, "b".repeat(size));
            await utimes(path, fixedTime, fixedTime);
          }
          return result;
        }
      });
      return handle;
    });
    try {
      const consumed = vi.fn();
      const result = await discoverSourceFiles({
        roots: [{ repositoryId: "repository", worktreeId: "worktree", name: "Repository", path: directory }],
        changedPaths: [],
        scope: "workspace",
        settings: { ...settings(), maxFileSizeBytes: size },
        onSourceFile: consumed
      });
      expect(result.files).toHaveLength(0);
      expect(result.inspectionFailureCount).toBe(1);
      expect(consumed).not.toHaveBeenCalled();
    } finally {
      vi.mocked(open).mockImplementation(actual.open);
    }
  });
});

function settings(): CodeAnalysisSettings {
  return {
    enabled: true,
    staticFallback: true,
    maxFiles: 100,
    maxTotalSourceBytes: 128 * 1_024 * 1_024,
    maxGraphNodes: 30_000,
    maxGraphEdges: 100_000,
    maxRequestChains: 5_000,
    maxDiagnostics: 2_000,
    maxFileSizeBytes: 64 * 1_024,
    readConcurrency: 1,
    graphDepth: 3,
    lspTimeoutMs: 1_000,
    ignoreDirectories: [],
    typescript: {
      enabled: false,
      command: "typescript-language-server",
      args: [],
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
