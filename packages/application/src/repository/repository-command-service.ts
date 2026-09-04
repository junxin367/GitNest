import {
  GitError,
  type Branch,
  type GitClient,
  type GitReadOptions,
  type GitRepositoryCommandClient,
  type RemoteBranchRef,
  type RepositorySnapshot
} from "@gitnest/git-core";
import {
  listWorkspaceTargets,
  repositoryTargetKey,
  type RepositoryTarget,
  type Workspace
} from "@gitnest/workspace-core";

import { ConcurrencyLimiter } from "../operations/concurrency-limiter";
import type {
  RepositoryOperationAccepted,
  RepositoryOperationKind
} from "../workspace/workspace-runtime-service";

const DEFAULT_PREFLIGHT_TTL_MS = 60_000;
const DEFAULT_PREFLIGHT_CONCURRENCY = 4;
const MAX_PREFLIGHTS = 64;
const MAX_TARGETS = 50;

export type RepositoryCommand =
  | {
      type: "fetch";
      targets: RepositoryTarget[];
      remote?: string;
      prune?: boolean;
    }
  | {
      type: "pull";
      targets: RepositoryTarget[];
      strategy: "ff-only";
    }
  | {
      type: "push";
      targets: RepositoryTarget[];
      remote?: string;
      forceWithLease?: boolean;
    }
  | {
      type: "switch-branch";
      target: RepositoryTarget;
      branch: string;
    }
  | {
      type: "create-branch";
      target: RepositoryTarget;
      branch: string;
      startPoint?: string;
    }
  | {
      type: "rename-branch";
      target: RepositoryTarget;
      branch: string;
      newName: string;
    }
  | {
      type: "delete-branch";
      target: RepositoryTarget;
      branch: string;
    };

export interface CommandImpact {
  kind:
    | "remote-refs"
    | "worktree-update"
    | "remote-branch"
    | "local-branch";
  target: RepositoryTarget;
  summary: string;
  detail: string;
}

export interface CommandWarning {
  code:
    | "REMOTE_CONTACT"
    | "SET_UPSTREAM"
    | "FORCE_WITH_LEASE"
    | "REMOTE_BRANCH_EXISTS";
  severity: "info" | "warning" | "danger";
  message: string;
}

export interface CommandPreflight {
  preflightId: string;
  expiresAt: string;
  command: RepositoryCommand;
  targetSummary: string;
  impacts: CommandImpact[];
  warnings: CommandWarning[];
  confirmationRequired: boolean;
}

export interface RepositoryCommandExecutionAccepted {
  operationIds: string[];
}

export interface RepositoryCommandRuntime {
  getCurrent(): Promise<Workspace>;
  queueRepositoryOperation(
    target: RepositoryTarget,
    kind: RepositoryOperationKind,
    action: (
      worktreePath: string,
      signal: AbortSignal
    ) => Promise<void>
  ): Promise<RepositoryOperationAccepted>;
  cancelOperation(operationId: string): Promise<void>;
}

export interface RepositoryCommandServiceOptions {
  clock?: () => string;
  idFactory?: () => string;
  preflightTtlMs?: number;
  concurrency?: number;
}

interface CommandContext {
  snapshot: RepositorySnapshot;
  branches: Branch[];
  remotes: string[];
}

interface CommandTargetPlan {
  target: RepositoryTarget;
  path: string;
  fingerprint: string;
  impacts: CommandImpact[];
  warnings: CommandWarning[];
  remote?: string;
  localBranch?: string;
  remoteBranch?: string;
  setUpstream?: boolean;
  forceWithLeaseExpected?: string;
  branch?: string;
  newName?: string;
  startPoint?: string;
}

interface BuiltPreflight {
  command: RepositoryCommand;
  targetSummary: string;
  impacts: CommandImpact[];
  warnings: CommandWarning[];
  confirmationRequired: boolean;
  plans: CommandTargetPlan[];
  comparisonKey: string;
}

interface StoredPreflight extends BuiltPreflight {
  preflightId: string;
  expiresAt: string;
  expiresAtMs: number;
  commandKey: string;
}

export class RepositoryCommandService {
  readonly #runtime: RepositoryCommandRuntime;
  readonly #gitReader: GitClient;
  readonly #gitCommands: GitRepositoryCommandClient;
  readonly #clock: () => string;
  readonly #idFactory: () => string;
  readonly #preflightTtlMs: number;
  readonly #limiter: ConcurrencyLimiter;
  readonly #preflights = new Map<string, StoredPreflight>();
  #sequence = 0;

