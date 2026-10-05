import { spawn } from "node:child_process";
import {
  appendFile,
  readFile,
  unlink,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from "vitest";

import {
  createGitRemoteFixture,
  type GitRemoteFixture
} from "@gitnest/testkit";

import { GitCliClient } from "./git-cli-client";
import {
  RepositoryCommandService,
  type RepositoryCommandRuntime
} from "../../../application/src/repository/repository-command-service";
import type { Workspace } from "@gitnest/workspace-core";

describe("GitCliClient repository operations integration", () => {
  let fixture: GitRemoteFixture;
  const client = new GitCliClient();

  beforeEach(async () => {
    fixture = await createGitRemoteFixture();
  });

  afterEach(async () => {
    await fixture.dispose();
  });

  it("reads effective fetch and all push URLs with Git URL rewriting", async () => {
    const path = fixture.localPath;
    await runGit(path, ["config", "url.https://fetch.example.test/.insteadOf", "fixture:"]);
    await runGit(path, ["config", "url.https://push.example.test/.pushInsteadOf", "fixture:"]);
    await runGit(path, ["remote", "set-url", "origin", "fixture:repository.git"]);
    await expect(client.readRemoteUrls(path, "origin", "fetch")).resolves.toEqual([
      "https://fetch.example.test/repository.git"
    ]);
    await expect(client.readRemoteUrls(path, "origin", "push")).resolves.toEqual([
      "https://push.example.test/repository.git"
    ]);
    await runGit(path, ["config", "--add", "remote.origin.pushurl", "fixture:first.git"]);
    await runGit(path, ["config", "--add", "remote.origin.pushurl", "fixture:second.git"]);
    await expect(client.readRemoteUrls(path, "origin", "push")).resolves.toEqual([
      "https://fetch.example.test/first.git",
      "https://fetch.example.test/second.git"
    ]);
  });

  it.each(["before-confirm", "while-queued"] as const)(
    "does not push to a replacement remote with identical history (%s)",
    async (phase) => {
      const otherRemote = join(fixture.containerPath, "other.git");
      await runGit(fixture.containerPath, [
        "clone", "--bare", fixture.remotePath, otherRemote
      ]);
      const oldHead = await client.resolveRevision(fixture.localPath, "HEAD");
      await commitChange(fixture.localPath, "new.txt", "new\n", "Local change");
      const runtime = createCommandRuntime(fixture);
      const service = new RepositoryCommandService(runtime, client, client);
      const preflight = await service.preflight({
        type: "push",
        targets: [{ repositoryId: "repo", worktreeId: "wt" }]
      });
      if (phase === "while-queued") {
        await service.execute(preflight.command, preflight.preflightId, true);
        await runGit(fixture.localPath, [
          "remote", "set-url", "--push", "origin", otherRemote
        ]);
        await expect(runtime.runQueued()).rejects.toMatchObject({
          code: "PREFLIGHT_CHANGED"
        });
      } else {
        await runGit(fixture.localPath, [
          "remote", "set-url", "origin", otherRemote
        ]);
        await expect(
          service.execute(preflight.command, preflight.preflightId, true)
        ).rejects.toMatchObject({ code: "PREFLIGHT_CHANGED" });
      }
      expect((await runGit(fixture.remotePath, ["rev-parse", "main"])).stdout.trim()).toBe(oldHead);
      expect((await runGit(otherRemote, ["rev-parse", "main"])).stdout.trim()).toBe(oldHead);
    }
  );

  it("reads remotes, advertised branches, revisions, and ancestry", async () => {
    const remotes = await client.readRemotes(
      fixture.localPath
    );
    const refs = await client.readRemoteBranches(
      fixture.localPath,
      "origin"
    );
    const head = await client.resolveRevision(
      fixture.localPath,
      "main"
    );

    expect(remotes).toEqual(["origin"]);
    expect(refs).toEqual([
      {
        name: "main",
        fullName: "refs/heads/main",
        head
      }
    ]);
    await expect(
      client.checkBranchName(
        fixture.localPath,
        "feature/测试"
      )
    ).resolves.toBe(true);
    await expect(
      client.checkBranchName(
        fixture.localPath,
        "bad..branch"
      )
    ).resolves.toBe(false);
    await expect(
      client.compareAncestry(
        fixture.localPath,
        head,
        head
      )
    ).resolves.toBe("ancestor");
    const advancedHead = await commitChange(
      fixture.localPath,
      "local-ahead.txt",
      "ahead\n",
      "Local ahead"
    );
    await expect(
      client.compareAncestry(
        fixture.localPath,
        advancedHead,
        head
      )
    ).resolves.toBe("descendant");
    await expect(
      client.compareAncestry(
        fixture.localPath,
        head,
        advancedHead
      )
    ).resolves.toBe("ancestor");
  });

  it("keeps branch operation names stable when tags shadow local and remote refs", async () => {
    const path = fixture.localPath;
    await runGit(path, ["branch", "release"]);
    await runGit(path, ["tag", "release"]);
    await runGit(path, ["tag", "origin/main"]);

    const branches = await client.readBranches(path);
    const release = branches.find((branch) => branch.fullName === "refs/heads/release");
    expect(release).toMatchObject({ name: "release", remote: false });
    expect(branches.find((branch) => branch.fullName === "refs/remotes/origin/main"))
      .toMatchObject({ name: "origin/main", remote: true });
    expect(branches.find((branch) => branch.current)?.upstream).toBe("origin/main");
    expect((await client.readRepositorySnapshot(path)).upstream).toBe("origin/main");
    expect((await client.inspectRepository(path)).snapshot.upstream).toBe("origin/main");

    const runtime = createCommandRuntime(fixture);
    const service = new RepositoryCommandService(runtime, client, client);
    const pull = await service.preflight({
      type: "pull",
      targets: [{ repositoryId: "repo", worktreeId: "wt" }],
      strategy: "ff-only"
    });
    await service.execute(pull.command, pull.preflightId, true);
    await runtime.runQueued();
    const preflight = await service.preflight({
      type: "switch-branch",
      target: { repositoryId: "repo", worktreeId: "wt" },
      branch: release!.name
    });
    await service.execute(preflight.command, preflight.preflightId, true);
    await runtime.runQueued();
    expect((await client.readRepositorySnapshot(path)).branch).toBe("release");
    expect((await runGit(path, ["tag", "--list"])).stdout.trim().split(/\r?\n/))
      .toEqual(["origin/main", "release"]);
  }, 15_000);

  it("preserves namespace-like local branch names and nested remote upstreams", async () => {
    const path = fixture.localPath;
    await runGit(path, ["branch", "heads/base"]);
    await runGit(path, ["switch", "-c", "heads/topic"]);
    await runGit(path, ["branch", "--set-upstream-to=heads/base"]);
    expect((await client.readRepositorySnapshot(path)).upstream).toBe("heads/base");
    expect((await client.readBranches(path)).find((branch) => branch.current))
      .toMatchObject({ name: "heads/topic", upstream: "heads/base", remote: false });

    await runGit(path, ["remote", "add", "team/origin", fixture.remotePath]);
    await runGit(path, ["fetch", "team/origin"]);
    await runGit(path, ["branch", "--set-upstream-to=team/origin/main"]);
    expect((await client.readRepositorySnapshot(path)).upstream).toBe("team/origin/main");
    expect((await client.readBranches(path)).find((branch) => branch.current))
      .toMatchObject({ name: "heads/topic", upstream: "team/origin/main", remote: false });
  });

  it.each(["fetch", "pull", "push"] as const)(
    "completes a workspace %s for linked worktrees sharing refs",
    async (type) => {
      const linkedPath = join(fixture.containerPath, "linked");
      await runGit(fixture.localPath, ["branch", "feature"]);
      await runGit(fixture.localPath, ["push", "--set-upstream", "origin", "feature"]);
      await runGit(fixture.localPath, ["worktree", "add", linkedPath, "feature"]);
      let mainHead: string;
      let featureHead: string;
      if (type === "push") {
        mainHead = await commitChange(fixture.localPath, "main.txt", "main update\n", "Main update");
        featureHead = await commitChange(linkedPath, "feature.txt", "feature update\n", "Feature update");
      } else {
        mainHead = await commitChange(fixture.peerPath, "main.txt", "main update\n", "Main update");
        await runGit(fixture.peerPath, ["push", "origin", "main"]);
        await runGit(fixture.peerPath, ["fetch", "origin", "feature"]);
        await runGit(fixture.peerPath, ["switch", "--track", "origin/feature"]);
        featureHead = await commitChange(fixture.peerPath, "feature.txt", "feature update\n", "Feature update");
        await runGit(fixture.peerPath, ["push", "origin", "feature"]);
      }
      if (type === "fetch") {
        await runGit(fixture.localPath, ["update-ref", "refs/remotes/origin/stale", "HEAD"]);
      }
      const runtime = createCommandRuntime(fixture);
      const workspace = await runtime.getCurrent();
      const linkedTarget = { repositoryId: "repo", worktreeId: "wt-linked" };
      workspace.groups[0]!.targets.push(linkedTarget);
      workspace.repositories[0]!.worktreeIds.push(linkedTarget.worktreeId);
      workspace.worktrees.push({
        ...workspace.worktrees[0]!,
        id: linkedTarget.worktreeId,
        path: linkedPath,
        canonicalPath: linkedPath,
        branch: "feature",
        isPrimary: false,
        gitDir: join(fixture.localPath, ".git", "worktrees", "linked")
      });
      const service = new RepositoryCommandService(runtime, client, client);
      const targets = workspace.groups[0]!.targets;
      const preflight = await service.preflight(
        type === "pull"
          ? { type, targets, strategy: "ff-only" }
          : type === "fetch"
            ? { type, targets, prune: true }
            : { type, targets }
      );
      if (type === "pull") {
        const localHead = await client.resolveRevision(linkedPath, "HEAD");
        expect(await client.compareAncestry(linkedPath, localHead, featureHead)).toBe("unknown");
      }
      const accepted = await service.execute(preflight.command, preflight.preflightId, true);
      expect(accepted.operationIds).toHaveLength(2);
      await runtime.runQueued();
      const refPath = type === "push" ? fixture.remotePath : fixture.localPath;
      const prefix = type === "fetch" ? "refs/remotes/origin/" : "refs/heads/";
      expect((await runGit(refPath, ["rev-parse", `${prefix}main`])).stdout.trim()).toBe(mainHead);
      expect((await runGit(refPath, ["rev-parse", `${prefix}feature`])).stdout.trim()).toBe(featureHead);
      if (type === "fetch") {
        expect((await client.readBranches(fixture.localPath)).some((branch) =>
          branch.fullName === "refs/remotes/origin/stale"
        )).toBe(false);
      }
    },
    30_000
  );

  it("acquires and disposes a token-free environment lease for remote commands", async () => {
    const contexts: unknown[] = [];
    let disposals = 0;
    const authenticatedClient = new GitCliClient({
      remoteEnvironmentProvider: async (context) => {
        contexts.push(context);
        return {
          environment: {
            GITNEST_TEST_AUTH_SESSION: "lease-only"
          },
          dispose: async () => {
            disposals += 1;
          }
        };
      }
    });

    await authenticatedClient.readRemoteBranches(
      fixture.localPath,
      "origin"
    );

    expect(contexts).toEqual([
      expect.objectContaining({
        repositoryPath: fixture.localPath,
        remote: "origin",
        remoteUrl: fixture.remotePath
      })
    ]);
    expect(JSON.stringify(contexts)).not.toContain(
      "lease-only"
    );
    expect(disposals).toBe(1);
  });

  it("does not replace a successful remote command with a synchronous lease disposal failure", async () => {
    const authenticatedClient = new GitCliClient({
      remoteEnvironmentProvider: async () => ({
        environment: {},
        dispose: (): Promise<void> => {
          throw new Error("synchronous disposal failure");
        }
      })
    });

    await expect(
      authenticatedClient.readRemoteBranches(
        fixture.localPath,
        "origin"
      )
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "main"
        })
      ])
    );
  });

  it("fetches and performs only a fast-forward pull", async () => {
    const peerHead = await commitChange(
      fixture.peerPath,
      "README.md",
      "\npeer update\n",
      "Peer update"
    );
    await runGit(fixture.peerPath, [
      "push",
      "origin",
      "main"
    ]);

    const advertised = await client.readRemoteBranches(
      fixture.localPath,
      "origin"
    );
    expect(advertised[0]?.head).toBe(peerHead);

    await client.fetchRemote(
      fixture.localPath,
      "origin",
      { prune: true }
    );
    expect(
      (await client.readBranches(fixture.localPath)).find(
        (branch) => branch.name === "origin/main"
      )?.head
    ).toBe(peerHead);

    await client.pullFastForward(
      fixture.localPath,
      "origin",
      "main"
    );
    expect(
      await client.resolveRevision(
        fixture.localPath,
        "HEAD"
      )
    ).toBe(peerHead);
  }, 15_000);

  it("pushes an explicit branch and permits only an expected force-with-lease overwrite", async () => {
    const firstLocalHead = await commitChange(
      fixture.localPath,
      "local.txt",
      "local one\n",
      "Local push"
    );
    await client.pushBranch(fixture.localPath, {
      remote: "origin",
      localBranch: "main",
      remoteBranch: "main"
    });
    expect(
      (
        await client.readRemoteBranches(
          fixture.localPath,
          "origin"
        )
      )[0]?.head
    ).toBe(firstLocalHead);

    await runGit(fixture.peerPath, [
      "pull",
      "--ff-only",
      "origin",
      "main"
    ]);
    const localDivergedHead = await commitChange(
      fixture.localPath,
      "local.txt",
      "local two\n",
      "Local divergence"
    );
    const peerHead = await commitChange(
      fixture.peerPath,
      "peer.txt",
      "peer divergence\n",
      "Peer divergence"
    );
    await runGit(fixture.peerPath, [
      "push",
      "origin",
      "main"
    ]);

    await expect(
      client.pushBranch(fixture.localPath, {
        remote: "origin",
        localBranch: "main",
        remoteBranch: "main"
      })
    ).rejects.toMatchObject({
      code: "NON_FAST_FORWARD"
    });
    await client.pushBranch(fixture.localPath, {
      remote: "origin",
      localBranch: "main",
      remoteBranch: "main",
      forceWithLeaseExpected: peerHead
    });
    expect(
      (
        await client.readRemoteBranches(
          fixture.localPath,
          "origin"
        )
      )[0]?.head
    ).toBe(localDivergedHead);
  }, 15_000);

  it("refuses a non-fast-forward pull without changing local HEAD", async () => {
    const localHead = await commitChange(
      fixture.localPath,
      "local.txt",
      "local divergence\n",
      "Local divergence"
    );
    await commitChange(
      fixture.peerPath,
      "peer.txt",
      "peer divergence\n",
      "Peer divergence"
    );
    await runGit(fixture.peerPath, [
      "push",
      "origin",
      "main"
    ]);

    await expect(
      client.pullFastForward(
        fixture.localPath,
        "origin",
        "main"
      )
    ).rejects.toMatchObject({
      code: "NON_FAST_FORWARD"
    });
    expect(
      await client.resolveRevision(
        fixture.localPath,
        "HEAD"
      )
    ).toBe(localHead);
  }, 15_000);

  it("creates, switches, renames, and safely deletes a merged local branch", async () => {
    const head = await client.resolveRevision(
      fixture.localPath,
      "HEAD"
    );
    await client.createBranch(
      fixture.localPath,
      "feature/测试",
      head
    );
    await client.switchBranch(
      fixture.localPath,
      "feature/测试"
    );
    await client.renameBranch(
      fixture.localPath,
      "feature/测试",
      "feature/renamed"
    );
    expect(
      await client.readRepositorySnapshot(
        fixture.localPath
      )
    ).toMatchObject({
      branch: "feature/renamed"
    });

    await client.switchBranch(fixture.localPath, "main");
    await client.deleteBranch(
      fixture.localPath,
      "feature/renamed"
    );
    expect(
      (await client.readBranches(fixture.localPath)).some(
        (branch) => branch.name === "feature/renamed"
      )
    ).toBe(false);
  }, 15_000);

  it("reports the selected branch after a post-checkout hook fails and recovers after fixing the hook", async () => {
    const path = fixture.localPath;
    const head = await client.resolveRevision(path, "HEAD");
    await client.createBranch(path, "feature/hook-failure", head);
    await runGit(path, ["config", "core.hooksPath", join(path, ".git", "hooks")]);
    const hookPath = join(path, ".git", "hooks", "post-checkout");
    await writeFile(hookPath, "#!/bin/sh\nexit 1\n", {
      encoding: "utf8", mode: 0o755
    });

    const failure = await client.switchBranch(path, "feature/hook-failure")
      .then(() => undefined, (error: unknown) => error);

    expect(await client.readRepositorySnapshot(path)).toMatchObject({
      branch: "feature/hook-failure", head
    });
    expect(failure).toMatchObject({
      code: "COMMAND_FAILED",
      message: expect.stringContaining("不要直接重复切换"),
      details: {
        branchOutcome: "selected",
        branch: "feature/hook-failure",
        head
      }
    });
    await unlink(hookPath);
    await client.switchBranch(path, "main");
    await client.switchBranch(path, "feature/hook-failure");
    expect((await client.readRepositorySnapshot(path)).branch)
      .toBe("feature/hook-failure");
  });

  it("preserves local edits when checkout is refused and permits retry after resolving them", async () => {
    const path = fixture.localPath;
    const original = await readFile(join(path, "README.md"), "utf8");
    const head = await client.resolveRevision(path, "HEAD");
    await client.createBranch(path, "feature/changed-file", head);
    await client.switchBranch(path, "feature/changed-file");
    await commitChange(path, "README.md", "feature content\n", "Feature fixture");
    await client.switchBranch(path, "main");
    const localEdits = `${original}local edits\n`;
    await writeFile(join(path, "README.md"), localEdits);

    const failure = await client.switchBranch(path, "feature/changed-file")
      .then(() => undefined, (error: unknown) => error);

    expect(failure).toMatchObject({ code: "COMMAND_FAILED" });
    expect(failure).not.toMatchObject({
      details: { branchOutcome: "selected" }
    });
    expect((await client.readRepositorySnapshot(path)).branch).toBe("main");
    expect(await readFile(join(path, "README.md"), "utf8")).toBe(localEdits);

    await client.restoreWorktreePaths(path, ["README.md"]);
    await client.switchBranch(path, "feature/changed-file");
    expect((await client.readRepositorySnapshot(path)).branch)
      .toBe("feature/changed-file");
  });

  it("cancels a long push hook and terminates its process tree", async () => {
    await commitChange(
      fixture.localPath,
      "local.txt",
      "cancel push\n",
      "Cancelled push"
    );
    await runGit(fixture.localPath, [
      "config",
      "core.hooksPath",
      ".git/hooks"
    ]);
    const readyPath = join(fixture.localPath, ".git", "hooks", "cancel-ready.json");
    const releasePath = join(fixture.localPath, ".git", "hooks", "cancel-release");
    const completedPath = join(fixture.localPath, ".git", "hooks", "cancel-completed");
    await writeFile(
      join(fixture.localPath, ".git", "hooks", "cancel-gate.cjs"),
      [
        "const fs = require('node:fs');",
        `fs.writeFileSync(${JSON.stringify(`${readyPath}.tmp`)}, JSON.stringify({ pid: process.pid }));`,
        `fs.renameSync(${JSON.stringify(`${readyPath}.tmp`)}, ${JSON.stringify(readyPath)});`,
        "const gate = setInterval(() => {",
        `  if (!fs.existsSync(${JSON.stringify(releasePath)})) return;`,
        `  fs.writeFileSync(${JSON.stringify(completedPath)}, String(Date.now()));`,
        "  clearInterval(gate);",
        "}, 10);",
        ""
      ].join("\n")
    );
    await writeFile(
      join(
        fixture.localPath,
        ".git",
        "hooks",
        "pre-push"
      ),
      [
        "#!/bin/sh",
        `"${process.execPath.replace(/\\/g, "/")}" .git/hooks/cancel-gate.cjs`,
        ""
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 }
    );
    const controller = new AbortController();
    const push = client.pushBranch(fixture.localPath, {
      remote: "origin",
      localBranch: "main",
      remoteBranch: "main",
      signal: controller.signal
    });
    const settled = push.then(
      () => ({ code: "SUCCEEDED" }),
      (error: { code: string }) => error
    );
    let cancelDeadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const hook = JSON.parse(await waitForFile(readyPath)) as { pid: number };
      controller.abort();
      expect(await Promise.race([
        settled,
        new Promise((resolve) => {
          cancelDeadline = setTimeout(() => resolve({ code: "CANCEL_DID_NOT_SETTLE" }), 5_000);
        })
      ])).toMatchObject({ code: "COMMAND_CANCELLED" });
      expect(() => process.kill(hook.pid, 0)).toThrow(/ESRCH/);
      await expect(readFile(completedPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      clearTimeout(cancelDeadline);
      await writeFile(releasePath, "release for cleanup");
      await settled;
    }
    const remoteHead = (
      await client.readRemoteBranches(
        fixture.localPath,
        "origin"
      )
    )[0]?.head;
    const peerHead = await client.resolveRevision(
      fixture.peerPath,
      "HEAD"
    );
    expect(remoteHead).toBe(peerHead);
  }, 15_000);
});

