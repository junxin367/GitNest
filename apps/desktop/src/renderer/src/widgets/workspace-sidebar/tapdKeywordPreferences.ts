import type { PreferenceStorage } from "./sidebarPreferences";

const TAPD_KEYWORD_KEY_PREFIX =
  "gitnest.workspace.tapd-keyword:";

export function tapdKeywordPreferenceKey(
  workspaceId: string,
  entryId: string
): string {
  return `${TAPD_KEYWORD_KEY_PREFIX}${workspaceId}:${entryId}`;
}

export function readTapdKeywordPreference(
  storage: PreferenceStorage | undefined,
  workspaceId: string | undefined,
  entryId: string | undefined
): string {
  if (!storage || !workspaceId || !entryId) {
    return "";
  }

  try {
    return normalizeTapdKeyword(
      storage.getItem(
        tapdKeywordPreferenceKey(workspaceId, entryId)
      ) ?? ""
    );
  } catch {
    return "";
  }
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

  try {
    storage.setItem(
      tapdKeywordPreferenceKey(workspaceId, entryId),
      normalizeTapdKeyword(keyword)
    );
  } catch {
    // Preference persistence is best-effort in restricted environments.
  }
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
