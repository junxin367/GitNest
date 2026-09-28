import type {
  RepositoryProbe,
  RepositoryProbeResult
} from "../ports/repository-probe";
import type {
  WorkspaceFileSystem
} from "../ports/workspace-filesystem";
import type {
  WorkspaceRoot,
  WorkspaceScanIssue
} from "../domain/workspace";
import { WorkspaceError } from "../errors/workspace-error";

export const DEFAULT_WORKSPACE_EXCLUDES = [
  ".git",
  ".cache",
  ".next",
  ".pnpm",
  ".temp",
  ".tmp",
  ".turbo",
  ".venv",
  "build",
  "cache",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "temp",
  "tmp",
  "vendor"
] as const;

export interface DiscoveredRepository {
  path: string;
  canonicalPath: string;
  relativeSegments: string[];
  repository: RepositoryProbeResult;
}

export interface WorkspaceRootScan {
  root: WorkspaceRoot;
  repositories: DiscoveredRepository[];
  issues: WorkspaceScanIssue[];
  scannedAt: string;
}

export interface WorkspaceScanOptions {
  signal?: AbortSignal;
  scannedAt?: string;
}

export class WorkspaceScanner {
  readonly #fileSystem: WorkspaceFileSystem;
  readonly #repositoryProbe: RepositoryProbe;

  constructor(
    fileSystem: WorkspaceFileSystem,
    repositoryProbe: RepositoryProbe
  ) {
    this.#fileSystem = fileSystem;
    this.#repositoryProbe = repositoryProbe;
  }

  async scanRoot(
    root: WorkspaceRoot,
    options: WorkspaceScanOptions = {}
  ): Promise<WorkspaceRootScan> {
    assertNotCancelled(options.signal);

    const normalizedRoot = this.#fileSystem.normalizePath(root.path);
    const normalizedDefinition: WorkspaceRoot = {
      ...root,
      path: normalizedRoot.path,
      canonicalPath: normalizedRoot.canonicalPath
    };
    const repositories: DiscoveredRepository[] = [];
    const issues: WorkspaceScanIssue[] = [];
    const visitedRealPaths = new Set<string>();
    let rootRealPath: string;

    try {
      rootRealPath = await this.#fileSystem.resolveRealPath(
        normalizedDefinition.path
      );
    } catch (error) {
      issues.push(
        createFileSystemIssue(normalizedDefinition.path, error)
      );
      return {
        root: normalizedDefinition,
        repositories,
        issues,
        scannedAt:
          options.scannedAt ?? new Date().toISOString()
      };
    }

    const normalizedRootRealPath =
      this.#fileSystem.normalizePath(rootRealPath);
    const excludedNames = new Set<string>();
    for (const value of DEFAULT_WORKSPACE_EXCLUDES) {
      const normalizedExclude = normalizeExclude(value);
      if (normalizedExclude) {
        excludedNames.add(normalizedExclude);
      }
    }
    const excludedRelativePaths = new Set(
      root.excludes
        .map(normalizeExclude)
        .filter(Boolean)
    );

    const visit = async (
      directoryPath: string,
      rootDirectory: boolean
    ): Promise<void> => {
      assertNotCancelled(options.signal);

      let resolvedPath: string;

      try {
        resolvedPath =
          await this.#fileSystem.resolveRealPath(directoryPath);
      } catch (error) {
        issues.push(createFileSystemIssue(directoryPath, error));
        return;
      }

      const normalizedRealPath =
        this.#fileSystem.normalizePath(resolvedPath);

      if (
        !this.#fileSystem.isWithin(
          normalizedRootRealPath.path,
          normalizedRealPath.path
        )
      ) {
        issues.push({
          path: directoryPath,
          code: "OUTSIDE_ROOT_LINK_SKIPPED",
          message:
            "已跳过解析到 Workspace 根目录之外的链接目录。"
        });
        return;
      }

