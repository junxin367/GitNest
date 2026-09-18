import { lstat, opendir } from "node:fs/promises";
import {
  extname,
  isAbsolute,
  relative,
  resolve,
  sep
} from "node:path";

import type {
  AnalysisRoot,
  AnalysisSourceFile,
  ChangedAnalysisPath,
  CodeAnalysisLanguage,
  CodeAnalysisSettings,
  SourceInventoryResult
} from "./model";

const SUPPORTED_EXTENSIONS = new Map<
  string,
  CodeAnalysisLanguage
>([
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".js", "javascript"],
  [".jsx", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".vue", "vue"],
  [".java", "java"]
]);

export async function discoverSourceFiles(input: {
  roots: AnalysisRoot[];
  changedPaths: ChangedAnalysisPath[];
  scope: "changed" | "workspace";
  settings: CodeAnalysisSettings;
  signal?: AbortSignal;
}): Promise<SourceInventoryResult> {
  const warnings: string[] = [];
  const files: AnalysisSourceFile[] = [];
  const seen = new Set<string>();
  let skippedFiles = 0;
  let truncated = false;

  if (input.scope === "changed") {
    const rootsByTarget = new Map(
      input.roots.map((root) => [targetKey(root), root])
    );
    for (const changedPath of input.changedPaths) {
      throwIfAborted(input.signal);
      const root = rootsByTarget.get(targetKey(changedPath));
      if (!root) {
        continue;
      }
      const absolutePath = resolve(root.path, changedPath.path);
      if (!isWithin(root.path, absolutePath)) {
        skippedFiles += 1;
        warnings.push(
          `已跳过超出 Worktree 的变动路径：${changedPath.path}`
        );
        continue;
      }
      const descriptor = await inspectSourceFile(
        root,
        absolutePath,
        true,
        input.settings.maxFileSizeBytes
      );
      if (!descriptor) {
        skippedFiles += 1;
        continue;
      }
      if (seen.has(descriptor.canonicalPath)) {
        continue;
      }
      seen.add(descriptor.canonicalPath);
      files.push(descriptor);
    }
    return {
      files,
      skippedFiles,
      truncated,
      warnings
    };
  }

  const ignored = new Set(
    input.settings.ignoreDirectories.map((value) =>
      value.trim().toLocaleLowerCase("en-US")
    )
  );
  let visitedEntries = 0;

  for (const root of input.roots) {
    const directories = [resolve(root.path)];
    while (directories.length > 0) {
      throwIfAborted(input.signal);
      const directory = directories.pop();
      if (!directory) {
        break;
      }

      let handle;
      try {
        handle = await opendir(directory);
      } catch (error) {
        warnings.push(
          `无法读取目录 ${displayRelative(root.path, directory)}：${errorMessage(error)}`
        );
        continue;
      }

      for await (const entry of handle) {
        throwIfAborted(input.signal);
        visitedEntries += 1;
        if (visitedEntries % 80 === 0) {
          await yieldToEventLoop();
        }
        if (entry.isSymbolicLink()) {
          continue;
        }

        const absolutePath = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          if (
            ignored.has(
              entry.name.toLocaleLowerCase("en-US")
            )
          ) {
            continue;
          }
          directories.push(absolutePath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }

        const language = languageForPath(absolutePath);
        if (!language) {
          continue;
        }
        if (files.length >= input.settings.maxFiles) {
          truncated = true;
          break;
        }
        const descriptor = await inspectSourceFile(
          root,
          absolutePath,
          false,
          input.settings.maxFileSizeBytes
        );
        if (!descriptor) {
          skippedFiles += 1;
          continue;
        }
        if (seen.has(descriptor.canonicalPath)) {
          continue;
        }
        seen.add(descriptor.canonicalPath);
        files.push(descriptor);
      }

      if (truncated) {
        break;
      }
    }
    if (truncated) {
      break;
    }
  }

  if (truncated) {
    warnings.push(
      `文件数量达到上限 ${input.settings.maxFiles}，本次结果已截断。`
    );
  }

  return {
    files,
    skippedFiles,
    truncated,
    warnings
  };
}

async function inspectSourceFile(
  root: AnalysisRoot,
  absolutePath: string,
  changed: boolean,
  maxFileSizeBytes: number
): Promise<AnalysisSourceFile | null> {
  const language = languageForPath(absolutePath);
  if (!language) {
    return null;
  }

  let details;
  try {
    details = await lstat(absolutePath);
  } catch {
    return null;
  }
  if (
    !details.isFile() ||
    details.size > maxFileSizeBytes
  ) {
    return null;
  }

  const resolvedPath = resolve(absolutePath);
  return {
    absolutePath: resolvedPath,
    canonicalPath: canonicalPath(resolvedPath),
    relativePath: displayRelative(root.path, resolvedPath),
    repositoryId: root.repositoryId,
    worktreeId: root.worktreeId,
    rootPath: resolve(root.path),
    language,
    size: details.size,
    modifiedAtMs: details.mtimeMs,
    fingerprint: `${details.size}:${Math.trunc(details.mtimeMs)}`,
    changed
  };
}

function languageForPath(
  filePath: string
): CodeAnalysisLanguage | undefined {
  return SUPPORTED_EXTENSIONS.get(
    extname(filePath).toLocaleLowerCase("en-US")
  );
}

function displayRelative(rootPath: string, path: string): string {
  return relative(resolve(rootPath), resolve(path))
    .split(sep)
    .join("/");
}

function isWithin(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(
    resolve(rootPath),
    resolve(candidatePath)
  );
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") &&
      !isAbsolute(relativePath))
  );
}

function canonicalPath(path: string): string {
  const resolved = resolve(path);
  return process.platform === "win32"
    ? resolved.toLocaleLowerCase("en-US")
    : resolved;
}

function targetKey(
  target: Pick<
    AnalysisRoot,
    "repositoryId" | "worktreeId"
  >
): string {
  return `${target.repositoryId}\0${target.worktreeId}`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Code analysis was cancelled.");
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolvePromise) =>
    setImmediate(resolvePromise)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
