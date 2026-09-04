import {
  GitError,
  type Branch,
  type GitClient,
  type GitReadOptions,
  type GitRepositoryCommandClient,
  type GitWorktreeCommandClient,
  type RepositorySnapshot,
  type Worktree
} from "@gitnest/git-core";
import {
  listWorkspaceTargets,
  repositoryTargetKey,
  type RepositoryTarget,
  type Workspace,
  type WorkspaceRepository,
  type WorkspaceWorktree
} from "@gitnest/workspace-core";

import type {
  RepositoryOperationAccepted,
  RepositoryOperationKind,
  RepositoryOperationOptions
} from "../workspace/workspace-runtime-service";

const DEFAULT_PREFLIGHT_TTL_MS = 60_000;
const MAX_PREFLIGHTS = 64;
const MAX_ID_LENGTH = 512;
const MAX_BRANCH_LENGTH = 255;
const MAX_REVISION_LENGTH = 512;
const MAX_LOCK_REASON_LENGTH = 512;

export type WorktreeCommand =
  | {
      type: "create";
      repositoryId: string;
      path: string;
      branch?: string;
      startPoint?: string;
    }
  | {
      type: "lock";
      worktreeId: string;
      reason?: string;
    }
  | {
      type: "unlock";
      worktreeId: string;
    }
  | {
      type: "move";
      worktreeId: string;
      destination: string;
    }
  | {
      type: "repair";
      worktreeId: string;
    }
  | {
      type: "prune";
      repositoryId: string;
    }
  | {
      type: "remove";
      worktreeId: string;
    };

export type WorktreeCommandImpactKind =
  | "worktree-directory"
  | "local-branch"
  | "worktree-lock"
  | "worktree-registration";

export interface WorktreeCommandImpact {
  kind: WorktreeCommandImpactKind;
  target: RepositoryTarget;
  summary: string;
  detail: string;
}

export interface WorktreeCommandWarning {
  code:
    | "OUTSIDE_WORKSPACE"
    | "CREATE_BRANCH"
    | "DETACHED_HEAD"
    | "PRUNE_REGISTRATION"
    | "REMOVE_DIRECTORY";
  severity: "info" | "warning" | "danger";
  message: string;
}

export interface WorktreeCommandPreflight {
  preflightId: string;
  expiresAt: string;
  command: WorktreeCommand;
  targetSummary: string;
  impacts: WorktreeCommandImpact[];
  warnings: WorktreeCommandWarning[];
  confirmationRequired: boolean;
}

export interface WorktreeCommandExecutionAccepted {
  operationId: string;
}

export type WorktreePathKind =
  | "missing"
  | "directory"
  | "file"
  | "symbolic-link"
  | "other";

export interface NormalizedWorktreePath {
  path: string;
  canonicalPath: string;
}

export interface WorktreePathInspection
  extends NormalizedWorktreePath {
  exists: boolean;
  kind: WorktreePathKind;
  empty: boolean;
}

export interface WorktreePathPolicy {
  normalizePath(path: string): NormalizedWorktreePath;
  inspectPath(path: string): Promise<WorktreePathInspection>;
  isWithin(
    parentCanonicalPath: string,
    childCanonicalPath: string
  ): boolean;
  isExplicitlySelected(canonicalPath: string): boolean;
}

export interface WorktreeCommandRuntime {
  getCurrent(): Promise<Workspace>;
  queueRepositoryOperation(
    target: RepositoryTarget,
    kind: RepositoryOperationKind,
    action: (
      worktreePath: string,
      signal: AbortSignal
    ) => Promise<void>,
    options?: RepositoryOperationOptions
  ): Promise<RepositoryOperationAccepted>;
  cancelOperation(operationId: string): Promise<void>;
}

export interface WorktreeCommandServiceOptions {
  clock?: () => string;
  idFactory?: () => string;
  preflightTtlMs?: number;
}

type WorktreeExecutionPlan =
  | {
      type: "create";
      destination: string;
      startPoint: string;
      branch?: string;
      createBranch: boolean;
      detached: boolean;
    }
  | {
      type: "lock";
      worktreePath: string;
      reason?: string;
    }
  | {
      type: "unlock";
      worktreePath: string;
    }
  | {
      type: "move";
      worktreePath: string;
      destination: string;
    }
  | {
      type: "repair";
      worktreePaths: string[];
    }
  | {
      type: "prune";
    }
  | {
      type: "remove";
      worktreePath: string;
    };

interface WorktreeCommandPlan {
  anchorTarget: RepositoryTarget;
  anchorPath: string;
  targetSummary: string;
  impacts: WorktreeCommandImpact[];
  warnings: WorktreeCommandWarning[];
  confirmationRequired: boolean;
  fingerprint: string;
  execution: WorktreeExecutionPlan;
}

interface BuiltPreflight {
  command: WorktreeCommand;
  plan: WorktreeCommandPlan;
  comparisonKey: string;
}

interface StoredPreflight extends BuiltPreflight {
  preflightId: string;
  expiresAt: string;
  expiresAtMs: number;
  commandKey: string;
}