  constructor(
    runtime: RepositoryCommandRuntime,
    gitReader: GitClient,
    gitCommands: GitRepositoryCommandClient,
    options: RepositoryCommandServiceOptions = {}
  ) {
    this.#runtime = runtime;
    this.#gitReader = gitReader;
    this.#gitCommands = gitCommands;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#idFactory =
      options.idFactory ??
      (() =>
        `preflight_${Date.now()}_${++this.#sequence}_${Math.random()
          .toString(36)
          .slice(2, 10)}`);
    this.#preflightTtlMs =
      options.preflightTtlMs ?? DEFAULT_PREFLIGHT_TTL_MS;
    this.#limiter = new ConcurrencyLimiter(
      options.concurrency ?? DEFAULT_PREFLIGHT_CONCURRENCY
    );
  }

  async preflight(
    command: RepositoryCommand
  ): Promise<CommandPreflight> {
    this.#removeExpiredPreflights();
    const normalized = normalizeRepositoryCommand(command);
    const built = await this.#buildPreflight(normalized);
    const now = this.#nowMs();
    const expiresAtMs = now + this.#preflightTtlMs;
    const preflightId = this.#idFactory();
    const stored: StoredPreflight = {
      ...built,
      preflightId,
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs,
      commandKey: commandKey(normalized)
    };
    this.#preflights.set(preflightId, stored);
    this.#trimPreflights();
    return toPublicPreflight(stored);
  }

  async execute(
    command: RepositoryCommand,
    preflightId: string,
    confirmed: boolean
  ): Promise<RepositoryCommandExecutionAccepted> {
    const normalized = normalizeRepositoryCommand(command);
    const stored = this.#preflights.get(
      validatePreflightId(preflightId)
    );

    if (!stored || stored.expiresAtMs <= this.#nowMs()) {
      if (stored) {
        this.#preflights.delete(stored.preflightId);
      }
      throw new GitError(
        "PREFLIGHT_EXPIRED",
        "The command preflight expired. Run preflight again."
      );
    }

    if (stored.commandKey !== commandKey(normalized)) {
      throw new GitError(
        "PREFLIGHT_CHANGED",
        "The command parameters changed after preflight."
      );
    }

    if (stored.confirmationRequired && !confirmed) {
      throw new GitError(
        "CONFIRMATION_REQUIRED",
        "This command requires explicit confirmation."
      );
    }

    const current = await this.#buildPreflight(normalized);
    if (current.comparisonKey !== stored.comparisonKey) {
      this.#preflights.delete(stored.preflightId);
      throw new GitError(
        "PREFLIGHT_CHANGED",
        "Repository state or command impacts changed after preflight."
      );
    }

    this.#preflights.delete(stored.preflightId);
    const operationIds: string[] = [];
    for (const plan of stored.plans) {
      const accepted =
        await this.#runtime.queueRepositoryOperation(
          plan.target,
          operationKind(normalized),
          async (worktreePath, signal) => {
            const latest = await this.#buildTargetPlan(
              normalized,
              plan.target,
              worktreePath,
              signal
            );
            if (latest.fingerprint !== plan.fingerprint) {
              throw new GitError(
                "PREFLIGHT_CHANGED",
                "Repository state changed while the command was queued."
              );
            }
            await this.#executePlan(
              normalized,
              plan,
              worktreePath,
              signal
            );
          }
        );
      operationIds.push(accepted.operationId);
    }

    return { operationIds };
  }

  cancel(operationId: string): Promise<void> {
    return this.#runtime.cancelOperation(operationId);
  }

  async #buildPreflight(
    command: RepositoryCommand
  ): Promise<BuiltPreflight> {
    const workspace = await this.#runtime.getCurrent();
    const targets = commandTargets(command);
    const targetPaths = resolveTargetPaths(workspace, targets);
    const plans = await Promise.all(
      targets.map((target) =>
        this.#limiter.run(() =>
          this.#buildTargetPlan(
            command,
            target,
            targetPaths.get(repositoryTargetKey(target)) as string
          )
        )
      )
    );
    const impacts = plans.flatMap((plan) => plan.impacts);
    const warnings = plans.flatMap((plan) => plan.warnings);
    const confirmationRequired =
      command.type !== "fetch";

    return {
      command,
      targetSummary:
        targets.length === 1
          ? "1 个仓库目标"
          : `${targets.length} 个仓库目标`,
      impacts,
      warnings,
      confirmationRequired,
      plans,
      comparisonKey: JSON.stringify({
        command: commandKey(command),
        plans: plans.map((plan) => ({
          target: repositoryTargetKey(plan.target),
          fingerprint: plan.fingerprint,
          impacts: plan.impacts,
          warnings: plan.warnings
        }))
      })
    };
  }

  async #buildTargetPlan(
    command: RepositoryCommand,
    target: RepositoryTarget,
    path: string,
    signal?: AbortSignal
  ): Promise<CommandTargetPlan> {
    const options = signalOptions(signal);
    const [snapshot, branches, remotes] = await Promise.all([
      this.#gitReader.readRepositorySnapshot(path, options),
      this.#gitReader.readBranches(path, options),
      this.#gitCommands.readRemotes(path, options)
    ]);
    const context: CommandContext = {
      snapshot,
      branches,
      remotes
    };

    switch (command.type) {
      case "fetch":
        return this.#buildFetchPlan(
          command,
          target,
          path,
          context,
          signal
        );
      case "pull":
        return this.#buildPullPlan(
          target,
          path,
          context,
          signal
        );
      case "push":
        return this.#buildPushPlan(
          command,
          target,
          path,
          context,
          signal
        );
      case "switch-branch":
        return this.#buildSwitchBranchPlan(
          command,
          target,
          path,
          context
        );
      case "create-branch":
        return this.#buildCreateBranchPlan(
          command,
          target,
          path,
          context,
          signal
        );
      case "rename-branch":
        return this.#buildRenameBranchPlan(
          command,
          target,
          path,
          context,
          signal
        );
      case "delete-branch":
        return this.#buildDeleteBranchPlan(
          command,
          target,
          path,
          context,
          signal
        );
    }
  }

  async #buildFetchPlan(
    command: Extract<RepositoryCommand, { type: "fetch" }>,
    target: RepositoryTarget,
    path: string,
    context: CommandContext,
    signal?: AbortSignal
  ): Promise<CommandTargetPlan> {
    const upstream = resolveUpstream(context);
    const remote = selectRemote(
      command.remote,
      context.remotes,
      upstream?.remote
    );
    const remoteRefs =
      await this.#gitCommands.readRemoteBranches(
        path,
        remote,
        signalOptions(signal)
      );
    const staleTrackingBranches = command.prune
      ? findStaleTrackingBranches(
          context.branches,
          remote,
          remoteRefs
        )
      : [];
    const impacts: CommandImpact[] = [
      {
        kind: "remote-refs",
        target,
        summary: `Fetch ${remote}`,
        detail: `${remoteRefs.length} 个远程分支引用将按服务器广告更新${
          command.prune
            ? `；${staleTrackingBranches.length} 个失效跟踪引用将被清理`
            : ""
        }。`
      },
      ...staleTrackingBranches.map(
        ({ branch, remoteBranch }): CommandImpact => ({
          kind: "remote-refs",
          target,
          summary: `Prune ${branch.name}`,
          detail: `远程 ${remote} 已不再广告 refs/heads/${remoteBranch}；Fetch --prune 将删除本地跟踪引用 ${branch.fullName}。`
        })
      )
    ];
    const warnings: CommandWarning[] = [
      {
        code: "REMOTE_CONTACT",
        severity: "info",
        message: `将连接远程 ${remote}，但不会修改工作目录。`
      }
    ];
    return {
      target,
      path,
      remote,
      impacts,
      warnings,
      fingerprint: planFingerprint({
        target,
        path,
        context,
        remote,
        remoteRefs,
        staleTrackingBranches,
        prune: command.prune ?? false
      })
    };
  }

  async #buildPullPlan(
    target: RepositoryTarget,
    path: string,
    context: CommandContext,
    signal?: AbortSignal
  ): Promise<CommandTargetPlan> {
    assertCleanWorktree(context.snapshot, "Pull");
    const localBranch = context.snapshot.branch;
    if (!localBranch) {
      throw new GitError(
        "INVALID_REQUEST",
        "Pull requires a current local branch."
      );
    }
    const upstream = requireUpstream(context);
    const remoteRefs =
      await this.#gitCommands.readRemoteBranches(
        path,
        upstream.remote,
        signalOptions(signal)
      );
    const remoteRef = requireRemoteBranch(
      remoteRefs,
      upstream.branch
    );
    const ancestry =
      await this.#gitCommands.compareAncestry(
        path,
        context.snapshot.head,
        remoteRef.head,
        signalOptions(signal)
      );
    if (ancestry === "diverged") {
      throw new GitError(
        "NON_FAST_FORWARD",
        "Pull cannot fast-forward the current branch."
      );
    }

    const impacts: CommandImpact[] = [
      {
        kind: "worktree-update",
        target,
        summary: `Pull ${upstream.remote}/${upstream.branch}`,
        detail:
          context.snapshot.head === remoteRef.head
            ? "远程分支与当前 HEAD 一致，预计无需更新。"
            : ancestry === "descendant"
              ? `当前分支 ${localBranch} 已包含远程提交，预计无需更新。`
              : ancestry === "unknown"
                ? `远程对象尚未存在于本地；Pull 将在获取后仅允许 fast-forward 更新到 ${remoteRef.head.slice(0, 8)}。`
                : `当前分支 ${localBranch} 将仅以 fast-forward 方式更新到 ${remoteRef.head.slice(0, 8)}。`
      }
    ];
    return {
      target,
      path,
      remote: upstream.remote,
      remoteBranch: upstream.branch,
      localBranch,
      impacts,
      warnings: [
        {
          code: "REMOTE_CONTACT",
          severity: "info",
          message: "Pull 会连接远程，但不会自动 Merge、Rebase 或 Stash。"
        }
      ],
      fingerprint: planFingerprint({
        target,
        path,
        context,
        remote: upstream.remote,
        remoteBranch: upstream.branch,
        remoteHead: remoteRef.head,
        ancestry
      })
    };
  }

  async #buildPushPlan(
    command: Extract<RepositoryCommand, { type: "push" }>,
    target: RepositoryTarget,
    path: string,
    context: CommandContext,
    signal?: AbortSignal
  ): Promise<CommandTargetPlan> {
    if (!context.snapshot.branch || !context.snapshot.head) {
      throw new GitError(
        "INVALID_REQUEST",
        "Push requires a current local branch with a commit."
      );
    }
    if (context.snapshot.conflicted > 0) {
      throw new GitError(
        "INVALID_REQUEST",
        "Push is unavailable while conflicts are unresolved."
      );
    }

    const upstream = resolveUpstream(context);
    const remote = selectRemote(
      command.remote,
      context.remotes,
      upstream?.remote
    );
    const remoteBranch =
      upstream && upstream.remote === remote
        ? upstream.branch
        : context.snapshot.branch;
    const remoteRefs =
      await this.#gitCommands.readRemoteBranches(
        path,
        remote,
        signalOptions(signal)
      );
    const remoteRef = remoteRefs.find(
      (candidate) => candidate.name === remoteBranch
    );
    const forceWithLease =
      command.forceWithLease ?? false;

    if (forceWithLease && !remoteRef) {
      throw new GitError(
        "INVALID_REQUEST",
        "Force-with-lease requires an existing remote branch."
      );
    }

    if (remoteRef) {
      const ancestry =
        await this.#gitCommands.compareAncestry(
          path,
          remoteRef.head,
          context.snapshot.head,
          signalOptions(signal)
        );
      if (!forceWithLease && ancestry !== "ancestor") {
        throw new GitError(
          "NON_FAST_FORWARD",
          ancestry === "unknown"
            ? "Fetch the remote branch before pushing."
            : "The remote branch is not an ancestor of local HEAD."
        );
      }
    }

    const setUpstream =
      !upstream ||
      upstream.remote !== remote ||
      upstream.branch !== remoteBranch;
    const impacts: CommandImpact[] = [
      {
        kind: "remote-branch",
        target,
        summary: `${forceWithLease ? "Force-with-lease " : ""}Push ${remote}/${remoteBranch}`,
        detail: remoteRef
          ? `远程分支将从 ${remoteRef.head.slice(0, 8)} 更新到 ${context.snapshot.head.slice(0, 8)}。`
          : `将创建远程分支 ${remoteBranch} 并设置本地上游。`
      }
    ];
    const warnings: CommandWarning[] = [
      {
        code: "REMOTE_CONTACT",
        severity: "info",
        message: `将向远程 ${remote} 写入分支 ${remoteBranch}。`
      },
      ...(setUpstream
        ? [
            {
              code: "SET_UPSTREAM" as const,
              severity: "warning" as const,
              message: `成功后将设置 ${context.snapshot.branch} 的上游。`
            }
          ]
        : []),
      ...(forceWithLease
        ? [
            {
              code: "FORCE_WITH_LEASE" as const,
              severity: "danger" as const,
              message:
                "这会覆盖远程分支，但仅在远程仍等于预检对象时执行。"
            }
          ]
        : [])
    ];
    return {
      target,
      path,
      remote,
      localBranch: context.snapshot.branch,
      remoteBranch,
      setUpstream,
      ...(forceWithLease && remoteRef
        ? { forceWithLeaseExpected: remoteRef.head }
        : {}),
      impacts,
      warnings,
      fingerprint: planFingerprint({
        target,
        path,
        context,
        remote,
        remoteBranch,
        remoteHead: remoteRef?.head ?? "",
        setUpstream,
        forceWithLease
      })
    };
  }

  #buildSwitchBranchPlan(
    command: Extract<
      RepositoryCommand,
      { type: "switch-branch" }
    >,
    target: RepositoryTarget,
    path: string,
    context: CommandContext
  ): CommandTargetPlan {
    assertCleanWorktree(context.snapshot, "Switch branch");
    const branch = requireLocalBranch(
      context.branches,
      command.branch
    );
    if (branch.current) {
      throw new GitError(
        "INVALID_REQUEST",
        "The requested branch is already checked out."
      );
    }
    assertBranchAvailableInWorktree(branch, path);
    const impacts: CommandImpact[] = [
      {
        kind: "worktree-update",
        target,
        summary: `切换到 ${branch.name}`,
        detail: `当前 Worktree 将检出 ${branch.head.slice(0, 8)}，不会自动 Stash。`
      }
    ];
    return {
      target,
      path,
      branch: branch.name,
      impacts,
      warnings: [],
      fingerprint: planFingerprint({
        target,
        path,
        context,
        branch: branch.name
      })
    };
  }

  async #buildCreateBranchPlan(
    command: Extract<
      RepositoryCommand,
      { type: "create-branch" }
    >,
    target: RepositoryTarget,
    path: string,
    context: CommandContext,
    signal?: AbortSignal
  ): Promise<CommandTargetPlan> {
    await assertValidNewBranch(
      this.#gitCommands,
      path,
      command.branch,
      context.branches,
      signal
    );
    const requestedStartPoint =
      command.startPoint ?? context.snapshot.head;
    if (!requestedStartPoint) {
      throw new GitError(
        "INVALID_REQUEST",
        "Creating a branch requires an existing start point."
      );
    }
    const startPoint = await this.#gitCommands.resolveRevision(
      path,
      requestedStartPoint,
      signalOptions(signal)
    );
    const impacts: CommandImpact[] = [
      {
        kind: "local-branch",
        target,
        summary: `创建分支 ${command.branch}`,
        detail: `新分支将指向 ${startPoint.slice(0, 8)}，但不会自动检出。`
      }
    ];
    return {
      target,
      path,
      branch: command.branch,
      startPoint,
      impacts,
      warnings: [],
      fingerprint: planFingerprint({
        target,
        path,
        context,
        branch: command.branch,
        startPoint
      })
    };
  }

  async #buildRenameBranchPlan(
    command: Extract<
      RepositoryCommand,
      { type: "rename-branch" }
    >,
    target: RepositoryTarget,
    path: string,
    context: CommandContext,
    signal?: AbortSignal
  ): Promise<CommandTargetPlan> {
    const branch = requireLocalBranch(
      context.branches,
      command.branch
    );
    assertBranchAvailableInWorktree(branch, path);
    await assertValidNewBranch(
      this.#gitCommands,
      path,
      command.newName,
      context.branches,
      signal
    );
    const impacts: CommandImpact[] = [
      {
        kind: "local-branch",
        target,
        summary: `重命名 ${branch.name}`,
        detail: `本地分支将重命名为 ${command.newName}。`
      }
    ];
    return {
      target,
      path,
      branch: branch.name,
      newName: command.newName,
      impacts,
      warnings: branch.upstream
        ? [
            {
              code: "REMOTE_BRANCH_EXISTS",
              severity: "warning",
              message: `现有上游 ${branch.upstream} 不会自动重命名。`
            }
          ]
        : [],
      fingerprint: planFingerprint({
        target,
        path,
        context,
        branch: branch.name,
        newName: command.newName
      })
    };
  }

  async #buildDeleteBranchPlan(
    command: Extract<
      RepositoryCommand,
      { type: "delete-branch" }
    >,
    target: RepositoryTarget,
    path: string,
    context: CommandContext,
    signal?: AbortSignal
  ): Promise<CommandTargetPlan> {
    const branch = requireLocalBranch(
      context.branches,
      command.branch
    );
    if (branch.current) {
      throw new GitError(
        "INVALID_REQUEST",
        "The current branch cannot be deleted."
      );
    }
    assertBranchAvailableInWorktree(branch, path);
    if (!context.snapshot.head) {
      throw new GitError(
        "INVALID_REQUEST",
        "Branch deletion requires a current HEAD."
      );
    }
    const ancestry =
      await this.#gitCommands.compareAncestry(
        path,
        branch.head,
        context.snapshot.head,
        signalOptions(signal)
      );
    if (ancestry !== "ancestor") {
      throw new GitError(
        "INVALID_REQUEST",
        "The branch contains commits that are not merged into current HEAD."
      );
    }

    const remoteMatch = context.branches.find(
      (candidate) =>
        candidate.remote &&
        candidate.name.endsWith(`/${branch.name}`)
    );
    return {
      target,
      path,
      branch: branch.name,
      impacts: [
        {
          kind: "local-branch",
          target,
          summary: `删除本地分支 ${branch.name}`,
          detail: `将删除指向 ${branch.head.slice(0, 8)} 的本地引用；不会删除远程分支。`
        }
      ],
      warnings: remoteMatch
        ? [
            {
              code: "REMOTE_BRANCH_EXISTS",
              severity: "warning",
              message: `远程引用 ${remoteMatch.name} 将保留。`
            }
          ]
        : [],
      fingerprint: planFingerprint({
        target,
        path,
        context,
        branch: branch.name,
        remoteMatch: remoteMatch?.head ?? ""
      })
    };
  }

  async #executePlan(
    command: RepositoryCommand,
    plan: CommandTargetPlan,
    path: string,
    signal: AbortSignal
  ): Promise<void> {
    switch (command.type) {
      case "fetch":
        await this.#gitCommands.fetchRemote(
          path,
          plan.remote as string,
          {
            prune: command.prune ?? false,
            signal
          }
        );
        return;
      case "pull":
        await this.#gitCommands.pullFastForward(
          path,
          plan.remote as string,
          plan.remoteBranch as string,
          { signal }
        );
        return;
      case "push":
        await this.#gitCommands.pushBranch(path, {
          remote: plan.remote as string,
          localBranch: plan.localBranch as string,
          remoteBranch: plan.remoteBranch as string,
          setUpstream: plan.setUpstream ?? false,
          ...(plan.forceWithLeaseExpected
            ? {
                forceWithLeaseExpected:
                  plan.forceWithLeaseExpected
              }
            : {}),
          signal
        });
        return;
      case "switch-branch":
        await this.#gitCommands.switchBranch(
          path,
          plan.branch as string,
          { signal }
        );
        return;
      case "create-branch":
        await this.#gitCommands.createBranch(
          path,
          plan.branch as string,
          plan.startPoint as string,
          { signal }
        );
        return;
      case "rename-branch":
        await this.#gitCommands.renameBranch(
          path,
          plan.branch as string,
          plan.newName as string,
          { signal }
        );
        return;
      case "delete-branch":
        await this.#gitCommands.deleteBranch(
          path,
          plan.branch as string,
          { signal }
        );
    }
  }

  #nowMs(): number {
    const value = Date.parse(this.#clock());
    if (!Number.isFinite(value)) {
      throw new Error("Repository command clock is invalid.");
    }
    return value;
  }

  #removeExpiredPreflights(): void {
    const now = this.#nowMs();
    for (const [id, preflight] of this.#preflights) {
      if (preflight.expiresAtMs <= now) {
        this.#preflights.delete(id);
      }
    }
  }

  #trimPreflights(): void {
    while (this.#preflights.size > MAX_PREFLIGHTS) {
      const first = this.#preflights.keys().next().value;
      if (typeof first !== "string") {
        break;
      }
      this.#preflights.delete(first);
    }
  }
}

