import { GitError } from "@gitnest/git-core";

export const ACCOUNT_METADATA_SCHEMA_VERSION = 1;

export type AccountProvider =
  | "github"
  | "gitlab"
  | "gitee"
  | "custom";

export type AccountAuthType =
  | "https-token"
  | "system-ssh";

export type AccountVerificationStatus =
  | "untested"
  | "verified"
  | "authentication-failed"
  | "permission-denied"
  | "unavailable";

export interface AccountProfile {
  id: string;
  provider: AccountProvider;
  host: string;
  username?: string;
  authType: AccountAuthType;
  credentialRef?: string;
  verificationStatus: AccountVerificationStatus;
  lastVerifiedAt?: string;
}

export interface RepositoryAccountBinding {
  host: string;
  accountId: string;
  repositoryId?: string;
}

export interface AccountMetadata {
  schemaVersion: typeof ACCOUNT_METADATA_SCHEMA_VERSION;
  profiles: AccountProfile[];
  bindings: RepositoryAccountBinding[];
  updatedAt: string;
}

export interface AccountProfileSummary {
  id: string;
  provider: AccountProvider;
  host: string;
  username?: string;
  authType: AccountAuthType;
  hasCredential: boolean;
  verificationStatus: AccountVerificationStatus;
  lastVerifiedAt?: string;
}

export interface AccountOverview {
  accounts: AccountProfileSummary[];
  bindings: RepositoryAccountBinding[];
}

export interface SaveAccountInput {
  id?: string;
  provider: AccountProvider;
  host: string;
  username?: string;
  authType: AccountAuthType;
  token?: string;
  makeHostDefault?: boolean;
}

export interface BindAccountInput {
  accountId: string;
  repositoryId?: string;
}

export interface AccountRemovalImpact {
  accountId: string;
  host: string;
  repositoryIds: string[];
  hostDefault: boolean;
}

export interface AccountConnectionTestResult {
  accountId: string;
  status: Exclude<AccountVerificationStatus, "untested">;
  message: string;
  verifiedAt: string;
}

export interface AccountMetadataStore {
  load(): Promise<AccountMetadata | null>;
  save(metadata: AccountMetadata): Promise<void>;
}

export interface CredentialVaultPort {
  save(credentialRef: string, secret: string): Promise<void>;
  read(credentialRef: string): Promise<string>;
  delete(credentialRef: string): Promise<void>;
}

export interface GitAuthenticationSession {
  environment: Readonly<
    Record<string, string | undefined>
  >;
  dispose(): Promise<void>;
}

export interface AccountAuthenticationBrokerPort {
  open(input: {
    host: string;
    username?: string;
    secret: string;
    signal?: AbortSignal;
  }): Promise<GitAuthenticationSession>;
}

export interface AccountConnectionTesterPort {
  test(input: {
    repositoryUrl: string;
    environment: Readonly<
      Record<string, string | undefined>
    >;
    signal?: AbortSignal;
  }): Promise<
    Exclude<AccountVerificationStatus, "untested">
  >;
}

export interface AccountServiceOptions {
  clock?: () => string;
  idFactory?: () => string;
}

export class AccountService {
  readonly #store: AccountMetadataStore;
  readonly #vault: CredentialVaultPort;
  readonly #broker: AccountAuthenticationBrokerPort;
  readonly #tester: AccountConnectionTesterPort;
  readonly #clock: () => string;
  readonly #idFactory: () => string;
  #mutationTail: Promise<void> = Promise.resolve();
  #sequence = 0;

  constructor(
    store: AccountMetadataStore,
    vault: CredentialVaultPort,
    broker: AccountAuthenticationBrokerPort,
    tester: AccountConnectionTesterPort,
    options: AccountServiceOptions = {}
  ) {
    this.#store = store;
    this.#vault = vault;
    this.#broker = broker;
    this.#tester = tester;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#idFactory =
      options.idFactory ??
      (() =>
        `account_${Date.now()}_${++this.#sequence}_${Math.random()
          .toString(36)
          .slice(2, 10)}`);
  }