interface RepositoryContext {
  workspace: Workspace;
  repository: WorkspaceRepository;
  anchorTarget: RepositoryTarget;
  anchorWorktree: WorkspaceWorktree;
  anchorPath: string;
  gitWorktrees: Worktree[];
}

export class WorktreeCommandService {
  readonly #runtime: WorktreeCommandRuntime;
  readonly #gitReader: GitClient;
  readonly #gitRepositoryCommands: GitRepositoryCommandClient;
  readonly #gitWorktreeCommands: GitWorktreeCommandClient;
  readonly #pathPolicy: WorktreePathPolicy;
  readonly #clock: () => string;
  readonly #idFactory: () => string;
  readonly #preflightTtlMs: number;
  readonly #preflights = new Map<string, StoredPreflight>();
  #sequence = 0;

  constructor(
    runtime: WorktreeCommandRuntime,
    gitReader: GitClient,
    gitRepositoryCommands: GitRepositoryCommandClient,
    gitWorktreeCommands: GitWorktreeCommandClient,
    pathPolicy: WorktreePathPolicy,
    options: WorktreeCommandServiceOptions = {}
  ) {
    this.#runtime = runtime;
    this.#gitReader = gitReader;
    this.#gitRepositoryCommands = gitRepositoryCommands;
    this.#gitWorktreeCommands = gitWorktreeCommands;
    this.#pathPolicy = pathPolicy;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#idFactory =
      options.idFactory ??
      (() =>
        `worktree_preflight_${Date.now()}_${++this.#sequence}_${Math.random()
          .toString(36)
          .slice(2, 10)}`);
    this.#preflightTtlMs =
      options.preflightTtlMs ?? DEFAULT_PREFLIGHT_TTL_MS;
  }

  async preflight(
    command: WorktreeCommand
  ): Promise<WorktreeCommandPreflight> {
    this.#removeExpiredPreflights();
    const normalized = normalizeWorktreeCommand(command);
    const built = await this.#buildPreflight(normalized);
    const now = this.#nowMs();
    const expiresAtMs = now + this.#preflightTtlMs;
    const stored: StoredPreflight = {
      ...built,
      preflightId: this.#idFactory(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs,
      commandKey: commandKey(normalized)
    };
    this.#preflights.set(stored.preflightId, stored);
    this.#trimPreflights();
    return toPublicPreflight(stored);
  }

  async execute(
    command: WorktreeCommand,
    preflightId: string,
    confirmed: boolean
  ): Promise<WorktreeCommandExecutionAccepted> {
    const normalized = normalizeWorktreeCommand(command);
    const stored = this.#preflights.get(
      validatePreflightId(preflightId)
    );

    if (!stored || stored.expiresAtMs <= this.#nowMs()) {
      if (stored) {
        this.#preflights.delete(stored.preflightId);
      }
      throw new GitError(
        "PREFLIGHT_EXPIRED",
        "The Worktree command preflight expired. Run preflight again."
      );
    }
    if (stored.commandKey !== commandKey(normalized)) {
      throw new GitError(
        "PREFLIGHT_CHANGED",
        "The Worktree command parameters changed after preflight."
      );
    }
    if (stored.plan.confirmationRequired && !confirmed) {
      throw new GitError(
        "CONFIRMATION_REQUIRED",
        "This Worktree command requires explicit confirmation."
      );
    }

    let current: BuiltPreflight;
    try {
      current = await this.#buildPreflight(normalized);
    } catch (error) {
      this.#preflights.delete(stored.preflightId);
      throw changedPreflightError(
        error,
        "Worktree state or path validity changed after preflight."
      );
    }
    if (current.comparisonKey !== stored.comparisonKey) {
      this.#preflights.delete(stored.preflightId);
      throw new GitError(
        "PREFLIGHT_CHANGED",
        "Worktree state, path authorization, or command impacts changed after preflight."
      );
    }

