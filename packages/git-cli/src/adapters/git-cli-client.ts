import {
  lstat,
  open,
  readFile,
  realpath,
  stat
} from "node:fs/promises";
import {
  extname,
  isAbsolute,
  normalize,
  relative,
  resolve,
  sep
} from "node:path";

import {
  GitError,
  parseBranches,
  parseCommitMetadata,
  parseCommitNumstat,
  parseComparedCommitHistory,
  parseCommitHistory,
  parseRepositoryDiff,
  parseStashList,
  parseStatusPorcelainV2,
  parseWorktrees,
  reconcileStatOnlyUnstagedChanges,
  type GitClient,
  type GitCommitDiffClient,
  type GitEnvironment,
  type GitMutationClient,
  type GitRepositoryCommandClient,
  type GitStashClient,
  type GitWorktreeCommandClient,
  type GitReadOptions,
  type GitWriteOptions,
  type FetchRemoteOptions,
  type GitPullStrategy,
  type PushBranchOptions,
  type InspectRepositoryOptions,
  type CreateCommitOptions,
  type CreateWorktreeOptions,
  type LockWorktreeOptions,
  type ReadCommitHistoryOptions,
  type ReadCommitDiffOptions,
  type ReadRepositoryDiffOptions,
  type ReadRepositorySnapshotOptions,
  type ReadStashDiffOptions,
  type ReadStashesOptions,
  type Branch,
  type ChangedPath,
  type ChangedPathStats,
  type CreatedCommit,
  type GitAncestry,
  type RemoteBranchRef,
  type CommitDetails,
  type CommitDiff,
  type CommitHistoryPage,
  type RepositoryDiff,
  type RepositoryIdentity,
  type RepositoryInspection,
  type RepositoryMediaKind,
  type RepositoryMediaPreview,
  type RepositorySnapshot,
  type StashDiff,
  type StashFiles,
  type StashMutationAction,
  type StashSummary,
  type Worktree
} from "@gitnest/git-core";

import {
  BRANCH_ARGUMENTS,
  commitDiffArguments,
  commitParentsArguments,
  commitMetadataArguments,
  commitNumstatArguments,
  compareHistoryCountArguments,
  compareHistoryMergeBaseArguments,
  compareHistoryPageArguments,
  diffArguments,
  historyArguments,
  historyPageArguments,
  MERGED_REMOTE_BRANCH_ARGUMENTS,
  revisionFileContentArguments,
  revisionFileSizeArguments,
  resolveStashArguments,
  stashDiffArguments,
  stashFilesArguments,
  stashListArguments,
  stashUntrackedDiffArguments,
  stagedFileContentArguments,
  stagedFileSizeArguments,
  STAGED_DIFF_STAT_ARGUMENTS,
  STATUS_ARGUMENTS,
  UNSTAGED_DIFF_PATH_ARGUMENTS,
  WORKTREE_ARGUMENTS
} from "../commands/read-repository";
import {
  checkBranchNameArguments,
  createBranchArguments,
  deleteBranchArguments,
  fetchRemoteArguments,
  pullBranchArguments,
  pullFastForwardArguments,
  pushBranchArguments,
  READ_REMOTES_ARGUMENTS,
  readRemoteBranchesArguments,
  readRemoteUrlArguments,
  renameBranchArguments,
  resolveRevisionArguments,
  switchBranchArguments
} from "../commands/repository-operations";
import {
  createCommitArguments,
  removeUntrackedArguments,
  restoreWorktreeArguments,
  stageAllArguments,
  stageArguments,
  stashMutationArguments,
  unstageArguments
} from "../commands/write-repository";
import {
  createWorktreeArguments,
  lockWorktreeArguments,
  moveWorktreeArguments,
  PREVIEW_PRUNE_WORKTREES_ARGUMENTS,
  PRUNE_WORKTREES_ARGUMENTS,
  removeWorktreeArguments,
  repairWorktreesArguments,
  unlockWorktreeArguments
} from "../commands/worktree-operations";
import { findGitExecutable } from "../environment/find-git-executable";
import { readGitEnvironment } from "../environment/read-git-environment";
import {
  runProcess,
  runProcessBuffer
} from "../process/git-process-runner";

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 500;
const DEFAULT_HISTORY_PAGE_LIMIT = 50;
const MAX_HISTORY_PAGE_LIMIT = 100;
const DEFAULT_DIFF_CONTEXT_LINES = 3;
const MAX_DIFF_CONTEXT_LINES = 100_000;
const DIFF_OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024;
const COMMIT_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
const WRITE_OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024;
const DEFAULT_WRITE_TIMEOUT_MS = 60_000;
const DEFAULT_COMMIT_TIMEOUT_MS = 120_000;
const DEFAULT_NETWORK_TIMEOUT_MS = 180_000;
const REMOTE_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
const MAX_MUTATION_PATHS = 200;
const MAX_RELATIVE_PATH_LENGTH = 4_096;
const MAX_COMMIT_SUBJECT_LENGTH = 200;
const MAX_COMMIT_BODY_LENGTH = 100_000;
const MAX_WORKTREE_PATHS = 200;
const MAX_WORKTREE_PATH_LENGTH = 32_767;
const MAX_WORKTREE_LOCK_REASON_LENGTH = 512;
const MEDIA_PREVIEW_LIMIT_BYTES = 50 * 1024 * 1024;

interface MediaDescriptor {
  kind: RepositoryMediaKind;
  mimeType: string;
}

const MEDIA_DESCRIPTORS: Readonly<
  Record<string, MediaDescriptor>
> = {
  ".aac": { kind: "audio", mimeType: "audio/aac" },
  ".apng": { kind: "image", mimeType: "image/apng" },
  ".avif": { kind: "image", mimeType: "image/avif" },
  ".bmp": { kind: "image", mimeType: "image/bmp" },
  ".flac": { kind: "audio", mimeType: "audio/flac" },
  ".gif": { kind: "image", mimeType: "image/gif" },
  ".ico": { kind: "image", mimeType: "image/x-icon" },
  ".jpeg": { kind: "image", mimeType: "image/jpeg" },
  ".jpg": { kind: "image", mimeType: "image/jpeg" },
  ".m4a": { kind: "audio", mimeType: "audio/mp4" },
  ".m4v": { kind: "video", mimeType: "video/x-m4v" },
  ".mov": { kind: "video", mimeType: "video/quicktime" },
  ".mp3": { kind: "audio", mimeType: "audio/mpeg" },
  ".mp4": { kind: "video", mimeType: "video/mp4" },
  ".oga": { kind: "audio", mimeType: "audio/ogg" },
  ".ogg": { kind: "audio", mimeType: "audio/ogg" },
  ".ogv": { kind: "video", mimeType: "video/ogg" },
  ".opus": { kind: "audio", mimeType: "audio/ogg" },
  ".png": { kind: "image", mimeType: "image/png" },
  ".svg": { kind: "image", mimeType: "image/svg+xml" },
  ".wav": { kind: "audio", mimeType: "audio/wav" },
  ".webm": { kind: "video", mimeType: "video/webm" },
  ".webp": { kind: "image", mimeType: "image/webp" }
};

export interface GitRemoteCommandEnvironmentLease {
  environment: Readonly<
    Record<string, string | undefined>
  >;
  dispose(): Promise<void>;
}

export interface GitRemoteCommandEnvironmentContext {
  repositoryPath: string;
  remote: string;
  remoteUrl: string;
  signal?: AbortSignal;
}

export type GitRemoteCommandEnvironmentProvider = (
  context: GitRemoteCommandEnvironmentContext
) => Promise<
  GitRemoteCommandEnvironmentLease | undefined
>;

export interface GitCliClientOptions {
  remoteEnvironmentProvider?: GitRemoteCommandEnvironmentProvider;
}

export type GitRemoteConnectionStatus =
  | "verified"
  | "authentication-failed"
  | "permission-denied"
  | "unavailable";

export interface GitRemoteConnectionTestInput {
  repositoryUrl: string;
  environment: Readonly<
    Record<string, string | undefined>
  >;
  signal?: AbortSignal;
}

