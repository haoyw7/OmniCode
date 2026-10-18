import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchHostClaudeUsage, claudeUsageKeychainService } from "./claude-usage";

const keychain = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: keychain }));

let dir: string;
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const fetcher = vi.fn();
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "claude-usage-"));
  vi.stubGlobal("fetch", fetcher);
  keychain.mockImplementation((_file, _args, _options, callback) => callback(new Error("not found")));
  Object.defineProperty(process, "platform", { value: "linux" });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  Object.defineProperty(process, "platform", platform);
  vi.restoreAllMocks();
  fetcher.mockReset();
  keychain.mockReset();
});
function login(expiresAt = Date.now() + 60_000) {
  const path = join(dir, ".credentials.json");
  writeFileSync(path, JSON.stringify({ claudeAiOauth: { accessToken: "private-token", refreshToken: "private-refresh", expiresAt } }));
  return path;
}

it("queries the selected OAuth login without writing credentials or exposing secrets", async () => {
  const path = login();
  const before = readFileSync(path, "utf8");
  fetcher.mockResolvedValue(new Response(JSON.stringify({ five_hour: { utilization: 30 }, seven_day: { utilization: 65 } })));
  const result = await fetchHostClaudeUsage(dir);
  expect(result.session?.usedPercent).toBe(30);
  expect(result.weekly?.usedPercent).toBe(65);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer private-token" }, redirect: "error" });
  expect(JSON.stringify(result)).not.toContain("private");
  expect(readFileSync(path, "utf8")).toBe(before);
});

it("reports absent and expired credentials without network calls", async () => {
  expect(await fetchHostClaudeUsage(dir)).toMatchObject({ status: "unavailable", error: "Claude not signed in" });
  login(Date.now() - 1);
  expect(await fetchHostClaudeUsage(dir)).toMatchObject({ status: "error", error: "Claude sign-in expired" });
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([401, 403, 429, 500])("sanitizes HTTP %i errors", async status => {
  login();
  fetcher.mockResolvedValue(new Response("private-response", { status }));
  const result = await fetchHostClaudeUsage(dir);
  expect(result.status).toBe("error");
  expect(JSON.stringify(result)).not.toContain("private");
  expect(result.error).toBe(status === 401 ? "Claude sign-in expired" : status === 403 ? "Claude usage is unavailable for this account" : "Claude usage request failed");
});

it("reports malformed responses and network timeouts without raw error objects", async () => {
  login();
  fetcher.mockResolvedValue(new Response("{invalid"));
  expect(await fetchHostClaudeUsage(dir)).toMatchObject({ status: "error", error: "Claude usage response was unexpected" });
  fetcher.mockRejectedValue(new Error("timeout private-token"));
  expect(await fetchHostClaudeUsage(dir)).toMatchObject({ status: "error", error: "Claude usage request failed" });
});

it("matches the desktop Keychain selector and NFC normalization", () => {
  expect(claudeUsageKeychainService()).toBe("Claude Code-credentials");
  expect(claudeUsageKeychainService("/tmp/profile")).toBe("Claude Code-credentials-902e721c");
  expect(claudeUsageKeychainService("/tmp/e\u0301")).toBe(claudeUsageKeychainService("/tmp/é"));
});

it("reads only the selected macOS Keychain service and falls back to its own file", async () => {
  Object.defineProperty(process, "platform", { value: "darwin" });
  const selector = "/tmp/profile";
  keychain.mockImplementationOnce((_file, _args, _options, callback) => callback(null, {
    stdout: JSON.stringify({ claudeAiOauth: { accessToken: "keychain-token" } }), stderr: "",
  }));
  fetcher.mockImplementation(async () => new Response(JSON.stringify({ five_hour: { utilization: 20 } })));
  expect((await fetchHostClaudeUsage(dir, selector)).session?.usedPercent).toBe(20);
  expect(keychain.mock.calls[0].slice(0, 2)).toEqual(["security", ["find-generic-password", "-s", "Claude Code-credentials-902e721c", "-w"]]);
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer keychain-token");
  login();
  expect((await fetchHostClaudeUsage(dir, selector)).session?.usedPercent).toBe(20);
  expect(fetcher.mock.calls[1][1].headers.Authorization).toBe("Bearer private-token");
  expect(keychain.mock.calls.every(call => call[1].includes("Claude Code-credentials-902e721c"))).toBe(true);
});
