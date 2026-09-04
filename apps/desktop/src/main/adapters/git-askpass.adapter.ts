import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import {
  mkdir,
  readFile,
  rename,
  writeFile
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join
} from "node:path";
import { randomUUID } from "node:crypto";

import type {
  AccountAuthenticationBrokerPort,
  GitAuthenticationSession
} from "@gitnest/application";
import { GitError } from "@gitnest/git-core";

const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_ASKPASS_REQUESTS = 12;
const ASKPASS_CMD = "gitnest-askpass.cmd";
const ASKPASS_POWERSHELL = "gitnest-askpass.ps1";

export interface WindowsGitAskPassBrokerOptions {
  nonceFactory?: () => string;
}

export class WindowsGitAskPassBroker
  implements AccountAuthenticationBrokerPort
{
  readonly #runtimeDirectory: string;
  readonly #nonceFactory: () => string;
  #helperPromise: Promise<string> | undefined;

  constructor(
    runtimeDirectory: string,
    options: WindowsGitAskPassBrokerOptions = {}
  ) {
    if (!isAbsolute(runtimeDirectory)) {
      throw new Error(
        "AskPass runtime directory must be absolute."
      );
    }
    this.#runtimeDirectory = runtimeDirectory;
    this.#nonceFactory = options.nonceFactory ?? randomUUID;
  }

  async open(input: {
    host: string;
    username?: string;
    secret: string;
    signal?: AbortSignal;
  }): Promise<GitAuthenticationSession> {
    if (
      !input.host ||
      !input.secret ||
      input.secret.length > 8_192
    ) {
      throw new GitError(
        "INVALID_REQUEST",
        "AskPass requires bounded account credentials."
      );
    }
    if (input.signal?.aborted) {
      throw new GitError(
        "COMMAND_CANCELLED",
        "Authentication was cancelled before it started."
      );
    }

    const askPassPath = await this.#ensureHelper();
    const nonce = this.#nonceFactory();
    if (
      !nonce ||
      nonce.length > 160 ||
      !/^[a-zA-Z0-9_-]+$/.test(nonce)
    ) {
      throw new Error("AskPass nonce factory returned an invalid value.");
    }
    let secret = input.secret;
    let requestCount = 0;
    let disposed = false;
    const server = createServer((request, response) => {
      void handleAskPassRequest(
        request,
        response,
        {
          nonce,
          host: input.host,
          username: input.username ?? "git",
          readSecret: () => secret,
          nextRequest: () => ++requestCount
        }
      );
    });
    await listenLoopback(server);
    const address = server.address();
    if (!address || typeof address === "string") {
      await closeServer(server);
      throw new Error("AskPass server did not expose a TCP port.");
    }
    const endpoint = `http://127.0.0.1:${address.port}/`;
    const abort = () => {
      secret = "";
      void closeServer(server);
    };
    input.signal?.addEventListener("abort", abort, {
      once: true
    });

    return {
      environment: {
        GIT_ASKPASS: askPassPath,
        GIT_ASKPASS_REQUIRE: "force",
        GITNEST_ASKPASS_ENDPOINT: endpoint,
        GITNEST_ASKPASS_NONCE: nonce,
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "credential.helper",
        GIT_CONFIG_VALUE_0: ""
      },
      dispose: async () => {
        if (disposed) {
          return;
        }
        disposed = true;
        input.signal?.removeEventListener("abort", abort);
        secret = "";
        await closeServer(server);
      }
    };
  }

  #ensureHelper(): Promise<string> {
    this.#helperPromise ??= writeAskPassHelpers(
      this.#runtimeDirectory
    );
    return this.#helperPromise;
  }
}

async function handleAskPassRequest(
  request: IncomingMessage,
  response: ServerResponse,
  session: {
    nonce: string;
    host: string;
    username: string;
    readSecret(): string;
    nextRequest(): number;
  }
): Promise<void> {
  setNoStoreHeaders(response);
  if (
    request.method !== "POST" ||
    request.url !== "/" ||
    !isLoopbackAddress(request.socket.remoteAddress)
  ) {
    respond(response, 404, "");
    return;
  }
  if (
    request.headers["x-gitnest-nonce"] !== session.nonce ||
    session.nextRequest() > MAX_ASKPASS_REQUESTS
  ) {
    respond(response, 403, "");
    return;
  }

  try {
    const body = await readRequestBody(request);
    const parsed = JSON.parse(body) as unknown;
    const prompt =
      parsed &&
      typeof parsed === "object" &&
      "prompt" in parsed &&
      typeof parsed.prompt === "string"
        ? parsed.prompt
        : "";
    if (!promptMatchesHost(prompt, session.host)) {
      respond(response, 403, "");
      return;
    }
    const value = /username/i.test(prompt)
      ? session.username
      : session.readSecret();
    if (!value) {
      respond(response, 410, "");
      return;
    }
    respond(
      response,
      200,
      JSON.stringify({ value }),
      "application/json; charset=utf-8"
    );
  } catch {
    respond(response, 400, "");
  }
}

function promptMatchesHost(
  prompt: string,
  host: string
): boolean {
  const normalizedHost = host.toLocaleLowerCase("en-US");
  const urls =
    prompt.match(/https?:\/\/[^\s'"]+/gi) ?? [];
  for (const value of urls) {
    try {
      if (
        new URL(value).host.toLocaleLowerCase("en-US") ===
        normalizedHost
      ) {
        return true;
      }
    } catch {}
  }
  const escapedHost = normalizedHost.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
  return new RegExp(
    `@${escapedHost}(?=[:/'"\\s]|$)`,
    "i"
  ).test(prompt);
}

async function readRequestBody(
  request: IncomingMessage
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      throw new Error("AskPass request exceeds the limit.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function listenLoopback(server: Server): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", rejectPromise);
      resolvePromise();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections?.();
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolvePromise) => {
    server.close(() => resolvePromise());
  });
}

function setNoStoreHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function respond(
  response: ServerResponse,
  status: number,
  body: string,
  contentType = "text/plain; charset=utf-8"
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", contentType);
  response.end(body);
}

function isLoopbackAddress(
  address: string | undefined
): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

async function writeAskPassHelpers(
  directory: string
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const commandPath = join(directory, ASKPASS_CMD);
  const powerShellPath = join(
    directory,
    ASKPASS_POWERSHELL
  );
  const command = [
    "@echo off",
    `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0${ASKPASS_POWERSHELL}" "%~1"`,
    ""
  ].join("\r\n");
  const powerShell = [
    "param([string]$Prompt)",
    "$ErrorActionPreference = 'Stop'",
    "$utf8 = New-Object System.Text.UTF8Encoding($false)",
    "[Console]::OutputEncoding = $utf8",
    "$OutputEncoding = $utf8",
    "$headers = @{ 'X-GitNest-Nonce' = $env:GITNEST_ASKPASS_NONCE }",
    "$body = @{ prompt = $Prompt } | ConvertTo-Json -Compress",
    "$response = Invoke-RestMethod -Method Post -Uri $env:GITNEST_ASKPASS_ENDPOINT -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 10",
    "[Console]::Out.Write([string]$response.value)",
    ""
  ].join("\r\n");
  await writeIfChanged(commandPath, command);
  await writeIfChanged(powerShellPath, powerShell);
  return commandPath;
}

async function writeIfChanged(
  path: string,
  content: string
): Promise<void> {
  try {
    if ((await readFile(path, "utf8")) === content) {
      return;
    }
  } catch {}

  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now()}.tmp`
  );
  await writeFile(temporaryPath, content, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  await rename(temporaryPath, path);
}
