import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { PiUsageProvider, PiUsageResult, PiUsageWindow } from "../src/contracts/providerUsage";

const MAX_BYTES = 1024 * 1024;
const ENDPOINTS: Record<PiUsageProvider, string> = {
  anthropic: "https://api.anthropic.com/api/oauth/usage",
  "openai-codex": "https://chatgpt.com/backend-api/wham/usage",
};
type PiOAuth = { access: string; expires: number; accountId?: string };
type Request = (provider: PiUsageProvider, credentials: PiOAuth, url: string) => Promise<PiUsageResult>;

const unavailable = (message: string): PiUsageResult => ({ status: "unavailable", message });
const error = (message: string): PiUsageResult => ({ status: "error", message });
const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const validHeader = (value: unknown): value is string =>
  typeof value === "string" && !!value.trim() && [...value].every((c) => c.charCodeAt(0) >= 0x21 && c.charCodeAt(0) <= 0x7e);

export function isPiUsageProvider(value: unknown): value is PiUsageProvider {
  return value === "anthropic" || value === "openai-codex";
}

/** Pi's own `PI_CODING_AGENT_DIR` semantics; relative overrides never read the Host's cwd. */
export function piAgentDir(override = process.env.PI_CODING_AGENT_DIR, home: string | undefined = homedir()): string | undefined {
  if (override) {
    if (override === "~" || override.startsWith("~/") || override.startsWith("~\\"))
      return home ? join(home, override.slice(1)) : undefined;
    return isAbsolute(override) ? override : undefined;
  }
  return home ? join(home, ".pi", "agent") : undefined;
}

class Failure { constructor(readonly result: PiUsageResult) {} }

async function readJson(path: string): Promise<unknown> {
  let bytes: Buffer;
  try { bytes = await readFile(path); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Failure(error("Could not read Pi configuration. Check its file permissions."));
  }
  if (bytes.length > MAX_BYTES) throw new Failure(error("Pi configuration is too large or unreadable."));
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { throw new Failure(error("Pi configuration contains invalid JSON.")); }
}

function hasAuthOverride(value: unknown): boolean {
  const record = object(value);
  if (!record) return false;
  return ["apiKey", "baseUrl", "headers", "authHeader"].some((key) => key in record)
    || (Array.isArray(record.models) && record.models.some(hasAuthOverride))
    || Object.values(object(record.modelOverrides) ?? {}).some(hasAuthOverride);
}

async function credential(dir: string, provider: PiUsageProvider): Promise<PiOAuth> {
  const config = await readJson(join(dir, "models.json"));
  if (config !== undefined && hasAuthOverride(object(object(config)?.providers)?.[provider]))
    throw new Failure(unavailable("Usage is unavailable for custom Pi authentication or endpoints."));
  const entry = object(object(await readJson(join(dir, "auth.json")))?.[provider]);
  if (entry?.type === "api_key") throw new Failure(unavailable("Subscription usage is unavailable for Pi API keys."));
  if (entry?.type !== "oauth") throw new Failure(unavailable("Sign in to this provider through Pi, then refresh usage."));
  const { access, expires } = entry;
  if (!validHeader(access) || typeof expires !== "number" || !Number.isSafeInteger(expires) || expires < 0)
    throw new Failure(error("Pi credentials are invalid. Sign in through Pi again."));
  if (expires <= Date.now()) throw new Failure(unavailable("Pi sign-in expired. Resume or sign in through Pi, then refresh usage."));
  const accountId = validHeader(entry.accountId) ? entry.accountId : undefined;
  if (provider === "openai-codex" && !accountId)
    throw new Failure(unavailable("Pi's Codex account could not be identified. Sign in through Pi again."));
  return { access, expires, ...(accountId ? { accountId } : {}) };
}

const percentage = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;

