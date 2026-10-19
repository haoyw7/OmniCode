import { expect, test, type Page } from "@playwright/test";

async function openPanels(page: Page, split = "right") {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/tests/browser/desktop-tools.html?editor=source&explorer&history=long&split=${split}`);
  const chat = page.locator('[data-pane-id="tools-session"]');
  const editor = page.locator('[data-pane-id="tools-editor"]');
  await expect(editor.locator(".cm-editor")).toBeVisible();
  await expect(page.locator(".xterm")).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const module = "/src/shared/lib/paneResize.ts";
    return (await import(module)).isPaneResizing();
  })).toBe(false);
  await editor.locator(".cm-editor").evaluate(el => el.setAttribute("data-retained-editor", "true"));
  await page.locator(".xterm").evaluate(el => el.setAttribute("data-retained-terminal", "true"));
  return { chat, editor };
}

for (const split of ["right", "down"] as const) {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`panel keeps its size while dragging from ${split} layout (${reducedMotion})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      const { chat, editor } = await openPanels(page, split);
      const original = (await editor.boundingBox())!;
      const chatBox = (await chat.boundingBox())!;
      const content = editor.locator(".cm-editor");
      const contentBox = (await content.boundingBox())!;
      const handle = (await editor.locator("[data-surface-pane-drag]").first().boundingBox())!;
      const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
      const horizontal = split === "right";
      const crossEdge = horizontal ? "top" : "left";
      const target = horizontal
        ? { x: chatBox.x + chatBox.width / 2, y: chatBox.y + 20 }
        : { x: chatBox.x + 20, y: chatBox.y + chatBox.height / 2 };
      const floating = page.locator(".pane-drag-ghost > .drag-ghost-card");
      const checkSizes = async () => {
        for (const [element, before] of [[editor, original], [chat, chatBox], [content, contentBox], [floating, original]] as const) {
          const box = (await element.boundingBox())!;
          expect(Math.abs(box.width - before.width)).toBeLessThan(1);
          expect(Math.abs(box.height - before.height)).toBeLessThan(1);
        }
      };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(target.x, target.y, { steps: 8 });
      await expect(floating).toBeVisible();
      expect(await page.locator('[data-pane-id="tools-editor"]').count()).toBe(1);
      const ghostBox = (await floating.boundingBox())!;
      expect(Math.abs(ghostBox.x - original.x - target.x + start.x)).toBeLessThan(1);
      expect(Math.abs(ghostBox.y - original.y - target.y + start.y)).toBeLessThan(1);
      const line = page.locator("[data-pane-insertion]");
      await expect(line).toHaveAttribute("data-pane-insertion", crossEdge);
      const lineBox = (await line.boundingBox())!;
      expect(horizontal ? lineBox.height : lineBox.width).toBe(3);
      const workspaceBox = (await page.locator("[data-pane-tree-layout]").boundingBox())!;
      expect(Math.abs((horizontal ? lineBox.width : lineBox.height) - (horizontal ? workspaceBox.width : workspaceBox.height))).toBeLessThan(1);
      await checkSizes();
      // Same-axis reordering keeps its insertion marker throughout the transition.
      await page.mouse.move(
        horizontal ? chatBox.x + 4 : chatBox.x + chatBox.width / 2,
        horizontal ? chatBox.y + chatBox.height / 2 : chatBox.y + 20,
        { steps: 4 },
      );
      await expect(line).toHaveAttribute("data-pane-insertion", horizontal ? "left" : "top");
      await expect(line).toBeVisible();
      await checkSizes();
      await expect.poll(async () => Math.abs((await editor.boundingBox())![horizontal ? "x" : "y"] - chatBox[horizontal ? "x" : "y"])).toBeLessThan(1);
      await checkSizes();
      // Reversing to a cross-axis drop restores positions without resizing anything.
      await page.mouse.move(target.x, target.y, { steps: 4 });
      await expect(line).toHaveAttribute("data-pane-insertion", crossEdge);
      await checkSizes();
      await expect.poll(async () => Math.abs((await editor.boundingBox())!.x - original.x) + Math.abs((await editor.boundingBox())!.y - original.y)).toBeLessThan(1);
      if (horizontal && reducedMotion === "no-preference") {
        await page.screenshot({ path: "build/browser-tests/panel-drag-insertion.png" });
      }
      await page.mouse.up();
      await expect(floating).toHaveCount(0);
      await expect(line).toHaveCount(0);
      await expect.poll(async () => (await chat.boundingBox())![horizontal ? "y" : "x"]).toBeGreaterThan(chatBox[horizontal ? "y" : "x"] + 100);
      await expect(editor.locator(".cm-editor")).toHaveAttribute("data-retained-editor", "true");
      await expect(page.locator(".xterm")).toHaveAttribute("data-retained-terminal", "true");
    });
  }
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`insertion stays visible while approaching and crossing the target edge (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    const { chat, editor } = await openPanels(page);
    const target = (await chat.boundingBox())!;
    const handle = (await editor.locator("[data-surface-pane-drag]").first().boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    const line = page.locator("[data-pane-insertion]");
    // The center initially chooses bottom. Moving closer to the left must
    // expose the new left insertion, including a little past the pane edge.
    for (const fraction of [0.5, 0.25, 0.1, 0.01, -0.01]) {
      await page.mouse.move(target.x + target.width * fraction, target.y + target.height / 2, { steps: 4 });
      await expect(line).toBeVisible();
    }
    await expect(line).toHaveAttribute("data-pane-insertion", "left");
    expect(await line.evaluate(el => Number(getComputedStyle(el).zIndex))).toBeGreaterThan(
      await page.locator(".pane-drag-ghost").evaluate(el => Number(getComputedStyle(el).zIndex)),
    );
    await page.mouse.move(target.x + target.width / 4, 990, { steps: 4 });
    await expect(line).toHaveCount(0);
    await page.mouse.move(target.x - target.width * 0.01, target.y + target.height / 2, { steps: 4 });
    await expect(line).toHaveAttribute("data-pane-insertion", "left");
    await page.mouse.up();
    await expect(line).toHaveCount(0);
    await expect.poll(async () => (await editor.boundingBox())!.x - (await chat.boundingBox())!.x).toBeLessThan(-100);
    await expect(editor.locator(".cm-editor")).toHaveAttribute("data-retained-editor", "true");
    await expect(page.locator(".xterm")).toHaveAttribute("data-retained-terminal", "true");
  });

  test(`the closer card center or grab point controls the committed edge (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    const { chat, editor } = await openPanels(page);
    const target = (await chat.boundingBox())!;
    const original = (await editor.boundingBox())!;
    const card = (await editor.locator("[data-pane-card-frame]").boundingBox())!;
    const handle = (await editor.locator("[data-surface-pane-drag]").first().boundingBox())!;
    const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    // Put the visible card center 6px from the bottom while the grab point
    // remains well inside the target. A grab-point-only test chooses left.
    const centerDrop = {
      x: target.x + target.width / 2 - (card.x + card.width / 2 - start.x),
      y: target.y + target.height - 6 - (card.y + card.height / 2 - start.y),
    };
    expect(Math.min(centerDrop.x - target.x, target.x + target.width - centerDrop.x,
      centerDrop.y - target.y, target.y + target.height - centerDrop.y)).toBeGreaterThan(6);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(centerDrop.x, centerDrop.y, { steps: 8 });
    const line = page.locator("[data-pane-insertion]");
    await expect(line).toHaveAttribute("data-pane-insertion", "bottom");
    // The grab point wins again when it is closer than the card center.
    await page.mouse.move(target.x + target.width / 2, target.y + 4, { steps: 4 });
    await expect(line).toHaveAttribute("data-pane-insertion", "top");
    await page.mouse.move(centerDrop.x, centerDrop.y, { steps: 4 });
    await expect(line).toHaveAttribute("data-pane-insertion", "bottom");
    const floating = (await page.locator(".pane-drag-ghost > .drag-ghost-card").boundingBox())!;
    expect(Math.abs(floating.width - original.width)).toBeLessThan(1);
    expect(Math.abs(floating.height - original.height)).toBeLessThan(1);
    await page.mouse.up();
    await expect(line).toHaveCount(0);
    await expect.poll(async () => (await editor.boundingBox())!.y - (await chat.boundingBox())!.y).toBeGreaterThan(100);
    await expect(editor.locator(".cm-editor")).toHaveAttribute("data-retained-editor", "true");
    await expect(page.locator(".xterm")).toHaveAttribute("data-retained-terminal", "true");
  });
}

