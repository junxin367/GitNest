import {
  mkdir,
  mkdtemp,
  rm,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CodeAnalysisSettings } from "./model";
import { discoverSourceFiles } from "./source-inventory";

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
