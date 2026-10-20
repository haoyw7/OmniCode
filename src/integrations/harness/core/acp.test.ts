import { describe, expect, it } from "vitest";
import { assertAcpPromptCompleted } from "./acp";

describe("ACP prompt stop reasons", () => {
  it.each([
    ["max_tokens", "output token limit"],
    ["max_turn_requests", "request limit"],
    ["refusal", "refused to continue"],
  ])("reports %s as an incomplete turn", (stopReason, message) => {
    expect(() => assertAcpPromptCompleted({ stopReason })).toThrow(message);
  });

  it.each(["end_turn", "cancelled", "_future_reason", undefined, null])(
    "leaves %s to the provider lifecycle", (stopReason) => {
      expect(() => assertAcpPromptCompleted({ stopReason })).not.toThrow();
    },
  );
});
