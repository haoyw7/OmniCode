import postcss from "postcss";
import { describe, expect, it } from "vitest";
import fontScale from "../../../scripts/postcss-font-scale.mjs";

async function run(css: string) {
  const result = await postcss([fontScale()]).process(css, { from: undefined });
  return result.css.replace(/\s+/g, " ").trim();
}

describe("postcss font scale", () => {
  it("scales px and theme text sizes but not relative ones", async () => {
    const css = await run(
      ".a{font-size:13px}.b{font-size:var(--text-ui-base)}.c{font-size:.8em}.d{font-size:12px!important}",
    );
    expect(css).toContain(".a{font-size:calc(13px * var(--font-scale, 1))}");
    expect(css).toContain(
      ".b{font-size:calc(var(--text-ui-base) * var(--font-scale, 1))}",
    );
    expect(css).toContain(".c{font-size:.8em}");
    expect(css).toContain(
      ".d{font-size:calc(12px * var(--font-scale, 1))!important}",
    );
  });

  it("is idempotent", async () => {
    const once = await run(".a{font-size:13px}");
    expect(await run(once)).toBe(once);
  });

  it("keeps mobile font tokens responsive to the selected font scale", async () => {
    const css = await run(".a{font-size:var(--mobile-font-md)}.b{font-size:var(--mobile-font-xl)}");
    expect(css).toContain(".a{font-size:calc(var(--mobile-font-md) * var(--font-scale, 1))}");
    expect(css).toContain(".b{font-size:calc(var(--mobile-font-xl) * var(--font-scale, 1))}");
    expect(await run(css)).toBe(css);
  });

  it("lets the user override reduced motion in both directions", async () => {
    const css = await run(
      "@media (prefers-reduced-motion: reduce){.a,html.b{animation:none}}" +
        "@media (prefers-reduced-motion: no-preference){.c{animation:spin 1s}}",
    );
    expect(css).toContain(
      '@media (prefers-reduced-motion: reduce){:root:not([data-reduced-motion="off"]) .a, :root:not([data-reduced-motion="off"]).b{animation:none}}',
    );
    expect(css).toContain(
      ':root[data-reduced-motion="on"] .a, :root[data-reduced-motion="on"].b{animation:none}',
    );
    expect(css).toContain(
      '@media (prefers-reduced-motion: no-preference){:root:not([data-reduced-motion="on"]) .c{animation:spin 1s}}',
    );
    expect(css).toContain(
      ':root[data-reduced-motion="off"] .c{animation:spin 1s}',
    );
  });

  it("leaves keyframe steps inside motion queries alone", async () => {
    const css = await run(
      "@media (prefers-reduced-motion: reduce){@keyframes k{from{opacity:0}}}",
    );
    expect(css).toContain("@keyframes k{from{opacity:0}}");
    expect(css).not.toContain(":root from");
  });
});
