// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/model/connections";
import { configureSharedHost } from "../../connections/model/remoteProjects";
import { resolveCodexBinary } from "../../../integrations/harness/core/child";
import { fetchClaudeRateLimits, fetchCodexRateLimits } from "./rateLimitsFetch";
import { idleRateLimits } from "./rateLimits";
import { saveProviderAccount } from "./providerAccounts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../connections/model/connections", () => ({ remoteRequest: vi.fn() }));
vi.mock("../../../integrations/harness/core/child", () => ({ resolveCodexBinary: vi.fn() }));
vi.mock("../../../integrations/harness/providers/codex/codexAccountRequest", () => ({ runCodexAccountRequest: vi.fn() }));

const descriptor = (capabilities = ["providerAccounts.usage.v1"]) => ({
  protocolVersion: 1, environmentId: "host-env", name: "Host", providers: ["codex", "claude"], capabilities,
});
const usage = (provider: "claude" | "codex") => ({
  ...idleRateLimits(provider), status: "ok" as const, updatedAt: Date.now(),
  weekly: { usedPercent: 42, windowMinutes: 10080, resetsAt: null },
});

beforeEach(() => {
  vi.clearAllMocks();
  configureSharedHost("host-env", [], "host-machine");
  vi.mocked(remoteRequest).mockImplementation(async (_machine, method, params) =>
    method === "environment.describe" ? descriptor() : usage((params as { provider: "claude" | "codex" }).provider));
});
afterEach(() => { configureSharedHost(undefined, []); localStorage.clear(); });

it("reads default Codex and Claude accounts from their Host without local CLI probes", async () => {
  expect((await fetchCodexRateLimits()).weekly?.usedPercent).toBe(42);
  expect((await fetchClaudeRateLimits()).weekly?.usedPercent).toBe(42);
  expect(remoteRequest).toHaveBeenCalledWith("host-machine", "providerAccounts.usage", { provider: "codex", accountId: "default", refresh: false });
  expect(remoteRequest).toHaveBeenCalledWith("host-machine", "providerAccounts.usage", { provider: "claude", accountId: "default", refresh: false });
  expect(resolveCodexBinary).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
});

it("keeps named and custom Home accounts on the Host and forwards explicit refresh", async () => {
  saveProviderAccount({ provider: "codex", id: "work", label: "Work", dataHome: "D:/host-profile" });
  expect((await fetchCodexRateLimits("work", true)).status).toBe("ok");
  expect(remoteRequest).toHaveBeenCalledWith("host-machine", "providerAccounts.usage", { provider: "codex", accountId: "work", refresh: true });
  expect(resolveCodexBinary).not.toHaveBeenCalled();
});

it("explains unsupported Hosts without reporting a login failure or probing local credentials", async () => {
  vi.mocked(remoteRequest).mockResolvedValue(descriptor([]));
  expect(await fetchCodexRateLimits()).toMatchObject({ status: "unavailable", error: expect.stringContaining("does not support account usage") });
  expect(remoteRequest).toHaveBeenCalledTimes(1);
  expect(resolveCodexBinary).not.toHaveBeenCalled();
});

it("does not fall back to the desktop after a Host query fails", async () => {
  vi.mocked(remoteRequest).mockImplementation(async (_machine, method) => {
    if (method === "environment.describe") return descriptor();
    throw new Error("Host is offline");
  });
  expect(await fetchClaudeRateLimits()).toMatchObject({ status: "error", error: "Host is offline" });
  expect(invoke).not.toHaveBeenCalled();
});

it("does not fall back to the desktop for an empty Host usage response", async () => {
  vi.mocked(remoteRequest).mockImplementation(async (_machine, method) =>
    method === "environment.describe" ? descriptor() : null);
  expect(await fetchCodexRateLimits()).toMatchObject({ status: "error", error: "Usage unavailable" });
  expect(resolveCodexBinary).not.toHaveBeenCalled();
});

it("rejects a late usage reading after the execution Host changes", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(remoteRequest).mockImplementation(async (_machine, method) =>
    method === "environment.describe" ? descriptor() : new Promise(resolve => { finish = resolve; }));
  const pending = fetchCodexRateLimits();
  await vi.waitFor(() => expect(finish).toBeDefined());
  configureSharedHost("other-env", [], "other-machine");
  finish(usage("codex"));
  expect(await pending).toMatchObject({ status: "error", error: "Host connection changed." });
});
