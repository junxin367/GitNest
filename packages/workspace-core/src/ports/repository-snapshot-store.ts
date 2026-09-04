import type { RepositoryStatusSnapshot } from "../domain/repository-status";

export interface RepositorySnapshotStore {
  load(workspaceId: string): Promise<RepositoryStatusSnapshot[]>;
  save(
    workspaceId: string,
    snapshots: RepositoryStatusSnapshot[]
  ): Promise<void>;
}