async function waitForFile(path: string): Promise<string> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Hook did not become ready: ${path}`);
}

function createCommandRuntime(
  fixture: GitRemoteFixture
): RepositoryCommandRuntime & { runQueued(): Promise<void> } {
  const path = fixture.localPath;
  const target = { repositoryId: "repo", worktreeId: "wt" };
  const workspace: Workspace = {
    schemaVersion: 2,
    id: "workspace",
    name: "fixture",
    path: fixture.containerPath,
    canonicalPath: fixture.containerPath,
    excludes: [],
    groups: [{ id: "group", name: "group", targets: [target], collapsed: false }],
    scanIssues: [],
    lastScannedAt: "",
    updatedAt: "",
    selectedTarget: target,
    repositories: [{
      id: "repo", name: "repo",
      commonDir: join(path, ".git"),
      canonicalCommonDir: join(path, ".git"),
      primaryWorktreeId: "wt",
      worktreeIds: ["wt"]
    }],
    worktrees: [{
      id: "wt", repositoryId: "repo", name: "local",
      path, canonicalPath: path, gitDir: join(path, ".git"),
      head: "", branch: "main",
      isPrimary: true, isBare: false, isDetached: false,
      isLocked: false, isPrunable: false
    }]
  };
  const queued: Array<() => Promise<void>> = [];
  return {
    async getCurrent() { return workspace; },
    async queueRepositoryOperation(target, _kind, action) {
      const worktree = workspace.worktrees.find((item) => item.id === target.worktreeId)!;
      queued.push(() => action(worktree.path, new AbortController().signal));
      return { operationId: `remote-fixture-${queued.length}` };
    },
    async cancelOperation() {},
    async runQueued() {
      if (queued.length === 0) {
        throw new Error("No queued repository operation.");
      }
      for (const action of queued) {
        await action();
      }
    }
  };
}

async function commitChange(
  path: string,
  file: string,
  content: string,
  subject: string
): Promise<string> {
  await appendFile(join(path, file), content, "utf8").catch(
    async () => {
      await writeFile(join(path, file), content, "utf8");
    }
  );
  await runGit(path, ["add", "--", file]);
  await runGit(path, ["commit", "-m", subject]);
  return (
    await runGit(path, ["rev-parse", "HEAD"])
  ).stdout.trim();
}

async function runGit(
  cwd: string,
  args: readonly string[]
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...args], {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "Never"
      },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      const result = {
        exitCode: exitCode ?? -1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      };
      if (result.exitCode === 0) {
        resolve(result);
        return;
      }
      reject(
        new Error(
          `Fixture Git command failed (${result.exitCode}): ${result.stderr}`
        )
      );
    });
  });
}
