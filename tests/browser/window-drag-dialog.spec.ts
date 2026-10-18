import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { value: "Win32" });
    const calls: string[] = [];
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        invoke: async (command: string) => { calls.push(command); return command === "project_session_count" ? 0 : false; },
        transformCallback: () => 1,
        unregisterCallback: () => {},
      },
      nativeCalls: calls,
    });
  });
});

test("artifact dialog leaves native drag and window controls available above its backdrop", async ({ page }) => {
  await page.goto("/tests/browser/window-drag-dialog.html");
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Open artifact" }).click();
  await expect(dialog).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("pointer-events", "none");
  const calls = () => page.evaluate(() => (window as unknown as { nativeCalls: string[] }).nativeCalls);
  for (let i = 0; i < 2; i++) {
    await page.mouse.move(400, 20);
    await page.mouse.down();
    await page.mouse.move(460, 24);
    await page.mouse.up();
    await expect.poll(async () => (await calls()).filter((s) => s === "plugin:window|start_dragging").length).toBe(i + 1);
    await expect(dialog).toBeVisible();
  }
  await page.mouse.dblclick(400, 20);
  await expect.poll(async () => (await calls()).includes("plugin:window|toggle_maximize")).toBe(true);
  await expect(dialog).toBeVisible();
  // Radix hides background chrome from the accessibility tree while modal.
  await page.locator('[aria-label="Minimize window"]').click();
  await expect.poll(async () => (await calls()).includes("plugin:window|minimize")).toBe(true);
  await page.getByRole("textbox", { name: "Artifact control" }).fill("still interactive");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Open artifact" }).click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(10, 400);
  await expect(dialog).toHaveCount(0);
});

const surfaces = {
  popover: "[data-check-panel]",
  menu: "[data-check-panel]",
  "radix-popover": "[data-check-panel]",
  dropdown: '[role="menu"]',
  select: '[role="listbox"]',
  searchable: '[role="listbox"]',
  modal: '[role="dialog"]',
  "app-dialog": '[role="dialog"]',
  lightbox: '[role="dialog"]',
  "quick-open": '[role="dialog"]',
  "switch-branch": '[role="dialog"]',
  "remove-project": '[role="dialog"]',
  "remote-project": '[role="dialog"]',
  "bot-memory": '[role="dialog"]',
};

for (const kind of ["menu", "dropdown", "modal", "artifact"]) {
  test(`${kind} content overlapping the titlebar wins hit testing while exposed window controls remain usable`, async ({ page }) => {
    await page.goto(`/tests/browser/window-drag-dialog.html${kind === "artifact" ? "" : `?kind=${kind}`}`);
    await page.getByRole("button", { name: kind === "artifact" ? "Open artifact" : "Open panel", exact: true }).click();
    const selector = kind === "menu" ? ".popover-frame[data-popover-side]"
      : kind === "dropdown" ? "[data-radix-popper-content-wrapper]"
      : kind === "modal" ? "[data-window-modal-panel]" : '[data-slot="dialog-content"]';
    const surface = page.locator(selector);
    await expect(surface).toBeVisible();
    // Exercise overlap independently of each surface's collision/centering policy.
    await page.addStyleTag({ content: `${selector} { top: 8px !important; left: 200px !important; transform: none !important; width: 300px !important; height: 200px !important; }` });
    await expect.poll(() => surface.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top < 36 && element.contains(document.elementFromPoint(rect.left + 15, 20));
    })).toBe(true);
    await page.mouse.click(220, 10);
    expect(await page.evaluate(() => (window as unknown as { nativeCalls: string[] }).nativeCalls.includes("plugin:window|start_dragging"))).toBe(false);
    await expect(surface).toBeVisible();
    await page.mouse.move(600, 20);
    await page.mouse.down();
    await page.mouse.move(650, 24);
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => (window as unknown as { nativeCalls: string[] }).nativeCalls.includes("plugin:window|start_dragging"))).toBe(true);
    await page.locator('[aria-label="Minimize window"]').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { nativeCalls: string[] }).nativeCalls.includes("plugin:window|minimize"))).toBe(true);
  });
}

for (const pinned of [false, true]) {
  test(`nested options and their parent remain open with menu bar ${pinned ? "pinned" : "hidden"}`, async ({ page }) => {
    await page.goto(`/tests/browser/window-drag-dialog.html?kind=nested${pinned ? "&pinned" : ""}`);
    await page.getByRole("button", { name: "Open panel", exact: true }).click();
    const parent = page.getByRole("dialog", { name: "Parent panel", exact: true });
    await parent.getByRole("button", { name: /^Nested options:/ }).click();
    const options = page.getByRole("listbox");
    await expect(options).toBeVisible();
    await page.mouse.move(600, 20);
    await page.mouse.down();
    await page.mouse.move(650, 24);
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => (window as unknown as { nativeCalls: string[] }).nativeCalls.includes("plugin:window|start_dragging"))).toBe(true);
    await expect(parent).toBeVisible();
    await expect(options).toBeVisible();
    await page.getByRole("option", { name: "Two", exact: true }).click();
    await expect(options).toHaveCount(0);
    await expect(parent).toBeVisible();
    await expect(parent.getByRole("button", { name: "Nested options: Two" })).toBeVisible();
  });
  for (const [kind, selector] of Object.entries(surfaces)) {
    test(`${kind} survives titlebar dragging with menu bar ${pinned ? "pinned" : "hidden"}`, async ({ page }) => {
      await page.goto(`/tests/browser/window-drag-dialog.html?kind=${kind}${pinned ? "&pinned" : ""}`);
      const trigger = page.getByRole(kind === "select" ? "combobox" : "button", { name: /^Open panel(?::|$)/ });
      await trigger.click();
      const surface = page.locator(selector);
      await expect(surface).toBeVisible();
      const focusedBefore = await page.evaluateHandle(() => document.activeElement);
      const dragCount = () => page.evaluate(() => (window as unknown as { nativeCalls: string[] }).nativeCalls.filter((c) => c === "plugin:window|start_dragging").length);
      for (let i = 0; i < 2; i++) {
        await page.mouse.move(600, 20);
        await page.mouse.down();
        await page.mouse.move(650, 24);
        await page.mouse.move(580, 20);
        await page.mouse.up();
        await expect.poll(dragCount).toBe(i + 1);
        await expect(surface).toBeVisible();
      }
      expect(await focusedBefore.evaluate((element) => element === document.activeElement)).toBe(true);
      await focusedBefore.dispose();
      // A normal outside click still dismisses; dragging must not poison the next click.
      await page.mouse.click(10, 500);
      await expect(surface).toHaveCount(0);
      await trigger.click();
      await expect(surface).toBeVisible();
      if (kind === "select" || kind === "searchable") {
        await page.getByRole("option", { name: "Two", exact: true }).click();
        await expect(surface).toHaveCount(0);
        await expect(trigger).toContainText("Two");
      } else if (kind === "dropdown") {
        await page.getByRole("menuitem", { name: "Choose option" }).click();
        await expect(surface).toHaveCount(0);
      } else {
        const input = surface.locator("input, textarea").first();
        if (await input.count()) await input.fill("panel remains usable");
        // AppViewDialog owns Tab trapping; its page owns Escape. Use its close button.
        if (kind === "app-dialog") await page.locator(".app-view-dialog-close").click();
        else await page.keyboard.press("Escape");
        await expect(surface).toHaveCount(0);
      }
    });
  }
}
