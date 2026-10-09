import { EventEmitter } from "node:events";

import type {
  CodeAnalysisInput,
  CodeAnalysisSnapshot
} from "@gitnest/code-analysis";
import { MAX_ANALYSIS_SNAPSHOT_PAYLOAD_BYTES } from "@gitnest/code-analysis";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
  type CodeAnalysisHostMessage,
  type CodeAnalysisWorkerMessage
} from "./code-analysis-process-protocol";
import {
  startCodeAnalysisProcess,
  type AnalysisParentPort
} from "./code-analysis-process-runtime";

describe("startCodeAnalysisProcess", () => {
  afterEach(() => vi.useRealTimers());

  it("coalesces bursts while preserving stage starts and completions", async () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const parentPort = new FakeParentPort();
    startCodeAnalysisProcess(parentPort, {
      createEngine: () => ({
        analyze: async (input) => {
          for (const stage of ["reading", "parsing"] as const) {
            for (let completed = 0; completed <= 1000; completed += 1) {
              input.onProgress?.({
                stage, completed, total: 1000,
                message: `${stage} ${completed}`
              });
            }
          }
          return createSnapshot("analysis-burst");
        },
        dispose: async () => undefined
      })
    });
    parentPort.send({
      version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
      type: "analyze",
      analysisId: "analysis-burst",
      input: createInput("analysis-burst")
    });
    await vi.waitFor(() => expect(parentPort.messages.at(-1)?.type).toBe("result"));
    const progress = parentPort.messages.filter((message) => message.type === "progress");
    expect(progress.map((message) => [message.progress.stage, message.progress.completed]))
      .toEqual([["reading", 0], ["reading", 1000], ["parsing", 0], ["parsing", 1000]]);
  });

  it.each(["result", "error", "cancelled"] as const)(
    "flushes the trailing progress within 100ms and clears timers on %s",
    async (terminal) => {
      vi.useFakeTimers();
      const parentPort = new FakeParentPort();
      let input: CodeAnalysisInput | undefined;
      let resolve: ((snapshot: CodeAnalysisSnapshot) => void) | undefined;
      let reject: ((reason: Error) => void) | undefined;
      startCodeAnalysisProcess(parentPort, {
        createEngine: () => ({
          analyze: (value) => {
            input = value;
            return new Promise((onResolve, onReject) => {
              resolve = onResolve;
              reject = onReject;
            });
          },
          dispose: async () => undefined
        })
      });
      parentPort.send({
        version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
        type: "analyze",
        analysisId: "analysis-trailing",
        input: createInput("analysis-trailing")
      });
      await vi.advanceTimersByTimeAsync(0);
      const progress = (completed: number) => input!.onProgress!({
        stage: "parsing", completed, total: 100, message: `file ${completed}`
      });
      progress(0);
      await vi.advanceTimersByTimeAsync(20);
      progress(1);
      await vi.advanceTimersByTimeAsync(70);
      progress(2);
      const progressValues = () => parentPort.messages
        .filter((message) => message.type === "progress")
        .map((message) => message.progress.completed);
      expect(progressValues()).toEqual([0]);
      await vi.advanceTimersByTimeAsync(10);
      expect(progressValues()).toEqual([0, 2]);
      progress(3);
      if (terminal === "result") {
        resolve!(createSnapshot("analysis-trailing"));
      } else {
        if (terminal === "cancelled") {
          parentPort.send({
            version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
            type: "cancel",
            analysisId: "analysis-trailing",
            reason: "Cancelled by test"
          });
          progress(4);
        }
        reject!(new Error("Interrupted"));
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(parentPort.messages.at(-1)?.type).toBe(terminal);
      expect(progressValues()).toEqual(
        terminal === "cancelled" ? [0, 2] : [0, 2, 3]
      );
      expect(vi.getTimerCount()).toBe(0);
      const messageCount = parentPort.messages.length;
      await vi.advanceTimersByTimeAsync(1000);
      expect(parentPort.messages).toHaveLength(messageCount);
    }
  );

  it("publishes progress and results, then disposes the isolated engine", async () => {
    const parentPort = new FakeParentPort();
    const snapshot = createSnapshot("analysis-1");
    const dispose = vi.fn(async () => undefined);
    const exit = vi.fn();

    startCodeAnalysisProcess(parentPort, {
      createEngine: () => ({
        analyze: async (input) => {
          input.onProgress?.({
            stage: "reading",
            completed: 1,
            total: 1,
            message: "Reading source"
          });
          return snapshot;
        },
        dispose
      }),
      exit
    });

    expect(parentPort.messages[0]).toMatchObject({
      version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
      type: "ready"
    });

    parentPort.send({
      version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
      type: "analyze",
      analysisId: "analysis-1",
      input: createInput("analysis-1")
    });

    await vi.waitFor(() => {
      expect(parentPort.messages).toContainEqual({
        version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
        type: "result",
        analysisId: "analysis-1",
        snapshot
      });
    });
    expect(parentPort.messages).toContainEqual({
      version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
      type: "progress",
      analysisId: "analysis-1",
      progress: {
        stage: "reading",
        completed: 1,
        total: 1,
        message: "Reading source"
      }
    });

    parentPort.send({
      version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
      type: "dispose"
    });

    await vi.waitFor(() => {
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(parentPort.messages).toContainEqual({
        version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
        type: "disposed"
      });
      expect(exit).toHaveBeenCalledWith(0);
    });
  });

  it("forwards cancellation to the engine abort signal", async () => {
    const parentPort = new FakeParentPort();

    startCodeAnalysisProcess(parentPort, {
      createEngine: () => ({
        analyze: (input) =>
          new Promise<CodeAnalysisSnapshot>(
            (_resolve, reject) => {
              input.signal?.addEventListener(
                "abort",
                () => reject(input.signal?.reason),
                { once: true }
              );
            }
          ),
        dispose: async () => undefined
      })
    });

    parentPort.send({
      version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
      type: "analyze",
      analysisId: "analysis-2",
      input: createInput("analysis-2")
    });
    parentPort.send({
      version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
      type: "cancel",
      analysisId: "analysis-2",
      reason: "Cancelled by test"
    });

    await vi.waitFor(() => {
      expect(parentPort.messages).toContainEqual({
        version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
        type: "cancelled",
        analysisId: "analysis-2",
        message: "Cancelled by test"
      });
    });
  });

  it("rejects an oversized snapshot before posting it to the host", async () => {
    const parentPort = new FakeParentPort();
    const snapshot = createSnapshot("analysis-oversized");
    snapshot.warnings = [
      "x".repeat(MAX_ANALYSIS_SNAPSHOT_PAYLOAD_BYTES)
    ];

    startCodeAnalysisProcess(parentPort, {
      createEngine: () => ({
        analyze: async () => snapshot,
        dispose: async () => undefined
      })
    });

    parentPort.send({
      version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
      type: "analyze",
      analysisId: "analysis-oversized",
      input: createInput("analysis-oversized")
    });

    await vi.waitFor(() => {
      expect(parentPort.messages).toContainEqual(
        expect.objectContaining({
          type: "error",
          analysisId: "analysis-oversized",
          error: expect.objectContaining({
            message: expect.stringContaining(
              "snapshot payload"
            )
          })
        })
      );
    });
    expect(
      parentPort.messages.some(
        (message) => message.type === "result"
      )
    ).toBe(false);
  });
});

