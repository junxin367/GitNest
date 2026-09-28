import type { RepositoryTarget } from "../domain/workspace";

export interface WorkspaceWatchRegistration {
  path: string;
  target: RepositoryTarget;
  recursive: boolean;
}

export interface WorkspaceWatchEvent {
  path: string;
  target: RepositoryTarget;
}

export interface WorkspaceWatchHandle {
  close(): void | Promise<void>;
}

export interface WorkspaceWatcher {
  watch(
    registrations: WorkspaceWatchRegistration[],
    onChange: (event: WorkspaceWatchEvent) => void,
    onError: (error: Error) => void
  ): Promise<WorkspaceWatchHandle>;
}
