import { describe, expect, it, vi } from "vitest";

import {
  createDefaultAppSettings,
  LANGUAGE_SERVER_LANGUAGES,
  MAX_CODE_ANALYSIS_DIAGNOSTICS,
  MAX_CODE_ANALYSIS_GRAPH_EDGES,
  MAX_CODE_ANALYSIS_GRAPH_NODES,
  MAX_CODE_ANALYSIS_REQUEST_CHAINS,
  MAX_CODE_ANALYSIS_TOTAL_SOURCE_MB,
  MAX_LSP_DOCUMENTS,
  MAX_LSP_REFERENCES_PER_SYMBOL,
  MAX_LSP_REQUESTS,
  MAX_LSP_SYMBOLS_PER_DOCUMENT,
  MAX_DIFF_COMMIT_PANEL_HEIGHT,
  MIN_CODE_ANALYSIS_DIAGNOSTICS,
  MIN_CODE_ANALYSIS_GRAPH_EDGES,
  MIN_CODE_ANALYSIS_GRAPH_NODES,
  MIN_CODE_ANALYSIS_REQUEST_CHAINS,
  MIN_CODE_ANALYSIS_TOTAL_SOURCE_MB,
  MIN_LSP_DOCUMENTS,
  MIN_LSP_REFERENCES_PER_SYMBOL,
  MIN_LSP_REQUESTS,
  MIN_LSP_SYMBOLS_PER_DOCUMENT,
  MIN_DIFF_COMMIT_PANEL_HEIGHT,
  type AppSettingsDto
} from "@gitnest/contracts";

import {
  broadcastAppSettingsChanged,
  captureAppSettingsMutation,
  formatLanguageServerLaunchApprovalDetail,
  isTrustedSenderUrl,
  validateAcknowledgeApplicationUpdatePromptRequest,
  validateAccountRemovalImpactRequest,
  validateBindAccountRequest,
  validateCancelRepositoryOperationRequest,
  validateClearAiApiKeyRequest,
  validateAddWorkspaceDirectoryRequest,
  validateCreateWorkspaceRequest,
  validateGenerateAiCommitMessageRequest,
  validateInstallLanguageServerRequest,
  validateOpenDirectoryRequest,
  validateOpenDiffViewerRequest,
  validateOpenExternalApplicationRequest,
  validateOpenExternalTerminalRequest,
  validateOpenFileLocationRequest,
  validateReadCodeAnalysisFileRequest,
  validateRemoveWorkspaceRepositoryRequest,
  validateRestoreCodeAnalysisSnapshotRequest,
  validateRemoveAccountRequest,
  validateRepositoryCommandExecuteRequest,
  validateRepositoryCommandPreflightRequest,
  validateRepositoryCommitDiffRequest,
  validateRepositoryDiffRequest,
  validateRepositoryHistoryRequest,
  validateRepositoryStashDiffRequest,
  validateRepositoryStashMutationRequest,
  validateRepositoryStashRequest,
  validateRepositoryStashesRequest,
  validateSaveAccountRequest,
  validateSetGroupCollapsedRequest,
  validateTestAiConnectionRequest,
  validateTestAccountRequest,
  validateUnbindAccountRequest,
  validateUpdateAppSettingsRequest,
  validateWorktreeCommandExecuteRequest,
  validateWorktreeCommandPreflightRequest
} from "./register-ipc";
import { McpRegistrationService } from "../code-analysis/mcp-registration";

describe("MCP registration availability", () => {
  it("does not register a development build without a bundled entry", async () => {
    const registration = new McpRegistrationService({
      executablePath: "C:\\GitNest\\electron.exe",
      entryScriptPath: "C:\\GitNest\\resources\\mcp\\gitnest-mcp.mjs",
      dataDirectory: "C:\\GitNest\\user-data",
      packaged: false,
      codexCommand: "missing-codex.exe"
    });
    const status = await registration.setRegistered(true);

    expect(status.serverAvailable).toBe(false);
    expect(status.registered).toBe(false);
    expect(status.message).toContain("开发版");
    expect(status.message).not.toContain("注册失败");
  });
});

