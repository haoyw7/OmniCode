import { expect, test } from "@playwright/test";

test.describe("content touch resizing", () => {
  test.use({ hasTouch: true });
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`tracks the finger and preserves native scrolling (${reducedMotion})`, async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "Native touch injection uses Chromium CDP.");
      await page.emulateMedia({ reducedMotion });
      await page.setViewportSize({ width: 400, height: 800 });
      await page.goto("/tests/browser/motion-mobile.html");
      await page.getByTestId("sheet-open").click();
      const sheet = page.locator(".mobile-sheet");
      const top = () => sheet.evaluate(element => element.getBoundingClientRect().top);
      await expect.poll(top).toBeCloseTo(400, 0);
      const cdp = await page.context().newCDPSession(page);
      const touch = async (type: "touchStart" | "touchMove" | "touchEnd", y: number) => {
        await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: 300, y, id: 1 }] });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      };
      const swipe = async (from: number, to: number) => {
        await touch("touchStart", from);
        for (let i = 1; i <= 6; i++) await touch("touchMove", from + (to - from) * i / 6);
        // A held release selects the nearest stop instead of the fling rule.
        await page.waitForTimeout(120);
        await touch("touchEnd", to);
      };
      const start = await page.getByTestId("sheet-drag-surface").evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.top + bounds.height / 2;
      });
      await touch("touchStart", start);
      for (const distance of [-30, -70, -50, -110, -200]) {
        await touch("touchMove", start + distance);
        expect(await top()).toBeCloseTo(400 + distance, 0);
      }
      await page.waitForTimeout(120);
      await touch("touchEnd", start - 200);
      await expect(sheet).toHaveAttribute("data-detent", "full");
      await expect.poll(top).toBeLessThan(60);

      await page.getByTestId("sheet-swipe-area").evaluate(element => {
        const content = document.createElement("div");
        content.style.height = "1600px";
        content.textContent = "Scrollable content";
        element.appendChild(content);
      });
      const content = sheet.locator(":scope > .mobile-sheet-content");
      await swipe(600, 350);
      await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(50);
      await expect(sheet).toHaveAttribute("data-detent", "full");
      await content.evaluate(element => { element.scrollTop = 200; });
      await swipe(350, 410);
      await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeLessThan(200);
      await expect(sheet).toHaveAttribute("data-detent", "full");
      await content.evaluate(element => { element.scrollTop = 0; });
      await swipe(350, 600);
      await expect(sheet).toHaveAttribute("data-detent", "half");
      await expect.poll(top).toBeCloseTo(400, 0);
      await expect(page.getByRole("textbox", { name: "Retained sheet input" })).toHaveValue("Draft stays mounted");
      await swipe(start, start + 180);
      await expect(sheet).toHaveCount(0);
    });
  }
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`mobile sheets retain content until exit and use native popup transforms (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 400, height: 800 });
    await page.goto("/tests/browser/motion-mobile.html");
    await page.getByTestId("sheet-open").click();
    const sheet = page.locator(".mobile-sheet");
    await expect(sheet).toBeVisible();
    await expect.poll(() => sheet.evaluate(element => (element as HTMLElement).offsetHeight - new DOMMatrixReadOnly(getComputedStyle(element).transform).m42)).toBeCloseTo(400, 0);
    await expect(page.getByRole("textbox", { name: "Retained sheet input" })).toHaveValue("Draft stays mounted");
    expect(await page.locator(".mobile-sheet-backdrop").evaluate(element => getComputedStyle(element).opacity)).toBe("1");
    await page.locator(".mobile-sheet-header-button").click();
    await expect(sheet).toHaveCount(0);

    for (const placement of ["anchor", "dialog"]) {
      // Start and inspect in one browser task so the short transition cannot finish first.
      const animations = await page.evaluate(async placement => {
        document.querySelector<HTMLButtonElement>(`[data-testid="${placement}-open"]`)!.click();
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const popup = document.querySelector<HTMLElement>(".mobile-sheet")!;
        return popup.getAnimations().flatMap(animation =>
          (animation.effect as KeyframeEffect).getKeyframes().map(frame => frame.transform).filter(Boolean));
      }, placement);
      if (reducedMotion === "no-preference") expect(animations.some(value => String(value).includes("scale"))).toBe(true);
      await expect(sheet).toBeVisible();
      await expect.poll(() => sheet.evaluate(element => Number(getComputedStyle(element).opacity))).toBe(1);
      expect(await sheet.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).a)).toBe(1);
      await page.getByTestId("popup-close").click();
      await expect(sheet).toHaveCount(0);
    }
  });
}
