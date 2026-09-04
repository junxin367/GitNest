import { describe, expect, it } from "vitest";

import {
  isTrustedSenderUrl,
  validateAccountRemovalImpactRequest,
  validateBindAccountRequest,
  validateCancelRepositoryOperationRequest,
  validateOpenExternalTerminalRequest,
  validateRemoveAccountRequest,
  validateRepositoryCommandExecuteRequest,
  validateRepositoryCommandPreflightRequest,
  validateSaveAccountRequest,
  validateTestAccountRequest,
  validateUnbindAccountRequest,
  validateWorktreeCommandExecuteRequest,
  validateWorktreeCommandPreflightRequest
} from "./register-ipc";

describe("isTrustedSenderUrl", () => {
  it("accepts the configured development origin", () => {
    expect(
      isTrustedSenderUrl({
        senderUrl: "http://localhost:5173/workspace",
        rendererUrl: "http://localhost:5173",
        rendererDirectory: "C:\\GitNest\\out\\renderer",
        packaged: false
      })
    ).toBe(true);
  });

  it("rejects a different development origin", () => {
    expect(
      isTrustedSenderUrl({
        senderUrl: "https://attacker.invalid/",
        rendererUrl: "http://localhost:5173",
        rendererDirectory: "C:\\GitNest\\out\\renderer",
        packaged: false
      })
    ).toBe(false);
  });

  it("accepts packaged files only from the renderer directory", () => {
    expect(
      isTrustedSenderUrl({
        senderUrl: "file:///C:/GitNest/out/renderer/index.html",
        rendererDirectory: "C:\\GitNest\\out\\renderer",
        packaged: true
      })
    ).toBe(true);

    expect(
      isTrustedSenderUrl({
        senderUrl: "file:///C:/GitNest/secrets.txt",
        rendererDirectory: "C:\\GitNest\\out\\renderer",
        packaged: true
      })
    ).toBe(false);
  });
});

