export type GitContributor = { name: string; email?: string };

export function commitCoAuthors(body = ""): GitContributor[] {
  const contributors = new Map<string, GitContributor>();
  for (const match of body.matchAll(
    /^co-authored-by:[ \t]*([^<>\r\n]+?)(?:[ \t]*<([^<>\r\n]*)>)?[ \t]*$/gim,
  )) {
    const name = match[1].trim();
    const email = match[2]?.trim();
    if (!name) continue;
    const key = (email || name).toLowerCase();
    if (!contributors.has(key)) contributors.set(key, { name, email });
  }
  return [...contributors.values()];
}

export async function contributorAvatarUrl(email?: string): Promise<string> {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return "";
  // GitHub's no-reply addresses identify an account without guessing from a name.
  const github = normalized.match(
    /^(?:(\d+)\+)?([a-z\d-]+)@users\.noreply\.github\.com$/,
  );
  if (github) {
    const account = github[1] ? `u/${github[1]}` : github[2];
    return `https://avatars.githubusercontent.com/${account}?s=64`;
  }
  // Web Crypto is unavailable on plain HTTP Hosts; keep the local placeholder.
  if (!globalThis.crypto?.subtle) return "";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `https://www.gravatar.com/avatar/${hash}?s=64&d=404`;
}
