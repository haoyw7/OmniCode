// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { configureSharedHost } from "../../connections/model/remoteProjects";
import { fetchCodexRateLimits } from "./rateLimitsFetch";
import { idleRateLimits, unavailableRateLimits, type ProviderRateLimits } from "./rateLimits";
import { clearCachedRateLimits, getAllRateLimits, getCachedRateLimits, loadRateLimits } from "./rateLimitsCache";

vi.mock("./rateLimitsFetch", () => ({
  fetchCodexRateLimits: vi.fn(), fetchClaudeRateLimits: vi.fn(), fetchOpencodeGoRateLimits: vi.fn(),
}));
const usage = (usedPercent: number): ProviderRateLimits => ({
  ...idleRateLimits("codex"), status: "ok", updatedAt: Date.now(),
  session: { usedPercent, windowMinutes: 300, resetsAt: null },
});

beforeEach(() => {
  configureSharedHost(undefined, []);
  clearCachedRateLimits();
  vi.mocked(fetchCodexRateLimits).mockReset();
});
afterEach(() => { configureSharedHost(undefined, []); clearCachedRateLimits(); });

it("reloads a cached disconnected account when the execution Host becomes available", async () => {
  vi.mocked(fetchCodexRateLimits).mockResolvedValueOnce(unavailableRateLimits("codex", "Codex CLI not found"));
  await loadRateLimits("codex");
  configureSharedHost("env", [], "host");
  vi.mocked(fetchCodexRateLimits).mockResolvedValueOnce(usage(25));
  expect((await loadRateLimits("codex")).session?.usedPercent).toBe(25);
  expect(fetchCodexRateLimits).toHaveBeenCalledTimes(2);
});

it("bypasses the Host's own cache on explicit refresh", async () => {
  configureSharedHost("env", [], "host");
  vi.mocked(fetchCodexRateLimits).mockResolvedValue(usage(25));
  await loadRateLimits("codex", "default", true);
  expect(fetchCodexRateLimits).toHaveBeenCalledExactlyOnceWith("default", true);
});

it("does not let a slow previous Host overwrite the current Host's usage", async () => {
  configureSharedHost("env-a", [], "host-a");
  let finish!: (value: ProviderRateLimits) => void;
  vi.mocked(fetchCodexRateLimits).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const old = loadRateLimits("codex");
  configureSharedHost("env-b", [], "host-b");
  vi.mocked(fetchCodexRateLimits).mockResolvedValueOnce(usage(62));
  await loadRateLimits("codex");
  finish(usage(10));
  await old;
  expect(getCachedRateLimits("codex").session?.usedPercent).toBe(62);
  expect(getAllRateLimits()["codex:default"].session?.usedPercent).toBe(62);
});

it("does not replay a queued refresh on a different Host", async () => {
  configureSharedHost("env-a", [], "host-a");
  let finish!: (value: ProviderRateLimits) => void;
  vi.mocked(fetchCodexRateLimits).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const old = loadRateLimits("codex");
  const queued = loadRateLimits("codex", "default", true);
  configureSharedHost("env-b", [], "host-b");
  vi.mocked(fetchCodexRateLimits).mockResolvedValueOnce(usage(62));
  await loadRateLimits("codex");
  finish(usage(10));
  await Promise.all([old, queued]);
  expect(fetchCodexRateLimits).toHaveBeenCalledTimes(2);
  expect(getCachedRateLimits("codex").session?.usedPercent).toBe(62);
});
