import { describe, expect, it } from "vitest";

import {
  MAX_DIFF_COMMIT_PANEL_HEIGHT,
  MIN_DIFF_COMMIT_PANEL_HEIGHT
} from "@gitnest/contracts";

import {
  isTrustedSenderUrl,
  validateAccountRemovalImpactRequest,
  validateBindAccountRequest,
  validateCancelRepositoryOperationRequest,
  validateClearAiApiKeyRequest,
  validateGenerateAiCommitMessageRequest,
  validateOpenDirectoryRequest,
  validateOpenDiffViewerRequest,
  validateOpenExternalApplicationRequest,
  validateOpenExternalTerminalRequest,
  validateOpenFileLocationRequest,
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
  validateTestAiConnectionRequest,
  validateTestAccountRequest,
  validateUnbindAccountRequest,
  validateUpdateAppSettingsRequest,
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
