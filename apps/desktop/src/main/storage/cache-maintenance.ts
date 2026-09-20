import {
  lstat,
  readdir,
  rm,
  stat,
  unlink
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve
} from "node:path";

import { codeAnalysisCacheEntryDirectory } from "@gitnest/code-analysis";

import type {
  DataSetDescriptor,
  GitNestDataRegistry
} from "./data-registry";

const CACHE_ENTRY_PATTERN = /^[a-f0-9]{24}$/;
const TEMPORARY_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export interface CodeAnalysisCacheMaintenanceInput {
  registry: GitNestDataRegistry;
  workspaceId: string;
  activeEntryIds: readonly string[];
  now?: number;
}

export interface CacheMaintenanceResult {
  removedEntries: number;
  removedBytes: number;
  removedTemporaryFiles: number;
  skippedEntries: number;
  warnings: string[];
}

interface CacheEntryInfo {
  name: string;
  path: string;
  bytes: number;
  modifiedAtMs: number;
  protected: boolean;
}

export async function runCodeAnalysisCacheMaintenance(
  input: CodeAnalysisCacheMaintenanceInput
): Promise<CacheMaintenanceResult> {
  const result: CacheMaintenanceResult = {
    removedEntries: 0,
    removedBytes: 0,
    removedTemporaryFiles: 0,
    skippedEntries: 0,
    warnings: []
  };
  const now = input.now ?? Date.now();
  const protectedNames = new Set(
    input.activeEntryIds.map((entryId) =>
      basename(
        codeAnalysisCacheEntryDirectory(
          input.registry.paths.codeAnalysisIndex,
          input.workspaceId,
          entryId
        )
      )
    )
  );
  const targets = input.registry.descriptors.filter(
    (descriptor) =>
      descriptor.id === "code-analysis-index" ||
      descriptor.id === "code-analysis-snapshots"
  );

  for (const target of targets) {
    await maintainCacheTarget(
      target,
      protectedNames,
      now,
      result
    );
  }
  return result;
}

async function maintainCacheTarget(
  descriptor: DataSetDescriptor,
  protectedNames: ReadonlySet<string>,
  now: number,
  result: CacheMaintenanceResult
): Promise<void> {
  if (descriptor.retention.policy !== "bounded") {
    return;
  }
  const root = resolve(descriptor.path);
  let entries;
  try {
    entries = await readdir(root, {
      withFileTypes: true
    });
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return;
    }
    result.warnings.push(
      `${descriptor.id}: ${getErrorMessage(error)}`
    );
    return;
  }

  const cacheEntries: CacheEntryInfo[] = [];
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      !CACHE_ENTRY_PATTERN.test(entry.name)
    ) {
      result.skippedEntries += 1;
      continue;
    }
    const entryPath = join(root, entry.name);
    try {
      const inspected = await inspectCacheEntry(
        root,
        entryPath,
        protectedNames.has(entry.name),
        now,
        result
      );
      if (inspected) {
        cacheEntries.push(inspected);
      }
    } catch (error) {
      result.skippedEntries += 1;
      result.warnings.push(
        `${descriptor.id}/${entry.name}: ${getErrorMessage(
          error
        )}`
      );
    }
  }

  const maxAgeMs =
    descriptor.retention.maxAgeDays * 24 * 60 * 60 * 1_000;
  const retained: CacheEntryInfo[] = [];
  for (const entry of cacheEntries) {
    if (
      !entry.protected &&
      now - entry.modifiedAtMs > maxAgeMs
    ) {
      if (await removeCacheEntry(root, entry.path)) {
        result.removedEntries += 1;
        result.removedBytes += entry.bytes;
        continue;
      }
      result.warnings.push(
        `${descriptor.id}/${entry.name}: cache entry could not be removed`
      );
    }
    retained.push(entry);
  }

  let totalBytes = retained.reduce(
    (sum, entry) => sum + entry.bytes,
    0
  );
  const quotaCandidates = retained
    .filter((entry) => !entry.protected)
    .sort(
      (left, right) =>
        left.modifiedAtMs - right.modifiedAtMs
    );
  for (const entry of quotaCandidates) {
    if (totalBytes <= descriptor.retention.maxBytes) {
      break;
    }
    if (!(await removeCacheEntry(root, entry.path))) {
      result.warnings.push(
        `${descriptor.id}/${entry.name}: quota cleanup failed`
      );
      continue;
    }
    totalBytes -= entry.bytes;
    result.removedEntries += 1;
    result.removedBytes += entry.bytes;
  }
  if (totalBytes > descriptor.retention.maxBytes) {
    result.warnings.push(
      `${descriptor.id}: protected cache entries retain ${totalBytes} bytes, exceeding the ${descriptor.retention.maxBytes}-byte quota`
    );
  }
}

async function inspectCacheEntry(
  root: string,
  entryPath: string,
  protectedEntry: boolean,
  now: number,
  result: CacheMaintenanceResult
): Promise<CacheEntryInfo | null> {
  assertDirectCacheChild(root, entryPath);
  const rootInfo = await lstat(entryPath);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    return null;
  }
  let bytes = 0;
  let modifiedAtMs = rootInfo.mtimeMs;
  const queue = [entryPath];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }
    const children = await readdir(current, {
      withFileTypes: true
    });
    for (const child of children) {
      const childPath = join(current, child.name);
      assertInsideRoot(root, childPath);
      if (child.isSymbolicLink()) {
        continue;
      }
      const childInfo = await stat(childPath);
      modifiedAtMs = Math.max(
        modifiedAtMs,
        childInfo.mtimeMs
      );
      if (childInfo.isDirectory()) {
        queue.push(childPath);
        continue;
      }
      if (!childInfo.isFile()) {
        continue;
      }
      if (
        child.name.endsWith(".tmp") &&
        now - childInfo.mtimeMs >
          TEMPORARY_FILE_MAX_AGE_MS
      ) {
        await unlink(childPath);
        result.removedTemporaryFiles += 1;
        continue;
      }
      bytes += childInfo.size;
    }
  }
  return {
    name: basename(entryPath),
    path: entryPath,
    bytes,
    modifiedAtMs,
    protected: protectedEntry
  };
}

async function removeCacheEntry(
  root: string,
  entryPath: string
): Promise<boolean> {
  try {
    assertDirectCacheChild(root, entryPath);
    const info = await lstat(entryPath);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      return false;
    }
    await rm(entryPath, {
      recursive: true,
      force: true,
      maxRetries: 2,
      retryDelay: 50
    });
    return true;
  } catch {
    return false;
  }
}

function assertDirectCacheChild(
  root: string,
  entryPath: string
): void {
  const resolvedRoot = resolve(root);
  const resolvedEntry = resolve(entryPath);
  assertInsideRoot(resolvedRoot, resolvedEntry);
  if (
    dirname(resolvedEntry) !== resolvedRoot ||
    !CACHE_ENTRY_PATTERN.test(basename(resolvedEntry))
  ) {
    throw new Error(
      `Refusing to modify an unexpected cache path: ${entryPath}`
    );
  }
}

function assertInsideRoot(root: string, path: string): void {
  const relativePath = relative(resolve(root), resolve(path));
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..\\`) ||
    relativePath.startsWith("../") ||
    isAbsolute(relativePath)
  ) {
    throw new Error(
      `Cache path escapes the configured root: ${path}`
    );
  }
}

function getErrorCode(error: unknown): string | undefined {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown cache maintenance error.";
}
