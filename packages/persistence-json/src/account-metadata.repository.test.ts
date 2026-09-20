import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  afterEach,
  describe,
  expect,
  it
} from "vitest";

import {
  ACCOUNT_METADATA_SCHEMA_VERSION,
  type AccountMetadata
} from "@gitnest/application";

import { JsonAccountMetadataStore } from "./account-metadata.repository";

const TOKEN = "must-never-enter-account-json";

describe("JsonAccountMetadataStore", () => {
  const temporaryPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryPaths.map((path) =>
        rm(path, { recursive: true, force: true })
      )
    );
  });

  it("round-trips metadata without credential contents", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "gitnest-account-metadata-")
    );
    temporaryPaths.push(directory);
    const filePath = join(directory, "accounts.json");
    const store = new JsonAccountMetadataStore(filePath);
    const metadata = createMetadata();

    await store.save(metadata);
    await expect(store.load()).resolves.toEqual(metadata);

    const raw = await readFile(filePath, "utf8");
    expect(raw).toContain("credential_reference");
    expect(raw).not.toContain(TOKEN);
    expect(raw).not.toMatch(
      /"(?:token|secret|password|privateKey)"\s*:/
    );
  });

  it("removes unknown plaintext secret fields from current schema documents", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "gitnest-account-metadata-")
    );
    temporaryPaths.push(directory);
    const filePath = join(directory, "accounts.json");
    const store = new JsonAccountMetadataStore(filePath);
    await writeFile(
      filePath,
      JSON.stringify({
        ...createMetadata(),
        apiKey: TOKEN,
        token: TOKEN,
        credential: TOKEN,
        profiles: createMetadata().profiles.map((profile) => ({
          ...profile,
          apiKey: TOKEN,
          token: TOKEN,
          credential: TOKEN
        }))
      }),
      "utf8"
    );

    await expect(store.load()).resolves.toEqual(createMetadata());
    const persisted = await readFile(filePath, "utf8");
    expect(persisted).not.toContain(TOKEN);
    expect(persisted).not.toMatch(
      /"(?:apiKey|token|credential)"\s*:/
    );
  });

  it("rejects credential references owned by another secret domain", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "gitnest-account-metadata-")
    );
    temporaryPaths.push(directory);
    const filePath = join(directory, "accounts.json");
    const store = new JsonAccountMetadataStore(filePath);
    const metadata = createMetadata();
    metadata.profiles[0] = {
      ...metadata.profiles[0]!,
      credentialRef: "settings_ai_api_key_shared"
    };
    await writeFile(
      filePath,
      JSON.stringify(metadata),
      "utf8"
    );

    await expect(store.load()).rejects.toMatchObject({
      code: "INVALID_PERSISTED_DATA"
    });
  });

  it("refuses to save credential references outside the account namespace", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "gitnest-account-metadata-")
    );
    temporaryPaths.push(directory);
    const filePath = join(directory, "accounts.json");
    const store = new JsonAccountMetadataStore(filePath);
    const metadata = createMetadata();
    metadata.profiles[0] = {
      ...metadata.profiles[0]!,
      credentialRef: "settings_ai_api_key_shared"
    };

    await expect(store.save(metadata)).rejects.toMatchObject({
      code: "INVALID_PERSISTED_DATA"
    });
    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("migrates v0 profiles to explicit verification state and persists only whitelisted fields", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "gitnest-account-metadata-")
    );
    temporaryPaths.push(directory);
    const filePath = join(directory, "accounts.json");
    const legacy = createMetadata() as unknown as Record<
      string,
      unknown
    >;
    legacy.schemaVersion = 0;
    legacy.unknownLegacyField = true;
    const profiles = legacy.profiles as Array<
      Record<string, unknown>
    >;
    delete profiles[0]?.verificationStatus;
    await writeFile(
      filePath,
      JSON.stringify(legacy),
      "utf8"
    );

    await expect(
      new JsonAccountMetadataStore(filePath).load()
    ).resolves.toMatchObject({
      schemaVersion: 1,
      profiles: [
        {
          verificationStatus: "untested"
        }
      ]
    });
    const persisted = JSON.parse(
      await readFile(filePath, "utf8")
    );
    expect(persisted.schemaVersion).toBe(1);
    expect(persisted.unknownLegacyField).toBeUndefined();
  });
});

function createMetadata(): AccountMetadata {
  return {
    schemaVersion: ACCOUNT_METADATA_SCHEMA_VERSION,
    profiles: [
      {
        id: "account_1",
        provider: "github",
        host: "github.example.test",
        username: "user",
        authType: "https-token",
        credentialRef: "credential_reference",
        verificationStatus: "untested"
      }
    ],
    bindings: [
      {
        host: "github.example.test",
        accountId: "account_1"
      }
    ],
    updatedAt: "2026-09-04T12:00:00.000Z"
  };
}
