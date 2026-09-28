import {
  mkdtemp,
  readFile,
  rm
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
  SafeStorageCredentialVault,
  type SafeStorageProtector
} from "./credential-vault.adapter";

const TOKEN = "vault-secret-token-测试";

describe("SafeStorageCredentialVault", () => {
  const temporaryPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryPaths.map((path) =>
        rm(path, { recursive: true, force: true })
      )
    );
  });

  it("round-trips a protected secret without plaintext on disk", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "gitnest-vault-test-")
    );
    temporaryPaths.push(directory);
    const vault = new SafeStorageCredentialVault(
      directory,
      new FakeProtector()
    );

    await vault.save("credential_1", TOKEN);
    const raw = await readFile(
      join(directory, "credential_1.bin")
    );
    expect(raw.toString("utf8")).not.toContain(TOKEN);
    await expect(vault.read("credential_1")).resolves.toBe(
      TOKEN
    );

    await vault.delete("credential_1");
    await expect(vault.read("credential_1")).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILED",
      message: expect.not.stringContaining(TOKEN)
    });
  });

  it("rejects unavailable encryption and path-like references", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "gitnest-vault-test-")
    );
    temporaryPaths.push(directory);
    const vault = new SafeStorageCredentialVault(directory, {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => ""
    });

    await expect(
      vault.save("credential_1", TOKEN)
    ).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILED"
    });
    await expect(
      vault.save("../credential", TOKEN)
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
  });
});

class FakeProtector implements SafeStorageProtector {
  isEncryptionAvailable(): boolean {
    return true;
  }

  encryptString(value: string): Buffer {
    return Buffer.from(
      [...Buffer.from(value, "utf8")]
        .map((byte) => byte ^ 0xa5)
    );
  }

  decryptString(value: Buffer): string {
    return Buffer.from(
      [...value].map((byte) => byte ^ 0xa5)
    ).toString("utf8");
  }
}
