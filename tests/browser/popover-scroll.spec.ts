import { expect, test, type Page } from "@playwright/test";

async function settle(page: Page) {
  // Allow scroll events, observers and any resulting layout to finish.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }),
  );
}

for (const notes of [false, true]) {
  test(`${notes ? "release notes" : "list popover"} scrolls to both ends without resetting`, async ({
    page,
  }) => {
    await page.goto(
      `/tests/browser/popover-scroll.html${notes ? "?notes" : ""}`,
    );
    if (notes) await page.getByRole("button", { name: "Open notes" }).hover();
    const surface = notes
      ? page.getByRole("tooltip")
      : page.getByTestId("list");
    await expect(surface).toBeVisible();
    await surface.hover();
    await page.mouse.wheel(0, 250);
    await expect
      .poll(() => surface.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(100);
    await settle(page);
    expect(await surface.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    await page.mouse.wheel(0, 10000);
    await expect
      .poll(() =>
        surface.evaluate(
          (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
        ),
      )
      .toBeLessThan(2);
    await settle(page);
    expect(
      await surface.evaluate(
        (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
      ),
    ).toBeLessThan(2);
    await page.mouse.wheel(0, -10000);
    await expect.poll(() => surface.evaluate((el) => el.scrollTop)).toBe(0);
    await page.mouse.wheel(0, 250);
    await expect
      .poll(() => surface.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(100);
  });
}

test("remeasurement preserves reading position and follows a scrolling anchor", async ({
  page,
}) => {
  await page.goto("/tests/browser/popover-scroll.html");
  const surface = page.getByTestId("list");
  await expect(surface).toBeVisible();
  await surface.evaluate((el) => {
    el.scrollTop = 350;
  });
  await settle(page);
  expect(await surface.evaluate((el) => el.scrollTop)).toBe(350);
  await page.getByRole("button", { name: "Append row" }).click();
  await expect(surface.locator("li")).toHaveCount(61);
  await settle(page);
  expect(await surface.evaluate((el) => el.scrollTop)).toBe(350);
  await page.setViewportSize({ width: 950, height: 750 });
  await settle(page);
  expect(await surface.evaluate((el) => el.scrollTop)).toBe(350);
  const before = (await surface.boundingBox())!;
  await page.getByTestId("anchor-scroll").evaluate((el) => {
    el.scrollTop = 40;
  });
  await expect
    .poll(async () => (await surface.boundingBox())!.y)
    .toBeCloseTo(before.y - 40, 0);
  expect(await surface.evaluate((el) => el.scrollTop)).toBe(350);
});
