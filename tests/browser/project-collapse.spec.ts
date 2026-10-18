import { expect, test } from "@playwright/test";

for (const reduced of [false, true]) {
  test(`project disclosure follows loaded sessions without jumping or scaling (reduced=${reduced})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await page.goto("/tests/browser/project-drag.html?sessions&loading");
    const project = page.locator('[data-project-path="/fixture/ba"]');
    await expect(project).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const samples = await project.evaluate(async (row) => {
      const samples: { height: number; scale: number; rowHeight?: number }[] = [];
      row.querySelector<HTMLButtonElement>("[data-project-tile]")!.click();
      const start = performance.now();
      while (performance.now() - start < 650) {
        await new Promise(requestAnimationFrame);
        const fold = row.querySelector<HTMLElement>(".project-tree-collapse")!;
        const session = row.querySelector<HTMLElement>("[data-session-row]");
        samples.push({
          height: fold.getBoundingClientRect().height,
          scale: new DOMMatrixReadOnly(getComputedStyle(fold).transform).m22,
          rowHeight: session?.getBoundingClientRect().height,
        });
      }
      return samples;
    });
    const fold = project.locator(".project-tree-collapse");
    await expect(fold).toHaveAttribute("data-fold-state", "open");
    const finalHeight = samples.at(-1)!.height;
    expect(finalHeight).toBeGreaterThan(150);
    expect(samples.every(sample => Math.abs(sample.scale - 1) < 0.001)).toBe(true);
    if (!reduced) {
      expect(samples.some(sample => sample.height > finalHeight * 0.3 && sample.height < finalHeight * 0.85)).toBe(true);
      for (let i = 1; i < samples.length; i++)
        expect(samples[i].height).toBeGreaterThanOrEqual(samples[i - 1].height - 1);
    }
    const firstRow = project.locator("[data-session-row]").first();
    const rowHeight = (await firstRow.boundingBox())!.height;
    expect(samples.filter(sample => sample.rowHeight).every(sample => Math.abs(sample.rowHeight! - rowHeight) < 1)).toBe(true);

    await project.locator("[data-session-list-toggle]").click();
    await expect(project.locator('[data-session-row="/fixture/ba-9"]')).toBeVisible();
    await expect.poll(() => fold.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(finalHeight + 100);
    const closing = await project.evaluate(async row => {
      const fold = row.querySelector<HTMLElement>(".project-tree-collapse")!;
      const heights = [fold.getBoundingClientRect().height];
      row.querySelector<HTMLButtonElement>("[data-project-tile]")!.click();
      const start = performance.now();
      while (performance.now() - start < 400) {
        await new Promise(requestAnimationFrame);
        heights.push(fold.getBoundingClientRect().height);
      }
      return heights;
    });
    for (let i = 1; i < closing.length; i++)
      expect(closing[i]).toBeLessThanOrEqual(closing[i - 1] + 1);
    await expect(fold).toBeHidden();
    await project.evaluate(async row => {
      const toggle = row.querySelector<HTMLButtonElement>("[data-project-tile]")!;
      toggle.click();
      await new Promise(resolve => setTimeout(resolve, 60));
      toggle.click();
      await new Promise(resolve => setTimeout(resolve, 40));
      toggle.click();
    });
    await expect(fold).toHaveAttribute("data-fold-state", "open");
    await expect(firstRow).toBeVisible();
    await expect.poll(() => fold.evaluate(el => el.getBoundingClientRect().height)).toBeCloseTo(finalHeight, 0);
    await expect(fold).not.toHaveAttribute("inert", "");
  });
}
