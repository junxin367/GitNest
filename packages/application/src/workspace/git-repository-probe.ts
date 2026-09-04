import type { GitClient } from "@gitnest/git-core";
import type {
  RepositoryProbe,
  RepositoryProbeResult
} from "@gitnest/workspace-core";

export class GitRepositoryProbe implements RepositoryProbe {
  readonly #gitClient: GitClient;

  constructor(gitClient: GitClient) {
    this.#gitClient = gitClient;
  }

  async inspectRepository(
    path: string,
    signal?: AbortSignal
  ): Promise<RepositoryProbeResult> {
    const inspection = await this.#gitClient.inspectRepository(path, {
      historyLimit: 1,
      ...(signal ? { signal } : {})
    });

    return {
      worktreePath: inspection.identity.worktreePath,
      gitDir: inspection.identity.gitDir,
      commonDir: inspection.identity.commonDir,
      head: inspection.identity.head,
      ...(inspection.snapshot.branch
        ? { branch: inspection.snapshot.branch }
        : {}),
      worktrees: inspection.worktrees.map((worktree) => ({
        path: worktree.path,
        head: worktree.head,
        ...(worktree.branch
          ? { branch: worktree.branch }
          : {}),
        ...(worktree.path === inspection.identity.worktreePath
          ? { gitDir: inspection.identity.gitDir }
          : {}),
        primary: worktree.primary,
        bare: worktree.bare,
        detached: worktree.detached,
        locked: worktree.locked,
        ...(worktree.lockReason
          ? { lockReason: worktree.lockReason }
          : {}),
        prunable: worktree.prunable,
        ...(worktree.pruneReason
          ? { pruneReason: worktree.pruneReason }
          : {})
      }))
    };
  }
}
