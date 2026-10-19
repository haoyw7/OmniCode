// @vitest-environment happy-dom
import { invoke } from "@tauri-apps/api/core";
import { saveProviderAccount } from "./providerAccounts";
import { configureSharedHost } from "../../connections/model/remoteProjects";
import { beforeEach, describe, expect, it, vi } from "vitest";

const child = vi.hoisted(() => ({
  live: 0,
  maxLive: 0,
  spawned: [] as string[],
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../platform/tauri/fs", () => ({
  homeDir: async () => "/home/test",
}));
vi.mock("../../../integrations/harness/core/child", () => ({
  resolveCodexBinary: async () => ({ path: "/bin/codex" }),
  spawnChild: async (
    _id: string,
    _path: string,
    _args: string[],
    _cwd: string,
    account: { id: string },
  ) => {
    child.live += 1;
    child.maxLive = Math.max(child.maxLive, child.live);
    child.spawned.push(account.id);
  },
  watchChild: () => undefined,
  unwatchChild: () => {
    child.live = Math.max(0, child.live - 1);
  },
  killChild: async () => undefined,
}));
vi.mock("../../../integrations/harness/core/jsonRpc", () => ({
  JsonRpcClient: class {
    close() {}
    pushLine() {}
    respond() {
      return Promise.resolve();
    }
    notify() {
      return Promise.resolve();
    }
    async request(method: string) {
      if (method === "account/rateLimitResetCredit/consume") return { outcome: "nothingToReset" };
      if (method !== "account/rateLimits/read") return {};
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        rateLimits: {
          primary: { usedPercent: 10, windowDurationMins: 300 },
        },
      };
    }
  },
}));

import { fetchCodexRateLimits, fetchClaudeRateLimits, consumeCodexRateLimitResetCredit } from "./rateLimitsFetch";

describe("fetchCodexRateLimits", () => {
  beforeEach(() => {
    configureSharedHost(undefined, []);
    child.live = 0;
    child.maxLive = 0;
    child.spawned = [];
  });

  it("runs usage probes for different accounts one at a time", async () => {
    const results = await Promise.all([
      fetchCodexRateLimits("default"),
      fetchCodexRateLimits("account-work"),
      fetchCodexRateLimits("account-personal"),
    ]);

    expect(child.maxLive).toBe(1);
    expect(child.spawned).toEqual([
      "default",
      "account-work",
      "account-personal",
    ]);
    expect(results.map((result) => result.session?.usedPercent)).toEqual([
      10, 10, 10,
    ]);
  });
});

it("keeps native CLI queries for a configured built-in Home without a shared Host", async () => {
  configureSharedHost(undefined, []);
  saveProviderAccount({ id: "default", provider: "codex", label: "Default account", dataHome: "/data/codex" });
  saveProviderAccount({ id: "default", provider: "claude", label: "Default account", dataHome: "/data/claude" });
  vi.mocked(invoke).mockResolvedValue({ status: "ok", body: JSON.stringify({ five_hour: { utilization: 20 } }) });
  expect((await fetchCodexRateLimits()).session?.usedPercent).toBe(10);
  expect((await fetchClaudeRateLimits()).session?.usedPercent).toBe(20);
  expect(await consumeCodexRateLimitResetCredit()).toBe("nothingToReset");
  localStorage.clear();
  configureSharedHost(undefined, []);
});

it("never spends Host account reset credits through the desktop environment", async () => {
  configureSharedHost("env", [], "shared-host");
  child.spawned = [];
  await expect(consumeCodexRateLimitResetCredit()).rejects.toThrow("This Host does not support Codex usage resets.");
  await expect(consumeCodexRateLimitResetCredit(undefined, "account-work")).rejects.toThrow("This Host does not support Codex usage resets.");
  expect(child.spawned).toEqual([]);
  configureSharedHost(undefined, []);
});
