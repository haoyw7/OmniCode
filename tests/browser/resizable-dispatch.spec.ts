import { expect, test } from "@playwright/test";

test("compares v4 group and flat layout controls with identical content and trajectories", async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const results = [];
  for (const mode of ["group", "region", "group", "region"] as const) {
    await page.goto(`/tests/browser/resizable-primitives.html${mode === "region" ? "?region" : ""}`);
    await expect(page.locator("[data-content] p")).toHaveCount(1000);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    const rows = await page.locator("[data-content] p").allTextContents();
    const handle = page.getByRole("separator", { name: "Resize content" });
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + 80;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.evaluate(() => {
      const samples: number[] = [];
      const changes: { type: string; at: number }[] = [];
      let start = 0;
      const begin = () => { start = performance.now(); };
      const end = () => { samples.push(performance.now() - start); };
      const focus = (event: Event) => { if (event.target === window) changes.push({ type: event.type, at: performance.now() }); };
      window.addEventListener("pointermove", begin, true);
      window.addEventListener("pointermove", end);
      window.addEventListener("blur", focus);
      window.addEventListener("focus", focus);
      const beganAt = performance.now();
      Object.assign(window, { finishDispatchSample: () => {
        window.removeEventListener("pointermove", begin, true);
        window.removeEventListener("pointermove", end);
        window.removeEventListener("blur", focus);
        window.removeEventListener("focus", focus);
        const sorted = samples.toSorted((a, b) => a - b);
        return { samples, count: samples.length, p95: sorted[Math.ceil(sorted.length * 0.95) - 1], elapsed: performance.now() - beganAt, changes, focused: document.hasFocus() };
      } });
    });
    try {
      const started = performance.now();
      for (let index = 0; index < 120; index++) {
        const target = started + index * 25;
        const delay = target - performance.now();
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        const phase = index % 40;
        const delta = phase <= 20 ? phase * 4 : (40 - phase) * 4;
        await page.mouse.move(x + delta, y);
      }
    } finally {
      const data = await page.evaluate(() => {
        const fixture = window as unknown as {
          finishDispatchSample(): { count: number; p95: number; elapsed: number; changes: unknown[]; focused: boolean; samples: number[] };
          resizeFixture: { hmrUpdates: number; renders: number };
        };
        return { ...fixture.finishDispatchSample(), hmrUpdates: fixture.resizeFixture.hmrUpdates, renders: fixture.resizeFixture.renders };
      });
      results.push({ mode, ...data });
      await page.mouse.up();
    }
    expect(await page.locator("[data-content] p").allTextContents()).toEqual(rows);
    await expect(page.locator("[data-resize-cursor]")).toHaveCount(0);
  }
  await testInfo.attach("dispatch-samples.json", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
  for (const { samples: _, ...result } of results) console.log(JSON.stringify(result));
  expect(results.every(result => result.count === 120 && result.hmrUpdates === 0 && result.focused && result.changes.length === 0)).toBe(true);
});
