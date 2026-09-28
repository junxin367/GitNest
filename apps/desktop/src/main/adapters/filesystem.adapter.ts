import {
  lstat,
  readdir,
  realpath
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep
} from "node:path";

import type {
  NormalizedWorktreePath,
  WorktreePathInspection,
  WorktreePathPolicy
} from "@gitnest/application";
import { GitError } from "@gitnest/git-core";
import {
  WorkspaceError,
  type NormalizedWorkspacePath,
  type WorkspaceDirectoryEntry,
  type WorkspaceFileSystem
} from "@gitnest/workspace-core";

const MAX_PATH_LENGTH = 32_767;
const DEFAULT_SELECTION_TTL_MS = 10 * 60_000;
const MAX_SELECTION_GRANTS = 16;

export class NodeWorkspaceFileSystem
  implements WorkspaceFileSystem
{
  normalizePath(path: string): NormalizedWorkspacePath {
    if (!path || path.includes("\0") || !isAbsolute(path)) {
      throw new WorkspaceError(
        "INVALID_REQUEST",
        "Workspace paths must be absolute and contain no null bytes."
      );
    }

    const normalizedPath = normalize(resolve(path));
    return {
      path: normalizedPath,
      canonicalPath:
        process.platform === "win32"
          ? normalizedPath.toLocaleLowerCase("en-US")
          : normalizedPath
    };
  }

  basename(path: string): string {
    return basename(path);
  }

  joinPath(parent: string, child: string): string {
    return join(parent, child);
  }

  relativeSegments(parent: string, child: string): string[] {
    const value = relative(parent, child);
    return value
      ? value.split(/[\\/]+/).filter(Boolean)
      : [];
  }

  isWithin(parent: string, child: string): boolean {
    const value = relative(parent, child);
    return (
      value === "" ||
      (!value.startsWith("..") && !isAbsolute(value))
    );
  }

  pathDepth(path: string): number {
    return resolve(path).split(sep).filter(Boolean).length;
  }

  resolveRealPath(path: string): Promise<string> {
    return realpath(path);
  }

  async readDirectory(
    path: string
  ): Promise<WorkspaceDirectoryEntry[]> {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      path: join(path, entry.name),
      kind: entry.isSymbolicLink()
        ? "symbolic-link"
        : entry.isDirectory()
          ? "directory"
          : entry.isFile()
            ? "file"
            : "other"
    }));
  }
}

export interface NodeWorktreePathPolicyOptions {
  selectionTtlMs?: number;
  now?: () => number;
}

export class NodeWorktreePathPolicy
  implements WorktreePathPolicy
{
  readonly #selectionTtlMs: number;
  readonly #now: () => number;
  readonly #selectionGrants = new Map<string, number>();

  constructor(options: NodeWorktreePathPolicyOptions = {}) {
    this.#selectionTtlMs =
      options.selectionTtlMs ?? DEFAULT_SELECTION_TTL_MS;
    this.#now = options.now ?? Date.now;
  }

  normalizePath(path: string): NormalizedWorktreePath {
    if (
      typeof path !== "string" ||
      !path ||
      path.length > MAX_PATH_LENGTH ||
      path.includes("\0") ||
      /[\r\n]/.test(path) ||
      !isAbsolute(path)
    ) {
      throw new GitError(
        "INVALID_REQUEST",
        `Worktree paths must be absolute single-line paths of at most ${MAX_PATH_LENGTH} characters.`
      );
    }
    const normalizedPath = normalize(resolve(path));
    return {
      path: normalizedPath,
      canonicalPath: canonicalizePlatformPath(
        normalizedPath
      )
    };
  }

  async inspectPath(
    path: string
  ): Promise<WorktreePathInspection> {
    const normalized = this.normalizePath(path);

    try {
      const info = await lstat(normalized.path);
      if (info.isSymbolicLink()) {
        return {
          ...normalized,
          exists: true,
          kind: "symbolic-link",
          empty: false
        };
      }
      const resolvedPath = this.normalizePath(
        await realpath(normalized.path)
      );
      if (info.isDirectory()) {
        const entries = await readdir(normalized.path);
        return {
          path: normalized.path,
          canonicalPath: resolvedPath.canonicalPath,
          exists: true,
          kind: "directory",
          empty: entries.length === 0
        };
      }
      return {
        path: normalized.path,
        canonicalPath: resolvedPath.canonicalPath,
        exists: true,
        kind: info.isFile() ? "file" : "other",
        empty: false
      };
    } catch (error) {
      if (!isFileSystemError(error, "ENOENT")) {
        throw new GitError(
          "DIRECTORY_UNAVAILABLE",
          `Unable to inspect Worktree path ${normalized.path}.`
        );
      }
    }

    return {
      path: normalized.path,
      canonicalPath:
        await this.#canonicalizeMissingPath(
          normalized.path
        ),
      exists: false,
      kind: "missing",
      empty: false
    };
  }

  isWithin(
    parentCanonicalPath: string,
    childCanonicalPath: string
  ): boolean {
    const value = relative(
      parentCanonicalPath,
      childCanonicalPath
    );
    return (
      value === "" ||
      (!value.startsWith("..") && !isAbsolute(value))
    );
  }

  isExplicitlySelected(canonicalPath: string): boolean {
    this.#removeExpiredSelections();
    return [...this.#selectionGrants.keys()].some(
      (selected) =>
        this.isWithin(selected, canonicalPath)
    );
  }

  async grantSelection(path: string): Promise<void> {
    const inspection = await this.inspectPath(path);
    if (
      !inspection.exists ||
      inspection.kind !== "directory"
    ) {
      throw new GitError(
        "INVALID_REQUEST",
        "Worktree path selections must resolve to an existing non-link directory."
      );
    }
    this.#removeExpiredSelections();
    this.#selectionGrants.set(
      inspection.canonicalPath,
      this.#now() + this.#selectionTtlMs
    );
    while (
      this.#selectionGrants.size > MAX_SELECTION_GRANTS
    ) {
      const oldest = this.#selectionGrants.keys().next()
        .value as string | undefined;
      if (!oldest) {
        break;
      }
      this.#selectionGrants.delete(oldest);
    }
  }

  async #canonicalizeMissingPath(
    path: string
  ): Promise<string> {
    const missingSegments: string[] = [];
    let current = path;

    for (let depth = 0; depth < 512; depth += 1) {
      try {
        const existingRealPath = await realpath(current);
        const resolved = resolve(
          existingRealPath,
          ...missingSegments.reverse()
        );
        return this.normalizePath(resolved).canonicalPath;
      } catch (error) {
        if (!isFileSystemError(error, "ENOENT")) {
          throw new GitError(
            "DIRECTORY_UNAVAILABLE",
            `Unable to resolve the parent of Worktree path ${path}.`
          );
        }
      }

      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      missingSegments.push(basename(current));
      current = parent;
    }

    throw new GitError(
      "DIRECTORY_UNAVAILABLE",
      `Unable to resolve an existing parent for Worktree path ${path}.`
    );
  }

  #removeExpiredSelections(): void {
    const now = this.#now();
    for (const [path, expiresAt] of this.#selectionGrants) {
      if (expiresAt <= now) {
        this.#selectionGrants.delete(path);
      }
    }
  }
}

function canonicalizePlatformPath(path: string): string {
  return process.platform === "win32"
    ? path.toLocaleLowerCase("en-US")
    : path;
}

function isFileSystemError(
  error: unknown,
  code: string
): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === code
  );
}
