// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { configureSharedHost } from "../../connections/model/remoteProjects";
import { loadSharedProviderDefaults, setSharedProviderDefault, importCurrentCodexAccount,
  initProviderAccountPublishing, addProviderAccountProfile, updateProviderAccountProfile, loadProviderAccounts } from "./providerAccountCredentials";
import { readProviderAccountIdentity } from "./providerAccountIdentity";
import { providerAccounts, saveProviderAccount, sharedProviderAccountId, subscribeProviderAccounts } from "./providerAccounts";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
let snapshot: { revision: number; accounts: Record<string, { id: string; label: string }[]>; defaults: Record<string, string> };
beforeEach(() => {
  localStorage.clear();
  configureSharedHost("env", [], "machine");
  snapshot = { revision: 1, accounts: { codex: [{ id: "default", label: "CLI" }, { id: "work", label: "Work" }] }, defaults: { codex: "work" } };
  vi.mocked(invoke).mockReset().mockImplementation(async (command, args) => {
    if (command !== "remote_request") throw new Error("Unexpected native account operation");
    const { method, params } = args as { method: string; params: Record<string, string> };
    if (method === "environment.describe") return { protocolVersion: 1, environmentId: "env", name: "fixture", providers: ["codex"], capabilities: ["providerAccounts.manage.v1"] };
    if (method === "providerAccounts.setDefault") { snapshot.revision++; snapshot.defaults[params.provider] = params.accountId; }
    if (method === "providerAccounts.save" || method === "providerAccounts.importCodex") {
      snapshot.revision++;
      snapshot.accounts[params.provider] = [...(snapshot.accounts[params.provider] ?? []).filter(row => row.id !== params.accountId), { id: params.accountId, label: params.label }];
    }
    return structuredClone(snapshot);
  });
});
it("hydrates shared defaults and only updates after a successful Host commit", async () => {
  await loadSharedProviderDefaults();
  expect(sharedProviderAccountId("codex")).toBe("work");
  await setSharedProviderDefault("codex", "default");
  expect(sharedProviderAccountId("codex")).toBe("default");
  expect(invoke).toHaveBeenCalledWith("remote_request", { machineId: "machine", method: "providerAccounts.setDefault", params: { provider: "codex", accountId: "default", operationId: expect.any(String) } });
  vi.mocked(invoke).mockRejectedValue(new Error("Host offline"));
  await expect(setSharedProviderDefault("codex", "work")).rejects.toThrow("Host offline");
  expect(sharedProviderAccountId("codex")).toBe("default");
});
it("replaces stale labels and removed rows without publishing browser account metadata", async () => {
  saveProviderAccount({ provider: "codex", id: "work", label: "Stale label" });
  saveProviderAccount({ provider: "codex", id: "removed", label: "Removed" });
  const stop = await initProviderAccountPublishing();
  try {
    expect(providerAccounts("codex").map(row => row.label)).toEqual(["CLI", "Work"]);
    expect(vi.mocked(invoke).mock.calls.every(([command]) => command === "remote_request")).toBe(true);
    expect(invoke).not.toHaveBeenCalledWith("provider_accounts_publish", expect.anything());
  } finally { stop(); }
});
it("saves only the edited profile and keeps Data Homes out of the device cache", async () => {
  const account = await addProviderAccountProfile("claude", "Work", "/host/claude");
  expect(providerAccounts("claude")[1]).toEqual(account);
  expect(invoke).toHaveBeenCalledWith("remote_request", { machineId: "machine", method: "providerAccounts.save", params: { provider: "claude", accountId: account.id, label: "Work", dataHome: "/host/claude", operationId: expect.any(String) } });
  expect(localStorage.getItem("monocode.providerAccounts.v1")).not.toContain("/host/claude");
  await updateProviderAccountProfile({ ...account, label: "Renamed" });
  expect(providerAccounts("claude")[1].label).toBe("Renamed");
  vi.mocked(invoke).mockRejectedValue(new Error("cannot save"));
  await expect(updateProviderAccountProfile({ ...account, label: "Failed" })).rejects.toThrow("cannot save");
  expect(providerAccounts("claude")[1].label).toBe("Renamed");
});
it("imports through Host without changing shared defaults", async () => {
  const imported = await importCurrentCodexAccount("Imported");
  expect(providerAccounts("codex").some(row => row.id === imported.id)).toBe(true);
  expect(sharedProviderAccountId("codex")).toBe("work");
  expect(invoke).toHaveBeenCalledWith("remote_request", expect.objectContaining({ method: "providerAccounts.importCodex" }));
});
it("rejects old Hosts instead of claiming local writes are shared", async () => {
  vi.mocked(invoke).mockResolvedValue({ protocolVersion: 1, environmentId: "env", name: "old", providers: [], capabilities: [] });
  await expect(setSharedProviderDefault("codex", "work")).rejects.toThrow("Update the Host");
  expect(vi.mocked(invoke).mock.calls).toHaveLength(1);
});
it("ignores account metadata delivered after switching Host", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = loadProviderAccounts();
  configureSharedHost("other", [], "other-machine");
  finish(snapshot);
  await pending;
  expect(providerAccounts("codex")).toHaveLength(1);
});
it("reads shared Host identities, coalesces requests and never substitutes the local identity on failure", async () => {
  vi.mocked(invoke).mockResolvedValue({
    codex: [
      { id: "default", label: "CLI", identity: { email: "host@example.test" } },
      { id: "work", label: "Work", identity: { email: "work@example.test" } },
    ],
  });
  expect(
    await Promise.all([
      readProviderAccountIdentity("codex", "default"),
      readProviderAccountIdentity("codex", "work"),
    ]),
  ).toEqual([{ email: "host@example.test" }, { email: "work@example.test" }]);
  expect(invoke).toHaveBeenCalledTimes(1);
  vi.mocked(invoke).mockRejectedValue(new Error("Host offline"));
  expect(await readProviderAccountIdentity("codex", "default")).toBeNull();
  expect(
    vi
      .mocked(invoke)
      .mock.calls.every(([command]) => command === "remote_request"),
  ).toBe(true);
});
it("discards identities returned after the shared Host changes", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = readProviderAccountIdentity("codex", "default");
  configureSharedHost("other", [], "other-machine");
  finish({
    codex: [{ id: "default", identity: { email: "old@example.test" } }],
  });
  expect(await pending).toBeNull();
});

