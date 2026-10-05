import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  afterEach,
  describe,
  expect,
  it
} from "vitest";
import { spawn } from "node:child_process";

import { WindowsGitAskPassBroker } from "./git-askpass.adapter";

const TOKEN = "askpass-secret-token-测试";

describe("WindowsGitAskPassBroker", () => {
  const temporaryPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryPaths.map((path) =>
        rm(path, { recursive: true, force: true })
      )
    );
  });

  it("keeps the token in Main memory and serves only nonce-bound host prompts", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "gitnest-askpass-test-")
    );
    temporaryPaths.push(directory);
    const broker = new WindowsGitAskPassBroker(directory, {
      nonceFactory: () => "nonce_1"
    });
    const session = await broker.open({
      host: "git.example.test",
      username: "test-user",
      secret: TOKEN
    });
    const environment = session.environment;
    const endpoint =
      environment.GITNEST_ASKPASS_ENDPOINT as string;
    const nonce =
      environment.GITNEST_ASKPASS_NONCE as string;

    expect(JSON.stringify(environment)).not.toContain(TOKEN);
    expect(environment).toMatchObject({
      GIT_ASKPASS_REQUIRE: "force",
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_VALUE_0: ""
    });
    expect(
      await readFile(
        join(directory, "gitnest-askpass.cmd"),
        "utf8"
      )
    ).not.toContain(TOKEN);
    expect(
      await readFile(
        join(directory, "gitnest-askpass.ps1"),
        "utf8"
      )
    ).not.toContain(TOKEN);

    await expect(
      ask(endpoint, nonce, {
        prompt:
          "Username for 'https://git.example.test/team/repository.git':"
      })
    ).resolves.toEqual({
      status: 200,
      body: { value: "test-user" }
    });
    await expect(
      ask(endpoint, nonce, {
        prompt:
          "Password for 'https://test-user@git.example.test/team/repository.git':"
      })
    ).resolves.toEqual({
      status: 200,
      body: { value: TOKEN }
    });
    await expect(
      ask(endpoint, "wrong_nonce", {
        prompt:
          "Password for 'https://test-user@git.example.test/team/repository.git':"
      })
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      ask(endpoint, nonce, {
        prompt:
          "Password for 'https://test-user@git.example.test.evil/repository.git':"
      })
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      ask(endpoint, nonce, {
        prompt:
          "Password for 'https://test-user@other.example.test/repository.git':"
      })
    ).resolves.toMatchObject({ status: 403 });

    await session.dispose();
    await expect(
      fetch(endpoint, {
        method: "POST"
      })
    ).rejects.toThrow();
  });

  it("closes the session when its abort signal fires", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "gitnest-askpass-test-")
    );
    temporaryPaths.push(directory);
    const broker = new WindowsGitAskPassBroker(directory, {
      nonceFactory: () => "nonce_2"
    });
    const controller = new AbortController();
    const session = await broker.open({
      host: "git.example.test",
      secret: TOKEN,
      signal: controller.signal
    });
    const endpoint =
      session.environment
        .GITNEST_ASKPASS_ENDPOINT as string;

    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(
      fetch(endpoint, {
        method: "POST"
      })
    ).rejects.toThrow();
    await session.dispose();
  });

  it("rejects cancellation while the authentication helpers are being prepared", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "gitnest-askpass-test-")
    );
    temporaryPaths.push(directory);
    const broker = new WindowsGitAskPassBroker(directory);
    const controller = new AbortController();
    let unexpectedSession:
      | Awaited<ReturnType<WindowsGitAskPassBroker["open"]>>
      | undefined;
    const opening = broker.open({
      host: "git.example.test",
      secret: TOKEN,
      signal: controller.signal
    }).then((session) => {
      unexpectedSession = session;
      return session;
    });
    controller.abort();

    try {
      await expect(opening).rejects.toMatchObject({
        code: "COMMAND_CANCELLED"
      });
    } finally {
      await unexpectedSession?.dispose();
    }
  });

  it("retries helper initialization after a temporary filesystem failure", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "gitnest-askpass-test-")
    );
    temporaryPaths.push(directory);
    const blocker = join(directory, "runtime");
    await writeFile(blocker, "not a directory", "utf8");
    const broker = new WindowsGitAskPassBroker(
      join(blocker, "askpass")
    );
    const input = {
      host: "git.example.test",
      secret: TOKEN
    };

    await expect(broker.open(input)).rejects.toThrow();
    await rm(blocker);
    const session = await broker.open(input);
    try {
      await expect(
        ask(
          session.environment.GITNEST_ASKPASS_ENDPOINT as string,
          session.environment.GITNEST_ASKPASS_NONCE as string,
          { prompt: "Password for 'https://git.example.test/repository.git':" }
        )
      ).resolves.toEqual({
        status: 200,
        body: { value: TOKEN }
      });
    } finally {
      await session.dispose();
    }
  });

  it("closes the server if cancellation arrives before listening completes", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "gitnest-askpass-test-")
    );
    temporaryPaths.push(directory);
    const controller = new AbortController();
    const broker = new WindowsGitAskPassBroker(directory, {
      nonceFactory: () => {
        controller.abort();
        return "cancelled_while_opening";
      }
    });

    await expect(broker.open({
      host: "git.example.test",
      secret: TOKEN,
      signal: controller.signal
    })).rejects.toMatchObject({
      code: "COMMAND_CANCELLED"
    });
  });

  it.runIf(process.platform === "win32")(
    "serves credentials to the real Git AskPass flow without command-line secrets",
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "gitnest-askpass-test-")
      );
      temporaryPaths.push(directory);
      const broker = new WindowsGitAskPassBroker(directory, {
        nonceFactory: () => "nonce_git"
      });
      const session = await broker.open({
        host: "git.example.test",
        username: "git-user",
        secret: TOKEN
      });
      const args = [
        "-c",
        "credential.helper=",
        "credential",
        "fill"
      ];

      expect(JSON.stringify(args)).not.toContain(TOKEN);
      expect(
        JSON.stringify(session.environment)
      ).not.toContain(TOKEN);
      const output = await runGitCredentialFill(
        args,
        session.environment
      );
      expect(output).toContain("username=git-user");
      expect(output).toContain(`password=${TOKEN}`);
      await session.dispose();
    },
    20_000
  );
});

async function ask(
  endpoint: string,
  nonce: string,
  body: { prompt: string }
): Promise<{
  status: number;
  body: unknown;
}> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitNest-Nonce": nonce
    },
    body: JSON.stringify(body)
  });
  return {
    status: response.status,
    body:
      response.headers
        .get("content-type")
        ?.includes("application/json")
        ? await response.json()
        : await response.text()
  };
}

async function runGitCredentialFill(
  args: string[],
  environment: Readonly<
    Record<string, string | undefined>
  >
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", args, {
      env: {
        ...process.env,
        ...environment,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "Never"
      },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) =>
      stdout.push(chunk)
    );
    child.stderr.on("data", (chunk: Buffer) =>
      stderr.push(chunk)
    );
    child.once("error", rejectPromise);
    child.once("close", (exitCode) => {
      if (exitCode === 0) {
        resolvePromise(
          Buffer.concat(stdout).toString("utf8")
        );
      } else {
        rejectPromise(
          new Error(
            `git credential fill failed (${exitCode}): ${Buffer.concat(
              stderr
            ).toString("utf8")}`
          )
        );
      }
    });
    child.stdin.end(
      "protocol=https\nhost=git.example.test\npath=team/repository.git\n\n"
    );
  });
}
