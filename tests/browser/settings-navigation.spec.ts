import { expect, test } from "@playwright/test";

test("settings transitions retain exiting pages without document-wide stylesheets", async ({ page }) => {
  await page.goto("/tests/browser/settings-navigation.html");
  await expect(page.locator("[data-settings-title]")).toHaveText("General");
  await page.evaluate(async () => {
    const path = "/src/features/settings/ui/SettingsView.tsx";
    const { preloadSettingsSection } = await import(path);
    await preloadSettingsSection("appearance");
  });
  await page.waitForTimeout(300);
  const outgoing = await page.locator("[data-settings-page]").elementHandle();
  const before = await outgoing!.boundingBox();
  const observed = await page.evaluate(() => {
    return new Promise<number>(resolve => {
      let stylesheetChanges = 0;
      const observer = new MutationObserver(records => {
        for (const record of records) for (const node of [...record.addedNodes, ...record.removedNodes]) {
          if (node instanceof HTMLStyleElement) stylesheetChanges++;
        }
      });
      observer.observe(document.head, { childList: true });
      const next = [...document.querySelectorAll<HTMLButtonElement>(".settings-nav button")].find(button => button.textContent === "Appearance")!;
      next.click();
      setTimeout(() => { observer.disconnect(); resolve(stylesheetChanges); }, 350);
    });
  });
  expect(observed).toBe(0);
  await expect(page.locator("[data-settings-page]")).toHaveCount(1);
  await expect(page.locator("[data-settings-title]")).toHaveText("Appearance");
  const after = await page.locator("[data-settings-page]").boundingBox();
  expect(after!.x).toBeCloseTo(before!.x, 0);
  expect(after!.width).toBeCloseTo(before!.width, 0);
  await expect(page).toHaveURL(/settings=appearance/);
});

test("rapid navigation finishes exits and preserves the newest page", async ({ page }) => {
  await page.goto("/tests/browser/settings-navigation.html");
  await expect(page.locator("[data-settings-title]")).toHaveText("General");
  await page.evaluate(async () => {
    const path = "/src/features/settings/ui/SettingsView.tsx";
    const { preloadSettingsSection } = await import(path);
    await Promise.all([preloadSettingsSection("appearance"), preloadSettingsSection("chat")]);
    for (const label of ["Appearance", "Chat", "Appearance", "General"]) {
      [...document.querySelectorAll<HTMLButtonElement>(".settings-nav button")].find(button => button.textContent === label)!.click();
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  });
  await expect(page.locator("[data-settings-page]")).toHaveCount(1);
  await expect(page.locator("[data-settings-title]")).toHaveText("General");
  await expect(page.locator("[data-settings-page]")).not.toHaveAttribute("inert");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".settings-nav").getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(page.locator('[data-settings-page]:not([inert]) [data-settings-title]')).toHaveText("Appearance");
  await expect(page.locator("[data-settings-page]")).toHaveCount(1);
  await expect(page.locator("[data-settings-title]")).toHaveText("Appearance");
});
