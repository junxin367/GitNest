export interface RepositoryProbeWorktree {
  path: string;
  head: string;
  branch?: string;
  gitDir?: string;
  primary: boolean;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  lockReason?: string;
  prunable: boolean;
  pruneReason?: string;
}

export interface RepositoryProbeResult {
  worktreePath: string;
  gitDir: string;
  commonDir: string;
  head: string;
  branch?: string;
  worktrees: RepositoryProbeWorktree[];
}

export interface RepositoryProbe {
  inspectRepository(
    path: string,
    signal?: AbortSignal
  ): Promise<RepositoryProbeResult>;
}
