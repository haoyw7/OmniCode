import { expect, test, type Page } from "@playwright/test";

async function openPanels(page: Page, split = "right") {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/tests/browser/desktop-tools.html?editor=source&explorer&history=long&split=${split}`);
  const chat = page.locator("css:light=" + '[data-pane-id="tools-session"]');
  const editor = page.locator("css:light=" + '[data-pane-id="tools-editor"]');
  await expect(editor.locator(".cm-editor")).toBeVisible();
  await expect(page.locator("css:light=" + ".xterm")).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const module = "/src/shared/lib/paneResize.ts";
    return (await import(module)).isPaneResizing();
  })).toBe(false);
  await editor.locator(".cm-editor").evaluate(el => el.setAttribute("data-retained-editor", "true"));
  await page.locator("css:light=" + ".xterm").evaluate(el => el.setAttribute("data-retained-terminal", "true"));
  return { chat, editor };
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`insertion line follows all four edges above the pane preview (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    const { chat, editor } = await openPanels(page, "down");
    const target = (await chat.boundingBox())!;
    const grip = (await editor.locator("[data-surface-pane-drag]").first().boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    const line = page.locator("css:light=" + "[data-pane-insertion]");
    for (const edge of ["left", "right", "top", "bottom", "left"] as const) {
      const horizontal = edge === "top" || edge === "bottom";
      const x = edge === "left" ? target.x + 6 : edge === "right" ? target.x + target.width - 6 : target.x + target.width / 2;
      const y = edge === "top" ? target.y + 6 : edge === "bottom" ? target.y + target.height - 6 : target.y + target.height / 2;
      await page.mouse.move(x, y, { steps: 3 });
      await expect(line).toHaveCount(1);
      await expect(line).toHaveAttribute("data-pane-insertion", edge);
      await expect(line).toHaveAttribute("data-pane-insertion-target", "tools-session");
      await expect(chat.locator(".pane-drop-hint")).toHaveCount(0);
      const marker = (await line.boundingBox())!;
      expect(marker.width).toBeCloseTo(horizontal ? target.width : 3, 1);
      expect(marker.height).toBeCloseTo(horizontal ? 3 : target.height, 1);
      expect(marker.x).toBeCloseTo(edge === "right" ? target.x + target.width - 3 : target.x, 1);
      expect(marker.y).toBeCloseTo(edge === "bottom" ? target.y + target.height - 3 : target.y, 1);
      const overlay = (await page.locator("css:light=" + ".sortable-overlay").boundingBox())!;
      const left = Math.max(marker.x, overlay.x), right = Math.min(marker.x + marker.width, overlay.x + overlay.width);
      const top = Math.max(marker.y, overlay.y), bottom = Math.min(marker.y + marker.height, overlay.y + overlay.height);
      expect(right - left).toBeGreaterThan(0);
      expect(bottom - top).toBeGreaterThan(0);
      // Probe actual paint order at an overlap, restoring hit testing immediately.
      const abovePreview = await page.evaluate(({ x, y }) => {
        const marker = document.querySelector<HTMLElement>("[data-pane-insertion]")!;
        const overlay = document.querySelector<HTMLElement>(".sortable-overlay")!;
        const previous = [marker, overlay].map(node => ({ node, value: node.style.getPropertyValue("pointer-events"), priority: node.style.getPropertyPriority("pointer-events") }));
        try {
          previous.forEach(({ node }) => node.style.setProperty("pointer-events", "auto", "important"));
          return marker.parentElement === document.body && document.elementFromPoint(x, y) === marker;
        } finally {
          previous.forEach(({ node, value, priority }) => value ? node.style.setProperty("pointer-events", value, priority) : node.style.removeProperty("pointer-events"));
        }
      }, { x: (left + right) / 2, y: (top + bottom) / 2 });
      expect(abovePreview).toBe(true);
    }
    await page.screenshot({ path: test.info().outputPath("insertion-above-preview.png") });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(line).toHaveCount(0);
    await expect(page.locator("css:light=" + "[data-drag-preview]")).toHaveCount(0);
    await expect(editor.locator(".cm-editor")).toHaveAttribute("data-retained-editor", "true");
  });
}

