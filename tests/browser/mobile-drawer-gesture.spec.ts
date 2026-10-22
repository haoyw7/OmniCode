import { expect, test } from "@playwright/test";

test.describe("mobile drawer drag boundaries", () => {
  test.describe.configure({ timeout: 90_000 });
  test.use({ hasTouch: true });
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`keeps both edges bounded during reversals (${reducedMotion})`, async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "Native touch injection uses Chromium CDP.");
      await page.emulateMedia({ reducedMotion });
      await page.setViewportSize({ width: 400, height: 800 });
      await page.goto("/tests/browser/motion-mobile.html", { waitUntil: "domcontentloaded" });
      const drawer = page.locator(".mobile-drawer");
      const backdrop = page.locator(".mobile-drawer-backdrop");
      const left = () => drawer.evaluate(element => element.getBoundingClientRect().left);
      await page.getByTestId("drawer-open").click();
      await expect.poll(left).toBeCloseTo(0, 0);
      const cdp = await page.context().newCDPSession(page);
      const touch = async (type: "touchStart" | "touchMove" | "touchEnd", x: number) => {
        await cdp.send("Input.dispatchTouchEvent", {
          type,
          touchPoints: type === "touchEnd" ? [] : [{ x, y: 450, id: 1 }],
        });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      };
      await touch("touchStart", 200);
      await touch("touchMove", 170);
      await touch("touchMove", 140);
      await expect.poll(left).toBeCloseTo(-60, 0);
      await touch("touchMove", 300);
      await expect.poll(left).toBeCloseTo(0, 0);
      await touch("touchMove", 120);
      await expect.poll(left).toBeCloseTo(-80, 0);
      await touch("touchMove", 300);
      await touch("touchEnd", 300);
      await expect.poll(left).toBeCloseTo(0, 0);
      await expect(backdrop).toHaveAttribute("data-open", "true");

      await touch("touchStart", 350);
      await touch("touchMove", 280);
      await touch("touchMove", 40);
      await touch("touchEnd", 40);
      await expect(backdrop).toHaveAttribute("data-settled-closed", "true");
      await expect.poll(left).toBeCloseTo(-400, 0);

      await page.locator("main").evaluate(element => element.classList.add("mobile-home"));
      await touch("touchStart", 20);
      await touch("touchMove", 80);
      await touch("touchMove", 300);
      await expect.poll(left).toBeCloseTo(-120, 0);
      await touch("touchMove", 0);
      await expect.poll(left).toBeCloseTo(-400, 0);
      await touch("touchMove", 300);
      await expect.poll(left).toBeCloseTo(-120, 0);
      await touch("touchEnd", 300);
      await expect.poll(left).toBeCloseTo(0, 0);
      await expect(backdrop).toHaveAttribute("data-open", "true");
    });
  }
});
