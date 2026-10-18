import { expect, test } from "@playwright/test";

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
