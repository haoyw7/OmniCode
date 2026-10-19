import { expect, test } from "@playwright/test";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`file expansion preserves content, reversal and the commit draft (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 2200, height: 1000 });
    await page.goto("/tests/browser/desktop-tools.html?editor=review&split=right&reviewResize&reviewStress&reviewManyFiles&reviewDelayedDiff");
    const review = page.locator("[data-git-review-pane]");
    const rail = review.locator("[data-git-changes-panel]");
    const first = review.locator('[data-review-file="src/workspace.ts"]');
    await expect(first.locator("[data-line] span").first()).toBeVisible();
    await expect(first.locator(".zen-fold-item")).toHaveAttribute("data-fold-state", "open");
    await first.getByRole("button", { name: "Collapse file: src/workspace.ts", exact: true }).click();
    await expect(first.locator(".zen-fold-item")).toHaveCount(0);
    const draft = rail.locator("textarea");
    await draft.fill("Preserve the commit draft while opening files");
    await expect(rail.locator("[data-git-change-row]")).toHaveCount(183);

    const file = review.locator('[data-review-file="docs/layout.md"]');
    const toggle = file.locator(".review-file-toggle");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-busy", "true");
    await expect(file.locator("[data-line]").first()).toBeVisible();
    await expect(file.locator(".zen-fold-item")).toHaveAttribute("data-fold-state", "open");
    const text = await file.locator("[data-line]").allTextContents();
    await expect(file.getByRole("button", { name: "Stage hunk", exact: true }).first()).toBeVisible();
    // Observe and reverse within one browser frame so automation round trips
    // cannot consume the entire closing animation before the next click.
    const reversal = await toggle.evaluate(async (button) => {
      button.click();
      await new Promise(requestAnimationFrame);
      const fold = button.closest("[data-review-file]")!.querySelector<HTMLElement>(".zen-fold-item");
      const closing = { state: fold?.dataset.foldState, inert: fold?.inert };
      button.click();
      return closing;
    });
    if (reducedMotion === "no-preference") expect(reversal).toEqual({ state: "closing", inert: true });
    await expect(file.locator(".zen-fold-item")).toHaveAttribute("data-fold-state", "open");
    await expect.poll(() => file.locator("[data-line]").allTextContents()).toEqual(text);
    await expect(file.locator("[data-line] span").first()).toBeVisible();
    await expect(draft).toHaveValue("Preserve the commit draft while opening files");
    await expect(rail.locator("[data-git-change-row]")).toHaveCount(183);
    await toggle.click();
    await expect(file.locator(".zen-fold-item")).toHaveCount(0);
    await toggle.click();
    await expect(file.locator(".zen-fold-item")).toHaveAttribute("data-fold-state", "open");
    await expect.poll(() => file.locator("[data-line]").allTextContents()).toEqual(text);
  });
}