export class GitCliClient
  implements
    GitClient,
    GitCommitDiffClient,
    GitStashClient,
    GitMutationClient,
    GitRepositoryCommandClient,
    GitWorktreeCommandClient
{
  #executablePath: string | undefined;
  readonly #remoteEnvironmentProvider:
    | GitRemoteCommandEnvironmentProvider
    | undefined;

  constructor(options: GitCliClientOptions = {}) {
    this.#remoteEnvironmentProvider =
      options.remoteEnvironmentProvider;
  }

  async getEnvironment(
    options: GitReadOptions = {}
  ): Promise<GitEnvironment> {
    const executablePath = await this.#getExecutablePath(options.signal);
    return readGitEnvironment(executablePath, options);
  }

  async testRemoteConnection(
    input: GitRemoteConnectionTestInput
  ): Promise<GitRemoteConnectionStatus> {
    const repositoryUrl = validateRemoteConnectionUrl(
      input.repositoryUrl
    );
    const executablePath = await this.#getExecutablePath(
      input.signal
    );

    try {
      const result = await runProcess({
        executable: executablePath,
        args: [
          "ls-remote",
          "--heads",
          "--",
          repositoryUrl
        ],
        signal: input.signal,
        timeoutMs: DEFAULT_NETWORK_TIMEOUT_MS,
        outputLimitBytes: REMOTE_OUTPUT_LIMIT_BYTES,
        allowFailure: true,
        environment: input.environment
      });
      if (result.exitCode === 0) {
        return "verified";
      }
      return classifyRemoteConnectionFailure(
        `${result.stderr}\n${result.stdout}`
      );
    } catch (error) {
      if (
        error instanceof GitError &&
        error.code === "COMMAND_CANCELLED"
      ) {
        throw error;
      }
      return "unavailable";
    }
  }

  async readRepositorySnapshot(
    path: string,
    options: ReadRepositorySnapshotOptions = {}
  ): Promise<RepositorySnapshot> {
    const worktreePath = await validateDirectoryPath(path);
    const executablePath = await this.#getExecutablePath(options.signal);

    try {
      const result = await runProcess({
        executable: executablePath,
        cwd: worktreePath,
        args: STATUS_ARGUMENTS,
        signal: options.signal,
        timeoutMs: options.timeoutMs
      });
      return await reconcileRepositorySnapshot(
        parseStatusPorcelainV2(result.stdout),
        {
          executable: executablePath,
          cwd: worktreePath,
          signal: options.signal,
          timeoutMs: options.timeoutMs
        },
        options.includeChangeStats ?? false
      );
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async readRepositoryDiff(
    path: string,
    options: ReadRepositoryDiffOptions
  ): Promise<RepositoryDiff> {
    const worktreePath = await validateDirectoryPath(path);
    const relativePath = validateRelativePathspec(options.path);
    const contextLines = clampContextLines(options.contextLines);
    const executablePath = await this.#getExecutablePath(options.signal);

    try {
      const result = await runProcess({
        executable: executablePath,
        cwd: worktreePath,
        args: diffArguments(
          relativePath,
          options.mode,
          contextLines
        ),
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        outputLimitBytes: DIFF_OUTPUT_LIMIT_BYTES,
        truncateOutput: true,
        allowFailure: options.mode === "untracked"
      });

      if (
        options.mode === "untracked" &&
        ![0, 1].includes(result.exitCode)
      ) {
        throw new GitError(
          "COMMAND_FAILED",
          `Git diff exited with code ${result.exitCode}.`,
          {
            exitCode: result.exitCode,
            stderr: result.stderr.slice(0, 2_048)
          }
        );
      }

      const diff = parseRepositoryDiff(
        relativePath,
        options.mode,
        result.stdout,
        Boolean(result.outputTruncated)
      );
      const mediaDescriptor = options.includeMedia
        ? MEDIA_DESCRIPTORS[extname(relativePath).toLowerCase()]
        : undefined;

      if (!mediaDescriptor) {
        return diff;
      }

      return {
        ...diff,
        media: await readRepositoryMediaPreview(
          relativePath,
          options.mode,
          mediaDescriptor,
          {
            executable: executablePath,
            cwd: worktreePath,
            signal: options.signal,
            timeoutMs: options.timeoutMs
          }
        )
      };
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async readCommitHistory(
    path: string,
    options: ReadCommitHistoryOptions = {}
  ): Promise<CommitHistoryPage> {
    const worktreePath = await validateDirectoryPath(path);
    const executablePath = await this.#getExecutablePath(options.signal);
    const limit = clampHistoryPageLimit(options.limit);
    const offset = clampHistoryOffset(options.offset);
    const commandOptions = {
      executable: executablePath,
      cwd: worktreePath,
      signal: options.signal,
      timeoutMs: options.timeoutMs
    };

    try {
      if (
        !options.scope &&
        !(await repositoryHasHead({
          ...commandOptions
        }))
      ) {
        return { commits: [] };
      }

      if (options.scope?.kind === "compare") {
        const leftRef = await resolveHistoryRef(
          commandOptions,
          options.scope.leftRef
        );
        const rightRef = await resolveHistoryRef(
          commandOptions,
          options.scope.rightRef
        );
        if (leftRef === rightRef) {
          throw new GitError(
            "INVALID_REQUEST",
            "Compared history requires two different refs."
          );
        }

        const [historyResult, countResult, mergeBaseResult] =
          await Promise.all([
            runProcess({
              ...commandOptions,
              args: compareHistoryPageArguments(
                limit + 1,
                offset,
                leftRef,
                rightRef
              ),
              outputLimitBytes: COMMIT_OUTPUT_LIMIT_BYTES
            }),
            runProcess({
              ...commandOptions,
              args: compareHistoryCountArguments(
                leftRef,
                rightRef
              ),
              outputLimitBytes: 4_096
            }),
            runProcess({
              ...commandOptions,
              args: compareHistoryMergeBaseArguments(
                leftRef,
                rightRef
              ),
              allowFailure: true,
              outputLimitBytes: 4_096
            })
          ]);

        assertAllowFailureIsRepository(mergeBaseResult);
        if (
          mergeBaseResult.exitCode !== 0 &&
          !(
            mergeBaseResult.exitCode === 1 &&
            !mergeBaseResult.stderr.trim()
          )
        ) {
          throw commandFailure(
            "Git merge-base",
            mergeBaseResult
          );
        }
        const commits = parseComparedCommitHistory(
          historyResult.stdout
        );
        const hasMore = commits.length > limit;
        const { leftOnly, rightOnly } =
          parseHistoryComparisonCounts(countResult.stdout);
        const mergeBase =
          mergeBaseResult.exitCode === 0
            ? mergeBaseResult.stdout.trim().split(/\r?\n/)[0]
            : undefined;

        return {
          commits: commits.slice(0, limit),
          ...(hasMore
            ? { nextOffset: offset + limit }
            : {}),
          comparison: {
            leftRef,
            rightRef,
            leftOnly,
            rightOnly,
            ...(mergeBase ? { mergeBase } : {})
          }
        };
      }

      const ref =
        options.scope?.kind === "ref"
          ? await resolveHistoryRef(
              commandOptions,
              options.scope.ref
            )
          : undefined;
      const result = await runProcess({
        ...commandOptions,
        args: historyPageArguments(limit + 1, offset, ref),
        outputLimitBytes: COMMIT_OUTPUT_LIMIT_BYTES
      });
      const commits = parseCommitHistory(result.stdout);
      const hasMore = commits.length > limit;
      return {
        commits: commits.slice(0, limit),
        ...(hasMore ? { nextOffset: offset + limit } : {})
      };
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async readCommitDetails(
    path: string,
    commitHash: string,
    options: GitReadOptions = {}
  ): Promise<CommitDetails> {
    const worktreePath = await validateDirectoryPath(path);
    const normalizedHash = validateCommitHash(commitHash);
    const executablePath = await this.#getExecutablePath(options.signal);
    const commandOptions = {
      executable: executablePath,
      cwd: worktreePath,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      outputLimitBytes: COMMIT_OUTPUT_LIMIT_BYTES
    };

    try {
      const [metadataResult, numstatResult] = await Promise.all([
        runProcess({
          ...commandOptions,
          args: commitMetadataArguments(normalizedHash)
        }),
        runProcess({
          ...commandOptions,
          args: commitNumstatArguments(normalizedHash)
        })
      ]);
      return {
        ...parseCommitMetadata(metadataResult.stdout),
        ...parseCommitNumstat(numstatResult.stdout)
      };
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async readCommitDiff(
    path: string,
    options: ReadCommitDiffOptions
  ): Promise<CommitDiff> {
    const worktreePath = await validateDirectoryPath(path);
    const normalizedHash = validateCommitHash(
      options.commitHash
    );
    const relativePath = validateRelativePathspec(options.path);
    const contextLines = clampContextLines(options.contextLines);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );
    const commandOptions = {
      executable: executablePath,
      cwd: worktreePath,
      signal: options.signal,
      timeoutMs: options.timeoutMs
    };

    try {
      const parentResult = await runProcess({
        ...commandOptions,
        args: commitParentsArguments(normalizedHash),
        outputLimitBytes: 4_096
      });
      const { hash, firstParentHash } = parseCommitParents(
        parentResult.stdout
      );
      const result = await runProcess({
        ...commandOptions,
        args: commitDiffArguments(
          hash,
          firstParentHash,
          relativePath,
          contextLines
        ),
        outputLimitBytes: DIFF_OUTPUT_LIMIT_BYTES,
        truncateOutput: true
      });
      const diff = parseRepositoryDiff(
        relativePath,
        "unstaged",
        result.stdout,
        Boolean(result.outputTruncated)
      );
      const mediaDescriptor = options.includeMedia
        ? MEDIA_DESCRIPTORS[extname(relativePath).toLowerCase()]
        : undefined;
      return {
        path: diff.path,
        content: diff.content,
        binary: diff.binary,
        truncated: diff.truncated,
        additions: diff.additions,
        deletions: diff.deletions,
        ...(mediaDescriptor
          ? {
              media: await readRevisionMediaPreview(
                hash,
                relativePath,
                mediaDescriptor,
                commandOptions
              )
            }
          : {})
      };
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async readStashes(
    path: string,
    options: ReadStashesOptions = {}
  ): Promise<StashSummary[]> {
    const worktreePath = await validateDirectoryPath(path);
    const executablePath = await this.#getExecutablePath(options.signal);
    const limit = clampStashLimit(options.limit);
    const commandOptions = {
      executable: executablePath,
      cwd: worktreePath,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      outputLimitBytes: COMMIT_OUTPUT_LIMIT_BYTES
    };

    try {
      const listResult = await runProcess({
        ...commandOptions,
        args: stashListArguments(limit)
      });
      return parseStashList(listResult.stdout);
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async readStashFiles(
    path: string,
    stashRef: string,
    options: GitReadOptions = {}
  ): Promise<StashFiles> {
    const worktreePath = await validateDirectoryPath(path);
    const normalizedRef = validateStashRef(stashRef);
    const executablePath = await this.#getExecutablePath(options.signal);
    const commandOptions = {
      executable: executablePath,
      cwd: worktreePath,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      outputLimitBytes: COMMIT_OUTPUT_LIMIT_BYTES
    };

    try {
      const hashResult = await runProcess({
        ...commandOptions,
        args: resolveStashArguments(normalizedRef)
      });
      const hash = validateCommitHash(
        trimSingleLine(hashResult.stdout)
      );
      const statResult = await runProcess({
        ...commandOptions,
        args: stashFilesArguments(hash)
      });
      const stats = parseCommitNumstat(statResult.stdout);
      return {
        ref: normalizedRef,
        hash,
        ...stats
      };
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async readStashDiff(
    path: string,
    options: ReadStashDiffOptions
  ): Promise<StashDiff> {
    const worktreePath = await validateDirectoryPath(path);
    const normalizedRef = validateStashRef(options.stashRef);
    const relativePath = validateRelativePathspec(options.path);
    const contextLines = clampContextLines(options.contextLines);
    const executablePath = await this.#getExecutablePath(options.signal);
    const commandOptions = {
      executable: executablePath,
      cwd: worktreePath,
      signal: options.signal,
      timeoutMs: options.timeoutMs
    };

    try {
      const hashResult = await runProcess({
        ...commandOptions,
        args: resolveStashArguments(normalizedRef),
        outputLimitBytes: 4_096
      });
      const hash = validateCommitHash(
        trimSingleLine(hashResult.stdout)
      );
      const trackedDiffResult = await runProcess({
        ...commandOptions,
        args: stashDiffArguments(
          hash,
          relativePath,
          contextLines
        ),
        outputLimitBytes: DIFF_OUTPUT_LIMIT_BYTES,
        truncateOutput: true
      });
      let diffResult = trackedDiffResult;
      let mediaRevision = hash;
      if (!trackedDiffResult.stdout) {
        const untrackedDiffResult = await runProcess({
          ...commandOptions,
          args: stashUntrackedDiffArguments(
            hash,
            relativePath,
            contextLines
          ),
          allowFailure: true,
          outputLimitBytes: DIFF_OUTPUT_LIMIT_BYTES,
          truncateOutput: true
        });
        if (untrackedDiffResult.exitCode === 0) {
          diffResult = untrackedDiffResult;
          if (untrackedDiffResult.stdout) {
            mediaRevision = `${hash}^3`;
          }
        }
      }
      const diff = parseRepositoryDiff(
        relativePath,
        "unstaged",
        diffResult.stdout,
        Boolean(diffResult.outputTruncated)
      );
      const mediaDescriptor = options.includeMedia
        ? MEDIA_DESCRIPTORS[extname(relativePath).toLowerCase()]
        : undefined;

      return {
        ref: normalizedRef,
        hash,
        path: diff.path,
        content: diff.content,
        binary: diff.binary,
        truncated: diff.truncated,
        additions: diff.additions,
        deletions: diff.deletions,
        ...(mediaDescriptor
          ? {
              media: await readRevisionMediaPreview(
                mediaRevision,
                relativePath,
                mediaDescriptor,
                commandOptions
              )
            }
          : {})
      };
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async readBranches(
    path: string,
    options: GitReadOptions = {}
  ): Promise<Branch[]> {
    const worktreePath = await validateDirectoryPath(path);
    const executablePath = await this.#getExecutablePath(options.signal);

    try {
      const result = await runProcess({
        executable: executablePath,
        cwd: worktreePath,
        args: BRANCH_ARGUMENTS,
        signal: options.signal,
        timeoutMs: options.timeoutMs
      });
      const branches = parseBranches(result.stdout).map((branch) => ({
        ...branch,
        ...(branch.worktreePath
          ? {
              worktreePath: normalizeAbsoluteGitPath(
                branch.worktreePath
              )
            }
          : {})
      }));
      if (!branches.some((branch) => branch.remote)) {
        return branches;
      }
      const mergedResult = await runProcess({
        executable: executablePath,
        cwd: worktreePath,
        args: MERGED_REMOTE_BRANCH_ARGUMENTS,
        allowFailure: true,
        signal: options.signal,
        timeoutMs: options.timeoutMs
      });
      assertAllowFailureIsRepository(mergedResult);
      if (mergedResult.exitCode !== 0) {
        return branches;
      }
      const mergedRemoteRefs = new Set(
        mergedResult.stdout
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean)
      );

      return branches.map((branch) =>
        branch.remote
          ? {
              ...branch,
              merged: mergedRemoteRefs.has(branch.fullName)
            }
          : branch
      );
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async readRemotes(
    path: string,
    options: GitReadOptions = {}
  ): Promise<string[]> {
    const worktreePath = await validateDirectoryPath(path);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );

    try {
      const result = await runProcess({
        executable: executablePath,
        cwd: worktreePath,
        args: READ_REMOTES_ARGUMENTS,
        signal: options.signal,
        timeoutMs: options.timeoutMs
      });
      return [
        ...new Set(
          result.stdout
            .split(/\r?\n/)
            .map((value) => value.trim())
            .filter(Boolean)
            .map(validateRemoteName)
        )
      ];
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async readRemoteBranches(
    path: string,
    remote: string,
    options: GitReadOptions = {}
  ): Promise<RemoteBranchRef[]> {
    const worktreePath = await validateDirectoryPath(path);
    const remoteName = validateRemoteName(remote);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );

    try {
      return await this.#withRemoteEnvironment(
        worktreePath,
        remoteName,
        executablePath,
        options.signal,
        async (environment) => {
          const result = await runProcess({
            executable: executablePath,
            cwd: worktreePath,
            args: readRemoteBranchesArguments(remoteName),
            signal: options.signal,
            timeoutMs:
              options.timeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS,
            outputLimitBytes: REMOTE_OUTPUT_LIMIT_BYTES,
            environment
          });
          return parseRemoteBranchRefs(result.stdout);
        }
      );
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async checkBranchName(
    path: string,
    branch: string,
    options: GitReadOptions = {}
  ): Promise<boolean> {
    const worktreePath = await validateDirectoryPath(path);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );

    try {
      return validateBranchNameWithGit(
        {
          executable: executablePath,
          cwd: worktreePath,
          signal: options.signal,
          timeoutMs: options.timeoutMs
        },
        branch
      );
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async resolveRevision(
    path: string,
    revision: string,
    options: GitReadOptions = {}
  ): Promise<string> {
    const worktreePath = await validateDirectoryPath(path);
    const normalizedRevision = validateRevision(revision);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );

    try {
      const result = await runProcess({
        executable: executablePath,
        cwd: worktreePath,
        args: resolveRevisionArguments(normalizedRevision),
        signal: options.signal,
        timeoutMs: options.timeoutMs
      });
      return validateCommitHash(trimSingleLine(result.stdout));
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async compareAncestry(
    path: string,
    ancestor: string,
    descendant: string,
    options: GitReadOptions = {}
  ): Promise<GitAncestry> {
    const worktreePath = await validateDirectoryPath(path);
    const ancestorHash = validateCommitHash(ancestor);
    const descendantHash = validateCommitHash(descendant);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );
    const commandOptions = {
      executable: executablePath,
      cwd: worktreePath,
      signal: options.signal,
      timeoutMs: options.timeoutMs
    };

    try {
      const [ancestorExists, descendantExists] =
        await Promise.all([
          runProcess({
            ...commandOptions,
            args: [
              "cat-file",
              "-e",
              `${ancestorHash}^{commit}`
            ],
            allowFailure: true
          }),
          runProcess({
            ...commandOptions,
            args: [
              "cat-file",
              "-e",
              `${descendantHash}^{commit}`
            ],
            allowFailure: true
          })
        ]);
      assertAllowFailureIsRepository(ancestorExists);
      assertAllowFailureIsRepository(descendantExists);
      if (
        ancestorExists.exitCode !== 0 ||
        descendantExists.exitCode !== 0
      ) {
        return "unknown";
      }

      const result = await runProcess({
        ...commandOptions,
        args: [
          "merge-base",
          "--is-ancestor",
          ancestorHash,
          descendantHash
        ],
        allowFailure: true
      });
      if (result.exitCode === 0) {
        return "ancestor";
      }
      if (result.exitCode === 1) {
        const reverse = await runProcess({
          ...commandOptions,
          args: [
            "merge-base",
            "--is-ancestor",
            descendantHash,
            ancestorHash
          ],
          allowFailure: true
        });
        if (reverse.exitCode === 0) {
          return "descendant";
        }
        if (reverse.exitCode === 1) {
          return "diverged";
        }
        throw commandFailure("Git merge-base", reverse);
      }
      throw commandFailure("Git merge-base", result);
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async fetchRemote(
    path: string,
    remote: string,
    options: FetchRemoteOptions = {}
  ): Promise<void> {
    const worktreePath = await validateDirectoryPath(path);
    const remoteName = validateRemoteName(remote);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );

    try {
      await this.#withRemoteEnvironment(
        worktreePath,
        remoteName,
        executablePath,
        options.signal,
        (environment) =>
          runProcess({
            executable: executablePath,
            cwd: worktreePath,
            args: fetchRemoteArguments(
              remoteName,
              options.prune ?? false
            ),
            signal: options.signal,
            timeoutMs:
              options.timeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS,
            outputLimitBytes: REMOTE_OUTPUT_LIMIT_BYTES,
            discardOutputAfterLimit: true,
            writeIntent: true,
            environment
          }).then(() => undefined)
      );
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async pullFastForward(
    path: string,
    remote: string,
    remoteBranch: string,
    options: GitWriteOptions = {}
  ): Promise<void> {
    const worktreePath = await validateDirectoryPath(path);
    const remoteName = validateRemoteName(remote);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );

    try {
      await assertBranchName(
        {
          executable: executablePath,
          cwd: worktreePath,
          signal: options.signal,
          timeoutMs: options.timeoutMs
        },
        remoteBranch
      );
      await this.#withRemoteEnvironment(
        worktreePath,
        remoteName,
        executablePath,
        options.signal,
        (environment) =>
          runProcess({
            executable: executablePath,
            cwd: worktreePath,
            args: pullFastForwardArguments(
              remoteName,
              remoteBranch
            ),
            signal: options.signal,
            timeoutMs:
              options.timeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS,
            outputLimitBytes: REMOTE_OUTPUT_LIMIT_BYTES,
            discardOutputAfterLimit: true,
            writeIntent: true,
            environment
          }).then(() => undefined)
      );
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async pullBranch(
    path: string,
    remote: string,
    remoteBranch: string,
    strategy: GitPullStrategy,
    options: GitWriteOptions = {}
  ): Promise<void> {
    const worktreePath = await validateDirectoryPath(path);
    const remoteName = validateRemoteName(remote);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );

    try {
      await assertBranchName(
        {
          executable: executablePath,
          cwd: worktreePath,
          signal: options.signal,
          timeoutMs: options.timeoutMs
        },
        remoteBranch
      );
      await this.#withRemoteEnvironment(
        worktreePath,
        remoteName,
        executablePath,
        options.signal,
        (environment) =>
          runProcess({
            executable: executablePath,
            cwd: worktreePath,
            args: pullBranchArguments(
              remoteName,
              remoteBranch,
              strategy
            ),
            signal: options.signal,
            timeoutMs:
              options.timeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS,
            outputLimitBytes: REMOTE_OUTPUT_LIMIT_BYTES,
            discardOutputAfterLimit: true,
            writeIntent: true,
            environment
          }).then(() => undefined)
      );
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async pushBranch(
    path: string,
    options: PushBranchOptions
  ): Promise<void> {
    const worktreePath = await validateDirectoryPath(path);
    const remoteName = validateRemoteName(options.remote);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );
    const commandOptions = {
      executable: executablePath,
      cwd: worktreePath,
      signal: options.signal,
      timeoutMs: options.timeoutMs
    };

    try {
      await Promise.all([
        assertBranchName(commandOptions, options.localBranch),
        assertBranchName(commandOptions, options.remoteBranch)
      ]);
      const forceWithLeaseExpected =
        options.forceWithLeaseExpected === undefined
          ? undefined
          : validateCommitHash(
              options.forceWithLeaseExpected
            );
      await this.#withRemoteEnvironment(
        worktreePath,
        remoteName,
        executablePath,
        options.signal,
        (environment) =>
          runProcess({
            ...commandOptions,
            args: pushBranchArguments({
              remote: remoteName,
              localBranch: options.localBranch,
              remoteBranch: options.remoteBranch,
              setUpstream: options.setUpstream ?? false,
              ...(forceWithLeaseExpected
                ? { forceWithLeaseExpected }
                : {})
            }),
            timeoutMs:
              options.timeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS,
            outputLimitBytes: REMOTE_OUTPUT_LIMIT_BYTES,
            discardOutputAfterLimit: true,
            writeIntent: true,
            environment
          }).then(() => undefined)
      );
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async createBranch(
    path: string,
    branch: string,
    startPoint: string,
    options: GitWriteOptions = {}
  ): Promise<void> {
    const worktreePath = await validateDirectoryPath(path);
    const startPointHash = validateCommitHash(startPoint);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );
    const commandOptions = {
      executable: executablePath,
      cwd: worktreePath,
      signal: options.signal,
      timeoutMs: options.timeoutMs
    };

    try {
      await assertBranchName(commandOptions, branch);
      await runProcess({
        ...commandOptions,
        args: createBranchArguments(branch, startPointHash),
        timeoutMs:
          options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS,
        outputLimitBytes: WRITE_OUTPUT_LIMIT_BYTES,
        discardOutputAfterLimit: true,
        writeIntent: true
      });
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async switchBranch(
    path: string,
    branch: string,
    options: GitWriteOptions = {}
  ): Promise<void> {
    const worktreePath = await validateDirectoryPath(path);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );
    const commandOptions = {
      executable: executablePath,
      cwd: worktreePath,
      signal: options.signal,
      timeoutMs: options.timeoutMs
    };

    try {
      await assertBranchName(commandOptions, branch);
      await runProcess({
        ...commandOptions,
        args: switchBranchArguments(branch),
        timeoutMs:
          options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS,
        outputLimitBytes: WRITE_OUTPUT_LIMIT_BYTES,
        discardOutputAfterLimit: true,
        writeIntent: true
      });
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async renameBranch(
    path: string,
    branch: string,
    newName: string,
    options: GitWriteOptions = {}
  ): Promise<void> {
    const worktreePath = await validateDirectoryPath(path);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );
    const commandOptions = {
      executable: executablePath,
      cwd: worktreePath,
      signal: options.signal,
      timeoutMs: options.timeoutMs
    };

    try {
      await Promise.all([
        assertBranchName(commandOptions, branch),
        assertBranchName(commandOptions, newName)
      ]);
      await runProcess({
        ...commandOptions,
        args: renameBranchArguments(branch, newName),
        timeoutMs:
          options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS,
        outputLimitBytes: WRITE_OUTPUT_LIMIT_BYTES,
        discardOutputAfterLimit: true,
        writeIntent: true
      });
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async deleteBranch(
    path: string,
    branch: string,
    options: GitWriteOptions = {}
  ): Promise<void> {
    const worktreePath = await validateDirectoryPath(path);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );
    const commandOptions = {
      executable: executablePath,
      cwd: worktreePath,
      signal: options.signal,
      timeoutMs: options.timeoutMs
    };

    try {
      await assertBranchName(commandOptions, branch);
      await runProcess({
        ...commandOptions,
        args: deleteBranchArguments(branch),
        timeoutMs:
          options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS,
        outputLimitBytes: WRITE_OUTPUT_LIMIT_BYTES,
        discardOutputAfterLimit: true,
        writeIntent: true
      });
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async readWorktrees(
    path: string,
    options: GitReadOptions = {}
  ): Promise<Worktree[]> {
    const repositoryPath = await validateDirectoryPath(path);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );

    try {
      const result = await runProcess({
        executable: executablePath,
        cwd: repositoryPath,
        args: WORKTREE_ARGUMENTS,
        signal: options.signal,
        timeoutMs: options.timeoutMs
      });
      return parseWorktrees(result.stdout).map(
        normalizeWorktree
      );
    } catch (error) {
      throw mapRepositoryError(error, repositoryPath);
    }
  }

  async createWorktree(
    path: string,
    destination: string,
    options: CreateWorktreeOptions
  ): Promise<void> {
    const repositoryPath = await validateDirectoryPath(path);
    const destinationPath =
      validateWorktreePathInput(destination);
    const startPoint = validateCommitHash(
      options.startPoint
    );
    const executablePath = await this.#getExecutablePath(
      options.signal
    );
    const commandOptions = {
      executable: executablePath,
      cwd: repositoryPath,
      signal: options.signal,
      timeoutMs: options.timeoutMs
    };

    try {
      const mode = validateCreateWorktreeMode(options);
      const branch = mode.branch
        ? await assertBranchName(
            commandOptions,
            mode.branch
          )
        : undefined;
      await runProcess({
        ...commandOptions,
        args: createWorktreeArguments({
          destination: destinationPath,
          startPoint,
          ...(branch ? { branch } : {}),
          createBranch: mode.createBranch,
          detached: mode.detached
        }),
        timeoutMs:
          options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS,
        outputLimitBytes: WRITE_OUTPUT_LIMIT_BYTES,
        discardOutputAfterLimit: true,
        writeIntent: true
      });
    } catch (error) {
      throw mapRepositoryError(error, repositoryPath);
    }
  }

  async previewPruneWorktrees(
    path: string,
    options: GitReadOptions = {}
  ): Promise<Worktree[]> {
    const repositoryPath = await validateDirectoryPath(path);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );

    try {
      const beforeResult = await runProcess({
        executable: executablePath,
        cwd: repositoryPath,
        args: WORKTREE_ARGUMENTS,
        signal: options.signal,
        timeoutMs: options.timeoutMs
      });
      await runProcess({
        executable: executablePath,
        cwd: repositoryPath,
        args: PREVIEW_PRUNE_WORKTREES_ARGUMENTS,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        outputLimitBytes: WRITE_OUTPUT_LIMIT_BYTES,
        discardOutputAfterLimit: true
      });
      const afterResult = await runProcess({
        executable: executablePath,
        cwd: repositoryPath,
        args: WORKTREE_ARGUMENTS,
        signal: options.signal,
        timeoutMs: options.timeoutMs
      });
      const before = selectPrunableWorktrees(
        beforeResult.stdout
      );
      const after = selectPrunableWorktrees(
        afterResult.stdout
      );
      if (
        JSON.stringify(before) !== JSON.stringify(after)
      ) {
        throw new GitError(
          "PREFLIGHT_CHANGED",
          "Worktree prune candidates changed during dry-run."
        );
      }
      return after;
    } catch (error) {
      throw mapRepositoryError(error, repositoryPath);
    }
  }

  async lockWorktree(
    path: string,
    worktreePath: string,
    options: LockWorktreeOptions = {}
  ): Promise<void> {
    const repositoryPath = await validateDirectoryPath(path);
    const targetPath =
      validateWorktreePathInput(worktreePath);
    const reason = validateWorktreeLockReason(
      options.reason
    );
    const executablePath = await this.#getExecutablePath(
      options.signal
    );

    try {
      await runProcess({
        executable: executablePath,
        cwd: repositoryPath,
        args: lockWorktreeArguments(targetPath, reason),
        signal: options.signal,
        timeoutMs:
          options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS,
        outputLimitBytes: WRITE_OUTPUT_LIMIT_BYTES,
        discardOutputAfterLimit: true,
        writeIntent: true
      });
    } catch (error) {
      throw mapRepositoryError(error, repositoryPath);
    }
  }

  async unlockWorktree(
    path: string,
    worktreePath: string,
    options: GitWriteOptions = {}
  ): Promise<void> {
    const repositoryPath = await validateDirectoryPath(path);
    const targetPath =
      validateWorktreePathInput(worktreePath);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );

    try {
      await runProcess({
        executable: executablePath,
        cwd: repositoryPath,
        args: unlockWorktreeArguments(targetPath),
        signal: options.signal,
        timeoutMs:
          options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS,
        outputLimitBytes: WRITE_OUTPUT_LIMIT_BYTES,
        discardOutputAfterLimit: true,
        writeIntent: true
      });
    } catch (error) {
      throw mapRepositoryError(error, repositoryPath);
    }
  }

  async moveWorktree(
    path: string,
    worktreePath: string,
    destination: string,
    options: GitWriteOptions = {}
  ): Promise<void> {
    const repositoryPath = await validateDirectoryPath(path);
    const targetPath =
      validateWorktreePathInput(worktreePath);
    const destinationPath =
      validateWorktreePathInput(destination);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );

    try {
      await runProcess({
        executable: executablePath,
        cwd: repositoryPath,
        args: moveWorktreeArguments(
          targetPath,
          destinationPath
        ),
        signal: options.signal,
        timeoutMs:
          options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS,
        outputLimitBytes: WRITE_OUTPUT_LIMIT_BYTES,
        discardOutputAfterLimit: true,
        writeIntent: true
      });
    } catch (error) {
      throw mapRepositoryError(error, repositoryPath);
    }
  }

  async repairWorktrees(
    path: string,
    worktreePaths: readonly string[],
    options: GitWriteOptions = {}
  ): Promise<void> {
    const repositoryPath = await validateDirectoryPath(path);
    const targetPaths =
      validateWorktreePathInputs(worktreePaths);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );

    try {
      await runProcess({
        executable: executablePath,
        cwd: repositoryPath,
        args: repairWorktreesArguments(targetPaths),
        signal: options.signal,
        timeoutMs:
          options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS,
        outputLimitBytes: WRITE_OUTPUT_LIMIT_BYTES,
        discardOutputAfterLimit: true,
        writeIntent: true
      });
    } catch (error) {
      throw mapRepositoryError(error, repositoryPath);
    }
  }

  async pruneWorktrees(
    path: string,
    options: GitWriteOptions = {}
  ): Promise<void> {
    const repositoryPath = await validateDirectoryPath(path);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );

    try {
      await runProcess({
        executable: executablePath,
        cwd: repositoryPath,
        args: PRUNE_WORKTREES_ARGUMENTS,
        signal: options.signal,
        timeoutMs:
          options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS,
        outputLimitBytes: WRITE_OUTPUT_LIMIT_BYTES,
        discardOutputAfterLimit: true,
        writeIntent: true
      });
    } catch (error) {
      throw mapRepositoryError(error, repositoryPath);
    }
  }

  async removeWorktree(
    path: string,
    worktreePath: string,
    options: GitWriteOptions = {}
  ): Promise<void> {
    const repositoryPath = await validateDirectoryPath(path);
    const targetPath =
      validateWorktreePathInput(worktreePath);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );

    try {
      await runProcess({
        executable: executablePath,
        cwd: repositoryPath,
        args: removeWorktreeArguments(targetPath),
        signal: options.signal,
        timeoutMs:
          options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS,
        outputLimitBytes: WRITE_OUTPUT_LIMIT_BYTES,
        discardOutputAfterLimit: true,
        writeIntent: true
      });
    } catch (error) {
      throw mapRepositoryError(error, repositoryPath);
    }
  }

  async stagePaths(
    path: string,
    paths: readonly string[],
    options: GitWriteOptions = {}
  ): Promise<void> {
    const worktreePath = await validateDirectoryPath(path);
    const relativePaths = validateRelativePathspecs(paths);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );

    try {
      await runProcess({
        executable: executablePath,
        cwd: worktreePath,
        args: stageArguments(relativePaths),
        signal: options.signal,
        timeoutMs:
          options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS,
        outputLimitBytes: WRITE_OUTPUT_LIMIT_BYTES,
        discardOutputAfterLimit: true,
        writeIntent: true
      });
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async stageAll(
    path: string,
    options: GitWriteOptions = {}
  ): Promise<void> {
    const worktreePath = await validateDirectoryPath(path);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );

    try {
      await runProcess({
        executable: executablePath,
        cwd: worktreePath,
        args: stageAllArguments(),
        signal: options.signal,
        timeoutMs:
          options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS,
        outputLimitBytes: WRITE_OUTPUT_LIMIT_BYTES,
        discardOutputAfterLimit: true,
        writeIntent: true
      });
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async unstagePaths(
    path: string,
    paths: readonly string[],
    options: GitWriteOptions = {}
  ): Promise<void> {
    const worktreePath = await validateDirectoryPath(path);
    const relativePaths = validateRelativePathspecs(paths);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );

    try {
      const hasHead = await repositoryHasHead({
        executable: executablePath,
        cwd: worktreePath,
        signal: options.signal,
        timeoutMs: options.timeoutMs
      });
      await runProcess({
        executable: executablePath,
        cwd: worktreePath,
        args: unstageArguments(relativePaths, hasHead),
        signal: options.signal,
        timeoutMs:
          options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS,
        outputLimitBytes: WRITE_OUTPUT_LIMIT_BYTES,
        discardOutputAfterLimit: true,
        writeIntent: true
      });
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async restoreWorktreePaths(
    path: string,
    paths: readonly string[],
    options: GitWriteOptions = {}
  ): Promise<void> {
    const worktreePath = await validateDirectoryPath(path);
    const relativePaths = validateRelativePathspecs(paths);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );

    try {
      await runProcess({
        executable: executablePath,
        cwd: worktreePath,
        args: restoreWorktreeArguments(relativePaths),
        signal: options.signal,
        timeoutMs:
          options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS,
        outputLimitBytes: WRITE_OUTPUT_LIMIT_BYTES,
        discardOutputAfterLimit: true,
        writeIntent: true
      });
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async removeUntrackedPaths(
    path: string,
    paths: readonly string[],
    options: GitWriteOptions = {}
  ): Promise<void> {
    const worktreePath = await validateDirectoryPath(path);
    const relativePaths = validateRelativePathspecs(paths);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );

    try {
      await runProcess({
        executable: executablePath,
        cwd: worktreePath,
        args: removeUntrackedArguments(relativePaths),
        signal: options.signal,
        timeoutMs:
          options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS,
        outputLimitBytes: WRITE_OUTPUT_LIMIT_BYTES,
        discardOutputAfterLimit: true,
        writeIntent: true
      });
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async mutateStash(
    path: string,
    action: StashMutationAction,
    stashRef: string,
    stashHash: string,
    options: GitWriteOptions = {}
  ): Promise<void> {
    const worktreePath = await validateDirectoryPath(path);
    const normalizedRef = validateStashRef(stashRef);
    const expectedHash = validateFullObjectId(stashHash);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );
    const timeoutMs =
      options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;

    try {
      const resolved = await runProcess({
        executable: executablePath,
        cwd: worktreePath,
        args: resolveStashArguments(normalizedRef),
        signal: options.signal,
        timeoutMs,
        outputLimitBytes: 4_096
      });
      const currentHash = validateFullObjectId(
        trimSingleLine(resolved.stdout)
      );

      if (
        currentHash.toLocaleLowerCase("en-US") !==
        expectedHash.toLocaleLowerCase("en-US")
      ) {
        throw new GitError(
          "INVALID_REQUEST",
          "The selected stash changed before the operation could run. Refresh the stash list and try again.",
          {
            stashRef: normalizedRef,
            expectedHash,
            currentHash
          }
        );
      }

      await runProcess({
        executable: executablePath,
        cwd: worktreePath,
        args: stashMutationArguments(
          action,
          normalizedRef,
          currentHash
        ),
        signal: options.signal,
        timeoutMs,
        outputLimitBytes: WRITE_OUTPUT_LIMIT_BYTES,
        discardOutputAfterLimit: true,
        writeIntent: true
      });
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async createCommit(
    path: string,
    options: CreateCommitOptions
  ): Promise<CreatedCommit> {
    const worktreePath = await validateDirectoryPath(path);
    const message = validateCommitMessage(options);
    const executablePath = await this.#getExecutablePath(
      options.signal
    );
    const timeoutMs =
      options.timeoutMs ?? DEFAULT_COMMIT_TIMEOUT_MS;

    try {
      await runProcess({
        executable: executablePath,
        cwd: worktreePath,
        args: createCommitArguments(
          message.subject,
          message.body
        ),
        signal: options.signal,
        timeoutMs,
        outputLimitBytes: WRITE_OUTPUT_LIMIT_BYTES,
        discardOutputAfterLimit: true,
        writeIntent: true
      });
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }

    try {
      const result = await runProcess({
        executable: executablePath,
        cwd: worktreePath,
        args: [
          "show",
          "-s",
          "--format=%H%x00%h%x00%s",
          "HEAD"
        ],
        signal: options.signal,
        timeoutMs
      });
      return parseCreatedCommit(result.stdout);
    } catch {
      return { subject: message.subject };
    }
  }

  async inspectRepository(
    path: string,
    options: InspectRepositoryOptions = {}
  ): Promise<RepositoryInspection> {
    const worktreePath = await validateDirectoryPath(path);
    const executablePath = await this.#getExecutablePath(options.signal);
    const commandOptions = {
      executable: executablePath,
      cwd: worktreePath,
      signal: options.signal,
      timeoutMs: options.timeoutMs
    };

    try {
      const identity = await readRepositoryIdentity(commandOptions);
      const historyLimit = clampHistoryLimit(options.historyLimit);
      const [statusResult, branchResult, worktreeResult, historyResult] =
        await Promise.all([
          runProcess({
            ...commandOptions,
            args: STATUS_ARGUMENTS
          }),
          runProcess({
            ...commandOptions,
            args: BRANCH_ARGUMENTS
          }),
          runProcess({
            ...commandOptions,
            args: WORKTREE_ARGUMENTS
          }),
          identity.head
            ? runProcess({
                ...commandOptions,
                args: historyArguments(historyLimit)
              })
            : Promise.resolve({
                exitCode: 0,
                stdout: "",
                stderr: "",
                durationMs: 0
              })
        ]);
      const refreshedAt = new Date().toISOString();
      const snapshot = await reconcileRepositorySnapshot(
        parseStatusPorcelainV2(
          statusResult.stdout,
          refreshedAt
        ),
        commandOptions,
        false
      );
      const branches = parseBranches(branchResult.stdout).map(
        (branch) => ({
          ...branch,
          ...(branch.worktreePath
            ? {
                worktreePath: normalizeAbsoluteGitPath(
                  branch.worktreePath
                )
              }
            : {})
        })
      );
      const worktrees = parseWorktrees(worktreeResult.stdout).map(
        (worktree) => ({
          ...worktree,
          path: normalizeAbsoluteGitPath(worktree.path)
        })
      );

      return {
        identity: {
          ...identity,
          head: snapshot.head || identity.head
        },
        snapshot,
        branches,
        commits: parseCommitHistory(historyResult.stdout),
        worktrees
      };
    } catch (error) {
      throw mapRepositoryError(error, worktreePath);
    }
  }

  async #withRemoteEnvironment<Result>(
    repositoryPath: string,
    remote: string,
    executablePath: string,
    signal: AbortSignal | undefined,
    action: (
      environment:
        | Readonly<Record<string, string | undefined>>
        | undefined
    ) => Promise<Result>
  ): Promise<Result> {
    const lease = await this.#acquireRemoteEnvironment(
      repositoryPath,
      remote,
      executablePath,
      signal
    );
    try {
      return await action(lease?.environment);
    } finally {
      await lease?.dispose().catch(() => undefined);
    }
  }

  async #acquireRemoteEnvironment(
    repositoryPath: string,
    remote: string,
    executablePath: string,
    signal?: AbortSignal
  ): Promise<GitRemoteCommandEnvironmentLease | undefined> {
    if (!this.#remoteEnvironmentProvider) {
      return undefined;
    }
    const result = await runProcess({
      executable: executablePath,
      cwd: repositoryPath,
      args: readRemoteUrlArguments(remote),
      signal,
      outputLimitBytes: 64 * 1024
    });
    const remoteUrl = trimSingleLine(result.stdout);
    if (!remoteUrl) {
      throw new GitError(
        "INVALID_GIT_OUTPUT",
        "The configured remote URL is empty."
      );
    }
    return this.#remoteEnvironmentProvider({
      repositoryPath,
      remote,
      remoteUrl,
      ...(signal ? { signal } : {})
    });
  }

  async #getExecutablePath(
    signal?: AbortSignal
  ): Promise<string> {
    if (!this.#executablePath) {
      this.#executablePath = await findGitExecutable(signal);
    }

    return this.#executablePath;
  }
}

interface CommandOptions {
  executable: string;
  cwd: string;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
}

async function readRepositoryMediaPreview(
  path: string,
  mode: ReadRepositoryDiffOptions["mode"],
  descriptor: MediaDescriptor,
  options: CommandOptions
): Promise<RepositoryMediaPreview> {
  if (mode === "staged") {
    return readStagedMediaPreview(path, descriptor, options);
  }
  return readWorktreeMediaPreview(path, descriptor, options);
}

async function readStagedMediaPreview(
  path: string,
  descriptor: MediaDescriptor,
  options: CommandOptions
): Promise<RepositoryMediaPreview> {
  return readGitObjectMediaPreview(
    stagedFileSizeArguments(path),
    stagedFileContentArguments(path),
    descriptor,
    options
  );
}

async function readRevisionMediaPreview(
  revision: string,
  path: string,
  descriptor: MediaDescriptor,
  options: CommandOptions
): Promise<RepositoryMediaPreview> {
  return readGitObjectMediaPreview(
    revisionFileSizeArguments(revision, path),
    revisionFileContentArguments(revision, path),
    descriptor,
    options
  );
}

async function readGitObjectMediaPreview(
  sizeArguments: string[],
  contentArguments: string[],
  descriptor: MediaDescriptor,
  options: CommandOptions
): Promise<RepositoryMediaPreview> {
  const sizeResult = await runProcess({
    ...options,
    args: sizeArguments,
    allowFailure: true,
    outputLimitBytes: 4_096
  });
  assertAllowFailureIsRepository(sizeResult);
  if (sizeResult.exitCode !== 0) {
    return unavailableMedia(descriptor, "missing");
  }

  const normalizedSize = sizeResult.stdout.trim();
  if (!/^\d+$/.test(normalizedSize)) {
    throw new GitError(
      "INVALID_GIT_OUTPUT",
      "Git returned an invalid media size."
    );
  }
  const size = Number(normalizedSize);
  if (!Number.isSafeInteger(size)) {
    throw new GitError(
      "INVALID_GIT_OUTPUT",
      "Git returned an unsupported media size."
    );
  }
  if (size > MEDIA_PREVIEW_LIMIT_BYTES) {
    return unavailableMedia(
      descriptor,
      "too-large",
      size
    );
  }

  const contentResult = await runProcessBuffer({
    ...options,
    args: contentArguments,
    allowFailure: true,
    outputLimitBytes: MEDIA_PREVIEW_LIMIT_BYTES + 1,
    truncateOutput: true
  });
  assertAllowFailureIsRepository(contentResult);
  if (
    contentResult.outputTruncated ||
    contentResult.stdout.byteLength > MEDIA_PREVIEW_LIMIT_BYTES
  ) {
    return unavailableMedia(descriptor, "too-large");
  }
  if (contentResult.exitCode !== 0) {
    return unavailableMedia(descriptor, "missing");
  }

  assertReadNotCancelled(options.signal);
  return availableMedia(descriptor, contentResult.stdout);
}

async function readWorktreeMediaPreview(
  path: string,
  descriptor: MediaDescriptor,
  options: CommandOptions
): Promise<RepositoryMediaPreview> {
  assertReadNotCancelled(options.signal);
  const candidatePath = resolve(options.cwd, path);

  try {
    const [worktreeRealPath, fileRealPath] = await Promise.all([
      realpath(options.cwd),
      realpath(candidatePath)
    ]);
    const pathFromWorktree = relative(
      worktreeRealPath,
      fileRealPath
    );
    if (
      !pathFromWorktree ||
      pathFromWorktree === ".." ||
      pathFromWorktree.startsWith(`..${sep}`) ||
      isAbsolute(pathFromWorktree)
    ) {
      return unavailableMedia(descriptor, "not-file");
    }

    const info = await lstat(candidatePath);
    if (info.isSymbolicLink() || !info.isFile()) {
      return unavailableMedia(descriptor, "not-file");
    }
    if (info.size > MEDIA_PREVIEW_LIMIT_BYTES) {
      return unavailableMedia(
        descriptor,
        "too-large",
        info.size
      );
    }

    const content = await readFile(fileRealPath);
    assertReadNotCancelled(options.signal);
    if (content.byteLength > MEDIA_PREVIEW_LIMIT_BYTES) {
      return unavailableMedia(
        descriptor,
        "too-large",
        content.byteLength
      );
    }
    return availableMedia(descriptor, content);
  } catch (error) {
    if (isMissingFilesystemPath(error)) {
      return unavailableMedia(descriptor, "missing");
    }
    if (error instanceof GitError) {
      throw error;
    }
    throw new GitError(
      "COMMAND_FAILED",
      "Unable to read the selected media file.",
      {
        cause:
          error instanceof Error
            ? error.message
            : String(error)
      }
    );
  }
}

function availableMedia(
  descriptor: MediaDescriptor,
  content: Uint8Array
): RepositoryMediaPreview {
  const bytes = Uint8Array.from(content);
  return {
    status: "available",
    ...descriptor,
    size: bytes.byteLength,
    content: bytes
  };
}

function unavailableMedia(
  descriptor: MediaDescriptor,
  reason: Extract<
    RepositoryMediaPreview,
    { status: "unavailable" }
  >["reason"],
  size?: number
): RepositoryMediaPreview {
  return {
    status: "unavailable",
    ...descriptor,
    reason,
    ...(size === undefined ? {} : { size })
  };
}

function isMissingFilesystemPath(error: unknown): boolean {
  if (
    !error ||
    typeof error !== "object" ||
    !("code" in error)
  ) {
    return false;
  }
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

async function reconcileRepositorySnapshot(
  snapshot: RepositorySnapshot,
  options: CommandOptions,
  includeChangeStats: boolean
): Promise<RepositorySnapshot> {
  const hasOrdinaryWorktreeModification =
    snapshot.changes.some(
      (change) =>
        change.kind === "ordinary" &&
        change.worktreeStatus === "M"
    );
  if (!includeChangeStats && !hasOrdinaryWorktreeModification) {
    return snapshot;
  }

  const [stagedResult, unstagedResult, untrackedStats] =
    await Promise.all([
      includeChangeStats && snapshot.staged > 0
        ? runProcess({
            ...options,
            args: STAGED_DIFF_STAT_ARGUMENTS
          })
        : undefined,
      (includeChangeStats || hasOrdinaryWorktreeModification) &&
      snapshot.unstaged > 0
        ? runProcess({
            ...options,
            args: UNSTAGED_DIFF_PATH_ARGUMENTS
          })
        : undefined,
      includeChangeStats
        ? readUntrackedChangeStats(
            options.cwd,
            snapshot.changes,
            options.signal
          )
        : new Map<string, ChangedPathStats>()
    ]);
  const stagedStats = parseSimpleDiffStats(
    stagedResult?.stdout ?? ""
  );
  const unstagedStats = parseSimpleDiffStats(
    unstagedResult?.stdout ?? ""
  );
  const reconciledSnapshot =
    hasOrdinaryWorktreeModification
      ? reconcileStatOnlyUnstagedChanges(
          snapshot,
          [...unstagedStats.keys()]
        )
      : snapshot;

  if (!includeChangeStats) {
    return reconciledSnapshot;
  }

  return {
    ...reconciledSnapshot,
    changes: reconciledSnapshot.changes.map((change) =>
      attachChangeStats(
        change,
        stagedStats,
        unstagedStats,
        untrackedStats
      )
    )
  };
}

function parseSimpleDiffStats(
  output: string
): Map<string, ChangedPathStats> {
  return new Map(
    parseCommitNumstat(output).files.map((file) => [
      file.path,
      {
        additions: file.additions ?? 0,
        deletions: file.deletions ?? 0
      }
    ])
  );
}

function attachChangeStats(
  change: ChangedPath,
  stagedStats: ReadonlyMap<string, ChangedPathStats>,
  unstagedStats: ReadonlyMap<string, ChangedPathStats>,
  untrackedStats: ReadonlyMap<string, ChangedPathStats>
): ChangedPath {
  const emptyStats: ChangedPathStats = {
    additions: 0,
    deletions: 0
  };

  if (change.kind === "untracked") {
    return {
      ...change,
      untrackedStats:
        untrackedStats.get(change.path) ?? emptyStats
    };
  }

  return {
    ...change,
    ...(change.indexStatus === "."
      ? {}
      : {
          stagedStats:
            stagedStats.get(change.path) ?? emptyStats
        }),
    ...(change.worktreeStatus === "."
      ? {}
      : {
          unstagedStats:
            unstagedStats.get(change.path) ?? emptyStats
        })
  };
}

async function readUntrackedChangeStats(
  worktreePath: string,
  changes: readonly ChangedPath[],
  signal?: AbortSignal
): Promise<Map<string, ChangedPathStats>> {
  const stats = new Map<string, ChangedPathStats>();

  for (const change of changes) {
    if (change.kind !== "untracked") {
      continue;
    }

    assertReadNotCancelled(signal);
    stats.set(
      change.path,
      await readUntrackedFileStats(
        resolve(
          worktreePath,
          validateRelativePathspec(change.path)
        ),
        signal
      )
    );
  }

  return stats;
}

async function readUntrackedFileStats(
  path: string,
  signal?: AbortSignal
): Promise<ChangedPathStats> {
  const info = await lstat(path);

  if (info.isSymbolicLink()) {
    return { additions: 1, deletions: 0 };
  }
  if (!info.isFile() || info.size === 0) {
    return { additions: 0, deletions: 0 };
  }

  const handle = await open(path, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let additions = 0;
  let bytesReadTotal = 0;
  let lastByte = -1;
  let binary = false;

  try {
    while (true) {
      assertReadNotCancelled(signal);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.length,
        null
      );

      if (bytesRead === 0) {
        break;
      }

      const chunk = buffer.subarray(0, bytesRead);
      const binaryProbeLength = Math.max(
        0,
        Math.min(bytesRead, 8_000 - bytesReadTotal)
      );
      if (
        binaryProbeLength > 0 &&
        chunk.subarray(0, binaryProbeLength).includes(0)
      ) {
        binary = true;
        break;
      }

      for (const byte of chunk) {
        additions += Number(byte === 0x0a);
      }
      bytesReadTotal += bytesRead;
      lastByte = chunk[bytesRead - 1] ?? lastByte;
    }
  } finally {
    await handle.close();
  }

  return {
    additions:
      binary || bytesReadTotal === 0
        ? 0
        : additions + Number(lastByte !== 0x0a),
    deletions: 0
  };
}

function assertReadNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new GitError(
      "COMMAND_CANCELLED",
      "The Git command was cancelled."
    );
  }
}

async function resolveHistoryRef(
  options: CommandOptions,
  value: string
): Promise<string> {
  const ref = validateHistoryRefInput(value);
  const result = await runProcess({
    ...options,
    args: resolveRevisionArguments(ref),
    allowFailure: true,
    outputLimitBytes: 4_096
  });
  assertAllowFailureIsRepository(result);

  if (result.exitCode !== 0) {
    throw new GitError(
      "INVALID_REQUEST",
      `History ref does not resolve to a commit: ${ref}`,
      {
        exitCode: result.exitCode,
        stderr: result.stderr.slice(0, 2_048)
      }
    );
  }
  return ref;
}

function validateHistoryRefInput(value: string): string {
  const ref = value.trim();
  const allowedPrefix =
    ref.startsWith("refs/heads/") ||
    ref.startsWith("refs/remotes/");
  const invalidSyntax =
    !ref ||
    ref.length > 1_024 ||
    /[\x00-\x20\x7f~^:?*[\]\\]/.test(ref) ||
    ref.includes("..") ||
    ref.includes("@{") ||
    ref.includes("//") ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    ref.split("/").some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        segment.endsWith(".lock")
    );

  if (!allowedPrefix || invalidSyntax) {
    throw new GitError(
      "INVALID_REQUEST",
      "History refs must be exact local or remote-tracking refs."
    );
  }
  return ref;
}

function parseHistoryComparisonCounts(output: string): {
  leftOnly: number;
  rightOnly: number;
} {
  const match = output.trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) {
    throw new GitError(
      "INVALID_GIT_OUTPUT",
      "Git comparison counts are invalid."
    );
  }
  return {
    leftOnly: Number(match[1]),
    rightOnly: Number(match[2])
  };
}

async function repositoryHasHead(
  options: CommandOptions
): Promise<boolean> {
  const result = await runProcess({
    ...options,
    args: ["rev-parse", "--verify", "--quiet", "HEAD"],
    allowFailure: true
  });

  if (result.exitCode === 0) {
    return true;
  }

  if (result.exitCode === 1 && !result.stderr.trim()) {
    return false;
  }

  throw new GitError(
    "COMMAND_FAILED",
    `Git rev-parse exited with code ${result.exitCode}.`,
    {
      exitCode: result.exitCode,
      stderr: result.stderr.slice(0, 2_048)
    }
  );
}

async function validateBranchNameWithGit(
  options: CommandOptions,
  branch: string
): Promise<boolean> {
  const normalizedBranch = validateBranchInput(branch);
  const result = await runProcess({
    ...options,
    args: checkBranchNameArguments(normalizedBranch),
    allowFailure: true
  });
  assertAllowFailureIsRepository(result);

  if (result.exitCode === 0) {
    return true;
  }
  return false;
}

async function assertBranchName(
  options: CommandOptions,
  branch: string
): Promise<string> {
  const normalizedBranch = validateBranchInput(branch);

  if (
    !(await validateBranchNameWithGit(
      options,
      normalizedBranch
    ))
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `Invalid branch name: ${normalizedBranch}`
    );
  }

  return normalizedBranch;
}

function parseRemoteBranchRefs(
  output: string
): RemoteBranchRef[] {
  const refs: RemoteBranchRef[] = [];

  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const separator = line.indexOf("\t");
    if (separator < 1) {
      throw new GitError(
        "INVALID_GIT_OUTPUT",
        "Remote branch advertisement contains a malformed record."
      );
    }

    const head = validateCommitHash(
      line.slice(0, separator)
    );
    const fullName = line.slice(separator + 1);
    if (!fullName.startsWith("refs/heads/")) {
      continue;
    }

    const name = fullName.slice("refs/heads/".length);
    if (!name) {
      throw new GitError(
        "INVALID_GIT_OUTPUT",
        "Remote branch advertisement is missing a name."
      );
    }
    refs.push({ name, fullName, head });
  }

  return refs.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, {
      sensitivity: "base"
    })
  );
}

interface ProcessFailureResult {
  exitCode: number;
  stderr: string;
}

function assertAllowFailureIsRepository(
  result: ProcessFailureResult
): void {
  if (
    result.exitCode !== 0 &&
    result.stderr.includes("not a git repository")
  ) {
    throw commandFailure("Git", result);
  }
}

function commandFailure(
  label: string,
  result: ProcessFailureResult
): GitError {
  return new GitError(
    "COMMAND_FAILED",
    `${label} exited with code ${result.exitCode}.`,
    {
      exitCode: result.exitCode,
      stderr: result.stderr.slice(0, 2_048)
    }
  );
}

async function readRepositoryIdentity(
  options: CommandOptions
): Promise<RepositoryIdentity> {
  const [worktreeResult, gitDirResult, commonDirResult, headResult] =
    await Promise.all([
      runProcess({
        ...options,
        args: ["rev-parse", "--path-format=absolute", "--show-toplevel"]
      }),
      runProcess({
        ...options,
        args: [
          "rev-parse",
          "--path-format=absolute",
          "--absolute-git-dir"
        ]
      }),
      runProcess({
        ...options,
        args: [
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir"
        ]
      }),
      runProcess({
        ...options,
        args: ["rev-parse", "--verify", "HEAD"],
        allowFailure: true
      })
    ]);

  return {
    worktreePath: normalizeAbsoluteGitPath(
      trimSingleLine(worktreeResult.stdout)
    ),
    gitDir: normalizeAbsoluteGitPath(
      trimSingleLine(gitDirResult.stdout)
    ),
    commonDir: normalizeAbsoluteGitPath(
      trimSingleLine(commonDirResult.stdout)
    ),
    head:
      headResult.exitCode === 0
        ? trimSingleLine(headResult.stdout)
        : ""
  };
}

async function validateDirectoryPath(path: string): Promise<string> {
  if (
    typeof path !== "string" ||
    !path ||
    path.includes("\0") ||
    !isAbsolute(path)
  ) {
    throw new GitError(
      "DIRECTORY_UNAVAILABLE",
      "Repository paths must be absolute and contain no null bytes."
    );
  }

  const normalizedPath = normalize(resolve(path));

  try {
    const info = await stat(normalizedPath);

    if (!info.isDirectory()) {
      throw new GitError(
        "DIRECTORY_UNAVAILABLE",
        `${normalizedPath} is not a directory.`
      );
    }
  } catch (error) {
    if (error instanceof GitError) {
      throw error;
    }

    throw new GitError(
      "DIRECTORY_UNAVAILABLE",
      `Unable to access ${normalizedPath}.`
    );
  }

  return normalizedPath;
}

function validateWorktreePathInput(path: string): string {
  if (
    typeof path !== "string" ||
    !path ||
    path.length > MAX_WORKTREE_PATH_LENGTH ||
    path.includes("\0") ||
    /[\r\n]/.test(path) ||
    !isAbsolute(path)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `Worktree paths must be absolute single-line paths of at most ${MAX_WORKTREE_PATH_LENGTH} characters.`
    );
  }

  return normalize(resolve(path));
}

function validateWorktreePathInputs(
  paths: readonly string[]
): string[] {
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    paths.length > MAX_WORKTREE_PATHS
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `Worktree repair requires between 1 and ${MAX_WORKTREE_PATHS} paths.`
    );
  }

  return [
    ...new Set(
      paths.map((path) => validateWorktreePathInput(path))
    )
  ];
}

function validateCreateWorktreeMode(
  options: CreateWorktreeOptions
): {
  branch?: string;
  createBranch: boolean;
  detached: boolean;
} {
  if (
    typeof options.createBranch !== "boolean" ||
    typeof options.detached !== "boolean"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Worktree creation mode flags must be boolean values."
    );
  }

  if (options.detached) {
    if (
      options.createBranch ||
      options.branch !== undefined
    ) {
      throw new GitError(
        "INVALID_REQUEST",
        "Detached worktrees cannot create or check out a branch."
      );
    }
    return {
      createBranch: false,
      detached: true
    };
  }

  if (typeof options.branch !== "string") {
    throw new GitError(
      "INVALID_REQUEST",
      "Branch worktrees require an explicit branch name."
    );
  }

  return {
    branch: options.branch,
    createBranch: options.createBranch,
    detached: false
  };
}

function validateWorktreeLockReason(
  reason: string | undefined
): string | undefined {
  if (reason === undefined) {
    return undefined;
  }
  if (typeof reason !== "string") {
    throw new GitError(
      "INVALID_REQUEST",
      "Worktree lock reasons must be text."
    );
  }
  const normalized = reason.trim();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized.length > MAX_WORKTREE_LOCK_REASON_LENGTH ||
    normalized.includes("\0") ||
    /[\r\n]/.test(normalized)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `Worktree lock reasons must be a single line of at most ${MAX_WORKTREE_LOCK_REASON_LENGTH} characters.`
    );
  }
  return normalized;
}