for (const split of ["right", "down"] as const) {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`dnd-kit moves a pane from ${split} without remounting content (${reducedMotion})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      const { chat, editor } = await openPanels(page, split);
      const original = (await editor.boundingBox())!, target = (await chat.boundingBox())!;
      const handle = (await editor.locator("[data-surface-pane-drag]").first().boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + target.width / 2, target.y + 12, { steps: 8 });
      await expect(page.locator("css:light=" + ".sortable-overlay")).toBeVisible();
      const preview = page.locator("css:light=" + "[data-drag-preview]");
      expect((await preview.boundingBox())!.width).toBeCloseTo(original.width, 1);
      expect((await preview.boundingBox())!.height).toBeCloseTo(original.height, 1);
      const editorBox = (await editor.locator(".cm-editor").boundingBox())!;
      const editorPreviewBox = (await preview.locator(".cm-editor").boundingBox())!;
      expect(editorPreviewBox.width).toBeCloseTo(editorBox.width, 1);
      expect(editorPreviewBox.height).toBeCloseTo(editorBox.height, 1);
      await expect(preview.locator(".cm-content")).toHaveText(await editor.locator(".cm-content").textContent() ?? "");
      await page.screenshot({ path: test.info().outputPath("workspace-preview.png") });
      expect(await page.locator("css:light=" + '[data-pane-id="tools-editor"]').count()).toBe(1);
      expect((await editor.boundingBox())!.width).toBeCloseTo(original.width, 0);
      await expect(chat.locator(".pane-drop-hint")).toHaveCount(0);
      await expect(page.locator("css:light=" + '[data-pane-insertion="top"]')).toBeVisible();
      await page.mouse.up();
      await expect(page.locator("css:light=" + ".sortable-overlay")).toHaveCount(0);
      await expect(page.locator("css:light=" + "[data-pane-insertion]")).toHaveCount(0);
      await expect.poll(async () => (await chat.boundingBox())!.y - (await editor.boundingBox())!.y).toBeGreaterThan(100);
      await expect(editor.locator(".cm-editor")).toHaveAttribute("data-retained-editor", "true");
      await expect(page.locator("css:light=" + ".xterm")).toHaveAttribute("data-retained-terminal", "true");
    });
  }
}
for (const cancel of ["Escape", "pointercancel", "blur", "lostpointercapture"] as const) {
  test(`dnd-kit ${cancel} restores drag state and permits a second gesture`, async ({ page }) => {
    const { chat, editor } = await openPanels(page);
    const original = (await editor.boundingBox())!, target = (await chat.boundingBox())!;
    const grip = editor.locator("[data-surface-pane-drag]").first();
    const box = (await grip.boundingBox())!;
    const start = async () => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + 10, target.y + target.height / 2, { steps: 8 });
      await expect(page.locator("css:light=" + ".sortable-overlay")).toBeVisible();
      await expect(page.locator("css:light=" + "[data-pane-insertion]")).toHaveCount(1);
    };
    await start();
    if (cancel === "Escape") await page.keyboard.press("Escape");
    else await page.evaluate(reason => {
      if (reason === "blur") window.dispatchEvent(new Event("blur"));
      else if (reason === "pointercancel") document.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }));
      else document.querySelector('[data-pane-id="tools-editor"]')?.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 1 }));
    }, cancel);
    await page.mouse.up();
    await expect(page.locator("css:light=" + ".sortable-overlay")).toHaveCount(0);
    await expect(page.locator("css:light=" + "[data-pane-insertion]")).toHaveCount(0);
    expect((await editor.boundingBox())!.x).toBeCloseTo(original.x, 0);
    await start();
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator("css:light=" + ".sortable-overlay")).toHaveCount(0);
    await expect(page.locator("css:light=" + "[data-pane-insertion]")).toHaveCount(0);
    await expect(editor.locator(".cm-editor")).toHaveAttribute("data-retained-editor", "true");
  });
}
test("cancelling a pane drag restores live divider resizing", async ({ page }) => {
  const { chat, editor } = await openPanels(page);
  const grip = (await editor.locator("[data-surface-pane-drag]").first().boundingBox())!;
  const target = (await chat.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 10, target.y + target.height / 2, { steps: 5 });
  await expect(page.locator("css:light=[data-drag-preview]")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator("css:light=[data-drag-preview]")).toHaveCount(0);
  const sash = (await page.locator('css:light=[data-pane-sash="tools-split:0"]').boundingBox())!;
  const before = (await editor.boundingBox())!;
  await page.mouse.move(sash.x + sash.width / 2, sash.y + sash.height / 2);
  await page.mouse.down();
  await page.mouse.move(sash.x + sash.width / 2 + 45, sash.y + sash.height / 2, { steps: 5 });
  await expect.poll(async () => before.width - (await editor.boundingBox())!.width).toBeGreaterThan(20);
  await page.mouse.up();
  await expect(editor.locator(".cm-editor")).toHaveAttribute("data-retained-editor", "true");
});

test("pane grip supports keyboard pickup, a directional target and drop", async ({ page }) => {
  const { chat, editor } = await openPanels(page);
  await editor.locator("[data-surface-pane-drag]").first().focus();
  await page.keyboard.press("Space");
  await expect(page.locator("css:light=" + ".sortable-overlay")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(chat.locator(".pane-drop-hint")).toHaveCount(0);
  await expect(page.locator("css:light=" + "[data-pane-insertion]")).toHaveCount(1);
  await page.keyboard.press("Space");
  await expect(page.locator("css:light=" + ".sortable-overlay")).toHaveCount(0);
  await expect(page.locator("css:light=" + "[data-pane-insertion]")).toHaveCount(0);
  await expect(editor.locator(".cm-editor")).toHaveAttribute("data-retained-editor", "true");
});

test("the promoted chat header previews its entire pane at the original size", async ({ page }) => {
  const { chat, editor } = await openPanels(page);
  const original = (await chat.boundingBox())!;
  const handle = page.locator("css:light=" + '[data-session-surface-tabs="tools-session"] [data-surface-pane-drag]');
  const from = (await handle.boundingBox())!, to = (await editor.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 20, { steps: 8 });
  const preview = page.locator("css:light=" + "[data-drag-preview]");
  await expect(preview).toBeVisible();
  expect((await preview.boundingBox())!.width).toBeCloseTo(original.width, 1);
  expect((await preview.boundingBox())!.height).toBeCloseTo(original.height, 1);
  await expect(preview).toContainText("The workspace keeps the conversation beside the changed files.");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(preview).toHaveCount(0);
});

test("a terminal dock insertion line remains above the lifted terminal", async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/tests/browser/desktop-tools.html?editor=terminal&dockable");
  const pane = page.locator("css:light=" + '[data-pane-id="tools-editor"]');
  const dock = page.locator("css:light=" + "[data-project-terminal-dock]");
  await expect(pane.locator(".xterm")).toBeVisible();
  await expect(dock.locator(".xterm")).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await import("/src/shared/lib/paneResize.ts")).isPaneResizing())).toBe(false);
  const grip = (await pane.locator("[data-surface-pane-drag]").boundingBox())!;
  // Dock drop zones fill the visible card's padding box, excluding its gutter
  // and border; the insertion marker belongs on that inner card edge.
  const target = await dock.locator(".project-terminal-card").evaluate(node => {
    const element = node as HTMLElement, rect = element.getBoundingClientRect();
    return { x: rect.left + element.clientLeft, y: rect.top + element.clientTop, width: element.clientWidth, height: element.clientHeight };
  });
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + 10, { steps: 8 });
  const line = page.locator("css:light=" + '[data-pane-insertion-target="terminal-dock"]');
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute("data-pane-insertion", "top");
  const box = (await line.boundingBox())!;
  expect(box.width).toBeCloseTo(target.width, 0);
  expect(box.x).toBeCloseTo(target.x, 0);
  expect(box.y).toBeCloseTo(target.y, 0);
  expect(await line.evaluate(node => Number(getComputedStyle(node).zIndex) > Number(getComputedStyle(document.querySelector(".sortable-overlay")!).zIndex))).toBe(true);
  await page.screenshot({ path: test.info().outputPath("dock-insertion-above-preview.png") });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(line).toHaveCount(0);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`manual horizontal tools survive fitting and window resizing (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 1200, height: 1000 });
    await page.goto("/tests/browser/desktop-tools.html?editor=source&stackedTools");
    const files = page.locator("css:light=" + '[data-pane-id="tools-editor"]');
    const terminalPane = page.locator("css:light=" + '[data-pane-id="tools-stacked-terminal"]');
    const terminal = terminalPane.locator(".xterm");
    await expect(files.locator(".cm-editor")).toBeVisible();
    await expect(terminal).toBeVisible();
    await expect.poll(() => page.evaluate(async () => (await import("/src/shared/lib/paneResize.ts")).isPaneResizing())).toBe(false);
    await terminal.evaluate(el => el.setAttribute("data-retained-terminal", "true"));
    const target = (await files.boundingBox())!;
    const handle = (await terminalPane.locator("[data-surface-pane-drag]").first().boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width - 4, target.y + target.height / 2, { steps: 8 });
    await expect(files.locator(".pane-drop-hint")).toHaveCount(0);
    await expect(page.locator("css:light=" + '[data-pane-insertion="right"][data-pane-insertion-target="tools-editor"]')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator("css:light=" + ".sortable-overlay")).toHaveCount(0);
    await expect.poll(() => page.evaluate(async () => (await import("/src/shared/lib/paneResize.ts")).isPaneResizing())).toBe(false);
    const checkHorizontal = async () => {
      const left = (await files.boundingBox())!, right = (await terminalPane.boundingBox())!;
      expect(Math.abs(left.y - right.y)).toBeLessThan(1);
      expect(right.x - left.x).toBeGreaterThan(100);
      await expect(terminal).toHaveAttribute("data-retained-terminal", "true");
    };
    await checkHorizontal();
    for (const width of [1100, 1400]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect.poll(() => page.evaluate(async () => (await import("/src/shared/lib/paneResize.ts")).isPaneResizing())).toBe(false);
      await checkHorizontal();
    }
  });
}

