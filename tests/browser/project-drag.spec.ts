import { expect, test, type Page } from "@playwright/test";

const names = ["cha-k", "optimize-session-model-agent-loading", "ba", "delta", "epsilon"];
const path = (name: string) => `/fixture/${name}`;

async function drag(page: Page, name: string, destination: string) {
  const source = await page.locator(`[data-project-path="${path(name)}"] [data-project-header]`).boundingBox();
  const target = await page.locator(`[data-project-path="${path(destination)}"] [data-project-header]`).boundingBox();
  expect(source).not.toBeNull(); expect(target).not.toBeNull();
  await page.mouse.move(source!.x + 100, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + 150, target!.y + target!.height / 2, { steps: 8 });
  await expect(page.locator(".drag-ghost-card")).toBeVisible();
  await page.waitForTimeout(300);
}

async function visibleRows(page: Page, excluded?: string) {
  const rows = names.filter(name => name !== excluded);
  for (const name of rows) {
    const result = await page.locator(`[data-project-path="${path(name)}"] [data-project-header]`).evaluate(header => {
      const box = header.getBoundingClientRect();
      const hits = document.elementsFromPoint(box.left + 40, box.top + box.height / 2);
      const matrix = new DOMMatrix(getComputedStyle(header.closest<HTMLElement>("[data-project-path]")!).transform);
      return {
        paths: [...new Set(hits.map(hit => hit.closest<HTMLElement>("[data-project-path]")?.dataset.projectPath).filter(Boolean))],
        opacity: getComputedStyle(header.closest<HTMLElement>("[data-project-path]")!).opacity,
        top: box.top,
        transform: getComputedStyle(header.closest<HTMLElement>("[data-project-path]")!).transform,
        offset: [matrix.m41, matrix.m42],
        clipping: header.closest<HTMLElement>(".zen-fold-item") && getComputedStyle(header.closest<HTMLElement>(".zen-fold-item")!).overflow,
      };
    });
    expect(result.paths, `${name}: ${JSON.stringify(result)}`).toContain(path(name));
    expect(Number(result.opacity), name).toBeGreaterThan(0);
    if (!excluded) expect(result.offset, name).toEqual([0, 0]);
  }
}

for (const reduced of [false, true]) {
  test(`dragging an expanded project preserves its children (reduced=${reduced})`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await page.goto("/tests/browser/project-drag.html");
    const source = page.locator(`[data-project-path="${path("ba")}"]`);
    await source.locator("[data-project-tile]").click();
    const fold = source.locator(".project-tree-collapse");
    await expect(fold).toHaveAttribute("data-fold-state", "open");
    const input = source.getByRole("textbox", { name: "Retained project state" });
    await input.fill("Preserved during drag");
    await drag(page, "ba", "epsilon");
    await expect(fold).toBeHidden();
    await expect(source.locator("[data-project-tile]")).toHaveAttribute("aria-expanded", "true");
    await visibleRows(page, "ba");
    await page.screenshot({ path: testInfo.outputPath("expanded-drag.png") });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator(".drag-ghost-card")).toHaveCount(0);
    await expect(fold).toHaveAttribute("data-fold-state", "open");
    await expect(input).toHaveValue("Preserved during drag");
    await visibleRows(page);
  });
}

for (const origin of ["projects", "group", "pinned"]) {
  for (const reduced of [false, true]) {
    test(`project siblings remain visible while sorting (${origin}, reduced=${reduced})`, async ({ page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      await page.goto(`/tests/browser/project-drag.html?origin=${origin}`);
      await expect(page.locator(`[data-project-path="${path("epsilon")}"]`)).toBeVisible();
      await visibleRows(page);
      await drag(page, "ba", "epsilon");
      await page.screenshot({ path: testInfo.outputPath("drag-down.png") });
      await visibleRows(page, "ba");
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await expect(page.locator(".drag-ghost-card")).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("after-drop.png") });
      await visibleRows(page);
      await drag(page, "ba", "cha-k");
      await page.screenshot({ path: testInfo.outputPath("drag-up.png") });
      await visibleRows(page, "ba");
      await page.mouse.up();
      await expect(page.locator(".drag-ghost-card")).toHaveCount(0);
      await visibleRows(page);
      const order = await page.locator("[data-project-path]").evaluateAll(rows => rows.slice(0, 5).map(row => (row as HTMLElement).dataset.projectPath));
      expect(order).toEqual(["ba", ...names.filter(name => name !== "ba")].map(path));
    });
  }
}
