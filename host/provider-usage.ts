import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { providerUsageProfile } from "./provider-accounts";
import { fetchHostClaudeUsage } from "./claude-usage";
import { resolveCodexBinary } from "../src/integrations/harness/core/child";
import { runCodexAccountRequest } from "../src/integrations/harness/providers/codex/codexAccountRequest";
import { errorRateLimits, parseCodexRateLimits, unavailableRateLimits } from "../src/domain/rateLimits";
import { type ProviderRateLimits } from "../src/contracts/session";
import type { CodexRateLimitResetOutcome } from "../src/contracts/providerUsage";
import { asRecord } from "../src/domain/records";

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
      accountId, `omnicode-host-usage-${randomUUID()}`);
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
  private readonly resets = new Map<string, { signature: string; pending: Promise<CodexRateLimitResetOutcome> }>();
  private entries = new Map<string, {
    selector: string;
    value?: ProviderRateLimits;
    pending?: Promise<ProviderRateLimits>;
  }>();

  constructor(private readonly owner: string, private readonly probe = query) {}

  async consumeReset(params: Record<string, unknown>): Promise<CodexRateLimitResetOutcome> {
    const profile = providerUsageProfile(this.owner, "codex", params.accountId);
    const id = params.operationId;
    if (typeof id !== "string" || !/^[A-Za-z0-9_:-]{1,128}$/.test(id)) throw new Error("Invalid usage reset operation ID");
    if (params.creditId != null && (typeof params.creditId !== "string" || !params.creditId || params.creditId.length > 1024)) throw new Error("Invalid usage reset credit");
    const signature = JSON.stringify([profile.accountId, profile.home, params.creditId ?? null]);
    const active = this.resets.get(id);
    if (active) {
      if (active.signature !== signature) throw new Error("Usage reset operation ID was reused with different input");
      return active.pending;
    }
    const path = join(dirname(this.owner), "provider-usage-resets.json");
    type Receipt = { signature: string; outcome?: CodexRateLimitResetOutcome };
    const read = (): Record<string, Receipt> => {
      try {
        const value = asRecord(JSON.parse(readFileSync(path, "utf8")));
        if (!value) throw new Error("Invalid usage reset journal");
        return value as Record<string, Receipt>;
      } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
    };
    const save = (receipt: Receipt) => {
      const receipts = read();
      receipts[id] = receipt;
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify(receipts), { mode: 0o600 });
      renameSync(temporary, path);
    };
    const previous = read()[id];
    if (previous && previous.signature !== signature) throw new Error("Usage reset operation ID was reused with different input");
    if (previous?.outcome) return previous.outcome;
    // Persist the native idempotency identity before any irreversible action.
    save({ signature });
    const pending = (async () => {
      const binary = (await resolveCodexBinary()).path;
      const result = await runCodexAccountRequest<unknown>(binary, homedir(), "account/rateLimitResetCredit/consume", {
        idempotencyKey: id, ...(params.creditId ? { creditId: params.creditId } : {}),
      }, profile.accountId, `omnicode-host-reset-${randomUUID()}`);
      const outcome = asRecord(result)?.outcome;
      if (outcome !== "reset" && outcome !== "nothingToReset" && outcome !== "noCredit" && outcome !== "alreadyRedeemed") throw new Error("Codex returned an unknown reset result");
      save({ signature, outcome });
      this.entries.delete(`codex:${profile.accountId}`);
      return outcome;
    })().finally(() => this.resets.delete(id));
    this.resets.set(id, { signature, pending });
    return pending;
  }

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
