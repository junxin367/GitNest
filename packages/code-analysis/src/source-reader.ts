import { open } from "node:fs/promises";

import type { AnalysisSourceFile } from "./model";

export async function readBoundedSourceFile(
  file: AnalysisSourceFile,
  maximumBytes: number
): Promise<string> {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 0
  ) {
    throw new Error("Invalid source file size limit.");
  }

  const handle = await open(file.absolutePath, "r");
  try {
    const before = await handle.stat();
    assertReadableVersion(file, before, maximumBytes);

    const content = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < content.byteLength) {
      const { bytesRead } = await handle.read(
        content,
        offset,
        content.byteLength - offset,
        offset
      );
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
    }

    const after = await handle.stat();
    if (
      offset !== before.size ||
      fingerprint(after.size, after.mtimeMs) !==
        fingerprint(before.size, before.mtimeMs)
    ) {
      throw new Error(
        `Source file changed while it was being read: ${file.relativePath}`
      );
    }
    return content.subarray(0, offset).toString("utf8");
  } finally {
    await handle.close();
  }
}

function assertReadableVersion(
  file: AnalysisSourceFile,
  details: {
    isFile(): boolean;
    size: number;
    mtimeMs: number;
  },
  maximumBytes: number
): void {
  if (!details.isFile()) {
    throw new Error(
      `Source path is no longer a regular file: ${file.relativePath}`
    );
  }
  if (details.size > maximumBytes) {
    throw new Error(
      `Source file exceeds the ${maximumBytes}-byte safety limit: ${file.relativePath}`
    );
  }
  if (
    fingerprint(details.size, details.mtimeMs) !==
    file.fingerprint
  ) {
    throw new Error(
      `Source file changed after discovery: ${file.relativePath}`
    );
  }
}

function fingerprint(size: number, mtimeMs: number): string {
  return `${size}:${Math.trunc(mtimeMs)}`;
}
