import {
  assertCodeAnalysisSnapshotPayloadSize,
  CodeAnalysisEngine,
  type CodeAnalysisInput,
  type CodeAnalysisSnapshot
} from "@gitnest/code-analysis";

import {
  CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
  isCodeAnalysisHostMessage,
  type CodeAnalysisHostMessage,
  type CodeAnalysisWorkerMessage
} from "./code-analysis-process-protocol";

interface AnalysisEngine {
  analyze(
    input: CodeAnalysisInput
  ): Promise<CodeAnalysisSnapshot>;
  dispose(): Promise<void>;
}

export interface AnalysisParentPort {
  on(
    event: "message",
    listener: (event: { data: unknown }) => void
  ): this;
  postMessage(message: unknown): void;
}

export interface CodeAnalysisProcessRuntimeOptions {
  createEngine?: () => AnalysisEngine;
  exit?: (code: number) => void;
}

export interface CodeAnalysisProcessController {
  dispose(): Promise<void>;
}

export function startCodeAnalysisProcess(
  parentPort: AnalysisParentPort,
  options: CodeAnalysisProcessRuntimeOptions = {}
): CodeAnalysisProcessController {
  const engine =
    options.createEngine?.() ?? new CodeAnalysisEngine();
  let active:
    | {
        analysisId: string;
        controller: AbortController;
        task: Promise<void>;
      }
    | undefined;
  let disposing = false;

  const post = (message: CodeAnalysisWorkerMessage): void => {
    parentPort.postMessage(message);
  };

  const runAnalysis = (
    message: Extract<
      CodeAnalysisHostMessage,
      { type: "analyze" }
    >
  ): void => {
    if (disposing) {
      postError(
        post,
        message.analysisId,
        new Error("Code analysis process is shutting down.")
      );
      return;
    }
    if (active) {
      postError(
        post,
        message.analysisId,
        new Error(
          "The code analysis process already has an active task."
        )
      );
      return;
    }
    const controller = new AbortController();
    const task = Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) {
          throw controller.signal.reason;
        }
        return engine.analyze({
          ...message.input,
          signal: controller.signal,
          onProgress: (progress) => {
            post({
              version:
                CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
              type: "progress",
              analysisId: message.analysisId,
              progress
            });
          }
        });
      })
      .then((snapshot) => {
        assertCodeAnalysisSnapshotPayloadSize(snapshot);
        post({
          version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
          type: "result",
          analysisId: message.analysisId,
          snapshot
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          post({
            version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
            type: "cancelled",
            analysisId: message.analysisId,
            message: errorMessage(
              controller.signal.reason ?? error
            )
          });
          return;
        }
        postError(post, message.analysisId, error);
      })
      .finally(() => {
        if (active?.analysisId === message.analysisId) {
          active = undefined;
        }
      });
    active = {
      analysisId: message.analysisId,
      controller,
      task
    };
  };

  const dispose = async (): Promise<void> => {
    if (disposing) {
      return;
    }
    disposing = true;
    active?.controller.abort(
      new Error("Code analysis process is shutting down.")
    );
    await active?.task.catch(() => undefined);
    await engine.dispose();
    post({
      version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
      type: "disposed"
    });
    options.exit?.(0);
  };

  parentPort.on("message", (event) => {
    const message = event.data;
    if (!isCodeAnalysisHostMessage(message)) {
      const analysisId = readAnalysisId(message);
      if (analysisId) {
        postError(
          post,
          analysisId,
          new Error("Invalid code analysis process message.")
        );
      }
      return;
    }
    switch (message.type) {
      case "analyze":
        runAnalysis(message);
        break;
      case "cancel":
        if (active?.analysisId === message.analysisId) {
          active.controller.abort(new Error(message.reason));
        }
        break;
      case "dispose":
        void dispose().catch((error) => {
          const analysisId = active?.analysisId;
          if (analysisId) {
            postError(post, analysisId, error);
          }
          options.exit?.(1);
        });
        break;
    }
  });

  post({
    version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
    type: "ready"
  });

  return { dispose };
}

function postError(
  post: (message: CodeAnalysisWorkerMessage) => void,
  analysisId: string,
  error: unknown
): void {
  post({
    version: CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION,
    type: "error",
    analysisId,
    error: {
      name: error instanceof Error ? error.name : "Error",
      message: errorMessage(error)
    }
  });
}

function readAnalysisId(value: unknown): string | undefined {
  return value &&
    typeof value === "object" &&
    "analysisId" in value &&
    typeof value.analysisId === "string"
    ? value.analysisId
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