describe("repository command IPC validation", () => {
  const target = {
    repositoryId: "repository",
    worktreeId: "worktree"
  };

  it("normalizes a supported command without widening its capabilities", () => {
    expect(
      validateRepositoryCommandPreflightRequest({
        command: {
          type: "fetch",
          targets: [target],
          remote: " origin ",
          prune: true
        }
      })
    ).toEqual({
      command: {
        type: "fetch",
        targets: [target],
        remote: "origin",
        prune: true
      }
    });
  });

  it("rejects unsafe or ambiguous command shapes", () => {
    expect(() =>
      validateRepositoryCommandPreflightRequest({
        command: {
          type: "pull",
          targets: [target],
          strategy: "rebase"
        }
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
    expect(() =>
      validateRepositoryCommandPreflightRequest({
        command: {
          type: "push",
          targets: [target, target],
          forceWithLease: true
        }
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
    expect(() =>
      validateRepositoryCommandPreflightRequest({
        command: {
          type: "rename-branch",
          target,
          branch: "main",
          newName: "bad\nname"
        }
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });

  it("requires bounded opaque ids and an explicit confirmation boolean", () => {
    expect(() =>
      validateRepositoryCommandExecuteRequest({
        command: {
          type: "fetch",
          targets: [target]
        },
        preflightId: "../../preflight",
        confirmed: false
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
    expect(() =>
      validateRepositoryCommandExecuteRequest({
        command: {
          type: "fetch",
          targets: [target]
        },
        preflightId: "preflight_1",
        confirmed: "yes"
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
    expect(() =>
      validateCancelRepositoryOperationRequest({
        operationId: "operation 1"
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );

    expect(
      validateCancelRepositoryOperationRequest({
        operationId: "operation_1"
      })
    ).toEqual({ operationId: "operation_1" });
  });

  it("accepts only fixed external terminal kinds and exact targets", () => {
    expect(
      validateOpenExternalTerminalRequest({
        target,
        kind: "git-bash"
      })
    ).toEqual({
      target,
      kind: "git-bash"
    });
    expect(() =>
      validateOpenExternalTerminalRequest({
        target,
        kind: "custom",
        executable: "powershell.exe",
        args: ["-EncodedCommand", "payload"]
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });

  it("validates account requests without widening secret-bearing IPC", () => {
    expect(
      validateSaveAccountRequest({
        provider: "github",
        host: " github.example.test ",
        username: " user ",
        authType: "https-token",
        token: " redacted-test-value ",
        makeHostDefault: true
      })
    ).toEqual({
      provider: "github",
      host: "github.example.test",
      username: "user",
      authType: "https-token",
      token: "redacted-test-value",
      makeHostDefault: true
    });
    expect(
      validateBindAccountRequest({
        accountId: "account_1",
        repositoryId: "repository_1"
      })
    ).toEqual({
      accountId: "account_1",
      repositoryId: "repository_1"
    });
    expect(
      validateUnbindAccountRequest({
        host: "git.example.test",
        repositoryId: "repository_1"
      })
    ).toEqual({
      host: "git.example.test",
      repositoryId: "repository_1"
    });
    expect(
      validateAccountRemovalImpactRequest({
        accountId: "account_1"
      })
    ).toEqual({ accountId: "account_1" });
    expect(
      validateRemoveAccountRequest({
        accountId: "account_1",
        confirmed: true
      })
    ).toEqual({
      accountId: "account_1",
      confirmed: true
    });
    expect(
      validateTestAccountRequest({
        accountId: "account_1",
        repositoryUrl:
          "https://git.example.test/team/repository.git"
      })
    ).toEqual({
      accountId: "account_1",
      repositoryUrl:
        "https://git.example.test/team/repository.git"
    });
  });

  it("rejects tokens on system SSH and malformed account ids without echoing values", () => {
    expect(() =>
      validateSaveAccountRequest({
        provider: "custom",
        host: "git.example.test",
        authType: "system-ssh",
        token: "must-not-be-accepted"
      })
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: expect.not.stringContaining(
          "must-not-be-accepted"
        )
      })
    );
    expect(() =>
      validateBindAccountRequest({
        accountId: "../account"
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
    expect(() =>
      validateTestAccountRequest({
        accountId: "account_1",
        repositoryUrl: "https://git.example.test/repo\nnext"
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });
});

describe("worktree command IPC validation", () => {
  it("normalizes only supported Worktree command fields", () => {
    expect(
      validateWorktreeCommandPreflightRequest({
        command: {
          type: "create",
          repositoryId: " repository ",
          path: "C:\\workspace\\new-worktree",
          branch: " feature/new ",
          startPoint: " main ",
          force: true,
          args: ["--force"]
        }
      })
    ).toEqual({
      command: {
        type: "create",
        repositoryId: "repository",
        path: "C:\\workspace\\new-worktree",
        branch: "feature/new",
        startPoint: "main"
      }
    });

    expect(
      validateWorktreeCommandPreflightRequest({
        command: {
          type: "lock",
          worktreeId: " worktree ",
          reason: " release validation "
        }
      })
    ).toEqual({
      command: {
        type: "lock",
        worktreeId: "worktree",
        reason: "release validation"
      }
    });
  });

  it("rejects relative paths, unsupported commands, and malformed execution envelopes", () => {
    expect(() =>
      validateWorktreeCommandPreflightRequest({
        command: {
          type: "move",
          worktreeId: "worktree",
          destination: "..\\outside"
        }
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
    expect(() =>
      validateWorktreeCommandPreflightRequest({
        command: {
          type: "remove-force",
          worktreeId: "worktree"
        }
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
    expect(() =>
      validateWorktreeCommandExecuteRequest({
        command: {
          type: "prune",
          repositoryId: "repository"
        },
        preflightId: "../../preflight",
        confirmed: true
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
    expect(() =>
      validateWorktreeCommandExecuteRequest({
        command: {
          type: "prune",
          repositoryId: "repository"
        },
        preflightId: "preflight_1",
        confirmed: "yes"
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });
});