function normalizeRepositoryCommand(
  command: RepositoryCommand
): RepositoryCommand {
  if (!command || typeof command !== "object") {
    throw new GitError(
      "INVALID_REQUEST",
      "A repository command is required."
    );
  }

  switch (command.type) {
    case "fetch":
      return {
        type: "fetch",
        targets: normalizeTargets(command.targets),
        ...(command.remote?.trim()
          ? { remote: command.remote.trim() }
          : {}),
        prune: command.prune ?? false
      };
    case "pull":
      if (command.strategy !== "ff-only") {
        throw new GitError(
          "INVALID_REQUEST",
          "Pull supports only the ff-only strategy."
        );
      }
      return {
        type: "pull",
        targets: normalizeTargets(command.targets),
        strategy: "ff-only"
      };
    case "push": {
      const targets = normalizeTargets(command.targets);
      const forceWithLease =
        command.forceWithLease ?? false;
      if (forceWithLease && targets.length !== 1) {
        throw new GitError(
          "INVALID_REQUEST",
          "Force-with-lease is limited to one repository target."
        );
      }
      return {
        type: "push",
        targets,
        ...(command.remote?.trim()
          ? { remote: command.remote.trim() }
          : {}),
        forceWithLease
      };
    }
    case "switch-branch":
      return {
        type: "switch-branch",
        target: normalizeTarget(command.target),
        branch: normalizeName(command.branch, "branch")
      };
    case "create-branch":
      return {
        type: "create-branch",
        target: normalizeTarget(command.target),
        branch: normalizeName(command.branch, "branch"),
        ...(command.startPoint?.trim()
          ? { startPoint: command.startPoint.trim() }
          : {})
      };
    case "rename-branch":
      return {
        type: "rename-branch",
        target: normalizeTarget(command.target),
        branch: normalizeName(command.branch, "branch"),
        newName: normalizeName(command.newName, "branch")
      };
    case "delete-branch":
      return {
        type: "delete-branch",
        target: normalizeTarget(command.target),
        branch: normalizeName(command.branch, "branch")
      };
    default:
      throw new GitError(
        "INVALID_REQUEST",
        "Unsupported repository command."
      );
  }
}

