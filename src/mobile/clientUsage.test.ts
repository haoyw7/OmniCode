import { expect, it, vi } from "vitest";
import { HostRequestError, MobileClient, type RpcTransport } from "./client";
import type { MobileStorage } from "./storage";
import { parseCodexRateLimits } from "../features/providers/model/rateLimits";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true }, CapacitorHttp: { post: vi.fn() } }));
function storage(): MobileStorage {
  const values = new Map<string, string>();
  return { get: async key => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); }, remove: async key => { values.delete(key); } };
}
const descriptor = { protocolVersion: 1, environmentId: "host-a", name: "Computer", providers: ["codex"], capabilities: ["providerAccounts.usage.v1"] };

it("sends the selected account and refresh flag through the authenticated RPC", async () => {
  const limits = parseCodexRateLimits({});
  const send = vi.fn<RpcTransport>(async (_url, _token, request) => (request as { method: string }).method === "environment.describe" ? descriptor : limits);
  const client = new MobileClient(storage(), send);
  await client.connect("https://computer.test", "token");
  expect(await client.providerAccountUsage({ provider: "codex", accountId: "work", refresh: true })).toEqual(limits);
  expect(send.mock.calls.at(-1)).toMatchObject(["https://computer.test", "token", { method: "providerAccounts.usage", params: { provider: "codex", accountId: "work", refresh: true } }]);
});

it("supports older Hosts and unsupported-method responses", async () => {
  const send = vi.fn<RpcTransport>(async (_url, _token, request) => {
    if ((request as { method: string }).method === "environment.describe") return { ...descriptor, capabilities: [] };
    throw new Error("should not request");
  });
  const client = new MobileClient(storage(), send);
  await client.connect("https://computer.test", "token");
  expect(await client.providerAccountUsage({ provider: "codex", accountId: "default" })).toBeNull();
  expect(send).toHaveBeenCalledTimes(1);
  send.mockImplementation(async (_url, _token, request) => {
    if ((request as { method: string }).method === "environment.describe") return descriptor;
    throw new HostRequestError("Unsupported host method", 400);
  });
  await client.reconnect();
  expect(await client.providerAccountUsage({ provider: "codex", accountId: "default" })).toBeNull();
});

it("rejects a pending usage response after changing the Host", async () => {
  let finish!: (value: unknown) => void;
  const send: RpcTransport = async (_url, _token, request) => {
    if ((request as { method: string }).method === "environment.describe") return descriptor;
    return new Promise(resolve => { finish = resolve; });
  };
  const client = new MobileClient(storage(), send);
  await client.connect("https://computer.test", "token");
  const pending = client.providerAccountUsage({ provider: "codex", accountId: "work" });
  const rejected = expect(pending).rejects.toThrow("Host connection changed.");
  await client.disconnect();
  finish(parseCodexRateLimits({}));
  await rejected;
});

it("reads a paired environment without switching the active conversation", async () => {
  const send = vi.fn<RpcTransport>(async (url, _token, request) => {
    if ((request as { method: string }).method === "environment.describe") return { ...descriptor, environmentId: url.includes("other") ? "host-b" : "host-a", capabilities: ["usage.v1"] };
    return [];
  });
  const client = new MobileClient(storage(), send);
  await client.connect("https://computer.test", "token-a");
  const paired = { ...client.connection!, endpoint: "https://other.test", environmentId: "host-b", token: "token-b" };
  expect(await client.usageRequest(paired, "usage.limits", { refresh: true })).toEqual([]);
  expect(client.connection!.environmentId).toBe("host-a");
  expect(send.mock.calls.at(-1)).toMatchObject(["https://other.test", "token-b", { method: "usage.limits", params: { refresh: true } }, { timeoutMs: 120_000 }]);
});
it("refuses unified usage on older Hosts or when a paired Host changes identity", async () => {
  const send = vi.fn<RpcTransport>(async () => descriptor);
  const client = new MobileClient(storage(), send);
  await client.connect("https://computer.test", "token");
  await expect(client.usageRequest(client.connection!, "usage.limits", {})).rejects.toThrow("does not support usage");
  await expect(client.usageRequest({ ...client.connection!, endpoint: "https://other.test", environmentId: "host-b" }, "usage.summary", {})).rejects.toThrow("identity changed");
  expect(send.mock.calls.every(call => (call[2] as { method: string }).method === "environment.describe")).toBe(true);
});
