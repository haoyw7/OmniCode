import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostProviderUsage } from "./provider-usage";
import { providerUsageProfile } from "./provider-accounts";
import { parseCodexRateLimits } from "../src/features/providers/model/rateLimits";
import { runCodexAccountRequest } from "../src/integrations/harness/providers/codex/codexAccountRequest";

vi.mock("../src/integrations/harness/core/child", () => ({ resolveCodexBinary: async () => ({ path: "/bin/codex" }) }));
vi.mock("../src/integrations/harness/providers/codex/codexAccountRequest", () => ({ runCodexAccountRequest: vi.fn() }));
let dir: string, owner: string, accounts: string;
const snapshot = () => parseCodexRateLimits({ primary: { usedPercent: 30, windowDurationMins: 300 } });
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "host-usage-"));
  owner = join(dir, "desktop-owner.json");
  mkdirSync(join(dir, "provider-accounts", "codex", "work"), { recursive: true });
  accounts = join(dir, "provider-accounts", "accounts.json");
  writeFileSync(owner, JSON.stringify({ desktopDirectory: dir }));
  writeFileSync(accounts, JSON.stringify({ codex: [{ id: "work", label: "Work" }] }));
  for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"])
    vi.stubEnv(key, "");
  vi.stubEnv("CODEX_HOME", dir);
  vi.stubEnv("CLAUDE_CONFIG_DIR", dir);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("resolves builtin, isolated and custom Homes without following the shared default", () => {
  writeFileSync(join(dir, "provider-accounts", "defaults.json"), JSON.stringify({ codex: "work" }));
  expect(providerUsageProfile(owner, "codex", "default").home).toBe(dir);
  expect(providerUsageProfile(owner, "codex", "work").home).toBe(join(dir, "provider-accounts", "codex", "work"));
  writeFileSync(accounts, JSON.stringify({ claude: [{ id: "default", label: "CLI", dataHome: join(dir, "custom") }] }));
  expect(providerUsageProfile(owner, "claude", "default")).toMatchObject({ home: join(dir, "custom"), keychainSelector: join(dir, "custom") });
});

it("deduplicates requests, expires successful snapshots and forces refresh", async () => {
  const probe = vi.fn(async () => snapshot());
  const service = new HostProviderUsage(owner, probe);
  const input = { provider: "codex", accountId: "work" };
  const first = service.read(input);
  expect(service.read({ ...input, refresh: true })).toBe(first);
  await first;
  await service.read(input);
  expect(probe).toHaveBeenCalledTimes(1);
  await service.read({ ...input, refresh: true });
  expect(probe).toHaveBeenCalledTimes(2);
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 300_001);
  await service.read(input);
  expect(probe).toHaveBeenCalledTimes(3);
});

it("invalidates cached credentials and Homes and rejects deleted or malformed selectors", async () => {
  const probe = vi.fn(async () => snapshot());
  const service = new HostProviderUsage(owner, probe);
  const input = { provider: "codex", accountId: "work" };
  await service.read(input);
  writeFileSync(join(dir, "provider-accounts", "codex", "work", "auth.json"), "{}");
  await service.read(input);
  writeFileSync(accounts, JSON.stringify({ codex: [{ id: "work", label: "Work", dataHome: dir }] }));
  await service.read(input);
  expect(probe).toHaveBeenCalledTimes(3);
  writeFileSync(accounts, "{}");
  expect(() => service.read(input)).toThrow("no longer available");
  expect(() => service.read({ provider: "pi", accountId: "default" })).toThrow("Invalid provider account");
  expect(() => service.read({ provider: "codex", accountId: "../work" })).toThrow("Invalid provider account");
  expect(() => service.read({ provider: "codex", accountId: "default", refresh: "yes" })).toThrow("refresh");
});

it("isolates provider and Host caches and does not cache errors", async () => {
  const probe = vi.fn(async () => snapshot());
  const service = new HostProviderUsage(owner, probe);
  await service.read({ provider: "codex", accountId: "default" });
  await service.read({ provider: "claude", accountId: "default" });
  await new HostProviderUsage(owner, probe).read({ provider: "codex", accountId: "default" });
  expect(probe).toHaveBeenCalledTimes(3);
  probe.mockRejectedValue(new Error("secret-token /private/home"));
  expect(await service.read({ provider: "codex", accountId: "work" })).toMatchObject({ status: "error", error: "Usage unavailable" });
  await service.read({ provider: "codex", accountId: "work" });
  expect(probe).toHaveBeenCalledTimes(5);
});

it("uses separate Codex probe IDs per account, returns only normalized data and sanitizes failures", async () => {
  vi.mocked(runCodexAccountRequest).mockResolvedValue({ rateLimits: { primary: { usedPercent: 23, windowDurationMins: 300 } }, token: "secret" });
  const service = new HostProviderUsage(owner);
  const values = await Promise.all([service.read({ provider: "codex", accountId: "default" }), service.read({ provider: "codex", accountId: "work" })]);
  expect(values.map(value => value.session?.usedPercent)).toEqual([23, 23]);
  expect(JSON.stringify(values)).not.toContain("secret");
  expect(JSON.stringify(values)).not.toContain(dir);
  const calls = vi.mocked(runCodexAccountRequest).mock.calls;
  expect(calls.map(call => call[4])).toEqual(["default", "work"]);
  expect(new Set(calls.map(call => call[5])).size).toBe(2);
  vi.mocked(runCodexAccountRequest).mockRejectedValue(new Error("private-token /secret/home"));
  expect(await service.read({ provider: "codex", accountId: "work", refresh: true })).toMatchObject({ error: "Codex usage request failed" });
});

it("does not substitute saved credentials for environment auth or a missing profile", async () => {
  vi.stubEnv("OPENAI_API_KEY", "private-api-key");
  const service = new HostProviderUsage(owner);
  expect(await service.read({ provider: "codex", accountId: "default" })).toMatchObject({ status: "unavailable" });
  writeFileSync(accounts, JSON.stringify({ codex: [{ id: "work", label: "Missing", dataHome: join(dir, "missing") }] }));
  expect(await service.read({ provider: "codex", accountId: "work" })).toMatchObject({ status: "unavailable" });
  expect(runCodexAccountRequest).not.toHaveBeenCalled();
});