function normalizeTargets(
  targets: RepositoryTarget[]
): RepositoryTarget[] {
  if (
    !Array.isArray(targets) ||
    targets.length === 0 ||
    targets.length > MAX_TARGETS
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `Repository commands require between 1 and ${MAX_TARGETS} targets.`
    );
  }
  const normalized = targets.map(normalizeTarget);
  const unique = new Map(
    normalized.map((target) => [
      repositoryTargetKey(target),
      target
    ])
  );
  if (unique.size !== normalized.length) {
    throw new GitError(
      "INVALID_REQUEST",
      "Repository command targets must be unique."
    );
  }
  return [...unique.values()].sort((left, right) =>
    repositoryTargetKey(left).localeCompare(
      repositoryTargetKey(right)
    )
  );
}

function normalizeTarget(
  target: RepositoryTarget
): RepositoryTarget {
  if (
    !target ||
    typeof target.repositoryId !== "string" ||
    !target.repositoryId ||
    typeof target.worktreeId !== "string" ||
    !target.worktreeId
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Repository targets require repository and Worktree ids."
    );
  }
  return {
    repositoryId: target.repositoryId,
    worktreeId: target.worktreeId
  };
}

function normalizeName(
  value: string,
  label: string
): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 255 ||
    normalized.includes("\0") ||
    /[\r\n]/.test(normalized)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `${label} names must contain 1 to 255 characters.`
    );
  }
  return normalized;
}

