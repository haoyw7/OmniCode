import { expect, test, type Page } from "@playwright/test";

type FixtureWindow = Window & { resizeFixture: { rerender(): void; unmount(): void; commits: number[]; renders: number; isPaneResizing(): boolean } };
const width = (page: Page) => page.locator('[data-panel][id="first"]').evaluate(element => element.getBoundingClientRect().width);
async function start(page: Page) {
  const handle = page.getByRole("separator", { name: "Resize content" });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).resizeFixture.isPaneResizing())).toBe(true);
  return { x: box.x + box.width / 2, y: box.y + 80 };
}
test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/resizable-primitives.html");
  await expect(page.locator("[data-content] p")).toHaveCount(1000);
});

test("resizes live through reversals, preserves content, and commits only after release", async ({ page }) => {
  const original = await width(page);
  const renders = await page.evaluate(() => (window as FixtureWindow).resizeFixture.renders);
  const point = await start(page);
  for (const delta of [90, 30, 130, 50]) {
    await page.mouse.move(point.x + delta, point.y);
    await expect.poll(() => width(page)).toBeCloseTo(original + delta, 0);
    expect(await page.evaluate(() => (window as FixtureWindow).resizeFixture.commits)).toEqual([]);
  }
  await page.evaluate(() => (window as FixtureWindow).resizeFixture.rerender());
  expect(await width(page)).toBeCloseTo(original + 50, 0);
  expect(await page.evaluate(() => (window as FixtureWindow).resizeFixture.renders)).toBe(renders);
  await page.mouse.up();
  expect(await page.evaluate(() => (window as FixtureWindow).resizeFixture.commits)).toHaveLength(1);
  const next = await start(page);
  await page.mouse.move(next.x - 30, next.y);
  await page.mouse.up();
  expect(await width(page)).toBeCloseTo(original + 20, 0);
  await expect(page.getByLabel("Draft").first()).toHaveValue("Keep this draft");
  await expect(page.locator("[data-resize-cursor]")).toHaveCount(0);
});

for (const reason of ["Escape", "pointercancel", "blur", "lostpointercapture", "unmount"] as const) {
  test(`cancels and cleans up on ${reason}`, async ({ page }) => {
    const original = await width(page);
    const point = await start(page);
    await page.mouse.move(point.x + 100, point.y);
    if (reason === "Escape") await page.keyboard.press("Escape");
    else await page.evaluate(reason => {
      if (reason === "blur") window.dispatchEvent(new Event("blur"));
      else if (reason === "unmount") (window as FixtureWindow).resizeFixture.unmount();
      else {
        const handle = document.querySelector('[data-ui="resizable-handle"]')!;
        if (reason === "lostpointercapture") handle.releasePointerCapture(1);
        else handle.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, pointerType: "mouse", bubbles: true }));
      }
    }, reason);
    await page.mouse.up();
    if (reason !== "unmount") expect(await width(page)).toBeCloseTo(original, 0);
    expect(await page.evaluate(() => (window as FixtureWindow).resizeFixture.commits)).toEqual([]);
    expect(await page.evaluate(() => (window as FixtureWindow).resizeFixture.isPaneResizing())).toBe(false);
    await expect(page.locator("[data-resize-cursor]")).toHaveCount(0);
  });
}

test("enforces pixel constraints and supports keyboard resizing", async ({ page }) => {
  const point = await start(page);
  await page.mouse.move(0, point.y);
  await expect.poll(() => width(page)).toBeCloseTo(240, 0);
  await page.mouse.move(1000, point.y);
  await expect.poll(() => width(page)).toBeCloseTo(500, 0);
  await page.mouse.up();
  await page.getByRole("separator").focus();
  await page.keyboard.press("ArrowLeft");
  expect(await width(page)).toBeLessThan(500);
  expect(await page.evaluate(() => (window as FixtureWindow).resizeFixture.isPaneResizing())).toBe(false);
});
