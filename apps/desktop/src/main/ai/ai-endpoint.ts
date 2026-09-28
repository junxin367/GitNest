import { GitError } from "@gitnest/git-core";

export function normalizeAiEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new GitError(
      "INVALID_REQUEST",
      "The AI API URL is invalid."
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new GitError(
      "INVALID_REQUEST",
      "The AI API URL must use HTTP or HTTPS."
    );
  }
  if (url.username || url.password || url.hash) {
    throw new GitError(
      "INVALID_REQUEST",
      "The AI API URL cannot contain credentials or a fragment."
    );
  }

  const normalizedPath = url.pathname.replace(/\/+$/, "");
  if (!normalizedPath.endsWith("/chat/completions")) {
    url.pathname = `${normalizedPath}/chat/completions`.replace(
      /^\/+/,
      "/"
    );
  } else {
    url.pathname = normalizedPath;
  }
  return url.toString();
}

export function aiEndpointsMatch(
  left: string,
  right: string
): boolean {
  if (left.trim() === right.trim()) {
    return true;
  }
  try {
    return (
      normalizeAiEndpoint(left) === normalizeAiEndpoint(right)
    );
  } catch {
    return false;
  }
}