    this.#preflights.delete(stored.preflightId);
    const accepted =
      await this.#runtime.queueRepositoryOperation(
        stored.plan.anchorTarget,
        operationKind(normalized),
        async (anchorPath, signal) => {
          let latest: WorktreeCommandPlan;
          try {
            latest = await this.#buildPlan(
              normalized,
              signal
            );
          } catch (error) {
            throw changedPreflightError(
              error,
              "Worktree state changed while the command was queued."
            );
          }
          if (
            latest.fingerprint !== stored.plan.fingerprint ||
            this.#pathPolicy.normalizePath(anchorPath)
              .canonicalPath !==
              this.#pathPolicy.normalizePath(
                latest.anchorPath
              ).canonicalPath
          ) {
            throw new GitError(
              "PREFLIGHT_CHANGED",
              "Worktree state changed while the command was queued."
            );
          }
          await this.#executePlan(
            latest.execution,
            anchorPath,
            signal
          );
        },
        { refreshTopology: true }
      );

    return { operationId: accepted.operationId };
  }

  cancel(operationId: string): Promise<void> {
    return this.#runtime.cancelOperation(operationId);
  }

  async #buildPreflight(
    command: WorktreeCommand
  ): Promise<BuiltPreflight> {
    const plan = await this.#buildPlan(command);
    return {
      command,
      plan,
      comparisonKey: JSON.stringify({
        command: commandKey(command),
        fingerprint: plan.fingerprint,
        impacts: plan.impacts,
        warnings: plan.warnings,
        confirmationRequired: plan.confirmationRequired
      })
    };
  }

  async #buildPlan(
    command: WorktreeCommand,
    signal?: AbortSignal
  ): Promise<WorktreeCommandPlan> {
    const workspace = await this.#runtime.getCurrent();
    const options = signalOptions(signal);
    const repositoryId =
      command.type === "create" || command.type === "prune"
        ? command.repositoryId
        : resolveWorkspaceWorktree(
            workspace,
            command.worktreeId
          ).repositoryId;
    const context = await this.#readRepositoryContext(
      workspace,
      repositoryId,
      options,
      command.type === "move" ||
        command.type === "remove"
        ? command.worktreeId
        : undefined
    );

    switch (command.type) {
      case "create":
        return this.#buildCreatePlan(
          command,
          context,
          options
        );
      case "lock":
        return this.#buildLockPlan(command, context);
      case "unlock":
        return this.#buildUnlockPlan(command, context);
      case "move":
        return this.#buildMovePlan(command, context);
      case "repair":
        return this.#buildRepairPlan(command, context);
      case "prune":
        return this.#buildPrunePlan(
          command,
          context,
          options
        );
      case "remove":
        return this.#buildRemovePlan(
          command,
          context,
          options
        );
    }
  }

  async #readRepositoryContext(
    workspace: Workspace,
    repositoryId: string,
    options: GitReadOptions,
    excludedAnchorWorktreeId?: string
  ): Promise<RepositoryContext> {
    const repository = workspace.repositories.find(
      (candidate) => candidate.id === repositoryId
    );
    if (!repository) {
      throw new GitError(
        "INVALID_REQUEST",
        "The requested repository is not registered in the current Workspace."
      );
    }

    const availableTargets = listWorkspaceTargets(
      workspace
    ).filter(
      (target) => target.repositoryId === repositoryId
    );
    const orderedTargets = [...availableTargets].sort(
      (left, right) =>
        Number(
          right.worktreeId ===
            repository.primaryWorktreeId
        ) -
        Number(
          left.worktreeId ===
            repository.primaryWorktreeId
        )
    );
    let anchor:
      | {
          target: RepositoryTarget;
          worktree: WorkspaceWorktree;
          inspection: WorktreePathInspection;
        }
      | undefined;
    for (const target of orderedTargets) {
      if (
        target.worktreeId === excludedAnchorWorktreeId
      ) {
        continue;
      }
      const worktree = workspace.worktrees.find(
        (candidate) =>
          candidate.id === target.worktreeId &&
          candidate.repositoryId === repositoryId
      );
      if (
        !worktree ||
        worktree.isBare ||
        worktree.isPrunable
      ) {
        continue;
      }
      try {
        const inspection =
          await this.#pathPolicy.inspectPath(worktree.path);
        if (
          inspection.exists &&
          inspection.kind === "directory"
        ) {
          anchor = { target, worktree, inspection };
          break;
        }
      } catch {
        // A linked Worktree can remain usable while another path is offline.
      }
    }
    if (!anchor) {
      throw new GitError(
        "DIRECTORY_UNAVAILABLE",
        "Worktree commands require an accessible non-bare repository Worktree."
      );
    }
    const gitWorktrees =
      await this.#gitWorktreeCommands.readWorktrees(
        anchor.inspection.path,
        options
      );

    return {
      workspace,
      repository,
      anchorTarget: anchor.target,
      anchorWorktree: anchor.worktree,
      anchorPath: anchor.inspection.path,
      gitWorktrees
    };
  }

  async #buildCreatePlan(
    command: Extract<WorktreeCommand, { type: "create" }>,
    context: RepositoryContext,
    options: GitReadOptions
  ): Promise<WorktreeCommandPlan> {
    const [destination, branches, snapshot] =
      await Promise.all([
        this.#pathPolicy.inspectPath(command.path),
        this.#gitReader.readBranches(
          context.anchorPath,
          options
        ),
        this.#gitReader.readRepositorySnapshot(
          context.anchorPath,
          options
        )
      ]);
    assertCreateDestination(destination);
    const authorization = this.#authorizeDestination(
      context.workspace,
      destination
    );
    this.#assertNoWorktreeOverlap(destination, context);

    const branch = command.branch;
    let execution: WorktreeExecutionPlan;
    const impacts: WorktreeCommandImpact[] = [
      {
        kind: "worktree-directory",
        target: context.anchorTarget,
        summary: "创建 Worktree 目录",
        detail: destination.path
      }
    ];
    const warnings: WorktreeCommandWarning[] = [];

    if (authorization === "selected") {
      warnings.push({
        code: "OUTSIDE_WORKSPACE",
        severity: "info",
        message:
          "目标位于当前 Workspace 根之外，已使用本次目录选择授权。"
      });
    }

    if (branch) {
      if (
        !(await this.#gitRepositoryCommands.checkBranchName(
          context.anchorPath,
          branch,
          options
        ))
      ) {
        throw new GitError(
          "INVALID_REQUEST",
          `Invalid branch name: ${branch}`
        );
      }
      const localBranch = branches.find(
        (candidate) =>
          !candidate.remote && candidate.name === branch
      );
      const occupied = context.gitWorktrees.find(
        (worktree) => worktree.branch === branch
      );
      if (occupied) {
        throw new GitError(
          "INVALID_REQUEST",
          `Branch ${branch} is already checked out at ${occupied.path}.`
        );
      }

      if (localBranch) {
        if (command.startPoint) {
          throw new GitError(
            "INVALID_REQUEST",
            "A start point cannot be supplied when creating a Worktree for an existing branch."
          );
        }
        execution = {
          type: "create",
          destination: destination.path,
          startPoint: localBranch.head,
          branch,
          createBranch: false,
          detached: false
        };
      } else {
        const startPoint = await this.#resolveStartPoint(
          context.anchorPath,
          command.startPoint,
          snapshot,
          options
        );
        execution = {
          type: "create",
          destination: destination.path,
          startPoint,
          branch,
          createBranch: true,
          detached: false
        };
        impacts.push({
          kind: "local-branch",
          target: context.anchorTarget,
          summary: `创建本地分支 ${branch}`,
          detail: `起点 ${startPoint}`
        });
        warnings.push({
          code: "CREATE_BRANCH",
          severity: "info",
          message: `本地分支 ${branch} 尚不存在，将随 Worktree 一并创建。`
        });
      }
    } else {
      const startPoint = await this.#resolveStartPoint(
        context.anchorPath,
        command.startPoint,
        snapshot,
        options
      );
      execution = {
        type: "create",
        destination: destination.path,
        startPoint,
        createBranch: false,
        detached: true
      };
      warnings.push({
        code: "DETACHED_HEAD",
        severity: "warning",
        message:
          "未指定分支，将创建 detached HEAD Worktree。"
      });
    }

    return this.#finalizePlan({
      context,
      command,
      targetSummary: `仓库 ${context.repository.name}`,
      impacts,
      warnings,
      confirmationRequired: true,
      execution,
      evidence: {
        destination,
        authorization,
        branches: stableBranches(branches),
        snapshot: stableSnapshot(snapshot)
      }
    });
  }

  #buildLockPlan(
    command: Extract<WorktreeCommand, { type: "lock" }>,
    context: RepositoryContext
  ): WorktreeCommandPlan {
    const target = resolveTargetContext(
      command.worktreeId,
      context,
      this.#pathPolicy
    );
    assertLinkedWorktree(target.workspaceWorktree, target.gitWorktree);
    if (target.gitWorktree.locked) {
      throw new GitError(
        "INVALID_REQUEST",
        "The selected Worktree is already locked."
      );
    }
    const execution: WorktreeExecutionPlan = {
      type: "lock",
      worktreePath: target.gitWorktree.path,
      ...(command.reason ? { reason: command.reason } : {})
    };
    return this.#finalizePlan({
      context,
      command,
      targetSummary: `Worktree ${target.gitWorktree.path}`,
      impacts: [
        {
          kind: "worktree-lock",
          target: target.target,
          summary: "锁定 Worktree",
          detail: command.reason
            ? `${target.gitWorktree.path}；原因：${command.reason}`
            : target.gitWorktree.path
        }
      ],
      warnings: [],
      confirmationRequired: false,
      execution,
      evidence: target
    });
  }

  #buildUnlockPlan(
    command: Extract<WorktreeCommand, { type: "unlock" }>,
    context: RepositoryContext
  ): WorktreeCommandPlan {
    const target = resolveTargetContext(
      command.worktreeId,
      context,
      this.#pathPolicy
    );
    assertLinkedWorktree(target.workspaceWorktree, target.gitWorktree);
    if (!target.gitWorktree.locked) {
      throw new GitError(
        "INVALID_REQUEST",
        "The selected Worktree is not locked."
      );
    }
    const execution: WorktreeExecutionPlan = {
      type: "unlock",
      worktreePath: target.gitWorktree.path
    };
    return this.#finalizePlan({
      context,
      command,
      targetSummary: `Worktree ${target.gitWorktree.path}`,
      impacts: [
        {
          kind: "worktree-lock",
          target: target.target,
          summary: "解锁 Worktree",
          detail: target.gitWorktree.lockReason
            ? `${target.gitWorktree.path}；原锁定原因：${target.gitWorktree.lockReason}`
            : target.gitWorktree.path
        }
      ],
      warnings: [],
      confirmationRequired: false,
      execution,
      evidence: target
    });
  }

  async #buildMovePlan(
    command: Extract<WorktreeCommand, { type: "move" }>,
    context: RepositoryContext
  ): Promise<WorktreeCommandPlan> {
    const target = resolveTargetContext(
      command.worktreeId,
      context,
      this.#pathPolicy
    );
    assertLinkedWorktree(target.workspaceWorktree, target.gitWorktree);
    assertMutableLinkedWorktree(target.gitWorktree, "move");
    const destination =
      await this.#pathPolicy.inspectPath(
        command.destination
      );
    if (destination.exists) {
      throw new GitError(
        "INVALID_REQUEST",
        "Worktree move destinations must not already exist."
      );
    }
    const authorization = this.#authorizeDestination(
      context.workspace,
      destination
    );
    this.#assertNoWorktreeOverlap(destination, context);
    const warnings: WorktreeCommandWarning[] =
      authorization === "selected"
        ? [
            {
              code: "OUTSIDE_WORKSPACE",
              severity: "info",
              message:
                "目标位于当前 Workspace 根之外，已使用本次目录选择授权。"
            }
          ]
        : [];
    const execution: WorktreeExecutionPlan = {
      type: "move",
      worktreePath: target.gitWorktree.path,
      destination: destination.path
    };
    return this.#finalizePlan({
      context,
      command,
      targetSummary: `Worktree ${target.gitWorktree.path}`,
      impacts: [
        {
          kind: "worktree-directory",
          target: target.target,
          summary: "移动 Worktree",
          detail: `${target.gitWorktree.path} → ${destination.path}`
        }
      ],
      warnings,
      confirmationRequired: true,
      execution,
      evidence: {
        target,
        destination,
        authorization
      }
    });
  }

  #buildRepairPlan(
    command: Extract<WorktreeCommand, { type: "repair" }>,
    context: RepositoryContext
  ): WorktreeCommandPlan {
    const target = resolveTargetContext(
      command.worktreeId,
      context,
      this.#pathPolicy
    );
    if (
      target.workspaceWorktree.isBare ||
      target.gitWorktree.bare
    ) {
      throw new GitError(
        "INVALID_REQUEST",
        "Bare repositories do not support Worktree repair."
      );
    }
    const execution: WorktreeExecutionPlan = {
      type: "repair",
      worktreePaths: [target.gitWorktree.path]
    };
    return this.#finalizePlan({
      context,
      command,
      targetSummary: `Worktree ${target.gitWorktree.path}`,
      impacts: [
        {
          kind: "worktree-registration",
          target: target.target,
          summary: "修复 Worktree 登记",
          detail: `${target.gitWorktree.path}；Git 元数据将重新关联，工作目录内容不会被删除。`
        }
      ],
      warnings: [],
      confirmationRequired: true,
      execution,
      evidence: target
    });
  }

  async #buildPrunePlan(
    command: Extract<WorktreeCommand, { type: "prune" }>,
    context: RepositoryContext,
    options: GitReadOptions
  ): Promise<WorktreeCommandPlan> {
    const candidates =
      await this.#gitWorktreeCommands.previewPruneWorktrees(
        context.anchorPath,
        options
      );
    const registeredPaths = new Set(
      context.gitWorktrees.map(
        (worktree) =>
          this.#pathPolicy.normalizePath(worktree.path)
            .canonicalPath
      )
    );
    if (
      candidates.some(
        (candidate) =>
          !registeredPaths.has(
            this.#pathPolicy.normalizePath(candidate.path)
              .canonicalPath
          )
      )
    ) {
      throw new GitError(
        "PREFLIGHT_CHANGED",
        "The Worktree prune preview did not match the registered topology."
      );
    }
    if (candidates.length === 0) {
      throw new GitError(
        "INVALID_REQUEST",
        "No prunable Worktree registrations were found."
      );
    }
    const impacts = candidates
      .map((worktree) => ({
        worktree,
        normalized:
          this.#pathPolicy.normalizePath(worktree.path)
      }))
      .sort((left, right) =>
        left.normalized.canonicalPath.localeCompare(
          right.normalized.canonicalPath
        )
      )
      .map(({ worktree }) => {
        const workspaceWorktree =
          findWorkspaceWorktreeByPath(
            context.workspace,
            worktree.path,
            this.#pathPolicy
          );
        return {
          kind: "worktree-registration" as const,
          target: workspaceWorktree
            ? {
                repositoryId:
                  workspaceWorktree.repositoryId,
                worktreeId: workspaceWorktree.id
              }
            : context.anchorTarget,
          summary: "Prune 失效 Worktree 登记",
          detail: `${worktree.path}${
            worktree.pruneReason
              ? `；原因：${worktree.pruneReason}`
              : ""
          }`
        };
      });
    const execution: WorktreeExecutionPlan = {
      type: "prune"
    };
    return this.#finalizePlan({
      context,
      command,
      targetSummary: `仓库 ${context.repository.name}`,
      impacts,
      warnings: [
        {
          code: "PRUNE_REGISTRATION",
          severity: "warning",
          message:
            "Prune 只清理上方列出的 Git 登记，不会递归删除仍存在的目录。"
        }
      ],
      confirmationRequired: true,
      execution,
      evidence: {
        candidates: candidates.map((worktree) =>
          stableGitWorktree(worktree, this.#pathPolicy)
        )
      }
    });
  }

  async #buildRemovePlan(
    command: Extract<WorktreeCommand, { type: "remove" }>,
    context: RepositoryContext,
    options: GitReadOptions
  ): Promise<WorktreeCommandPlan> {
    const target = resolveTargetContext(
      command.worktreeId,
      context,
      this.#pathPolicy
    );
    assertLinkedWorktree(target.workspaceWorktree, target.gitWorktree);
    assertMutableLinkedWorktree(target.gitWorktree, "remove");
    const inspection =
      await this.#pathPolicy.inspectPath(
        target.gitWorktree.path
      );
    if (
      !inspection.exists ||
      inspection.kind !== "directory"
    ) {
      throw new GitError(
        "DIRECTORY_UNAVAILABLE",
        "The selected Worktree directory is unavailable; use Prune for stale registrations."
      );
    }
    const snapshot =
      await this.#gitReader.readRepositorySnapshot(
        inspection.path,
        options
      );
    assertCleanSnapshot(snapshot);
    const execution: WorktreeExecutionPlan = {
      type: "remove",
      worktreePath: target.gitWorktree.path
    };
    return this.#finalizePlan({
      context,
      command,
      targetSummary: `Worktree ${target.gitWorktree.path}`,
      impacts: [
        {
          kind: "worktree-directory",
          target: target.target,
          summary: "移除 linked Worktree",
          detail: `${target.gitWorktree.path}；Git 将移除该干净工作目录与登记，不使用 --force。`
        }
      ],
      warnings: [
        {
          code: "REMOVE_DIRECTORY",
          severity: "danger",
          message:
            "确认后 Git 会移除这个 linked Worktree 目录；Primary Worktree 和脏目录始终被拒绝。"
        }
      ],
      confirmationRequired: true,
      execution,
      evidence: {
        target,
        inspection,
        snapshot: stableSnapshot(snapshot)
      }
    });
  }

  async #resolveStartPoint(
    anchorPath: string,
    requested: string | undefined,
    snapshot: RepositorySnapshot,
    options: GitReadOptions
  ): Promise<string> {
    if (requested) {
      return this.#gitRepositoryCommands.resolveRevision(
        anchorPath,
        requested,
        options
      );
    }
    if (!snapshot.head) {
      throw new GitError(
        "INVALID_REQUEST",
        "Worktree creation requires an explicit start point when the repository has no HEAD."
      );
    }
    return snapshot.head;
  }

  #authorizeDestination(
    workspace: Workspace,
    destination: WorktreePathInspection
  ): "workspace-root" | "selected" {
    const inWorkspaceRoot = workspace.entries.some((entry) =>
      this.#pathPolicy.isWithin(
        entry.canonicalPath,
        destination.canonicalPath
      )
    );
    if (inWorkspaceRoot) {
      return "workspace-root";
    }
    if (
      this.#pathPolicy.isExplicitlySelected(
        destination.canonicalPath
      )
    ) {
      return "selected";
    }
    throw new GitError(
      "INVALID_REQUEST",
      "Worktree destinations must be inside a configured Workspace root or covered by a recent Main-process directory selection."
    );
  }

  #assertNoWorktreeOverlap(
    destination: WorktreePathInspection,
    context: RepositoryContext
  ): void {
    const paths = new Set<string>();
    for (const worktree of context.workspace.worktrees) {
      paths.add(worktree.canonicalPath);
    }
    for (const worktree of context.gitWorktrees) {
      paths.add(
        this.#pathPolicy.normalizePath(worktree.path)
          .canonicalPath
      );
    }
    for (const existing of paths) {
      if (
        this.#pathPolicy.isWithin(
          existing,
          destination.canonicalPath
        ) ||
        this.#pathPolicy.isWithin(
          destination.canonicalPath,
          existing
        )
      ) {
        throw new GitError(
          "INVALID_REQUEST",
          "The destination overlaps an existing Worktree path."
        );
      }
    }
  }

  #finalizePlan(input: {
    context: RepositoryContext;
    command: WorktreeCommand;
    targetSummary: string;
    impacts: WorktreeCommandImpact[];
    warnings: WorktreeCommandWarning[];
    confirmationRequired: boolean;
    execution: WorktreeExecutionPlan;
    evidence: unknown;
  }): WorktreeCommandPlan {
    return {
      anchorTarget: input.context.anchorTarget,
      anchorPath: input.context.anchorPath,
      targetSummary: input.targetSummary,
      impacts: input.impacts,
      warnings: input.warnings,
      confirmationRequired: input.confirmationRequired,
      execution: input.execution,
      fingerprint: planFingerprint({
        command: input.command,
        repository: {
          id: input.context.repository.id,
          commonDir:
            input.context.repository.canonicalCommonDir,
          worktreeIds: [
            ...input.context.repository.worktreeIds
          ].sort()
        },
        anchor: {
          target: repositoryTargetKey(
            input.context.anchorTarget
          ),
          path: this.#pathPolicy.normalizePath(
            input.context.anchorPath
          ).canonicalPath
        },
        gitWorktrees: input.context.gitWorktrees
          .map((worktree) =>
            stableGitWorktree(
              worktree,
              this.#pathPolicy
            )
          )
          .sort((left, right) =>
            left.path.localeCompare(right.path)
          ),
        execution: input.execution,
        impacts: input.impacts,
        warnings: input.warnings,
        evidence: input.evidence
      })
    };
  }

  async #executePlan(
    plan: WorktreeExecutionPlan,
    anchorPath: string,
    signal: AbortSignal
  ): Promise<void> {
    const options = { signal };
    switch (plan.type) {
      case "create":
        await this.#gitWorktreeCommands.createWorktree(
          anchorPath,
          plan.destination,
          {
            signal,
            startPoint: plan.startPoint,
            ...(plan.branch ? { branch: plan.branch } : {}),
            createBranch: plan.createBranch,
            detached: plan.detached
          }
        );
        return;
      case "lock":
        await this.#gitWorktreeCommands.lockWorktree(
          anchorPath,
          plan.worktreePath,
          {
            signal,
            ...(plan.reason ? { reason: plan.reason } : {})
          }
        );
        return;
      case "unlock":
        await this.#gitWorktreeCommands.unlockWorktree(
          anchorPath,
          plan.worktreePath,
          options
        );
        return;
      case "move":
        await this.#gitWorktreeCommands.moveWorktree(
          anchorPath,
          plan.worktreePath,
          plan.destination,
          options
        );
        return;
      case "repair":
        await this.#gitWorktreeCommands.repairWorktrees(
          anchorPath,
          plan.worktreePaths,
          options
        );
        return;
      case "prune":
        await this.#gitWorktreeCommands.pruneWorktrees(
          anchorPath,
          options
        );
        return;
      case "remove":
        await this.#gitWorktreeCommands.removeWorktree(
          anchorPath,
          plan.worktreePath,
          options
        );
    }
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
      const oldest = this.#preflights.keys().next()
        .value as string | undefined;
      if (!oldest) {
        return;
      }
      this.#preflights.delete(oldest);
    }
  }

  #nowMs(): number {
    const value = Date.parse(this.#clock());
    if (!Number.isFinite(value)) {
      throw new GitError(
        "INVALID_REQUEST",
        "The Worktree preflight clock returned an invalid timestamp."
      );
    }
    return value;
  }
}