describe("Workspace IPC validation", () => {
  it("validates an absolute directory added to the current Workspace", () => {
    expect(
      validateAddWorkspaceDirectoryRequest({
        path: "D:\\shared\\tools"
      })
    ).toEqual({
      path: "D:\\shared\\tools"
    });

    expect(() =>
      validateAddWorkspaceDirectoryRequest({
        path: "relative\\tools"
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });

  it("validates Workspace creation without Entry request reuse", () => {
    expect(
      validateCreateWorkspaceRequest({
        name: "  GitNest  ",
        path: "C:\\workspace"
      })
    ).toEqual({
      name: "GitNest",
      path: "C:\\workspace"
    });

    expect(() =>
      validateCreateWorkspaceRequest({
        name: "GitNest",
        path: "relative\\workspace"
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });

  it("validates repository removal by target only", () => {
    expect(
      validateRemoveWorkspaceRepositoryRequest({
        target: {
          repositoryId: "repository",
          worktreeId: "worktree"
        }
      })
    ).toEqual({
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      }
    });

    expect(() =>
      validateRemoveWorkspaceRepositoryRequest({})
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });

  it("updates group collapse state without an Entry id", () => {
    expect(
      validateSetGroupCollapsedRequest({
        groupId: "group",
        collapsed: true
      })
    ).toEqual({
      groupId: "group",
      collapsed: true
    });

    expect(() =>
      validateSetGroupCollapsedRequest({
        collapsed: true
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });
});

describe("application update IPC validation", () => {
  it("accepts only stable semantic versions for prompt acknowledgement", () => {
    expect(
      validateAcknowledgeApplicationUpdatePromptRequest({
        version: "1.2.3"
      })
    ).toEqual({ version: "1.2.3" });

    for (const version of [
      "v1.2.3",
      "1.2",
      "1.2.3-beta.1",
      "../1.2.3"
    ]) {
      expect(() =>
        validateAcknowledgeApplicationUpdatePromptRequest({
          version
        })
      ).toThrowError(
        expect.objectContaining({ code: "INVALID_REQUEST" })
      );
    }
  });
});

describe("application settings IPC events", () => {
  it("publishes settings only after a successful mutation", async () => {
    const settings = createDefaultAppSettings();
    const publish = vi.fn();

    await expect(
      captureAppSettingsMutation(
        async () => settings,
        publish
      )
    ).resolves.toEqual({
      ok: true,
      value: settings
    });
    expect(publish).toHaveBeenCalledWith(settings);

    publish.mockClear();
    await expect(
      captureAppSettingsMutation(
        async () => {
          throw new Error("write failed");
        },
        publish
      )
    ).resolves.toMatchObject({
      ok: false,
      error: { message: "write failed" }
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not turn a persisted mutation into a failure when publishing throws", async () => {
    const settings = createDefaultAppSettings();

    await expect(
      captureAppSettingsMutation(
        async () => settings,
        () => {
          throw new Error("window closed");
        }
      )
    ).resolves.toEqual({
      ok: true,
      value: settings
    });
  });

  it("broadcasts only to live trusted BrowserWindows", () => {
    const settings = createDefaultAppSettings();
    const trustedSend =
      vi.fn<SettingsChangedSender>();
    const untrustedSend =
      vi.fn<SettingsChangedSender>();
    const destroyedSend =
      vi.fn<SettingsChangedSender>();

    broadcastAppSettingsChanged(settings, {
      windows: [
        createSettingsWindow(
          "file:///trusted/index.html",
          trustedSend
        ),
        createSettingsWindow(
          "https://attacker.invalid/",
          untrustedSend
        ),
        createSettingsWindow(
          "file:///trusted/closed.html",
          destroyedSend,
          true
        )
      ],
      isTrustedUrl: (url) =>
        url.startsWith("file:///trusted/")
    });

    expect(trustedSend).toHaveBeenCalledWith(
      "settings:changed",
      settings
    );
    expect(untrustedSend).not.toHaveBeenCalled();
    expect(destroyedSend).not.toHaveBeenCalled();
  });
});

function createSettingsWindow(
  url: string,
  send: SettingsChangedSender,
  destroyed = false
) {
  return {
    isDestroyed: () => destroyed,
    webContents: {
      isDestroyed: () => destroyed,
      getURL: () => url,
      send
    }
  };
}

type SettingsChangedSender = (
  channel: "settings:changed",
  settings: AppSettingsDto
) => void;

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
        senderUrl:
          "file:///C:/GitNest/out/renderer/..safe/index.html",
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
          targets: [target],
          strategy: "squash"
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

  it("accepts only fixed external applications and scoped targets", () => {
    expect(
      validateOpenExternalApplicationRequest({
        context: {
          scope: "workspace"
        },
        kind: "vscode"
      })
    ).toEqual({
      context: {
        scope: "workspace"
      },
      kind: "vscode"
    });
    expect(
      validateOpenExternalApplicationRequest({
        context: {
          scope: "repository",
          target
        },
        kind: "file-explorer"
      })
    ).toEqual({
      context: {
        scope: "repository",
        target
      },
      kind: "file-explorer"
    });
    expect(
      validateOpenExternalApplicationRequest({
        context: {
          scope: "file",
          target,
          path: "src/index.ts",
          line: 42,
          column: 7
        },
        kind: "cursor"
      })
    ).toEqual({
      context: {
        scope: "file",
        target,
        path: "src/index.ts",
        line: 42,
        column: 7
      },
      kind: "cursor"
    });
    expect(() =>
      validateOpenExternalApplicationRequest({
        context: {
          scope: "file",
          target,
          path: "src/index.ts",
          column: 7
        },
        kind: "cursor"
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
    expect(() =>
      validateOpenExternalApplicationRequest({
        context: {
          scope: "repository",
          target
        },
        kind: "custom",
        executable: "powershell.exe"
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
    expect(() =>
      validateOpenExternalApplicationRequest({
        context: {
          scope: "repository"
        },
        kind: "cursor"
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

describe("Language Server installation IPC validation", () => {
  it("accepts every supported Language Server language", () => {
    for (const language of LANGUAGE_SERVER_LANGUAGES) {
      expect(
        validateInstallLanguageServerRequest({
          language
        })
      ).toEqual({ language });
    }
    expect(() =>
      validateInstallLanguageServerRequest({
        language: "ruby",
        command: "powershell.exe"
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });

  it("never approves Language Server arguments that cannot be shown in full", () => {
    expect(
      formatLanguageServerLaunchApprovalDetail([
        {
          language: "typescript",
          command: "custom-language-server",
          args: ["--stdio", "--reviewed"]
        }
      ])
    ).toContain(
      '参数：["--stdio","--reviewed"]'
    );

    expect(() =>
      formatLanguageServerLaunchApprovalDetail([
        {
          language: "typescript",
          command: "custom-language-server",
          args: ["x".repeat(8_000)]
        }
      ])
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });
});

describe("code analysis file IPC validation", () => {
  it("accepts only supported snapshot scopes", () => {
    expect(
      validateRestoreCodeAnalysisSnapshotRequest({
        scope: "changed"
      })
    ).toEqual({ scope: "changed" });
    expect(() =>
      validateRestoreCodeAnalysisSnapshotRequest({
        scope: "repository"
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });

  it("accepts only a bounded non-empty node id", () => {
    expect(
      validateReadCodeAnalysisFileRequest({
        nodeId: " function_123 "
      })
    ).toEqual({ nodeId: "function_123" });
    expect(() =>
      validateReadCodeAnalysisFileRequest({ nodeId: "" })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
    expect(() =>
      validateReadCodeAnalysisFileRequest({
        nodeId: "x".repeat(513)
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });

});

describe("repository history IPC validation", () => {
  const target = {
    repositoryId: "repository",
    worktreeId: "worktree"
  };

  it("accepts exact local and remote refs for single and comparison history", () => {
    expect(
      validateRepositoryHistoryRequest({
        queryId: "history_ref",
        target,
        scope: {
          kind: "ref",
          ref: "refs/remotes/origin/main"
        }
      })
    ).toMatchObject({
      scope: {
        kind: "ref",
        ref: "refs/remotes/origin/main"
      }
    });

    expect(
      validateRepositoryHistoryRequest({
        queryId: "history_compare",
        target,
        scope: {
          kind: "compare",
          leftRef: "refs/heads/main",
          rightRef: "refs/heads/develop"
        }
      })
    ).toMatchObject({
      scope: {
        kind: "compare",
        leftRef: "refs/heads/main",
        rightRef: "refs/heads/develop"
      }
    });
  });

  it("rejects arbitrary revisions and identical comparison refs", () => {
    expect(() =>
      validateRepositoryHistoryRequest({
        queryId: "history_bad_ref",
        target,
        scope: {
          kind: "ref",
          ref: "--all"
        }
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );

    expect(() =>
      validateRepositoryHistoryRequest({
        queryId: "history_same_ref",
        target,
        scope: {
          kind: "compare",
          leftRef: "refs/heads/main",
          rightRef: "refs/heads/main"
        }
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });
});

describe("repository diff IPC validation", () => {
  const target = {
    repositoryId: "repository",
    worktreeId: "worktree"
  };

  it("accepts non-negative context line requests", () => {
    expect(
      validateRepositoryDiffRequest({
        queryId: "diff_1",
        target,
        path: "src/App.tsx",
        mode: "unstaged",
        contextLines: 13
      })
    ).toEqual({
      queryId: "diff_1",
      target,
      path: "src/App.tsx",
      mode: "unstaged",
      contextLines: 13
    });
  });

  it("accepts a safe commit file diff request", () => {
    expect(
      validateRepositoryCommitDiffRequest({
        queryId: "commit_diff_1",
        target,
        commitHash: " ABCDEF ",
        path: "src/App.tsx",
        contextLines: 13
      })
    ).toEqual({
      queryId: "commit_diff_1",
      target,
      commitHash: "ABCDEF",
      path: "src/App.tsx",
      contextLines: 13
    });
  });

  it("rejects invalid context line requests", () => {
    expect(() =>
      validateRepositoryDiffRequest({
        queryId: "diff_1",
        target,
        path: "src/App.tsx",
        mode: "unstaged",
        contextLines: -1
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );

    for (const request of [
      {
        queryId: "commit_diff_bad_hash",
        target,
        commitHash: "HEAD~1",
        path: "src/App.tsx"
      },
      {
        queryId: "commit_diff_bad_path",
        target,
        commitHash: "abcdef",
        path: "../outside.ts"
      },
      {
        queryId: "commit_diff_bad_context",
        target,
        commitHash: "abcdef",
        path: "src/App.tsx",
        contextLines: 1.5
      }
    ]) {
      expect(() =>
        validateRepositoryCommitDiffRequest(request)
      ).toThrowError(
        expect.objectContaining({ code: "INVALID_REQUEST" })
      );
    }
  });
});

describe("repository stash IPC validation", () => {
  const target = {
    repositoryId: "repository",
    worktreeId: "worktree"
  };

  it("accepts bounded list and exact stash file requests", () => {
    expect(
      validateRepositoryStashesRequest({
        queryId: "stashes_1",
        target,
        limit: 50
      })
    ).toEqual({
      queryId: "stashes_1",
      target,
      limit: 50
    });
    expect(
      validateRepositoryStashDiffRequest({
        queryId: "stash_diff_1",
        target,
        stashRef: " stash@{2} ",
        path: "src/App.tsx",
        contextLines: 13
      })
    ).toEqual({
      queryId: "stash_diff_1",
      target,
      stashRef: "stash@{2}",
      path: "src/App.tsx",
      contextLines: 13
    });
  });

  it("rejects arbitrary revisions and invalid limits", () => {
    expect(() =>
      validateRepositoryStashRequest({
        queryId: "stash_bad_ref",
        target,
        stashRef: "--all"
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
    expect(() =>
      validateRepositoryStashRequest({
        queryId: "stash_bad_ref",
        target,
        stashRef: "stash@{0}^1"
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
    expect(() =>
      validateRepositoryStashesRequest({
        queryId: "stash_bad_limit",
        target,
        limit: 101
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });

  it("accepts exact stash mutations and normalizes full object ids", () => {
    expect(
      validateRepositoryStashMutationRequest({
        target,
        action: "pop",
        stashRef: " stash@{2} ",
        stashHash: "A".repeat(40)
      })
    ).toEqual({
      target,
      action: "pop",
      stashRef: "stash@{2}",
      stashHash: "a".repeat(40)
    });
    expect(
      validateRepositoryStashMutationRequest({
        target,
        action: "apply",
        stashRef: "stash@{0}",
        stashHash: "b".repeat(64)
      }).stashHash
    ).toBe("b".repeat(64));
  });

  it("rejects malformed stash mutation actions, refs, and abbreviated hashes", () => {
    for (const request of [
      {
        target,
        action: "clear",
        stashRef: "stash@{0}",
        stashHash: "a".repeat(40)
      },
      {
        target,
        action: "drop",
        stashRef: "stash@{0}^1",
        stashHash: "a".repeat(40)
      },
      {
        target,
        action: "drop",
        stashRef: "stash@{0}",
        stashHash: "abcdef"
      }
    ]) {
      expect(() =>
        validateRepositoryStashMutationRequest(request)
      ).toThrowError(
        expect.objectContaining({ code: "INVALID_REQUEST" })
      );
    }
  });
});

describe("directory IPC validation", () => {
  it("accepts an exact repository target", () => {
    expect(
      validateOpenDirectoryRequest({
        target: {
          repositoryId: "repository",
          worktreeId: "worktree"
        }
      })
    ).toEqual({
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      }
    });
  });

  it("rejects a missing or malformed target", () => {
    expect(() =>
      validateOpenDirectoryRequest({
        target: {
          repositoryId: "repository"
        }
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });

  it("accepts only relative file paths inside the Worktree", () => {
    const target = {
      repositoryId: "repository",
      worktreeId: "worktree"
    };

    expect(
      validateOpenFileLocationRequest({
        target,
        path: "src/components/App.tsx"
      })
    ).toEqual({
      target,
      path: "src/components/App.tsx"
    });

    for (const path of [
      "../secrets.txt",
      "src/../secrets.txt",
      "src/./App.tsx",
      "C:\\secrets.txt",
      "/tmp/secrets.txt"
    ]) {
      expect(() =>
        validateOpenFileLocationRequest({
          target,
          path
        })
      ).toThrowError(
        expect.objectContaining({ code: "INVALID_REQUEST" })
      );
    }
  });
});

describe("application settings and AI IPC validation", () => {
  const target = {
    repositoryId: "repository",
    worktreeId: "worktree"
  };

  it("normalizes supported settings without accepting an empty AI key", () => {
    expect(
      validateUpdateAppSettingsRequest({
        general: {
          restoreLastView: false,
          defaultTerminalKind: "git-bash"
        },
        appearance: { theme: "light" },
        diff: {
          fileView: "tree",
          layout: "split",
          wrap: true,
          treeDirectoriesCollapsed: true
        },
        git: {
          fetchMode: "startup",
          pushStrategy: "merge"
        },
        ai: {
          enabled: true,
          apiUrl: " https://ai.example.test/v1 ",
          model: " test-model ",
          apiKey: " test-key ",
          prompt: "Keep this prompt spacing."
        },
        navigation: {
          lastContentView: "repository",
          workspaceTab: "activity",
          repositoryTab: "changes"
        }
      })
    ).toEqual({
      general: {
        restoreLastView: false,
        defaultTerminalKind: "git-bash"
      },
      appearance: { theme: "light" },
      diff: {
        fileView: "tree",
        layout: "split",
        wrap: true,
        treeDirectoriesCollapsed: true
      },
      git: {
        fetchMode: "startup",
        pushStrategy: "merge"
      },
      ai: {
        enabled: true,
        apiUrl: "https://ai.example.test/v1",
        model: "test-model",
        apiKey: "test-key",
        prompt: "Keep this prompt spacing."
      },
      navigation: {
        lastContentView: "repository",
        workspaceTab: "activity",
        repositoryTab: "changes"
      }
    });

    expect(() =>
      validateUpdateAppSettingsRequest({
        ai: { apiKey: " " }
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });

  it("validates explicit key clearing, connection tests, and exact generation targets", () => {
    expect(
      validateClearAiApiKeyRequest({ confirmed: false })
    ).toEqual({ confirmed: false });
    expect(
      validateTestAiConnectionRequest({
        apiUrl: "https://ai.example.test/v1",
        model: "test-model",
        apiKey: "temporary-key"
      })
    ).toEqual({
      apiUrl: "https://ai.example.test/v1",
      model: "test-model",
      apiKey: "temporary-key"
    });
    expect(
      validateGenerateAiCommitMessageRequest({ target })
    ).toEqual({ target });

    expect(() =>
      validateClearAiApiKeyRequest({ confirmed: "yes" })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
    expect(() =>
      validateTestAiConnectionRequest({
        apiUrl: "file:///model",
        model: "test-model"
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
    expect(() =>
      validateGenerateAiCommitMessageRequest({
        target: { repositoryId: "repository" }
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });

  it("validates the persisted commit panel height range", () => {
    expect(
      validateUpdateAppSettingsRequest({
        diff: {
          commitPanelHeight: MIN_DIFF_COMMIT_PANEL_HEIGHT
        }
      })
    ).toEqual({
      diff: {
        commitPanelHeight: MIN_DIFF_COMMIT_PANEL_HEIGHT
      }
    });
    expect(
      validateUpdateAppSettingsRequest({
        diff: {
          commitPanelHeight: MAX_DIFF_COMMIT_PANEL_HEIGHT
        }
      })
    ).toEqual({
      diff: {
        commitPanelHeight: MAX_DIFF_COMMIT_PANEL_HEIGHT
      }
    });

    for (const commitPanelHeight of [
      MIN_DIFF_COMMIT_PANEL_HEIGHT - 1,
      MAX_DIFF_COMMIT_PANEL_HEIGHT + 1,
      180.5,
      Number.NaN,
      Number.POSITIVE_INFINITY
    ]) {
      expect(() =>
        validateUpdateAppSettingsRequest({
          diff: { commitPanelHeight }
        })
      ).toThrowError(
        expect.objectContaining({ code: "INVALID_REQUEST" })
      );
    }
  });

  it("validates the configurable relationship graph node limit", () => {
    for (const maxGraphNodes of [
      MIN_CODE_ANALYSIS_GRAPH_NODES,
      MAX_CODE_ANALYSIS_GRAPH_NODES
    ]) {
      expect(
        validateUpdateAppSettingsRequest({
          codeAnalysis: { maxGraphNodes }
        })
      ).toEqual({
        codeAnalysis: { maxGraphNodes }
      });
    }

    for (const maxGraphNodes of [
      MIN_CODE_ANALYSIS_GRAPH_NODES - 1,
      MAX_CODE_ANALYSIS_GRAPH_NODES + 1,
      30_000.5,
      Number.NaN,
      Number.POSITIVE_INFINITY
    ]) {
      expect(() =>
        validateUpdateAppSettingsRequest({
          codeAnalysis: { maxGraphNodes }
        })
      ).toThrowError(
        expect.objectContaining({ code: "INVALID_REQUEST" })
      );
    }
  });

  it("validates configurable analysis and language-server budgets", () => {
    const codeAnalysis = {
      maxTotalSourceMb: MIN_CODE_ANALYSIS_TOTAL_SOURCE_MB,
      maxGraphEdges: MAX_CODE_ANALYSIS_GRAPH_EDGES,
      maxRequestChains: MIN_CODE_ANALYSIS_REQUEST_CHAINS,
      maxDiagnostics: MAX_CODE_ANALYSIS_DIAGNOSTICS,
      java: {
        maxDocuments: MAX_LSP_DOCUMENTS,
        maxSymbolsPerDocument:
          MIN_LSP_SYMBOLS_PER_DOCUMENT,
        maxCallHierarchyRequests: MIN_LSP_REQUESTS,
        maxTypeHierarchyRequests: MAX_LSP_REQUESTS,
        maxReferenceRequests: MAX_LSP_REQUESTS,
        maxDocumentationRequests: MIN_LSP_REQUESTS,
        maxReferencesPerSymbol:
          MIN_LSP_REFERENCES_PER_SYMBOL
      }
    };

    expect(
      validateUpdateAppSettingsRequest({ codeAnalysis })
    ).toEqual({ codeAnalysis });

    const invalidPatches = [
      {
        maxTotalSourceMb:
          MAX_CODE_ANALYSIS_TOTAL_SOURCE_MB + 1
      },
      { maxGraphEdges: MIN_CODE_ANALYSIS_GRAPH_EDGES - 1 },
      {
        maxRequestChains:
          MAX_CODE_ANALYSIS_REQUEST_CHAINS + 1
      },
      { maxDiagnostics: MIN_CODE_ANALYSIS_DIAGNOSTICS - 1 },
      { java: { maxDocuments: MIN_LSP_DOCUMENTS - 1 } },
      {
        java: {
          maxSymbolsPerDocument:
            MAX_LSP_SYMBOLS_PER_DOCUMENT + 1
        }
      },
      {
        java: {
          maxTypeHierarchyRequests: MAX_LSP_REQUESTS + 1
        }
      },
      {
        java: {
          maxReferenceRequests: MAX_LSP_REQUESTS + 1
        }
      },
      {
        java: {
          maxReferencesPerSymbol:
            MAX_LSP_REFERENCES_PER_SYMBOL + 1
        }
      }
    ];

    for (const patch of invalidPatches) {
      expect(() =>
        validateUpdateAppSettingsRequest({
          codeAnalysis: patch
        })
      ).toThrowError(
        expect.objectContaining({ code: "INVALID_REQUEST" })
      );
    }
  });
});

describe("Diff viewer IPC validation", () => {
  const target = {
    repositoryId: "repository",
    worktreeId: "worktree"
  };

  it("accepts a supported mode and exact relative path", () => {
    expect(
      validateOpenDiffViewerRequest({
        target,
        path: "src/components/App.tsx",
        mode: "staged"
      })
    ).toEqual({
      target,
      path: "src/components/App.tsx",
      mode: "staged"
    });
  });

  it("rejects paths outside the Worktree and unknown modes", () => {
    expect(() =>
      validateOpenDiffViewerRequest({
        target,
        path: "../outside.ts",
        mode: "unstaged"
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
    expect(() =>
      validateOpenDiffViewerRequest({
        target,
        path: "src/App.tsx",
        mode: "working-copy"
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
