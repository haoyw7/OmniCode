import { chromium, webkit, expect } from "@playwright/test";
import fs from "node:fs/promises";

const engine = process.env.TYPOGRAPHY_BROWSER === "webkit" ? webkit : chromium;
const browser = await engine.launch(engine === chromium
  ? { executablePath: process.env.CHROME_PATH || (process.platform === "linux" ? "/usr/bin/google-chrome" : undefined), headless: true, args: ["--no-sandbox"] }
  : { headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
const output = `build/typography/${engine.name()}`;
await fs.mkdir(output, { recursive: true });
const result = { browser: engine.name(), version: browser.version(), samples: [], errors };
try {
  for (const mobile of [false, true]) for (const dark of [false, true]) {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 });
    await page.goto(`${process.env.VISUAL_BASE_URL || "http://127.0.0.1:1441"}/tests/browser/typography.html?${mobile ? "mobile&" : ""}${dark ? "dark" : ""}`);
    await page.locator("[data-typography-gallery]").waitFor();
    await page.evaluate(() => document.fonts.ready);
    const regular = page.locator('[data-style="type-body"]');
    await expect(regular).toHaveCSS("font-weight", "400");
    await expect(regular).toHaveCSS("font-size", "16px");
    await expect(regular).toHaveCSS("line-height", "24px");
    expect(await regular.evaluate(el => getComputedStyle(el).fontFamily)).toMatch(/^"?Source Sans 3/);
    expect(await page.locator(".font-serif").evaluate(el => getComputedStyle(el).fontFamily)).toMatch(/^"?Source Serif 4/);
    await expect(page.locator('[data-style="type-body-emphasized"]')).toHaveCSS("font-weight", "600");
    const fonts = await page.evaluate(async () => {
      const loaded = [];
      for (const family of ["Source Sans 3", "Source Serif 4", "JetBrains Mono"]) for (const weight of [400, 500, 600, 700]) for (const style of ["normal", "italic"]) {
        const faces = await document.fonts.load(`${style} ${weight} 16px "${family}"`);
        loaded.push({ family, weight, style, faces: faces.length, ready: faces.every(face => face.status === "loaded") });
      }
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.font = '16px "JetBrains Mono"';
      return { loaded, widthI: ctx.measureText("iiii").width, widthW: ctx.measureText("WWWW").width };
    });
    expect(fonts.loaded.every(font => font.faces > 0 && font.ready)).toBe(true);
    expect(Math.abs(fonts.widthI - fonts.widthW)).toBeLessThan(.01);
    const name = `${mobile ? "mobile" : "desktop"}-${dark ? "dark" : "light"}`;
    await page.screenshot({ path: `${output}/${name}.png` });
    await page.evaluate(() => document.documentElement.style.setProperty("--ui-font-scale", "1.4"));
    await expect(regular).toHaveCSS("font-size", "22.4px");
    expect(await regular.evaluate(el => parseFloat(getComputedStyle(el).lineHeight))).toBeCloseTo(33.6, 3);
    await page.screenshot({ path: `${output}/${name}-scaled.png` });
    await page.evaluate(async () => {
      const { applyTypographyProfile, defaultAppearanceProfile } = await import("/src/features/settings/model/typography.ts");
      applyTypographyProfile({ ...defaultAppearanceProfile(), uiFont: "Custom UI", contentFont: "Custom Content", codeFont: "Custom Code", uiWeight: 500 });
    });
    await expect(regular).toHaveCSS("font-weight", "500");
    expect(await regular.evaluate(el => getComputedStyle(el).fontFamily)).toMatch(/^"?Custom UI/);
    expect(await page.locator(".font-serif").evaluate(el => getComputedStyle(el).fontFamily)).toMatch(/^"?Custom Content/);
    expect(await page.locator('[data-mono="400"]').evaluate(el => getComputedStyle(el).fontFamily)).toMatch(/^"?Custom Code/);
    result.samples.push({ name, fonts, userPreferences: true, scaled: true });
  }
  expect(errors).toEqual([]);
  await fs.writeFile(`${output}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