function normalizeWorktreeCommand(
  command: WorktreeCommand
): WorktreeCommand {
  if (
    !command ||
    typeof command !== "object" ||
    typeof command.type !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Worktree commands require a supported type."
    );
  }

  switch (command.type) {
    case "create": {
      const branch = validateOptionalText(
        command.branch,
        "Branch",
        MAX_BRANCH_LENGTH
      );
      const startPoint = validateOptionalText(
        command.startPoint,
        "Start point",
        MAX_REVISION_LENGTH
      );
      return {
        type: "create",
        repositoryId: validateIdentifier(
          command.repositoryId,
          "Repository id"
        ),
        path: validatePathText(command.path, "Worktree path"),
        ...(branch ? { branch } : {}),
        ...(startPoint ? { startPoint } : {})
      };
    }
    case "lock": {
      const reason = validateOptionalText(
        command.reason,
        "Lock reason",
        MAX_LOCK_REASON_LENGTH
      );
      return {
        type: "lock",
        worktreeId: validateIdentifier(
          command.worktreeId,
          "Worktree id"
        ),
        ...(reason ? { reason } : {})
      };
    }
    case "unlock":
    case "repair":
    case "remove":
      return {
        type: command.type,
        worktreeId: validateIdentifier(
          command.worktreeId,
          "Worktree id"
        )
      };
    case "move":
      return {
        type: "move",
        worktreeId: validateIdentifier(
          command.worktreeId,
          "Worktree id"
        ),
        destination: validatePathText(
          command.destination,
          "Worktree destination"
        )
      };
    case "prune":
      return {
        type: "prune",
        repositoryId: validateIdentifier(
          command.repositoryId,
          "Repository id"
        )
      };
    default:
      throw new GitError(
        "INVALID_REQUEST",
        "Unsupported Worktree command."
      );
  }
}

