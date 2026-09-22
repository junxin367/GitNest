import {
  spawn,
  type ChildProcess,
  type SpawnOptions
} from "node:child_process";

import {
  GitError,
  type GitReadPriority
} from "@gitnest/git-core";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;
const DEFAULT_INTERACTIVE_CONCURRENCY = 1;
const DEFAULT_SHARED_CONCURRENCY = 3;

export interface ProcessRequest {
  executable: string;
  args: readonly string[];
  cwd?: string | undefined;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  outputLimitBytes?: number | undefined;
  truncateOutput?: boolean | undefined;
  discardOutputAfterLimit?: boolean | undefined;
  allowFailure?: boolean | undefined;
  writeIntent?: boolean | undefined;
  priority?: GitReadPriority | undefined;
  environment?:
    | Readonly<Record<string, string | undefined>>
    | undefined;
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  outputTruncated?: boolean;
}

export interface ProcessBufferResult {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
  durationMs: number;
  outputTruncated?: boolean;
}

export interface GitProcessSchedulerOptions {
  interactiveConcurrency?: number;
  sharedConcurrency?: number;
}

interface ScheduledProcessTask {
  start(): void;
}

export class GitProcessScheduler {
  readonly #interactiveConcurrency: number;
  readonly #sharedConcurrency: number;
  readonly #interactiveQueue: ScheduledProcessTask[] = [];
  readonly #foregroundQueue: ScheduledProcessTask[] = [];
  readonly #backgroundQueue: ScheduledProcessTask[] = [];
  #activeInteractive = 0;
  #activeShared = 0;

  constructor(options: GitProcessSchedulerOptions = {}) {
    this.#interactiveConcurrency = positiveConcurrency(
      options.interactiveConcurrency ??
        DEFAULT_INTERACTIVE_CONCURRENCY
    );
    this.#sharedConcurrency = positiveConcurrency(
      options.sharedConcurrency ?? DEFAULT_SHARED_CONCURRENCY
    );
  }

  run<Result>(
    priority: GitReadPriority,
    signal: AbortSignal | undefined,
    task: () => Promise<Result>
  ): Promise<Result> {
    if (signal?.aborted) {
      return Promise.reject(cancelledBeforeStart());
    }

    return new Promise<Result>((resolve, reject) => {
      const queue = this.#queueFor(priority);
      let queued = true;
      const cancel = () => {
        if (!queued) {
          return;
        }
        const index = queue.indexOf(scheduled);
        if (index >= 0) {
          queue.splice(index, 1);
        }
        queued = false;
        signal?.removeEventListener("abort", cancel);
        reject(cancelledBeforeStart());
        this.#drain();
      };
      const scheduled: ScheduledProcessTask = {
        start: () => {
          queued = false;
          signal?.removeEventListener("abort", cancel);
          if (signal?.aborted) {
            reject(cancelledBeforeStart());
            this.#release(priority);
            return;
          }
          void Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              this.#release(priority);
            });
        }
      };

      signal?.addEventListener("abort", cancel, {
        once: true
      });
      queue.push(scheduled);
      this.#drain();
    });
  }

  #queueFor(
    priority: GitReadPriority
  ): ScheduledProcessTask[] {
    if (priority === "interactive") {
      return this.#interactiveQueue;
    }
    return priority === "foreground"
      ? this.#foregroundQueue
      : this.#backgroundQueue;
  }

  #drain(): void {
    while (
      this.#activeInteractive <
        this.#interactiveConcurrency &&
      this.#interactiveQueue.length > 0
    ) {
      const task = this.#interactiveQueue.shift();
      if (!task) {
        break;
      }
      this.#activeInteractive += 1;
      task.start();
    }

    while (
      this.#activeShared < this.#sharedConcurrency
    ) {
      const task =
        this.#foregroundQueue.shift() ??
        this.#backgroundQueue.shift();
      if (!task) {
        break;
      }
      this.#activeShared += 1;
      task.start();
    }
  }

  #release(priority: GitReadPriority): void {
    if (priority === "interactive") {
      this.#activeInteractive -= 1;
    } else {
      this.#activeShared -= 1;
    }
    this.#drain();
  }
}

const processScheduler = new GitProcessScheduler();

export function runProcess(
  request: ProcessRequest
): Promise<ProcessResult> {
  return runProcessWithStdout(request, (stdout) =>
    stdout.toString("utf8")
  );
}

export function runProcessBuffer(
  request: ProcessRequest
): Promise<ProcessBufferResult> {
  return runProcessWithStdout(request, (stdout) => stdout);
}

async function runProcessWithStdout<Stdout extends string | Buffer>({
  priority = "foreground",
  ...request
}: ProcessRequest, decodeStdout: (stdout: Buffer) => Stdout): Promise<{
  exitCode: number;
  stdout: Stdout;
  stderr: string;
  durationMs: number;
  outputTruncated?: boolean;
}> {
  return processScheduler.run(
    priority,
    request.signal,
    () => executeProcessWithStdout(request, decodeStdout)
  );
}

async function executeProcessWithStdout<
  Stdout extends string | Buffer
