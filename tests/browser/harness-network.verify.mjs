import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve("build/harness-network");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const checks = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const harnesses = (process.env.NETWORK_HARNESSES ?? "codex,pi").split(",");
  for (const harness of harnesses) {
    for (const phase of ["retrying", "recovered", "failed", "continued"]) {
      for (const width of [1100, 390]) {
        await page.setViewportSize({ width, height: 850 });
        const scenario = `${harness}-${phase}`;
        await page.goto(`${process.env.VISUAL_BASE_URL ?? "http://127.0.0.1:1437"}/tests/browser/harness-network.html?case=${scenario}`);
        const warning = page.locator('[data-transcript-notice="warning"]')
          .filter({ hasText: /Reconnecting|Retrying|正在重试|秒后重试/ }).last();
        await expect(warning).toBeVisible();
        await expect(warning).toContainText("警告");
        expect(await warning.evaluate(element => !!element.closest('[inert], [aria-hidden="true"], [data-open="false"]'))).toBe(false);
        if (phase === "failed" || phase === "continued") {
          const failure = page.locator('[data-transcript-notice="error"]').last();
          await expect(failure).toBeVisible();
          await expect(failure).toContainText("错误");
          expect(await failure.evaluate(element => !!element.closest('[inert], [aria-hidden="true"], [data-open="false"]'))).toBe(false);
        } else await expect(page.locator('[data-transcript-notice="error"]')).toHaveCount(0);
        if (phase === "recovered" || phase === "continued")
          await expect(page.locator("[data-assistant-message]").filter({ hasText: "NETWORK_RECOVERED" }).last()).toBeVisible();
        if (phase === "retrying") await expect(page.locator("header")).toContainText("running");
        else await expect(page.locator("header")).toContainText("idle");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (phase === "failed") await page.locator('[data-transcript-notice="error"]').last().scrollIntoViewIfNeeded();
        else await warning.scrollIntoViewIfNeeded();
        await page.screenshot({ path: resolve(output, `${scenario}-${width}.png`) });
        checks.push({ harness, phase, width, passed: true });
      }
    }
  }
  expect(errors).toEqual([]);
  await writeFile(resolve(output, `browser-${harnesses.join("-")}-result.json`), JSON.stringify({
    browser: browser.version(), checks, errors,
  }, null, 2));
  console.log(JSON.stringify({ browser: browser.version(), checks: checks.length, errors }));
} finally {
  await browser.close();
}
