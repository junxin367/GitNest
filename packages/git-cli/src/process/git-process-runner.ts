import {
  spawn,
  type ChildProcess,
  type SpawnOptions
} from "node:child_process";

import { GitError } from "@gitnest/git-core";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;

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

export async function runProcess({
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
}: ProcessRequest): Promise<ProcessResult> {
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

  return new Promise<ProcessResult>((resolve, reject) => {
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

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
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
