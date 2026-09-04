import {
  mkdir,
  open,
  readFile,
  rename,
  unlink
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join
} from "node:path";

import type {
  CredentialVaultPort
} from "@gitnest/application";
import { GitError } from "@gitnest/git-core";

export interface SafeStorageProtector {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class SafeStorageCredentialVault
  implements CredentialVaultPort
{
  readonly #directory: string;
  readonly #protector: SafeStorageProtector;

  constructor(
    directory: string,
    protector: SafeStorageProtector
  ) {
    if (!isAbsolute(directory)) {
      throw new Error(
        "Credential vault directory must be absolute."
      );
    }
    this.#directory = directory;
    this.#protector = protector;
  }

  async save(
    credentialRef: string,
    secret: string
  ): Promise<void> {
    const path = this.#credentialPath(credentialRef);
    if (
      typeof secret !== "string" ||
      !secret ||
      secret.length > 8_192
    ) {
      throw new GitError(
        "INVALID_REQUEST",
        "The credential exceeds the supported bounds."
      );
    }
    this.#assertEncryptionAvailable();

    const encrypted = this.#protector.encryptString(secret);
    const temporaryPath = join(
      dirname(path),
      `.${basename(path)}.${process.pid}.${Date.now()}.tmp`
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;

    try {
      await mkdir(this.#directory, { recursive: true });
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(encrypted);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, path);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw vaultFailure("save", error);
    } finally {
      encrypted.fill(0);
    }
  }

  async read(credentialRef: string): Promise<string> {
    const path = this.#credentialPath(credentialRef);
    this.#assertEncryptionAvailable();

    try {
      const encrypted = await readFile(path);
      try {
        return this.#protector.decryptString(encrypted);
      } finally {
        encrypted.fill(0);
      }
    } catch (error) {
      throw vaultFailure("read", error);
    }
  }

  async delete(credentialRef: string): Promise<void> {
    const path = this.#credentialPath(credentialRef);
    try {
      await unlink(path);
    } catch (error) {
      if (getErrorCode(error) !== "ENOENT") {
        throw vaultFailure("delete", error);
      }
    }
  }

  #credentialPath(credentialRef: string): string {
    if (
      typeof credentialRef !== "string" ||
      !credentialRef ||
      credentialRef.length > 512 ||
      !/^[a-zA-Z0-9_-]+$/.test(credentialRef)
    ) {
      throw new GitError(
        "INVALID_REQUEST",
        "Credential references contain invalid characters."
      );
    }
    return join(this.#directory, `${credentialRef}.bin`);
  }

  #assertEncryptionAvailable(): void {
    if (!this.#protector.isEncryptionAvailable()) {
      throw new GitError(
        "AUTHENTICATION_FAILED",
        "Windows credential encryption is unavailable."
      );
    }
  }
}

function vaultFailure(
  operation: "save" | "read" | "delete",
  error: unknown
): GitError {
  return new GitError(
    operation === "read"
      ? "AUTHENTICATION_FAILED"
      : "COMMAND_FAILED",
    `Unable to ${operation} the protected credential.`,
    {
      cause:
        error instanceof Error
          ? error.name
          : "Unknown vault error"
    }
  );
}

function getErrorCode(error: unknown): string | undefined {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}
