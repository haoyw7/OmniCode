import { describe, expect, it } from "vitest";
import { newSession } from "./session";
import { selectComposerConfiguration, sessionComposerConfiguration } from "./composerConfiguration";

describe("composer agent selection", () => {
  const target = {
    harness: "claude" as const, model: "claude:sonnet", modelSettings: { effort: "high" },
    runtimeMode: "full-access" as const,
  };

  it("keeps the conversation and provider binding intact while editing the next turn's choice", () => {
    const original = { ...newSession("codex", "/repo"), providerSessionId: "existing",
      blocks: [{ id: "user", role: "user" as const, text: "Earlier work" }] };
    const selected = selectComposerConfiguration(original, target);
    expect(selected).toEqual({ ...original, pendingConfiguration: target });
    expect(sessionComposerConfiguration(selected)).toEqual(target);
    const adjusted = selectComposerConfiguration(selected, { ...target, modelSettings: { effort: "low" } });
    expect(adjusted.modelSettings).toEqual(original.modelSettings);
    expect(sessionComposerConfiguration(adjusted).modelSettings).toEqual({ effort: "low" });
    const reverted = selectComposerConfiguration(adjusted, sessionComposerConfiguration(original));
    expect(reverted).toEqual({ ...original, pendingConfiguration: undefined });
  });

  it.each([false, true])("applies choices immediately before the first sent message (draft: %s)", (draft) => {
    const original = { ...newSession("codex", "/repo"),
      blocks: draft ? [{ id: "draft", role: "user" as const, text: "Unsent", draft: true }] : [] };
    const selected = selectComposerConfiguration(original, target);
    expect(selected).toMatchObject(target);
    expect(selected.pendingConfiguration).toBeUndefined();
  });
});
