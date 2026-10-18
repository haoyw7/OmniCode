import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { duration, ease, springs } from "../shared/motion/tokens";

const source = (name: string) => readFileSync(`src/mobile/${name}`, "utf8");

describe("mobile Motion migration", () => {
  it("uses the shared timing and spring vocabulary", () => {
    expect(duration).toEqual({ msg: 0.18, pop: 0.2, panel: 0.24, collapse: 0.2 });
    expect(ease).toEqual([0.22, 1, 0.36, 1]);
    expect(springs.sheet).toEqual({ type: "spring", stiffness: 400, damping: 38 });
    expect(springs.drawer).toEqual({ type: "spring", stiffness: 380, damping: 36 });
    for (const file of ["MobilePageTransition.tsx", "MobileSheet.tsx", "MobileDrawer.tsx", "MobileSwap.tsx", "MobileComposer.tsx", "sheetDrag.ts"])
      expect(source(file)).not.toMatch(/duration\s*:\s*\d+(?:\.\d+)?\b/);
  });
  it("keeps presence and physical drag on Motion and removes animation timers", () => {
    expect(source("MobilePageTransition.tsx")).toContain('mode="popLayout"');
    expect(source("MobileSheet.tsx")).toContain('"y" : false');
    expect(source("MobileDrawer.tsx")).toContain('drag="x"');
    for (const file of ["sheetDrag.ts", "keyboardMotion.ts", "MobilePageTransition.tsx", "MobileSwap.tsx"])
      expect(source(file)).not.toMatch(/requestAnimationFrame|setTimeout|\.animate\(/);
  });
});
