import {
  ACCOUNT_METADATA_SCHEMA_VERSION,
  type AccountMetadata
} from "@gitnest/application";
import { WorkspaceError } from "@gitnest/workspace-core";

const PROVIDERS = new Set([
  "github",
  "gitlab",
  "gitee",
  "custom"
]);
const AUTH_TYPES = new Set([
  "https-token",
  "system-ssh"
]);
const VERIFICATION_STATUSES = new Set([
  "untested",
  "verified",
  "authentication-failed",
  "permission-denied",
  "unavailable"
]);
const ACCOUNT_CREDENTIAL_PREFIX = "credential_";

export function migrateAccountMetadataDocument(
  value: unknown
): AccountMetadata {
  const migrated = migrateLegacyAccountMetadataDocument(
    value
  );
  if (
    !isRecord(migrated) ||
    migrated.schemaVersion !== ACCOUNT_METADATA_SCHEMA_VERSION ||
    typeof migrated.updatedAt !== "string" ||
    !Array.isArray(migrated.profiles) ||
    !Array.isArray(migrated.bindings) ||
    !migrated.profiles.every(isAccountProfile) ||
    !migrated.bindings.every(isAccountBinding)
  ) {
    throw invalidDocument();
  }

  const profiles =
    migrated.profiles as AccountMetadata["profiles"];
  const bindings =
    migrated.bindings as AccountMetadata["bindings"];
  const accountIds = new Set(
    profiles.map((profile) => profile.id)
  );
  if (
    bindings.some(
      (binding) =>
        !accountIds.has(binding.accountId) ||
        profiles.find(
          (profile) =>
            profile.id === binding.accountId
        )?.host !== binding.host
    )
  ) {
    throw invalidDocument();
  }

  return {
    schemaVersion: ACCOUNT_METADATA_SCHEMA_VERSION,
    profiles: profiles.map((profile) => ({
      id: profile.id,
      provider: profile.provider,
      host: profile.host,
      ...(profile.username
        ? { username: profile.username }
        : {}),
      authType: profile.authType,
      ...(profile.credentialRef
        ? { credentialRef: profile.credentialRef }
        : {}),
      verificationStatus: profile.verificationStatus,
      ...(profile.lastVerifiedAt
        ? { lastVerifiedAt: profile.lastVerifiedAt }
        : {})
    })),
    bindings: bindings.map((binding) => ({
      host: binding.host,
      accountId: binding.accountId,
      ...(binding.repositoryId
        ? { repositoryId: binding.repositoryId }
        : {})
    })),
    updatedAt: migrated.updatedAt
  };
}

function migrateLegacyAccountMetadataDocument(
  value: unknown
): unknown {
  if (!isRecord(value) || value.schemaVersion !== 0) {
    return value;
  }
  if (!Array.isArray(value.profiles)) {
    throw invalidDocument();
  }
  return {
    ...value,
    schemaVersion: ACCOUNT_METADATA_SCHEMA_VERSION,
    bindings: Array.isArray(value.bindings)
      ? value.bindings
      : [],
    profiles: value.profiles.map((profile) =>
      isRecord(profile)
        ? {
            ...profile,
            verificationStatus:
              typeof profile.verificationStatus ===
              "string"
                ? profile.verificationStatus
                : "untested"
          }
        : profile
    )
  };
}

function isAccountProfile(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.host !== "string" ||
    typeof value.provider !== "string" ||
    !PROVIDERS.has(value.provider) ||
    typeof value.authType !== "string" ||
    !AUTH_TYPES.has(value.authType) ||
    typeof value.verificationStatus !== "string" ||
    !VERIFICATION_STATUSES.has(value.verificationStatus) ||
    (value.username !== undefined &&
      typeof value.username !== "string") ||
    (value.credentialRef !== undefined &&
      !isAccountCredentialRef(value.credentialRef)) ||
    (value.lastVerifiedAt !== undefined &&
      typeof value.lastVerifiedAt !== "string")
  ) {
    return false;
  }

  return !(
    value.authType === "system-ssh" &&
    value.credentialRef !== undefined
  );
}

function isAccountCredentialRef(
  value: unknown
): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(ACCOUNT_CREDENTIAL_PREFIX) &&
    value.length > ACCOUNT_CREDENTIAL_PREFIX.length &&
    value.length <= 512 &&
    /^[a-zA-Z0-9_-]+$/.test(value)
  );
}

function isAccountBinding(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.host === "string" &&
    typeof value.accountId === "string" &&
    (value.repositoryId === undefined ||
      typeof value.repositoryId === "string")
  );
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function invalidDocument(): WorkspaceError {
  return new WorkspaceError(
    "INVALID_PERSISTED_DATA",
    "The persisted account metadata document is invalid."
  );
}
