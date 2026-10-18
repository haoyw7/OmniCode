import { expect, test } from "@playwright/test";

test("composer controls adapt at the existing width thresholds without query containers", async ({ page }) => {
  await page.goto("/tests/browser/desktop-tools.html?editor=terminal");
  const surface = page.locator('[data-pane-id="tools-session"] .composer-surface');
  await expect(surface).toBeVisible();
  const access = surface.locator('.composer-leading-controls [data-access-picker-trigger] > span').first();
  const model = surface.locator('.composer-model-controls > [data-model-picker-trigger] > span').first();
  await expect(access).toBeAttached();
  await expect(model).toBeAttached();
  for (const width of [520, 479, 360, 359, 279, 219, 520]) {
    await surface.evaluate((element, width) => { element.style.width = `${width}px`; element.style.maxWidth = 'none'; }, width);
    if (width < 480) await expect(access).toHaveCSS('display', 'none');
    else await expect(access).not.toHaveCSS('display', 'none');
    if (width < 360) await expect(model).toHaveCSS('display', 'none');
    else await expect(model).not.toHaveCSS('display', 'none');
    await expect(surface).toHaveCSS('container-type', 'normal');
  }
  await surface.evaluate(element => {
    (window as Window & { breakpointWrites: number }).breakpointWrites = 0;
    new MutationObserver(records => { (window as Window & { breakpointWrites: number }).breakpointWrites += records.length; })
      .observe(element, { attributes: true, attributeFilter: ['data-inline-below', 'data-inline-at-least'] });
  });
  for (const width of [530, 540, 550]) {
    await surface.evaluate((element, width) => { element.style.width = `${width}px`; }, width);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }
  expect(await page.evaluate(() => (window as Window & { breakpointWrites: number }).breakpointWrites)).toBe(0);
});

test("transcript find stays inside narrow panes without container width units", async ({ page }) => {
  await page.setViewportSize({ width: 680, height: 800 });
  await page.goto("/tests/browser/desktop-tools.html?editor=terminal");
  const chat = page.locator('[data-pane-id="tools-session"]');
  await expect(chat.locator('.agent-transcript')).toBeVisible();
  await chat.locator('.agent-transcript').click({ position: { x: 20, y: 90 } });
  await page.keyboard.press('Control+f');
  const search = page.getByRole('search', { name: 'Find in conversation' });
  await expect(search).toBeVisible();
  const find = (await search.boundingBox())!;
  const viewport = (await chat.locator('[data-transcript-inline-size]').boundingBox())!;
  expect(find.x).toBeGreaterThanOrEqual(viewport.x + 11);
  expect(find.x + find.width).toBeLessThanOrEqual(viewport.x + viewport.width - 11);
  await page.keyboard.press('Escape');
  await expect(search).not.toBeVisible();
});
