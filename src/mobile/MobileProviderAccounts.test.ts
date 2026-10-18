// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileProviderAccounts } from "./MobileProviderAccounts";
import type { MobileClient } from "./client";
import type { HostProviderAccounts, HostProviderUsage } from "../features/connections/model/protocol";
import { parseCodexRateLimits, errorRateLimits, parseClaudeOAuthUsage } from "../features/providers/model/rateLimits";
import { setUiLanguage } from "../shared/i18n/language";
import { SurfaceVisibilityContext } from "../shared/ui/SurfaceVisibility";

let root: Root, node: HTMLDivElement;
const limits = (): HostProviderUsage => ({ ...parseCodexRateLimits({ primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: Date.now() + 3600_000 } }), updatedAt: 1_700_000_000_000 });
const accounts = (): HostProviderAccounts => ({
  codex: [
    { id: "default", label: "Default account", identity: { email: "builtin@example.test", plan: "free" }, defaultAccountId: "work", defaultIdentity: { email: "work@example.test" } },
    { id: "work", label: "工作账号", identity: { email: "work@example.test", plan: "plus" } },
  ],
  claude: [{ id: "default", label: "Claude account", identity: { email: "claude@example.test" } }],
});
let host: {
  connection: { endpoint: string; name: string };
  hasCapability: ReturnType<typeof vi.fn>;
  verify: ReturnType<typeof vi.fn<() => Promise<void>>>;
  providerAccounts: ReturnType<typeof vi.fn<() => Promise<HostProviderAccounts | null>>>;
  providerAccountUsage: ReturnType<typeof vi.fn<(input: { provider: string; accountId: string; refresh?: boolean }) => Promise<HostProviderUsage | null>>>;
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  setUiLanguage("en");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  host = {
    connection: { endpoint: "host-a", name: "Computer A" },
    hasCapability: vi.fn(() => true),
    verify: vi.fn(async () => {}),
    providerAccounts: vi.fn(async () => accounts()),
    providerAccountUsage: vi.fn(async ({ provider }) => provider === "claude"
      ? parseClaudeOAuthUsage(JSON.stringify({ seven_day: { utilization: 85 } })) : limits()),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  setUiLanguage("en");
  localStorage.clear();
  vi.unstubAllGlobals();
});
async function render(hostId = host.connection.endpoint, enabled = true, visible = true) {
  await act(async () => root.render(createElement(SurfaceVisibilityContext.Provider, { value: visible },
    createElement(MobileProviderAccounts, { client: host as unknown as MobileClient, hostId, enabled }))));
}
const refresh = () => node.querySelector<HTMLButtonElement>('button[aria-label="Refresh usage limits"]')!;

it("shows each profile's actual identity, shared default badge and remaining windows", async () => {
  await render();
  const builtin = node.querySelector('article[aria-label="Built-in CLI profile"]')!;
  expect(builtin.textContent).toContain("builtin@example.test");
  expect(builtin.textContent).not.toContain("work@example.test");
  expect(builtin.querySelector(".mobile-account-badge")).toBeNull();
  expect(node.querySelector('article[aria-label="工作账号"] .mobile-account-badge')?.getAttribute("aria-label")).toBe("Default for new conversations");
  expect(node.textContent).toContain("77% left");
  expect(node.textContent).toContain("15% left");
  expect(node.querySelectorAll('[role="progressbar"]')).toHaveLength(3);
  expect(node.querySelector('[aria-label="Reveal email"]')).toBeNull();
  expect(builtin.querySelector(".mobile-account-identity")?.textContent).toBe("builtin@example.test");
  expect(host.providerAccountUsage).toHaveBeenCalledTimes(3);
});

it("refreshes the account list and retains the last successful snapshot on partial failure", async () => {
  await render();
  const oldTime = node.querySelector('article[aria-label="工作账号"]')!.textContent!.match(/Updated .*/)?.[0];
  host.providerAccountUsage.mockImplementation(async ({ provider }) => errorRateLimits(provider as "codex" | "claude", "Unable to refresh account usage."));
  await act(async () => refresh().click());
  expect(host.verify).toHaveBeenCalledTimes(1);
  expect(host.providerAccounts).toHaveBeenCalledTimes(2);
  expect(host.providerAccountUsage.mock.calls.slice(3).every(([input]) => input.refresh)).toBe(true);
  expect(node.querySelector('article[aria-label="工作账号"]')?.textContent).toContain(oldTime!);
  expect(node.textContent).toContain("77% left");
  expect(node.textContent).toContain("Unable to refresh account usage.");
  expect(refresh().disabled).toBe(false);
});

