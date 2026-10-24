import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseJsonc } from "./jsonc";
import { asRecord } from "../src/domain/records";
import { errorRateLimits, parseOpencodeGoUsage, unavailableRateLimits } from "../src/domain/rateLimits";
import type { ProviderRateLimits } from "../src/contracts/session";

const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const goKey = (value: unknown) => text(asRecord(asRecord(value)?.["opencode-go"])?.key);

export async function readOpenCodeGoKey(home = homedir(), env = process.env): Promise<string | undefined> {
  if (text(env.OPENCODE_AUTH_CONTENT)) {
    try { const blob = asRecord(JSON.parse(env.OPENCODE_AUTH_CONTENT!)); if (blob) return goKey(blob); } catch { /* Continue with config. */ }
  }
  const configKey = (value: unknown): string | undefined => {
    const providers = asRecord(asRecord(value)?.provider);
    for (const id of ["opencode-go", "opencode"]) {
      const key = text(asRecord(asRecord(providers?.[id])?.options)?.apiKey);
      if (!key) continue;
      const variable = key.match(/^\{env:(.*)\}$/)?.[1];
      if (variable != null) { const value = text(env[variable]); if (value) return value; }
      else return key;
    }
  };
  if (text(env.OPENCODE_CONFIG_CONTENT)) {
    try { const key = configKey(parseJsonc(env.OPENCODE_CONFIG_CONTENT!)); if (key) return key; } catch { /* Continue with files. */ }
  }
  const configPaths = [text(env.OPENCODE_CONFIG),
    ...(text(env.XDG_CONFIG_HOME) ? [join(env.XDG_CONFIG_HOME!, "opencode", "opencode.jsonc"), join(env.XDG_CONFIG_HOME!, "opencode", "opencode.json")] : []),
    join(home, ".config", "opencode", "opencode.jsonc"), join(home, ".config", "opencode", "opencode.json")];
  for (const path of configPaths) {
    if (!path) continue;
    try { const key = configKey(parseJsonc(await readFile(path, "utf8"))); if (key) return key; } catch { /* Try the next configured source. */ }
  }
  const app = text(env.OPENCODE_APPNAME) ?? "opencode";
  const directory = text(env.OPENCODE_DATA_DIR) ?? join(text(env.XDG_DATA_HOME) ?? join(home, ".local", "share"), app);
  let raw: string;
  try { raw = await readFile(join(directory, "auth.json"), "utf8"); }
  catch { try { raw = await readFile(join(home, "Library", "Application Support", "opencode", "auth.json"), "utf8"); } catch { return; } }
  try { return goKey(JSON.parse(raw)); } catch { return; }
}

export async function fetchHostOpenCodeUsage(options: { home?: string; env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}): Promise<ProviderRateLimits> {
  const key = await readOpenCodeGoKey(options.home, options.env);
  if (!key) return unavailableRateLimits("opencode", "OpenCode Go not connected");
  try {
    const response = await (options.fetch ?? fetch)("https://opencode.ai/zen/go/v1/usage", {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000), redirect: "error",
    });
    if (response.status === 403) return unavailableRateLimits("opencode", "No OpenCode Go subscription");
    if (response.status === 401) return errorRateLimits("opencode", "OpenCode Go sign-in expired");
    if (!response.ok) return errorRateLimits("opencode", `OpenCode Go usage request failed (${response.status})`);
    let parsed: ProviderRateLimits;
    try { parsed = parseOpencodeGoUsage(await response.json()); }
    catch { return errorRateLimits("opencode", "OpenCode Go response was not JSON"); }
    return parsed.session || parsed.weekly || parsed.monthly ? parsed : errorRateLimits("opencode", "OpenCode Go usage response was unexpected");
  } catch { return errorRateLimits("opencode", "OpenCode Go usage request failed"); }
}
