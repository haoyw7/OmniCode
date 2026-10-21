import { test, expect } from "@playwright/test";

test("flat layout control preserves content during live resize, cancellation and a second gesture", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/tests/browser/resizable-primitives.html?region");
  await expect(page.locator("[data-content] p")).toHaveCount(1000);
  const width = () => page.locator("[data-region-panel]").evaluate(element => element.getBoundingClientRect().width);
  const handle = page.getByRole("separator", { name: "Resize content" });
  await expect.poll(width).toBe(280);
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x, box.y + 80);
  await page.mouse.down();
  for (const delta of [80, 30, 120]) {
    await page.mouse.move(box.x + delta, box.y + 80);
    await expect.poll(width).toBeCloseTo(280 + delta, 0);
  }
  await page.evaluate(() => (window as any).resizeFixture.rerender());
  await expect.poll(width).toBe(400);
  expect(await page.evaluate(() => (window as any).resizeFixture.commits)).toEqual([]);
  expect(await page.evaluate(() => (window as any).resizeFixture.renders)).toBe(2);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(width).toBe(280);
  await expect(page.locator("[data-resize-cursor]")).toHaveCount(0);
  await page.mouse.move(box.x, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 80);
  await page.mouse.up();
  await expect.poll(width).toBe(340);
  expect(await page.evaluate(() => (window as any).resizeFixture.commits)).toEqual([340]);
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(width).toBeGreaterThan(340);
  await expect(page.getByLabel("Draft").first()).toHaveValue("Keep this draft");
  expect(errors).toEqual([]);
});
