import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

export interface TemporaryDirectoryFixture {
  path: string;
  dispose(): Promise<void>;
}

export async function createTemporaryDirectoryFixture(
  name = "workspace"
): Promise<TemporaryDirectoryFixture> {
  const temporaryRoot = tmpdir();
  const path = await mkdtemp(
    join(temporaryRoot, `gitnest-test-${name}-`)
  );

  return {
    path,
    dispose: async () => {
      assertSafeTemporaryPath(path, temporaryRoot);
      await rm(path, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50
      });
    }
  };
}

export function assertSafeTemporaryPath(
  path: string,
  temporaryRoot = tmpdir()
): void {
  const relativePath = relative(temporaryRoot, path);

  if (
    !relativePath.startsWith("gitnest-test-") ||
    relativePath.includes("..")
  ) {
    throw new Error(
      `Refusing to remove unsafe fixture path: ${path}`
    );
  }
}
