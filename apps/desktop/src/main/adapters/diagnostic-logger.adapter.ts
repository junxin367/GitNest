import {
  mkdir,
  open,
  stat,
  unlink,
  rename
} from "node:fs/promises";
import {
  dirname,
  isAbsolute
} from "node:path";

export type DiagnosticLevel =
  | "info"
  | "warning"
  | "error";

export interface DiagnosticLoggerOptions {
  maxBytes?: number;
  maxFiles?: number;
  clock?: () => string;
  redactedPaths?: readonly string[];
  redactedValues?: readonly string[];
}

export interface DiagnosticRedactionOptions {
  paths?: readonly string[];
  values?: readonly string[];
}

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_FILES = 3;
const MAX_EVENT_LENGTH = 160;
const MAX_STRING_LENGTH = 4_096;
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;
const SECRET_KEYS = [
  "token",
  "password",
  "secret",
  "authorization",
  "credential",
  "privatekey",
  "apikey",
  "accesskey",
  "refreshtoken"
];
const USER_CONTENT_KEYS = [
  "body",
  "content",
  "prompt",
  "diff",
  "patch",
  "commitmessage",
  "commitsubject"
];

export class RotatingDiagnosticLogger {
  readonly #filePath: string;
  readonly #maxBytes: number;
  readonly #maxFiles: number;
  readonly #clock: () => string;
  readonly #redaction: Required<DiagnosticRedactionOptions>;
  #tail: Promise<void> = Promise.resolve();

  constructor(
    filePath: string,
    options: DiagnosticLoggerOptions = {}
  ) {
    if (!isAbsolute(filePath)) {
      throw new Error(
        "Diagnostic log path must be absolute."
      );
    }
    const maxBytes =
      options.maxBytes ?? DEFAULT_MAX_BYTES;
    const maxFiles =
      options.maxFiles ?? DEFAULT_MAX_FILES;
    if (
      !Number.isInteger(maxBytes) ||
      maxBytes < 256 ||
      !Number.isInteger(maxFiles) ||
      maxFiles < 1 ||
      maxFiles > 10
    ) {
      throw new Error(
        "Diagnostic log limits are outside supported bounds."
      );
    }
    this.#filePath = filePath;
    this.#maxBytes = maxBytes;
    this.#maxFiles = maxFiles;
    this.#clock =
      options.clock ?? (() => new Date().toISOString());
    this.#redaction = {
      paths: uniqueSensitiveValues([
        process.env.USERPROFILE,
        process.env.HOME,
        ...(options.redactedPaths ?? [])
      ]),
      values: uniqueSensitiveValues([
        ...Object.values(process.env),
        ...(options.redactedValues ?? [])
      ])
    };
  }

  info(
    event: string,
    context: unknown = {}
  ): Promise<void> {
    return this.write("info", event, context);
  }

  warning(
    event: string,
    context: unknown = {}
  ): Promise<void> {
    return this.write("warning", event, context);
  }

  error(
    event: string,
    context: unknown = {}
  ): Promise<void> {
    return this.write("error", event, context);
  }

  write(
    level: DiagnosticLevel,
    event: string,
    context: unknown = {}
  ): Promise<void> {
    const normalizedEvent = validateEvent(event);
    const record = {
      timestamp: this.#clock(),
      level,
      event: normalizedEvent,
      context: sanitizeDiagnosticValue(
        context,
        this.#redaction
      )
    };
    const line = fitRecordToLimit(
      record,
      this.#maxBytes
    );
    const write = this.#tail.then(() =>
      this.#append(line)
    );
    this.#tail = write.catch(() => undefined);
    return write;
  }

  flush(): Promise<void> {
    return this.#tail;
  }

  async #append(line: string): Promise<void> {
    const directory = dirname(this.#filePath);
    await mkdir(directory, { recursive: true });
    const bytes = Buffer.byteLength(line, "utf8");
    const currentSize = await stat(this.#filePath)
      .then((info) => info.size)
      .catch((error) =>
        getErrorCode(error) === "ENOENT"
          ? 0
          : Promise.reject(error)
      );
    if (currentSize > 0 && currentSize + bytes > this.#maxBytes) {
      await this.#rotate();
    }

    const handle = await open(this.#filePath, "a", 0o600);
    try {
      await handle.writeFile(line, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async #rotate(): Promise<void> {
    if (this.#maxFiles === 1) {
      await unlink(this.#filePath).catch((error) => {
        if (getErrorCode(error) !== "ENOENT") {
          throw error;
        }
      });
      return;
    }

    for (
      let index = this.#maxFiles - 1;
      index >= 1;
      index -= 1
    ) {
      const source =
        index === 1
          ? this.#filePath
          : `${this.#filePath}.${index - 1}`;
      const destination = `${this.#filePath}.${index}`;
      await unlink(destination).catch((error) => {
        if (getErrorCode(error) !== "ENOENT") {
          throw error;
        }
      });
      await rename(source, destination).catch((error) => {
        if (getErrorCode(error) !== "ENOENT") {
          throw error;
        }
      });
    }
  }
}

export function sanitizeDiagnosticValue(
  value: unknown,
  redaction: DiagnosticRedactionOptions = {}
): unknown {
  return sanitizeValue(
    value,
    undefined,
    0,
    new WeakSet(),
    {
      paths: uniqueSensitiveValues(
        redaction.paths ?? []
      ),
      values: uniqueSensitiveValues(
        redaction.values ?? []
      )
    }
  );
}

function sanitizeValue(
  value: unknown,
  key: string | undefined,
  depth: number,
  seen: WeakSet<object>,
  redaction: Required<DiagnosticRedactionOptions>
): unknown {
  const normalizedKey = key
    ?.replace(/[^a-zA-Z0-9]/g, "")
    .toLocaleLowerCase("en-US");
  if (
    normalizedKey &&
    (normalizedKey === "env" ||
      normalizedKey === "environment" ||
      normalizedKey === "processenv")
  ) {
    return "[REDACTED_ENVIRONMENT]";
  }
  if (
    normalizedKey &&
    SECRET_KEYS.some((candidate) =>
      normalizedKey.includes(candidate)
    )
  ) {
    return "[REDACTED_SECRET]";
  }
  if (
    normalizedKey &&
    USER_CONTENT_KEYS.some((candidate) =>
      normalizedKey.includes(candidate)
    )
  ) {
    return "[REDACTED_USER_CONTENT]";
  }
  if (depth > MAX_DEPTH) {
    return "[DEPTH_LIMIT]";
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return sanitizeString(value, redaction);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Buffer.isBuffer(value)) {
    return `[BUFFER_${value.byteLength}_BYTES]`;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message, redaction),
      ...("code" in value &&
      typeof value.code === "string"
        ? { code: value.code }
        : {})
    };
  }
  if (typeof value !== "object") {
    return String(value);
  }
  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) =>
          sanitizeValue(
            item,
            undefined,
            depth + 1,
            seen,
            redaction
          )
        );
    }
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .map(([entryKey, entryValue]) => [
          entryKey,
          sanitizeValue(
            entryValue,
            entryKey,
            depth + 1,
            seen,
            redaction
          )
        ])
        .filter((entry) => entry[1] !== undefined)
    );
  } finally {
    seen.delete(value);
  }
}

