import { EventEmitter } from "node:events";

import type {
  CodeAnalysisInput,
  CodeAnalysisSnapshot
} from "@gitnest/code-analysis";
import { MAX_ANALYSIS_SNAPSHOT_PAYLOAD_BYTES } from "@gitnest/code-analysis";
import { describe, expect, it, vi } from "vitest";

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
    entryId: "entry",
    entryName: "Workspace",
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
      maxFileSizeBytes: 64 * 1_024,
      readConcurrency: 1,
      graphDepth: 3,
      lspTimeoutMs: 1_000,
      ignoreDirectories: [],
      typescript: {
        enabled: false,
        command: "typescript-language-server",
        args: []
      },
      java: {
        enabled: false,
        command: "jdtls",
        args: []
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
    entryId: "entry",
    entryName: "Workspace",
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
