import type { RepositoryTargetDto } from "@gitnest/contracts";
import type {
  GitClient,
  RepositorySnapshot
} from "@gitnest/git-core";
import type { Workspace } from "@gitnest/workspace-core";
import { describe, expect, it, vi } from "vitest";

import type { InternalAiSettings } from "../settings/app-settings";
import {
  AiCommitMessageService,
  normalizeAiEndpoint
} from "./ai-commit-message-service";

const target: RepositoryTargetDto = {
  repositoryId: "repository-1",
  worktreeId: "worktree-1"
};

describe("normalizeAiEndpoint", () => {
  it("accepts a base URL or a full chat-completions URL", () => {
    expect(
      normalizeAiEndpoint("https://ai.example.test/v1")
    ).toBe(
      "https://ai.example.test/v1/chat/completions"
    );
    expect(
      normalizeAiEndpoint(
        "https://ai.example.test/v1/chat/completions"
      )
    ).toBe(
      "https://ai.example.test/v1/chat/completions"
    );
  });

  it("rejects non-HTTP URLs and embedded credentials", () => {
    expect(() =>
      normalizeAiEndpoint("file:///tmp/model")
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
    expect(() =>
      normalizeAiEndpoint(
        "https://user:secret@ai.example.test/v1"
      )
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });
});

describe("AiCommitMessageService", () => {
  it("reads only staged diffs when the commit scope has staged changes", async () => {
    const readRepositoryDiff = vi.fn(
      async (
        _path: string,
        options: { path: string; mode: string }
      ) => ({
        path: options.path,
        mode: "staged" as const,
        content: `diff --git a/${options.path} b/${options.path}`,
        binary: false,
        truncated: false,
        additions: 1,
        deletions: 0
      })
    );
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        expect(body.messages[1]?.content).toContain(
          "--- STAGED FILE: src/staged.ts ---"
        );
        expect(body.messages[1]?.content).not.toContain(
          "src/unstaged.ts"
        );
        return completionResponse(
          "```text\nfeat: update staged behavior\n```"
        );
      }
    );
    const service = createService({
      fetchImpl,
      snapshot: {
        ...baseSnapshot(),
        staged: 1,
        unstaged: 1,
        changes: [
          {
            path: "src/staged.ts",
            indexStatus: "M",
            worktreeStatus: ".",
            kind: "ordinary"
          },
          {
            path: "src/unstaged.ts",
            indexStatus: ".",
            worktreeStatus: "M",
            kind: "ordinary"
          }
        ]
      },
      readRepositoryDiff
    });

    await expect(
      service.generateCommitMessage(target)
    ).resolves.toEqual({
      message: "feat: update staged behavior",
      stagedFiles: 1,
      truncated: false
    });
    expect(readRepositoryDiff).toHaveBeenCalledTimes(1);
    expect(readRepositoryDiff).toHaveBeenCalledWith(
      "C:\\workspace\\repository-1",
      {
        path: "src/staged.ts",
        mode: "staged"
      }
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reads unstaged and untracked diffs when the staged index is empty", async () => {
    const readRepositoryDiff = vi.fn(
      async (
        _path: string,
        options: { path: string; mode: string }
      ) => ({
        path: options.path,
        mode: options.mode as "unstaged" | "untracked",
        content: `diff --git a/${options.path} b/${options.path}`,
        binary: false,
        truncated: false,
        additions: 1,
        deletions: 0
      })
    );
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        expect(body.messages[1]?.content).toContain(
          "--- UNSTAGED FILE: src/unstaged.ts ---"
        );
        expect(body.messages[1]?.content).toContain(
          "--- UNTRACKED FILE: docs/new.md ---"
        );
        return completionResponse(
          "feat: update working tree behavior"
        );
      }
    );
    const service = createService({
      fetchImpl,
      snapshot: {
        ...baseSnapshot(),
        unstaged: 1,
        untracked: 1,
        changes: [
          {
            path: "src/unstaged.ts",
            indexStatus: ".",
            worktreeStatus: "M",
            kind: "ordinary"
          },
          {
            path: "docs/new.md",
            indexStatus: "?",
            worktreeStatus: "?",
            kind: "untracked"
          }
        ]
      },
      readRepositoryDiff
    });

    await expect(
      service.generateCommitMessage(target)
    ).resolves.toEqual({
      message: "feat: update working tree behavior",
      stagedFiles: 2,
      truncated: false
    });
    expect(readRepositoryDiff).toHaveBeenCalledTimes(2);
    expect(readRepositoryDiff).toHaveBeenNthCalledWith(
      1,
      "C:\\workspace\\repository-1",
      {
        path: "src/unstaged.ts",
        mode: "unstaged"
      }
    );
    expect(readRepositoryDiff).toHaveBeenNthCalledWith(
      2,
      "C:\\workspace\\repository-1",
      {
        path: "docs/new.md",
        mode: "untracked"
      }
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses a temporary key for connection tests without requiring AI generation to be enabled", async () => {
    const getInternalAiSettings = vi.fn(
      async () => ({
        ...baseSettings(),
        enabled: false,
        apiKey: ""
      })
    );
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        expect(
          new Headers(init?.headers).get("Authorization")
        ).toBe("Bearer temporary-key");
        expect(init?.redirect).toBe("error");
        return completionResponse("OK");
      }
    );
    const service = createService({
      fetchImpl,
      getInternalAiSettings
    });

    await expect(
      service.testConnection({
        apiUrl: "https://ai.example.test/v1",
        model: "connection-model",
        apiKey: "temporary-key"
      })
    ).resolves.toEqual({
      endpoint:
        "https://ai.example.test/v1/chat/completions",
      model: "connection-model"
    });
    expect(getInternalAiSettings).toHaveBeenCalledWith({
      includeApiKey: false
    });
  });

  it("does not reuse a saved key for a different connection-test endpoint", async () => {
    const fetchImpl = vi.fn(async () => completionResponse("OK"));
    const getInternalAiSettings = vi.fn(
      async (options?: { includeApiKey?: boolean }) => ({
        ...baseSettings(),
        apiUrl: "https://saved.example.test/v1",
        apiKey:
          options?.includeApiKey === false ? "" : "saved-key"
      })
    );
    const service = createService({
      fetchImpl,
      getInternalAiSettings
    });

    await expect(
      service.testConnection({
        apiUrl: "https://attacker.example.test/v1",
        model: "connection-model"
      })
    ).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILED"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(getInternalAiSettings).toHaveBeenCalledTimes(1);
    expect(getInternalAiSettings).toHaveBeenCalledWith({
      includeApiKey: false
    });
  });

  it("reuses the saved key for an equivalent normalized endpoint", async () => {
    const getInternalAiSettings = vi.fn(
      async (options?: { includeApiKey?: boolean }) => ({
        ...baseSettings(),
        apiUrl: "https://ai.example.test/v1/",
        apiKey:
          options?.includeApiKey === false ? "" : "saved-key"
      })
    );
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        expect(
          new Headers(init?.headers).get("Authorization")
        ).toBe("Bearer saved-key");
        return completionResponse("OK");
      }
    );
    const service = createService({
      fetchImpl,
      getInternalAiSettings
    });

    await expect(
      service.testConnection({
        apiUrl:
          "https://ai.example.test/v1/chat/completions/",
        model: "connection-model"
      })
    ).resolves.toMatchObject({
      endpoint:
        "https://ai.example.test/v1/chat/completions"
    });
    expect(getInternalAiSettings).toHaveBeenNthCalledWith(1, {
      includeApiKey: false
    });
    expect(getInternalAiSettings).toHaveBeenNthCalledWith(2, {
      includeApiKey: true
    });
  });
});

