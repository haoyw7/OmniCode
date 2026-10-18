import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import { latestPlanDecision, skipPlanDecision } from "./planDecision";

const plan = (id: string, status: "ready" | "built" = "ready"): Block => ({
  id,
  role: "plan",
  text: "# Test plan\n\n1. Render the plan\n2. Ask before building",
  plan: { status },
});

describe("latestPlanDecision", () => {
  it("asks about the newest ready plan", () => {
    expect(
      latestPlanDecision([{ id: "user", role: "user", text: "Plan it" }, plan("ready")]),
    ).toBe("ready");
  });

  it("stops asking once the plan is built, the user replied, or it was skipped", () => {
    expect(latestPlanDecision([plan("built", "built")])).toBeUndefined();
    expect(
      latestPlanDecision([plan("answered"), { id: "next", role: "user", text: "Go" }]),
    ).toBeUndefined();
    skipPlanDecision("skipped");
    expect(latestPlanDecision([plan("skipped")])).toBeUndefined();
  });
});