  async list(): Promise<AccountOverview> {
    await this.#mutationTail;
    return toOverview(await this.#load());
  }

  save(input: SaveAccountInput): Promise<AccountProfileSummary> {
    return this.#mutate(async () => {
      const normalized = normalizeSaveInput(input);
      const metadata = await this.#load();
      const existing = normalized.id
        ? requireAccount(metadata, normalized.id)
        : undefined;
      const accountId = existing?.id ?? this.#idFactory();
      validateIdentifier(accountId, "Account");
      const oldCredentialRef = existing?.credentialRef;
      let newCredentialRef: string | undefined;

      if (normalized.authType === "https-token") {
        if (normalized.token) {
          newCredentialRef = `credential_${this.#idFactory()}`;
          validateIdentifier(newCredentialRef, "Credential");
          await this.#vault.save(
            newCredentialRef,
            normalized.token
          );
        } else if (
          existing?.authType === "https-token" &&
          existing.credentialRef
        ) {
          newCredentialRef = existing.credentialRef;
        } else {
          throw new GitError(
            "INVALID_REQUEST",
            "A token is required for a new HTTPS account."
          );
        }
      }

      const profile: AccountProfile = {
        id: accountId,
        provider: normalized.provider,
        host: normalized.host,
        ...(normalized.username
          ? { username: normalized.username }
          : {}),
        authType: normalized.authType,
        ...(newCredentialRef
          ? { credentialRef: newCredentialRef }
          : {}),
        verificationStatus: "untested"
      };
      const next: AccountMetadata = {
        ...metadata,
        profiles: [
          ...metadata.profiles.filter(
            (candidate) => candidate.id !== accountId
          ),
          profile
        ].sort(compareAccounts),
        bindings: normalizeBindings([
          ...metadata.bindings.filter(
            (binding) =>
              binding.accountId !== accountId ||
              binding.host === normalized.host
          ),
          ...(normalized.makeHostDefault
            ? [
                {
                  host: normalized.host,
                  accountId
                }
              ]
            : [])
        ]),
        updatedAt: this.#now()
      };

      try {
        await this.#store.save(next);
      } catch (error) {
        if (
          newCredentialRef &&
          newCredentialRef !== oldCredentialRef
        ) {
          await this.#vault
            .delete(newCredentialRef)
            .catch(() => undefined);
        }
        throw error;
      }

      if (
        oldCredentialRef &&
        oldCredentialRef !== newCredentialRef
      ) {
        await this.#vault
          .delete(oldCredentialRef)
          .catch(() => undefined);
      }
      return toSummary(profile);
    });
  }

  bind(input: BindAccountInput): Promise<AccountOverview> {
    return this.#mutate(async () => {
      const metadata = await this.#load();
      const account = requireAccount(
        metadata,
        validateIdentifier(input.accountId, "Account")
      );
      const repositoryId = input.repositoryId
        ? validateIdentifier(input.repositoryId, "Repository")
        : undefined;
      const next: AccountMetadata = {
        ...metadata,
        bindings: normalizeBindings([
          ...metadata.bindings.filter(
            (binding) =>
              !(
                binding.host === account.host &&
                binding.repositoryId === repositoryId
              )
          ),
          {
            host: account.host,
            accountId: account.id,
            ...(repositoryId ? { repositoryId } : {})
          }
        ]),
        updatedAt: this.#now()
      };
      await this.#store.save(next);
      return toOverview(next);
    });
  }

  unbind(input: {
    host: string;
    repositoryId?: string;
  }): Promise<AccountOverview> {
    return this.#mutate(async () => {
      const metadata = await this.#load();
      const host = normalizeHost(input.host);
      const repositoryId = input.repositoryId
        ? validateIdentifier(input.repositoryId, "Repository")
        : undefined;
      const next: AccountMetadata = {
        ...metadata,
        bindings: metadata.bindings.filter(
          (binding) =>
            !(
              binding.host === host &&
              binding.repositoryId === repositoryId
            )
        ),
        updatedAt: this.#now()
      };
      await this.#store.save(next);
      return toOverview(next);
    });
  }

  async getRemovalImpact(
    accountId: string
  ): Promise<AccountRemovalImpact> {
    await this.#mutationTail;
    const metadata = await this.#load();
    const account = requireAccount(
      metadata,
      validateIdentifier(accountId, "Account")
    );
    return removalImpact(metadata, account);
  }

  remove(
    accountId: string,
    confirmed: boolean
  ): Promise<AccountRemovalImpact> {
    return this.#mutate(async () => {
      if (!confirmed) {
        throw new GitError(
          "CONFIRMATION_REQUIRED",
          "Removing an account requires explicit confirmation."
        );
      }
      const metadata = await this.#load();
      const account = requireAccount(
        metadata,
        validateIdentifier(accountId, "Account")
      );
      const impact = removalImpact(metadata, account);
      const next: AccountMetadata = {
        ...metadata,
        profiles: metadata.profiles.filter(
          (candidate) => candidate.id !== account.id
        ),
        bindings: metadata.bindings.filter(
          (binding) => binding.accountId !== account.id
        ),
        updatedAt: this.#now()
      };
      await this.#store.save(next);
      if (account.credentialRef) {
        try {
          await this.#vault.delete(account.credentialRef);
        } catch (error) {
          await this.#store
            .save(metadata)
            .catch(() => undefined);
          throw error;
        }
      }
      return impact;
    });
  }

  async test(
    accountId: string,
    repositoryUrl: string,
    signal?: AbortSignal
  ): Promise<AccountConnectionTestResult> {
    await this.#mutationTail;
    const metadata = await this.#load();
    const account = requireAccount(
      metadata,
      validateIdentifier(accountId, "Account")
    );
    const url = normalizeRepositoryUrl(
      repositoryUrl,
      account
    );
    const session = await this.#openAccountSession(
      account,
      signal
    );
    let status: Exclude<
      AccountVerificationStatus,
      "untested"
    >;
    try {
      status = await this.#tester.test({
        repositoryUrl: url,
        environment: session?.environment ?? {},
        ...(signal ? { signal } : {})
      });
    } finally {
      await session?.dispose();
    }

    const verifiedAt = this.#now();
    await this.#mutate(async () => {
      const latest = await this.#load();
      requireAccount(latest, account.id);
      await this.#store.save({
        ...latest,
        profiles: latest.profiles.map((candidate) =>
          candidate.id === account.id
            ? {
                ...candidate,
                verificationStatus: status,
                lastVerifiedAt: verifiedAt
              }
            : candidate
        ),
        updatedAt: verifiedAt
      });
    });
    return {
      accountId: account.id,
      status,
      message: verificationMessage(status),
      verifiedAt
    };
  }

  async openAuthenticationSession(
    repositoryId: string,
    remoteUrl: string,
    signal?: AbortSignal
  ): Promise<GitAuthenticationSession | undefined> {
    await this.#mutationTail;
    const remote = parseRemoteUrl(remoteUrl);
    if (!remote || remote.protocol !== "https:") {
      return undefined;
    }
    const metadata = await this.#load();
    const normalizedRepositoryId = validateIdentifier(
      repositoryId,
      "Repository"
    );
    const binding =
      metadata.bindings.find(
        (candidate) =>
          candidate.host === remote.host &&
          candidate.repositoryId === normalizedRepositoryId
      ) ??
      metadata.bindings.find(
        (candidate) =>
          candidate.host === remote.host &&
          !candidate.repositoryId
      );
    if (!binding) {
      return undefined;
    }
    return this.#openAccountSession(
      requireAccount(metadata, binding.accountId),
      signal
    );
  }

  async #openAccountSession(
    account: AccountProfile,
    signal?: AbortSignal
  ): Promise<GitAuthenticationSession | undefined> {
    if (account.authType === "system-ssh") {
      return undefined;
    }
    if (!account.credentialRef) {
      throw new GitError(
        "AUTHENTICATION_FAILED",
        "The selected account credential is unavailable."
      );
    }
    const secret = await this.#vault.read(
      account.credentialRef
    );
    if (!secret) {
      throw new GitError(
        "AUTHENTICATION_FAILED",
        "The selected account credential is unavailable."
      );
    }
    return this.#broker.open({
      host: account.host,
      ...(account.username
        ? { username: account.username }
        : {}),
      secret,
      ...(signal ? { signal } : {})
    });
  }

  async #load(): Promise<AccountMetadata> {
    return (
      (await this.#store.load()) ?? {
        schemaVersion: ACCOUNT_METADATA_SCHEMA_VERSION,
        profiles: [],
        bindings: [],
        updatedAt: this.#now()
      }
    );
  }

  #mutate<Result>(
    action: () => Promise<Result>
  ): Promise<Result> {
    const run = this.#mutationTail.then(action, action);
    this.#mutationTail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  #now(): string {
    const value = this.#clock();
    if (!Number.isFinite(Date.parse(value))) {
      throw new Error("Account service clock is invalid.");
    }
    return value;
  }
}

