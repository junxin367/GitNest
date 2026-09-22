import { createHash } from "node:crypto";
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
      versionFingerprint(after.size, after.mtimeMs) !==
        versionFingerprint(before.size, before.mtimeMs)
    ) {
      throw new Error(
        `Source file changed while it was being read: ${file.relativePath}`
      );
    }
    const completeContent = content.subarray(0, offset);
    if (
      file.fingerprint.startsWith("sha256:") &&
      contentFingerprint(completeContent) !==
        file.fingerprint
    ) {
      throw new Error(
        `Source file changed after discovery: ${file.relativePath}`
      );
    }
    return completeContent.toString("utf8");
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
    details.size !== file.size ||
    Math.trunc(details.mtimeMs) !==
      Math.trunc(file.modifiedAtMs)
  ) {
    throw new Error(
      `Source file changed after discovery: ${file.relativePath}`
    );
  }
}

function versionFingerprint(
  size: number,
  mtimeMs: number
): string {
  return `${size}:${Math.trunc(mtimeMs)}`;
}

function contentFingerprint(content: Uint8Array): string {
  return `sha256:${createHash("sha256")
    .update(content)
    .digest("hex")}`;
}
