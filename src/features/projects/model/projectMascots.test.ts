import { describe, expect, it } from "vitest";
import { PROJECT_MASCOTS, projectMascot, resolveProjectMascotName } from "./projectMascots";

describe("projectMascots", () => {
  it.each([
    ["invader", "ready"], ["ghost", "curious"], ["robot", "focused"], ["cat", "joyful"],
    ["skull", "error"], ["crab", "encouraging"], ["mushroom", "sleepy"], ["rocket", "inspired"],
    ["dino", "surprised"], ["frog", "done"],
  ])("migrates the stored %s selection to %s", (legacy, current) => {
    expect(projectMascot("alpha", legacy).name).toBe(current);
    expect(resolveProjectMascotName(legacy)).toBe(current);
  });
  it("retains explicit Omi choices and deterministic defaults", () => {
    expect(projectMascot("alpha", "curious").name).toBe("curious");
    expect(projectMascot("alpha")).toBe(projectMascot("alpha"));
    for (const name of [null, "unknown", "__proto__", "constructor"]) {
      expect(projectMascot("alpha", name)).toBe(projectMascot("alpha"));
    }
  });
  it("keeps distinct choices for project and agent identities", () => {
    expect(new Set(PROJECT_MASCOTS.map(item => item.name)).size).toBe(10);
    const selected = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"].map(name => projectMascot(name).name);
    expect(new Set(selected).size).toBeGreaterThan(3);
  });
});
