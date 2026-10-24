// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import type { HostModelCatalog } from "../contracts/protocol";
import type { RemoteProvider } from "../contracts/provider";
import { RUNTIME_MODES, type RuntimeMode } from "../contracts/session";
import { saveLastSelectedModel, saveUseLastSelection } from "../features/sessions/model/models";
import { LAST_SELECTED_MODEL } from "../integrations/harness/core/modelCatalog";
import { accountChoices, configurationForAgent, confirmLegacyAccounts, defaultConfiguration, defaultProviderAccount, loadMobileAgentDefaults, loadMobileProjectDefaults, saveMobileAgentDefaults, withDefaultAccount, withDefaultConfiguration, type MobileAgentDefaults } from "./agentDefaults";
import { activatePreferenceStore, SharedPreferenceStore } from "../features/settings/model/sharedPreferences";

const catalog: HostModelCatalog = {
  models: {
    claude: [{ harness: "claude", id: "claude:opus", name: "Opus" }],
    codex: [
      {
        harness: "codex",
        id: "codex:fast",
        name: "Fast",
        settings: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            kind: "select",
            value: "medium",
            options: [
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
            ],
          },
        ],
      },
    ],
  },
  errors: {},
};
afterEach(() => { activatePreferenceStore(undefined); localStorage.clear(); });

it("waits for the preferred Agent during partial discovery and falls back only after it fails", () => {
  const partial: HostModelCatalog = { models: { codex: catalog.models.codex }, errors: {}, pending: ["claude"] };
  expect(defaultConfiguration(partial, { harness: "claude" })).toBeUndefined();
  expect(defaultConfiguration({ ...partial, pending: [], errors: { claude: "Unavailable" } }, { harness: "claude" })?.harness)
    .toBe("codex");
  expect(defaultConfiguration({ ...catalog, pending: ["pi"] }, { harness: "claude" })?.harness).toBe("claude");
});

it("uses the shared Last selection mode for drafts and keeps project overrides", async () => {
  const store = new SharedPreferenceStore("host", localStorage, async () => { throw new Error("offline"); });
  activatePreferenceStore(store);
  saveMobileAgentDefaults("host", { harness: "claude", agents: { claude: { model: "claude:opus" } } });
  saveLastSelectedModel("codex", "codex:fast");
  saveUseLastSelection(true);
  expect(defaultConfiguration(catalog, loadMobileProjectDefaults("host", "project"))?.harness).toBe("codex");
  expect(loadMobileAgentDefaults("host").harness).toBe("claude");
  expect(loadMobileProjectDefaults("another-host", "project")).toEqual({});
  store.setItem("omnicode.projectProviderSettings.v1", JSON.stringify({
    "@project:host:project": { defaultHarness: "claude", defaultModel: "claude:opus" },
  }));
  expect(defaultConfiguration(catalog, loadMobileProjectDefaults("host", "project"))?.harness).toBe("claude");
  await store.sync();
  activatePreferenceStore(new SharedPreferenceStore("host", localStorage, async () => { throw new Error("offline"); }));
  expect(defaultConfiguration(catalog, loadMobileProjectDefaults("host", "other-project"))?.harness).toBe("codex");
  saveUseLastSelection(false);
  expect(defaultConfiguration(catalog, loadMobileProjectDefaults("host", "other-project"))?.harness).toBe("claude");
});

it("resolves last-selected models against the mobile catalog and preserves the preference", async () => {
  const store = new SharedPreferenceStore("host", localStorage, async () => { throw new Error("offline"); });
  activatePreferenceStore(store);
  saveMobileAgentDefaults("host", { harness: "codex", agents: { codex: { model: LAST_SELECTED_MODEL } } });
  const expanded = { ...catalog, models: { ...catalog.models, codex: [
    ...catalog.models.codex!, { harness: "codex" as const, id: "codex:chosen", name: "Chosen" },
  ] } };
  expect(defaultConfiguration(expanded, loadMobileAgentDefaults("host"))?.model).toBe("codex:fast");
  saveLastSelectedModel("codex", "codex:chosen");
  expect(defaultConfiguration(expanded, loadMobileAgentDefaults("host"))?.model).toBe("codex:chosen");
  expect(defaultConfiguration(catalog, loadMobileAgentDefaults("host"))?.model).toBe("codex:fast");
  expect(loadMobileAgentDefaults("host").agents?.codex?.model).toBe(LAST_SELECTED_MODEL);
  store.setItem("omnicode.projectProviderSettings.v1", JSON.stringify({
    "@project:host:project": { defaultHarness: "codex", defaultModel: "codex:fast", models: { codex: LAST_SELECTED_MODEL } },
  }));
  expect(defaultConfiguration(expanded, loadMobileProjectDefaults("host", "project"))?.model).toBe("codex:chosen");
  await store.sync();
  activatePreferenceStore(new SharedPreferenceStore("host", localStorage, async () => { throw new Error("offline"); }));
  expect(defaultConfiguration(expanded, loadMobileAgentDefaults("host"))?.model).toBe("codex:chosen");
});