function commandTargets(
  command: RepositoryCommand
): RepositoryTarget[] {
  return "targets" in command
    ? command.targets
    : [command.target];
}

function resolveTargetPaths(
  workspace: Workspace,
  targets: RepositoryTarget[]
): Map<string, string> {
  const registered = new Set(
    listWorkspaceTargets(workspace).map(repositoryTargetKey)
  );
  const result = new Map<string, string>();

  for (const target of targets) {
    const key = repositoryTargetKey(target);
    const worktree = workspace.worktrees.find(
      (candidate) =>
        candidate.id === target.worktreeId &&
        candidate.repositoryId === target.repositoryId
    );
    if (!registered.has(key) || !worktree || worktree.isBare) {
      throw new GitError(
        "INVALID_REQUEST",
        "Repository commands require registered non-bare Worktrees."
      );
    }
    result.set(key, worktree.path);
  }

  return result;
}

function resolveUpstream(
  context: CommandContext
): {
  remote: string;
  branch: string;
} | undefined {
  const upstream = context.snapshot.upstream;
  if (!upstream) {
    return undefined;
  }
  const remote = [...context.remotes]
    .sort((left, right) => right.length - left.length)
    .find(
      (candidate) =>
        upstream.startsWith(`${candidate}/`) &&
        upstream.length > candidate.length + 1
    );
  return remote
    ? {
        remote,
        branch: upstream.slice(remote.length + 1)
      }
    : undefined;
}

