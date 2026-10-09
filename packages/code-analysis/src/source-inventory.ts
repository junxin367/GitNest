import { createHash } from "node:crypto";
import {
  lstat,
  open,
  opendir
} from "node:fs/promises";
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
  [".java", "java"],
  [".py", "python"],
  [".pyi", "python"],
  [".go", "go"],
  [".kt", "kotlin"],
  [".kts", "kotlin"],
  [".cs", "csharp"],
  [".csx", "csharp"],
  [".rs", "rust"]
]);
export const DEFAULT_MAX_TOTAL_SOURCE_BYTES =
  128 * 1_024 * 1_024;
const FINGERPRINT_READ_CHUNK_BYTES = 64 * 1_024;
const MAX_RETAINED_SOURCE_BATCH_BYTES = 8 * 1_024 * 1_024;

export async function discoverSourceFiles(input: {
  roots: AnalysisRoot[];
  changedPaths: ChangedAnalysisPath[];
  scope: "changed" | "workspace";
  settings: CodeAnalysisSettings;
  maxTotalSizeBytes?: number;
  signal?: AbortSignal;
  /** Consumes the same verified bytes used for the fingerprint, once admitted. */
  onSourceFile?: (
    file: AnalysisSourceFile,
    content: Buffer
  ) => void | Promise<void>;
}): Promise<SourceInventoryResult> {
  const warnings: string[] = [];
  const files: AnalysisSourceFile[] = [];
  const seen = new Set<string>();
  let skippedFiles = 0;
  let configuredSkippedFiles = 0;
  let inspectionFailureCount = 0;
  let truncated = false;
  let totalBytes = 0;
  let truncationReason: "files" | "bytes" | undefined;
  const maxTotalSizeBytes =
    input.maxTotalSizeBytes ??
    input.settings.maxTotalSourceBytes;
  const pending: Promise<PromiseSettledResult<SourceInspectionResult>>[] = [];
  const concurrency = Math.max(
    1,
    Math.min(32, Math.floor(input.settings.readConcurrency) || 1)
  );

  const flush = async (): Promise<void> => {
    // Settle the whole bounded batch before exposing an error or returning,
    // so cancellation cannot leave reads or rejected promises behind.
    const results = await Promise.all(pending.splice(0));
    for (const result of results) {
      throwIfAborted(input.signal);
      if (result.status === "rejected") {
        throw result.reason;
      }
      const inspection = result.value;
      if (inspection.kind !== "included") {
        skippedFiles += 1;
        if (inspection.kind === "configured-skip") {
          configuredSkippedFiles += 1;
          warnings.push(inspection.warning);
        } else if (inspection.kind === "failure") {
          inspectionFailureCount += 1;
          warnings.push(inspection.warning);
        }
        continue;
      }
      const descriptor = inspection.file;
      if (seen.has(descriptor.canonicalPath)) {
        continue;
      }
      if (!addFile(descriptor)) {
        break;
      }
      if (input.onSourceFile && inspection.content !== undefined) {
        await input.onSourceFile(descriptor, inspection.content);
        throwIfAborted(input.signal);
      }
    }
  };

  const enqueue = async (
    root: AnalysisRoot,
    absolutePath: string,
    changed: boolean
  ): Promise<void> => {
    pending.push(inspectSourceFile(
      root,
      absolutePath,
      changed,
      input.settings.maxFileSizeBytes,
      input.signal,
      Boolean(input.onSourceFile)
    ).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason })
    ));
    // Reserve the maximum possible size of each in-flight read. Close to a
    // budget, use the original serial admission order instead of reading ahead.
    const batchLimit = Math.max(1, Math.min(
      concurrency,
      Math.floor(
        MAX_RETAINED_SOURCE_BATCH_BYTES /
          Math.max(1, input.settings.maxFileSizeBytes)
      ),
      input.settings.maxFiles - files.length,
      Math.floor(
        (maxTotalSizeBytes - totalBytes) /
          Math.max(1, input.settings.maxFileSizeBytes)
      )
    ));
    if (pending.length >= batchLimit) {
      await flush();
    }
  };

  const addFile = (
    descriptor: AnalysisSourceFile
  ): boolean => {
    if (files.length >= input.settings.maxFiles) {
      truncated = true;
      truncationReason = "files";
      return false;
    }
    if (
      totalBytes + descriptor.size >
      maxTotalSizeBytes
    ) {
      truncated = true;
      truncationReason = "bytes";
      return false;
    }
    seen.add(descriptor.canonicalPath);
    files.push(descriptor);
    totalBytes += descriptor.size;
    return true;
  };

  try {
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
          await flush();
          skippedFiles += 1;
          inspectionFailureCount += 1;
          warnings.push(
            `已跳过超出 Worktree 的变动路径：${changedPath.path}`
          );
          continue;
        }
        await enqueue(root, absolutePath, true);
        if (truncated) {
          break;
        }
      }
      await flush();
      appendTruncationWarning(
        warnings,
        truncationReason,
        input.settings.maxFiles,
        maxTotalSizeBytes
      );
      return {
        files,
        totalBytes,
        skippedFiles,
        configuredSkippedFiles,
        inspectionFailureCount,
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
          inspectionFailureCount += 1;
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
          await enqueue(root, absolutePath, false);
          if (truncated) {
            break;
          }
        }

        await flush();
        if (truncated) {
          break;
        }
      }
      if (truncated) {
        break;
      }
    }

    appendTruncationWarning(
      warnings,
      truncationReason,
      input.settings.maxFiles,
      maxTotalSizeBytes
    );

    return {
      files,
      totalBytes,
      skippedFiles,
      configuredSkippedFiles,
      inspectionFailureCount,
      truncated,
      warnings
    };
  } finally {
    await Promise.all(pending.splice(0));
  }
}

