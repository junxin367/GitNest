import { appendFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  WorkspaceRuntimeService,
  WorkspaceService,
  type WorkspaceRuntimeState
} from "@gitnest/application";
import { GitCliClient } from "@gitnest/git-cli";
import {
  JsonRepositorySnapshotStore,
  JsonWorkspaceStore
} from "@gitnest/persistence-json";
import {
  createTemporaryDirectoryFixture,
  createWorkspaceFixture,
  type TemporaryDirectoryFixture,
  type WorkspaceFixture
} from "@gitnest/testkit";
import type {
  RepositoryTarget,
  WorkspaceWatchEvent,
  WorkspaceWatchHandle,
  WorkspaceWatcher,
  WorkspaceWatchRegistration
} from "@gitnest/workspace-core";

import { NodeWorkspaceFileSystem } from "../adapters/filesystem.adapter";

describe("WorkspaceRuntimeService integration", () => {
  let fixture: WorkspaceFixture;
  let appData: TemporaryDirectoryFixture;

  beforeAll(async () => {
    fixture = await createWorkspaceFixture();
    appData = await createTemporaryDirectoryFixture(
      "runtime-app-data"
    );
  });

  afterAll(async () => {
    await fixture.dispose();
    await appData.dispose();
  });

  it("refreshes real repositories, reacts to watcher hints, and restores cached snapshots first", async () => {
    const workspacePath = join(
      appData.path,
      "default.workspace.json"
    );
    const snapshotPath = join(
      appData.path,
      "default.snapshots.json"
    );
    const watcher = new PassiveWatcher();
    const runtime = createRuntime(
      workspacePath,
      snapshotPath,
      watcher
    );

    await runtime.addEntry({
      path: fixture.metaRootPath,
      source: "manual"
    });
    const refreshed = await waitForState(
      runtime,
      (state) =>
        state.monitor.mode === "watching" &&
        state.snapshots.length === 3 &&
        state.snapshots.every(
          (snapshot) =>
            !snapshot.refreshPending && !snapshot.stale
        )
    );
    const directWorktree = refreshed.workspace.worktrees.find(
      (worktree) => worktree.path === fixture.directRepositoryPath
    );
    const directTarget = refreshed.workspace.entries
      .flatMap((entry) =>
        entry.groups.flatMap((group) => group.targets)
      )
      .find(
        (target) => target.worktreeId === directWorktree?.id
      );

    expect(directTarget).toBeDefined();
    await appendFile(
      join(fixture.directRepositoryPath, "README.md"),
      "\nExternal change\n",
      "utf8"
    );
    watcher.emit(directTarget as RepositoryTarget);

    const changed = await waitForState(
      runtime,
      (state) =>
        Boolean(
          state.snapshots.find(
            (snapshot) =>
              snapshot.repositoryId ===
                directTarget?.repositoryId &&
              snapshot.worktreeId === directTarget.worktreeId &&
              snapshot.unstaged > 0 &&
              !snapshot.refreshPending
          )
        )
    );
    expect(
      changed.snapshots.find(
        (snapshot) =>
          snapshot.repositoryId === directTarget?.repositoryId &&
          snapshot.worktreeId === directTarget.worktreeId
      )
    ).toMatchObject({
      unstaged: 1,
      stale: false
    });
    expect(changed.operations).toHaveLength(0);
    await runtime.dispose();

    const restoredRuntime = createRuntime(
      workspacePath,
      snapshotPath,
      new PassiveWatcher()
    );
    const cached = await restoredRuntime.getState();

    expect(cached.snapshots).toHaveLength(3);
    expect(cached.snapshots.every((snapshot) => snapshot.stale)).toBe(
      true
    );
    expect(
      cached.snapshots.find(
        (snapshot) =>
          snapshot.repositoryId === directTarget?.repositoryId &&
          snapshot.worktreeId === directTarget.worktreeId
      )?.unstaged
    ).toBe(1);
    await restoredRuntime.dispose();
  });
});

function createRuntime(
  workspacePath: string,
  snapshotPath: string,
  watcher: WorkspaceWatcher
): WorkspaceRuntimeService {
  const gitClient = new GitCliClient();
  return new WorkspaceRuntimeService(
    new WorkspaceService(
      gitClient,
      new NodeWorkspaceFileSystem(),
      new JsonWorkspaceStore(workspacePath)
    ),
    gitClient,
    new JsonRepositorySnapshotStore(snapshotPath),
    watcher,
    {
      autoRefresh: false,
      currentTargetDebounceMs: 10,
      backgroundTargetDebounceMs: 20,
      currentTargetMinIntervalMs: 10,
      backgroundTargetMinIntervalMs: 20
    }
  );
}

class PassiveWatcher implements WorkspaceWatcher {
  #registrations: WorkspaceWatchRegistration[] = [];
  #onChange:
    | ((event: WorkspaceWatchEvent) => void)
    | undefined;

  async watch(
    registrations: WorkspaceWatchRegistration[],
    onChange: (event: WorkspaceWatchEvent) => void
  ): Promise<WorkspaceWatchHandle> {
    this.#registrations = registrations;
    this.#onChange = onChange;
    return {
      close: () => {
        this.#registrations = [];
        this.#onChange = undefined;
      }
    };
  }

  emit(target: RepositoryTarget): void {
    const registration = this.#registrations.find(
      (candidate) =>
        candidate.target.repositoryId === target.repositoryId &&
        candidate.target.worktreeId === target.worktreeId
    );

    if (!registration) {
      throw new Error("Target is not being watched.");
    }

    this.#onChange?.({
      path: registration.path,
      target
    });
  }
}

async function waitForState(
  runtime: WorkspaceRuntimeService,
  predicate: (state: WorkspaceRuntimeState) => boolean
): Promise<WorkspaceRuntimeState> {
  const current = await runtime.getState();
  if (predicate(current)) {
    return current;
  }

  return new Promise<WorkspaceRuntimeState>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for runtime state."));
    }, 5_000);
    const unsubscribe = runtime.subscribe((state) => {
      if (predicate(state)) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(state);
      }
    });
  });
}
