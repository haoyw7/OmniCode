import { describe, expect, it } from "vitest";
import { hostInteractionCapabilities } from "./interactionCapabilities";
import { NO_INTERACTION_CAPABILITIES, SESSION_CAPABILITIES_V1 } from "../../../integrations/harness/core/capabilities";
import { PROVIDER_INTERACTION_CAPABILITIES } from "../../../integrations/harness/providers/interactionCapabilities";

describe("remote interaction capabilities", () => {
  it("preserves legacy flags and the old remote question behavior", () => {
    const codex = hostInteractionCapabilities({ session: { harness: "codex" }, supportsQueue: true, canSteer: false });
    expect(codex).toMatchObject({ queue: true, turns: { steer: false, compact: true, rewindLastTurn: false },
      questions: { lateReply: true, keepOpen: false } });
    expect(hostInteractionCapabilities({ session: { harness: "deepseek" } })).toMatchObject({
      questions: { lateReply: false, keepOpen: true }, backgroundTasks: { stop: false },
    });
    expect(hostInteractionCapabilities({ session: { harness: "claude" } }, ["sessions.stopBackgroundTask"]).backgroundTasks.stop).toBe(true);
  });

  it("lets explicit declarations override provider names and legacy flags", () => {
    const result = hostInteractionCapabilities({ session: { harness: "codex" }, supportsQueue: true,
      canSteer: true, interactionCapabilities: NO_INTERACTION_CAPABILITIES });
    expect(result).toEqual(NO_INTERACTION_CAPABILITIES);
    expect(hostInteractionCapabilities({ session: { harness: "new-provider" },
      interactionCapabilities: { ...PROVIDER_INTERACTION_CAPABILITIES.deepseek, queue: true },
    }).questions).toEqual({ respond: true, keepOpen: true, lateReply: true });
  });

  it("fails closed for incomplete v1 responses and ignores unknown fields", () => {
    expect(hostInteractionCapabilities({ session: { harness: "codex" }, canSteer: true }, [SESSION_CAPABILITIES_V1]))
      .toEqual(NO_INTERACTION_CAPABILITIES);
    const wire = JSON.parse('{"turns":{"compact":true,"steer":"true","future":true}}');
    expect(hostInteractionCapabilities({ session: { harness: "codex" }, interactionCapabilities: wire }))
      .toEqual({ ...NO_INTERACTION_CAPABILITIES, turns: { ...NO_INTERACTION_CAPABILITIES.turns, compact: true } });
  });
});
