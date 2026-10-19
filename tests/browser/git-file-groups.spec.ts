import { expect, test } from "@playwright/test";

for (const view of ["list", "tree"] as const) {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`file groups retain rows, disable hidden actions and reverse (${view}, ${reducedMotion})`, async ({ page }) => {
      await page.addInitScript(view => localStorage.setItem("omnicode.changesView", view), view);
      await page.emulateMedia({ reducedMotion });
      await page.setViewportSize({ width: 2200, height: 1000 });
      await page.goto("/tests/browser/desktop-tools.html?editor=review&split=right&reviewResize&reviewManyFiles");
      const panel = page.locator("[data-git-changes-panel]");
      const section = panel.locator(".git-file-section").filter({ has: page.locator(".git-file-section-header > button").filter({ hasText: /^Changes/ }) });
      const toggle = section.locator(".git-file-section-header > button").first();
      const fold = section.locator(":scope > .zen-fold-item");
      const rows = section.locator("[data-git-change-row]");
      await expect(rows).toHaveCount(182);
      await expect(fold).toHaveAttribute("data-fold-state", "open");
      const text = await rows.allTextContents();
      const first = section.locator('button[title="src/workspace.ts"]');
      await first.evaluate(button => button.setAttribute("data-retained", "true"));
      const draft = panel.locator("textarea");
      await draft.fill("Keep the draft through file-group folds");
      await first.focus();
      await toggle.click();
      await expect(toggle).toBeFocused();
      await expect(fold).toHaveAttribute("data-fold-state", "closed");
      await expect(fold).toBeHidden();
      await expect(rows).toHaveCount(182);
      const retained = section.locator('button[title="src/workspace.ts"]');
      await expect(retained).toBeDisabled();
      await expect(retained).toHaveAttribute("data-retained", "true");
      await retained.evaluate(button => button.click());
      await toggle.click();
      await expect(fold).toHaveAttribute("data-fold-state", "open");
      await expect(retained).toBeEnabled();
      await expect(retained).toHaveAttribute("data-retained", "true");
      await expect(rows).toHaveText(text);
      const reversal = await toggle.evaluate(async button => {
        button.click();
        await new Promise(requestAnimationFrame);
        const group = button.closest(".git-file-section")!;
        const fold = group.querySelector<HTMLElement>(":scope > .zen-fold-item");
        const file = group.querySelector<HTMLButtonElement>('button[title="src/workspace.ts"]')!;
        const state = { fold: fold?.dataset.foldState, inert: fold?.inert, disabled: file.matches(":disabled") };
        button.click();
        return state;
      });
      expect(reversal.disabled).toBe(true);
      expect(reversal.inert).toBe(true);
      if (reducedMotion === "no-preference") expect(reversal.fold).toBe("closing");
      await expect(fold).toHaveAttribute("data-fold-state", "open");
      await expect(draft).toHaveValue("Keep the draft through file-group folds");
      const staged = panel.locator(".git-file-section").filter({ has: page.locator(".git-file-section-header > button").filter({ hasText: /^Staged Changes/ }) });
      const stagedToggle = staged.locator(".git-file-section-header > button").first();
      const stagedFile = staged.locator('button[title="README.md"]');
      await stagedToggle.click();
      await expect(stagedFile).toBeDisabled();
      await stagedToggle.click();
      await expect(stagedFile).toBeEnabled();
      if (view === "tree") {
        const directory = section.locator('button[title="src/changes"]');
        const nestedFile = section.locator('button[title="src/changes/file179.ts"]');
        await directory.click();
        await expect(nestedFile).toBeDisabled();
        await directory.click();
        await expect(nestedFile).toBeEnabled();
        await nestedFile.scrollIntoViewIfNeeded();
        await expect(nestedFile).toBeVisible();
      } else {
        await rows.last().scrollIntoViewIfNeeded();
        await expect(rows.last()).toBeVisible();
      }
    });
  }
}
