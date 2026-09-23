import { createInterface } from "node:readline";

import { GitNestDataAccess, type DataAccessOptions } from "./data-access";
import {
  McpProtocolServer,
  type JsonRpcResponse
} from "./protocol";
import { createTools } from "./tools";

export const MCP_SERVER_NAME = "gitnest";
export const MCP_SERVER_VERSION = "0.1.0";

export interface RunMcpServerOptions extends DataAccessOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  errorOutput?: NodeJS.WritableStream;
}

/**
 * Runs the MCP stdio loop until the input stream closes.
 *
 * stdout is reserved for JSON-RPC frames; all diagnostics are
 * written to stderr so the protocol stream stays clean.
 */
export async function runMcpServer(
  options: RunMcpServerOptions
): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;
  const access = new GitNestDataAccess({
    dataDirectory: options.dataDirectory,
    ...(options.skipFreshness !== undefined
      ? { skipFreshness: options.skipFreshness }
      : {})
  });
  const tools = createTools({
    access,
    readSettings: () => access.readMcpSettings()
  });
  const server = new McpProtocolServer({
    info: {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION
    },
    instructions:
      "GitNest 只读调用关系服务。需要查可选项目路径和 workspaceId 时，先调用 get_analysis_projects；该列表不保证已有可用快照。用当前项目的绝对路径 projectPath 调用 get_analysis_status，服务器不能推断客户端 cwd；只有 projectMatched=true 且 useMcp=true 时，才对相同路径调用 get_call_chain。查询同名函数/方法时可指定 language 筛选命中起点，跨语言调用节点仍保留。否则用 rg 查当前源码或在 GitNest 重新分析。图是有向分支而非线性执行步骤；保留 freshness、completeness、confidence，用源码核对关键边；未命中不表示代码不存在。",
    tools,
    writeError: (message) => {
      errorOutput.write(`[gitnest-mcp] ${message}\n`);
    }
  });

  const reader = createInterface({
    input,
    crlfDelay: Number.POSITIVE_INFINITY
  });

  let chain: Promise<void> = Promise.resolve();
  reader.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    chain = chain
      .then(async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          write(output, {
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32_700,
              message: "Invalid JSON payload."
            }
          });
          return;
        }
        const messages = Array.isArray(parsed) ? parsed : [parsed];
        for (const message of messages) {
          const response = await server.handleMessage(message);
          if (response) {
            write(output, response);
          }
        }
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : String(error);
        errorOutput.write(`[gitnest-mcp] ${message}\n`);
      });
  });

  await new Promise<void>((resolve) => {
    reader.on("close", () => resolve());
  });
  await chain;
}

export interface ServerArgs {
  dataDirectory: string | undefined;
  selfCheck: boolean;
  /** Print the version and exit instead of serving. */
  version: boolean;
}

export function parseServerArgs(
  argv: readonly string[]
): ServerArgs {
  let dataDirectory: string | undefined;
  let selfCheck = false;
  let version = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--data-dir") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--data-dir 需要一个路径参数。");
      }
      dataDirectory = next;
      index += 1;
      continue;
    }
    if (value?.startsWith("--data-dir=")) {
      dataDirectory = value.slice("--data-dir=".length);
      continue;
    }
    if (value === "--self-check") {
      selfCheck = true;
      continue;
    }
    if (value === "--version" || value === "-v") {
      version = true;
      continue;
    }
    throw new Error(`未知参数：${value}`);
  }
  return { dataDirectory, selfCheck, version };
}

function write(
  output: NodeJS.WritableStream,
  response: JsonRpcResponse
): void {
  output.write(`${JSON.stringify(response)}\n`);
}
