import { spawn } from "node:child_process";

import type {
  CodeAnalysisInput,
  CodeAnalysisProgress,
  CodeAnalysisSnapshot
} from "@gitnest/code-analysis";
import type { CodeAnalysisRunnerPort } from "@gitnest/application";
import type { UtilityProcess } from "electron";

import {
  CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
  isCodeAnalysisWorkerMessage,
  type CodeAnalysisHostMessage,
  type SerializableCodeAnalysisInput
} from "./code-analysis-process-protocol";

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_CANCELLATION_GRACE_MS = 1_250;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 3_000;
const TREE_TERMINATION_TIMEOUT_MS = 3_000;

export interface AnalysisProcessDiagnostic {
  name: string;
  context: Readonly<
    Record<string, string | number | boolean>
  >;
}

export interface UtilityProcessCodeAnalysisRunnerOptions {
  spawn(): UtilityProcess;
  terminateTree?(
    child: UtilityProcess
  ): Promise<void>;
  onDiagnostic?(event: AnalysisProcessDiagnostic): void;
  startupTimeoutMs?: number;
  cancellationGraceMs?: number;
  shutdownTimeoutMs?: number;
}

interface ProcessState {
  child: UtilityProcess;
  generation: number;
  ready: boolean;
  readyDeferred: Deferred<void>;
  disposeDeferred?: Deferred<void>;
  termination?: Promise<void>;
  stdoutBytes: number;
  stderrBytes: number;
}

interface ActiveAnalysis {
  analysisId: string;
  generation: number;
  resolve(snapshot: CodeAnalysisSnapshot): void;
  reject(error: unknown): void;
  completion: Deferred<void>;
  onProgress?: (progress: CodeAnalysisProgress) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
  cancellationTimer?: NodeJS.Timeout;
  cancellationReason?: unknown;
}