function requireUpstream(context: CommandContext): {
  remote: string;
  branch: string;
} {
  const upstream = resolveUpstream(context);
  if (!context.snapshot.branch || !upstream) {
    throw new GitError(
      "INVALID_REQUEST",
      "The current branch does not have a supported remote upstream."
    );
  }
  return upstream;
}

function selectRemote(
  requested: string | undefined,
  remotes: string[],
  preferred?: string
): string {
  if (requested) {
    if (!remotes.includes(requested)) {
      throw new GitError(
        "INVALID_REQUEST",
        `Remote ${requested} is not configured for this repository.`
      );
    }
    return requested;
  }
  if (preferred && remotes.includes(preferred)) {
    return preferred;
  }
  if (remotes.includes("origin")) {
    return "origin";
  }
  if (remotes.length === 1) {
    return remotes[0] as string;
  }
  throw new GitError(
    "INVALID_REQUEST",
    remotes.length === 0
      ? "The repository has no configured remotes."
      : "Select a remote because this repository has multiple remotes."
  );
}

function requireRemoteBranch(
  refs: RemoteBranchRef[],
  branch: string
): RemoteBranchRef {
  const ref = refs.find((candidate) => candidate.name === branch);
  if (!ref) {
    throw new GitError(
      "INVALID_REQUEST",
      `Remote branch ${branch} does not exist.`
    );
  }
  return ref;
}

