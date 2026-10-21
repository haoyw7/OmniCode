import { expect, test } from "@playwright/test";

for (const reduced of [false, true]) {
  test(`file-tree divider only appears between visible columns (reduced=${reduced})`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1300, height: 900 });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await page.goto("/tests/browser/desktop-tools.html?editor=source&explorer");
    const explorer = page.locator('[data-pane-id="tools-editor"] .desktop-file-explorer');
    const body = explorer.locator(".desktop-file-explorer-body");
    const tree = explorer.locator(".desktop-file-explorer-tree");
    const editor = explorer.locator(".cm-editor");
    const divider = explorer.getByRole("separator", { name: "Resize file tree", includeHidden: true });
    await expect(editor).toBeVisible();
    await page.evaluate(() => {
      (window as any).toolsFixture.setSidebarOpen(false);
      (window as any).toolsFixture.setTerminalOpen(false);
    });
    await expect(body).toHaveAttribute("data-split-layout", "false");
    await expect(body).toHaveAttribute("data-fold-state", "closed");
    await editor.evaluate(node => node.setAttribute("data-retained", "editor"));
    await editor.locator(".cm-content").fill("Keep this unsaved file edit");
    await expect(divider).toHaveCount(0);
    await explorer.getByRole("button", { name: "Back to file tree", exact: true }).click();
    await expect(body).toHaveAttribute("data-fold-state", "open");
    await expect(tree).toBeVisible();
    await expect(editor).not.toBeVisible();
    await expect(divider).toHaveCount(0);
    await explorer.locator('[data-file-tab-id="tools-source"] > .surface-tab').click();
    await expect(body).toHaveAttribute("data-fold-state", "closed");
    await expect(editor).toBeVisible();
    await expect(divider).toHaveCount(0);
    const preview = (await explorer.locator(".desktop-file-explorer-preview").boundingBox())!;
    const narrow = (await body.boundingBox())!;
    expect(Math.abs(preview.x - narrow.x)).toBeLessThan(1);
    expect(Math.abs(preview.width - narrow.width)).toBeLessThan(1);

    await page.setViewportSize({ width: 2400, height: 1000 });
    await expect(body).toHaveAttribute("data-split-layout", "true");
    await expect(body).toHaveAttribute("data-fold-state", "open");
    await expect(divider).toBeVisible();
    const start = (await divider.boundingBox())!, before = (await tree.boundingBox())!.width;
    await page.mouse.move(start.x, start.y + 70);
    await page.mouse.down();
    await page.mouse.move(start.x + 40, start.y + 70);
    await expect.poll(async () => (await tree.boundingBox())!.width).toBeCloseTo(before + 40, 0);
    await page.mouse.up();
    const expandedWidth = (await tree.boundingBox())!.width;
    const toggle = explorer.getByRole("button", { name: "Show file tree", exact: true });
    await toggle.click();
    await expect(divider).toHaveCount(0);
    await expect(body).toHaveAttribute("data-fold-state", "closed");
    await toggle.click();
    await expect(body).toHaveAttribute("data-fold-state", "open");
    await expect(divider).toBeVisible();
    expect((await tree.boundingBox())!.width).toBeCloseTo(expandedWidth, 0);
    await expect(editor).toHaveAttribute("data-retained", "editor");
    await expect(editor.locator(".cm-content")).toHaveText("Keep this unsaved file edit");
    await expect(page.locator("[data-resize-cursor]")).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("file-tree-split.png") });
  });
}
