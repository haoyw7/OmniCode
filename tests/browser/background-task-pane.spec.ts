import { expect, test } from "@playwright/test";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`background tasks use file chrome and retain live content after docking (${reducedMotion})`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.emulateMedia({ reducedMotion });
    await page.goto("/tests/browser/desktop-tools.html?editor=source&explorer&backgroundTasks", { waitUntil: "domcontentloaded" });
    const editor = page.locator('css:light=[data-pane-id="tools-editor"]');
    await expect(editor.locator(".cm-editor")).toBeVisible();
    await editor.locator(".cm-editor").evaluate(node => node.setAttribute("data-retained-editor", "true"));
    await page.locator('css:light=.background-task-open[title="Running background task"]').click();
    const panel = page.locator("css:light=[data-background-tasks-panel]");
    const pane = page.locator("css:light=[data-pane-id]").filter({ has: page.locator(".desktop-background-tasks") });
    await expect(pane.locator("[data-background-tasks-panel]")).toHaveCount(1);
    await expect(panel.getByLabel("Output", { exact: true }).first()).toHaveText("Initial task output");
    const paneId = await pane.getAttribute("data-pane-id");
    const toolbarSize = async (selector: string) => page.locator(selector).first().evaluate(node => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    const fileHeader = await toolbarSize('css:light=[data-pane-id="tools-editor"] [data-surface-tab-strip]');
    const taskHeader = await toolbarSize("css:light=.desktop-background-tasks [data-surface-tab-strip]");
    expect(taskHeader.height).toBe(fileHeader.height);
    const gripSize = await toolbarSize("css:light=.desktop-background-tasks [data-surface-pane-drag]");
    expect(gripSize).toEqual(await toolbarSize('css:light=[data-pane-id="tools-editor"] [data-surface-pane-drag]'));
    expect(gripSize).toEqual({ width: 24, height: 24 });
    expect(await toolbarSize('css:light=.desktop-background-tasks [aria-label="Clear finished tasks"]')).toEqual(gripSize);

    await pane.locator("[data-card-maximize]").click();
    await expect(pane.locator("[data-card-maximize]")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("css:light=[data-background-summary]")).toHaveCount(0);
    await page.evaluate(() => (window as any).backgroundFixture.appendOutput());
    await expect(panel.getByLabel("Output", { exact: true }).first()).toHaveText("Updated task output");
    await pane.locator("[data-card-maximize]").click();
    await expect(pane.locator("[data-card-maximize]")).toHaveAttribute("aria-pressed", "false");
    await expect(editor.locator(".cm-editor")).toBeVisible();
    let lastBounds = "", stableSamples = 0;
    await expect.poll(async () => {
      const bounds = JSON.stringify([await editor.boundingBox(), await pane.boundingBox()]);
      stableSamples = bounds === lastBounds ? stableSamples + 1 : 0;
      lastBounds = bounds;
      return stableSamples;
    }, { intervals: [100, 100, 100] }).toBeGreaterThanOrEqual(2);
    const target = (await editor.boundingBox())!;
    const grip = (await pane.locator("[data-surface-pane-drag]").first().boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + 8, { steps: 8 });
    await expect(page.locator("css:light=[data-pane-insertion]")).toHaveAttribute("data-pane-insertion-target", "tools-editor");
    await expect(page.locator("css:light=[data-pane-insertion]")).toHaveAttribute("data-pane-insertion", "top");
    await page.mouse.up();
    await expect(page.locator("css:light=.sortable-overlay")).toHaveCount(0);
    await expect.poll(async () => (await editor.boundingBox())!.y - (await pane.boundingBox())!.y).toBeGreaterThan(100);
    await expect(editor.locator(".cm-editor")).toHaveAttribute("data-retained-editor", "true");
    await expect(panel.getByLabel("Output", { exact: true }).first()).toHaveText("Updated task output");
    await page.evaluate(() => (window as any).backgroundFixture.open());
    await expect(panel).toHaveCount(1);
    await expect(pane).toHaveAttribute("data-pane-id", paneId!);
    await pane.getByRole("button", { name: "Clear finished tasks", exact: true }).click();
    await expect(panel.locator('[data-background-task="background-done"]')).toHaveCount(0);
    await expect(panel.locator('[data-background-task="background-live"]')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("background-tasks-docked.png") });
  });
}
