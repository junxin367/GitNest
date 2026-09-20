import type {
  Workspace,
  WorkspaceCatalog
} from "../domain/workspace";

export interface WorkspaceCollectionStore {
  loadCatalog(): Promise<WorkspaceCatalog | null>;
  saveCatalog(catalog: WorkspaceCatalog): Promise<void>;
  loadWorkspace(workspaceId: string): Promise<Workspace | null>;
  saveWorkspace(workspace: Workspace): Promise<void>;
  deleteWorkspace(workspaceId: string): Promise<void>;
}
