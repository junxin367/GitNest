/**
 * Minimal MCP (Model Context Protocol) stdio transport.
 *
 * The packaged app ships without node_modules, so this speaks
 * newline-delimited JSON-RPC 2.0 directly instead of pulling in
 * the official SDK. stdout carries protocol frames only; every
 * diagnostic goes to stderr.
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05"
] as const;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export const JSON_RPC_ERRORS = {
  parseError: -32_700,
  invalidRequest: -32_600,
  methodNotFound: -32_601,
  invalidParams: -32_602,
  internalError: -32_603
} as const;

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

export interface McpToolContext {
  signal?: AbortSignal;
}

export interface McpToolHandler {
  definition: McpToolDefinition;
  handle(
    args: Record<string, unknown>,
    context: McpToolContext
  ): Promise<McpToolResult>;
}

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface McpServerOptions {
  info: McpServerInfo;
  tools: readonly McpToolHandler[];
  instructions?: string;
  /** Extra methods such as ping. */
  onRequest?(
    method: string,
    params: unknown
  ): Promise<unknown> | undefined;
  onNotification?(method: string, params: unknown): void;
  writeError?(message: string): void;
}

export class McpProtocolServer {
  readonly #options: McpServerOptions;
  readonly #tools: Map<string, McpToolHandler>;
  #clientProtocolVersion = MCP_PROTOCOL_VERSION;

  constructor(options: McpServerOptions) {
    this.#options = options;
    this.#tools = new Map(
      options.tools.map((tool) => [
        tool.definition.name,
        tool
      ])
    );
  }

  async handleMessage(
    message: unknown
  ): Promise<JsonRpcResponse | undefined> {
    if (!isRecord(message)) {
      return failure(
        null,
        JSON_RPC_ERRORS.invalidRequest,
        "Invalid JSON-RPC message."
      );
    }
    const method = message.method;
    const id = normalizeId(message.id);
    if (typeof method !== "string" || id === undefined) {
      if (typeof method !== "string") {
        return failure(
          id ?? null,
          JSON_RPC_ERRORS.invalidRequest,
          "Missing JSON-RPC method."
        );
      }
      this.#options.onNotification?.(
        method,
        message.params
      );
      return undefined;
    }
    const params = message.params;

    try {
      const result = await this.#dispatch(method, params);
      if (result === NOT_HANDLED) {
        return failure(
          id,
          JSON_RPC_ERRORS.methodNotFound,
          `Unknown method: ${method}`
        );
      }
      return { jsonrpc: "2.0", id, result };
    } catch (error) {
      if (error instanceof ToolFailure) {
        return failure(
          id,
          JSON_RPC_ERRORS.invalidParams,
          error.message,
          error.data
        );
      }
      const message =
        error instanceof Error ? error.message : String(error);
      this.#options.writeError?.(`request failed: ${message}`);
      return failure(
        id,
        JSON_RPC_ERRORS.internalError,
        message
      );
    }
  }

  async #dispatch(
    method: string,
    params: unknown
  ): Promise<unknown> {
    switch (method) {
      case "initialize":
        return this.#initialize(params);
      case "ping":
        return {};
      case "tools/list":
        return {
          tools: this.#options.tools.map((tool) => ({
            name: tool.definition.name,
            title: tool.definition.title,
            description: tool.definition.description,
            inputSchema: tool.definition.inputSchema
          }))
        };
      case "tools/call":
        return this.#callTool(params);
      default: {
        const custom = await this.#options.onRequest?.(
          method,
          params
        );
        return custom === undefined ? NOT_HANDLED : custom;
      }
    }
  }

  #initialize(params: unknown): unknown {
    const requested = isRecord(params)
      ? params.protocolVersion
      : undefined;
    if (typeof requested === "string") {
      this.#clientProtocolVersion = (
        SUPPORTED_PROTOCOL_VERSIONS as readonly string[]
      ).includes(requested)
        ? requested
        : MCP_PROTOCOL_VERSION;
    }
    return {
      protocolVersion: this.#clientProtocolVersion,
      capabilities: {
        tools: { listChanged: false }
      },
      serverInfo: this.#options.info,
      ...(this.#options.instructions
        ? { instructions: this.#options.instructions }
        : {})
    };
  }

  async #callTool(params: unknown): Promise<McpToolResult> {
    if (!isRecord(params) || typeof params.name !== "string") {
      throw new ToolFailure("tools/call 需要 name 参数。");
    }
    const tool = this.#tools.get(params.name);
    if (!tool) {
      throw new ToolFailure(`未知工具：${params.name}`);
    }
    const args = isRecord(params.arguments)
      ? params.arguments
      : {};
    return tool.handle(args, {});
  }
}

const NOT_HANDLED = Symbol("not-handled");

export class ToolFailure extends Error {
  readonly data: unknown;

  constructor(message: string, data?: unknown) {
    super(message);
    this.name = "ToolFailure";
    this.data = data;
  }
}

export function textResult(
  payload: unknown,
  options: { isError?: boolean } = {}
): McpToolResult {
  const text = JSON.stringify(payload, null, 2);
  return {
    content: [{ type: "text", text }],
    ...(options.isError ? { isError: true } : {}),
    ...(isRecord(payload)
      ? { structuredContent: payload }
      : {})
  };
}

export function failure(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcFailure {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  };
}

export function normalizeId(
  value: unknown
): string | number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  return undefined;
}

export function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
