import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { errorRateLimits, parseClaudeOAuthUsage, unavailableRateLimits } from "../src/features/providers/model/rateLimits";

const exec = promisify(execFile);
type Credentials = { accessToken: string; expiresAt?: number };

function credentials(raw: string): Credentials | undefined {
  try {
    const value = JSON.parse(raw);
    const oauth = value?.claudeAiOauth ?? value;
    if (typeof oauth?.accessToken !== "string" || !oauth.accessToken.trim()) return;
    const expires = oauth.expiresAt == null ? NaN : Number(oauth.expiresAt);
    return { accessToken: oauth.accessToken.trim(),
      ...(Number.isFinite(expires) ? { expiresAt: expires } : {}) };
  } catch { return undefined; }
}

/** Match the desktop's exact NFC selector hashing; never use another profile's service. */
export function claudeUsageKeychainService(selector?: string): string {
  return "Claude Code-credentials" + (selector
    ? `-${createHash("sha256").update(selector.normalize("NFC")).digest("hex").slice(0, 8)}` : "");
}

async function readCredentials(home: string, selector?: string): Promise<Credentials | undefined> {
  if (process.platform === "darwin") {
    const service = claudeUsageKeychainService(selector);
    const user = process.env.USER || process.env.USERNAME || "claude-code-user";
    const started = Date.now();
    for (const account of [undefined, user, "claude-code-user"]) {
      const remaining = 5_000 - (Date.now() - started);
      if (remaining <= 0) break;
      try {
        const { stdout } = await exec("security", ["find-generic-password", "-s", service,
          ...(account ? ["-a", account] : []), "-w"],
        { timeout: remaining, maxBuffer: 1024 * 1024, windowsHide: true });
        const value = credentials(stdout);
        if (value) return value;
      } catch { /* File fallback is scoped to this same profile. */ }
    }
  }
  return credentials(await readFile(join(home, ".credentials.json"), "utf8").catch(() => ""));
}

/** Read only: the provider CLI owns credential rotation. */
export async function fetchHostClaudeUsage(home: string, selector?: string) {
  const value = await readCredentials(home, selector);
  if (!value) return unavailableRateLimits("claude", "Claude not signed in");
  if (value.expiresAt != null && value.expiresAt <= Date.now())
    return errorRateLimits("claude", "Claude sign-in expired");
  try {
    const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: { Authorization: `Bearer ${value.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20", "User-Agent": "claude-code/2.1.0" },
      signal: AbortSignal.timeout(10_000), redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      return errorRateLimits("claude", response.status === 401 ? "Claude sign-in expired"
        : response.status === 403 ? "Claude usage is unavailable for this account"
        : "Claude usage request failed");
    }
    const parsed = parseClaudeOAuthUsage(await response.text());
    return parsed.session || parsed.weekly ? parsed
      : errorRateLimits("claude", "Claude usage response was unexpected");
  } catch {
    // Never send credential-bearing request objects or raw responses to clients.
    return errorRateLimits("claude", "Claude usage request failed");
  }
}
