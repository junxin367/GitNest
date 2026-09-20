import type {
  Workspace,
  WorkspaceStore
} from "@gitnest/workspace-core";

import { AtomicJsonStore } from "./atomic-json-store";
import { migrateWorkspaceDocument } from "./migrations/workspace-document";

const MAX_WORKSPACE_DOCUMENT_BYTES = 16 * 1_024 * 1_024;

export class JsonWorkspaceStore implements WorkspaceStore {
  readonly #store: AtomicJsonStore;

  constructor(filePath: string) {
    this.#store = new AtomicJsonStore(filePath, {
      maxBytes: MAX_WORKSPACE_DOCUMENT_BYTES
    });
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
