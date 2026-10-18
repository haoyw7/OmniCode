import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function stylesheets(entry: string, seen = new Set<string>()): Set<string> {
  const path = resolve(entry);
  if (seen.has(path)) return seen;
  seen.add(path);
  const css = readFileSync(path, "utf8");
  for (const [, dependency] of css.matchAll(/@import\s+"(\.[^"]+)"/g)) {
    stylesheets(resolve(dirname(path), dependency), seen);
  }
  return seen;
}

describe("platform stylesheet boundaries", () => {
  it("uses canonical controls without old mobile wrappers or global form inference", () => {
    for (const file of ["src/mobile/MobileSwitch.tsx", "src/mobile/ui/Bubble.tsx", "src/mobile/styles/15-controls.css", "src/mobile/styles/16-conversation-navigation.css"]) expect(existsSync(file), file).toBe(false);
    const controls = readFileSync("src/mobile/styles/controls/forms.css", "utf8");
    expect(controls).not.toMatch(/input:not\(|\.mobile-(?:switch|button|icon-button)/);
  });
  it("mobile loads shared rendering without desktop palette, controls or chrome", () => {
    const files = [...stylesheets("src/mobile/theme/index.css"), ...stylesheets("src/mobile/styles/index.css")];
    expect(files).toContain(resolve("src/shared/styles/conversation.css"));
    expect(files.filter(path => path.startsWith(resolve("src/styles") + "/"))).toEqual([]);
  });
  it("desktop does not import mobile presentation", () => {
    const files = [...stylesheets("src/styles/index.css")];
    expect(files).toContain(resolve("src/shared/styles/conversation.css"));
    expect(files.filter(path => path.startsWith(resolve("src/mobile") + "/"))).toEqual([]);
  });
});
