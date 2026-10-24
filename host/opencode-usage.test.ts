import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fetchHostOpenCodeUsage, readOpenCodeGoKey } from "./opencode-usage";
let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "omnicode-go-usage-")); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

it("preserves authoritative auth precedence and accepts JSONC config with environment references", async () => {
  const directory = join(home, ".config", "opencode");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "opencode.jsonc"), '{ // config\n "provider": {"opencode-go": {"options": {"apiKey": "{env:GO_KEY}",},},},}');
  const env = { GO_KEY: "host-only-key" };
  expect(await readOpenCodeGoKey(home, env)).toBe("host-only-key");
  expect(await readOpenCodeGoKey(home, { ...env, OPENCODE_AUTH_CONTENT: "{}" })).toBeUndefined();
  expect(await readOpenCodeGoKey(home, { ...env, OPENCODE_AUTH_CONTENT: '{"opencode-go":{"key":"injected"}}' })).toBe("injected");
});

it("falls back to the legacy credential location only when the primary file cannot be read", async () => {
  const legacy = join(home, "Library", "Application Support", "opencode");
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, "auth.json"), '{"opencode-go":{"key":"legacy"}}');
  expect(await readOpenCodeGoKey(home, {})).toBe("legacy");
  const primary = join(home, ".local", "share", "opencode");
  mkdirSync(primary, { recursive: true });
  writeFileSync(join(primary, "auth.json"), "{}");
  expect(await readOpenCodeGoKey(home, {})).toBeUndefined();
});

it("returns only normalized usage and keeps credentials out of errors and responses", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ usage: { rolling: { status: "ok", percent: 42 } } })));
  const options = { home, env: { OPENCODE_AUTH_CONTENT: '{"opencode-go":{"key":"secret-key"}}' }, fetch: fetcher };
  const usage = await fetchHostOpenCodeUsage(options);
  expect(usage.session?.usedPercent).toBe(42);
  expect(JSON.stringify(usage)).not.toContain("secret-key");
  expect(fetcher.mock.calls[0][1]?.headers).toEqual({ Authorization: "Bearer secret-key" });
  fetcher.mockResolvedValueOnce(new Response("secret-key", { status: 403 }));
  expect(await fetchHostOpenCodeUsage(options)).toMatchObject({ status: "unavailable", error: "No OpenCode Go subscription" });
  fetcher.mockRejectedValueOnce(new Error("failed secret-key"));
  expect(await fetchHostOpenCodeUsage(options)).toMatchObject({ status: "error", error: "OpenCode Go usage request failed" });
});
