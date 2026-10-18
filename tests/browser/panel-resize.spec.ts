import { expect, test, type Page } from "@playwright/test";

type FixtureWindow = Window & {
  toolsFixture: {
    setSidebarOpen(open: boolean): void;
    setTab(tab: string): void;
    selectFile(id: string): void;
    output(text: string): void;
    rpc: { command: string }[];
  };
};

test("conversation keeps its 420px minimum even in a narrow viewport", async ({ page }) => {
  await page.goto("/tests/browser/desktop-tools.html?editor=terminal");
  await expect(page.locator('[data-pane-id="tools-session"]')).toBeVisible();
  await page.evaluate(() => (window as FixtureWindow).toolsFixture.setSidebarOpen(false));
  for (const width of [1000, 360, 900]) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(() => page.locator('[data-pane-tree-layout]').evaluate(el => {
      const chat = el.querySelector('[data-pane-chat-edge]')!;
      const minimum = parseFloat(getComputedStyle(el).getPropertyValue("--desktop-conversation-min-width"));
      return Math.abs(parseFloat(getComputedStyle(chat).minWidth) - minimum);
    })).toBeLessThan(1);
    await expect(page.locator('[data-pane-tree-layout]')).toHaveCSS("container-type", "normal");
  }
});

test("workspace panes stop at pixel minima and remain readable in a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto("/tests/browser/desktop-tools.html?editor=terminal");
  await expect(page.locator('[data-pane-id="tools-editor"] .xterm')).toBeVisible();
  await page.evaluate(() => (window as FixtureWindow).toolsFixture.setSidebarOpen(false));
  await expect.poll(() => resizing(page)).toBe(false);
  const chat = page.locator('[data-pane-id="tools-session"]');
  const tool = page.locator('[data-pane-id="tools-editor"]');
  const handle = page.locator('[data-pane-sash="tools-split:0"] > .resize-handle');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(0, box.y + 100);
  await painted(page);
  expect((await chat.boundingBox())!.width).toBeCloseTo(420, 0);
  const chatBox = (await chat.boundingBox())!;
  const toolBox = (await tool.boundingBox())!;
  expect(toolBox.x).toBeLessThan(chatBox.x + chatBox.width - 100);
  await page.mouse.up();
  const coveringPane = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-pane-id]')?.getAttribute('data-pane-id'), { x: toolBox.x + 20, y: toolBox.y + 80 });
  expect(coveringPane).toBe("tools-editor");
  const nextBox = (await handle.boundingBox())!;
  await page.mouse.move(nextBox.x + nextBox.width / 2, nextBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(1400, box.y + 100);
  await painted(page);
  expect((await tool.boundingBox())!.width).toBeCloseTo(280, 0);
  await page.mouse.up();
  await page.setViewportSize({ width: 360, height: 800 });
  await expect.poll(async () => (await tool.boundingBox())!.width).toBeGreaterThanOrEqual(280);
  const layout = (await page.locator('[data-pane-tree-layout]').boundingBox())!;
  const right = (await tool.boundingBox())!;
  expect(right.x + right.width).toBeLessThanOrEqual(layout.x + layout.width + 1);
  expect((await chat.boundingBox())!.width).toBeGreaterThanOrEqual(420 - 1);
});

test("dock keeps its live size across React updates and pointer release", async ({ page }) => {
  await openTools(page);
  const dock = page.locator('.project-terminal-card');
  const before = (await dock.boundingBox())!.height;
  const handle = page.getByRole('separator', { name: 'Resize terminal', exact: true });
  const box = (await handle.boundingBox())!;
  const x = box.x + 100, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (const delta of [-30, -90, -45]) {
    await page.mouse.move(x, y + delta);
    await painted(page);
    expect(Math.abs((await dock.boundingBox())!.height - before + delta)).toBeLessThan(1);
  }
  await page.evaluate(() => (window as FixtureWindow).toolsFixture.setSidebarOpen(false));
  await painted(page);
  expect(Math.abs((await dock.boundingBox())!.height - before - 45)).toBeLessThan(1);
  await page.mouse.up();
  await painted(page);
  expect(Math.abs((await dock.boundingBox())!.height - before - 45)).toBeLessThan(1);
});