function createService(options: {
  settings?: InternalAiSettings;
  getInternalAiSettings?: (
    options?: { includeApiKey?: boolean }
  ) => Promise<InternalAiSettings>;
  snapshot?: RepositorySnapshot;
  readRepositoryDiff?: GitClient["readRepositoryDiff"];
  fetchImpl?: typeof fetch;
} = {}): AiCommitMessageService {
  const settings = options.settings ?? baseSettings();
  const snapshot = options.snapshot ?? {
    ...baseSnapshot(),
    staged: 1,
    changes: [
      {
        path: "src/staged.ts",
        indexStatus: "M",
        worktreeStatus: ".",
        kind: "ordinary"
      }
    ]
  };
  return new AiCommitMessageService(
    {
      getInternalAiSettings:
        options.getInternalAiSettings ??
        (async () => ({ ...settings }))
    },
    {
      getCurrent: async () => createWorkspace()
    },
    {
      readRepositorySnapshot: async () =>
        structuredClone(snapshot),
      readRepositoryDiff:
        options.readRepositoryDiff ??
        (async (_path, diffOptions) => ({
          path: diffOptions.path,
          mode: diffOptions.mode,
          content: "diff",
          binary: false,
          truncated: false,
          additions: 1,
          deletions: 0
        }))
    },
    options.fetchImpl ??
      (async () =>
        completionResponse(
          "feat: generated message"
        ))
  );
}

function baseSettings(): InternalAiSettings {
  return {
    enabled: true,
    apiUrl: "https://ai.example.test/v1",
    model: "test-model",
    apiKey: "test-key",
    prompt: "Generate a concise commit message."
  };
}

function baseSnapshot(): RepositorySnapshot {
  return {
    branch: "main",
    head: "1234567890abcdef",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    changes: [],
    refreshedAt: "2026-09-10T12:00:00.000Z"
  };
}

function createWorkspace(): Workspace {
  return {
    schemaVersion: 2,
    id: "workspace",
    name: "Workspace",
    path: "C:\\workspace",
    canonicalPath: "c:\\workspace",
    excludes: [],
    groups: [
      {
        id: "group",
        name: "Repositories",
        targets: [target],
        collapsed: false
      }
    ],
    scanIssues: [],
    lastScannedAt: "2026-09-10T12:00:00.000Z",
    repositories: [
      {
        id: target.repositoryId,
        name: "repository-1",
        commonDir: "C:\\workspace\\repository-1\\.git",
        canonicalCommonDir:
          "c:\\workspace\\repository-1\\.git",
        primaryWorktreeId: target.worktreeId,
        worktreeIds: [target.worktreeId]
      }
    ],
    worktrees: [
      {
        id: target.worktreeId,
        repositoryId: target.repositoryId,
        name: "repository-1",
        path: "C:\\workspace\\repository-1",
        canonicalPath: "c:\\workspace\\repository-1",
        gitDir: "C:\\workspace\\repository-1\\.git",
        head: "1234567890abcdef",
        branch: "main",
        isPrimary: true,
        isBare: false,
        isDetached: false,
        isLocked: false,
        isPrunable: false
      }
    ],
    selectedTarget: target,
    updatedAt: "2026-09-10T12:00:00.000Z"
  };
}

function completionResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }]
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}
