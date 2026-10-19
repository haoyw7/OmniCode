import { expect, test } from "@playwright/test";

test("split rich diffs keep wrapping and gutters aligned during a resize", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("omnicode.reviewViewOptions.v1", JSON.stringify({
    sideBySide: true, wordWrap: true, highlightWords: true,
  })));
  await page.setViewportSize({ width: 2200, height: 1000 });
  await page.goto("/tests/browser/desktop-tools.html?editor=review&split=right&reviewResize&reviewStress");
  const file = page.locator('[data-review-file="src/workspace.ts"]');
  const host = file.locator("diffs-container");
  await expect(host.locator("[data-line] span").first()).toBeVisible();
  await expect(file.locator("[aria-busy=true]")).toHaveCount(0);
  await host.evaluate(el => el.setAttribute("data-retained", "true"));
  const handle = page.locator('[data-pane-sash="tools-split:0"] .resize-handle');
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + 100;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (const offset of [-120, 80, -60]) {
    await page.mouse.move(x + offset, y);
    await expect(async () => {
      const columns = await host.evaluate(el => [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-code]")].map(code => {
        const lines = [...code.querySelectorAll<HTMLElement>("[data-line]")];
        const numbers = [...code.querySelectorAll<HTMLElement>("[data-column-number]")];
        return {
          lines: lines.length,
          overflow: code.scrollWidth - code.clientWidth,
          alignment: Math.max(...lines.map((line, index) => {
            const a = line.getBoundingClientRect(), b = numbers[index].getBoundingClientRect();
            return Math.abs(a.y - b.y) + Math.abs(a.height - b.height);
          })),
        };
      }));
      expect(columns).toHaveLength(2);
      for (const column of columns) {
        expect(column.lines).toBeGreaterThan(0);
        expect(column.overflow).toBeLessThanOrEqual(1);
        expect(column.alignment).toBeLessThan(1);
      }
    }).toPass();
  }
  await page.mouse.up();
  await expect(host).toHaveAttribute("data-retained", "true");
  await page.getByRole("button", { name: "Review options", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Word wrap", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(host.locator('[data-overflow="scroll"]')).toHaveCount(1);
  await expect(host.locator("[data-line] span").first()).toBeVisible();
});

test("large rich diffs keep every line reachable through the review scroll box", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 2200, height: 1000 });
  await page.goto("/tests/browser/desktop-tools.html?editor=review&split=right&reviewResize&reviewStress");
  const review = page.locator("[data-git-review-pane]");
  const file = review.locator('[data-review-file="src/workspace.ts"]');
  const host = file.locator("diffs-container");
  await expect(host.locator("[data-line] span").first()).toBeVisible();
  // Wait for the initial highlighter/worker handover before retaining nodes.
  await expect(file.locator("[aria-busy=true]")).toHaveCount(0);
  const scroller = review.locator("[data-review-scroll]");
  const seen = new Set<string>();
  let alignment = 0;
  for (let step = 0; step < 120; step++) {
    const state = await host.evaluate(el => {
      const root = el.shadowRoot!;
      const lines = [...root.querySelectorAll<HTMLElement>("[data-line]")];
      const numbers = [...root.querySelectorAll<HTMLElement>("[data-column-number]")];
      return {
        lines: lines.map(line => line.textContent!),
        tokens: root.querySelectorAll("[data-line] span").length,
        alignment: Math.max(...lines.map((line, index) => {
          const a = line.getBoundingClientRect(), b = numbers[index].getBoundingClientRect();
          return Math.abs(a.y - b.y) + Math.abs(a.height - b.height);
        })),
      };
    });
    state.lines.forEach(line => seen.add(line));
    alignment = Math.max(alignment, state.alignment);
    expect(state.tokens).toBeGreaterThan(0);
    expect(state.lines.length).toBeLessThan(400);
    if (seen.size === 400) break;
    await scroller.evaluate(el => { el.scrollTop += el.clientHeight * 0.6; });
    await page.waitForTimeout(100);
  }
  expect(seen.size).toBe(400);
  expect(alignment).toBeLessThan(1);
  await scroller.evaluate(el => { el.scrollTop = 0; });
  await expect(host.locator("[data-line]").first()).toContainText("setting0");
  await expect(file.getByRole("button", { name: "Stage hunk", exact: true }).first()).toBeVisible();
  await expect(file.locator(".review-diff-virtual")).toHaveCount(0);
});

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
  // The worker can replace the initial renderer between the first visible
  // line and this read. Retry initialization before capturing the baseline.
  let initial!: Awaited<ReturnType<typeof snapshot>>;
  await expect(async () => {
    const state = await snapshot();
    expect(state.tokens).toBeGreaterThan(0);
    expect(state.separators).toBeGreaterThan(0);
    initial = state;
  }).toPass();
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
