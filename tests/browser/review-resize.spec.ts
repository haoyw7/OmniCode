import { expect, test } from "@playwright/test";

test("review keeps wrapped code, gutters and hunk controls aligned while resizing", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.goto("/tests/browser/desktop-tools.html?editor=review&split=right&reviewResize");
  const review = page.locator("[data-git-review-pane]");
  await expect(review).toBeVisible();
  await expect(review).toHaveCSS("container-type", "normal");
  const host = review.locator("diffs-container").first();
  await expect(host.locator("[data-line]").first()).toBeVisible();
  const snapshot = () => host.evaluate(el => {
    const shadow = el.shadowRoot!;
    const code = shadow.querySelector<HTMLElement>("[data-code]")!;
    const lines = [...shadow.querySelectorAll<HTMLElement>("[data-line]")];
    const numbers = [...shadow.querySelectorAll<HTMLElement>("[data-column-number]")];
    return {
      text: lines.map(line => line.textContent),
      height: lines[0].getBoundingClientRect().height,
      alignment: lines.map((line, index) => {
        const rect = line.getBoundingClientRect();
        const number = numbers[index]?.getBoundingClientRect();
        return number ? Math.abs(rect.y - number.y) + Math.abs(rect.height - number.height) : Infinity;
      }),
      overflow: code.scrollWidth - code.clientWidth,
      tokens: shadow.querySelectorAll("[data-line] span").length,
      separators: shadow.querySelectorAll("[data-expand-button]").length,
      sizeQueries: [...shadow.querySelectorAll<HTMLElement>("[data-container-size]")]
        .map(column => getComputedStyle(column).containerType),
      headingWidths: [...shadow.querySelectorAll<HTMLElement>('[data-unified] [data-separator="line-info"] [data-separator-wrapper]')]
        .filter(heading => heading.getClientRects().length > 0)
        .map(heading => Math.abs(heading.getBoundingClientRect().width - code.getBoundingClientRect().width)),
    };
  });
  const initial = await snapshot();
  expect(initial.tokens).toBeGreaterThan(0);
  expect(initial.separators).toBeGreaterThan(0);
  const heights: number[] = [];
  for (const width of [1050, 2300, 1400]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    // The initial main-thread viewer is replaced when its highlighting worker
    // becomes ready. Wait for that async render as well as resize layout.
    await expect(async () => {
      const state = await snapshot();
      expect(state.text).toEqual(initial.text);
      expect(Math.max(...state.alignment)).toBeLessThan(1);
      expect(state.overflow).toBeLessThanOrEqual(1);
      expect(state.sizeQueries.every(type => type === "normal")).toBe(true);
      expect(Math.max(...state.headingWidths)).toBeLessThan(1);
    }).toPass();
    const narrow = await review.evaluate(el => el.clientWidth < 36 * parseFloat(getComputedStyle(document.documentElement).fontSize));
    if (narrow) await expect(review.locator(".git-review-worktree")).toBeHidden();
    else await expect(review.locator(".git-review-worktree")).toBeVisible();
    heights.push((await snapshot()).height);
  }
  expect(heights[0]).toBeGreaterThan(heights[1]);
  const beforeExpansion = (await snapshot()).text.length;
  await host.locator("[data-expand-button]").first().click();
  await expect.poll(async () => (await snapshot()).text.length).toBeGreaterThan(beforeExpansion);
  expect(Math.max(...(await snapshot()).headingWidths)).toBeLessThan(1);
});

test("review divider follows pointer reversals, commits and cancels with terminal mounted", async ({ page }) => {
  await page.setViewportSize({ width: 2200, height: 1000 });
  await page.goto("/tests/browser/desktop-tools.html?editor=review&split=right&reviewResize");
  const review = page.locator("[data-git-review-pane]");
  const host = review.locator("diffs-container").first();
  const terminal = page.locator(".xterm");
  const sash = page.locator('[data-pane-sash="tools-split:0"]');
  const handle = sash.locator(".resize-handle");
  await expect(host.locator("[data-line]").first()).toBeVisible();
  await expect(terminal).toBeVisible();
  await terminal.evaluate(el => el.setAttribute("data-resize-retained", "true"));
  const text = await host.locator("[data-line]").allTextContents();
  const original = (await sash.boundingBox())!;
  const box = (await handle.boundingBox())!;
  const startX = box.x + box.width / 2;
  const y = box.y + 100;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await expect(handle).toHaveAttribute("data-dragging", "true");
  await expect(page.locator('[data-resize-cursor="col-resize"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.classList.contains("is-reordering"))).toBe(false);
  for (const delta of [-100, 80, -60]) {
    await page.mouse.move(startX + delta, y);
    await expect.poll(async () => Math.abs((await sash.boundingBox())!.x - original.x - delta)).toBeLessThan(1);
    expect(await handle.evaluate(el => el.hasPointerCapture(1))).toBe(true);
    await expect.poll(() => host.locator("[data-line]").allTextContents()).toEqual(text);
  }
  await page.mouse.up();
  await expect(handle).not.toHaveAttribute("data-dragging");
  await expect(page.locator("[data-resize-cursor]")).toHaveCount(0);
  expect(Math.abs((await sash.boundingBox())!.x - original.x + 60)).toBeLessThan(1);
  // A second gesture must work and Escape must restore the committed size.
  await page.mouse.down();
  await page.mouse.move(startX + 40, y);
  await expect.poll(async () => Math.abs((await sash.boundingBox())!.x - original.x - 40)).toBeLessThan(1);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await sash.boundingBox())!.x - original.x + 60)).toBeLessThan(1);
  await expect(handle).not.toHaveAttribute("data-dragging");
  await expect(page.locator("[data-resize-cursor]")).toHaveCount(0);
  await expect(terminal).toHaveAttribute("data-resize-retained", "true");
  await expect.poll(() => host.locator("[data-line]").allTextContents()).toEqual(text);
  expect(await page.evaluate(() => document.documentElement.classList.contains("is-resizing"))).toBe(false);
});