export function parsePiUsage(provider: PiUsageProvider, body: string): PiUsageResult {
  let value: unknown;
  try { value = JSON.parse(body); } catch { value = undefined; }
  const windows: { session: PiUsageWindow | null; weekly: PiUsageWindow | null } = { session: null, weekly: null };
  const parsed = (() => {
    const root = object(value);
    if (!root) return false;
    if (provider === "anthropic") {
      for (const [key, minutes] of [["five_hour", 300], ["seven_day", 10080]] as const) {
        const raw = root[key];
        if (raw === null || raw === undefined) continue;
        const usedPercent = percentage(object(raw)?.utilization);
        if (usedPercent === undefined) return false;
        const reset = object(raw)!.resets_at;
        let resetsAt: number | null = null;
        if (reset !== null && reset !== undefined) {
          if (typeof reset !== "string") return false;
          const time = Date.parse(reset);
          if (!Number.isFinite(time) || time < 0) return false;
          resetsAt = time;
        }
        windows[minutes === 300 ? "session" : "weekly"] = { usedPercent, windowMinutes: minutes, resetsAt };
      }
      return true;
    }
    const limits = object(root.rate_limit);
    if (!limits) return false;
    for (const key of ["primary_window", "secondary_window"]) {
      const raw = limits[key];
      if (raw === null || raw === undefined) continue;
      const window = object(raw);
      const seconds = window?.limit_window_seconds;
      if (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds <= 0 || seconds % 60) return false;
      const usedPercent = percentage(window!.used_percent);
      if (usedPercent === undefined) return false;
      const reset = window!.reset_at;
      let resetsAt: number | null = null;
      if (reset !== null && reset !== undefined) {
        if (typeof reset !== "number" || !Number.isSafeInteger(reset) || reset < 0 || !Number.isSafeInteger(reset * 1000)) return false;
        resetsAt = reset * 1000;
      }
      const slot = seconds >= 604800 ? "weekly" : "session";
      if (windows[slot]) return false;
      windows[slot] = { usedPercent, windowMinutes: seconds / 60, resetsAt };
    }
    return true;
  })();
  return parsed && (windows.session || windows.weekly)
    ? { status: "ok", windows }
    : error("Pi usage response was unexpected. Try refreshing.");
}

async function requestUsage(provider: PiUsageProvider, credentials: PiOAuth, url: string): Promise<PiUsageResult> {
  const headers: Record<string, string> = { Authorization: `Bearer ${credentials.access}`, "User-Agent": "omnicode" };
  if (provider === "anthropic") headers["anthropic-beta"] = "oauth-2025-04-20";
  else if (credentials.accountId) headers["ChatGPT-Account-Id"] = credentials.accountId;
  let response: Response;
  // Never follow redirects: the bearer token must reach only the provider endpoint.
  try { response = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(10_000) }); }
  catch { return error("Could not fetch Pi usage. Try refreshing."); }
  if (response.status === 401) return unavailable("Pi sign-in expired. Sign in through Pi, then refresh usage.");
  if (response.status === 403) return unavailable("Usage is unavailable for this Pi account.");
  if (response.status !== 200) { void response.body?.cancel().catch(() => undefined); return error("Could not fetch Pi usage. Try refreshing."); }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) { void response.body?.cancel().catch(() => undefined); return error("Pi usage response was too large or unreadable."); }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { void reader.cancel().catch(() => undefined); return error("Pi usage response was too large or unreadable."); }
      chunks.push(value);
    }
  } catch { return error("Pi usage response was too large or unreadable."); }
  return parsePiUsage(provider, Buffer.concat(chunks).toString("utf8"));
}

/**
 * Reads Pi's saved subscription credential on the Host. Pi owns token rotation:
 * nothing is refreshed or written, and a response is discarded if the
 * credential changed while it was in flight.
 */
export async function fetchHostPiUsage(provider: unknown, options: { dir?: string; request?: Request } = {}): Promise<PiUsageResult> {
  if (!isPiUsageProvider(provider)) throw new Error("Invalid Pi usage provider");
  const dir = options.dir ?? piAgentDir();
  if (!dir) return unavailable("Pi usage needs an absolute configuration directory. Check PI_CODING_AGENT_DIR.");
  try {
    const credentials = await credential(dir, provider);
    const result = await (options.request ?? requestUsage)(provider, credentials, ENDPOINTS[provider]);
    const current = await credential(dir, provider).catch(() => undefined);
    if (!current || current.access !== credentials.access || current.expires !== credentials.expires || current.accountId !== credentials.accountId)
      return error("Pi credentials changed. Refresh usage to read the current account.");
    return result;
  } catch (cause) {
    if (cause instanceof Failure) return cause.result;
    return error("Could not read Pi usage. Try refreshing.");
  }
}
