import type { PreferenceStorage } from "./sidebarPreferences";
import {
  readRendererPreference,
  rendererPreferenceKeys,
  writeRendererPreference
} from "../../shared/lib/renderer-preferences";

export function tapdKeywordPreferenceKey(
  workspaceId: string,
  entryId: string
): string {
  return rendererPreferenceKeys.tapdKeyword(
    workspaceId,
    entryId
  );
}

export function readTapdKeywordPreference(
  storage: PreferenceStorage | undefined,
  workspaceId: string | undefined,
  entryId: string | undefined
): string {
  if (!storage || !workspaceId || !entryId) {
    return "";
  }

  return normalizeTapdKeyword(
    readRendererPreference(
      storage,
      tapdKeywordPreferenceKey(workspaceId, entryId)
    ) ?? ""
  );
}

export function writeTapdKeywordPreference(
  storage: PreferenceStorage | undefined,
  workspaceId: string | undefined,
  entryId: string | undefined,
  keyword: string
): void {
  if (!storage || !workspaceId || !entryId) {
    return;
  }

  writeRendererPreference(
    storage,
    tapdKeywordPreferenceKey(workspaceId, entryId),
    normalizeTapdKeyword(keyword)
  );
}

export function normalizeTapdKeyword(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function applyTapdKeywordToCommitMessage(
  message: string,
  keyword: string
): string {
  const normalizedKeyword = normalizeTapdKeyword(keyword);
  if (!normalizedKeyword) {
    return message;
  }

  const normalizedMessage = message.trim();
  if (!normalizedMessage) {
    return message;
  }

  const lines = normalizedMessage.split(/\r?\n/);
  if (
    lines.some(
      (line) => line.trim() === normalizedKeyword
    )
  ) {
    return normalizedMessage;
  }

  if (lines.length === 1) {
    return `${lines[0]}\n${normalizedKeyword}`;
  }

  return [
    lines[0],
    normalizedKeyword,
    ...lines.slice(1)
  ].join("\n");
}
