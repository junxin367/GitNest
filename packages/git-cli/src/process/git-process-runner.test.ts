import { describe, expect, it } from "vitest";

import {
  createReadOnlyProcessEnvironment,
  createWritableProcessEnvironment,
  runProcess
} from "./git-process-runner";

describe("createReadOnlyProcessEnvironment", () => {
  it("disables optional Git writes and interactive prompts", () => {
    const environment = createReadOnlyProcessEnvironment({
      GIT_TRACE: "0",
      GIT_OPTIONAL_LOCKS: "1",
      GIT_TERMINAL_PROMPT: "1"
    });

    expect(environment).toMatchObject({
      LC_ALL: "C",
      LANG: "C",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "Never",
      GIT_PAGER: "cat",
      PAGER: "cat",
      GIT_TRACE: "0"
    });
  });

  it("enables repository locks for explicit write commands while keeping prompts disabled", () => {
    const environment = createWritableProcessEnvironment({
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "1"
    });

    expect(environment).toMatchObject({
      GIT_OPTIONAL_LOCKS: "1",
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "Never",
      GIT_PAGER: "cat",
      PAGER: "cat"
    });
  });

  it("terminates a process that exceeds its timeout", async () => {
    await expect(
      runProcess({
        executable: process.execPath,
        args: ["-e", "setTimeout(() => {}, 10_000)"],
        timeoutMs: 50
      })
    ).rejects.toMatchObject({
      code: "COMMAND_TIMEOUT"
    });
  });

  it("terminates a running process when aborted", async () => {
    const controller = new AbortController();
    const request = runProcess({
      executable: process.execPath,
      args: ["-e", "setTimeout(() => {}, 10_000)"],
      signal: controller.signal,
      timeoutMs: 5_000
    });

    setTimeout(() => controller.abort(), 50);

    await expect(request).rejects.toMatchObject({
      code: "COMMAND_CANCELLED"
    });
  });

  it("terminates a process that exceeds the output limit", async () => {
    await expect(
      runProcess({
        executable: process.execPath,
        args: [
          "-e",
          "process.stdout.write('x'.repeat(4096))"
        ],
        outputLimitBytes: 128
      })
    ).rejects.toMatchObject({
      code: "OUTPUT_LIMIT_EXCEEDED"
    });
  });

  it("returns bounded partial output when truncation is enabled", async () => {
    const result = await runProcess({
      executable: process.execPath,
      args: [
        "-e",
        "process.stdout.write('x'.repeat(4096)); setTimeout(() => {}, 1000)"
      ],
      outputLimitBytes: 128,
      truncateOutput: true
    });

    expect(Buffer.byteLength(result.stdout)).toBe(128);
    expect(result.outputTruncated).toBe(true);
  });

  it("keeps a side-effecting process alive while discarding excess output", async () => {
    const result = await runProcess({
      executable: process.execPath,
      args: [
        "-e",
        "process.stdout.write('x'.repeat(4096))"
      ],
      outputLimitBytes: 128,
      discardOutputAfterLimit: true
    });

    expect(result.exitCode).toBe(0);
    expect(Buffer.byteLength(result.stdout)).toBe(128);
    expect(result.outputTruncated).toBe(true);
  });
});
