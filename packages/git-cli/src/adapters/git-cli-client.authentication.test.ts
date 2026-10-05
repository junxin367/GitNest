import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import type {
  GitEnvironment,
  GitReadOptions
} from "@gitnest/git-core";

const environmentMocks = vi.hoisted(() => ({
  findGitExecutable: vi.fn(),
  readGitEnvironment: vi.fn()
}));

vi.mock("../environment/find-git-executable", () => ({
  findGitExecutable: environmentMocks.findGitExecutable
}));

vi.mock("../environment/read-git-environment", () => ({
  readGitEnvironment: environmentMocks.readGitEnvironment
}));

import {
  GitCliClient,
  classifyRemoteConnectionFailure
} from "./git-cli-client";

describe("Git remote authentication classification", () => {
  beforeEach(() => {
    environmentMocks.findGitExecutable.mockReset();
    environmentMocks.readGitEnvironment.mockReset();
  });

  it("shares concurrent cold-start discovery and retries after a failure", async () => {
    let resolveDiscovery!: (value: string) => void;
    const discovery = new Promise<string>((resolve) => {
      resolveDiscovery = resolve;
    });
    environmentMocks.findGitExecutable
      .mockRejectedValueOnce(
        new Error("Git discovery is temporarily unavailable.")
      )
      .mockReturnValue(discovery);
    environmentMocks.readGitEnvironment.mockImplementation(
      async (executablePath: string) =>
        createEnvironment(executablePath, "manager-core")
    );
    const client = new GitCliClient();

    await expect(client.getEnvironment()).rejects.toThrow(
      "Git discovery is temporarily unavailable."
    );
    const first = client.getEnvironment();
    const second = client.getEnvironment();
    await Promise.resolve();

    expect(
      environmentMocks.findGitExecutable
    ).toHaveBeenCalledTimes(2);

    resolveDiscovery("C:\\Git\\cmd\\git.exe");
    const environments = await Promise.all([first, second]);
    expect(environments).toEqual([
      expect.objectContaining({
        executablePath: "C:\\Git\\cmd\\git.exe"
      }),
      expect.objectContaining({
        executablePath: "C:\\Git\\cmd\\git.exe"
      })
    ]);
    expect(environmentMocks.readGitEnvironment).toHaveBeenCalledTimes(
      1
    );
    expect(environments[0]).not.toBe(environments[1]);
    expect(environments[0]?.credentialHelpers).not.toBe(
      environments[1]?.credentialHelpers
    );
    environments[0]?.credentialHelpers.push("mutated");
    expect(environments[1]?.credentialHelpers).toEqual([
      "manager-core"
    ]);

    await client.getEnvironment();
    expect(environmentMocks.readGitEnvironment).toHaveBeenCalledTimes(
      2
    );
  });

  it("retries after the environment read itself fails", async () => {
    environmentMocks.findGitExecutable.mockResolvedValue(
      "C:\\Git\\cmd\\git.exe"
    );
    environmentMocks.readGitEnvironment
      .mockRejectedValueOnce(
        new Error("Git environment is temporarily unavailable.")
      )
      .mockResolvedValue(
        createEnvironment(
          "C:\\Git\\cmd\\git.exe",
          "retry-success"
        )
      );
    const client = new GitCliClient();

    await expect(client.getEnvironment()).rejects.toThrow(
      "Git environment is temporarily unavailable."
    );
    await expect(client.getEnvironment()).resolves.toMatchObject({
      credentialHelpers: ["retry-success"]
    });

    expect(
      environmentMocks.findGitExecutable
    ).toHaveBeenCalledTimes(1);
    expect(environmentMocks.readGitEnvironment).toHaveBeenCalledTimes(
      2
    );
  });

  it("keeps different request groups and signalled cancellation independent", async () => {
    const executablePath = "C:\\Git\\cmd\\git.exe";
    environmentMocks.findGitExecutable.mockResolvedValue(
      executablePath
    );
    environmentMocks.readGitEnvironment.mockResolvedValue(
      createEnvironment(executablePath, "prime")
    );
    const client = new GitCliClient();
    await client.getEnvironment();
    environmentMocks.readGitEnvironment.mockReset();

    const sharedRead = deferred<GitEnvironment>();
    const timeoutRead = deferred<GitEnvironment>();
    const backgroundRead = deferred<GitEnvironment>();
    const allReadsStarted = deferred<void>();
    let startedReads = 0;
    environmentMocks.readGitEnvironment.mockImplementation(
      (
        _executablePath: string,
        options: GitReadOptions = {}
      ) => {
        startedReads += 1;
        if (startedReads === 4) {
          allReadsStarted.resolve();
        }
        const signal = options.signal;
        if (signal) {
          return new Promise<GitEnvironment>(
            (_resolve, reject) => {
              const cancel = () =>
                reject(new Error("Signalled read cancelled."));
              if (signal.aborted) {
                cancel();
                return;
              }
              signal.addEventListener("abort", cancel, {
                once: true
              });
            }
          );
        }
        if (options.timeoutMs === 100) {
          return timeoutRead.promise;
        }
        if (options.priority === "background") {
          return backgroundRead.promise;
        }
        return sharedRead.promise;
      }
    );

    const firstShared = client.getEnvironment();
    const secondShared = client.getEnvironment();
    const timed = client.getEnvironment({ timeoutMs: 100 });
    const background = client.getEnvironment({
      priority: "background"
    });
    const controller = new AbortController();
    const signalled = client.getEnvironment({
      signal: controller.signal
    });
    await allReadsStarted.promise;

    expect(environmentMocks.readGitEnvironment).toHaveBeenCalledTimes(
      4
    );
    let timedSettled = false;
    let backgroundSettled = false;
    void timed.then(
      () => {
        timedSettled = true;
      },
      () => {
        timedSettled = true;
      }
    );
    void background.then(
      () => {
        backgroundSettled = true;
      },
      () => {
        backgroundSettled = true;
      }
    );

    controller.abort();
    await expect(signalled).rejects.toThrow(
      "Signalled read cancelled."
    );
    sharedRead.resolve(
      createEnvironment(executablePath, "shared")
    );
    await expect(
      Promise.all([firstShared, secondShared])
    ).resolves.toEqual([
      expect.objectContaining({
        credentialHelpers: ["shared"]
      }),
      expect.objectContaining({
        credentialHelpers: ["shared"]
      })
    ]);
    expect(timedSettled).toBe(false);
    expect(backgroundSettled).toBe(false);

    timeoutRead.resolve(
      createEnvironment(executablePath, "timeout")
    );
    backgroundRead.resolve(
      createEnvironment(executablePath, "background")
    );
    await expect(timed).resolves.toMatchObject({
      credentialHelpers: ["timeout"]
    });
    await expect(background).resolves.toMatchObject({
      credentialHelpers: ["background"]
    });
  });

  it.each([
    ["fatal: Authentication failed for repository", "authentication-failed"],
    ["fatal: could not read Username for 'https://host'", "authentication-failed"],
    ["remote: HTTP 401", "authentication-failed"],
    ["remote: You are not allowed to access this repository", "permission-denied"],
    ["fatal: unable to access: The requested URL returned error: 403", "permission-denied"],
    ["ERROR: Permission denied (publickey)", "permission-denied"],
    ["remote: Repository not found.", "permission-denied"],
    ["Could not resolve host: git.example.test", "unavailable"]
  ] as const)(
    "maps %s without returning raw diagnostics",
    (diagnostic, expected) => {
      expect(
        classifyRemoteConnectionFailure(diagnostic)
      ).toBe(expected);
    }
  );

  it("rejects file and credential-bearing HTTPS test URLs before spawning Git", async () => {
    const client = new GitCliClient();

    await expect(
      client.testRemoteConnection({
        repositoryUrl: "file:///C:/repository.git",
        environment: {}
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    await expect(
      client.testRemoteConnection({
        repositoryUrl:
          "https://token:secret@git.example.test/repository.git",
        environment: {}
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
  });
});

function createEnvironment(
  executablePath: string,
  helper: string
): GitEnvironment {
  return {
    executablePath,
    version: "2.51.0",
    lfs: { available: false },
    identity: {},
    credentialHelpers: [helper],
    ssh: {
      command: "ssh",
      authSockConfigured: false,
      configExists: false
    },
    detectedAt: "2026-10-03T00:00:00.000Z"
  };
}

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>(
    (resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    }
  );
  return { promise, resolve, reject };
}