export class UtilityProcessCodeAnalysisRunner
  implements CodeAnalysisRunnerPort
{
  readonly #options: Required<
    Pick<
      UtilityProcessCodeAnalysisRunnerOptions,
      | "startupTimeoutMs"
      | "cancellationGraceMs"
      | "shutdownTimeoutMs"
    >
  > &
    UtilityProcessCodeAnalysisRunnerOptions;
  #processState: ProcessState | undefined;
  #starting: Promise<ProcessState> | undefined;
  #generation = 0;
  #active: ActiveAnalysis | undefined;
  #analysisPending = false;
  #disposed = false;
  #shutdownError: Error | undefined;

  constructor(
    options: UtilityProcessCodeAnalysisRunnerOptions
  ) {
    this.#options = {
      ...options,
      startupTimeoutMs:
        options.startupTimeoutMs ??
        DEFAULT_STARTUP_TIMEOUT_MS,
      cancellationGraceMs:
        options.cancellationGraceMs ??
        DEFAULT_CANCELLATION_GRACE_MS,
      shutdownTimeoutMs:
        options.shutdownTimeoutMs ??
        DEFAULT_SHUTDOWN_TIMEOUT_MS
    };
  }

  async analyze(
    input: CodeAnalysisInput
  ): Promise<CodeAnalysisSnapshot> {
    if (this.#disposed) {
      throw new Error(
        "The code analysis runner has been disposed."
      );
    }
    if (this.#active) {
      throw new Error(
        "The code analysis runner already has an active task."
      );
    }
    if (this.#analysisPending) {
      throw new Error(
        "The code analysis runner already has an active task."
      );
    }
    this.#analysisPending = true;
    let state: ProcessState;
    try {
      throwIfAborted(input.signal);
      state = await this.#ensureProcess();
      throwIfAborted(input.signal);
      if (this.#disposed) {
        throw new Error(
          "The code analysis runner has been disposed."
        );
      }
      if (this.#active) {
        throw new Error(
          "The code analysis runner already has an active task."
        );
      }
    } finally {
      this.#analysisPending = false;
    }

    return new Promise<CodeAnalysisSnapshot>(
      (resolvePromise, rejectPromise) => {
        const completion = deferred<void>();
        const active: ActiveAnalysis = {
          analysisId: input.analysisId,
          generation: state.generation,
          resolve: resolvePromise,
          reject: rejectPromise,
          completion,
          ...(input.onProgress
            ? { onProgress: input.onProgress }
            : {}),
          ...(input.signal ? { signal: input.signal } : {})
        };
        this.#active = active;
        if (input.signal) {
          const abortListener = () => {
            this.#requestCancellation(
              active,
              input.signal?.reason ??
                new Error("Code analysis was cancelled.")
            );
          };
          active.abortListener = abortListener;
          input.signal.addEventListener(
            "abort",
            abortListener,
            { once: true }
          );
        }
        const message: CodeAnalysisHostMessage = {
          version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
          type: "analyze",
          analysisId: input.analysisId,
          input: toSerializableInput(input)
        };
        try {
          state.child.postMessage(message);
        } catch (error) {
          this.#settleActive(active, "reject", error);
          void this.#terminateState(state);
        }
      }
    );
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const active = this.#active;
    if (active) {
      this.#requestCancellation(
        active,
        new Error("GitNest is shutting down.")
      );
      await active.completion.promise.catch(() => undefined);
    }
    if (this.#shutdownError) {
      throw this.#shutdownError;
    }
    const state =
      this.#processState ??
      (await this.#starting?.catch(() => undefined));
    if (!state || this.#processState !== state) {
      return;
    }
    const disposed = deferred<void>();
    state.disposeDeferred = disposed;
    try {
      state.child.postMessage({
        version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
        type: "dispose"
      } satisfies CodeAnalysisHostMessage);
      await withTimeout(
        disposed.promise,
        this.#options.shutdownTimeoutMs,
        "Code analysis process shutdown timed out."
      );
    } catch (error) {
      if (this.#processState === state) {
        await this.#terminateState(state);
      }
      throw error;
    }
  }

  async #ensureProcess(): Promise<ProcessState> {
    if (this.#processState?.ready) {
      return this.#processState;
    }
    if (this.#starting) {
      return this.#starting;
    }
    const generation = ++this.#generation;
    const child = this.#options.spawn();
    const state: ProcessState = {
      child,
      generation,
      ready: false,
      readyDeferred: deferred<void>(),
      stdoutBytes: 0,
      stderrBytes: 0
    };
    this.#processState = state;
    this.#attachProcessListeners(state);
    const starting = withTimeout(
      state.readyDeferred.promise,
      this.#options.startupTimeoutMs,
      "Code analysis process startup timed out."
    )
      .then(() => state)
      .catch(async (error) => {
        await this.#terminateState(state);
        throw error;
      })
      .finally(() => {
        if (this.#starting === starting) {
          this.#starting = undefined;
        }
      });
    this.#starting = starting;
    return starting;
  }

  #attachProcessListeners(state: ProcessState): void {
    state.child.on("spawn", () => {
      this.#diagnostic("code-analysis.process-spawned", {
        generation: state.generation,
        pid: state.child.pid ?? -1
      });
    });
    state.child.on("message", (message) => {
      this.#handleMessage(state, message);
    });
    state.child.on("error", (type, location, report) => {
      this.#diagnostic("code-analysis.process-fatal", {
        generation: state.generation,
        type,
        location: limitText(location, 512),
        reportBytes: Buffer.byteLength(report, "utf8")
      });
      const error = new Error(
        `Code analysis process reported a fatal error (${type}) at ${limitText(
          location,
          512
        )}.`
      );
      if (this.#disposed) {
        this.#shutdownError = error;
      }
      state.readyDeferred.reject(error);
      state.disposeDeferred?.reject(error);
      const active =
        this.#active?.generation === state.generation
          ? this.#active
          : undefined;
      void this.#terminateState(state).finally(() => {
        if (active) {
          this.#settleActive(active, "reject", error);
        }
      });
    });
    state.child.on("exit", (code) => {
      this.#handleExit(state, code);
    });
    state.child.stdout?.on("data", (chunk: Buffer | string) => {
      state.stdoutBytes += chunkByteLength(chunk);
    });
    state.child.stderr?.on("data", (chunk: Buffer | string) => {
      state.stderrBytes += chunkByteLength(chunk);
    });
  }

  #handleMessage(
    state: ProcessState,
    message: unknown
  ): void {
    if (this.#processState !== state) {
      return;
    }
    if (!isCodeAnalysisWorkerMessage(message)) {
      const error = new Error(
        "The code analysis process returned an invalid message."
      );
      state.readyDeferred.reject(error);
      if (this.#active?.generation === state.generation) {
        this.#settleActive(this.#active, "reject", error);
      }
      void this.#terminateState(state);
      return;
    }
    if (message.type === "ready") {
      state.ready = true;
      state.readyDeferred.resolve();
      return;
    }
    if (message.type === "disposed") {
      state.disposeDeferred?.resolve();
      return;
    }
    const active = this.#active;
    if (
      !active ||
      active.generation !== state.generation ||
      active.analysisId !== message.analysisId
    ) {
      this.#diagnostic(
        "code-analysis.process-stale-message",
        {
          generation: state.generation,
          analysisId: message.analysisId,
          type: message.type
        }
      );
      return;
    }
    switch (message.type) {
      case "progress":
        try {
          active.onProgress?.(message.progress);
        } catch {
          // UI progress listeners must not terminate analysis.
        }
        break;
      case "result":
        if (
          active.cancellationReason !== undefined ||
          active.signal?.aborted
        ) {
          this.#settleActive(
            active,
            "reject",
            active.cancellationReason ??
              active.signal?.reason ??
              new Error("Code analysis was cancelled.")
          );
          break;
        }
        this.#settleActive(
          active,
          "resolve",
          message.snapshot
        );
        break;
      case "cancelled":
        this.#settleActive(
          active,
          "reject",
          active.cancellationReason ??
            new Error(message.message)
        );
        break;
      case "error": {
        const error = new Error(message.error.message);
        error.name = message.error.name;
        this.#settleActive(active, "reject", error);
        break;
      }
    }
  }

  #handleExit(state: ProcessState, code: number): void {
    if (this.#processState !== state) {
      return;
    }
    this.#processState = undefined;
    const startupError = new Error(
      `Code analysis process exited before becoming ready (code ${code}).`
    );
    state.readyDeferred.reject(startupError);
    const shutdownError =
      code === 0
        ? undefined
        : new Error(
            `Code analysis process exited during shutdown (code ${code}).`
          );
    if (this.#disposed && shutdownError) {
      this.#shutdownError = shutdownError;
    }
    if (state.disposeDeferred) {
      if (!shutdownError) {
        state.disposeDeferred.resolve();
      } else {
        state.disposeDeferred.reject(shutdownError);
      }
    }
    const active = this.#active;
    if (active?.generation === state.generation) {
      this.#settleActive(
        active,
        "reject",
        active.cancellationReason ??
          new Error(
            `Code analysis process exited unexpectedly (code ${code}).`
          )
      );
    }
    this.#diagnostic("code-analysis.process-exited", {
      generation: state.generation,
      code,
      stdoutBytes: state.stdoutBytes,
      stderrBytes: state.stderrBytes
    });
  }

  #requestCancellation(
    active: ActiveAnalysis,
    reason: unknown
  ): void {
    if (
      this.#active !== active ||
      active.cancellationTimer
    ) {
      return;
    }
    active.cancellationReason = reason;
    const state = this.#processState;
    if (
      !state ||
      state.generation !== active.generation
    ) {
      this.#settleActive(active, "reject", reason);
      return;
    }
    try {
      state.child.postMessage({
        version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
        type: "cancel",
        analysisId: active.analysisId,
        reason: errorMessage(reason)
      } satisfies CodeAnalysisHostMessage);
    } catch {
      // The grace timer below will force termination.
    }
    active.cancellationTimer = setTimeout(() => {
      if (this.#active !== active) {
        return;
      }
      void this.#terminateState(state).finally(() => {
        this.#settleActive(active, "reject", reason);
      });
    }, this.#options.cancellationGraceMs);
  }

  #settleActive(
    active: ActiveAnalysis,
    kind: "resolve" | "reject",
    value: CodeAnalysisSnapshot | unknown
  ): void {
    if (this.#active !== active) {
      return;
    }
    this.#active = undefined;
    if (active.cancellationTimer) {
      clearTimeout(active.cancellationTimer);
    }
    if (active.signal && active.abortListener) {
      active.signal.removeEventListener(
        "abort",
        active.abortListener
      );
    }
    if (kind === "resolve") {
      active.resolve(value as CodeAnalysisSnapshot);
    } else {
      active.reject(value);
    }
    active.completion.resolve();
  }

  async #terminateState(state: ProcessState): Promise<void> {
    if (state.termination) {
      return state.termination;
    }
    if (this.#processState === state) {
      this.#processState = undefined;
    }
    state.termination = (async () => {
      try {
        await (
          this.#options.terminateTree ??
          terminateUtilityProcessTree
        )(state.child);
      } catch (error) {
        let fallbackKilled = false;
        try {
          fallbackKilled = state.child.kill();
        } catch {
          // The process may already have exited.
        }
        this.#diagnostic(
          "code-analysis.process-tree-termination-failed",
          {
            generation: state.generation,
            error: limitText(errorMessage(error), 512),
            fallbackKilled
          }
        );
      }
    })();
    return state.termination;
  }

  #diagnostic(
    name: string,
    context: Record<string, string | number | boolean>
  ): void {
    try {
      this.#options.onDiagnostic?.({ name, context });
    } catch {
      // Diagnostics must not interrupt process supervision.
    }
  }
}

