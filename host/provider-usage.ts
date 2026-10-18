import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { providerUsageProfile } from "./provider-accounts";
import { fetchHostClaudeUsage } from "./claude-usage";
import { resolveCodexBinary } from "../src/integrations/harness/core/child";
import { runCodexAccountRequest } from "../src/integrations/harness/providers/codex/codexAccountRequest";
import { errorRateLimits, parseCodexRateLimits, unavailableRateLimits, type ProviderRateLimits } from "../src/features/providers/model/rateLimits";

type Profile = ReturnType<typeof providerUsageProfile>;
const CACHE_MS = 5 * 60_000;

function fingerprint(path: string): string {
  try {
    const info = statSync(path);
    return `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  } catch { return "missing"; }
}

async function query(profile: Profile): Promise<ProviderRateLimits> {
  const { provider, accountId, home } = profile;
  if (profile.environmentAuth)
    return unavailableRateLimits(provider, "Usage is unavailable for environment-based authentication.");
  if (!statSync(home, { throwIfNoEntry: false })?.isDirectory())
    return unavailableRateLimits(provider, "This provider account's Data Home is no longer available");
  if (provider === "claude") return fetchHostClaudeUsage(home, profile.keychainSelector);
  let path: string;
  try { path = (await resolveCodexBinary()).path; }
  catch { return unavailableRateLimits("codex", "Codex CLI not found"); }
  try {
    const result = await runCodexAccountRequest<unknown>(path, homedir(), "account/rateLimits/read", {},
      accountId, `monocode-host-usage-${randomUUID()}`);
    const parsed = parseCodexRateLimits(result);
    return parsed.session || parsed.weekly || parsed.monthly || parsed.resetCredits
      ? parsed : unavailableRateLimits("codex", "No Codex usage data");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return /not signed in|chatgpt authentication required|not authenticated/i.test(message)
      ? unavailableRateLimits("codex", "Codex not signed in")
      : errorRateLimits("codex", /timed out/i.test(message)
        ? "Codex usage probe timed out" : "Codex usage request failed");
  }
}

/** Instance belongs to one Host; no profile data or credentials enter the response. */
export class HostProviderUsage {
  private entries = new Map<string, {
    selector: string;
    value?: ProviderRateLimits;
    pending?: Promise<ProviderRateLimits>;
  }>();

  constructor(private readonly owner: string, private readonly probe = query) {}

  read(params: { provider?: unknown; accountId?: unknown; refresh?: unknown }): Promise<ProviderRateLimits> {
    if (params.refresh !== undefined && typeof params.refresh !== "boolean")
      throw new Error("Invalid usage refresh option");
    // Revalidate even cached requests: a removed account must stop being queryable.
    const profile = providerUsageProfile(this.owner, params.provider, params.accountId);
    const key = `${profile.provider}:${profile.accountId}`;
    const selector = JSON.stringify([profile, fingerprint(profile.home),
      fingerprint(join(profile.home, profile.provider === "codex" ? "auth.json" : ".credentials.json"))]);
    let entry = this.entries.get(key);
    if (entry?.selector !== selector) {
      entry = { selector };
      this.entries.set(key, entry);
    }
    if (entry.pending) return entry.pending;
    if (!params.refresh && entry.value?.status === "ok" && Date.now() - entry.value.updatedAt < CACHE_MS)
      return Promise.resolve(entry.value);
    const target = entry;
    const pending = this.probe(profile).catch(() => errorRateLimits(profile.provider, "Usage unavailable"))
      .then(value => {
        target.value = value;
        return value;
      }).finally(() => { target.pending = undefined; });
    target.pending = pending;
    return pending;
  }
}
