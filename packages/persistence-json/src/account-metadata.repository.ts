import type {
  AccountMetadata,
  AccountMetadataStore
} from "@gitnest/application";

import { AtomicJsonStore } from "./atomic-json-store";
import {
  migrateAccountMetadataDocument
} from "./migrations/account-metadata-document";

export class JsonAccountMetadataStore
  implements AccountMetadataStore
{
  readonly #store: AtomicJsonStore;

  constructor(filePath: string) {
    this.#store = new AtomicJsonStore(filePath);
  }

  async load(): Promise<AccountMetadata | null> {
    const value = await this.#store.read();
    if (value === null) {
      return null;
    }
    try {
      const migrated =
        migrateAccountMetadataDocument(value);
      if (readSchemaVersion(value) !== migrated.schemaVersion) {
        await this.#store.write(migrated);
      }
      return migrated;
    } catch (error) {
      this.#store.blockWrites(
        "Account metadata schema validation or migration failed."
      );
      throw error;
    }
  }

  save(metadata: AccountMetadata): Promise<void> {
    return this.#store.write(metadata);
  }
}

function readSchemaVersion(value: unknown): unknown {
  return value &&
    typeof value === "object" &&
    "schemaVersion" in value
    ? value.schemaVersion
    : undefined;
}