function resolveWorkspaceWorktree(
  workspace: Workspace,
  worktreeId: string
): WorkspaceWorktree {
  const matches = workspace.worktrees.filter(
    (candidate) => candidate.id === worktreeId
  );
  if (matches.length !== 1) {
    throw new GitError(
      "INVALID_REQUEST",
      "The requested Worktree is not uniquely registered in the current Workspace."
    );
  }
  return matches[0] as WorkspaceWorktree;
}

function resolveTargetContext(
  worktreeId: string,
  context: RepositoryContext,
  pathPolicy: WorktreePathPolicy
): {
  target: RepositoryTarget;
  workspaceWorktree: WorkspaceWorktree;
  gitWorktree: Worktree;
} {
  const workspaceWorktree = resolveWorkspaceWorktree(
    context.workspace,
    worktreeId
  );
  if (
    workspaceWorktree.repositoryId !==
    context.repository.id
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "The Worktree does not belong to the requested repository."
    );
  }
  const gitMatches = context.gitWorktrees.filter(
    (candidate) =>
      pathPolicy.normalizePath(candidate.path)
        .canonicalPath === workspaceWorktree.canonicalPath
  );
  if (gitMatches.length !== 1) {
    throw new GitError(
      "PREFLIGHT_CHANGED",
      "The Worktree is no longer registered at its exact Workspace path."
    );
  }
  return {
    target: {
      repositoryId: workspaceWorktree.repositoryId,
      worktreeId: workspaceWorktree.id
    },
    workspaceWorktree,
    gitWorktree: gitMatches[0] as Worktree
  };
}