class FakeParentPort
  extends EventEmitter
  implements AnalysisParentPort
{
  readonly messages: CodeAnalysisWorkerMessage[] = [];

  postMessage(message: unknown): void {
    this.messages.push(message as CodeAnalysisWorkerMessage);
  }

  send(message: CodeAnalysisHostMessage): void {
    this.emit("message", { data: message });
  }
}

function createInput(
  analysisId: string
): Omit<CodeAnalysisInput, "signal" | "onProgress"> {
  return {
    analysisId,
    workspaceId: "workspace",
    workspaceRootPath: "C:\\workspace",
    roots: [
      {
        repositoryId: "repository",
        worktreeId: "worktree",
        name: "Repository",
        path: "C:\\workspace\\repository"
      }
    ],
    scope: "workspace",
    changedPaths: [],
    cacheDirectory: "C:\\cache",
    lspDataDirectory: "C:\\lsp",
    settings: {
      enabled: true,
      staticFallback: true,
      maxFiles: 100,
      maxTotalSourceBytes: 128 * 1_024 * 1_024,
      maxGraphNodes: 30_000,
      maxGraphEdges: 100_000,
      maxRequestChains: 5_000,
      maxDiagnostics: 2_000,
      maxFileSizeBytes: 64 * 1_024,
      readConcurrency: 1,
      graphDepth: 3,
      lspTimeoutMs: 1_000,
      ignoreDirectories: [],
      typescript: {
        enabled: false,
        command: "typescript-language-server",
        args: [],
        maxDocuments: 120,
        maxSymbolsPerDocument: 5_000,
        maxCallHierarchyRequests: 50,
        maxReferenceRequests: 50,
        maxDocumentationRequests: 50,
        maxReferencesPerSymbol: 500
      },
      java: {
        enabled: false,
        command: "jdtls",
        args: [],
        maxDocuments: 80,
        maxSymbolsPerDocument: 5_000,
        maxCallHierarchyRequests: 40,
        maxReferenceRequests: 1_000,
        maxDocumentationRequests: 40,
        maxReferencesPerSymbol: 500
      }
    }
  };
}

function createSnapshot(
  analysisId: string
): CodeAnalysisSnapshot {
  return {
    schemaVersion: 1,
    analysisId,
    workspaceId: "workspace",
    scope: "workspace",
    generatedAt: "2026-09-19T00:00:00.000Z",
    roots: createInput(analysisId).roots,
    nodes: [],
    edges: [],
    requestChains: [],
    languageServers: [],
    warnings: [],
    stats: {
      discoveredFiles: 0,
      analyzedFiles: 0,
      cachedFiles: 0,
      skippedFiles: 0,
      symbolCount: 0,
      edgeCount: 0,
      requestChainCount: 0,
      truncated: false,
      durationMs: 1
    }
  };
}