async function painted(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function resizing(page: Page) {
  return page.evaluate(async () => {
    const module = "/src/shared/lib/paneResize.ts";
    return (await import(module)).isPaneResizing() as boolean;
  });
}

async function openTools(page: Page, query = "") {
  await page.setViewportSize({ width: 2200, height: 1000 });
  await page.goto(`/tests/browser/desktop-tools.html?editor=source&explorer${query}`);
  await expect(page.locator(".cm-editor").first()).toBeVisible();
  await expect(page.locator(".xterm")).toBeVisible();
  await expect.poll(() => resizing(page)).toBe(false);
  await painted(page);
}

for (const direction of ["right", "down"] as const) {
  test(`${direction} split resizes live with the pointer through reversals`, async ({ page }) => {
    await openTools(page, `&history=long&split=${direction}`);
    const horizontal = direction === "right";
    const extent = horizontal ? "width" : "height";
    const position = horizontal ? "x" : "y";
    const chat = page.locator('[data-pane-id="tools-session"]');
    const editor = page.locator('[data-pane-id="tools-editor"]');
    const content = editor.locator(".cm-editor").first();
    const sash = page.locator('[data-pane-sash="tools-split:0"]');
    const handle = sash.locator(".resize-handle");
    const before = {
      chat: (await chat.boundingBox())!,
      editor: (await editor.boundingBox())!,
      content: (await content.boundingBox())!,
      sash: (await sash.boundingBox())!,
    };
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (const delta of [-30, -80, -120, -35, 15]) {
      await page.mouse.move(x + (horizontal ? delta : 0), y + (horizontal ? 0 : delta));
      await painted(page);
      expect(await resizing(page)).toBe(true);
      expect(Math.abs((await sash.boundingBox())![position] - before.sash[position] - delta)).toBeLessThan(1);
      expect(Math.abs((await chat.boundingBox())![extent] - before.chat[extent] - delta)).toBeLessThan(1);
      expect(Math.abs((await editor.boundingBox())![extent] - before.editor[extent] + delta)).toBeLessThan(1);
      expect(Math.abs((await content.boundingBox())![extent] - before.content[extent] + delta)).toBeLessThan(1);
    }
    await page.mouse.up();
    await expect.poll(() => resizing(page)).toBe(false);
    await painted(page);
    expect(Math.abs((await chat.boundingBox())![extent] - before.chat[extent] - 15)).toBeLessThan(1);
  });
}

test("keeps split background geometry out of the transcript while preserving its background", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("monocode:project-chat-backgrounds", JSON.stringify({
      "/fixture/monocode": { path: "/fixture/background.svg", effect: "gradient-blur", scope: "all" },
    }));
  });
  await page.route("**/fixture/background.svg*", route => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="teal"/></svg>',
  }));
  await openTools(page, "&history=long");
  const checkBackground = async () => {
    const geometry = await page.evaluate(() => {
      const pane = document.querySelector('[data-pane-id="tools-session"]')!;
      const background = pane.querySelector(".chat-pane-background")!;
      const blur = background.querySelector(".gradient-blur-background")!;
      const width = (element: Element, pseudo?: string) =>
        parseFloat(getComputedStyle(element, pseudo).getPropertyValue("--chat-background-width"));
      return {
        pane: width(pane), background: width(background), pseudo: width(background, "::before"),
        blur: width(blur), transcript: width(pane.querySelector(".agent-transcript")!),
        text: width(pane.querySelector(".agent-markdown")!),
      };
    });
    expect(geometry.pane).toBeGreaterThan(100);
    expect(geometry.background).toBeCloseTo(geometry.pane, 3);
    expect(geometry.pseudo).toBeCloseTo(geometry.pane, 3);
    expect(geometry.blur).toBeCloseTo(geometry.pane, 3);
    expect(geometry.transcript).toBe(100);
    expect(geometry.text).toBe(100);
    return geometry.pane;
  };
  const before = await checkBackground();
  const handle = page.locator('[data-pane-sash="tools-split:0"] > .resize-handle');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + 100);
  await painted(page);
  expect(await checkBackground()).toBeGreaterThan(before);
  await page.mouse.up();
});

