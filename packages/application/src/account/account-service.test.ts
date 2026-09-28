import { describe, expect, it } from "vitest";

import {
  ACCOUNT_METADATA_SCHEMA_VERSION,
  AccountService,
  type AccountAuthenticationBrokerPort,
  type AccountConnectionTesterPort,
  type AccountMetadata,
  type AccountMetadataStore,
  type CredentialVaultPort,
  type GitAuthenticationSession
} from "./account-service";

const NOW = "2026-09-04T12:00:00.000Z";
const TOKEN = "super-secret-token-测试";

describe("AccountService", () => {
  it("stores tokens only in the vault and returns metadata-only summaries", async () => {
    const store = new MemoryAccountStore();
    const vault = new MemoryVault();
    const broker = new FakeBroker();
    const tester = new FakeTester();
    const service = createService(store, vault, broker, tester);

    const account = await service.save({
      provider: "github",
      host: "GitHub.com",
      username: "octocat",
      authType: "https-token",
      token: ` ${TOKEN} `,
      makeHostDefault: true
    });
    const overview = await service.list();

    expect(account).toEqual({
      id: "id_1",
      provider: "github",
      host: "github.com",
      username: "octocat",
      authType: "https-token",
      hasCredential: true,
      verificationStatus: "untested"
    });
    expect(vault.secrets).toEqual(
      new Map([["credential_id_2", TOKEN]])
    );
    expect(overview.bindings).toEqual([
      {
        host: "github.com",
        accountId: "id_1"
      }
    ]);
    expect(JSON.stringify(account)).not.toContain(TOKEN);
    expect(JSON.stringify(overview)).not.toContain(TOKEN);
    expect(JSON.stringify(store.metadata)).not.toContain(TOKEN);
    expect(JSON.stringify(overview)).not.toContain(
      "credential_id_2"
    );
  });

  it("uses repository bindings before host defaults without exposing the secret", async () => {
    const store = new MemoryAccountStore({
      schemaVersion: ACCOUNT_METADATA_SCHEMA_VERSION,
      profiles: [
        {
          id: "default_account",
          provider: "gitlab",
          host: "git.example.test",
          username: "default",
          authType: "https-token",
          credentialRef: "credential_default",
          verificationStatus: "untested"
        },
        {
          id: "repository_account",
          provider: "custom",
          host: "git.example.test",
          username: "repository",
          authType: "https-token",
          credentialRef: "credential_repository",
          verificationStatus: "untested"
        }
      ],
      bindings: [
        {
          host: "git.example.test",
          accountId: "default_account"
        },
        {
          host: "git.example.test",
          accountId: "repository_account",
          repositoryId: "repository_1"
        }
      ],
      updatedAt: NOW
    });
    const vault = new MemoryVault([
      ["credential_default", "default-token"],
      ["credential_repository", "repository-token"]
    ]);
    const broker = new FakeBroker();
    const service = createService(
      store,
      vault,
      broker,
      new FakeTester()
    );

    const repositorySession =
      await service.openAuthenticationSession(
        "repository_1",
        "https://git.example.test/team/repository.git"
      );
    const defaultSession =
      await service.openAuthenticationSession(
        "repository_2",
        "https://git.example.test/team/repository.git"
      );

    expect(broker.opens).toEqual([
      {
        host: "git.example.test",
        username: "repository",
        secret: "repository-token"
      },
      {
        host: "git.example.test",
        username: "default",
        secret: "default-token"
      }
    ]);
    expect(
      JSON.stringify(repositorySession?.environment)
    ).not.toContain("repository-token");
    expect(
      JSON.stringify(defaultSession?.environment)
    ).not.toContain("default-token");
    await repositorySession?.dispose();
    await defaultSession?.dispose();
  });

  it("keeps system SSH on the system path and validates test protocols", async () => {
    const store = new MemoryAccountStore();
    const broker = new FakeBroker();
    const tester = new FakeTester("verified");
    const service = createService(
      store,
      new MemoryVault(),
      broker,
      tester
    );
    const account = await service.save({
      provider: "custom",
      host: "git.example.test",
      username: "git",
      authType: "system-ssh",
      makeHostDefault: true
    });

    await expect(
      service.test(
        account.id,
        "git@git.example.test:team/repository.git"
      )
    ).resolves.toMatchObject({
      status: "verified"
    });
    expect(tester.tests[0]).toEqual({
      repositoryUrl:
        "git@git.example.test:team/repository.git",
      environment: {}
    });
    expect(broker.opens).toEqual([]);

    await expect(
      service.test(
        account.id,
        "https://git.example.test/team/repository.git"
      )
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
  });

  it("tests HTTPS access through a disposable token-free session and records status", async () => {
    const store = new MemoryAccountStore();
    const vault = new MemoryVault();
    const broker = new FakeBroker();
    const tester = new FakeTester("permission-denied");
    const service = createService(store, vault, broker, tester);
    const account = await service.save({
      provider: "gitee",
      host: "gitee.example.test",
      username: "user",
      authType: "https-token",
      token: TOKEN
    });

    const result = await service.test(
      account.id,
      "https://gitee.example.test/team/repository.git"
    );
    const overview = await service.list();

    expect(result).toEqual({
      accountId: account.id,
      status: "permission-denied",
      message:
        "The account authenticated but lacks repository access.",
      verifiedAt: NOW
    });
    expect(tester.tests[0]?.repositoryUrl).toBe(
      "https://gitee.example.test/team/repository.git"
    );
    expect(
      JSON.stringify(tester.tests[0]?.environment)
    ).not.toContain(TOKEN);
    expect(broker.disposals).toBe(1);
    expect(overview.accounts[0]).toMatchObject({
      verificationStatus: "permission-denied",
      lastVerifiedAt: NOW
    });
  });

  it("requires confirmation and reports every binding before account removal", async () => {
    const store = new MemoryAccountStore();
    const vault = new MemoryVault();
    const service = createService(
      store,
      vault,
      new FakeBroker(),
      new FakeTester()
    );
    const account = await service.save({
      provider: "github",
      host: "github.example.test",
      authType: "https-token",
      token: TOKEN,
      makeHostDefault: true
    });
    await service.bind({
      accountId: account.id,
      repositoryId: "repository_1"
    });

    await expect(
      service.remove(account.id, false)
    ).rejects.toMatchObject({
      code: "CONFIRMATION_REQUIRED"
    });
    await expect(
      service.getRemovalImpact(account.id)
    ).resolves.toEqual({
      accountId: account.id,
      host: "github.example.test",
      repositoryIds: ["repository_1"],
      hostDefault: true
    });
    await expect(
      service.remove(account.id, true)
    ).resolves.toMatchObject({
      repositoryIds: ["repository_1"],
      hostDefault: true
    });
    expect((await service.list()).accounts).toEqual([]);
    expect(vault.secrets.size).toBe(0);
  });

  it("restores account metadata when protected credential deletion fails", async () => {
    const store = new MemoryAccountStore();
    const vault = new MemoryVault();
    const service = createService(
      store,
      vault,
      new FakeBroker(),
      new FakeTester()
    );
    const account = await service.save({
      provider: "github",
      host: "github.example.test",
      authType: "https-token",
      token: TOKEN,
      makeHostDefault: true
    });
    vault.failDelete = true;

    await expect(
      service.remove(account.id, true)
    ).rejects.toThrow("Vault deletion failed.");
    await expect(service.list()).resolves.toMatchObject({
      accounts: [
        {
          id: account.id
        }
      ],
      bindings: [
        {
          accountId: account.id
        }
      ]
    });
  });
});

class MemoryAccountStore implements AccountMetadataStore {
  metadata: AccountMetadata | null;

  constructor(metadata: AccountMetadata | null = null) {
    this.metadata = metadata
      ? structuredClone(metadata)
      : null;
  }

  async load(): Promise<AccountMetadata | null> {
    return this.metadata
      ? structuredClone(this.metadata)
      : null;
  }

  async save(metadata: AccountMetadata): Promise<void> {
    this.metadata = structuredClone(metadata);
  }
}

class MemoryVault implements CredentialVaultPort {
  readonly secrets: Map<string, string>;
  failDelete = false;

  constructor(entries: Array<[string, string]> = []) {
    this.secrets = new Map(entries);
  }

  async save(
    credentialRef: string,
    secret: string
  ): Promise<void> {
    this.secrets.set(credentialRef, secret);
  }

  async read(credentialRef: string): Promise<string> {
    const value = this.secrets.get(credentialRef);
    if (!value) {
      throw new Error("Credential unavailable.");
    }
    return value;
  }

  async delete(credentialRef: string): Promise<void> {
    if (this.failDelete) {
      throw new Error("Vault deletion failed.");
    }
    this.secrets.delete(credentialRef);
  }
}

class FakeBroker implements AccountAuthenticationBrokerPort {
  readonly opens: Array<{
    host: string;
    username?: string;
    secret: string;
  }> = [];
  disposals = 0;

  async open(input: {
    host: string;
    username?: string;
    secret: string;
  }): Promise<GitAuthenticationSession> {
    this.opens.push({
      host: input.host,
      ...(input.username
        ? { username: input.username }
        : {}),
      secret: input.secret
    });
    return {
      environment: {
        GIT_ASKPASS: "C:\\GitNest\\askpass.cmd",
        GITNEST_ASKPASS_ENDPOINT:
          "http://127.0.0.1:54321/",
        GITNEST_ASKPASS_NONCE: "nonce"
      },
      dispose: async () => {
        this.disposals += 1;
      }
    };
  }
}

class FakeTester implements AccountConnectionTesterPort {
  readonly tests: Array<{
    repositoryUrl: string;
    environment: Readonly<
      Record<string, string | undefined>
    >;
  }> = [];

  constructor(
    readonly status:
      | "verified"
      | "authentication-failed"
      | "permission-denied"
      | "unavailable" = "verified"
  ) {}

  async test(input: {
    repositoryUrl: string;
    environment: Readonly<
      Record<string, string | undefined>
    >;
  }): Promise<
    | "verified"
    | "authentication-failed"
    | "permission-denied"
    | "unavailable"
  > {
    this.tests.push({
      repositoryUrl: input.repositoryUrl,
      environment: structuredClone(input.environment)
    });
    return this.status;
  }
}

function createService(
  store: AccountMetadataStore,
  vault: CredentialVaultPort,
  broker: AccountAuthenticationBrokerPort,
  tester: AccountConnectionTesterPort
): AccountService {
  let sequence = 0;
  return new AccountService(
    store,
    vault,
    broker,
    tester,
    {
      clock: () => NOW,
      idFactory: () => `id_${++sequence}`
    }
  );
}
