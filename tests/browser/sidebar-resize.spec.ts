import { expect, test, type Page } from "@playwright/test";

async function geometry(page: Page) {
  return page.locator("[data-sidebar-transition]").evaluate(element => {
    const rect = element.getBoundingClientRect();
    const clip = element.querySelector(".sidebar-transition-clip")!.getBoundingClientRect();
    const sidebar = element.querySelector("aside")!.getBoundingClientRect();
    return { x: rect.x, width: rect.width, clipX: clip.x, sidebarX: sidebar.x, sidebarWidth: sidebar.width };
  });
}
async function painted(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

for (const [width, reducedMotion] of [[260, "no-preference"], [360, "no-preference"], [260, "reduce"]] as const) {
  test(`macOS mode switch stays inside the sidebar (${width}px, ${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.addInitScript(width => localStorage.setItem("omnicode.sidebarWidth", String(width)), width);
    await page.goto("/tests/browser/desktop-visual.html?page=workspace&state=conversation&mode=chat");
    await expect(page.locator("[data-desktop-sidebar]")).toBeVisible();
    await page.evaluate(() => document.documentElement.classList.add("is-mac"));
    await painted(page);
    const history = page.locator(".desktop-titlebar-navigation [data-window-history-action]");
    if (width === 260) await expect(history.first()).toBeHidden();
    else await expect(history.first()).toBeVisible();
    await expect(page.locator('[data-desktop-sidebar="chat"] [data-session-card]').first()).toBeVisible();
    const samples = await page.evaluate(async () => {
      const fixture = (window as unknown as { desktopFixture: { setMode(mode: "chat" | "code"): void } }).desktopFixture;
      const violations: { mode: string; element: string; right: number; boundary: number }[] = [];
      let count = 0;
      for (const mode of ["code", "chat", "code", "chat"] as const) {
        fixture.setMode(mode);
        const start = performance.now();
        while (performance.now() - start < 400) {
          await new Promise(requestAnimationFrame);
          count++;
          const boundary = document.querySelector("[data-desktop-sidebar]")!.getBoundingClientRect().right;
          for (const element of document.querySelectorAll<HTMLElement>(".desktop-mode-toggle, [data-session-card], [data-project-header]")) {
            const rect = element.getBoundingClientRect();
            if (rect.width && rect.height && rect.right > boundary + 0.6)
              violations.push({ mode, element: element.className, right: rect.right, boundary });
          }
        }
      }
      return { count, violations };
    });
    expect(samples.count).toBeGreaterThan(4);
    expect(samples.violations).toEqual([]);
    await expect(page.locator('[data-desktop-sidebar="chat"] [data-session-card]').first()).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { desktopFixture: { setSidebar(open: boolean): void } }).desktopFixture.setSidebar(false);
    });
    await expect(page.locator("[data-sidebar-transition]")).toHaveAttribute("data-fold-state", "closed");
    await expect(history.first()).toBeVisible();
  });
}

test("opening sidebar does not intercept the workspace beyond its animated width", async ({ page }) => {
  await page.goto("/tests/browser/sidebar-transition.html");
  const pane = page.locator("[data-sidebar-transition]");
  await expect(pane).toHaveAttribute("data-fold-state", "open");
  const result = await page.evaluate(async () => {
    const fixture = (window as unknown as { desktopFixture: { setSidebar(open: boolean): void } }).desktopFixture;
    const shell = document.querySelector<HTMLElement>("[data-sidebar-transition]")!;
    fixture.setSidebar(false);
    await new Promise(resolve => setTimeout(resolve, 400));
    fixture.setSidebar(true);
    const samples: { width: number; overlaps: boolean }[] = [];
    const start = performance.now();
    while (performance.now() - start < 350) {
      await new Promise(requestAnimationFrame);
      const rect = shell.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.right + 16, rect.top + 150);
      samples.push({ width: rect.width, overlaps: !!hit?.closest(".sidebar-transition-content") });
    }
    return samples;
  });
  expect(result.some(sample => sample.width > 10 && sample.width < 200)).toBe(true);
  expect(result.filter(sample => sample.overlaps)).toEqual([]);
  await expect(pane).toHaveAttribute("data-fold-state", "open");
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`sidebar settles after rapid reversal (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto("/tests/browser/sidebar-transition.html");
    const pane = page.locator("[data-sidebar-transition]");
    await expect(pane).toHaveAttribute("data-fold-state", "open");
    await page.evaluate(async () => {
      const fixture = (window as unknown as { desktopFixture: { setSidebar(open: boolean): void } }).desktopFixture;
      for (const open of [false, true, false, true, false]) {
        fixture.setSidebar(open);
        await new Promise(resolve => setTimeout(resolve, 40));
      }
    });
    await expect(pane).toHaveAttribute("data-fold-state", "closed");
    await expect(pane).toHaveAttribute("inert", "");
    await expect.poll(() => pane.evaluate(el => el.getBoundingClientRect().width)).toBe(0);
    await expect(page.locator("[data-sidebar-rail]")).toHaveCount(0);
    await expect.poll(() => page.locator("main").evaluate(el => el.getBoundingClientRect().left)).toBe(0);
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await expect(pane).toHaveAttribute("data-fold-state", "open");
    await expect.poll(() => pane.evaluate(el => el.getBoundingClientRect().width)).toBe(352);
    await expect(page.getByRole("textbox", { name: "Retained sidebar draft" })).toHaveValue("draft");
  });
}

test("sidebar stays anchored through resize, release and a second drag", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.addInitScript(() => localStorage.setItem("omnicode.sidebarWidth", "360"));
  await page.goto("/tests/browser/desktop-tools.html?editor=terminal");
  const handle = page.getByRole("separator", { name: "Resize sidebar", exact: true });
  await expect(handle).toBeVisible();
  await expect.poll(async () => (await geometry(page)).width).toBe(352);
  for (const deltas of [[-20, -60, 40, 0, -30], [10, -20, 60]]) {
    const before = await geometry(page);
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + 100;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await painted(page);
    expect(await geometry(page)).toEqual(before);
    for (const delta of deltas) {
      await page.mouse.move(x + delta, y);
      await painted(page);
      const current = await geometry(page);
      expect(current.x).toBeCloseTo(before.x, 1);
      expect(current.clipX).toBeCloseTo(before.clipX, 1);
      expect(current.sidebarX).toBeCloseTo(before.sidebarX, 1);
      expect(current.width).toBeCloseTo(before.width + delta, 1);
      expect(current.sidebarWidth).toBeCloseTo(before.sidebarWidth + delta, 1);
    }
    const preview = await geometry(page);
    await page.mouse.up();
    await painted(page);
    expect(await geometry(page)).toEqual(preview);
    await expect.poll(() => page.evaluate(() => document.querySelectorAll("[data-resize-cursor]").length)).toBe(0);
  }
});