for (const cancel of ["escape", "pointercancel", "blur"] as const) {
  test(`${cancel} restores the panel layout and clears drag state`, async ({ page }) => {
    const { chat, editor } = await openPanels(page);
    const original = (await editor.boundingBox())!;
    const chatBox = (await chat.boundingBox())!;
    const handle = (await editor.locator("[data-surface-pane-drag]").first().boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(chatBox.x + 4, chatBox.y + chatBox.height / 2, { steps: 8 });
    await expect(page.locator(".pane-drag-ghost")).toHaveCount(1);
    await expect.poll(async () => (await editor.boundingBox())!.x).toBeLessThan(chatBox.x + 40);
    if (cancel === "escape") await page.keyboard.press("Escape");
    else await page.evaluate(kind => window.dispatchEvent(kind === "blur"
      ? new Event("blur") : new PointerEvent("pointercancel", { pointerId: 1 })), cancel);
    await page.mouse.up();
    await expect(page.locator(".pane-drag-ghost")).toHaveCount(0);
    await expect(page.locator("[data-pane-floating]")).toHaveCount(0);
    await expect.poll(async () => Math.abs((await editor.boundingBox())!.x - original.x)).toBeLessThan(1);
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("is-reordering"))).toBe(false);
    await expect(editor.locator(".cm-editor")).toHaveAttribute("data-retained-editor", "true");
  });
}


