// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ProviderAccounts } from "./ProviderAccounts";
import { useProviderAccounts } from "./useProviderAccounts";
import { configureSharedHost } from "../../../../connections/model/remoteProjects";
import { refreshUiLanguage, UI_LANGUAGE_KEY } from "../../../../../shared/i18n/language";
import type { DeepseekAccount } from "../../../../../integrations/harness/providers/deepseek/deepseekAccount";
import { SurfaceVisibilityContext } from "../../../../../shared/ui/SurfaceVisibility";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => path, isTauri: () => false }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true) }));
vi.mock("../../../../../integrations/harness/core/auth", () => ({ loginHarness: vi.fn(async () => {}) }));
vi.mock("../../../../providers/model/accountUsage", async original => ({ ...await original<typeof import("../../../../providers/model/accountUsage")>(), useProviderAccountUsage: () => ({ usage: {}, now: Date.now(), refreshing: false, refresh: () => {} }),
  accountStatus: () => ({ tone: "neutral", label: "Unknown", rank: 0 }), accountHeadroom: () => undefined }));
let root: Root;
let container: HTMLDivElement;
let calls: { method: string; params: Record<string, unknown> }[];
let snapshot: { revision: number; accounts: Record<string, { id: string; label: string; identity?: { email: string } }[]>; defaults: Record<string, string> };
let deepseek: DeepseekAccount;
let deepseekSupported: boolean;
let deepseekFailed: boolean;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); localStorage.setItem(UI_LANGUAGE_KEY, "en"); refreshUiLanguage();
  configureSharedHost("env", [], "shared-machine");
  calls = [];
  deepseek = { status: "signed-out" };
  deepseekSupported = true;
  deepseekFailed = false;
  snapshot = { revision: 1, accounts: { codex: [{ id: "default", label: "Default account" }, { id: "work", label: "Host work", identity: { email: "work@example.test" } }], claude: [{ id: "default", label: "Default account" }] }, defaults: { codex: "work" } };
  vi.mocked(invoke).mockReset().mockImplementation(async (command, args) => {
    if (command !== "remote_request") throw new Error("Native accounts must not be used");
    const input = args as { method: string; params: Record<string, unknown> };
    calls.push(input);
    if (input.method === "environment.describe") return { protocolVersion: 1, environmentId: "env", name: "Host", providers: ["codex", "claude", "deepseek"], capabilities: ["providerAccounts.manage.v1", ...(deepseekSupported ? ["providerAccounts.deepseek.v1"] : [])] };
    if (input.method === "providerAccounts.deepseek") {
      if (deepseekFailed) throw new Error("private provider error");
      return deepseek;
    }
    if (input.method === "providerAccounts.list") return snapshot.accounts;
    if (input.method === "providerAccounts.save") {
      snapshot.revision++;
      const row = snapshot.accounts[String(input.params.provider)].find(row => row.id === input.params.accountId)!;
      row.label = String(input.params.label);
    }
    return structuredClone(snapshot);
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
/** Settings shares one account controller between the Codex and DeepSeek details. */
function ProviderAccountsSettings() {
  const controller = useProviderAccounts();
  return createElement(Fragment, null,
    createElement(ProviderAccounts, { provider: "codex", controller }),
    createElement(ProviderAccounts, { provider: "deepseek", controller }));
}
it("renders Host identity and renames an account without resetting its private Home", async () => {
  await act(async () => root.render(createElement(ProviderAccountsSettings)));
  expect(container.textContent).toContain("Host work");
  expect(container.textContent).toContain("work@example.test");
  expect(container.textContent).toContain("Data Home is managed by Host");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Rename Host work"]')!.click());
  const input = container.querySelector<HTMLInputElement>('[aria-label="Rename Codex account"]')!;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "New label");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => input.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const save = calls.find(call => call.method === "providerAccounts.save");
  expect(save?.params).toMatchObject({ provider: "codex", accountId: "work", label: "New label", operationId: expect.any(String) });
  expect(save?.params).not.toHaveProperty("dataHome");
  expect(vi.mocked(invoke).mock.calls.every(([command]) => command === "remote_request")).toBe(true);
});

const deepseekSection = () => container.querySelector<HTMLElement>('[aria-label="DeepSeek Harness"]')!;
const refresh = () => container.querySelectorAll<HTMLButtonElement>('[aria-label="Refresh usage limits"]')[1]!;

it("shows the DSH account identity and separate wallet balances without changing existing account actions", async () => {
  deepseek = { status: "credential-stored", profileStatus: "ready", profile: { name: "DSH user", contact: "dsh@example.test" },
    balanceStatus: "ready", wallets: [{ currency: "CNY", balance: "12.3400" }, { currency: "USD", balance: "0.00" }],
    bonusWallets: [{ currency: "CNY", balance: "5.50" }] };
  await act(async () => root.render(createElement(ProviderAccountsSettings)));
  expect(deepseekSection().textContent).toContain("DSH user");
  expect(deepseekSection().textContent).toContain("dsh@example.test");
  expect(deepseekSection().textContent).toContain("Signed in");
  expect(deepseekSection().textContent).toContain("Balance: 12.3400 CNY");
  expect(deepseekSection().textContent).toContain("Balance: 0.00 USD");
  expect(deepseekSection().textContent).toContain("Bonus balance: 5.50 CNY");
  expect(deepseekSection().querySelector('button:not([aria-label="Reveal email"])')).toBeNull();
  expect(container.textContent).toContain("Host work");
  expect(calls.find(call => call.method === "providerAccounts.deepseek")?.params).toMatchObject({
    client: { version: expect.any(String), locale: "en", timezoneOffsetSeconds: expect.any(Number) },
  });
});

it("refreshes to a signed-out state and clears old identity and balances on failure", async () => {
  deepseek = { status: "credential-stored", profileStatus: "ready", profile: { name: "Previous user", contact: null },
    balanceStatus: "ready", wallets: [{ currency: "CNY", balance: "9" }] };
  await act(async () => root.render(createElement(ProviderAccountsSettings)));
  deepseekFailed = true;
  await act(async () => refresh().click());
  expect(deepseekSection().textContent).toContain("Unable to read the DeepSeek account.");
  expect(deepseekSection().textContent).not.toContain("private provider error");
  expect(deepseekSection().textContent).not.toContain("Previous user");
  expect(deepseekSection().textContent).not.toContain("Balance:");
  deepseekFailed = false;
  deepseek = { status: "signed-out" };
  await act(async () => refresh().click());
  expect(deepseekSection().textContent).toContain("Not signed in");
  expect(refresh().disabled).toBe(false);
});

it("keeps successful balance data when the profile query fails", async () => {
  deepseek = { status: "credential-stored", profileStatus: "failed", balanceStatus: "ready",
    wallets: [{ currency: "USD", balance: "1.23456789" }] };
  await act(async () => root.render(createElement(ProviderAccountsSettings)));
  expect(deepseekSection().textContent).toContain("Saved sign-in");
  expect(deepseekSection().textContent).toContain("Unable to read the DeepSeek profile.");
  expect(deepseekSection().textContent).toContain("Balance: 1.23456789 USD");
});

it("keeps successful profile data when the balance query fails and translates app-owned copy", async () => {
  localStorage.setItem(UI_LANGUAGE_KEY, "zh-CN"); refreshUiLanguage();
  deepseek = { status: "credential-stored", profileStatus: "ready", profile: { name: "DSH user", contact: null }, balanceStatus: "failed" };
  await act(async () => root.render(createElement(ProviderAccountsSettings)));
  expect(deepseekSection().textContent).toContain("DSH user");
  expect(deepseekSection().textContent).toContain("已登录");
  expect(deepseekSection().textContent).toContain("DeepSeek 余额不可用。");
});

it("explains old Host support without invoking an unsupported account method", async () => {
  deepseekSupported = false;
  await act(async () => root.render(createElement(ProviderAccountsSettings)));
  expect(deepseekSection().textContent).toContain("Update and restart the Host");
  expect(calls.some(call => call.method === "providerAccounts.deepseek")).toBe(false);
  expect(refresh().disabled).toBe(false);
});

it("ignores a hidden page's pending account response and reloads when it becomes visible", async () => {
  const request = vi.mocked(invoke).getMockImplementation()!;
  let complete!: (value: DeepseekAccount) => void;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if ((args as { method?: string })?.method === "providerAccounts.deepseek")
      return new Promise<DeepseekAccount>(resolve => { complete = resolve; });
    return request(command, args);
  });
  const render = (visible: boolean) => root.render(createElement(SurfaceVisibilityContext.Provider, { value: visible },
    createElement(ProviderAccountsSettings)));
  await act(async () => render(true));
  await act(async () => render(false));
  await act(async () => complete({ status: "credential-stored", profileStatus: "ready", profile: { name: "Late user", contact: null } }));
  expect(deepseekSection().textContent).not.toContain("Late user");
  vi.mocked(invoke).mockImplementation(request);
  await act(async () => render(true));
  expect(deepseekSection().textContent).toContain("Not signed in");
  expect(refresh().disabled).toBe(false);
});
