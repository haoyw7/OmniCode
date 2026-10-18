import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const directory = "src/shared/ui";
function implementations(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = `${root}/${entry.name}`;
    return entry.isDirectory() ? implementations(path) : path.endsWith(".tsx") ? [path] : [];
  });
}
describe("shared UI boundaries", () => {
  it("does not retain feature-local primitive or shell-backdrop implementations", () => {
    expect(existsSync("src/features/workflows/kit/components/ui")).toBe(false);
    expect(existsSync("src/app/shell/GlassBackdrop.tsx")).toBe(false);
    expect(readFileSync("src/app/shell/WindowChrome.tsx", "utf8")).not.toContain("export function IconButton");
  });
  it("keeps shared control implementations independent of feature and runtime services", () => {
    for (const file of implementations(directory)) {
      const source = readFileSync(file, "utf8");
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
        (match) => match[1],
      );
      expect(
        imports.filter((path) =>
          /features\/|platform\/|@tauri-apps|host\/|(?:\.\.\/)+app\//.test(path),
        ),
        file,
      ).toEqual([]);
    }
  });
  it("requires explicit form identities instead of inferring them from utility classes or ARIA roles", () => {
    const css = readFileSync("src/styles/controls/forms.css", "utf8");
    expect(css).not.toMatch(/(?:input|textarea|select)\.border/);
    expect(css).not.toMatch(/\[role=["']switch["']\]/);
    expect(css).not.toMatch(/input\[type=["'](?:radio|checkbox)["']\]/);
  });
});
