import { expect, test } from "@playwright/test";

for (const reduced of [false, true]) for (const filesBelow of [false, true]) {
test(`closing a stacked tool keeps the chat stable (reduced=${reduced}, filesBelow=${filesBelow})`, async ({ page }, info) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  await page.addInitScript(() => localStorage.setItem("omnicode:project-chat-backgrounds", JSON.stringify({
    "/fixture/omnicode": { path: "/fixture/background.svg", effect: "gradient-blur", scope: "all" },
  })));
  await page.route("**/fixture/background.svg*", route => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="teal"/></svg>',
  }));
  await page.goto(`/tests/browser/desktop-tools.html?editor=source&explorer&history=long&stackedTools${filesBelow ? "&filesBelow" : ""}`);
  const chat = page.locator('[data-pane-id="tools-session"]');
  const file = page.locator('[data-pane-id="tools-editor"]');
  await expect(chat.locator(".agent-transcript")).toBeVisible();
  await expect(page.locator('[data-pane-id="tools-stacked-terminal"] .xterm-rows')).toContainText("git status", { timeout: 30000 });
  await page.evaluate(async () => {
    const fixture = (window as any).toolsFixture;
    fixture.setSidebarOpen(false);
    fixture.setTerminalOpen(false);
    fixture.selectFile("tools-explorer");
    await document.fonts.ready;
  });
  await expect(page.locator("[data-sidebar-transition]")).toHaveAttribute("data-fold-state", "closed");
  await expect(page.locator("[data-terminal-dock-layout]")).toHaveAttribute("data-fold-state", "closed");
  await expect(file.getByRole("button", { name: "Close panel", exact: true })).toBeVisible();
  const composer = chat.locator(".composer-field");
  await composer.fill("Keep this chat draft");
  const terminalBefore = await page.evaluate(() => ({
    rows: (window as any).toolsFixture.readTerminal("tools-stacked-terminal").rows as number,
    spawns: (window as any).toolsFixture.rpc.filter((call: { command: string }) => call.command === "pty_spawn").length as number,
  }));
  await page.evaluate(async atBottom => {
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
    const scroller = document.querySelector<HTMLElement>(".agent-transcript")!;
    scroller.scrollTop = Math.round((scroller.scrollHeight - scroller.clientHeight) / (atBottom ? 1 : 2));
    await new Promise(requestAnimationFrame);
  }, filesBelow);
  const result = await page.evaluate(async () => {
    const chat = document.querySelector<HTMLElement>('[data-pane-id="tools-session"]')!;
    const scroller = chat.querySelector<HTMLElement>(".agent-transcript")!;
    const background = chat.querySelector<HTMLElement>(".chat-pane-background")!;
    const composer = chat.querySelector(".composer-field")!;
    const terminal = document.querySelector('[data-pane-id="tools-stacked-terminal"] .xterm')!;
    const read = () => {
      const rect = chat.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scroll: scroller.scrollTop,
        clientHeight: scroller.clientHeight, scrollHeight: scroller.scrollHeight,
        background: getComputedStyle(background).getPropertyValue("--chat-background-image"),
        sameNodes: scroller === chat.querySelector(".agent-transcript") && background === chat.querySelector(".chat-pane-background") &&
          composer === chat.querySelector(".composer-field") && terminal.isConnected,
      };
    };
    const before = read(), frames = [before];
    document.querySelector<HTMLButtonElement>('[data-pane-id="tools-editor"] button[aria-label="Close panel"]')!.click();
    const start = performance.now();
    while (performance.now() - start < 650) {
      await new Promise(requestAnimationFrame);
      frames.push(read());
    }
    return { before, frames };
  });
  await info.attach("close-frames", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  await expect(file).toHaveCount(0);
  await expect(composer).toHaveValue("Keep this chat draft");
  expect(result.before.scroll).toBeGreaterThan(0);
  expect(result.before.background).toContain("background.svg");
  expect(result.frames.every(frame => frame.sameNodes)).toBe(true);
  expect(result.frames.every(frame => frame.background === result.before.background)).toBe(true);
  for (const key of ["x", "y", "width", "height", "scroll", "clientHeight", "scrollHeight"] as const) {
    expect(Math.max(...result.frames.map(frame => Math.abs(frame[key] - result.before[key]))), key).toBeLessThan(1);
  }
  await expect.poll(() => page.evaluate(() => (window as any).toolsFixture.readTerminal("tools-stacked-terminal").rows)).toBeGreaterThan(terminalBefore.rows);
  expect(await page.evaluate(() => (window as any).toolsFixture.rpc.filter((call: { command: string }) => call.command === "pty_spawn").length)).toBe(terminalBefore.spawns);
});
}