for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`manual horizontal tools survive fitting and window resizing (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 1200, height: 1000 });
    await page.goto("/tests/browser/desktop-tools.html?editor=source&stackedTools");
    const files = page.locator('[data-pane-id="tools-editor"]');
    const terminalPane = page.locator('[data-pane-id="tools-stacked-terminal"]');
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
    await expect(page.locator("[data-pane-insertion]")).toHaveAttribute("data-pane-insertion", "right");
    await page.mouse.up();
    await expect(page.locator(".pane-drag-ghost")).toHaveCount(0);
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
  const pane = page.locator('[data-pane-id="tools-editor"]');
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
  const chat = (await page.locator('[data-pane-id="tools-session"]').boundingBox())!;
  const handle = (await pane.locator("[data-surface-pane-drag]").first().boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(chat.x + chat.width / 2, chat.y + 20, { steps: 8 });
  await expect(page.locator(".pane-drag-ghost .xterm")).toBeVisible();
  await expect(page.locator('[data-pane-insertion="top"]')).toBeVisible();
  expect(Math.abs((await pane.boundingBox())!.width - original.width)).toBeLessThan(1);
  expect(Math.abs((await pane.boundingBox())!.height - original.height)).toBeLessThan(1);
  expect((await calls()).filter(call => call === "pty_resize").length).toBe(before.filter(call => call === "pty_resize").length);
  await page.mouse.up();
  await expect(page.locator(".pane-drag-ghost")).toHaveCount(0);
  await expect(terminal).toHaveAttribute("data-retained-terminal", "true");
  expect((await calls()).filter(call => call === "pty_spawn" || call === "pty_kill")).toEqual(before.filter(call => call === "pty_spawn" || call === "pty_kill"));
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`changes trades places with the middle editor and preserves it during reversal (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    const { chat, editor } = await openPanels(page);
    await page.evaluate(() => (window as unknown as { toolsFixture: { setTab: (tab: string) => void } }).toolsFixture.setTab("changes"));
    const grid = page.locator(".desktop-tools-layout");
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
    const line = page.locator("[data-pane-insertion]");
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
    await expect(page.locator(".pane-drag-ghost, [data-pane-insertion]")).toHaveCount(0);
    await expect.poll(async () => (await panel.boundingBox())!.x).toBeLessThan((await editor.boundingBox())!.x);
    expect((await panel.boundingBox())!.x).toBeGreaterThan(before.chat.x + before.chat.width - 2);
    for (const [element, original] of [[chat, before.chat], [editor, before.editor], [panel, before.panel]] as const) {
      await expect.poll(async () => Math.abs((await element.boundingBox())!.width - original.width)).toBeLessThan(1);
      await expect.poll(async () => Math.abs((await element.boundingBox())!.height - original.height)).toBeLessThan(1);
    }
    await expect(draft).toHaveAttribute("data-retained-draft", "true");
    await expect(draft).toHaveValue("Retain this while reordering");
    await expect(editor.locator(".cm-editor")).toHaveAttribute("data-retained-editor", "true");
    await expect(page.locator(".xterm")).toHaveAttribute("data-retained-terminal", "true");
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
    const grid = page.locator(".desktop-tools-layout");
    await expect(grid).toHaveAttribute("data-fold-state", "open");
    const panel = grid.locator(":scope > .desktop-tools-panel");
    const handle = panel.locator("[data-surface-pane-drag]");
    await handle.focus();
    await page.keyboard.press("ArrowUp");
    await expect(grid).toHaveAttribute("data-tools-side", "top");
    await expect.poll(() => page.evaluate(async () => (await import("/src/shared/lib/paneResize.ts")).isPaneResizing())).toBe(false);
    const chatBox = (await page.locator('[data-pane-id="tools-session"]').boundingBox())!;
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
    const line = page.locator("[data-pane-insertion]");
    await expect(line).toHaveAttribute("data-pane-insertion", "top");
    for (const inset of [200, 80, 20]) {
      await page.mouse.move(target.x + target.width - inset, y, { steps: 4 });
      await expect(line).toHaveAttribute("data-pane-insertion", "right");
      const floating = (await page.locator(".pane-drag-ghost > .drag-ghost-card").boundingBox())!;
      expect(floating.x + floating.width / 2).toBeGreaterThan(target.x + target.width);
      expect(Math.abs(floating.width - before.width)).toBeLessThan(1);
      expect(Math.abs(floating.height - before.height)).toBeLessThan(1);
    }
    await page.mouse.up();
    await expect(grid).toHaveAttribute("data-tools-side", "right");
    await expect(page.locator(".pane-drag-ghost, [data-pane-insertion]")).toHaveCount(0);
    await expect(editor.locator(".cm-editor")).toHaveAttribute("data-retained-editor", "true");
    await expect(page.locator(".xterm")).toHaveAttribute("data-retained-terminal", "true");
  });

  test(`changes panel shares the full-card drag, insertion marker and retained content (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    const { editor } = await openPanels(page);
    await page.evaluate(() => (window as unknown as { toolsFixture: { setTab: (tab: string) => void } }).toolsFixture.setTab("changes"));
    const grid = page.locator(".desktop-tools-layout");
    await expect(grid).toHaveAttribute("data-fold-state", "open");
    const panel = grid.locator(":scope > .desktop-tools-panel");
    const draft = panel.locator("textarea");
    await draft.fill("Keep this commit draft");
    await draft.evaluate(el => el.setAttribute("data-retained-draft", "true"));
    const frameStyle = (selector: string) => page.locator(selector).first().evaluate(el => {
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
      const ghost = page.locator(".pane-drag-ghost > .drag-ghost-card");
      await expect(ghost).toBeVisible();
      const floating = (await ghost.boundingBox())!;
      expect(Math.abs(floating.width - before.width)).toBeLessThan(1);
      expect(Math.abs(floating.height - before.height)).toBeLessThan(1);
      await expect(ghost.locator("[data-git-changes-panel]")).toHaveCount(1);
      await expect(ghost.locator("textarea")).toHaveValue("Keep this commit draft");
      await expect(page.locator("[data-pane-insertion]")).toHaveAttribute("data-pane-insertion", side);
      await expect(panel).toHaveAttribute("data-pane-floating", "");
      if (side === "left" && reducedMotion === "no-preference")
        await page.screenshot({ path: "build/browser-tests/changes-shared-pane-drag.png" });
      await page.mouse.up();
      await expect(grid).toHaveAttribute("data-tools-side", side);
      await expect(page.locator(".pane-drag-ghost, [data-pane-insertion]")).toHaveCount(0);
      await expect(draft).toHaveAttribute("data-retained-draft", "true");
      await expect(draft).toHaveValue("Keep this commit draft");
      await expect(editor.locator(".cm-editor")).toHaveAttribute("data-retained-editor", "true");
      await expect(page.locator(".xterm")).toHaveAttribute("data-retained-terminal", "true");
    }
    await expect.poll(() => page.evaluate(async () => {
      const module = "/src/shared/lib/paneResize.ts";
      return (await import(module)).isPaneResizing();
    })).toBe(false);
  });
}