function appendTruncationWarning(
  warnings: string[],
  reason: "files" | "bytes" | undefined,
  maxFiles: number,
  maxTotalSizeBytes: number
): void {
  if (reason === "files") {
    warnings.push(
      `文件数量达到上限 ${maxFiles}，本次结果已截断。`
    );
    return;
  }
  if (reason === "bytes") {
    warnings.push(
      `源码读取总量达到安全上限 ${formatMegabytes(
        maxTotalSizeBytes
      )} MiB，本次结果已截断。`
    );
  }
}

function formatMegabytes(bytes: number): string {
  return (bytes / (1_024 * 1_024)).toFixed(
    bytes % (1_024 * 1_024) === 0 ? 0 : 1
  );
}

async function inspectSourceFile(
  root: AnalysisRoot,
  absolutePath: string,
  changed: boolean,
  maxFileSizeBytes: number,
  signal?: AbortSignal,
  captureContent = false
): Promise<SourceInspectionResult> {
  const language = languageForPath(absolutePath);
  if (!language) {
    return { kind: "excluded" };
  }

  let details;
  try {
    details = await lstat(absolutePath);
  } catch (error) {
    if (isMissingFilesystemEntry(error)) {
      return { kind: "excluded" };
    }
    return {
      kind: "failure",
      warning: `无法检查源文件 ${displayRelative(root.path, absolutePath)}：${errorMessage(error)}`
    };
  }
  if (!details.isFile()) {
    return { kind: "excluded" };
  }
  if (details.size > maxFileSizeBytes) {
    return {
      kind: "configured-skip",
      warning: `已跳过超过单文件大小限制的源文件 ${displayRelative(root.path, absolutePath)}。`
    };
  }
  let source: { fingerprint: string; content?: Buffer };
  try {
    source = await fingerprintSourceFile(
      absolutePath,
      {
        size: details.size,
        modifiedAtMs: details.mtimeMs,
        changedAtMs: details.ctimeMs,
        device: details.dev,
        inode: details.ino
      },
      signal,
      captureContent
    );
  } catch (error) {
    throwIfAborted(signal);
    if (isMissingFilesystemEntry(error)) {
      return { kind: "excluded" };
    }
    return {
      kind: "failure",
      warning: `无法检查源文件 ${displayRelative(root.path, absolutePath)}：${errorMessage(error)}`
    };
  }

  const resolvedPath = resolve(absolutePath);
  return {
    kind: "included",
    ...(source.content !== undefined ? { content: source.content } : {}),
    file: {
      absolutePath: resolvedPath,
      canonicalPath: canonicalPath(resolvedPath),
      relativePath: displayRelative(root.path, resolvedPath),
      repositoryId: root.repositoryId,
      worktreeId: root.worktreeId,
      rootPath: resolve(root.path),
      language,
      size: details.size,
      modifiedAtMs: details.mtimeMs,
      fingerprint: source.fingerprint,
      changed
    }
  };
}

type SourceInspectionResult =
  | {
      kind: "included";
      file: AnalysisSourceFile;
      content?: Buffer;
    }
  | {
      kind: "excluded";
    }
  | {
      kind: "configured-skip";
      warning: string;
    }
  | {
      kind: "failure";
      warning: string;
    };

async function fingerprintSourceFile(
  filePath: string,
  expected: {
    size: number;
    modifiedAtMs: number;
    changedAtMs: number;
    device: number;
    inode: number;
  },
  signal?: AbortSignal,
  captureContent = false
): Promise<{ fingerprint: string; content?: Buffer }> {
  const handle = await open(filePath, "r");
  const hash = createHash("sha256");
  const content = captureContent ? Buffer.allocUnsafe(expected.size) : undefined;
  const chunk = content ?? Buffer.allocUnsafe(
    Math.min(expected.size, FINGERPRINT_READ_CHUNK_BYTES)
  );
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.size !== expected.size ||
      before.mtimeMs !== expected.modifiedAtMs ||
      before.ctimeMs !== expected.changedAtMs ||
      before.dev !== expected.device ||
      before.ino !== expected.inode
    ) {
      throw new Error(
        "Source file changed while its fingerprint was being calculated."
      );
    }
    let offset = 0;
    while (offset < expected.size) {
      throwIfAborted(signal);
      const { bytesRead } = await handle.read(
        chunk,
        content ? offset : 0,
        Math.min(FINGERPRINT_READ_CHUNK_BYTES, expected.size - offset),
        offset
      );
      if (bytesRead === 0) {
        break;
      }
      hash.update(chunk.subarray(
        content ? offset : 0,
        (content ? offset : 0) + bytesRead
      ));
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (
      offset !== expected.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw new Error(
        "Source file changed while its fingerprint was being calculated."
      );
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
  return {
    fingerprint: `sha256:${hash.digest("hex")}`,
    ...(content ? { content } : {})
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
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
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

function isMissingFilesystemEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