function normalizeSaveInput(
  input: SaveAccountInput
): SaveAccountInput & {
  host: string;
} {
  if (!input || typeof input !== "object") {
    throw new GitError(
      "INVALID_REQUEST",
      "An account profile is required."
    );
  }
  if (
    !["github", "gitlab", "gitee", "custom"].includes(
      input.provider
    ) ||
    !["https-token", "system-ssh"].includes(input.authType)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "The account provider or authentication type is unsupported."
    );
  }
  const username = input.username?.trim();
  if (
    username &&
    (username.length > 255 ||
      username.includes("\0") ||
      /[\r\n]/.test(username))
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Account usernames contain invalid characters."
    );
  }
  const token = input.token?.trim();
  if (
    token &&
    (token.length > 8_192 ||
      token.includes("\0") ||
      /[\r\n]/.test(token))
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "The account token exceeds the supported bounds."
    );
  }
  if (input.authType === "system-ssh" && token) {
    throw new GitError(
      "INVALID_REQUEST",
      "System SSH accounts do not accept tokens."
    );
  }
  if (
    input.id !== undefined &&
    typeof input.id !== "string"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Account ids must be strings."
    );
  }
  if (
    input.makeHostDefault !== undefined &&
    typeof input.makeHostDefault !== "boolean"
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Host default selection must be boolean."
    );
  }

  return {
    ...(input.id
      ? { id: validateIdentifier(input.id, "Account") }
      : {}),
    provider: input.provider,
    host: normalizeHost(input.host),
    ...(username ? { username } : {}),
    authType: input.authType,
    ...(token ? { token } : {}),
    makeHostDefault: input.makeHostDefault ?? false
  };
}

