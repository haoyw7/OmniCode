import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  test(`virtual tables keep all records reachable and editing stable (${theme})`, async ({
    page,
  }) => {
    if (theme === "light") await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/p6-tables.html?theme=${theme}`);
    const table = page.getByRole("table", { name: "Results", exact: true });
    await expect(table).toHaveAttribute("aria-rowcount", "451");
    await expect(table.locator("thead")).toHaveCSS("background-color", theme === "light" ? "rgb(249, 249, 247)" : "rgb(7, 16, 24)");
    await page.screenshot({
      path: test.info().outputPath(`tables-${theme}.png`),
      fullPage: true,
    });
    await expect
      .poll(() => table.locator("[data-row-id]").count())
      .toBeLessThan(40);
    await table.locator("..").evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(table.getByText("Result 449", { exact: true })).toBeVisible();
    await table.getByRole("button", { name: "Value", exact: true }).click();
    await expect(
      table.getByRole("columnheader", { name: "Value" }),
    ).toHaveAttribute("aria-sort", "ascending");
    await expect(table.locator("[data-row-id]").first()).toContainText(
      "Result 449",
    );

    const name = page
      .getByRole("textbox", { name: "Name", exact: true })
      .first();
    await name.fill("duplicate");
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await name.press("End");
    await name.pressSequentially("-fixed");
    await expect(name).toBeFocused();
    await expect(name).toHaveValue("duplicate-fixed");
    await expect(name).toHaveAttribute("aria-invalid", "false");
    await page
      .getByRole("button", { name: "Add argument", exact: true })
      .click();
    await expect(page.locator("[data-workflow-arg-row]")).toHaveCount(2);
    await page
      .getByRole("button", { name: "Remove argument", exact: true })
      .last()
      .click();
    await expect(page.locator("[data-workflow-arg-row]")).toHaveCount(1);

    const history = page.getByRole("table", {
      name: "Run history",
      exact: true,
    });
    await history.scrollIntoViewIfNeeded();
    await expect(
      history
        .locator('[data-row-id="saved-0"]')
        .getByRole("button", { name: "Open run" }),
    ).toHaveCount(0);
    await history
      .locator('[data-row-id="saved-0"]')
      .getByRole("button")
      .click();
    await expect(page.getByLabel("Opened", { exact: true })).toHaveText(
      "artifact-0",
    );
    await history.locator("..").evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(history.locator('[data-row-id="saved-239"]')).toBeVisible();

    await history
      .locator('[data-row-id="saved-239"]')
      .getByRole("button", { name: "Open run", exact: true })
      .click();
    await expect(page.getByLabel("Opened", { exact: true })).toHaveText(
      "saved-239",
    );
    const overlap = await history
      .locator("[data-row-id]")
      .evaluateAll((rows) =>
        rows.some(
          (row, i) =>
            i > 0 &&
            row.getBoundingClientRect().top <
              rows[i - 1].getBoundingClientRect().bottom - 1,
        ),
      );
    expect(overlap).toBe(false);
    await history
      .getByRole("button", { name: "Triggered", exact: true })
      .click();
    await history
      .getByRole("button", { name: "Triggered", exact: true })
      .click();
    await expect(history.locator("[data-row-id]").first()).toHaveAttribute(
      "data-row-id",
      "saved-239",
    );
    const chip = page.locator('[data-ui="session-usage-chip"]');
    await expect(chip.getByRole("table")).toHaveCount(1);
    await expect(chip.getByRole("button").locator("table")).toHaveCount(0);
    await expect(chip.getByRole("progressbar")).toHaveCount(2);
    await chip.getByRole("button").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
  });
}

test("Git virtual scrolling reaches commit 521 and preserves keyboard activation", async ({
  page,
}) => {
  await page.goto("/tests/browser/p6-tables.html?page=git");
  const table = page.getByRole("table", { name: "Git graph", exact: true });
  await expect(table.locator('[data-row-id="sha-0"]')).toBeVisible();
  for (let i = 0; i < 11; i++) {
    const load = page.getByRole("button", {
      name: "Load more commits",
      exact: true,
    });
    if ((await load.count()) === 0) break;
    await load.click();
  }
  await expect(table).toHaveAttribute("aria-rowcount", "522");
  await table.locator("..").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const last = table.locator('[data-row-id="sha-520"]');
  await expect(last).toBeVisible();
  await last.focus();
  await page.keyboard.press("Space");
  await expect(page.getByLabel("Opened", { exact: true })).toHaveText(
    "sha-520",
  );
  await table.locator("..").evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect(last).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Opened", { exact: true })).toHaveText(
    "sha-520",
  );
  await expect
    .poll(() => table.locator("[data-row-id]").count())
    .toBeLessThan(40);
});

test("automation history exposes runs beyond the old 100-row cap", async ({
  page,
}) => {
  await page.goto("/tests/browser/p6-tables.html?page=automations");
  await page
    .getByRole("button", { name: "Open Daily review", exact: true })
    .click();
  await page.getByRole("tab", { name: "Run history", exact: true }).click();
  const table = page.getByRole("table", { name: "Run history", exact: true });
  await expect(table).toHaveAttribute("aria-rowcount", "151");
  await table.locator("..").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const row = table.locator('[data-row-id="run-149"]');
  await expect(row).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("automation.png") });
  await row.getByRole("button", { name: "Test run", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Opened", { exact: true })).toHaveText(
    "session-149",
  );
});