function normalizeWorktree(worktree: Worktree): Worktree {
  return {
    ...worktree,
    path: normalizeAbsoluteGitPath(worktree.path)
  };
}

function selectPrunableWorktrees(output: string): Worktree[] {
  return parseWorktrees(output)
    .map(normalizeWorktree)
    .filter(
      (worktree) =>
        worktree.prunable &&
        !worktree.locked &&
        !worktree.primary
    )
    .sort((left, right) =>
      left.path.localeCompare(right.path)
    );
}

function clampHistoryLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_HISTORY_LIMIT;
  }

  if (!Number.isInteger(limit) || limit < 1) {
    throw new GitError(
      "INVALID_REQUEST",
      "History limit must be a positive integer."
    );
  }

  return Math.min(limit, MAX_HISTORY_LIMIT);
}

function clampHistoryPageLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_HISTORY_PAGE_LIMIT;
  }

  if (!Number.isInteger(limit) || limit < 1) {
    throw new GitError(
      "INVALID_REQUEST",
      "History page limit must be a positive integer."
    );
  }

  return Math.min(limit, MAX_HISTORY_PAGE_LIMIT);
}

function clampHistoryOffset(offset: number | undefined): number {
  if (offset === undefined) {
    return 0;
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new GitError(
      "INVALID_REQUEST",
      "History offset must be a non-negative integer."
    );
  }

  return offset;
}

