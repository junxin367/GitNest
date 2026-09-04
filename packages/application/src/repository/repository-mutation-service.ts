import {
  GitError,
  type CreatedCommit,
  type GitClient,
  type GitMutationClient,
  type RepositorySnapshot
} from "@gitnest/git-core";
import type {
  RepositoryTarget
} from "@gitnest/workspace-core";

import type {
  WorktreeMutationCompleted,
  WorktreeMutationKind
} from "../workspace/workspace-runtime-service";

const MAX_MUTATION_PATHS = 200;
const MAX_RELATIVE_PATH_LENGTH = 4_096;
const MAX_COMMIT_SUBJECT_LENGTH = 200;
const MAX_COMMIT_BODY_LENGTH = 100_000;

export interface RepositoryMutationRuntime {
  runWorktreeMutation<Result>(
    target: RepositoryTarget,
    kind: WorktreeMutationKind,
    action: (worktreePath: string) => Promise<Result>
  ): Promise<WorktreeMutationCompleted<Result>>;
}

export interface RepositoryPathsMutationResult {
  target: RepositoryTarget;
  operationId: string;
}

export interface RepositoryCommitMutationResult
  extends RepositoryPathsMutationResult {
  commit: CreatedCommit;
}

export class RepositoryMutationService {
  readonly #runtime: RepositoryMutationRuntime;
  readonly #gitReader: GitClient;
  readonly #gitWriter: GitMutationClient;

  constructor(
    runtime: RepositoryMutationRuntime,
    gitReader: GitClient,
    gitWriter: GitMutationClient
  ) {
    this.#runtime = runtime;
    this.#gitReader = gitReader;
    this.#gitWriter = gitWriter;
  }

  async stage(
    target: RepositoryTarget,
    paths: readonly string[]
  ): Promise<RepositoryPathsMutationResult> {
    const requestedPaths = validateMutationPaths(paths);
    const completed = await this.#runtime.runWorktreeMutation(
      target,
      "stage",
      async (worktreePath) => {
        const snapshot =
          await this.#gitReader.readRepositorySnapshot(
            worktreePath
          );
        assertCurrentMutationPaths(
          requestedPaths,
          snapshot,
          "stage"
        );
        await this.#gitWriter.stagePaths(
          worktreePath,
          requestedPaths
        );
      }
    );

    return {
      target,
      operationId: completed.operationId
    };
  }

  async unstage(
    target: RepositoryTarget,
    paths: readonly string[]
  ): Promise<RepositoryPathsMutationResult> {
    const requestedPaths = validateMutationPaths(paths);
    const completed = await this.#runtime.runWorktreeMutation(
      target,
      "unstage",
      async (worktreePath) => {
        const snapshot =
          await this.#gitReader.readRepositorySnapshot(
            worktreePath
          );
        assertCurrentMutationPaths(
          requestedPaths,
          snapshot,
          "unstage"
        );
        await this.#gitWriter.unstagePaths(
          worktreePath,
          requestedPaths
        );
      }
    );

    return {
      target,
      operationId: completed.operationId
    };
  }

  async commit(
    target: RepositoryTarget,
    subject: string,
    body?: string
  ): Promise<RepositoryCommitMutationResult> {
    const message = validateCommitMessage(subject, body);
    const completed = await this.#runtime.runWorktreeMutation(
      target,
      "commit",
      async (worktreePath) => {
        const snapshot =
          await this.#gitReader.readRepositorySnapshot(
            worktreePath
          );

        if (snapshot.conflicted > 0) {
          throw new GitError(
            "INVALID_REQUEST",
            "Resolve and stage all conflicts before committing."
          );
        }

        if (snapshot.staged === 0) {
          throw new GitError(
            "INVALID_REQUEST",
            "A commit requires at least one staged change."
          );
        }

        return this.#gitWriter.createCommit(worktreePath, {
          subject: message.subject,
          ...(message.body ? { body: message.body } : {})
        });
      }
    );

    return {
      target,
      operationId: completed.operationId,
      commit: completed.result
    };
  }
}

function validateMutationPaths(
  paths: readonly string[]
): string[] {
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    paths.length > MAX_MUTATION_PATHS
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `Repository mutations require between 1 and ${MAX_MUTATION_PATHS} paths.`
    );
  }

  const validated = paths.map((path) => {
    if (
      typeof path !== "string" ||
      !path ||
      path.length > MAX_RELATIVE_PATH_LENGTH ||
      path === "." ||
      path.includes("\0") ||
      isAbsoluteMutationPath(path) ||
      path
        .split(/[\\/]+/)
        .some((segment) => segment === ".." || segment === ".")
    ) {
      throw new GitError(
        "INVALID_REQUEST",
        "Mutation paths must be exact relative paths inside the Worktree."
      );
    }

    return path;
  });

  if (new Set(validated).size !== validated.length) {
    throw new GitError(
      "INVALID_REQUEST",
      "Mutation paths must not contain duplicates."
    );
  }

  return validated;
}

function isAbsoluteMutationPath(path: string): boolean {
  return (
    /^[a-zA-Z]:/.test(path) ||
    path.startsWith("/") ||
    path.startsWith("\\")
  );
}

function assertCurrentMutationPaths(
  requestedPaths: readonly string[],
  snapshot: RepositorySnapshot,
  kind: "stage" | "unstage"
): void {
  const allowedPaths = new Set<string>();

  for (const change of snapshot.changes) {
    const eligible =
      kind === "stage"
        ? change.kind === "untracked" ||
          change.kind === "unmerged" ||
          change.worktreeStatus !== "."
        : change.kind !== "untracked" &&
          (change.kind === "unmerged" ||
            change.indexStatus !== ".");

    if (eligible) {
      allowedPaths.add(change.path);
      if (change.originalPath) {
        allowedPaths.add(change.originalPath);
      }
    }
  }

  const unavailable = requestedPaths.filter(
    (path) => !allowedPaths.has(path)
  );
  if (unavailable.length > 0) {
    throw new GitError(
      "INVALID_REQUEST",
      `Requested paths are no longer eligible for ${kind}.`,
      { unavailableCount: unavailable.length }
    );
  }
}

function validateCommitMessage(
  subjectValue: string,
  bodyValue?: string
): {
  subject: string;
  body?: string;
} {
  const subject = subjectValue.trim();
  const body = bodyValue?.trim();

  if (
    !subject ||
    subject.length > MAX_COMMIT_SUBJECT_LENGTH ||
    subject.includes("\0") ||
    /[\r\n]/.test(subject)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `Commit subjects must be a single non-empty line of at most ${MAX_COMMIT_SUBJECT_LENGTH} characters.`
    );
  }

  if (
    body !== undefined &&
    (body.length > MAX_COMMIT_BODY_LENGTH ||
      body.includes("\0"))
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `Commit bodies must contain at most ${MAX_COMMIT_BODY_LENGTH} characters and no null bytes.`
    );
  }

  return {
    subject,
    ...(body ? { body } : {})
  };
}
