#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";

import {
  GitNestDataAccess,
  MCP_SERVER_VERSION,
  parseServerArgs,
  runMcpServer
} from "./index";

/**
 * Standalone MCP entry point.
 *
 * It is bundled as a single file so it can be launched with
 * `ELECTRON_RUN_AS_NODE=1 <GitNest.exe> <this file>`, which keeps
 * the packaged app free of a Node.js dependency.
 */
async function main(): Promise<void> {
  const args = parseServerArgs(process.argv.slice(2));
  if (args.version) {
    process.stdout.write(`${MCP_SERVER_VERSION}\n`);
    return;
  }
  const dataDirectory =
    args.dataDirectory ?? defaultDataDirectory();

  if (args.selfCheck) {
    const access = new GitNestDataAccess({
      dataDirectory,
      skipFreshness: true
    });
    const targets = await access.resolveTargets({});
    const summaries = await Promise.all(
      targets.map((target) => access.summarize(target))
    );
    process.stdout.write(
      `${JSON.stringify(
        { dataDirectory, analyses: summaries },
        null,
        2
      )}\n`
    );
    return;
  }

  await runMcpServer({
    dataDirectory
  });
}

function defaultDataDirectory(): string {
  const appData =
    process.env.APPDATA ??
    join(homedir(), "AppData", "Roaming");
  return join(appData, "@gitnest", "desktop");
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : String(error);
  process.stderr.write(`[gitnest-mcp] ${message}\n`);
  process.exitCode = 1;
});