function clampContextLines(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_DIFF_CONTEXT_LINES;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new GitError(
      "INVALID_REQUEST",
      "Diff context lines must be a non-negative integer."
    );
  }

  return Math.min(value, MAX_DIFF_CONTEXT_LINES);
}

function clampStashLimit(value: number | undefined): number {
  if (value === undefined) {
    return 50;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new GitError(
      "INVALID_REQUEST",
      "Stash limits must be positive integers."
    );
  }

  return Math.min(value, 100);
}

function validateStashRef(stashRef: string): string {
  const normalized = stashRef.trim();

  if (!/^stash@\{(?:0|[1-9]\d{0,8})\}$/.test(normalized)) {
    throw new GitError(
      "INVALID_REQUEST",
      "Stash references must use the exact stash@{n} form."
    );
  }

  return normalized;
}

function validateRelativePathspec(path: string): string {
  if (
    !path ||
    path.length > MAX_RELATIVE_PATH_LENGTH ||
    path === "." ||
    path.includes("\0") ||
    isAbsolute(path) ||
    path
      .split(/[\\/]+/)
      .some((segment) => segment === ".." || segment === ".")
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Diff paths must be relative and remain inside the worktree."
    );
  }

  return path;
}

function validateRelativePathspecs(
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

  return [
    ...new Set(
      paths.map((path) => validateRelativePathspec(path))
    )
  ];
}