function normalizeHost(value: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 320 ||
    /[\s\0\r\n/@?#]/.test(value)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      "Account hosts must be host names with an optional port."
    );
  }
  try {
    const parsed = new URL(`https://${value.trim()}`);
    if (
      !parsed.hostname ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("Invalid host.");
    }
    return parsed.host.toLocaleLowerCase("en-US");
  } catch {
    throw new GitError(
      "INVALID_REQUEST",
      "Account hosts must be host names with an optional port."
    );
  }
}

function normalizeRepositoryUrl(
  value: string,
  account: AccountProfile
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    const scp = /^(?:[^@\s]+@)?([^:\s]+):(.+)$/.exec(value);
    if (
      account.authType === "system-ssh" &&
      scp?.[1]?.toLocaleLowerCase("en-US") === account.host &&
      scp[2]
    ) {
      return value;
    }
    throw invalidRepositoryUrl();
  }
  const host = parsed.host.toLocaleLowerCase("en-US");
  const validProtocol =
    account.authType === "https-token"
      ? parsed.protocol === "https:"
      : parsed.protocol === "ssh:";
  if (
    !validProtocol ||
    host !== account.host ||
    !parsed.pathname ||
    parsed.pathname === "/" ||
    parsed.hash ||
    (account.authType === "https-token" &&
      (parsed.username || parsed.password))
  ) {
    throw invalidRepositoryUrl();
  }
  return parsed.toString();
}

