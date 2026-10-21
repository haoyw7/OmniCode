import { expect, test } from "@playwright/test";

for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test(`modal popover receives pointer and focus; Escape closes one layer (${reducedMotion})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto("/tests/browser/radix-surfaces.html");
    const trigger = page.getByRole("button", { name: "Open modal" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Surface regression" });
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "Choice" }).click();
    await page.getByRole("option", { name: "Two" }).click();
    await expect(page.getByRole("button", { name: "Choice" })).toContainText(
      "Two",
    );
    await page.getByRole("button", { name: "Choice" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(page.locator("[data-dialog-popover]")).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.locator("body")).not.toHaveCSS("pointer-events", "none");
  });
}

test("retained flyout flips when its element anchor moves", async ({
  page,
}) => {
  await page.goto("/tests/browser/radix-surfaces.html");
  await page.getByRole("button", { name: "Flyout", exact: true }).click();
  const surface = page.locator("[data-flyout]");
  await expect(surface.locator("..")).toHaveAttribute(
    "data-popover-side",
    "right",
  );
  await page.getByRole("button", { name: "Move anchor" }).click();
  await expect(surface.locator("..")).toHaveAttribute(
    "data-popover-side",
    "left",
  );
  const box = await surface.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThan(930);
});

test("native host owns modal and popover layout", async ({ page }) => {
  await page.goto("/tests/browser/radix-surfaces.html?native");
  await page.getByRole("button", { name: "Open modal" }).click();
  const host = page.locator("[data-native-host]");
  await expect(host.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Choice" }).click();
  await expect(host.getByRole("option", { name: "Two" })).toBeVisible();
  const wrapper = host.locator("[data-radix-popper-content-wrapper]");
  await expect(wrapper).toHaveCSS("position", "relative");
  await expect(wrapper).toHaveCSS("transform", "none");
});

test("image preview traps focus and returns it to its dialog before the next Escape", async ({ page }) => {
  await page.goto("/tests/browser/radix-surfaces.html");
  await page.getByRole("button", { name: "Open modal" }).click();
  const trigger = page.getByRole("button", { name: "Preview image" });
  await trigger.click();
  const preview = page.getByRole("dialog", { name: "Image preview: Sample" });
  await expect(preview).toBeVisible();
  await expect(page.getByRole("button", { name: "Close image preview" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close image preview" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("dialog", { name: "Surface regression" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("command select opens a nested picker by keyboard and preserves the containing dialog", async ({ page }) => {
  await page.goto("/tests/browser/radix-surfaces.html");
  await page.getByRole("button", { name: "Open modal" }).click();
  await page.getByRole("button", { name: "Choice" }).click();
  await page.getByRole("combobox").focus();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("option", { name: "Three" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Surface regression" })).toBeVisible();
});
