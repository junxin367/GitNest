import { GitError } from "@gitnest/git-core";
import {
  listWorkspaceTargets,
  repositoryTargetKey,
  type RepositoryTarget,
  type Workspace
} from "@gitnest/workspace-core";

import type { ExternalTerminalKind } from "../terminal/external-terminal-service";

export type ExternalApplicationKind =
  | "vscode"
  | "cursor"
  | "intellij-idea"
  | "sublime-text"
  | "file-explorer"
  | "terminal"
  | "git-bash";

export type ExternalApplicationContext =
  | {
      scope: "workspace";
    }
  | {
      scope: "repository";
      target: RepositoryTarget;
    }
  | {
      scope: "file";
      target: RepositoryTarget;
      path: string;
    };

export interface ExternalApplicationProfile {
  kind: ExternalApplicationKind;
  label: string;
  executablePath?: string;
  terminalKind?: ExternalTerminalKind;
  iconDataUrl?: string;
}

export interface ExternalApplicationPort {
  listAvailable(): Promise<ExternalApplicationProfile[]>;
  launch(
    profile: ExternalApplicationProfile,
    workingDirectory: string,
    filePath?: string
  ): Promise<void>;
}

export interface ExternalApplicationWorkspace {
  getCurrent(): Promise<Workspace>;
}

export interface ExternalApplicationOpened {
  kind: ExternalApplicationKind;
  label: string;
  scope: ExternalApplicationContext["scope"];
}

export class ExternalApplicationService {
  readonly #workspace: ExternalApplicationWorkspace;
  readonly #applications: ExternalApplicationPort;

  constructor(
    workspace: ExternalApplicationWorkspace,
    applications: ExternalApplicationPort
  ) {
    this.#workspace = workspace;
    this.#applications = applications;
  }

  listAvailable(): Promise<ExternalApplicationProfile[]> {
    return this.#applications.listAvailable();
  }

  async open(
    context: ExternalApplicationContext,
    kind: ExternalApplicationKind
  ): Promise<ExternalApplicationOpened> {
    const workspace = await this.#workspace.getCurrent();
    const launchTarget = resolveLaunchTarget(
      workspace,
      context
    );
    const profiles = await this.#applications.listAvailable();
    const profile = profiles.find(
      (candidate) => candidate.kind === kind
    );
    if (!profile) {
      throw new GitError(
        "INVALID_REQUEST",
        "The requested external application is unavailable."
      );
    }

    await this.#applications.launch(
      profile,
      launchTarget.workingDirectory,
      launchTarget.filePath
    );
    return {
      kind: profile.kind,
      label: profile.label,
      scope: context.scope
    };
  }
}

interface ExternalApplicationLaunchTarget {
  workingDirectory: string;
  filePath?: string;
}

function resolveLaunchTarget(
  workspace: Workspace,
  context: ExternalApplicationContext
): ExternalApplicationLaunchTarget {
  if (context.scope === "workspace") {
    const root =
      workspace.entries.find(
        (entry) => entry.id === workspace.selectedEntryId
      ) ??
      workspace.entries.find(
        (entry) => entry.kind === "workspace-meta-repository"
      ) ?? workspace.entries[0];
    if (!root) {
      throw new GitError(
        "DIRECTORY_UNAVAILABLE",
        "The current Workspace root directory is unavailable."
      );
    }
    return { workingDirectory: root.path };
  }

  const target = validateTarget(context.target);
  const key = repositoryTargetKey(target);
  if (
    !listWorkspaceTargets(workspace).some(
      (candidate) => repositoryTargetKey(candidate) === key
    )
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "External applications require a registered RepositoryTarget."
    );
  }

  const worktree = workspace.worktrees.find(
    (candidate) =>
      candidate.id === target.worktreeId &&
      candidate.repositoryId === target.repositoryId
  );
  if (!worktree || worktree.isBare) {
    throw new GitError(
      "DIRECTORY_UNAVAILABLE",
      "External applications require an available non-bare Worktree."
    );
  }

  if (context.scope === "file") {
    return {
      workingDirectory: worktree.path,
      filePath: validateRelativeWorktreeFilePath(context.path)
    };
  }

  return { workingDirectory: worktree.path };
}

function validateRelativeWorktreeFilePath(path: string): string {
  if (
    !path ||
    path === "." ||
    path.includes("\0") ||
    /^[a-zA-Z]:/.test(path) ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path
      .split(/[\\/]+/)
      .some((segment) => segment === ".." || segment === ".")
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "External applications require an exact relative file path inside the Worktree."
    );
  }

  return path;
}

function validateTarget(
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
