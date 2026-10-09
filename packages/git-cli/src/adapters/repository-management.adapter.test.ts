import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createTemporaryDirectoryFixture, type TemporaryDirectoryFixture } from "@gitnest/testkit";
import { GitRepositoryManagementAdapter } from "./repository-management.adapter";
import { runProcess } from "../process/git-process-runner";
import { findGitExecutable } from "../environment/find-git-executable";
import * as gitEnvironment from "../environment/find-git-executable";
import * as gitProcess from "../process/git-process-runner";

describe("GitRepositoryManagementAdapter executable discovery", () => {
  afterEach(() => vi.restoreAllMocks());
  it("shares successful discovery across concurrent inspections", async () => {
    const discover = vi.spyOn(gitEnvironment, "findGitExecutable").mockResolvedValue("owned-git");
    vi.spyOn(gitProcess, "runProcess").mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", durationMs: 0 });
    const adapter = new GitRepositoryManagementAdapter();
    await Promise.all([adapter.inspect("/first"), adapter.inspect("/second")]);
    expect(discover).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledWith();
  });
  it("retries failed discovery instead of retaining the rejection", async () => {
    const discover = vi.spyOn(gitEnvironment, "findGitExecutable").mockRejectedValueOnce(new Error("temporarily unavailable")).mockResolvedValue("owned-git");
    vi.spyOn(gitProcess, "runProcess").mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", durationMs: 0 });
    const adapter = new GitRepositoryManagementAdapter();
    await expect(adapter.inspect("/first")).rejects.toThrow("temporarily unavailable");
    await expect(adapter.inspect("/first")).resolves.toEqual({ remotes: [], tags: [] });
    expect(discover).toHaveBeenCalledTimes(2);
  });
  it("does not let a cancelled operation invalidate shared discovery", async () => {
    let finishDiscovery!: (path: string) => void;
    const discover = vi.spyOn(gitEnvironment, "findGitExecutable").mockImplementation(() => new Promise((resolve) => { finishDiscovery = resolve; }));
    const run = vi.spyOn(gitProcess, "runProcess").mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", durationMs: 0 });
    const adapter = new GitRepositoryManagementAdapter();
    const controller = new AbortController();
    const cancelled = adapter.inspect("/cancelled", controller.signal);
    controller.abort();
    const failure = expect(cancelled).rejects.toMatchObject({ code: "COMMAND_CANCELLED" });
    finishDiscovery("owned-git");
    await failure;
    expect(run).not.toHaveBeenCalled();
    await expect(adapter.inspect("/remaining")).resolves.toEqual({ remotes: [], tags: [] });
    expect(discover).toHaveBeenCalledTimes(1);
  });
});

