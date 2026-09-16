import { describe, expect, it } from "vitest";

import {
  IPC_CHANNELS,
  type IpcInvoke,
  type WorkspaceRuntimeStateDto
} from "@gitnest/contracts";

import { createGitNestBridge } from "./bridge";

describe("createGitNestBridge", () => {
  it("exposes only the typed system and window capabilities", async () => {
    const calls: Array<{
      channel: string;
      args: unknown[];
    }> = [];
    const invoke = (async (
      channel: string,
      ...args: unknown[]
    ) => {
      calls.push({ channel, args });

      if (channel === IPC_CHANNELS.windowToggleMaximize) {
        return true;
      }

      if (channel === IPC_CHANNELS.gitGetEnvironment) {
        return {
          ok: true,
          value: {
            executablePath: "C:\\Program Files\\Git\\cmd\\git.exe",
            version: "2.53.0.windows.3",
            lfs: { available: false },
            credentialHelpers: [],
            ssh: {
              command: "ssh",
              authSockConfigured: false,
              configExists: false
            },
            detectedAt: "2026-09-04T00:00:00.000Z"
          }
        };
      }

      if (channel === IPC_CHANNELS.gitInspectRepository) {
        return {
          ok: false,
          error: {
            code: "NOT_A_REPOSITORY",
            message: "Not a repository.",
            details: {}
          }
        };
      }

      return undefined;
    }) as IpcInvoke;
    let stateListener:
      | ((state: WorkspaceRuntimeStateDto) => void)
      | undefined;
    const bridge = createGitNestBridge(
      invoke,
      () => "C:\\workspace",
      (listener) => {
        stateListener = listener;
        return () => {
          stateListener = undefined;
        };
      }
    );

    await bridge.settings.get();
    await bridge.settings.update({
      general: {
        restoreLastView: true,
        defaultTerminalKind: "powershell"
      },
      git: {
        fetchMode: "startup"
      }
    });
    await bridge.settings.clearAiApiKey({
      confirmed: true
    });
    await bridge.ai.testConnection({
      apiUrl: "https://api.example.test/v1",
      model: "test-model",
      apiKey: "secret"
    });
    await bridge.ai.generateCommitMessage({
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      }
    });
    await bridge.account.list();
    await bridge.account.save({
      provider: "custom",
      host: "git.example.test",
      username: "git",
      authType: "system-ssh",
      makeHostDefault: true
    });
    await bridge.account.bind({
      accountId: "account_1",
      repositoryId: "repository"
    });
    await bridge.account.unbind({
      host: "git.example.test",
      repositoryId: "repository"
    });
    await bridge.account.getRemovalImpact({
      accountId: "account_1"
    });
    await bridge.account.remove({
      accountId: "account_1",
      confirmed: true
    });
    await bridge.account.test({
      accountId: "account_1",
      repositoryUrl:
        "ssh://git@git.example.test/team/repository.git"
    });
    await bridge.system.getRuntimeInfo();
    await bridge.system.listExternalApplications();
    await bridge.system.openExternalApplication({
      context: {
        scope: "repository",
        target: {
          repositoryId: "repository",
          worktreeId: "worktree"
        }
      },
      kind: "vscode"
    });
    await bridge.system.listExternalTerminals();
    await bridge.system.openDirectory({
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      }
    });
    await bridge.system.openFileLocation({
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      },
      path: "src/index.ts"
    });
    await bridge.system.openExternalTerminal({
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      },
      kind: "powershell"
    });
    await bridge.git.getEnvironment();
    await bridge.git.inspectRepository({
      path: "C:\\repo"
    });
    await bridge.repository.getChanges({
      queryId: "changes",
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      }
    });
    await bridge.repository.getDiff({
      queryId: "diff",
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      },
      path: "README.md",
      mode: "unstaged"
    });
    await bridge.repository.getHistory({
      queryId: "history",
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      },
      limit: 50
    });
    await bridge.repository.getCommit({
      queryId: "commit",
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      },
      commitHash: "abcdef"
    });
    await bridge.repository.getCommitDiff({
      queryId: "commit-diff",
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      },
      commitHash: "abcdef",
      path: "README.md",
      contextLines: 13
    });
    await bridge.repository.getStashes({
      queryId: "stashes",
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      },
      limit: 50
    });
    await bridge.repository.getStashFiles({
      queryId: "stash-files",
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      },
      stashRef: "stash@{0}"
    });
    await bridge.repository.getStashDiff({
      queryId: "stash-diff",
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      },
      stashRef: "stash@{0}",
      path: "README.md"
    });
    await bridge.repository.getBranches({
      queryId: "branches",
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      }
    });
    await bridge.repository.cancelQuery({
      queryId: "changes"
    });
    await bridge.repository.stage({
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      },
      paths: ["README.md"]
    });
    await bridge.repository.unstage({
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      },
      paths: ["README.md"]
    });
    await bridge.repository.mutateStash({
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      },
      action: "pop",
      stashRef: "stash@{0}",
      stashHash: "a".repeat(40)
    });
    await bridge.repository.createCommit({
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      },
      subject: "Safe commit",
      body: "Body"
    });
    await bridge.repository.preflightCommand({
      command: {
        type: "fetch",
        targets: [
          {
            repositoryId: "repository",
            worktreeId: "worktree"
          }
        ],
        prune: true
      }
    });
    await bridge.repository.executeCommand({
      command: {
        type: "pull",
        targets: [
          {
            repositoryId: "repository",
            worktreeId: "worktree"
          }
        ],
        strategy: "ff-only"
      },
      preflightId: "preflight_1",
      confirmed: true
    });
    await bridge.repository.cancelOperation({
      operationId: "operation_1"
    });
    await bridge.worktree.selectDirectory();
    await bridge.worktree.preflightCommand({
      command: {
        type: "move",
        worktreeId: "worktree",
        destination: "C:\\workspace\\moved"
      }
    });
    await bridge.worktree.executeCommand({
      command: {
        type: "prune",
        repositoryId: "repository"
      },
      preflightId: "worktree_preflight_1",
      confirmed: true
    });
    await bridge.workspace.getCurrent();
    await bridge.workspace.getState();
    await bridge.workspace.selectDirectory();
    await bridge.workspace.addEntry({
      path: "C:\\workspace",
      source: "drop"
    });
    await bridge.workspace.rescan();
    await bridge.workspace.updateEntry({
      entryId: "entry",
      displayName: "Workspace"
    });
    await bridge.workspace.removeEntry({
      entryId: "entry"
    });
    await bridge.workspace.setGroupCollapsed({
      entryId: "entry",
      groupId: "group",
      collapsed: true
    });
    await bridge.workspace.selectEntry({
      entryId: "entry"
    });
    await bridge.workspace.selectTarget({
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      }
    });
    await bridge.workspace.refresh();
    const unsubscribe = bridge.workspace.onStateChanged(() => undefined);
    expect(stateListener).toBeDefined();
    unsubscribe();
    expect(stateListener).toBeUndefined();
    expect(bridge.workspace.resolveDroppedPath({})).toBe(
      "C:\\workspace"
    );
    await bridge.window.minimize();
    await bridge.window.toggleMaximize();
    await bridge.window.openDiffViewer({
      target: {
        repositoryId: "repository",
        worktreeId: "worktree"
      },
      path: "src/index.ts",
      mode: "unstaged"
    });
    await bridge.window.close();

    expect(Object.keys(bridge)).toEqual([
      "settings",
      "ai",
      "account",
      "system",
      "git",
      "repository",
      "worktree",
      "workspace",
      "window"
    ]);
    expect(calls).toEqual([
      {
        channel: IPC_CHANNELS.settingsGet,
        args: []
      },
      {
        channel: IPC_CHANNELS.settingsUpdate,
        args: [
          {
            general: {
              restoreLastView: true,
              defaultTerminalKind: "powershell"
            },
            git: {
              fetchMode: "startup"
            }
          }
        ]
      },
      {
        channel: IPC_CHANNELS.settingsClearAiApiKey,
        args: [{ confirmed: true }]
      },
      {
        channel: IPC_CHANNELS.aiTestConnection,
        args: [
          {
            apiUrl: "https://api.example.test/v1",
            model: "test-model",
            apiKey: "secret"
          }
        ]
      },
      {
        channel: IPC_CHANNELS.aiGenerateCommitMessage,
        args: [
          {
            target: {
              repositoryId: "repository",
              worktreeId: "worktree"
            }
          }
        ]
      },
      {
        channel: IPC_CHANNELS.accountList,
        args: []
      },
      {
        channel: IPC_CHANNELS.accountSave,
        args: [
          {
            provider: "custom",
            host: "git.example.test",
            username: "git",
            authType: "system-ssh",
            makeHostDefault: true
          }
        ]
      },
      {
        channel: IPC_CHANNELS.accountBind,
        args: [
          {
            accountId: "account_1",
            repositoryId: "repository"
          }
        ]
      },
      {
        channel: IPC_CHANNELS.accountUnbind,
        args: [
          {
            host: "git.example.test",
            repositoryId: "repository"
          }
        ]
      },
      {
        channel: IPC_CHANNELS.accountGetRemovalImpact,
        args: [{ accountId: "account_1" }]
      },
      {
        channel: IPC_CHANNELS.accountRemove,
        args: [
          {
            accountId: "account_1",
            confirmed: true
          }
        ]
      },
      {
        channel: IPC_CHANNELS.accountTest,
        args: [
          {
            accountId: "account_1",
            repositoryUrl:
              "ssh://git@git.example.test/team/repository.git"
          }
        ]
      },
      {
        channel: IPC_CHANNELS.systemGetRuntimeInfo,
        args: []
      },
      {
        channel: IPC_CHANNELS.systemListExternalApplications,
        args: []
      },
      {
        channel: IPC_CHANNELS.systemOpenExternalApplication,
        args: [
          {
            context: {
              scope: "repository",
              target: {
                repositoryId: "repository",
                worktreeId: "worktree"
              }
            },
            kind: "vscode"
          }
        ]
      },
      {
        channel: IPC_CHANNELS.systemListExternalTerminals,
        args: []
      },
      {
        channel: IPC_CHANNELS.systemOpenDirectory,
        args: [
          {
            target: {
              repositoryId: "repository",
              worktreeId: "worktree"
            }
          }
        ]
      },
      {
        channel: IPC_CHANNELS.systemOpenFileLocation,
        args: [
          {
            target: {
              repositoryId: "repository",
              worktreeId: "worktree"
            },
            path: "src/index.ts"
          }
        ]
      },
      {
        channel: IPC_CHANNELS.systemOpenExternalTerminal,
        args: [
          {
            target: {
              repositoryId: "repository",
              worktreeId: "worktree"
            },
            kind: "powershell"
          }
        ]
      },
      {
        channel: IPC_CHANNELS.gitGetEnvironment,
        args: []
      },
      {
        channel: IPC_CHANNELS.gitInspectRepository,
        args: [{ path: "C:\\repo" }]
      },
      {
        channel: IPC_CHANNELS.repositoryGetChanges,
        args: [
          {
            queryId: "changes",
            target: {
              repositoryId: "repository",
              worktreeId: "worktree"
            }
          }
        ]
      },
      {
        channel: IPC_CHANNELS.repositoryGetDiff,
        args: [
          {
            queryId: "diff",
            target: {
              repositoryId: "repository",
              worktreeId: "worktree"
            },
            path: "README.md",
            mode: "unstaged"
          }
        ]
      },
      {
        channel: IPC_CHANNELS.repositoryGetHistory,
        args: [
          {
            queryId: "history",
            target: {
              repositoryId: "repository",
              worktreeId: "worktree"
            },
            limit: 50
          }
        ]
      },
      {
        channel: IPC_CHANNELS.repositoryGetCommit,
        args: [
          {
            queryId: "commit",
            target: {
              repositoryId: "repository",
              worktreeId: "worktree"
            },
            commitHash: "abcdef"
          }
        ]
      },
      {
        channel: IPC_CHANNELS.repositoryGetCommitDiff,
        args: [
          {
            queryId: "commit-diff",
            target: {
              repositoryId: "repository",
              worktreeId: "worktree"
            },
            commitHash: "abcdef",
            path: "README.md",
            contextLines: 13
          }
        ]
      },
      {
        channel: IPC_CHANNELS.repositoryGetStashes,
        args: [
          {
            queryId: "stashes",
            target: {
              repositoryId: "repository",
              worktreeId: "worktree"
            },
            limit: 50
          }
        ]
      },
      {
        channel: IPC_CHANNELS.repositoryGetStashFiles,
        args: [
          {
            queryId: "stash-files",
            target: {
              repositoryId: "repository",
              worktreeId: "worktree"
            },
            stashRef: "stash@{0}"
          }
        ]
      },
      {
        channel: IPC_CHANNELS.repositoryGetStashDiff,
        args: [
          {
            queryId: "stash-diff",
            target: {
              repositoryId: "repository",
              worktreeId: "worktree"
            },
            stashRef: "stash@{0}",
            path: "README.md"
          }
        ]
      },
      {
        channel: IPC_CHANNELS.repositoryGetBranches,
        args: [
          {
            queryId: "branches",
            target: {
              repositoryId: "repository",
              worktreeId: "worktree"
            }
          }
        ]
      },
      {
        channel: IPC_CHANNELS.repositoryCancelQuery,
        args: [{ queryId: "changes" }]
      },
      {
        channel: IPC_CHANNELS.repositoryStage,
        args: [
          {
            target: {
              repositoryId: "repository",
              worktreeId: "worktree"
            },
            paths: ["README.md"]
          }
        ]
      },
      {
        channel: IPC_CHANNELS.repositoryUnstage,
        args: [
          {
            target: {
              repositoryId: "repository",
              worktreeId: "worktree"
            },
            paths: ["README.md"]
          }
        ]
      },
      {
        channel: IPC_CHANNELS.repositoryMutateStash,
        args: [
          {
            target: {
              repositoryId: "repository",
              worktreeId: "worktree"
            },
            action: "pop",
            stashRef: "stash@{0}",
            stashHash: "a".repeat(40)
          }
        ]
      },
      {
        channel: IPC_CHANNELS.repositoryCreateCommit,
        args: [
          {
            target: {
              repositoryId: "repository",
              worktreeId: "worktree"
            },
            subject: "Safe commit",
            body: "Body"
          }
        ]
      },
      {
        channel: IPC_CHANNELS.repositoryCommandPreflight,
        args: [
          {
            command: {
              type: "fetch",
              targets: [
                {
                  repositoryId: "repository",
                  worktreeId: "worktree"
                }
              ],
              prune: true
            }
          }
        ]
      },
      {
        channel: IPC_CHANNELS.repositoryCommandExecute,
        args: [
          {
            command: {
              type: "pull",
              targets: [
                {
                  repositoryId: "repository",
                  worktreeId: "worktree"
                }
              ],
              strategy: "ff-only"
            },
            preflightId: "preflight_1",
            confirmed: true
          }
        ]
      },
      {
        channel: IPC_CHANNELS.repositoryCancelOperation,
        args: [{ operationId: "operation_1" }]
      },
      {
        channel: IPC_CHANNELS.worktreeSelectDirectory,
        args: []
      },
      {
        channel: IPC_CHANNELS.worktreeCommandPreflight,
        args: [
          {
            command: {
              type: "move",
              worktreeId: "worktree",
              destination: "C:\\workspace\\moved"
            }
          }
        ]
      },
      {
        channel: IPC_CHANNELS.worktreeCommandExecute,
        args: [
          {
            command: {
              type: "prune",
              repositoryId: "repository"
            },
            preflightId: "worktree_preflight_1",
            confirmed: true
          }
        ]
      },
      {
        channel: IPC_CHANNELS.workspaceGetCurrent,
        args: []
      },
      {
        channel: IPC_CHANNELS.workspaceGetState,
        args: []
      },
      {
        channel: IPC_CHANNELS.workspaceSelectDirectory,
        args: []
      },
      {
        channel: IPC_CHANNELS.workspaceAddEntry,
        args: [{ path: "C:\\workspace", source: "drop" }]
      },
      {
        channel: IPC_CHANNELS.workspaceRescan,
        args: []
      },
      {
        channel: IPC_CHANNELS.workspaceUpdateEntry,
        args: [{ entryId: "entry", displayName: "Workspace" }]
      },
      {
        channel: IPC_CHANNELS.workspaceRemoveEntry,
        args: [{ entryId: "entry" }]
      },
      {
        channel: IPC_CHANNELS.workspaceSetGroupCollapsed,
        args: [
          {
            entryId: "entry",
            groupId: "group",
            collapsed: true
          }
        ]
      },
      {
        channel: IPC_CHANNELS.workspaceSelectEntry,
        args: [{ entryId: "entry" }]
      },
      {
        channel: IPC_CHANNELS.workspaceSelectTarget,
        args: [
          {
            target: {
              repositoryId: "repository",
              worktreeId: "worktree"
            }
          }
        ]
      },
      {
        channel: IPC_CHANNELS.workspaceRefresh,
        args: []
      },
      {
        channel: IPC_CHANNELS.windowMinimize,
        args: []
      },
      {
        channel: IPC_CHANNELS.windowToggleMaximize,
        args: []
      },
      {
        channel: IPC_CHANNELS.windowOpenDiffViewer,
        args: [
          {
            target: {
              repositoryId: "repository",
              worktreeId: "worktree"
            },
            path: "src/index.ts",
            mode: "unstaged"
          }
        ]
      },
      {
        channel: IPC_CHANNELS.windowClose,
        args: []
      }
    ]);
  });
});
