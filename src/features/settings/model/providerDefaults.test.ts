import { describe, expect, it, vi } from "vitest";
import { effectiveDefaultHarness, providerScopeState, type ProviderDefaultsScope } from "./providerDefaults";

vi.mock("../../sessions/model/models", () => ({
  defaultModelId: (harness: string) => `${harness}:builtin`,
  // A project's hidden providers are skipped when choosing its default.
  firstEnabledHarness: (_project: string, preferred: string) =>
    preferred === "cursor" ? "claude" : preferred,
}));

const global: ProviderDefaultsScope = {
  project: null,
  projectSettings: {},
  defaultModels: { codex: "codex:saved" },
  choice: { harness: "claude", model: "claude:opus" },
  hiddenGlobally: ["cursor"],
};

describe("provider defaults scope", () => {
  it("uses the remembered provider and saved models globally", () => {
    expect(effectiveDefaultHarness(global)).toBe("claude");
    expect(providerScopeState("claude", global)).toEqual({
      selectedModel: "claude:opus",
      isDefault: true,
      inPicker: true,
      pickerLocked: false,
    });
    expect(providerScopeState("codex", global).selectedModel).toBe("codex:saved");
    expect(providerScopeState("grok", global).selectedModel).toBe("grok:builtin");
    // Hiding globally is editable from the global scope.
    expect(providerScopeState("cursor", global)).toMatchObject({
      inPicker: false,
      pickerLocked: false,
    });
  });

  it("inherits global defaults in a project without overrides", () => {
    const project = { ...global, project: "/repo" };
    expect(effectiveDefaultHarness(project)).toBe("claude");
    expect(providerScopeState("claude", project)).toMatchObject({
      selectedModel: "claude:opus",
      isDefault: true,
    });
    // A globally hidden provider cannot be shown again per project.
    expect(providerScopeState("cursor", project)).toMatchObject({
      inPicker: false,
      pickerLocked: true,
    });
  });

  it("prefers a project's own provider, models and hidden list", () => {
    const project: ProviderDefaultsScope = {
      ...global,
      project: "/repo",
      projectSettings: {
        defaultHarness: "codex",
        defaultModel: "codex:project-default",
        models: { claude: "claude:project" },
        hidden: ["grok"],
      },
    };
    expect(effectiveDefaultHarness(project)).toBe("codex");
    expect(providerScopeState("codex", project)).toMatchObject({
      selectedModel: "codex:project-default",
      isDefault: true,
    });
    expect(providerScopeState("claude", project)).toMatchObject({
      selectedModel: "claude:project",
      isDefault: false,
    });
    expect(providerScopeState("grok", project)).toMatchObject({
      inPicker: false,
      pickerLocked: false,
    });
  });

  it("skips a project default that the project cannot start", () => {
    const project: ProviderDefaultsScope = {
      ...global,
      project: "/repo",
      projectSettings: { defaultHarness: "cursor" },
    };
    expect(effectiveDefaultHarness(project)).toBe("claude");
  });
});
