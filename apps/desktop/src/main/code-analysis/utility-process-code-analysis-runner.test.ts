import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import type {
  CodeAnalysisInput,
  CodeAnalysisSnapshot
} from "@gitnest/code-analysis";
import type { UtilityProcess } from "electron";
import { describe, expect, it, vi } from "vitest";

import {
  CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
  type CodeAnalysisHostMessage
} from "./code-analysis-process-protocol";
import { UtilityProcessCodeAnalysisRunner } from "./utility-process-code-analysis-runner";

describe("UtilityProcessCodeAnalysisRunner", () => {
  it("starts lazily and replaces an exited analysis process", async () => {
    const children: FakeUtilityProcess[] = [];
    const spawn = vi.fn(() => {
      const child = new FakeUtilityProcess(
        1_000 + children.length
      );
      children.push(child);
      queueMicrotask(() => {
        child.emit("spawn");
        child.emit("message", {
          version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
          type: "ready"
        });
      });
      child.onPostMessage = (message) => {
        if (message.type !== "analyze") {
          return;
        }
        queueMicrotask(() => {
          child.emit("message", {
            version:
              CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
            type: "result",
            analysisId: message.analysisId,
            snapshot: createSnapshot(message.analysisId)
          });
        });
      };
      return child as unknown as UtilityProcess;
    });
    const runner = new UtilityProcessCodeAnalysisRunner({
      spawn
    });

    await expect(
      runner.analyze(createInput("analysis-1"))
    ).resolves.toMatchObject({ analysisId: "analysis-1" });
    expect(spawn).toHaveBeenCalledTimes(1);

    children[0]?.emit("exit", 1);

    await expect(
      runner.analyze(createInput("analysis-2"))
    ).resolves.toMatchObject({ analysisId: "analysis-2" });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("force-terminates an unresponsive process after cancellation", async () => {
    const child = new FakeUtilityProcess(2_000);
    const terminateTree = vi.fn(async () => undefined);
    const runner = new UtilityProcessCodeAnalysisRunner({
      spawn: () => {
        queueMicrotask(() => {
          child.emit("spawn");
          child.emit("message", {
            version:
              CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
            type: "ready"
          });
        });
        return child as unknown as UtilityProcess;
      },
      terminateTree,
      cancellationGraceMs: 5
    });
    const controller = new AbortController();
    const cancelled = new Error("Cancelled by test");
    const task = runner.analyze({
      ...createInput("analysis-cancelled"),
      signal: controller.signal
    });

    await vi.waitFor(() => {
      expect(
        child.posted.some(
          (message) => message.type === "analyze"
        )
      ).toBe(true);
    });
    controller.abort(cancelled);

    await expect(task).rejects.toBe(cancelled);
    expect(
      child.posted.some(
        (message) =>
          message.type === "cancel" &&
          message.analysisId === "analysis-cancelled"
      )
    ).toBe(true);
    expect(terminateTree).toHaveBeenCalledWith(child);
  });

  it("does not let a late result override cancellation", async () => {
    const child = new FakeUtilityProcess(2_100);
    const terminateTree = vi.fn(async () => undefined);
    const runner = new UtilityProcessCodeAnalysisRunner({
      spawn: () => {
        queueMicrotask(() => {
          child.emit("spawn");
          child.emit("message", {
            version:
              CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
            type: "ready"
          });
        });
        return child as unknown as UtilityProcess;
      },
      terminateTree,
      cancellationGraceMs: 1_000
    });
    const controller = new AbortController();
    const cancelled = new Error("Cancelled before result");
    const task = runner.analyze({
      ...createInput("analysis-result-race"),
      signal: controller.signal
    });

    await vi.waitFor(() => {
      expect(
        child.posted.some(
          (message) => message.type === "analyze"
        )
      ).toBe(true);
    });
    controller.abort(cancelled);
    child.emit("message", {
      version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
      type: "result",
      analysisId: "analysis-result-race",
      snapshot: createSnapshot("analysis-result-race")
    });

    await expect(task).rejects.toBe(cancelled);
    expect(terminateTree).not.toHaveBeenCalled();
  });

  it("rejects a concurrent analysis without orphaning the first promise", async () => {
    const child = new FakeUtilityProcess(2_200);
    child.onPostMessage = (message) => {
      if (message.type !== "analyze") {
        return;
      }
      queueMicrotask(() => {
        if (message.analysisId === "analysis-first") {
          child.emit("message", {
            version:
              CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
            type: "result",
            analysisId: message.analysisId,
            snapshot: createSnapshot(message.analysisId)
          });
          return;
        }
        child.emit("message", {
          version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
          type: "error",
          analysisId: message.analysisId,
          error: {
            name: "Error",
            message:
              "The code analysis process already has an active task."
          }
        });
      });
    };
    const runner = new UtilityProcessCodeAnalysisRunner({
      spawn: () => {
        queueMicrotask(() => {
          child.emit("spawn");
          child.emit("message", {
            version:
              CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
            type: "ready"
          });
        });
        return child as unknown as UtilityProcess;
      }
    });

    const first = runner.analyze(
      createInput("analysis-first")
    );
    const second = runner.analyze(
      createInput("analysis-second")
    );

    await expect(second).rejects.toThrow(
      "already has an active task"
    );
    await expect(first).resolves.toMatchObject({
      analysisId: "analysis-first"
    });
    expect(
      child.posted.filter(
        (message) => message.type === "analyze"
      )
    ).toHaveLength(1);
  });

  it("reports a non-zero process exit during disposal", async () => {
    const child = new FakeUtilityProcess(2_300);
    child.onPostMessage = (message) => {
      if (message.type === "analyze") {
        queueMicrotask(() => {
          child.emit("message", {
            version:
              CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
            type: "result",
            analysisId: message.analysisId,
            snapshot: createSnapshot(message.analysisId)
          });
        });
      }
      if (message.type === "dispose") {
        queueMicrotask(() => child.emit("exit", 1));
      }
    };
    const runner = new UtilityProcessCodeAnalysisRunner({
      spawn: () => {
        queueMicrotask(() => {
          child.emit("spawn");
          child.emit("message", {
            version:
              CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
            type: "ready"
          });
        });
        return child as unknown as UtilityProcess;
      }
    });

    await runner.analyze(createInput("analysis-complete"));

    await expect(runner.dispose()).rejects.toThrow(
      "exited during shutdown (code 1)"
    );
  });

  it("reports a non-zero exit while cancelling an active task for disposal", async () => {
    const child = new FakeUtilityProcess(2_350);
    child.onPostMessage = (message) => {
      if (message.type === "cancel") {
        queueMicrotask(() => child.emit("exit", 1));
      }
    };
    const runner = new UtilityProcessCodeAnalysisRunner({
      spawn: () => {
        queueMicrotask(() => {
          child.emit("spawn");
          child.emit("message", {
            version:
              CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
            type: "ready"
          });
        });
        return child as unknown as UtilityProcess;
      }
    });
    const analysis = runner.analyze(
      createInput("analysis-active-at-shutdown")
    );
    await vi.waitFor(() => {
      expect(
        child.posted.some(
          (message) => message.type === "analyze"
        )
      ).toBe(true);
    });

    const disposal = runner.dispose();

    await expect(analysis).rejects.toThrow(
      "GitNest is shutting down"
    );
    await expect(disposal).rejects.toThrow(
      "exited during shutdown (code 1)"
    );
  });

  it("terminates the process tree after a fatal process error", async () => {
    const child = new FakeUtilityProcess(2_400);
    const terminateTree = vi.fn(async () => undefined);
    const runner = new UtilityProcessCodeAnalysisRunner({
      spawn: () => {
        queueMicrotask(() => {
          child.emit("spawn");
          child.emit("message", {
            version:
              CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
            type: "ready"
          });
        });
        return child as unknown as UtilityProcess;
      },
      terminateTree
    });
    const task = runner.analyze(
      createInput("analysis-fatal")
    );

    await vi.waitFor(() => {
      expect(
        child.posted.some(
          (message) => message.type === "analyze"
        )
      ).toBe(true);
    });
    child.emit(
      "error",
      "v8-fatal",
      "code-analysis-process",
      "fatal report"
    );

    await expect(task).rejects.toThrow(
      "fatal error (v8-fatal)"
    );
    expect(terminateTree).toHaveBeenCalledTimes(1);
    expect(terminateTree).toHaveBeenCalledWith(child);
  });
});

class FakeUtilityProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly posted: CodeAnalysisHostMessage[] = [];
  readonly kill = vi.fn(() => true);
  onPostMessage:
    | ((message: CodeAnalysisHostMessage) => void)
    | undefined;

  constructor(readonly pid: number) {
    super();
  }

  postMessage(message: unknown): void {
    const hostMessage = message as CodeAnalysisHostMessage;
    this.posted.push(hostMessage);
    this.onPostMessage?.(hostMessage);
  }
}

function createInput(
  analysisId: string
): CodeAnalysisInput {
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
