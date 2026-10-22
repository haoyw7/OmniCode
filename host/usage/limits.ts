import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { HostProviderUsage } from "../provider-usage";
import { desktopProviderAccounts } from "../provider-accounts";
import {
  usageObject as object,
  type UsageLimitSource,
  type UsageLimitWindow,
} from "../../src/integrations/harness/core/usage";
import { cursorToken, cursorAccountKey } from "./cursor";
import { usageJson } from "./http";
import { usageReaders } from "./readers";
import { usageFiles } from "./files";

const jsonFile = async (path: string) =>
  object(JSON.parse(await readFile(path, "utf8")));
const percent = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : null;
const reset = (value: unknown) => {
  const date =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Date.parse(value)
        : NaN;
  return Number.isFinite(date) ? date : undefined;
};
export class UsageLimits {
  private accounts: HostProviderUsage;
  private cached?: { key: string; at: number; sources: UsageLimitSource[] };
  constructor(private readonly owner: string) {
    this.accounts = new HostProviderUsage(owner);
  }
  async reset(params: {
    accountId?: unknown;
    creditId?: unknown;
    idempotencyKey?: unknown;
  }) {
    const result = await this.accounts.consumeReset(params);
    this.cached = undefined;
    return result;
  }
  async read(refresh: boolean, keychain: boolean): Promise<UsageLimitSource[]> {
    const accounts = desktopProviderAccounts(this.owner);
    const key = JSON.stringify([accounts, keychain]);
    if (
      !refresh &&
      this.cached?.key === key &&
      Date.now() - this.cached.at < 300_000
    )
      return this.cached.sources;
    const sources: UsageLimitSource[] = [];
    const probes = (["claude", "codex"] as const).flatMap((provider) =>
      (accounts[provider] ?? [{ id: "default", label: provider }]).map(
        (account) => async () => {
          const identity = "identity" in account ? account.identity : undefined;
          const source: UsageLimitSource = {
            id: `${provider}:${account.id}`,
            provider,
            label: account.label,
            accountId: account.id,
            accountKey: identity?.email
              ? createHash("sha256")
                  .update(`${provider}:${identity.email.trim().toLowerCase()}`)
                  .digest("hex")
              : undefined,
            email: identity?.email,
            plan: identity?.plan,
            status: "unavailable",
            windows: [],
          };
          try {
            const limits = await this.accounts.read({
              provider,
              accountId: account.id,
              refresh,
            });
            for (const id of ["session", "weekly", "monthly"] as const) {
              const value = limits[id];
              if (value)
                source.windows.push({
                  id,
                  label:
                    id === "session"
                      ? "5h"
                      : id === "weekly"
                        ? "Weekly"
                        : "Monthly",
                  usedPercent: value.usedPercent,
                  resetsAt: value.resetsAt ?? undefined,
                  windowDurationMins: value.windowMinutes,
                });
            }
            for (const scoped of limits.modelScopedWindows ?? [])
              source.windows.push({
                id: scoped.id,
                label: "Weekly",
                scopeLabel: scoped.model,
                usedPercent: scoped.window.usedPercent,
                resetsAt: scoped.window.resetsAt ?? undefined,
                windowDurationMins: scoped.window.windowMinutes,
              });
            source.status = source.windows.length
              ? "ok"
              : limits.status === "error"
                ? "error"
                : "unavailable";
            source.message = limits.error ?? undefined;
            source.updatedAt = limits.updatedAt;
            if (limits.resetCredits)
              source.resetCreditsAvailable = limits.resetCredits.availableCount;
          } catch {
            source.message = "Usage limits are unavailable for this account.";
          }
          return source;
        },
      ),
    );
    for (const provider of [
      "cursor",
      "opencode",
      "grok",
      "antigravity",
    ] as const)
      probes.push(async () => {
        const source: UsageLimitSource = {
          id: provider,
          provider,
          label: provider === "opencode" ? "OpenCode Go" : "",
          status: "unavailable",
          windows: [],
        };
        try {
          source.windows =
            provider === "cursor"
              ? await cursorLimits(keychain, source)
              : provider === "opencode"
                ? await openCodeLimits()
                : provider === "grok"
                  ? await grokLimits()
                  : await antigravityLimits(this.owner);
          source.status = source.windows.length ? "ok" : "unavailable";
          if (!source.windows.length)
            source.message =
              provider === "cursor" &&
              process.platform === "darwin" &&
              !keychain
                ? "Enable Cursor Keychain access to read account usage."
                : "Subscription limits require a supported provider login.";
        } catch {
          source.status = "error";
          source.message = "Unable to refresh usage limits.";
        }
        return source;
      });
    // Keep CLI probes bounded rather than starting an app-server per account at once.
    let next = 0;
    const run = async () => {
      while (next < probes.length) {
        const index = next++;
        sources[index] = await probes[index]();
      }
    };
    await Promise.all([run(), run()]);
    sources.push(
      ...(["pi", "omp"] as const).map((provider) => ({
        id: provider,
        provider,
        label: "",
        status: "unavailable" as const,
        windows: [],
        message: "This provider does not report subscription limits.",
      })),
    );
    this.cached = { key, at: Date.now(), sources };
    return sources;
  }
}
async function cursorLimits(
  keychain: boolean,
  source: UsageLimitSource,
): Promise<UsageLimitWindow[]> {
  const token = await cursorToken(keychain);
  if (!token) return [];
  source.accountKey = cursorAccountKey(token);
  source.updatedAt = Date.now();
  // Keep dashboard credentials on the first-party endpoint.
  if (
    process.env.CURSOR_API_ENDPOINT &&
    process.env.CURSOR_API_ENDPOINT.replace(/\/$/, "") !==
      "https://api2.cursor.sh"
  )
    return [];
  const body = await usageJson(
    "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "connect-protocol-version": "1",
        "x-cursor-client-type": "cli",
      },
      body: "{}",
    },
  );
  const plan = object(body.planUsage),
    windows: UsageLimitWindow[] = [];
  for (const [id, label] of [
    ["autoPercentUsed", "Auto"],
    ["apiPercentUsed", "API"],
  ]) {
    const usedPercent = percent(plan[id]);
    if (usedPercent !== null)
      windows.push({
        id,
        label,
        usedPercent,
        resetsAt: reset(Number(body.billingCycleEnd)),
      });
  }
  return windows;
}
async function openCodeLimits(): Promise<UsageLimitWindow[]> {
  const env = process.env;
  if (env.OPENCODE_SERVER_URL) return [];
  const root = join(
    env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
    "opencode",
  );
  const auth = env.OPENCODE_AUTH_CONTENT
    ? object(JSON.parse(env.OPENCODE_AUTH_CONTENT))
    : await jsonFile(join(root, "auth.json")).catch(() => ({}));
  const go = object(object(auth)["opencode-go"]);
  const goKey =
    go.type === "api" && typeof go.key === "string"
      ? go.key
      : env.OPENCODE_API_KEY;
  let consoleKey: string | undefined;
  if (!env.OPENCODE_AUTH_CONTENT && env.OPENCODE_DB !== ":memory:") {
    try {
      const db = new DatabaseSync(
        join(root, env.OPENCODE_DB || "opencode.db"),
        { readOnly: true },
      );
      try {
        db.exec("PRAGMA busy_timeout = 100");
        const row = db
          .prepare(
            "SELECT value FROM credential WHERE integration_id = 'opencode' AND active IS NOT 0 ORDER BY active DESC, time_created DESC, id DESC LIMIT 1",
          )
          .get();
        const value = object(JSON.parse(String(row?.value))),
          server = object(value.metadata).server;
        if (
          value.type === "key" &&
          typeof value.key === "string" &&
          (server === undefined ||
            String(server).replace(/\/$/, "") === "https://opencode.ai/console")
        )
          consoleKey = value.key;
      } finally {
        db.close();
      }
    } catch {
      /* Legacy installations only have auth.json. */
    }
  }
  if (!consoleKey && !goKey) return [];
  const request = (key: string) =>
    usageJson("https://opencode.ai/zen/go/v1/usage", {
      headers: { Authorization: `Bearer ${key}` },
    });
  const body = await request(consoleKey || goKey!).catch((error) =>
    goKey && consoleKey && goKey !== consoleKey
      ? request(goKey)
      : Promise.reject(error),
  );
  return ["rolling", "weekly", "monthly"].flatMap((id) => {
    const usage = object(object(body.usage)[id]),
      usedPercent = percent(usage.percent);
    return usedPercent === null
      ? []
      : [
          {
            id,
            label:
              id === "rolling" ? "5h" : id === "weekly" ? "Weekly" : "Monthly",
            usedPercent,
            resetsAt: reset(usage.resetsAt),
          },
        ];
  });
}
async function grokLimits(): Promise<UsageLimitWindow[]> {
  const env = process.env;
  if (
    env.XAI_API_KEY ||
    Object.keys(env).some(
      (key) =>
        /^(GROK_(OIDC_|OAUTH2_|AUTH_PROVIDER_|LOCAL_AUTH|CLI_CHAT_PROXY_BASE_URL|MODELS_BASE_URL|CONFIG))/.test(
          key,
        ) && env[key],
    )
  )
    return [];
  const home = env.GROK_HOME || join(homedir(), ".grok");
  for (const path of [
    join(home, "config.toml"),
    join(home, "managed_config.toml"),
    join(home, "requirements.toml"),
    "/etc/grok/managed_config.toml",
    "/etc/grok/requirements.toml",
  ]) {
    const text = await readFile(path, "utf8").catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    });
    if (
      /^\s*(?:\[\[?\s*)?["']?(?:auth|grok_com_config|endpoints)["']?\s*[.\]=]/m.test(
        text,
      )
    )
      return [];
  }
  const auth = env.GROK_AUTH
    ? object(JSON.parse(env.GROK_AUTH))
    : await jsonFile(join(home, "auth.json")).catch(() => ({}));
  const credential = object(
    object(auth)["https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828"] ??
      object(auth)["https://accounts.x.ai/sign-in"],
  );
  if (
    credential.auth_mode === "api_key" ||
    typeof credential.key !== "string" ||
    !credential.key
  )
    return [];
  const body = await usageJson(
    "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
    { headers: { Authorization: `Bearer ${credential.key}` } },
  );
  const config = object(body.config),
    period = object(config.currentPeriod);
  const usedPercent = percent(
    config.creditUsagePercent ??
      (typeof period.start === "string" &&
      Date.parse(period.start) < Number(reset(period.end))
        ? 0
        : undefined),
  );
  return usedPercent === null
    ? []
    : [
        {
          id: "subscription",
          label: String(period.type).includes("WEEKLY")
            ? "Weekly"
            : String(period.type).includes("MONTHLY")
              ? "Monthly"
              : "Subscription",
          usedPercent,
          resetsAt: reset(period.end),
        },
      ];
}
async function antigravityLimits(owner: string): Promise<UsageLimitWindow[]> {
  let token: Record<string, unknown> | undefined;
  for (const reader of (await usageReaders(owner)).filter(
    (reader) => reader.provider === "antigravity",
  )) {
    try {
      for await (const path of usageFiles(
        reader.path,
        (name) => name === "acp_token.json",
      )) {
        token = await jsonFile(path);
        break;
      }
    } catch {
      /* A missing profile is normal. */
    }
    if (token) break;
  }
  if (
    !token ||
    !["client_id", "client_secret", "refresh_token"].every(
      (key) => typeof token![key] === "string" && token![key],
    )
  )
    return [];
  const refreshed = await usageJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: String(token.client_id),
      client_secret: String(token.client_secret),
      refresh_token: String(token.refresh_token),
      grant_type: "refresh_token",
    }).toString(),
  });
  if (typeof refreshed.access_token !== "string")
    throw new Error("Invalid Antigravity login");
  const windows = new Map<string, UsageLimitWindow>();
  for (const endpoint of [
    "https://daily-cloudcode-pa.googleapis.com",
    "https://cloudcode-pa.googleapis.com",
  ]) {
    for (const operation of [
      "retrieveUserQuotaSummary",
      "fetchAvailableModels",
    ]) {
      try {
        const body = await usageJson(`${endpoint}/v1internal:${operation}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${refreshed.access_token}`,
            "Content-Type": "application/json",
            "User-Agent": `antigravity/hub/1.0.0 (aidev_client; os_type=${process.platform}; arch=${process.arch}; cl=963137146)`,
          },
          body: JSON.stringify(
            token.project_id ? { project: token.project_id } : {},
          ),
        });
        const groups = Array.isArray(body.groups)
          ? body.groups.flatMap((group) =>
              Array.isArray(object(group).buckets)
                ? (object(group).buckets as unknown[])
                : [],
            )
          : [];
        const buckets = groups.length
          ? groups
          : Array.isArray(body.buckets)
            ? body.buckets
            : [];
        const quotas = buckets.map((raw) => {
          const item = object(raw);
          return {
            id: String(item.bucketId),
            label:
              `${item.displayName || item.bucketId} ${item.window || ""}`.trim(),
            item,
          };
        });
        for (const [model, value] of Object.entries(object(body.models)))
          for (const [suffix, field] of [
            ["quota", "quotaInfo"],
            ["weekly", "weeklyQuotaInfo"],
          ])
            if (object(value)[field])
              quotas.push({
                id: `${model}:${suffix}`,
                label: `${model} ${suffix === "weekly" ? "Weekly" : "Quota"}`,
                item: object(object(value)[field]),
              });
        for (const { id, label, item } of quotas) {
          if (
            item.disabled ||
            typeof item.remainingFraction !== "number" ||
            !Number.isFinite(item.remainingFraction)
          )
            continue;
          const entry = {
            id,
            label,
            usedPercent:
              100 - Math.max(0, Math.min(1, item.remainingFraction)) * 100,
            resetsAt: reset(item.resetTime),
          };
          if (
            !windows.has(id) ||
            windows.get(id)!.usedPercent < entry.usedPercent
          )
            windows.set(id, entry);
        }
        if (quotas.length) break;
      } catch {
        /* Other endpoint/model quota fallback can still be available. */
      }
    }
  }
  return [...windows.values()];
}