function validateCommitMessage(
  options: CreateCommitOptions
): {
  subject: string;
  body?: string;
} {
  const subject = options.subject.trim();
  const body = options.body?.trim();

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

function parseCreatedCommit(output: string): CreatedCommit {
  const [hash = "", shortHash = "", subject = ""] = output
    .replace(/[\r\n]+$/, "")
    .split("\0");

  if (
    !/^[0-9a-f]{40,64}$/i.test(hash) ||
    !/^[0-9a-f]{4,64}$/i.test(shortHash) ||
    !subject
  ) {
    throw new GitError(
      "INVALID_GIT_OUTPUT",
      "Created commit metadata is invalid."
    );
  }

  return { hash, shortHash, subject };
}

function parseCommitParents(output: string): {
  hash: string;
  firstParentHash?: string;
} {
  const [hash = "", firstParentHash] = output
    .trim()
    .split(/\s+/);

  if (
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(hash) ||
    (firstParentHash !== undefined &&
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(
        firstParentHash
      ))
  ) {
    throw new GitError(
      "INVALID_GIT_OUTPUT",
      "Commit parent metadata is invalid."
    );
  }

  return {
    hash,
    ...(firstParentHash ? { firstParentHash } : {})
  };
}

function validateCommitHash(commitHash: string): string {
  const normalized = commitHash.trim();

  if (!/^[0-9a-f]{4,64}$/i.test(normalized)) {
    throw new GitError(
      "INVALID_REQUEST",
      "Commit hashes must be hexadecimal object ids."
    );
  }

  return normalized;
}

function validateFullObjectId(objectId: string): string {
  const normalized = objectId
    .trim()
    .toLocaleLowerCase("en-US");

  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(normalized)) {
    throw new GitError(
      "INVALID_REQUEST",
      "Stash hashes must be complete 40- or 64-character hexadecimal object ids."
    );
  }

  return normalized;
}

