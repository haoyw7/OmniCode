// @vitest-environment happy-dom
const discover = vi.hoisted(() => vi.fn(async () => []));
vi.mock("../../../integrations/harness/core/registry", () => ({
  getHarness: (id: string) =>
    id === "pi" || id === "omp"
      ? {
          commands: {
            discover,
            rawSlashCommands: id === "omp",
          },
        }
      : undefined,
}));

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { queryClient } from "../../../shared/lib/queryClient";
import {
  nextComposerSkillContextToken,
  pickerSkillLoadOptions,
  useComposerSkills,
} from "./useComposerSkills";

const piSkill = {
  name: "architect",
  description: "Design first.",
  invocation: "skill:architect",
  source: "pi" as const,
};

beforeEach(() => { queryClient.clear(); discover.mockReset(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(() => { queryClient.clear(); vi.unstubAllGlobals(); });

describe("composer skill catalog policies", () => {
  it("does not render a previous project's late catalog after switching", async () => {
    let finish!: (skills: typeof piSkill[]) => void;
    discover.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce([{ ...piSkill, name: "current" }]);
    const container = document.createElement("div");
    const root = createRoot(container);
    function View({ cwd }: { cwd: string }) {
      const catalog = useComposerSkills({ harness: "pi", executionCwd: cwd, pickerOpen: false });
      return createElement("span", null, catalog.skills.map(skill => skill.name).join(","));
    }
    try {
      await act(async () => root.render(createElement(View, { cwd: "/a" })));
      await act(async () => root.render(createElement(View, { cwd: "/b" })));
      expect(container.textContent).toBe("current");
      await act(async () => finish([piSkill]));
      expect(container.textContent).toBe("current");
    } finally { act(() => root.unmount()); }
  });

  it("preserves filesystem refresh while Pi uses its TTL", () => {
    expect(pickerSkillLoadOptions("pi")).toBeUndefined();
    expect(pickerSkillLoadOptions("omp")).toBeUndefined();
    expect(pickerSkillLoadOptions("claude")).toEqual({ refresh: true });
  });

  it("does not reuse a context token after A to B to A", () => {
    const firstA = nextComposerSkillContextToken(null, "pi\0/a");
    const sameA = nextComposerSkillContextToken(firstA, "pi\0/a");
    const b = nextComposerSkillContextToken(sameA, "pi\0/b");
    const secondA = nextComposerSkillContextToken(b, "pi\0/a");

    expect(sameA).toBe(firstA);
    expect(secondA.key).toBe(firstA.key);
    expect(secondA).not.toBe(firstA);
    expect(secondA.generation).toBeGreaterThan(firstA.generation);
  });
});