it("keeps native desktop imports on their local identity source", async () => {
  vi.mocked(invoke).mockResolvedValue({ email: "native@example.test" });
  expect(await readProviderAccountIdentity("codex", "default", "local")).toEqual({ email: "native@example.test" });
  expect(invoke).toHaveBeenCalledWith("provider_account_identity", { provider: "codex", accountId: "default" });
});

it("boots from the verified Host cache while offline and retries only reads on reconnect", async () => {
  await loadSharedProviderDefaults();
  const live = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockRejectedValue(new Error("Machine is unreachable"));
  const stop = await initProviderAccountPublishing();
  try {
    expect(providerAccounts("codex")[1].label).toBe("Work");
    expect(sharedProviderAccountId("codex")).toBe("work");
    await expect(updateProviderAccountProfile({ provider: "codex", id: "work", label: "Offline edit" })).rejects.toThrow("unreachable");
    expect(providerAccounts("codex")[1].label).toBe("Work");
    vi.mocked(invoke).mockImplementation(live);
    snapshot.revision++;
    snapshot.accounts.codex[1].label = "From Host";
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(providerAccounts("codex")[1].label).toBe("From Host"));
    expect(vi.mocked(invoke).mock.calls.filter(([, args]) => (args as { method?: string })?.method === "providerAccounts.save")).toHaveLength(0);
  } finally { stop(); }
});
it("does not use another Host's cached accounts for offline boot", async () => {
  await loadSharedProviderDefaults();
  configureSharedHost("other-env", [], "other-machine");
  vi.mocked(invoke).mockRejectedValue(new Error("Host offline"));
  await expect(initProviderAccountPublishing()).rejects.toThrow("Host offline");
  expect(providerAccounts("codex")).toHaveLength(1);
  expect(sharedProviderAccountId("codex")).toBe("default");
});
it("does not hide revoked credentials behind an account cache", async () => {
  await loadSharedProviderDefaults();
  vi.mocked(invoke).mockRejectedValue(new Error("Device credential is invalid or revoked"));
  await expect(initProviderAccountPublishing()).rejects.toThrow("revoked");
});


it("does not let a slow account read undo an acknowledged default change", async () => {
  await loadSharedProviderDefaults();
  const live = vi.mocked(invoke).getMockImplementation()!;
  let finish!: (value: unknown) => void;
  const stale = structuredClone(snapshot);
  vi.mocked(invoke).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const read = loadProviderAccounts();
  vi.mocked(invoke).mockImplementation(live);
  await setSharedProviderDefault("codex", "default");
  finish(stale);
  await read;
  expect(sharedProviderAccountId("codex")).toBe("default");
});

it("refreshes identity subscribers when CLI sign-in changes without a metadata revision", async () => {
  await loadSharedProviderDefaults();
  const changed = vi.fn();
  const stop = subscribeProviderAccounts(changed);
  try {
    Object.assign(snapshot.accounts.codex[1], { identity: { email: "new-login@example.test" } });
    await loadProviderAccounts();
    expect(changed).toHaveBeenCalled();
    expect(localStorage.getItem("monocode.hostAccounts.cache.v1:env")).toContain("new-login@example.test");
    changed.mockClear();
    await loadProviderAccounts();
    expect(changed).not.toHaveBeenCalled();
  } finally { stop(); }
});


it.each([undefined, { revision: 2, accounts: [], defaults: {} }])("retains the confirmed account cache when Host returns malformed metadata", async response => {
  await loadSharedProviderDefaults();
  const previous = localStorage.getItem("monocode.hostAccounts.cache.v1:env");
  vi.mocked(invoke).mockResolvedValue(response);
  await expect(loadProviderAccounts()).rejects.toThrow("Host returned invalid account metadata");
  expect(sharedProviderAccountId("codex")).toBe("work");
  expect(localStorage.getItem("monocode.hostAccounts.cache.v1:env")).toBe(previous);
});