function findStaleTrackingBranches(
  branches: Branch[],
  remote: string,
  advertised: RemoteBranchRef[]
): Array<{
  branch: Branch;
  remoteBranch: string;
}> {
  const prefix = `refs/remotes/${remote}/`;
  const advertisedNames = new Set(
    advertised.map((branch) => branch.name)
  );

  return branches
    .filter(
      (branch) =>
        branch.remote && branch.fullName.startsWith(prefix)
    )
    .map((branch) => ({
      branch,
      remoteBranch: branch.fullName.slice(prefix.length)
    }))
    .filter(
      ({ remoteBranch }) =>
        remoteBranch && !advertisedNames.has(remoteBranch)
    )
    .sort((left, right) =>
      left.remoteBranch.localeCompare(right.remoteBranch)
    );
}

function requireLocalBranch(
  branches: Branch[],
  name: string
): Branch {
  const branch = branches.find(
    (candidate) =>
      !candidate.remote && candidate.name === name
  );
  if (!branch) {
    throw new GitError(
      "INVALID_REQUEST",
      `Local branch ${name} does not exist.`
    );
  }
  return branch;
}

async function assertValidNewBranch(
  client: GitRepositoryCommandClient,
  path: string,
  branch: string,
  branches: Branch[],
  signal?: AbortSignal
): Promise<void> {
  if (
    !(await client.checkBranchName(
      path,
      branch,
      signalOptions(signal)
    ))
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `Invalid branch name: ${branch}`
    );
  }
  if (
    branches.some(
      (candidate) =>
        !candidate.remote && candidate.name === branch
    )
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `Local branch ${branch} already exists.`
    );
  }
}

