import { expect, test } from "@playwright/test";

type FixtureWindow = Window & {
  toolsFixture: {
    readTerminal(paneId?: string): { lines: string[]; cols: number; rows: number };
    setTerminalOpen(open: boolean): void;
    output(text: string, id?: string): void;
    rpc: { command: string; args?: { id?: string; cols?: number; rows?: number } }[];
  };
};

for (const mode of ["shell", "tui"] as const) {
  test(`${mode} reflows and notifies the PTY before pointer release without scaling text`, async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 1000 });
    await page.goto("/tests/browser/desktop-tools.html?editor=terminal&history=long");
    const pane = page.locator('[data-pane-id="tools-editor"]');
    const terminal = pane.locator(".xterm");
    const lines = () => page.evaluate(() => (window as FixtureWindow).toolsFixture.readTerminal().lines);
    await expect.poll(async () => (await lines()).join("\n")).toContain("git status");
    await page.evaluate(() => (window as FixtureWindow).toolsFixture.setTerminalOpen(false));
    const resizing = () => page.evaluate(async () => {
      const module = "/src/shared/lib/paneResize.ts";
      return (await import(module)).isPaneResizing();
    });
    await expect.poll(resizing).toBe(false);
    await page.evaluate(mode => {
      const text = `${mode === "tui" ? "\x1b[?1049h" : ""}\x1b[3J\x1b[2J\x1b[HREFLOW${"0123456789".repeat(60)}END\r\nREADY`;
      (window as FixtureWindow).toolsFixture.output(text, "tools-pane-pty");
    }, mode);
    await expect.poll(async () => (await lines()).join("\n")).toContain("READY");
    await terminal.evaluate(element => {
      const style = [...element.querySelectorAll(".xterm-screen > style")]
        .find(style => style.textContent?.includes("vertical-align: top"));

      const state = window as Window & { terminalStyleMutations: number };
      state.terminalStyleMutations = 0;
      if (!style) return;
      new MutationObserver(records => { state.terminalStyleMutations += records.length; })
        .observe(style, { childList: true, characterData: true, subtree: true });
    });
    const size = () => page.evaluate(() => (window as FixtureWindow).toolsFixture.rpc.filter(
      call => call.command === "pty_resize" && call.args?.id === "tools-pane-pty",
    ).at(-1)!.args!);
    const wrappedRows = async () => (await lines()).findIndex(row => row.includes("READY"));
    const original = await size();
    const beforeRows = await wrappedRows();
    await terminal.evaluate(element => element.setAttribute("data-retained-terminal", "true"));
    const initialWidth = (await pane.boundingBox())!.width;
    const renderer = pane.locator(".monocode-terminal-renderer");
    const rendererWidth = (await renderer.boundingBox())!.width;
    const handle = page.locator('[data-pane-sash="tools-split:0"] > .resize-handle');
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + 100;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (const delta of [120, 220, 100, 180]) {
      await page.mouse.move(x + delta, y);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(Math.abs((await pane.boundingBox())!.width - initialWidth + delta)).toBeLessThan(1);
      expect(Math.abs((await renderer.boundingBox())!.width - rendererWidth + delta)).toBeLessThan(1);
      expect(await resizing()).toBe(true);
      const current = await size();
      expect(current.cols).toBeLessThan(original.cols!);
      expect(current.rows).toBe(original.rows);
      if (mode === "shell") expect(await wrappedRows()).toBeGreaterThan(beforeRows);
      const scales = await terminal.evaluate(element => {
        const values: number[] = [];
        for (let node: Element | null = element; node; node = node.parentElement) {
          const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
          values.push(matrix.a, matrix.d);
        }
        return values;
      });
      for (const scale of scales) expect(scale).toBeCloseTo(1, 3);
    }
    await page.evaluate(() => (window as FixtureWindow).toolsFixture.output("\r\nLIVE_OUTPUT", "tools-pane-pty"));
    await expect.poll(async () => (await lines()).join("\n")).toContain("LIVE_OUTPUT");
    const beforeRelease = await size();
    await page.mouse.up();
    await expect.poll(resizing).toBe(false);
    expect(await size()).toEqual(beforeRelease);
    expect(await page.evaluate(() => (window as Window & { terminalStyleMutations: number }).terminalStyleMutations)).toBe(0);
    await expect(terminal).toHaveAttribute("data-retained-terminal", "true");
  });
}