test("dragging a terminal pane keeps its PTY mounted and defers resizing", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/tests/browser/desktop-tools.html?editor=terminal");
  const pane = page.locator("css:light=" + '[data-pane-id="tools-editor"]');
  const terminal = pane.locator(".xterm");
  await expect(terminal).toBeVisible();
  await terminal.evaluate(el => el.setAttribute("data-retained-terminal", "true"));
  const calls = () => page.evaluate(() => (window as Window & {
    toolsFixture: { rpc: { command: string }[] };
  }).toolsFixture.rpc.map(call => call.command));
  await expect.poll(async () => (await calls()).filter(call => call === "pty_spawn").length).toBe(2);
  await expect.poll(() => page.evaluate(() => (window as unknown as { toolsFixture: { readTerminal(): { lines: string[] } } }).toolsFixture.readTerminal().lines.join("\n"))).toContain("git status");
  await expect.poll(() => page.evaluate(async () => {
    const module = "/src/shared/lib/paneResize.ts";
    return (await import(module)).isPaneResizing();
  })).toBe(false);
  const before = await calls();
  const original = (await pane.boundingBox())!;
  const chat = (await page.locator("css:light=" + '[data-pane-id="tools-session"]').boundingBox())!;
  const handle = (await pane.locator("[data-surface-pane-drag]").first().boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(chat.x + chat.width / 2, chat.y + 20, { steps: 8 });
  await expect(page.locator("css:light=" + ".sortable-overlay")).toBeVisible();
  await expect(terminal).toBeVisible();
  const preview = page.locator("css:light=" + "[data-drag-preview]");
  expect((await preview.boundingBox())!.width).toBeCloseTo(original.width, 1);
  expect((await preview.boundingBox())!.height).toBeCloseTo(original.height, 1);
  await expect(preview.locator(".xterm-rows")).toHaveText(await terminal.locator(".xterm-rows").textContent() ?? "");
  const terminalBox = (await terminal.locator(".xterm-screen").boundingBox())!;
  const terminalPreviewBox = (await preview.locator(".xterm-screen").boundingBox())!;
  expect(terminalPreviewBox.width).toBeCloseTo(terminalBox.width, 1);
  expect(terminalPreviewBox.height).toBeCloseTo(terminalBox.height, 1);
  await page.screenshot({ path: test.info().outputPath("terminal-preview.png") });
  await expect(page.locator("css:light=" + '[data-pane-id="tools-session"] .pane-drop-hint')).toHaveCount(0);
  await expect(page.locator("css:light=" + '[data-pane-insertion="top"][data-pane-insertion-target="tools-session"]')).toBeVisible();
  expect(Math.abs((await pane.boundingBox())!.width - original.width)).toBeLessThan(1);
  expect(Math.abs((await pane.boundingBox())!.height - original.height)).toBeLessThan(1);
  expect((await calls()).filter(call => call === "pty_resize").length).toBe(before.filter(call => call === "pty_resize").length);
  await page.evaluate(() => (window as unknown as { toolsFixture: { output: (text: string, id: string) => void } }).toolsFixture.output("Live output during dragging", "tools-pane-pty"));
  await expect(terminal.locator(".xterm-rows")).toContainText("Live output during dragging");
  await page.mouse.up();
  await expect(page.locator("css:light=" + ".sortable-overlay")).toHaveCount(0);
  await expect(terminal).toHaveAttribute("data-retained-terminal", "true");
  expect((await calls()).filter(call => call === "pty_spawn" || call === "pty_kill")).toEqual(before.filter(call => call === "pty_spawn" || call === "pty_kill"));
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`changes trades places with the middle editor and preserves it during reversal (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    const { chat, editor } = await openPanels(page);
    await page.evaluate(() => (window as unknown as { toolsFixture: { setTab: (tab: string) => void } }).toolsFixture.setTab("changes"));
    const grid = page.locator("css:light=" + ".desktop-tools-layout");
    await expect(grid).toHaveAttribute("data-fold-state", "open");
    await expect.poll(() => page.evaluate(async () => (await import("/src/shared/lib/paneResize.ts")).isPaneResizing())).toBe(false);
    const panel = grid.locator(":scope > .desktop-tools-panel");
    const draft = panel.locator("textarea");
    await draft.fill("Retain this while reordering");
    await draft.evaluate(el => el.setAttribute("data-retained-draft", "true"));
    const before = { chat: (await chat.boundingBox())!, editor: (await editor.boundingBox())!, panel: (await panel.boundingBox())! };
    const grab = (await panel.locator("[data-surface-pane-drag]").boundingBox())!;
    const start = { x: grab.x + grab.width / 2, y: grab.y + grab.height / 2 };
    const target = { x: before.editor.x + 8, y: before.editor.y + before.editor.height / 2 };
    const line = page.locator("css:light=" + "[data-pane-insertion]");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await expect(line).toHaveAttribute("data-pane-insertion", "left");
    await expect.poll(async () => (await editor.boundingBox())!.x - before.editor.x).toBeGreaterThan(before.panel.width - 2);
    expect(Math.abs((await chat.boundingBox())!.x - before.chat.x)).toBeLessThan(1);
    expect(Math.abs((await chat.boundingBox())!.width - before.chat.width)).toBeLessThan(1);
    // Reverse across the original boundary, then cross it again in one drag.
    await page.mouse.move(before.editor.x + before.editor.width - 8, target.y, { steps: 4 });
    await expect(line).toHaveAttribute("data-pane-insertion", "right");
    await expect.poll(async () => Math.abs((await editor.boundingBox())!.x - before.editor.x)).toBeLessThan(1);
    await page.mouse.move(target.x, target.y, { steps: 4 });
    await expect(line).toHaveAttribute("data-pane-insertion", "left");
    await page.mouse.up();
    await expect(page.locator("css:light=" + ".pane-drag-ghost, [data-pane-insertion]")).toHaveCount(0);
    await expect.poll(async () => (await panel.boundingBox())!.x).toBeLessThan((await editor.boundingBox())!.x);
    expect((await panel.boundingBox())!.x).toBeGreaterThan(before.chat.x + before.chat.width - 2);
    for (const [element, original] of [[chat, before.chat], [editor, before.editor], [panel, before.panel]] as const) {
      await expect.poll(async () => Math.abs((await element.boundingBox())!.width - original.width)).toBeLessThan(1);
      await expect.poll(async () => Math.abs((await element.boundingBox())!.height - original.height)).toBeLessThan(1);
    }
    await expect(draft).toHaveAttribute("data-retained-draft", "true");
    await expect(draft).toHaveValue("Retain this while reordering");
    await expect(editor.locator(".cm-editor")).toHaveAttribute("data-retained-editor", "true");
    await expect(page.locator("css:light=" + ".xterm")).toHaveAttribute("data-retained-terminal", "true");
    // A second drag in the other direction also includes the shell card.
    const changesBox = (await panel.boundingBox())!;
    const fileGrab = (await editor.locator("[data-surface-pane-drag]").first().boundingBox())!;
    await page.mouse.move(fileGrab.x + fileGrab.width / 2, fileGrab.y + fileGrab.height / 2);
    await page.mouse.down();
    await page.mouse.move(changesBox.x + 8, changesBox.y + changesBox.height / 3, { steps: 8 });
    await expect(line).toHaveAttribute("data-pane-insertion", "left");
    await page.mouse.up();
    await expect.poll(async () => (await editor.boundingBox())!.x).toBeLessThan((await panel.boundingBox())!.x);
    await page.evaluate(() => (window as unknown as { toolsFixture: { setTab: (tab: string) => void } }).toolsFixture.setTab("sessions"));
    await expect(grid).toHaveAttribute("data-fold-state", "closed");
    await expect(panel).toBeHidden();
    await page.evaluate(() => (window as unknown as { toolsFixture: { setTab: (tab: string) => void } }).toolsFixture.setTab("changes"));
    await expect(grid).toHaveAttribute("data-fold-state", "open");
    await expect(draft).toHaveAttribute("data-retained-draft", "true");
    await expect(draft).toHaveValue("Retain this while reordering");
  });

  test(`wide changes panel switches from top to right with its grab point above the workspace (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    const { editor } = await openPanels(page);
    await page.evaluate(() => (window as unknown as { toolsFixture: { setTab: (tab: string) => void } }).toolsFixture.setTab("changes"));
    const grid = page.locator("css:light=" + ".desktop-tools-layout");
    await expect(grid).toHaveAttribute("data-fold-state", "open");
    const panel = grid.locator(":scope > .desktop-tools-panel");
    const handle = panel.locator("[data-surface-pane-drag]");
    await handle.focus();
    await page.keyboard.press("ArrowUp");
    await expect(grid).toHaveAttribute("data-tools-side", "top");
    await expect.poll(() => page.evaluate(async () => (await import("/src/shared/lib/paneResize.ts")).isPaneResizing())).toBe(false);
    const chatBox = (await page.locator("css:light=" + '[data-pane-id="tools-session"]').boundingBox())!;
    const editorBox = (await editor.boundingBox())!;
    const target = { x: Math.min(chatBox.x, editorBox.x), y: Math.min(chatBox.y, editorBox.y),
      width: Math.max(chatBox.x + chatBox.width, editorBox.x + editorBox.width) - Math.min(chatBox.x, editorBox.x) };
    const before = (await panel.boundingBox())!;
    const grab = (await handle.boundingBox())!;
    const start = { x: grab.x + grab.width / 2, y: grab.y + grab.height / 2 };
    const y = target.y - 60;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(target.x + 20, y, { steps: 8 });
    const line = page.locator("css:light=" + "[data-pane-insertion]");
    await expect(line).toHaveAttribute("data-pane-insertion", "top");
    for (const inset of [200, 80, 20]) {
      await page.mouse.move(target.x + target.width - inset, y, { steps: 4 });
      await expect(line).toHaveAttribute("data-pane-insertion", "right");
      const floating = (await page.locator("css:light=" + ".pane-drag-ghost > .drag-ghost-card").boundingBox())!;
      expect(floating.x + floating.width / 2).toBeGreaterThan(target.x + target.width);
      expect(Math.abs(floating.width - before.width)).toBeLessThan(1);
      expect(Math.abs(floating.height - before.height)).toBeLessThan(1);
    }
    await page.mouse.up();
    await expect(grid).toHaveAttribute("data-tools-side", "right");
    await expect(page.locator("css:light=" + ".pane-drag-ghost, [data-pane-insertion]")).toHaveCount(0);
    await expect(editor.locator(".cm-editor")).toHaveAttribute("data-retained-editor", "true");
    await expect(page.locator("css:light=" + ".xterm")).toHaveAttribute("data-retained-terminal", "true");
  });

  test(`changes panel shares the full-card drag, insertion marker and retained content (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    const { editor } = await openPanels(page);
    await page.evaluate(() => (window as unknown as { toolsFixture: { setTab: (tab: string) => void } }).toolsFixture.setTab("changes"));
    const grid = page.locator("css:light=" + ".desktop-tools-layout");
    await expect(grid).toHaveAttribute("data-fold-state", "open");
    const panel = grid.locator(":scope > .desktop-tools-panel");
    const draft = panel.locator("textarea");
    await draft.fill("Keep this commit draft");
    await draft.evaluate(el => el.setAttribute("data-retained-draft", "true"));
    const frameStyle = (selector: string) => page.locator("css:light=" + selector).first().evaluate(el => {
      const style = getComputedStyle(el);
      return [style.borderRadius, style.borderTopWidth, style.borderTopColor];
    });
    expect(await frameStyle(".desktop-tools-panel [data-pane-card-frame]"))
      .toEqual(await frameStyle('[data-pane-id="tools-editor"] [data-pane-card-frame]'));
    await expect(panel.locator('[role="tab"][aria-selected="true"]')).toHaveText("Changes");
    for (const side of ["left", "top", "bottom", "right"] as const) {
      const target = (await editor.boundingBox())!;
      const before = (await panel.boundingBox())!;
      const handle = (await panel.locator("[data-surface-pane-drag]").boundingBox())!;
      const x = side === "left" ? target.x + 2 : side === "right" ? target.x + target.width - 2 : target.x + target.width / 2;
      const y = side === "top" ? target.y + 2 : side === "bottom" ? target.y + target.height - 2 : target.y + target.height / 4;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, y, { steps: 8 });
      const ghost = page.locator("css:light=" + ".pane-drag-ghost > .drag-ghost-card");
      await expect(ghost).toBeVisible();
      const floating = (await ghost.boundingBox())!;
      expect(Math.abs(floating.width - before.width)).toBeLessThan(1);
      expect(Math.abs(floating.height - before.height)).toBeLessThan(1);
      await expect(ghost.locator("[data-git-changes-panel]")).toHaveCount(1);
      await expect(ghost.locator("textarea")).toHaveValue("Keep this commit draft");
      await expect(page.locator("css:light=" + "[data-pane-insertion]")).toHaveAttribute("data-pane-insertion", side);
      await expect(panel).toHaveAttribute("data-pane-floating", "");
      if (side === "left" && reducedMotion === "no-preference")
        await page.screenshot({ path: "build/browser-tests/changes-shared-pane-drag.png" });
      await page.mouse.up();
      await expect(grid).toHaveAttribute("data-tools-side", side);
      await expect(page.locator("css:light=" + ".pane-drag-ghost, [data-pane-insertion]")).toHaveCount(0);
      await expect(draft).toHaveAttribute("data-retained-draft", "true");
      await expect(draft).toHaveValue("Keep this commit draft");
      await expect(editor.locator(".cm-editor")).toHaveAttribute("data-retained-editor", "true");
      await expect(page.locator("css:light=" + ".xterm")).toHaveAttribute("data-retained-terminal", "true");
    }
    await expect.poll(() => page.evaluate(async () => {
      const module = "/src/shared/lib/paneResize.ts";
      return (await import(module)).isPaneResizing();
    })).toBe(false);
  });
}
