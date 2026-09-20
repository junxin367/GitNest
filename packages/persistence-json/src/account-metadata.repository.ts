import type {
  AccountMetadata,
  AccountMetadataStore
} from "@gitnest/application";

import { AtomicJsonStore } from "./atomic-json-store";
import {
  migrateAccountMetadataDocument
} from "./migrations/account-metadata-document";

const MAX_ACCOUNT_METADATA_DOCUMENT_BYTES =
  4 * 1_024 * 1_024;

export class JsonAccountMetadataStore
  implements AccountMetadataStore
{
  readonly #store: AtomicJsonStore;

  constructor(filePath: string) {
    this.#store = new AtomicJsonStore(filePath, {
      maxBytes: MAX_ACCOUNT_METADATA_DOCUMENT_BYTES
    });
  }

  async load(): Promise<AccountMetadata | null> {
    const value = await this.#store.read();
    if (value === null) {
      return null;
    }
    try {
      const migrated =
        migrateAccountMetadataDocument(value);
      if (!documentsMatch(value, migrated)) {
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

  async save(metadata: AccountMetadata): Promise<void> {
    await this.#store.write(
      migrateAccountMetadataDocument(metadata)
    );
  }
}

function documentsMatch(
  value: unknown,
  migrated: AccountMetadata
): boolean {
  return JSON.stringify(value) === JSON.stringify(migrated);
}