function assertCleanWorktree(
  snapshot: RepositorySnapshot,
  operation: string
): void {
  if (
    snapshot.staged > 0 ||
    snapshot.unstaged > 0 ||
    snapshot.untracked > 0 ||
    snapshot.conflicted > 0
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `${operation} requires a clean Worktree; GitNest will not auto-stash.`
    );
  }
}

function assertBranchAvailableInWorktree(
  branch: Branch,
  currentPath: string
): void {
  if (
    branch.worktreePath &&
    normalizePathForComparison(branch.worktreePath) !==
      normalizePathForComparison(currentPath)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `Branch ${branch.name} is checked out in another Worktree.`
    );
  }
}

function normalizePathForComparison(path: string): string {
  return path
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLocaleLowerCase("en-US");
}

function planFingerprint(value: unknown): string {
  return JSON.stringify(value, (key, candidate) =>
    key === "refreshedAt" ? undefined : candidate
  );
}

function signalOptions(signal?: AbortSignal): GitReadOptions {
  return signal ? { signal } : {};
}

function commandKey(command: RepositoryCommand): string {
  return JSON.stringify(command);
}

function operationKind(
  command: RepositoryCommand
): RepositoryOperationKind {
  return command.type;
}

function validatePreflightId(value: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 160 ||
    !/^[a-zA-Z0-9_-]+$/.test(value)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Preflight ids contain invalid characters."
    );
  }
  return value;
}

function toPublicPreflight(
  stored: StoredPreflight
): CommandPreflight {
  return structuredClone({
    preflightId: stored.preflightId,
    expiresAt: stored.expiresAt,
    command: stored.command,
    targetSummary: stored.targetSummary,
    impacts: stored.impacts,
    warnings: stored.warnings,
    confirmationRequired: stored.confirmationRequired
  });
}
