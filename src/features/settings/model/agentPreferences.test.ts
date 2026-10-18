// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { HostStore } from "../../../../host/store";
import { HostClientState } from "../../../../host/client-state";
import { activatePreferenceStore, SharedPreferenceStore } from "./sharedPreferences";
import { legacyAgentDefaults } from "./agentPreferences";
import { saveLastModelChoice, saveLastModelSettings, loadLastModelChoice, loadDefaultModels } from "../../sessions/model/models";
import { loadMobileAgentDefaults, saveMobileAgentDefaults, loadMobileProjectDefaults } from "../../../mobile/agentDefaults";
import { preferenceStorage } from "./sharedPreferences";
import { requestedProviderAccountId, selectProviderAccount, restoreProviderAccounts, removeProviderAccount } from "../../providers/model/providerAccounts";

const databases: HostStore[] = [];
afterEach(() => { activatePreferenceStore(undefined); localStorage.clear(); for (const db of databases.splice(0)) db.close(); });
async function connected() {
  const db = new HostStore(":memory:"); databases.push(db);
  const host = new HostClientState(db);
  const store = new SharedPreferenceStore("host", localStorage, async <T>(method: string, params: Record<string, unknown>) =>
    (method === "preferences.read" ? host.preferencesRead(params) : host.preferencesPatch(params)) as T);
  await store.sync(); activatePreferenceStore(store);
  return store;
}
it("uses the same default model, effort and account across desktop and mobile", async () => {
  const store = await connected();
  saveLastModelChoice("codex", "gpt-5");
  saveLastModelSettings({ reasoningEffort: "high" });
  await store.sync();
  expect(loadMobileAgentDefaults("host")).toMatchObject({ harness: "codex", agents: { codex: { model: "gpt-5", modelSettings: { reasoningEffort: "high" } } } });
  saveMobileAgentDefaults("host", { harness: "claude", agents: { claude: { model: "claude-opus", accountId: "work" } } });
  expect(loadLastModelChoice()).toEqual({ harness: "claude", model: "claude-opus" });
  expect(loadDefaultModels().claude).toBe("claude-opus");
  expect(requestedProviderAccountId("claude", "/project")).toBe("work");
  preferenceStorage.setItem("monocode.providerAccountSelections.v1", JSON.stringify({ "/project": { claude: "personal" } }));
  expect(requestedProviderAccountId("claude", "/project")).toBe("personal");
  await store.sync();
});
it("shares an explicit desktop global account and preserves project precedence on mobile", async () => {
  const store = await connected();
  restoreProviderAccounts({ codex: [{ id: "work", label: "Work" }] });
  selectProviderAccount("codex", undefined, "work");
  expect(loadMobileAgentDefaults("host").agents?.codex?.accountId).toBe("work");
  preferenceStorage.setItem("monocode.providerAccountSelections.v1", JSON.stringify({ "@project:host:project": { codex: "personal" } }));
  expect(loadMobileProjectDefaults("host", "project").agents?.codex?.accountId).toBe("personal");
  expect(loadMobileAgentDefaults("another-host")).toEqual({});
  removeProviderAccount("codex", "work");
  expect(loadMobileAgentDefaults("host").agents?.codex?.accountId).toBeUndefined();
  await store.sync();
});
it("imports legacy release model settings and global account without changing originals", () => {
  const legacy: Record<string, string> = {
    "monocode.lastModel": JSON.stringify({ harness: "codex", model: "gpt-5" }),
    "monocode.lastModelSettings": JSON.stringify({ effort: "high" }),
    "monocode.providerAccountSelections.v1": JSON.stringify({ "~": { codex: "work" }, "/project": { codex: "personal" } }),
  };
  expect(JSON.parse(legacyAgentDefaults(key => legacy[key] ?? null)!)).toEqual({ harness: "codex", agents: { codex: { model: "gpt-5", modelSettings: { effort: "high" }, accountId: "work" } } });
});
