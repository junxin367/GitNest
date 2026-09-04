import { GitError } from "@gitnest/git-core";
import {
  listWorkspaceTargets,
  repositoryTargetKey,
  type RepositoryTarget,
  type Workspace
} from "@gitnest/workspace-core";

export type ExternalTerminalKind =
  | "windows-terminal"
  | "powershell"
  | "cmd"
  | "git-bash";

export interface ExternalTerminalProfile {
  kind: ExternalTerminalKind;
  label: string;
  executablePath: string;
}

export interface ExternalTerminalPort {
  listAvailable(): Promise<ExternalTerminalProfile[]>;
  launch(
    profile: ExternalTerminalProfile,
    workingDirectory: string
  ): Promise<void>;
}

export interface ExternalTerminalWorkspace {
  getCurrent(): Promise<Workspace>;
}

export interface ExternalTerminalOpened {
  kind: ExternalTerminalKind;
  label: string;
  target: RepositoryTarget;
}

export class ExternalTerminalService {
  readonly #workspace: ExternalTerminalWorkspace;
  readonly #terminal: ExternalTerminalPort;

  constructor(
    workspace: ExternalTerminalWorkspace,
    terminal: ExternalTerminalPort
  ) {
    this.#workspace = workspace;
    this.#terminal = terminal;
  }

  listAvailable(): Promise<ExternalTerminalProfile[]> {
    return this.#terminal.listAvailable();
  }

  async open(
    target: RepositoryTarget,
    kind: ExternalTerminalKind
  ): Promise<ExternalTerminalOpened> {
    const normalizedTarget = validateTarget(target);
    const workspace = await this.#workspace.getCurrent();
    const key = repositoryTargetKey(normalizedTarget);
    if (
      !listWorkspaceTargets(workspace).some(
        (candidate) => repositoryTargetKey(candidate) === key
      )
    ) {
      throw new GitError(
        "INVALID_REQUEST",
        "External terminals require a registered RepositoryTarget."
      );
    }

    const worktree = workspace.worktrees.find(
      (candidate) =>
        candidate.id === normalizedTarget.worktreeId &&
        candidate.repositoryId ===
          normalizedTarget.repositoryId
    );
    if (!worktree || worktree.isBare) {
      throw new GitError(
        "INVALID_REQUEST",
        "External terminals require a non-bare Worktree."
      );
    }

    const profiles = await this.#terminal.listAvailable();
    const profile = profiles.find(
      (candidate) => candidate.kind === kind
    );
    if (!profile) {
      throw new GitError(
        "INVALID_REQUEST",
        "The requested external terminal is unavailable."
      );
    }

    await this.#terminal.launch(profile, worktree.path);
    return {
      kind: profile.kind,
      label: profile.label,
      target: normalizedTarget
    };
  }
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
