import { expect, test } from "@playwright/test";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
for (const responseMs of [80, 320]) {
test(`returning from chat keeps list rows aligned (${reducedMotion}, refresh ${responseMs}ms)`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion });
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto(`/tests/browser/mobile-home.html?responseMs=${responseMs}`);
  const row = page.locator('[data-page-active="true"] .mobile-home-session').nth(1);
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator(".mobile-page-layer")).toHaveCount(1);
  // The cached summary expires while the conversation is open.
  await page.waitForTimeout(3100);
  const samples = await page.evaluate(async () => {
    document.querySelector<HTMLButtonElement>('[data-testid="back-to-list"]')!.click();
    const samples: { time: number; page: number; row: number; relative: number }[] = [];
    const start = performance.now();
    while (performance.now() - start < 900) {
      await new Promise(requestAnimationFrame);
      const layer = document.querySelector('[data-page-active="true"]')!;
      const row = layer.querySelector(".mobile-home-session");
      if (row) {
        const x = layer.getBoundingClientRect().x;
        const rowX = row.getBoundingClientRect().x;
        samples.push({ time: performance.now() - start, page: x, row: rowX, relative: rowX - x });
      }
    }
    return samples;
  });
  expect(samples.length).toBeGreaterThan(10);
  const offsets = samples.map(sample => sample.relative);
  expect(Math.max(...offsets) - Math.min(...offsets), JSON.stringify(samples)).toBeLessThan(1);
  await expect(page.locator('[data-page-active="true"] .mobile-home-session').first()).toHaveAttribute("data-session-id", "two");
});
}
}
