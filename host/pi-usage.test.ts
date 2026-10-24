import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchHostPiUsage, parsePiUsage, piAgentDir } from "./pi-usage";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function agent(auth: unknown, models?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "omnicode-pi-usage-"));
  dirs.push(dir);
  writeFileSync(join(dir, "auth.json"), JSON.stringify(auth));
  if (models !== undefined) writeFileSync(join(dir, "models.json"), JSON.stringify(models));
  return dir;
}
const future = Date.now() + 3_600_000;
const ok = async () => ({ status: "ok" as const, windows: { session: null, weekly: { usedPercent: 1, windowMinutes: 10080, resetsAt: null } } });

it("reads only the selected Pi credential and never writes it", async () => {
  const dir = agent({ "openai-codex": { type: "oauth", access: "pi-codex", expires: future, accountId: "pi-account" } });
  const before = readFileSync(join(dir, "auth.json"));
  const request = vi.fn(ok);
  expect(await fetchHostPiUsage("openai-codex", { dir, request })).toMatchObject({ status: "ok" });
  expect(request).toHaveBeenCalledWith("openai-codex", { access: "pi-codex", expires: future, accountId: "pi-account" }, "https://chatgpt.com/backend-api/wham/usage");
  expect(readFileSync(join(dir, "auth.json"))).toEqual(before);
  expect(readdirSync(dir)).toEqual(["auth.json"]);
});

it("never requests usage for ineligible credentials or custom endpoints", async () => {
  const request = vi.fn(ok);
  for (const [auth, models] of [
    [{ anthropic: { type: "api_key", key: "x" } }],
    [{ anthropic: { type: "oauth", access: "a", expires: Date.now() - 1 } }],
    [{ "openai-codex": { type: "oauth", access: "a", expires: future } }],
    [{ anthropic: { type: "oauth", access: "a", expires: future } }, { providers: { anthropic: { baseUrl: "https://proxy" } } }],
    [{ anthropic: { type: "oauth", access: "a", expires: future } }, { providers: { anthropic: { models: [{ id: "m", headers: {} }] } } }],
  ] as const) {
    const provider = "openai-codex" in auth ? "openai-codex" : "anthropic";
    expect((await fetchHostPiUsage(provider, { dir: agent(auth, models), request })).status).not.toBe("ok");
  }
  expect(request).not.toHaveBeenCalled();
  await expect(fetchHostPiUsage("openai", { dir: agent({}), request })).rejects.toThrow("Invalid");
});

it("discards a response when Pi rotated the credential meanwhile", async () => {
  const dir = agent({ anthropic: { type: "oauth", access: "first", expires: future } });
  const result = await fetchHostPiUsage("anthropic", { dir, request: async () => {
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ anthropic: { type: "oauth", access: "second", expires: future } }));
    return ok();
  } });
  expect(result).toMatchObject({ status: "error" });
});

it("matches Pi's directory override semantics", () => {
  expect(piAgentDir("relative-pi", "/home/u")).toBeUndefined();
  expect(piAgentDir("~/custom", "/home/u")).toBe(join("/home/u", "custom"));
  expect(piAgentDir(undefined, "/home/u")).toBe(join("/home/u", ".pi", "agent"));
});

it("parses provider windows without labeling a weekly primary as five-hour", () => {
  expect(parsePiUsage("anthropic", JSON.stringify({ five_hour: { utilization: 0, resets_at: null }, seven_day: { utilization: 10, resets_at: "2026-10-01T00:00:00Z" }, email: "private@example.com" })))
    .toEqual({ status: "ok", windows: { session: { usedPercent: 0, windowMinutes: 300, resetsAt: null }, weekly: { usedPercent: 10, windowMinutes: 10080, resetsAt: Date.parse("2026-10-01T00:00:00Z") } } });
  expect(parsePiUsage("openai-codex", JSON.stringify({ rate_limit: { primary_window: { used_percent: 32, limit_window_seconds: 604800, reset_at: 1790700198 } } })))
    .toEqual({ status: "ok", windows: { session: null, weekly: { usedPercent: 32, windowMinutes: 10080, resetsAt: 1790700198000 } } });
  expect(parsePiUsage("anthropic", "{}")).toMatchObject({ status: "error" });
});