test("keeps the split aligned with its sash when file content rerenders during a drag", async ({ page }) => {
  await openTools(page);
  const handle = page.locator('[data-pane-sash="tools-split:0"] > .resize-handle');
  const chat = page.locator('[data-pane-id="tools-session"]');
  const before = (await chat.boundingBox())!.width;
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 140, box.y + 100, { steps: 8 });
  await painted(page);
  const preview = (await chat.boundingBox())!.width;
  expect(before - preview).toBeGreaterThan(130);
  await page.evaluate(() => (window as FixtureWindow).toolsFixture.selectFile("tools-review"));
  await expect(page.locator("[data-git-review-pane]")).toBeVisible();
  await painted(page);
  expect(Math.abs((await chat.boundingBox())!.width - preview)).toBeLessThan(1);
  const sash = (await page.locator('[data-pane-sash="tools-split:0"]').boundingBox())!;
  const pane = (await chat.boundingBox())!;
  expect(Math.abs(pane.x + pane.width - sash.x)).toBeLessThan(1);
  await page.mouse.up();
  await expect.poll(() => resizing(page)).toBe(false);
  await page.evaluate(() => (window as FixtureWindow).toolsFixture.selectFile("tools-source"));
  await expect(page.locator(".cm-editor").first()).toBeVisible();
  await painted(page);
  expect(Math.abs((await chat.boundingBox())!.width - preview)).toBeLessThan(1);
});

for (const kind of ["tools", "terminal", "explorer", "sidebar"] as const) {
  test(`${kind} resize follows the pointer and keeps terminal dimensions current`, async ({ page }) => {
    await openTools(page);
    if (kind === "tools") {
      await page.evaluate(() => (window as FixtureWindow).toolsFixture.setTab("changes"));
      await expect(page.locator(".desktop-tools-layout")).toHaveAttribute("data-fold-state", "open");
    }
    if (kind === "sidebar") {
      await page.evaluate(() => {
        const list = document.querySelector("[data-project-list-scroll]")!;
        const row = list.querySelector("[data-session-dense]")!;
        for (let index = 0; index < 350; index++) list.append(row.cloneNode(true));
      });
    }
    await page.evaluate(() => (window as FixtureWindow).toolsFixture.output(
      Array.from({ length: 2000 }, (_, index) => `${index}: ${"scrollback content ".repeat(12)}`).join("\r\n") + "\r\n",
    ));
    await expect.poll(() => resizing(page)).toBe(false);
    await painted(page);
    const count = () => page.evaluate(() => (window as FixtureWindow).toolsFixture.rpc.filter(call => call.command === "pty_resize").length);
    const countBefore = await count();
    const handle = page.getByRole("separator", { name: { tools: "Resize panel", terminal: "Resize terminal", explorer: "Resize file tree", sidebar: "Resize sidebar" }[kind] });
    await expect(handle).toBeVisible();
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const terminal = page.locator(".xterm");
    await terminal.evaluate(element => element.setAttribute("data-resize-retained", "true"));
    await page.mouse.move(x, y);
    await page.mouse.down();
    expect(await resizing(page)).toBe(true);
    for (let step = 1; step <= 8; step++) {
      await page.mouse.move(
        x + (kind === "terminal" ? 0 : (kind === "explorer" || kind === "sidebar" ? 1 : -1) * step * 10),
        y - (kind === "terminal" ? step * 10 : 0),
      );
      await painted(page);
    }
    if (kind === "explorer") expect(await count()).toBe(countBefore);
    else expect(await count()).toBeGreaterThan(countBefore);
    const moved = (await handle.boundingBox())!;
    expect(Math.abs((kind === "terminal" ? moved.y - box.y : moved.x - box.x))).toBeGreaterThan(70);
    await page.mouse.up();
    await expect.poll(() => resizing(page)).toBe(false);
    await expect(terminal).toHaveAttribute("data-resize-retained", "true");
    if (kind === "sidebar") {
      const gap = await page.evaluate(() => {
        const sidebar = document.querySelector("[data-desktop-sidebar]")!;
        return sidebar.getBoundingClientRect().right - document.querySelector(".desktop-mode-toggle")!.getBoundingClientRect().right;
      });
      expect(gap).toBe(10);
    }
  });
}