function sanitizeString(
  value: string,
  redaction: Required<DiagnosticRedactionOptions>
): string {
  let sanitized = value
    .replace(
      /-----BEGIN [^-]*(?:PRIVATE KEY|OPENSSH PRIVATE KEY)-----[\s\S]*?-----END [^-]*(?:PRIVATE KEY|OPENSSH PRIVATE KEY)-----/gi,
      "[REDACTED_PRIVATE_KEY]"
    )
    .replace(
      /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
      "$1 [REDACTED]"
    )
    .replace(
      /\bAuthorization\s*[:=]\s*[^\s,;]+/gi,
      "Authorization=[REDACTED]"
    );
  sanitized = sanitized.replace(
    /\b(?:https?|ssh):\/\/[^\s<>"']+/gi,
    (candidate) => sanitizeUrl(candidate)
  );
  for (const path of redaction.paths) {
    sanitized = sanitized.replace(
      createPathPattern(path),
      "[REDACTED_USER_PATH]"
    );
  }
  for (const sensitive of redaction.values) {
    sanitized = sanitized.replace(
      new RegExp(escapeRegExp(sensitive), "gi"),
      "[REDACTED_ENV_VALUE]"
    );
  }
  if (sanitized.length > MAX_STRING_LENGTH) {
    sanitized = `${sanitized.slice(
      0,
      MAX_STRING_LENGTH
    )}…[TRUNCATED]`;
  }
  return sanitized;
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = "[REDACTED]";
      url.password = "";
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.replace(
      /:\/\/[^/@\s]+@/,
      "://[REDACTED]@"
    );
  }
}

function fitRecordToLimit(
  record: {
    timestamp: string;
    level: DiagnosticLevel;
    event: string;
    context: unknown;
  },
  maxBytes: number
): string {
  const serialized = `${JSON.stringify(record)}\n`;
  if (Buffer.byteLength(serialized, "utf8") <= maxBytes) {
    return serialized;
  }
  return `${JSON.stringify({
    timestamp: record.timestamp,
    level: record.level,
    event: record.event,
    context: {
      truncated: true
    }
  })}\n`;
}

function validateEvent(event: string): string {
  if (typeof event !== "string") {
    throw new Error("Diagnostic event names must be text.");
  }
  const normalized = event.trim();
  if (
    !normalized ||
    normalized.length > MAX_EVENT_LENGTH ||
    !/^[a-zA-Z0-9_.-]+$/.test(normalized)
  ) {
    throw new Error(
      "Diagnostic event names contain invalid characters."
    );
  }
  return normalized;
}

function getErrorCode(error: unknown): string | undefined {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function uniqueSensitiveValues(
  values: readonly (string | undefined)[]
): string[] {
  return [
    ...new Set(
      values
        .filter(
          (value): value is string =>
            typeof value === "string" &&
            value.length >= 8
        )
        .sort((left, right) => right.length - left.length)
    )
  ];
}

function createPathPattern(path: string): RegExp {
  const segments = path
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(escapeRegExp);
  const prefix = /^[\\/]/.test(path) ? "[\\\\/]" : "";
  return new RegExp(
    `${prefix}${segments.join("[\\\\/]")}`,
    "gi"
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
