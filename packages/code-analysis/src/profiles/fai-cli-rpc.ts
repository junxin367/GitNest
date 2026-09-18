import type { ParsedRemoteBoundary } from "../model";
import type {
  JavaMethodProfileContext,
  SourceAnalysisProfile
} from "./types";

const JAVA_REFERENCE_PATTERN =
  /\b[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*){3,}\b/g;

export const faiCliRpcProfile: SourceAnalysisProfile = {
  id: "fai-cli-rpc",
  version: 1,
  collectJavaMethodBoundaries(
    context
  ): ParsedRemoteBoundary[] {
    const boundaries: ParsedRemoteBoundary[] = [];
    const seen = new Set<string>();

    for (const {
      wrapperId,
      argumentsText: annotationArguments
    } of extractJavaAnnotations(context.annotations)) {
      for (const referenceMatch of annotationArguments.matchAll(
        JAVA_REFERENCE_PATTERN
      )) {
        const rawReference = referenceMatch[0];
        if (!rawReference) {
          continue;
        }
        const operation = parseProtocolOperation(
          rawReference,
          context
        );
        if (!operation) {
          continue;
        }
        const deduplicationKey = operation.operationKey;
        if (seen.has(deduplicationKey)) {
          continue;
        }
        seen.add(deduplicationKey);
        boundaries.push({
          profileId: "fai-cli-rpc",
          transport: "rpc",
          role: context.hasBody ? "server" : "client",
          operationKey: operation.operationKey,
          operationName: operation.operationName,
          serviceKey: operation.serviceKey,
          rawOperation: operation.rawOperation,
          wrapperId,
          line: context.line,
          symbolQualifiedName: context.symbolQualifiedName,
          confidence: operation.resolved
            ? "exact"
            : "probable"
        });
      }
    }

    return boundaries;
  }
};

function extractJavaAnnotations(
  annotations: string
): Array<{
  wrapperId: string;
  argumentsText: string;
}> {
  const values: Array<{
    wrapperId: string;
    argumentsText: string;
  }> = [];
  const pattern =
    /@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g;
  let match = pattern.exec(annotations);
  while (match) {
    const wrapperId = match[1];
    let cursor = skipWhitespace(
      annotations,
      match.index + match[0].length
    );
    if (wrapperId && annotations[cursor] === "(") {
      const end = findMatchingParenthesis(annotations, cursor);
      values.push({
        wrapperId,
        argumentsText: annotations.slice(cursor + 1, end)
      });
      pattern.lastIndex = Math.max(end + 1, pattern.lastIndex);
    }
    match = pattern.exec(annotations);
  }
  return values;
}

function skipWhitespace(value: string, start: number): number {
  let index = start;
  while (/\s/.test(value[index] ?? "")) {
    index += 1;
  }
  return index;
}

function findMatchingParenthesis(
  value: string,
  opening: number
): number {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = opening; index < value.length; index += 1) {
    const current = value[index] ?? "";
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === quote) {
        quote = "";
      }
      continue;
    }
    if (current === '"' || current === "'") {
      quote = current;
      continue;
    }
    if (current === "(") {
      depth += 1;
    } else if (current === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return value.length;
}

function parseProtocolOperation(
  rawReference: string,
  context: Pick<
    JavaMethodProfileContext,
    "imports" | "packageName"
  >
):
  | {
      operationKey: string;
      operationName: string;
      rawOperation: string;
      resolved: boolean;
      serviceKey: string;
    }
  | undefined {
  const rawOperation = rawReference.replace(/\s+/g, "");
  const segments = rawOperation.split(".");
  const protocolIndex = segments.lastIndexOf("Protocol");
  if (
    protocolIndex < 1 ||
    segments[protocolIndex + 1] !== "Cmd" ||
    !segments[protocolIndex + 2] ||
    protocolIndex + 3 !== segments.length
  ) {
    return undefined;
  }

  const resolved = resolveJavaReference(
    segments,
    context.imports,
    context.packageName
  );
  const operationSegments = resolved.segments;
  const resolvedProtocolIndex =
    operationSegments.lastIndexOf("Protocol");
  return {
    operationKey: operationSegments.join("."),
    operationName:
      operationSegments[resolvedProtocolIndex + 2] ?? rawOperation,
    rawOperation,
    resolved: resolved.resolved,
    serviceKey: operationSegments
      .slice(0, resolvedProtocolIndex)
      .join(".")
  };
}

function resolveJavaReference(
  segments: string[],
  imports: ReadonlyMap<string, string>,
  packageName: string
): { segments: string[]; resolved: boolean } {
  const first = segments[0];
  if (!first) {
    return { segments, resolved: false };
  }
  const imported = imports.get(first);
  if (imported) {
    return {
      segments: [...imported.split("."), ...segments.slice(1)],
      resolved: true
    };
  }
  if (/^[a-z]/.test(first)) {
    return { segments, resolved: true };
  }
  if (packageName) {
    return {
      segments: [...packageName.split("."), ...segments],
      resolved: true
    };
  }
  return { segments, resolved: false };
}