function findWorkspaceWorktreeByPath(
  workspace: Workspace,
  path: string,
  pathPolicy: WorktreePathPolicy
): WorkspaceWorktree | undefined {
  const canonicalPath =
    pathPolicy.normalizePath(path).canonicalPath;
  return workspace.worktrees.find(
    (worktree) =>
      worktree.canonicalPath === canonicalPath
  );
}

function assertCreateDestination(
  inspection: WorktreePathInspection
): void {
  if (!inspection.exists) {
    return;
  }
  if (
    inspection.kind !== "directory" ||
    !inspection.empty
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Worktree creation requires a missing path or an existing empty non-link directory."
    );
  }
}

function assertLinkedWorktree(
  workspaceWorktree: WorkspaceWorktree,
  gitWorktree: Worktree
): void {
  if (
    workspaceWorktree.isPrimary ||
    gitWorktree.primary
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Primary Worktrees cannot be managed by this linked Worktree command."
    );
  }
  if (workspaceWorktree.isBare || gitWorktree.bare) {
    throw new GitError(
      "INVALID_REQUEST",
      "Bare repositories do not support this Worktree command."
    );
  }
}

function assertMutableLinkedWorktree(
  worktree: Worktree,
  operation: "move" | "remove"
): void {
  if (worktree.locked) {
    throw new GitError(
      "INVALID_REQUEST",
      `Locked Worktrees must be unlocked before ${operation}.`
    );
  }
  if (worktree.prunable) {
    throw new GitError(
      "INVALID_REQUEST",
      `Prunable Worktree registrations must use Prune instead of ${operation}.`
    );
  }
}

