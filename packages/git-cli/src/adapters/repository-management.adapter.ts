import { spawn } from "node:child_process";
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve, win32 } from "node:path";
import {
  GitError,
  type RepositoryCreationInput,
  type RepositoryManagementAction,
  type RepositoryManagementPort,
  type RepositoryManagementState
} from "@gitnest/git-core";
import { findGitExecutable } from "../environment/find-git-executable";
import { createWritableProcessEnvironment, runProcess } from "../process/git-process-runner";
import type { GitRemoteCommandEnvironmentProvider } from "./git-cli-client";

function invalid(message: string): never { throw new GitError("INVALID_REQUEST", message); }
function text(value: string, label: string, max = 4096): void {
  if (typeof value !== "string" || !value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid(`${label}无效。`);
}
function remoteName(value: string): void {
  text(value, "远程名称", 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) invalid("远程名称只能包含字母、数字、点、下划线和短横线。");
}
function remoteUrl(value: string): void {
  text(value, "远程地址");
  if (value.startsWith("-") || value.includes("::")) invalid("不支持此远程地址。");
  if (value.includes("://")) {
    let url: URL;
    try { url = new URL(value); } catch { invalid("远程地址无效。"); }
    if (!["https:", "http:", "ssh:", "git:", "file:"].includes(url.protocol)) invalid("不支持此远程协议。");
    if (url.password || (["https:", "http:"].includes(url.protocol) && url.username)) invalid("请使用系统 Git 凭据助手，不要在 URL 中包含账号或令牌。");
  }
}
export class GitRepositoryManagementAdapter implements RepositoryManagementPort {
  #executablePromise: Promise<string> | undefined;
  constructor(private readonly options: { remoteEnvironmentProvider?: GitRemoteCommandEnvironmentProvider } = {}) {}
  async #executable(signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw new GitError("COMMAND_CANCELLED", "操作已取消。");
    if (!this.#executablePromise) {
      // Discovery belongs to this adapter, not to one cancellable operation.
      const discovery = findGitExecutable().catch((error: unknown) => {
        if (this.#executablePromise === discovery) this.#executablePromise = undefined;
        throw error;
      });
      this.#executablePromise = discovery;
    }
    const executable = await this.#executablePromise;
    if (signal?.aborted) throw new GitError("COMMAND_CANCELLED", "操作已取消。");
    return executable;
  }
  async #run(path: string, args: string[], signal?: AbortSignal, writeIntent = false) {
    return runProcess({
      executable: await this.#executable(signal), args, cwd: path, signal, writeIntent,
      timeoutMs: 180_000, environment: { GIT_TERMINAL_PROMPT: "0" }
    });
  }
  async inspect(path: string, signal?: AbortSignal): Promise<RepositoryManagementState> {
    const names = (await this.#run(path, ["remote"], signal)).stdout.trim().split(/\r?\n/).filter(Boolean);
    const remotes = await Promise.all(names.map(async (name) => {
      const fetchUrls = (await this.#run(path, ["remote", "get-url", "--all", name], signal)).stdout.trim().split(/\r?\n/).filter(Boolean);
      const pushUrls = (await this.#run(path, ["remote", "get-url", "--push", "--all", name], signal)).stdout.trim().split(/\r?\n/).filter(Boolean);
      return { name, fetchUrl: fetchUrls[0] ?? "", pushUrl: pushUrls[0] ?? "", fetchUrls, pushUrls };
    }));
    const tagOutput = (await this.#run(path, ["for-each-ref", "--sort=refname", "--format=%(refname:strip=2)%00%(objectname)%00%(subject)", "refs/tags"], signal)).stdout;
    return {
      remotes,
      tags: tagOutput.split(/\r?\n/).filter(Boolean).map((line) => {
        const [name = "", hash = "", subject = ""] = line.split("\0");
        return { name, hash, subject };
      })
    };
  }
  async resolveCommit(path: string, revision: string): Promise<string> {
    text(revision, "提交");
    if (revision.startsWith("-")) invalid("提交参数无效。");
    return (await this.#run(path, ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`])).stdout.trim();
  }
  async validateAction(path: string, action: RepositoryManagementAction): Promise<void> {
    if (!action || !["remote-add", "remote-set-url", "remote-remove", "tag-create", "tag-delete", "tag-push"].includes(action.type)) invalid("未知仓库操作。");
    const state = await this.inspect(path);
    if (action.type.startsWith("remote-")) {
      remoteName(action.name);
      if (action.type === "remote-add" && state.remotes.some((remote) => remote.name === action.name)) invalid("同名远程已存在。");
      if (action.type !== "remote-add" && !state.remotes.some((remote) => remote.name === action.name)) invalid("远程已不存在。");
      if ("url" in action) remoteUrl(action.url);
    } else {
      text(action.name, "标签名称", 1024);
      if (action.name.startsWith("-")) invalid("标签名称无效。");
      await this.#run(path, ["check-ref-format", `refs/tags/${action.name}`]);
      const exists = state.tags.some((tag) => tag.name === action.name);
      if (action.type === "tag-create") {
        if (exists) invalid("同名标签已存在，不会覆盖现有标签。");
        await this.resolveCommit(path, action.revision);
        if (action.message !== undefined) text(action.message, "标签说明", 10_000);
      } else if (!exists) invalid("标签已不存在。");
      if (action.type === "tag-push") {
        remoteName(action.remote);
        const remote = state.remotes.find((item) => item.name === action.remote);
        if (!remote) invalid("推送远程已不存在。");
        if (remote.pushUrls?.length !== 1) invalid("此远程配置了多个推送地址，请先使用 Git 配置确认单一推送目标。");
      }
    }
  }
  async execute(path: string, action: RepositoryManagementAction, signal: AbortSignal): Promise<void> {
    await this.validateAction(path, action);
    let args: string[];
    switch (action.type) {
      case "remote-add": args = ["remote", "add", action.name, action.url]; break;
      case "remote-set-url": args = ["remote", "set-url", action.name, action.url]; break;
      case "remote-remove": args = ["remote", "remove", action.name]; break;
      case "tag-create": args = ["tag", ...(action.message ? ["-a", "-m", action.message] : []), action.name, await this.resolveCommit(path, action.revision)]; break;
      case "tag-delete": args = ["tag", "--delete", action.name]; break;
      case "tag-push": args = ["push", "--porcelain", "--no-follow-tags", action.remote, `refs/tags/${action.name}:refs/tags/${action.name}`]; break;
    }
    if (action.type === "tag-push") {
      const remote = (await this.inspect(path)).remotes.find((item) => item.name === action.remote)!;
      const lease = await this.options.remoteEnvironmentProvider?.({ repositoryPath: path, remote: action.remote, remoteUrl: remote.pushUrl, signal });
      try {
        await runProcess({
          executable: await this.#executable(signal), args, cwd: path, signal, writeIntent: true,
          timeoutMs: 180_000, environment: { GIT_TERMINAL_PROMPT: "0", ...lease?.environment }
        });
      } finally { await lease?.dispose(); }
    } else await this.#run(path, args, signal, true);
  }
  async create(input: RepositoryCreationInput, signal: AbortSignal, progress: (message: string) => void): Promise<void> {
    if (!isAbsolute(input.destination)) invalid("目标目录必须是绝对路径。");
    const destination = resolve(input.destination);
    // Require a real parent and a fresh or truly empty non-link destination.
    const parent = await realpath(dirname(destination));
    if (!parent) invalid("目标目录的父目录不可用。");
    let stat;
    try { stat = await lstat(destination); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink() || (await readdir(destination)).length)) invalid("目标目录必须不存在或为空目录，且不能是符号链接。");
    if (input.kind === "clone") { if (!input.url) invalid("请输入克隆地址。"); remoteUrl(input.url); }
    if (input.initialBranch) {
      text(input.initialBranch, "初始分支", 1024);
      if (input.initialBranch.startsWith("-")) invalid("初始分支无效。");
      await this.#run(parent, ["check-ref-format", "--branch", input.initialBranch], signal);
    }
    if (signal.aborted) throw new GitError("COMMAND_CANCELLED", "操作已取消。");
    if (!stat) await mkdir(destination);
    if (input.kind === "init") {
      await this.#run(destination, ["init", ...(input.initialBranch ? [`--initial-branch=${input.initialBranch}`] : [])], signal, true);
      return;
    }
    const lease = await this.options.remoteEnvironmentProvider?.({ repositoryPath: destination, remote: "origin", remoteUrl: input.url!, signal });
    try {
      const executable = await this.#executable(signal);
      await new Promise<void>((resolvePromise, reject) => {
        const child = spawn(executable, ["clone", "--progress", "--", input.url!, destination], {
          cwd: parent, shell: false, windowsHide: true,
          env: createWritableProcessEnvironment({ GIT_TERMINAL_PROMPT: "0", ...lease?.environment }),
          stdio: ["ignore", "pipe", "pipe"]
        });
        let lastLine = "";
        let timedOut = false;
        const cancel = () => {
          if (process.platform === "win32" && child.pid) {
            const killer = spawn(process.env.SystemRoot ? win32.join(process.env.SystemRoot, "System32", "taskkill.exe") : "taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" });
            killer.once("error", () => { child.kill(); });
            killer.unref();
          } else child.kill();
        };
        const timeout = setTimeout(() => { timedOut = true; cancel(); }, 30 * 60_000);
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
        child.stdout.resume();
        child.stderr.on("data", (chunk: Buffer) => {
          const lines = chunk.toString("utf8").split(/[\r\n]+/).filter(Boolean);
          const latest = lines.at(-1);
          if (latest) {
            // Never display raw userinfo/token-bearing URLs from a helper's output.
            lastLine = latest.replace(/https?:\/\/[^/\s]+@/g, "https://[redacted]@").slice(0, 600);
            progress(lastLine);
          }
        });
        const cleanup = () => { clearTimeout(timeout); signal.removeEventListener("abort", cancel); };
        child.once("error", (error) => { cleanup(); reject(error); });
        child.once("close", (code) => {
          cleanup();
          if (signal.aborted) reject(new GitError("COMMAND_CANCELLED", "克隆已取消。"));
          else if (timedOut) reject(new GitError("COMMAND_TIMEOUT", "克隆超时。"));
          else if (code !== 0) reject(new GitError("COMMAND_FAILED", lastLine || "克隆失败，请检查地址、网络和 Git 凭据配置。"));
          else resolvePromise();
        });
      });
    } finally { await lease?.dispose(); }
  }
}