describe("GitRepositoryManagementAdapter real Git", () => {
  let fixture: TemporaryDirectoryFixture;
  let repository: string;
  let remote: string;
  let executable: string;
  const adapter = new GitRepositoryManagementAdapter();
  const signal = new AbortController().signal;
  const git = async (cwd: string, args: string[]) => runProcess({ executable, cwd, args, writeIntent: true });
  beforeAll(async () => {
    fixture = await createTemporaryDirectoryFixture("repository-management");
    executable = await findGitExecutable();
    repository = join(fixture.path, "local");
    remote = join(fixture.path, "remote.git");
    await adapter.create({ kind: "init", destination: repository, initialBranch: "main" }, signal, () => undefined);
    await git(repository, ["config", "user.name", "GitNest Test"]);
    await git(repository, ["config", "user.email", "gitnest@example.invalid"]);
    await writeFile(join(repository, "owned.txt"), "owned fixture\n");
    await git(repository, ["add", "owned.txt"]);
    await git(repository, ["-c", "commit.gpgSign=false", "commit", "-m", "Fixture"]);
    await mkdir(remote);
    await git(remote, ["init", "--bare"]);
  }, 30_000);
  afterAll(async () => fixture.dispose(), 30_000);
  it("adds, edits, and removes remotes without contacting the network", async () => {
    await adapter.execute(repository, { type: "remote-add", name: "temporary", url: "https://github.com/example/first.git" }, signal);
    await adapter.execute(repository, { type: "remote-set-url", name: "temporary", url: "https://github.com/example/second.git" }, signal);
    expect((await adapter.inspect(repository)).remotes).toContainEqual(expect.objectContaining({ name: "temporary", fetchUrl: "https://github.com/example/second.git", pushUrl: "https://github.com/example/second.git" }));
    await adapter.execute(repository, { type: "remote-remove", name: "temporary" }, signal);
    expect((await adapter.inspect(repository)).remotes).toEqual([]);
  }, 30_000);
  it("creates annotated and lightweight tags, pushes only the selected tag to an owned local remote, and deletes locally", async () => {
    await adapter.execute(repository, { type: "remote-add", name: "origin", url: remote }, signal);
    await adapter.execute(repository, { type: "tag-create", name: "v1", revision: "HEAD" }, signal);
    await adapter.execute(repository, { type: "tag-create", name: "v2", revision: "HEAD", message: "Release notes" }, signal);
    await git(repository, ["config", "push.followTags", "true"]);
    expect((await adapter.inspect(repository)).tags.map((tag) => tag.name)).toEqual(["v1", "v2"]);
    await adapter.execute(repository, { type: "tag-push", name: "v1", remote: "origin" }, signal);
    expect((await git(remote, ["tag", "--list"])).stdout.trim()).toBe("v1");
    await adapter.execute(repository, { type: "tag-delete", name: "v1" }, signal);
    expect((await adapter.inspect(repository)).tags.map((tag) => tag.name)).toEqual(["v2"]);
    expect((await git(remote, ["tag", "--list"])).stdout.trim()).toBe("v1");
  }, 30_000);
  it("clones a real owned repository and reports progress", async () => {
    const destination = join(fixture.path, "cloned");
    const messages: string[] = [];
    await adapter.create({ kind: "clone", destination, url: repository }, signal, (message) => messages.push(message));
    expect((await readFile(join(destination, "owned.txt"), "utf8")).replaceAll("\r\n", "\n")).toBe("owned fixture\n");
    expect(messages.length).toBeGreaterThan(0);
  }, 30_000);
  it("preserves a nonempty destination and its sentinel", async () => {
    const destination = join(fixture.path, "nonempty");
    await mkdir(destination); await writeFile(join(destination, "sentinel"), "keep");
    await expect(adapter.create({ kind: "init", destination }, signal, () => undefined)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(await readFile(join(destination, "sentinel"), "utf8")).toBe("keep");
  }, 30_000);
  it("does not create anything for an already cancelled request", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(adapter.create({ kind: "init", destination: join(fixture.path, "cancelled") }, controller.signal, () => undefined)).rejects.toMatchObject({ code: "COMMAND_CANCELLED" });
  }, 30_000);
  it("rejects option injection, unsafe helpers, invalid tags, and duplicate refs", async () => {
    for (const url of ["--upload-pack=evil", "ext::evil", "https://token@github.com/example/repo"]) {
      await expect(adapter.validateAction(repository, { type: "remote-add", name: "unsafe", url })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    }
    await expect(adapter.validateAction(repository, { type: "remote-add", name: "--mirror", url: remote })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(adapter.validateAction(repository, { type: "tag-create", name: "v2", revision: "HEAD" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(adapter.validateAction(repository, { type: "tag-create", name: "--delete", revision: "HEAD" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  }, 30_000);
  it("rejects multi-destination pushes and exposes all configured URLs for freshness checks", async () => {
    await git(repository, ["config", "--add", "remote.origin.pushurl", remote]);
    await git(repository, ["config", "--add", "remote.origin.pushurl", join(fixture.path, "never-contact")]);
    const state = await adapter.inspect(repository);
    expect(state.remotes.find((item) => item.name === "origin")?.pushUrls).toHaveLength(2);
    await expect(adapter.execute(repository, { type: "tag-push", name: "v2", remote: "origin" }, signal)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect((await git(remote, ["tag", "--list"])).stdout.trim()).toBe("v1");
  }, 30_000);
});
