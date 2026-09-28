import type {
  Workspace,
  WorkspaceStore
} from "@gitnest/workspace-core";

export class InMemoryWorkspaceStore implements WorkspaceStore {
  #workspace: Workspace | null;
  saveCount = 0;

  constructor(workspace: Workspace | null = null) {
    this.#workspace = workspace
      ? structuredClone(workspace)
      : null;
  }

  async load(): Promise<Workspace | null> {
    return this.#workspace
      ? structuredClone(this.#workspace)
      : null;
  }

  async save(workspace: Workspace): Promise<void> {
    this.#workspace = structuredClone(workspace);
    this.saveCount += 1;
  }
}