      if (
        visitedRealPaths.has(normalizedRealPath.canonicalPath)
      ) {
        issues.push({
          path: directoryPath,
          code: "SYMLINK_LOOP_SKIPPED",
          message:
            "已跳过解析到已扫描位置的目录，避免循环扫描。"
        });
        return;
      }

      visitedRealPaths.add(normalizedRealPath.canonicalPath);

      let entries;

      try {
        entries = await this.#fileSystem.readDirectory(
          directoryPath
        );
      } catch (error) {
        issues.push(createFileSystemIssue(directoryPath, error));
        return;
      }

      const hasGitMarker = entries.some(
        (entry) => entry.name.toLocaleLowerCase() === ".git"
      );
      let repositoryFound = false;

      if (hasGitMarker) {
        try {
          const repository =
            await this.#repositoryProbe.inspectRepository(
              directoryPath,
              options.signal
            );
          const normalizedDirectory =
            this.#fileSystem.normalizePath(directoryPath);

          repositories.push({
            path: normalizedDirectory.path,
            canonicalPath: normalizedDirectory.canonicalPath,
            relativeSegments:
              this.#fileSystem.relativeSegments(
                normalizedDefinition.path,
                normalizedDirectory.path
              ),
            repository
          });
          repositoryFound = true;
        } catch (error) {
          if (isCancellation(error)) {
            throw new WorkspaceError(
              "SCAN_CANCELLED",
              "Workspace 扫描已取消。"
            );
          }

          issues.push({
            path: directoryPath,
            code: "REPOSITORY_UNAVAILABLE",
            message: getErrorMessage(
              error,
              "无法读取该 Git 仓库。"
            )
          });
        }
      }

      if (repositoryFound && !rootDirectory) {
        return;
      }

      const children = entries
        .filter(
          (entry) => {
            if (
              entry.kind !== "directory" &&
              entry.kind !== "symbolic-link"
            ) {
              return false;
            }
            const relativePath = this.#fileSystem
              .relativeSegments(
                normalizedDefinition.path,
                entry.path
              )
              .join("/")
              .toLocaleLowerCase();
            return (
              !excludedNames.has(
                entry.name.toLocaleLowerCase()
              ) &&
              !excludedRelativePaths.has(relativePath)
            );
          }
        )
        .sort((left, right) =>
          left.name.localeCompare(right.name, undefined, {
            sensitivity: "base"
          })
        );

      for (const child of children) {
        await visit(child.path, false);
      }
    };

    await visit(normalizedDefinition.path, true);

    return {
      root: normalizedDefinition,
      repositories,
      issues,
      scannedAt: options.scannedAt ?? new Date().toISOString()
    };
  }
}

function normalizeExclude(value: string): string {
  return value
    .trim()
    .split(/[\\/]+/u)
    .filter((segment) => segment && segment !== ".")
    .join("/")
    .toLocaleLowerCase();
}

function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new WorkspaceError(
      "SCAN_CANCELLED",
      "Workspace 扫描已取消。"
    );
  }
}

function createFileSystemIssue(
  path: string,
  error: unknown
): WorkspaceScanIssue {
  const code = getErrorCode(error);

  if (code === "EACCES" || code === "EPERM") {
    return {
      path,
      code: "PERMISSION_DENIED",
      message: "目录访问被拒绝，已跳过该局部路径。"
    };
  }

  return {
    path,
    code: "DIRECTORY_UNAVAILABLE",
    message: getErrorMessage(error, "目录当前不可用。")
  };
}

function getErrorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return undefined;
}

function getErrorMessage(
  error: unknown,
  fallback: string
): string {
  return error instanceof Error && error.message
    ? error.message
    : fallback;
}

function isCancellation(error: unknown): boolean {
  return (
    error instanceof WorkspaceError &&
    error.code === "SCAN_CANCELLED"
  ) || (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "COMMAND_CANCELLED"
  );
}
