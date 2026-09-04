import { spawn } from "node:child_process";
import {
  appendFile,
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

describe("GitCliClient repository operations integration", () => {
  let fixture: GitRemoteFixture;
  const client = new GitCliClient();

  beforeEach(async () => {
    fixture = await createGitRemoteFixture();
  });

  afterEach(async () => {
    await fixture.dispose();
  });

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
    await writeFile(
      join(
        fixture.localPath,
        ".git",
        "hooks",
        "pre-push"
      ),
      [
        "#!/bin/sh",
        "sleep 10",
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
    setTimeout(() => controller.abort(), 250);

    await expect(push).rejects.toMatchObject({
      code: "COMMAND_CANCELLED"
    });
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
