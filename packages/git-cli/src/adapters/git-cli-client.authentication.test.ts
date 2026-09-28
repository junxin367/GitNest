import { describe, expect, it } from "vitest";

import {
  GitCliClient,
  classifyRemoteConnectionFailure
} from "./git-cli-client";

describe("Git remote authentication classification", () => {
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
