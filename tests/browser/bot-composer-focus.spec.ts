import { expect, test, type Locator } from "@playwright/test";

async function composerPaint(field: Locator) {
  return field.evaluate(element => {
    const surface = getComputedStyle(element.closest(".assistant-compose")!);
    const editor = getComputedStyle(element);
    return {
      surfaceBackground: surface.backgroundColor,
      surfaceShadow: surface.boxShadow,
      surfaceBorder: surface.borderColor,
      editorBackground: editor.backgroundColor,
      editorShadow: editor.boxShadow,
    };
  });
}

for (const skin of ["daylight", "atelier", "ripple"]) {
  test(`${skin}: Bot composer keeps its background while editing`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/tests/browser/bots-rea.html", { waitUntil: "domcontentloaded" });
    const field = page.locator(".assistant-compose textarea:visible").first();
    await expect(field).toBeVisible();
    await page.evaluate(skin => {
      const root = document.documentElement;
      root.dataset.skin = skin;
      root.classList.toggle("theme-light", skin !== "ripple");
      root.classList.toggle("theme-dark", skin === "ripple");
      root.classList.remove("has-user-accent");
      root.dataset.reducedMotion = "on";
      (document.activeElement as HTMLElement)?.blur();
    }, skin);
    const idle = await composerPaint(field);

    await field.click();
    await expect(field).toBeFocused();
    await expect.poll(() => composerPaint(field)).toEqual(idle);
    await field.fill("Unsent focus check");
    await expect.poll(() => composerPaint(field)).toEqual(idle);

    // Keyboard navigation still reaches the adjacent action and returns to
    // the editor without tinting the entire composer or adding an inner patch.
    await field.press("Tab");
    const attach = page.getByRole("button", { name: "Attach files", exact: true });
    await expect(attach).toBeFocused();
    const feedback = await attach.evaluate(element => {
      const style = getComputedStyle(element);
      return { visible: element.matches(":focus-visible"), shadow: style.boxShadow };
    });
    expect(feedback.visible).toBe(true);
    expect(feedback.shadow).toContain("inset");
    await attach.press("Shift+Tab");
    await expect(field).toBeFocused();
    await expect.poll(() => composerPaint(field)).toEqual(idle);
  });
}
