import {
  mkdir,
  mkdtemp,
  rm,
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
});

function settings(): CodeAnalysisSettings {
  return {
    enabled: true,
    staticFallback: true,
    maxFiles: 100,
    maxFileSizeBytes: 64 * 1_024,
    readConcurrency: 1,
    graphDepth: 3,
    lspTimeoutMs: 1_000,
    ignoreDirectories: [],
    typescript: {
      enabled: false,
      command: "typescript-language-server",
      args: []
    },
    java: {
      enabled: false,
      command: "jdtls",
      args: []
    }
  };
}
