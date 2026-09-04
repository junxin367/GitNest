import type { Workspace } from "../domain/workspace";

export interface WorkspaceStore {
  load(): Promise<Workspace | null>;
  save(workspace: Workspace): Promise<void>;
}
