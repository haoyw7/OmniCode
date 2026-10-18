// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ProviderAccountsSettings } from "./pages/providers/ProviderAccountsSettings";
import { configureSharedHost } from "../../connections/model/remoteProjects";
import { refreshUiLanguage, UI_LANGUAGE_KEY } from "../../../shared/i18n/language";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => path, isTauri: () => false }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true) }));
vi.mock("../../../integrations/harness/core/auth", () => ({ loginHarness: vi.fn(async () => {}) }));
vi.mock("../../providers/model/accountUsage", async original => ({ ...await original<typeof import("../../providers/model/accountUsage")>(), useProviderAccountUsage: () => ({ usage: {}, now: Date.now(), refreshing: false, refresh: () => {} }),
  accountStatus: () => ({ tone: "neutral", label: "Unknown", rank: 0 }), accountHeadroom: () => undefined }));
let root: Root;
let container: HTMLDivElement;
let calls: { method: string; params: Record<string, unknown> }[];
let snapshot: { revision: number; accounts: Record<string, { id: string; label: string; identity?: { email: string } }[]>; defaults: Record<string, string> };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); localStorage.setItem(UI_LANGUAGE_KEY, "en"); refreshUiLanguage();
  configureSharedHost("env", [], "shared-machine");
  calls = [];
  snapshot = { revision: 1, accounts: { codex: [{ id: "default", label: "Default account" }, { id: "work", label: "Host work", identity: { email: "work@example.test" } }], claude: [{ id: "default", label: "Default account" }] }, defaults: { codex: "work" } };
  vi.mocked(invoke).mockReset().mockImplementation(async (command, args) => {
    if (command !== "remote_request") throw new Error("Native accounts must not be used");
    const input = args as { method: string; params: Record<string, unknown> };
    calls.push(input);
    if (input.method === "environment.describe") return { protocolVersion: 1, environmentId: "env", name: "Host", providers: ["codex", "claude"], capabilities: ["providerAccounts.manage.v1"] };
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