it("renders successful accounts while another account is still loading", async () => {
  let complete!: (value: HostProviderUsage) => void;
  host.providerAccountUsage.mockImplementation(async ({ provider }) => provider === "claude"
    ? new Promise(resolve => { complete = resolve; }) : limits());
  await render();
  expect(node.textContent).toContain("77% left");
  expect(node.textContent).toContain("Checking…");
  expect(refresh().disabled).toBe(true);
  await act(async () => complete(errorRateLimits("claude", "Claude sign-in expired")));
  expect(node.textContent).toContain("Claude sign-in expired");
  expect(refresh().disabled).toBe(false);
});

it("keeps metadata on old Hosts without attempting quota requests", async () => {
  host.hasCapability.mockReturnValue(false);
  await render();
  expect(node.textContent).toContain("Host update required");
  expect(node.textContent).toContain("Update and restart it, then refresh.");
  expect(node.textContent).toContain("工作账号");
  expect(node.textContent).not.toContain("Checking…");
  expect(node.querySelectorAll(".mobile-account-status")).toHaveLength(0);
  expect(host.verify).toHaveBeenCalledTimes(1);
  expect(host.providerAccountUsage).not.toHaveBeenCalled();
});

it("rechecks stale capabilities when opening the page after a Host upgrade", async () => {
  host.hasCapability.mockReturnValue(false);
  host.verify.mockImplementation(async () => { host.hasCapability.mockReturnValue(true); });
  await render();
  expect(host.verify).toHaveBeenCalledTimes(1);
  expect(node.textContent).not.toContain("Host update required");
  expect(node.textContent).toContain("77% left");
});

it("recovers from an unsupported method after upgrading the Host and refreshing", async () => {
  host.providerAccountUsage.mockResolvedValue(null);
  await render();
  expect(node.textContent).toContain("Host update required");
  host.providerAccountUsage.mockResolvedValue(limits());
  await act(async () => refresh().click());
  expect(host.verify).toHaveBeenCalledTimes(1);
  expect(node.textContent).not.toContain("Host update required");
  expect(node.textContent).toContain("77% left");
});

it("stops loading when a pending capability recheck outlives the page", async () => {
  let finish!: () => void;
  host.hasCapability.mockReturnValue(false);
  host.verify.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render();
  await render("host-a", true, false);
  await act(async () => finish());
  expect(host.providerAccounts).not.toHaveBeenCalled();
  expect(host.providerAccountUsage).not.toHaveBeenCalled();
});

it("handles missing account support and an empty catalog", async () => {
  host.providerAccounts.mockResolvedValue(null);
  await render();
  expect(node.textContent).toContain("Provider accounts are unavailable");
  host.providerAccounts.mockResolvedValue({});
  await act(async () => refresh().click());
  expect(node.textContent).toContain("No shared accounts");
});

it("clears disconnected data and reloads on reconnect", async () => {
  await render();
  await render("host-a", false);
  expect(node.querySelectorAll("article")).toHaveLength(0);
  expect(node.textContent).toContain("Connect to a Host");
  expect(refresh().disabled).toBe(true);
  await render();
  expect(host.providerAccounts).toHaveBeenCalledTimes(2);
  expect(node.textContent).toContain("77% left");
});

it("ignores late results and queued work after switching Hosts or leaving the page", async () => {
  const pending: Array<(value: HostProviderUsage) => void> = [];
  host.providerAccountUsage.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  await render();
  expect(pending).toHaveLength(2);
  host.connection = { endpoint: "host-b", name: "Computer B" };
  host.providerAccounts.mockResolvedValue({ codex: [{ id: "work", label: "Host B only" }] });
  host.providerAccountUsage.mockResolvedValue(errorRateLimits("codex", "Codex not signed in"));
  await render("host-b");
  await act(async () => pending.forEach(resolve => resolve(limits())));
  expect(node.textContent).toContain("Host B only");
  expect(node.textContent).not.toContain("77% left");
  expect(host.providerAccountUsage).toHaveBeenCalledTimes(3);
  await render("host-b", true, false);
  expect(refresh().disabled).toBe(true);
  expect(host.providerAccountUsage).toHaveBeenCalledTimes(3);
});

it("localizes labels without changing user labels or provider identity", async () => {
  await render();
  await act(async () => setUiLanguage("zh-CN"));
  expect(node.textContent).toContain("内置");
  expect(node.textContent).toContain("工作账号");
  expect(node.textContent).toContain("work@example.test");
  expect(node.querySelector('[aria-label="显示邮箱"]')).toBeNull();
  expect(host.providerAccounts).toHaveBeenCalledTimes(1);
});