function validateRemoteName(remote: string): string {
  const normalized = remote.trim();

  if (
    !normalized ||
    normalized.length > 255 ||
    normalized.includes("\0") ||
    /[\r\n]/.test(normalized)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Remote names must contain 1 to 255 characters."
    );
  }

  return normalized;
}

function validateBranchInput(branch: string): string {
  const normalized = branch.trim();

  if (
    !normalized ||
    normalized.length > 255 ||
    normalized.includes("\0") ||
    /[\r\n]/.test(normalized)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Branch names must contain 1 to 255 characters."
    );
  }

  return normalized;
}

function validateRevision(revision: string): string {
  const normalized = revision.trim();

  if (
    !normalized ||
    normalized.length > 512 ||
    normalized.includes("\0") ||
    /[\r\n]/.test(normalized)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Revision names must contain 1 to 512 characters."
    );
  }

  return normalized;
}

function validateRemoteConnectionUrl(value: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 4_096 ||
    normalized.includes("\0") ||
    /[\r\n]/.test(normalized)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Remote test URLs exceed the supported bounds."
    );
  }

  let parsed: URL | undefined;
  try {
    parsed = new URL(normalized);
  } catch {
    // Non-URL Git remotes are validated below as SCP-like syntax.
  }

  if (parsed) {
    if (
      ["https:", "ssh:"].includes(parsed.protocol) &&
      parsed.hostname &&
      parsed.pathname &&
      parsed.pathname !== "/" &&
      !(
        parsed.protocol === "https:" &&
        (parsed.username || parsed.password)
      )
    ) {
      return normalized;
    }
  } else {
    if (
      !normalized.includes("://") &&
      /^(?:[^@\s]+@)?[^:\s]+:.+$/.test(normalized)
    ) {
      return normalized;
    }
  }
  throw new GitError(
    "INVALID_REQUEST",
    "Remote tests support only HTTPS and SSH repository URLs."
  );
}

