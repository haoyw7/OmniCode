import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const presentation = [
  "desktop-sidebar.css", "desktop-conversation.css", "desktop-workspaces.css",
  "desktop-controls.css", "controls/forms.css",
];

describe("desktop presentation ownership", () => {
  it("keeps the removed theme and component layers out of the runtime", () => {
    for (const path of ["src/shared/ui/omb", "src/styles/omb-skin.css", "src/styles/omb-metrics.css"]) {
      expect(existsSync(path), path).toBe(false);
    }
    function check(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) check(path);
        else if (/\.(css|tsx?)$/.test(path) && !path.endsWith(".test.ts")) {
          expect(readFileSync(path, "utf8"), path).not.toMatch(/(?:--omb-|--ease-omb|omb-slide-panel|["'][^"']*\/omb\/|@import\s+["'][^"']*omb-)/);
        }
      }
    }
    check("src");
  });

  it("does not introduce global spacing or radius overrides in surface styles", () => {
    for (const file of presentation) {
      const root = postcss.parse(readFileSync(`src/styles/${file}`, "utf8"));
      root.walkDecls(decl => {
        expect(decl.prop, `${file}: ${decl.prop}`).not.toMatch(/^--(?:radius-(?:lg|xl)|space-\d+)$/);
      });
    }
  });
});