function invalidRepositoryUrl(): GitError {
  return new GitError(
    "INVALID_REQUEST",
    "The repository URL must match the account host and authentication protocol without embedded HTTPS credentials."
  );
}

function parseRemoteUrl(
  value: string
): {
  protocol: string;
  host: string;
} | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      return undefined;
    }
    return {
      protocol: parsed.protocol,
      host: parsed.host.toLocaleLowerCase("en-US")
    };
  } catch {
    return undefined;
  }
}

function validateIdentifier(
  value: string,
  label: string
): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 512 ||
    !/^[a-zA-Z0-9_-]+$/.test(value)
  ) {
    throw new GitError(
      "INVALID_REQUEST",
      `${label} ids contain invalid characters.`
    );
  }
  return value;
}

function requireAccount(
  metadata: AccountMetadata,
  accountId: string
): AccountProfile {
  const account = metadata.profiles.find(
    (candidate) => candidate.id === accountId
  );
  if (!account) {
    throw new GitError(
      "INVALID_REQUEST",
      "The requested account does not exist."
    );
  }
  return account;
}

function normalizeBindings(
  bindings: RepositoryAccountBinding[]
): RepositoryAccountBinding[] {
  const unique = new Map<string, RepositoryAccountBinding>();
  for (const binding of bindings) {
    unique.set(
      `${binding.host}\0${binding.repositoryId ?? ""}`,
      binding
    );
  }
  return [...unique.values()].sort((left, right) =>
    `${left.host}:${left.repositoryId ?? ""}`.localeCompare(
      `${right.host}:${right.repositoryId ?? ""}`
    )
  );
}

function compareAccounts(
  left: AccountProfile,
  right: AccountProfile
): number {
  return `${left.host}:${left.username ?? ""}:${left.id}`.localeCompare(
    `${right.host}:${right.username ?? ""}:${right.id}`
  );
}

function toSummary(
  account: AccountProfile
): AccountProfileSummary {
  return {
    id: account.id,
    provider: account.provider,
    host: account.host,
    ...(account.username
      ? { username: account.username }
      : {}),
    authType: account.authType,
    hasCredential: Boolean(account.credentialRef),
    verificationStatus: account.verificationStatus,
    ...(account.lastVerifiedAt
      ? { lastVerifiedAt: account.lastVerifiedAt }
      : {})
  };
}

function toOverview(
  metadata: AccountMetadata
): AccountOverview {
  return structuredClone({
    accounts: metadata.profiles
      .map(toSummary)
      .sort((left, right) =>
        `${left.host}:${left.username ?? ""}:${left.id}`.localeCompare(
          `${right.host}:${right.username ?? ""}:${right.id}`
        )
      ),
    bindings: metadata.bindings
  });
}

function removalImpact(
  metadata: AccountMetadata,
  account: AccountProfile
): AccountRemovalImpact {
  const bindings = metadata.bindings.filter(
    (binding) => binding.accountId === account.id
  );
  return {
    accountId: account.id,
    host: account.host,
    repositoryIds: bindings
      .flatMap((binding) =>
        binding.repositoryId ? [binding.repositoryId] : []
      )
      .sort(),
    hostDefault: bindings.some(
      (binding) => !binding.repositoryId
    )
  };
}

function verificationMessage(
  status: Exclude<AccountVerificationStatus, "untested">
): string {
  return {
    verified: "The account can read the repository.",
    "authentication-failed":
      "The remote rejected the account credential.",
    "permission-denied":
      "The account authenticated but lacks repository access.",
    unavailable:
      "The remote could not be reached for verification."
  }[status];
}
