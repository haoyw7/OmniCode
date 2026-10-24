import { beforeEach, expect, it, vi } from "vitest";
import { remoteRequest as invoke } from "../../connections/model/connections";
import { loadRemoteHostDescriptor } from "../../connections/model/remoteHostMetadata";
import { providerUsageHost } from "./providerUsageSource";
import { fetchPiUsage, piUsageProvider } from "./piUsage";
vi.mock("../../connections/model/connections", () => ({ remoteRequest: vi.fn() }));
vi.mock("../../connections/model/remoteHostMetadata", () => ({ loadRemoteHostDescriptor: vi.fn() }));
vi.mock("./providerUsageSource", () => ({
  providerUsageHost: vi.fn(),
  providerUsageSourceKey: () => "host",
}));
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(providerUsageHost).mockReturnValue({ machineId: "m", environmentId: "e" });
  vi.mocked(loadRemoteHostDescriptor).mockResolvedValue({ capabilities: ["providerAccounts.piUsage.v1"] } as never);
});

it("matches only concrete Pi models from supported billing providers", () => {
  expect(piUsageProvider("pi:anthropic/claude-sonnet-4-6")).toBe("anthropic");
  expect(piUsageProvider("pi:openai-codex/gpt-5.4")).toBe("openai-codex");
  for (const model of [
    undefined,
    "pi:default",
    "pi:anthropic/",
    "omp:anthropic/claude",
    "pi:openai/gpt-5.4",
    "pi:openrouter/anthropic/claude",
  ]) {
    expect(piUsageProvider(model)).toBeNull();
  }
});

it("keeps weekly-only quotas and zero usage without inventing windows or reset credits", async () => {
  vi.mocked(invoke).mockResolvedValue({
    status: "ok",
    windows: {
      session: null,
      weekly: { usedPercent: 0, windowMinutes: 10080, resetsAt: 1790700198000 },
    },
  });
  const result = await fetchPiUsage("openai-codex");
  expect(result).toMatchObject({
    provider: "codex",
    status: "ok",
    session: null,
    weekly: { usedPercent: 0, windowMinutes: 10080, resetsAt: 1790700198000 },
    resetCredits: null,
  });
  expect(invoke).toHaveBeenCalledExactlyOnceWith("m", "providerAccounts.piUsage", {
    provider: "openai-codex",
  });
});

it("rejects malformed IPC values instead of displaying fabricated quota data", async () => {
  for (const response of [
    null,
    {},
    { status: "ok", windows: { session: null, weekly: null } },
    {
      status: "ok",
      windows: {
        session: { usedPercent: NaN, windowMinutes: 300, resetsAt: null },
        weekly: null,
      },
    },
    {
      status: "ok",
      windows: {
        session: { usedPercent: 20, windowMinutes: -1, resetsAt: null },
        weekly: null,
      },
    },
    {
      status: "ok",
      windows: {
        session: { usedPercent: 20, windowMinutes: 300, resetsAt: "bad" },
        weekly: null,
      },
    },
  ]) {
    vi.mocked(invoke).mockResolvedValue(response);
    expect(await fetchPiUsage("anthropic")).toMatchObject({
      status: "error",
      session: null,
      weekly: null,
    });
  }
});

it("does not expose transport errors in the UI", async () => {
  vi.mocked(invoke).mockRejectedValue(
    new Error("secret-like transport detail"),
  );
  const result = await fetchPiUsage("anthropic");
  expect(result.status).toBe("error");
  expect(JSON.stringify(result)).not.toContain("secret-like");
});

it("never reads Pi credentials locally when no Host can answer", async () => {
  vi.mocked(providerUsageHost).mockReturnValue(undefined);
  expect(await fetchPiUsage("anthropic")).toMatchObject({ status: "unavailable", provider: "claude" });
  vi.mocked(providerUsageHost).mockReturnValue({ machineId: "m", environmentId: "e" });
  vi.mocked(loadRemoteHostDescriptor).mockResolvedValue({ capabilities: [] } as never);
  expect(await fetchPiUsage("anthropic")).toMatchObject({ status: "unavailable" });
  expect(invoke).not.toHaveBeenCalled();
});
