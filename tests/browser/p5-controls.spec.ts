import { expect, test } from "@playwright/test";

test.setTimeout(60_000);

for (const theme of ["dark", "light"]) {
  test(`automation controls retain card, table and menu geometry (${theme})`, async ({ page }) => {
    await page.goto(`/tests/browser/p5-controls.html?theme=${theme}`);
    const cards = page.locator(".automation-template-grid > button");
    await expect(cards.first()).toBeVisible();
    await expect(cards.first()).toHaveCSS("align-items", "stretch");
    await expect(cards.first()).toHaveCSS("padding-top", "16px");
    await expect(cards.first()).toHaveCSS("min-height", "148px");
    await page.getByRole("button", { name: "Open Daily review", exact: true }).click();
    const name = page.getByRole("textbox", { name: "Automation name" });
    await expect(name).toHaveValue("Daily review");
    await expect(name).toHaveCSS("font-size", "20px");
    await expect(name).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.getByRole("tab", { name: "Run history", exact: true }).click();
    const row = page.getByRole("table", { name: "Run history", exact: true }).locator('[data-row-id="sample-run"]');
    await expect(row).toHaveCSS("display", "table-row");
    const columns = await row.evaluate(node => Array.from(node.children, child => child.getBoundingClientRect().x));
    expect(columns.every((x, i) => i === 0 || x > columns[i - 1])).toBe(true);
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    const trigger = page.getByRole("button", { name: "Add Trigger", exact: true });
    await trigger.click();
    const category = page.getByRole("menuitem", { name: "Scheduled", exact: true });
    await expect(category).toBeVisible();
    await expect.poll(() => category.evaluate(node => {
      const style = getComputedStyle(node);
      return { height: node.getBoundingClientRect().height, expected: parseFloat(style.getPropertyValue("--desktop-menu-row")) };
    })).toEqual({ height: 24, expected: 24 });
    await page.keyboard.press("Escape");
    await expect(category).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
  test(`note source keeps caret and highlight aligned (${theme})`, async ({ page }) => {
    await page.goto(`/tests/browser/p5-controls.html?page=notes&theme=${theme}`);
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Plan");
    await page.getByRole("tab", { name: "Source", exact: true }).click();
    const field = page.getByPlaceholder("Write markdown…");
    await expect(field).toBeVisible();
    await expect(field).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(field).toHaveCSS("field-sizing", "fixed");
    await expect(field).toHaveCSS("font-size", "13px");
    await expect(field).toHaveCSS("line-height", "20px");
    await expect(field).toHaveCSS("padding-top", "0px");
    await expect(field).toHaveCSS("border-top-width", "0px");
    const alignment = await field.evaluate(node => {
      const highlight = node.parentElement!.querySelector('[aria-hidden="true"]')!;
      const firstLine = highlight.children[1];
      return {
        input: node.getBoundingClientRect().x + parseFloat(getComputedStyle(node).paddingLeft),
        highlight: firstLine.getBoundingClientRect().x + parseFloat(getComputedStyle(firstLine).paddingLeft),
      };
    });
    expect(Math.abs(alignment.input - alignment.highlight)).toBeLessThan(1);
    await field.fill("# Updated\n\nKeep this draft.");
    await page.getByRole("tab", { name: "Preview", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Updated", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Source", exact: true }).click();
    await expect(field).toHaveValue("# Updated\n\nKeep this draft.");
  });
}

for (const theme of ["dark", "light"]) {
  test(`shared settings and feature disclosures work (${theme})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: theme === "light" ? "reduce" : "no-preference" });
    await page.goto(`/tests/browser/p5-controls.html?page=controls&theme=${theme}`);
    const slider = page.getByRole("slider", { name: "Background strength" });
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuenow", "36");
    await expect(page.getByLabel("Saved strength")).toHaveText("36");
    await page.getByRole("checkbox", { name: "Use worktree" }).check();
    await expect(page.getByRole("checkbox", { name: "Use worktree" })).toBeChecked();
    const sort = page.getByRole("button", { name: "Sort projects: Recent" });
    await sort.click();
    const option = page.getByRole("option", { name: "Name", exact: true });
    await expect(option).toHaveCSS("min-height", "24px");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Sort projects: Name" })).toBeFocused();
    const agents = page.getByRole("region", { name: "Working agents" });
    await expect(agents.getByRole("button", { name: /Agent 6/ })).toHaveCount(0);
    await agents.getByRole("button", { name: "2 more" }).click();
    await expect(agents.getByRole("button", { name: /Agent 6/ })).toBeVisible();
    await agents.getByRole("button", { name: "Show less" }).click();
    await expect(agents.getByRole("button", { name: /Agent 6/ })).toHaveCount(0);
    const ci = page.getByRole("button", { name: "CI context", exact: true });
    await expect(page.getByText("Checked commit: abc123")).toHaveCount(0);
    await ci.click();
    await expect(page.getByText("Checked commit: abc123")).toBeVisible();
    await ci.click();
    await expect(page.getByText("Checked commit: abc123")).toHaveCount(0);
    const file = page.locator('[data-diff-file="sample.ts"]');
    await expect(file.getByText("No line changes")).toBeVisible();
    await file.getByRole("button", { name: "sample.ts" }).click();
    await expect(file.getByText("No line changes")).toHaveCount(0);
    await file.getByRole("button", { name: "sample.ts" }).click();
    await expect(file.getByText("No line changes")).toBeVisible();
    await page.screenshot({ path: `.tmp/p5-controls-${theme}.png` });
  });
  test(`recipient menu uses shared density (${theme})`, async ({ page }) => {
    await page.goto(`/tests/browser/p5-controls.html?page=bots&theme=${theme}`);
    const option = page.getByRole("option", { name: "Alpha", exact: true });
    await expect(option).toBeVisible();
    await expect.poll(() => option.evaluate(node => node.getBoundingClientRect().height)).toBe(24);
    const search = page.getByRole("combobox", { name: "Search or create a Bot" });
    await search.fill("Alpha");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Remove Alpha" })).toBeVisible();
    const draft = page.getByRole("textbox", { name: "Room message" });
    await expect(draft).toBeVisible();
    await expect(draft).toHaveCSS("field-sizing", "fixed");
    await expect(draft).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect.poll(() => draft.evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(60);
    await page.screenshot({ path: `.tmp/p5-recipient-${theme}.png` });
  });
}

for (const theme of ["dark", "light"]) {
  test(`actual transcript disclosures and prompt markers have no state fill (${theme})`, async ({ page }) => {
    await page.goto(`/tests/browser/p5-controls.html?page=disclosures&theme=${theme}`);
    const work = page.locator(".desktop-work-fold-line");
    const commands = page.locator("[data-disclosure-commands] > div > div > [data-session-disclosure]").first();
    const cards = page.locator("[data-status-card] [data-session-disclosure]");
    await expect(work).toBeVisible();
    await expect(commands).toContainText("Ran 2 commands");
    await expect(cards).toHaveCount(3);
    for (const button of [work, commands, ...await cards.all()]) {
      await button.hover();
      await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      for (let toggle = 0; toggle < 2; toggle++) {
        const wasOpen = await button.getAttribute("aria-expanded");
        await button.click();
        await expect(button).toHaveAttribute("aria-expanded", wasOpen === "true" ? "false" : "true");
        await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await page.mouse.move(5, 5);
        await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      }
    }
    const marker = page.locator('[data-prompt-bar][aria-current="true"]');
    await expect(marker).toHaveCount(1);
    await expect(marker).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await marker.hover();
    await expect(marker).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(marker.locator("span")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.keyboard.press("Tab");
    await work.focus();
    await expect(work).toBeFocused();
    await expect(work).not.toHaveCSS("box-shadow", "none");
    await expect(page.getByRole("button", { name: "Ordinary menu trigger" })).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  });
}