it("uses verified Host preferences for desktop/mobile defaults and preserves another Host's cache", async () => {
  const request = async <T,>(): Promise<T> => { throw new Error("offline"); };
  const store = new SharedPreferenceStore("host-one", localStorage, request);
  activatePreferenceStore(store);
  saveMobileAgentDefaults("host-one", { harness: "codex", runtimeMode: "full-access", agents: { codex: { model: "codex:fast", accountId: "work" } } });
  await store.sync();
  expect(loadMobileAgentDefaults("host-one")).toMatchObject({ harness: "codex", agents: { codex: { model: "codex:fast", accountId: "work" } } });
  expect(localStorage.getItem("omnicode.mobileAgentDefaults")).toBeNull();
  expect(loadMobileAgentDefaults("host-two")).toEqual({});
  const second = new SharedPreferenceStore("host-two", localStorage, request);
  activatePreferenceStore(second);
  expect(loadMobileAgentDefaults("host-two")).toEqual({ agents: {} });
  expect(loadMobileAgentDefaults("host-one")).toEqual({});
  activatePreferenceStore(new SharedPreferenceStore("host-one", localStorage, request));
  expect(loadMobileAgentDefaults("host-one").agents?.codex?.accountId).toBe("work");
});

it("applies Host project model and account overrides only to new draft defaults", async () => {
  const store = new SharedPreferenceStore("host", localStorage, async () => { throw new Error("offline"); });
  activatePreferenceStore(store);
  saveMobileAgentDefaults("host", { harness: "claude", agents: { codex: { model: "codex:old", modelSettings: { reasoningEffort: "low" }, accountId: "personal" } } });
  store.setItem("omnicode.projectProviderSettings.v1", JSON.stringify({ "@project:host:project": { defaultHarness: "codex", defaultModel: "codex:fast" } }));
  store.setItem("omnicode.providerAccountSelections.v1", JSON.stringify({ "@project:host:project": { codex: "work" } }));
  await store.sync();
  expect(loadMobileProjectDefaults("host", "project")).toMatchObject({ harness: "codex", agents: { codex: { model: "codex:fast", modelSettings: { reasoningEffort: "low" }, accountId: "work" } } });
  expect(loadMobileAgentDefaults("host")).toMatchObject({ harness: "claude", agents: { codex: { accountId: "personal" } } });
});
describe("mobile defaults scoped to Host and Agent", () => {
  it.each(RUNTIME_MODES)("restores %s permissions for every Agent on the saved Host", (runtimeMode) => {
    const saved: MobileAgentDefaults = {
      harness: "codex",
      runtimeMode,
      agents: { codex: { model: "codex:fast", accountId: "work" } },
    };
    saveMobileAgentDefaults("one", saved);
    saveMobileAgentDefaults("two", { runtimeMode: "supervised" });
    const restored = loadMobileAgentDefaults("one");
    expect(restored).toEqual(saved);
    expect(defaultConfiguration(catalog, restored)?.runtimeMode).toBe(runtimeMode);
    const switched = withDefaultConfiguration(
      restored,
      configurationForAgent(catalog, restored, "claude")!,
    );
    expect(defaultConfiguration(catalog, switched)?.runtimeMode).toBe(runtimeMode);
    expect(defaultConfiguration({ models: { claude: catalog.models.claude }, errors: {} }, restored)?.runtimeMode).toBe(runtimeMode);
    expect(defaultConfiguration(catalog, loadMobileAgentDefaults("two"))?.runtimeMode).toBe("supervised");
    expect(defaultConfiguration(catalog, loadMobileAgentDefaults("three"))?.runtimeMode).toBe("supervised");
  });

  it("remembers each Agent independently and isolates Hosts even with the same account ID", () => {
    let first: MobileAgentDefaults = {
      harness: "codex",
      agents: {
        codex: {
          model: "codex:fast",
          modelSettings: { reasoningEffort: "low" },
          accountId: "work",
        },
      },
    };
    first = withDefaultConfiguration(
      first,
      configurationForAgent(catalog, first, "claude")!,
    );
    first = withDefaultAccount(first, "claude", "personal");
    saveMobileAgentDefaults("one", first);
    saveMobileAgentDefaults("two", {
      harness: "codex",
      agents: { codex: { accountId: "work", model: "codex:other" } },
    });
    const restored = loadMobileAgentDefaults("one");
    expect(restored.harness).toBe("claude");
    expect(configurationForAgent(catalog, restored, "codex")).toMatchObject({
      model: "codex:fast",
      modelSettings: { reasoningEffort: "low" },
    });
    expect(defaultProviderAccount("claude", restored)).toBe("personal");
    expect(loadMobileAgentDefaults("two").agents?.codex?.model).toBe(
      "codex:other",
    );
    expect(loadMobileAgentDefaults("three")).toEqual({});
    expect(loadMobileAgentDefaults()).toEqual({});
  });
  it("claims legacy defaults once and requires matching Host account metadata", () => {
    localStorage.setItem(
      "omnicode.mobileAgentDefaults",
      JSON.stringify({
        harness: "codex",
        model: "codex:fast",
        modelSettings: { reasoningEffort: "low" },
        accounts: { codex: "work", claude: "removed" },
      }),
    );
    expect(loadMobileAgentDefaults()).toEqual({});
    const first = loadMobileAgentDefaults("one");
    expect(first.agents?.codex?.accountNeedsConfirmation).toBe(true);
    expect(loadMobileAgentDefaults("two")).toEqual({});
    const verified = confirmLegacyAccounts(first, {
      codex: [{ id: "work", label: "Work" }],
    });
    expect(verified.agents?.codex?.accountNeedsConfirmation).toBeUndefined();
    expect(verified.agents?.claude?.accountNeedsConfirmation).toBe(true);
    expect(accountChoices({}, verified).map(({ agent }) => agent)).toEqual([
      "codex",
      "claude",
    ]);
    expect(defaultProviderAccount("claude", verified)).toBe("removed");
    expect(
      defaultProviderAccount(
        "claude",
        withDefaultAccount(verified, "claude", "default"),
      ),
    ).toBeUndefined();
  });
  it("falls back within an Agent before fixed provider order without rewriting preferences", () => {
    const saved = {
      harness: "codex" as const,
      agents: {
        codex: {
          model: "codex:removed",
          modelSettings: { reasoningEffort: "high", unknown: "value" },
        },
      },
    };
    saveMobileAgentDefaults("one", saved);
    expect(defaultConfiguration(catalog, saved)).toMatchObject({
      harness: "codex",
      model: "codex:fast",
      modelSettings: { reasoningEffort: "medium" },
    });
    expect(defaultConfiguration(catalog, { harness: "pi" })).toMatchObject({
      harness: "codex",
    });
    expect(
      defaultConfiguration(
        {
          models: { claude: catalog.models.claude },
          errors: { codex: "offline" },
        },
        saved,
      )?.harness,
    ).toBe("claude");
    expect(loadMobileAgentDefaults("one")).toEqual(saved);
    expect(
      defaultConfiguration({ models: {}, errors: {} }, saved),
    ).toBeUndefined();
  });
  it.each([
    ["pi", "thinking"],
    ["omp", "thinking"],
    ["opencode", "variant"],
    ["claude", "effort"],
    ["codex", "reasoningEffort"],
  ] as const)("uses %s's actual %s options", (harness, id) => {
    const remote: HostModelCatalog = {
      models: {
        [harness]: [
          {
            harness,
            id: `${harness}:test`,
            name: "Test",
            settings: [
              {
                id,
                label: "Effort",
                kind: "select",
                value: "low",
                options: [
                  { value: "low", label: "Low" },
                  { value: "high", label: "High" },
                ],
              },
            ],
          },
        ],
      },
      errors: {},
    };
    expect(
      defaultConfiguration(remote, {
        harness,
        agents: {
          [harness]: {
            modelSettings: { [id]: "high", reasoning: "unsupported" },
          },
        },
      })?.modelSettings,
    ).toEqual({ [id]: "high" });
  });
  it("does not invent settings or accept account choices for unsupported Agents", () => {
    expect(
      defaultConfiguration(catalog, {
        harness: "claude",
        agents: { claude: { modelSettings: { effort: "high" } } },
      })?.modelSettings,
    ).toEqual({});
    expect(
      defaultProviderAccount("pi", { agents: { pi: { accountId: "work" } } }),
    ).toBeUndefined();
    expect(
      accountChoices(
        { codex: [{ id: "default", label: "Default account" }] },
        {},
      ),
    ).toEqual([]);
  });
  it("keeps a WorkBuddy default account and model in the same region", () => {
    const previous: MobileAgentDefaults = { agents: { workbuddy: { model: "workbuddy:cn:auto", modelSettings: { unsupported: "value" } } } };
    const next = withDefaultAccount(previous, "workbuddy", "wb-global-one");
    expect(next.agents?.workbuddy).toEqual({ model: "workbuddy:global:fast-model", modelSettings: {}, accountId: "wb-global-one" });
    expect(previous.agents?.workbuddy?.model).toBe("workbuddy:cn:auto");
    expect(defaultProviderAccount("workbuddy", next, "workbuddy:global:fast-model")).toBe("wb-global-one");
    expect(defaultProviderAccount("workbuddy", next, "workbuddy:cn:auto")).toBeUndefined();
  });
  it("ignores corrupt storage and unknown provider fields", () => {
    localStorage.setItem("omnicode.mobileAgentDefaults", "broken");
    expect(loadMobileAgentDefaults("one")).toEqual({});
    saveMobileAgentDefaults("one", {
      harness: "fake" as RemoteProvider,
      runtimeMode: "invalid" as RuntimeMode,
      agents: {
        codex: {
          modelSettings: {
            reasoningEffort: "low",
            bad: 3 as unknown as string,
          },
        },
      },
    });
    expect(loadMobileAgentDefaults("one")).toEqual({
      agents: { codex: { modelSettings: { reasoningEffort: "low" } } },
    });
  });
});