function assertCleanSnapshot(
  snapshot: RepositorySnapshot
): void {
  if (
    snapshot.staged > 0 ||
    snapshot.unstaged > 0 ||
    snapshot.untracked > 0 ||
    snapshot.conflicted > 0
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Worktree removal requires a clean, conflict-free Worktree; force removal is not supported."
    );
  }
}

function stableBranches(branches: Branch[]): unknown[] {
  return branches
    .filter((branch) => !branch.remote)
    .map((branch) => ({
      name: branch.name,
      head: branch.head,
      current: branch.current,
      ...(branch.worktreePath
        ? { worktreePath: branch.worktreePath }
        : {})
    }))
    .sort((left, right) =>
      left.name.localeCompare(right.name)
    );
}

function stableSnapshot(
  snapshot: RepositorySnapshot
): Omit<RepositorySnapshot, "refreshedAt"> {
  const { refreshedAt: _refreshedAt, ...stable } = snapshot;
  return stable;
}

function stableGitWorktree(
  worktree: Worktree,
  pathPolicy: WorktreePathPolicy
): Omit<Worktree, "path"> & { path: string } {
  return {
    ...worktree,
    path: pathPolicy.normalizePath(worktree.path)
      .canonicalPath
  };
}

function validateIdentifier(
  value: string,
  label: string
): string {
  return validateText(value, label, MAX_ID_LENGTH);
}