for (const mode of ["code", "chat"] as const) {
  test(`${mode} sidebar layout ends at the divider, including with a visible backdrop`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("omnicode.sidebarWidth", "360"));
    await page.goto(`/tests/browser/desktop-visual.html?page=workspace&state=conversation&mode=${mode}&theme=dark`);
    const sidebar = page.locator("[data-desktop-sidebar]");
    await expect(sidebar).toBeVisible();
    const check = async () => {
      const bounds = await sidebar.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const shell = el.closest("[data-sidebar-transition]")!;
        const chrome = document.querySelector<HTMLElement>("[data-window-drag-bar]")!;
        const main = document.querySelector("[data-sidebar-main]")!;
        const handle = shell.querySelector('[data-ui="resizable-handle"]')!;
        const point = document.elementFromPoint(rect.right + 4, rect.top + 100);
        return {
          sidebar: rect.right,
          shell: shell.getBoundingClientRect().right,
          clip: shell.querySelector(".sidebar-transition-clip")!.getBoundingClientRect().right,
          line: chrome.getBoundingClientRect().left + parseFloat(getComputedStyle(chrome).getPropertyValue("--desktop-sidebar-chrome-background-width")),
          main: main.getBoundingClientRect().left,
          handle: handle.getBoundingClientRect().left,
          dividerInset: getComputedStyle(shell, "::after").right,
          resizeHit: handle.contains(point) || !!point?.closest("[data-resize-cursor]"),
        };
      });
      for (const edge of [bounds.shell, bounds.clip, bounds.line, bounds.main, bounds.handle]) {
        expect(Math.abs(edge - bounds.sidebar), JSON.stringify(bounds)).toBeLessThan(0.6);
      }
      expect(bounds.dividerInset).toBe("0px");
      expect(bounds.resizeHit).toBe(true);
    };
    await expect.poll(() => sidebar.evaluate(el => el.getBoundingClientRect().width)).toBe(352);
    // Distinct paint exposes accidental overlap without relying on theme colors.
    await sidebar.evaluate(el => { el.style.background = "rgb(255, 0, 255)"; });
    await check();
    const handle = page.getByRole("separator", { name: "Resize sidebar", exact: true });
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 100);
    await page.mouse.down();
    for (const delta of [60, -40, 20]) {
      await page.mouse.move(box.x + box.width / 2 + delta, box.y + 100);
      await painted(page);
      await check();
    }
    await page.mouse.up();
    await painted(page);
    await check();
    await page.evaluate(() => {
      (window as unknown as { desktopFixture: { setSidebar(open: boolean): void } }).desktopFixture.setSidebar(false);
    });
    await expect(page.locator("[data-sidebar-transition]")).toHaveAttribute("data-fold-state", "closed");
    await page.evaluate(() => {
      (window as unknown as { desktopFixture: { setSidebar(open: boolean): void } }).desktopFixture.setSidebar(true);
    });
    await expect(page.locator("[data-sidebar-transition]")).toHaveAttribute("data-fold-state", "open");
    await painted(page);
    await check();
  });
}
