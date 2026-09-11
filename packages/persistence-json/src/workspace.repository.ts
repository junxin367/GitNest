import type {
  Workspace,
  WorkspaceStore
} from "@gitnest/workspace-core";

import { AtomicJsonStore } from "./atomic-json-store";
import { migrateWorkspaceDocument } from "./migrations/workspace-document";

export class JsonWorkspaceStore implements WorkspaceStore {
  readonly #store: AtomicJsonStore;

  constructor(filePath: string) {
    this.#store = new AtomicJsonStore(filePath);
  }

  async load(): Promise<Workspace | null> {
    const value = await this.#store.read();
    if (value === null) {
      return null;
    }
    try {
      const migrated = migrateWorkspaceDocument(value);
      if (
        readSchemaVersion(value) !== migrated.schemaVersion ||
        JSON.stringify(value) !== JSON.stringify(migrated)
      ) {
        await this.#store.write(migrated);
      }
      return migrated;
    } catch (error) {
      this.#store.blockWrites(
        "Workspace schema validation or migration failed."
      );
      throw error;
    }
  }

  save(workspace: Workspace): Promise<void> {
    return this.#store.write(workspace);
  }
}

function readSchemaVersion(value: unknown): unknown {
  return value &&
    typeof value === "object" &&
    "schemaVersion" in value
    ? value.schemaVersion
    : undefined;
}
