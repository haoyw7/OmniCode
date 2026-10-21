import { expect, test } from "@playwright/test";

const cases = [
  { name: "session", url: "sortable-size.html?sessions", source: "[data-sidebar-pinned-entry]", handle: "[data-session-select]" },
  { name: "status card", url: "sortable-size.html?status", source: '[data-status-card="tasks"]', handle: "[data-status-card-handle]" },
  { name: "workspace pane", url: "desktop-tools.html?editor=source&history=long&split=down", source: '[data-pane-id="tools-editor"]', handle: "[data-surface-pane-drag]" },
];

for (const scenario of cases) for (const distance of [1, 12]) {
  test(`${scenario.name} follows the first ${distance}px mouse move without a hold`, async ({ page }, info) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`/tests/browser/${scenario.url}`);
    const source = page.locator(`css:light=${scenario.source}`).first();
    await expect(source).toBeVisible();
    if (scenario.name === "workspace pane") await expect(source.locator(".cm-editor")).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})));
    });
    const handle = source.locator(scenario.handle).first();
    await handle.hover();
    const before = (await source.boundingBox())!, grip = (await handle.boundingBox())!;
    await page.evaluate(() => {
      let moveAt = 0;
      const moved = (event: PointerEvent) => { if (event.buttons === 1 && !moveAt) moveAt = performance.now(); };
      const observer = new MutationObserver(() => {
        if (moveAt && document.querySelector("[data-drag-preview]")) {
          (window as any).activationDiagnostic.elapsed = performance.now() - moveAt;
          cleanup();
        }
      });
      const cleanup = () => { window.removeEventListener("pointermove", moved, true); observer.disconnect(); };
      window.addEventListener("pointermove", moved, true);
      observer.observe(document.body, { childList: true, subtree: true });
      Object.assign(window, { activationDiagnostic: { elapsed: null, cleanup } });
    });
    try {
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      // No hold, second pointermove or polling gesture is allowed to activate it.
      await page.mouse.move(grip.x + grip.width / 2 + distance, grip.y + grip.height / 2 + distance);
      const preview = page.locator("css:light=[data-drag-preview]");
      await expect(preview).toBeVisible({ timeout: 1000 });
      await expect.poll(async () => {
        const rect = (await preview.boundingBox())!;
        return Math.max(Math.abs(rect.x - before.x - distance), Math.abs(rect.y - before.y - distance));
      }, { timeout: 1000 }).toBeLessThan(1);
      await info.attach("mouse-activation", { body: JSON.stringify({ distance,
        eventToPreviewDom: await page.evaluate(() => (window as any).activationDiagnostic.elapsed),
      }), contentType: "application/json" });
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await expect(preview).toHaveCount(0);
      await expect(source).toBeVisible();
    } finally {
      await page.evaluate(() => (window as any).activationDiagnostic.cleanup());
    }
  });
}