function validatePathText(
  value: string,
  label: string
): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    /[\r\n]/.test(value)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `${label} must be a non-empty single-line path.`
    );
  }
  return value;
}

function validateText(
  value: string,
  label: string,
  maxLength: number
): string {
  if (typeof value !== "string") {
    throw new GitError(
      "INVALID_REQUEST",
      `${label} must be text.`
    );
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maxLength ||
    normalized.includes("\0") ||
    /[\r\n]/.test(normalized)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `${label} must contain 1 to ${maxLength} single-line characters.`
    );
  }
  return normalized;
}

function validateOptionalText(
  value: string | undefined,
  label: string,
  maxLength: number
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new GitError(
      "INVALID_REQUEST",
      `${label} must be text when provided.`
    );
  }
  const normalized = value.trim();
  return normalized
    ? validateText(normalized, label, maxLength)
    : undefined;
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

function signalOptions(
  signal?: AbortSignal
): GitReadOptions {
  return signal ? { signal } : {};
}

function commandKey(command: WorktreeCommand): string {
  return JSON.stringify(command);
}

function operationKind(
  command: WorktreeCommand
): RepositoryOperationKind {
  return `worktree-${command.type}` as RepositoryOperationKind;
}

function planFingerprint(value: unknown): string {
  return JSON.stringify(value, (key, candidate) =>
    key === "refreshedAt" ? undefined : candidate
  );
}

function toPublicPreflight(
  stored: StoredPreflight
): WorktreeCommandPreflight {
  return structuredClone({
    preflightId: stored.preflightId,
    expiresAt: stored.expiresAt,
    command: stored.command,
    targetSummary: stored.plan.targetSummary,
    impacts: stored.plan.impacts,
    warnings: stored.plan.warnings,
    confirmationRequired:
      stored.plan.confirmationRequired
  });
}

function changedPreflightError(
  error: unknown,
  message: string
): GitError {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "COMMAND_CANCELLED"
  ) {
    return error as GitError;
  }
  return new GitError(
    "PREFLIGHT_CHANGED",
    `${message}${
      error instanceof Error && error.message
        ? ` ${error.message}`
        : ""
    }`
  );
}