export async function terminateUtilityProcessTree(
  child: UtilityProcess
): Promise<void> {
  const pid = child.pid;
  if (process.platform !== "win32" || !pid) {
    child.kill();
    return;
  }
  await new Promise<void>((resolvePromise) => {
    let settled = false;
    const finish = (fallback: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (fallback) {
        child.kill();
      }
      resolvePromise();
    };
    const killer = spawn(
      "taskkill.exe",
      ["/PID", String(pid), "/T", "/F"],
      {
        shell: false,
        windowsHide: true,
        stdio: "ignore"
      }
    );
    killer.once("error", () => {
      finish(true);
    });
    killer.once("close", (code) => {
      finish(code !== 0);
    });
    const timer = setTimeout(() => {
      killer.kill();
      finish(true);
    }, TREE_TERMINATION_TIMEOUT_MS);
    timer.unref();
  });
}

function toSerializableInput(
  input: CodeAnalysisInput
): SerializableCodeAnalysisInput {
  const {
    signal: _signal,
    onProgress: _onProgress,
    ...serializable
  } = input;
  return serializable;
}

function chunkByteLength(chunk: Buffer | string): number {
  return Buffer.isBuffer(chunk)
    ? chunk.byteLength
    : Buffer.byteLength(chunk, "utf8");
}

function limitText(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : value.slice(-maxLength);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Code analysis was cancelled.");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(reason: unknown): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>(
    (resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    }
  );
  return { promise, resolve, reject };
}

async function withTimeout<Value>(
  task: Promise<Value>,
  timeoutMs: number,
  message: string
): Promise<Value> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<Value>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(message)),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