>({
  executable,
  args,
  cwd,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  outputLimitBytes = DEFAULT_OUTPUT_LIMIT_BYTES,
  truncateOutput = false,
  discardOutputAfterLimit = false,
  allowFailure = false,
  writeIntent = false,
  environment
}: ProcessRequest, decodeStdout: (stdout: Buffer) => Stdout): Promise<{
  exitCode: number;
  stdout: Stdout;
  stderr: string;
  durationMs: number;
  outputTruncated?: boolean;
}> {
  if (signal?.aborted) {
    throw new GitError(
      "COMMAND_CANCELLED",
      "The Git command was cancelled before it started."
    );
  }

  const startedAt = performance.now();
  const spawnOptions: SpawnOptions = {
    ...(cwd ? { cwd } : {}),
    env: writeIntent
      ? createWritableProcessEnvironment(environment)
      : createReadOnlyProcessEnvironment(environment),
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  };

  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], spawnOptions);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    let outputDiscarded = false;
    let settled = false;
    let terminationReason:
      | "cancelled"
      | "timeout"
      | "output-limit"
      | "output-truncated"
      | undefined;

    const finishWithError = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };

    const terminate = (
      reason: NonNullable<typeof terminationReason>
    ) => {
      if (terminationReason) {
        return;
      }

      terminationReason = reason;
      terminateProcessTree(child);
    };

    const collect =
      (target: Buffer[]) =>
      (chunk: Buffer | string): void => {
        const buffer = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk);

        if (outputBytes + buffer.byteLength > outputLimitBytes) {
          const remaining = Math.max(
            outputLimitBytes - outputBytes,
            0
          );
          if (remaining > 0) {
            target.push(buffer.subarray(0, remaining));
            outputBytes += remaining;
          }
          if (discardOutputAfterLimit) {
            outputDiscarded = true;
            return;
          }
          terminate(
            truncateOutput ? "output-truncated" : "output-limit"
          );
          return;
        }

        outputBytes += buffer.byteLength;
        target.push(buffer);
      };

    const timeout = setTimeout(() => {
      terminate("timeout");
    }, timeoutMs);

    const abort = () => {
      terminate("cancelled");
    };

    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    };

    signal?.addEventListener("abort", abort, { once: true });
    child.stdout?.on("data", collect(stdoutChunks));
    child.stderr?.on("data", collect(stderrChunks));

    child.once("error", (error) => {
      finishWithError(
        new GitError(
          error.message.includes("ENOENT")
            ? "GIT_NOT_FOUND"
            : "COMMAND_FAILED",
          `Unable to start ${executable}.`,
          { cause: error.message }
        )
      );
    });

    child.once("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();

      const stdout = decodeStdout(Buffer.concat(stdoutChunks));
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const durationMs = Math.round(performance.now() - startedAt);

      if (terminationReason === "cancelled") {
        reject(
          new GitError(
            "COMMAND_CANCELLED",
            "The Git command was cancelled."
          )
        );
        return;
      }

      if (terminationReason === "timeout") {
        reject(
          new GitError(
            "COMMAND_TIMEOUT",
            `The Git command exceeded ${timeoutMs} ms.`,
            { timeoutMs }
          )
        );
        return;
      }

      if (terminationReason === "output-limit") {
        reject(
          new GitError(
            "OUTPUT_LIMIT_EXCEEDED",
            "The Git command produced more output than allowed.",
            { outputLimitBytes }
          )
        );
        return;
      }

      if (terminationReason === "output-truncated") {
        resolve({
          exitCode: exitCode ?? -1,
          stdout,
          stderr,
          durationMs,
          outputTruncated: true
        });
        return;
      }

      const normalizedExitCode = exitCode ?? -1;

      if (!allowFailure && normalizedExitCode !== 0) {
        reject(
          new GitError(
            "COMMAND_FAILED",
            `Git exited with code ${normalizedExitCode}.`,
            {
              exitCode: normalizedExitCode,
              stderr: stderr.slice(0, 2_048),
              ...(outputDiscarded
                ? { outputTruncated: true }
                : {})
            }
          )
        );
        return;
      }

      resolve({
        exitCode: normalizedExitCode,
        stdout,
        stderr,
        durationMs,
        ...(outputDiscarded ? { outputTruncated: true } : {})
      });
    });
  });
}

function positiveConcurrency(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Git process concurrency must be a positive integer.");
  }
  return value;
}

function cancelledBeforeStart(): GitError {
  return new GitError(
    "COMMAND_CANCELLED",
    "The Git command was cancelled before it started."
  );
}

export function createReadOnlyProcessEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {}
): NodeJS.ProcessEnv {
  return createProcessEnvironment(overrides, "0");
}

export function createWritableProcessEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {}
): NodeJS.ProcessEnv {
  return createProcessEnvironment(overrides, "1");
}

function createProcessEnvironment(
  overrides: Readonly<Record<string, string | undefined>>,
  optionalLocks: "0" | "1"
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...overrides,
    LC_ALL: "C",
    LANG: "C",
    GIT_OPTIONAL_LOCKS: optionalLocks,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    GIT_PAGER: "cat",
    PAGER: "cat"
  };
}

function terminateProcessTree(child: ChildProcess): void {
  if (!child.pid) {
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      {
        shell: false,
        windowsHide: true,
        stdio: "ignore"
      }
    );
    killer.unref();
    return;
  }

  child.kill("SIGTERM");
}
