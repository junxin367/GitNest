import {
  readFile,
  readdir,
  stat
} from "node:fs/promises";
import { join } from "node:path";

import {
  afterEach,
  describe,
  expect,
  it
} from "vitest";

import {
  createTemporaryDirectoryFixture,
  type TemporaryDirectoryFixture
} from "@gitnest/testkit";

import {
  RotatingDiagnosticLogger,
  sanitizeDiagnosticValue
} from "./diagnostic-logger.adapter";

const SECRET_CANARY =
  "diagnostic-secret-canary-must-not-appear";

describe("RotatingDiagnosticLogger", () => {
  let temporary: TemporaryDirectoryFixture | undefined;

  afterEach(async () => {
    await temporary?.dispose();
    temporary = undefined;
  });

  it("redacts secret fields, authorization values, URL userinfo, private keys, and user content recursively", async () => {
    temporary =
      await createTemporaryDirectoryFixture(
        "diagnostic-redaction"
      );
    const filePath = join(
      temporary.path,
      "logs",
      "gitnest.log"
    );
    const logger = new RotatingDiagnosticLogger(filePath, {
      clock: () => "2026-09-04T12:00:00.000Z",
      redactedPaths: ["C:\\Users\\junes"],
      redactedValues: ["diagnostic-environment-canary"]
    });

    await logger.info("security.redaction", {
      token: SECRET_CANARY,
      nested: {
        authorization: `Bearer ${SECRET_CANARY}`,
        repositoryUrl: `https://user:${SECRET_CANARY}@example.test/repository.git?access_token=${SECRET_CANARY}`,
        message: `Authorization: Bearer ${SECRET_CANARY}`,
        path:
          "C:\\Users\\junes\\AppData\\Local\\GitNest",
        environmentValue:
          "diagnostic-environment-canary",
        env: {
          SAFE_NAME: SECRET_CANARY
        },
        body: SECRET_CANARY,
        privateKey:
          "-----BEGIN PRIVATE KEY-----\n" +
          SECRET_CANARY +
          "\n-----END PRIVATE KEY-----"
      }
    });
    await logger.flush();

    const contents = await readFile(filePath, "utf8");
    expect(contents).not.toContain(SECRET_CANARY);
    expect(contents).not.toContain("user:");
    expect(contents).not.toContain("access_token");
    expect(contents).not.toContain("BEGIN PRIVATE KEY");
    expect(contents).not.toContain("C:\\\\Users\\\\junes");
    expect(contents).not.toContain(
      "diagnostic-environment-canary"
    );
    expect(contents).toContain("[REDACTED");
    expect(contents).toContain("REDACTED_USER_CONTENT");
    expect(contents).toContain("REDACTED_USER_PATH");
    expect(contents).toContain("REDACTED_ENVIRONMENT");
  });

  it("rotates within a fixed file count and byte budget", async () => {
    temporary =
      await createTemporaryDirectoryFixture(
        "diagnostic-rotation"
      );
    const directory = join(temporary.path, "logs");
    const filePath = join(directory, "gitnest.log");
    let sequence = 0;
    const logger = new RotatingDiagnosticLogger(filePath, {
      maxBytes: 320,
      maxFiles: 3,
      clock: () =>
        `2026-09-04T12:00:${String(
          sequence++
        ).padStart(2, "0")}.000Z`
    });

    for (let index = 0; index < 20; index += 1) {
      await logger.info("operation.transition", {
        operationId: `operation-${index}`,
        state: "succeeded",
        detail: "x".repeat(80)
      });
    }
    await logger.flush();

    const files = (await readdir(directory))
      .filter((name) => name.startsWith("gitnest.log"))
      .sort();
    expect(files).toEqual([
      "gitnest.log",
      "gitnest.log.1",
      "gitnest.log.2"
    ]);
    for (const file of files) {
      expect((await stat(join(directory, file))).size).toBeLessThanOrEqual(
        320
      );
    }
  });

  it("bounds recursive and circular diagnostic values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(
      sanitizeDiagnosticValue({
        circular,
        buffer: Buffer.from(SECRET_CANARY)
      })
    ).toEqual({
      circular: {
        self: "[CIRCULAR]"
      },
      buffer: `[BUFFER_${Buffer.byteLength(
        SECRET_CANARY
      )}_BYTES]`
    });
  });

  it("rejects unbounded or malformed event names", async () => {
    temporary =
      await createTemporaryDirectoryFixture(
        "diagnostic-events"
      );
    const logger = new RotatingDiagnosticLogger(
      join(temporary.path, "gitnest.log")
    );

    expect(() =>
      logger.info("event with spaces")
    ).toThrowError(
      "Diagnostic event names contain invalid characters."
    );
  });
});