export function classifyRemoteConnectionFailure(
  output: string
): GitRemoteConnectionStatus {
  const normalized = output.toLocaleLowerCase("en-US");
  if (
    normalized.includes("authentication failed") ||
    normalized.includes("invalid credentials") ||
    normalized.includes("invalid username or password") ||
    normalized.includes("could not read username") ||
    normalized.includes("http 401") ||
    normalized.includes("returned error: 401")
  ) {
    return "authentication-failed";
  }
  if (
    normalized.includes("permission denied") ||
    normalized.includes("access denied") ||
    normalized.includes("not allowed") ||
    normalized.includes("forbidden") ||
    normalized.includes("repository not found") ||
    normalized.includes("http 403") ||
    normalized.includes("returned error: 403")
  ) {
    return "permission-denied";
  }
  return "unavailable";
}

function trimSingleLine(output: string): string {
  return output.replace(/[\r\n]+$/, "");
}

function normalizeAbsoluteGitPath(path: string): string {
  return normalize(resolve(path));
}

function mapRepositoryError(
  error: unknown,
  worktreePath: string
): unknown {
  if (!(error instanceof GitError)) {
    return error;
  }

  const stderr = String(error.details.stderr ?? "");
  const normalizedStderr = stderr.toLocaleLowerCase("en-US");

  if (
    error.code === "COMMAND_FAILED" &&
    normalizedStderr.includes("not a git repository")
  ) {
    return new GitError(
      "NOT_A_REPOSITORY",
      `${worktreePath} is not a Git worktree.`
    );
  }

  if (
    error.code === "COMMAND_FAILED" &&
    (normalizedStderr.includes("non-fast-forward") ||
      normalizedStderr.includes(
        "not possible to fast-forward"
      ) ||
      normalizedStderr.includes("fetch first"))
  ) {
    return new GitError(
      "NON_FAST_FORWARD",
      "The remote update is not a fast-forward.",
      error.details
    );
  }

  if (
    error.code === "COMMAND_FAILED" &&
    normalizedStderr.includes("stale info")
  ) {
    return new GitError(
      "PREFLIGHT_CHANGED",
      "The remote branch changed after preflight.",
      error.details
    );
  }

  if (
    error.code === "COMMAND_FAILED" &&
    (normalizedStderr.includes("authentication failed") ||
      normalizedStderr.includes("permission denied") ||
      normalizedStderr.includes(
        "could not read username"
      ))
  ) {
    return new GitError(
      "AUTHENTICATION_FAILED",
      "Git authentication failed.",
      error.details
    );
  }

  return error;
}
