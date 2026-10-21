import { expect, test } from "@playwright/test";

for (const reduced of [false, true]) {
  test(`panel disclosure retains the terminal, editor and composer (reduced=${reduced})`, async ({ page }) => {
    await page.setViewportSize({ width: 2200, height: 1000 });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await page.goto("/tests/browser/desktop-tools.html?editor=source&explorer&history=long");
    const dock = page.locator("[data-terminal-dock-layout]");
    const terminal = dock.locator(".xterm");
    const editor = page.locator(".cm-content").first();
    const composer = page.locator(".composer-field").first();
    await expect(terminal).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.evaluate(() => (window as any).toolsFixture.rpc.filter((call: any) => call.command === "pty_resize").length)).toBeGreaterThan(0);
    await terminal.evaluate(node => node.setAttribute("data-retained", "terminal"));
    await editor.fill("Keep this unsaved edit");
    await composer.fill("Keep this draft");
    const initialSpawns = await page.evaluate(() => (window as any).toolsFixture.rpc.filter((call: any) => call.command === "pty_spawn").length);
    const heights = await page.evaluate(async () => {
      const state = window as any;
      const panel = document.querySelector<HTMLElement>("[data-project-terminal-dock]")!;
      const heights = [panel.getBoundingClientRect().height];
      state.toolsFixture.setTerminalOpen(false);
      const start = performance.now();
      while (performance.now() - start < 600) {
        await new Promise(requestAnimationFrame);
        heights.push(panel.getBoundingClientRect().height);
      }
      return heights;
    });
    await expect(dock).toHaveAttribute("data-fold-state", "closed");
    expect(heights.at(-1)).toBe(0);
    if (!reduced) expect(heights.some(height => height > 1 && height < heights[0] - 1)).toBe(true);
    await expect(terminal).toHaveAttribute("data-retained", "terminal");
    await page.evaluate(() => (window as any).toolsFixture.setTerminalOpen(true));
    await expect(dock).toHaveAttribute("data-fold-state", "open");
    await expect(terminal).toBeVisible();

    const treeButton = page.locator('.desktop-file-explorer button[aria-label="Show file tree"]');
    const tree = page.locator(".desktop-file-explorer-tree");
    await treeButton.click();
    await expect(tree).toHaveAttribute("inert", "");
    await treeButton.click();
    await expect(tree).not.toHaveAttribute("inert", "");
    await expect(editor).toContainText("Keep this unsaved edit");
    await expect(composer).toHaveValue("Keep this draft");

    await page.evaluate(async () => {
      const state = window as any;
      state.toolsFixture.setSidebarOpen(false);
      await new Promise(resolve => setTimeout(resolve, 60));
      state.toolsFixture.setSidebarOpen(true);
    });
    await expect(page.locator("[data-sidebar-transition]")).toHaveAttribute("data-fold-state", "open");
    const calls = await page.evaluate(() => (window as any).toolsFixture.rpc.map((call: any) => call.command));
    expect(calls.filter((command: string) => command === "pty_spawn")).toHaveLength(initialSpawns);
    expect(calls).not.toContain("pty_kill");
    await expect(terminal).toHaveAttribute("data-retained", "terminal");
  });
}
