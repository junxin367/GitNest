import type {
  CodeAnalysisInput,
  CodeAnalysisProgress,
  CodeAnalysisSnapshot
} from "@gitnest/code-analysis";

export const CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION = 1;

export type SerializableCodeAnalysisInput = Omit<
  CodeAnalysisInput,
  "signal" | "onProgress"
>;

export type CodeAnalysisHostMessage =
  | {
      version: typeof CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION;
      type: "analyze";
      analysisId: string;
      input: SerializableCodeAnalysisInput;
    }
  | {
      version: typeof CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION;
      type: "cancel";
      analysisId: string;
      reason: string;
    }
  | {
      version: typeof CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION;
      type: "dispose";
    };

export type CodeAnalysisWorkerMessage =
  | {
      version: typeof CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION;
      type: "ready";
    }
  | {
      version: typeof CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION;
      type: "progress";
      analysisId: string;
      progress: CodeAnalysisProgress;
    }
  | {
      version: typeof CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION;
      type: "result";
      analysisId: string;
      snapshot: CodeAnalysisSnapshot;
    }
  | {
      version: typeof CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION;
      type: "cancelled";
      analysisId: string;
      message: string;
    }
  | {
      version: typeof CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION;
      type: "error";
      analysisId: string;
      error: {
        name: string;
        message: string;
      };
    }
  | {
      version: typeof CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION;
      type: "disposed";
    };

export function isCodeAnalysisHostMessage(
  value: unknown
): value is CodeAnalysisHostMessage {
  if (
    !isRecord(value) ||
    value.version !== CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION ||
    typeof value.type !== "string"
  ) {
    return false;
  }
  if (value.type === "dispose") {
    return true;
  }
  if (
    (value.type === "analyze" ||
      value.type === "cancel") &&
    isAnalysisId(value.analysisId)
  ) {
    return value.type === "cancel"
      ? typeof value.reason === "string"
      : isRecord(value.input) &&
          value.input.analysisId === value.analysisId;
  }
  return false;
}

export function isCodeAnalysisWorkerMessage(
  value: unknown
): value is CodeAnalysisWorkerMessage {
  if (
    !isRecord(value) ||
    value.version !== CODE_ANALYSIS_PROCESS_PROTOCOL_VERSION ||
    typeof value.type !== "string"
  ) {
    return false;
  }
  if (value.type === "ready" || value.type === "disposed") {
    return true;
  }
  if (!isAnalysisId(value.analysisId)) {
    return false;
  }
  switch (value.type) {
    case "progress":
      return isRecord(value.progress);
    case "result":
      return (
        isRecord(value.snapshot) &&
        value.snapshot.analysisId === value.analysisId
      );
    case "cancelled":
      return typeof value.message === "string";
    case "error":
      return (
        isRecord(value.error) &&
        typeof value.error.name === "string" &&
        typeof value.error.message === "string"
      );
    default:
      return false;
  }
}

function isAnalysisId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    !value.includes("\0")
  );
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return Boolean(
    value && typeof value === "object" && !Array.isArray(value)
  );
}
